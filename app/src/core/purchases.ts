/**
 * محاسبة المشتريات ومرتجعاتها — ShopSys (المرحلة 3)
 * ─────────────────────────────────────────────────
 * قيد الشراء: البضاعة تدخل المخزون بتكلفتها الكاملة (بضاعة + مصاريف موزعة)،
 * والمدفوع يخرج من الخزينة والباقي ديناً على المورد.
 * المرتجع: يُقيَّم بالتكلفة النهائية للوحدة من فاتورته الأصلية (Landed Cost)،
 * ولا يُرجَع أكثر مما اشتُري (تراكمياً) ولا أكثر من المخزون الحالي.
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/**
 * قيد فاتورة الشراء:
 *   مدين: المخزون (1103) بالتكلفة الكاملة (بضاعة + مصاريف)
 *   دائن: الخزينة (1101) بالمدفوع
 *   دائن: الموردون (2101) بالمتبقي
 * يرمي خطأ لو المدفوع أكبر من الإجمالي.
 */
export function buildPurchaseEntry(grandTotalMinor: Minor, paidMinor: Minor, treasury = '1101'): JournalLine[] {
  if (paidMinor < 0) throw new RangeError('المدفوع لا يكون سالباً')
  if (paidMinor > grandTotalMinor) throw new RangeError('المدفوع أكبر من إجمالي الفاتورة')
  const remaining = grandTotalMinor - paidMinor
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: grandTotalMinor, credit: 0, note: 'بضاعة واردة بتكلفتها الكاملة' },
  ]
  // المدفوع يخرج من الخزينة/البنك الذي اختاره المستخدم (طلب المالك)
  if (paidMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: paidMinor, note: 'مدفوع من الخزينة/البنك' })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'دين للمورد' })
  assertBalanced(lines)
  return lines
}

/* ─── قيد الشراء بمصادر دفع منفصلة للمصاريف (طلب المالك) ───
 * مصاريف الشحن/الجمارك قد لا تكون ديناً للمورد: قد يدفعها المشتري بنفسه
 * من خزينة أو بنك أو عهدة موظف. كل مصروف يحدد «من دفعه» بشكل مستقل. */

/** مصروف مدفوع مباشرة (ليس على حساب المورد): يُقيَّد دائناً على حسابه */
export interface ExpensePaymentCredit {
  account: string // كود خزينة/بنك أو 1108 (عهد الموظفين)
  amountMinor: Minor
  note: string
}

/**
 * قيد فاتورة الشراء الموسع:
 *   مدين: حساب البضاعة (1103 مخزون أو 5110 تكاليف مشروع) بالتكلفة الكاملة
 *   دائن: مصدر دفع البضاعة بالمدفوع
 *   دائن: كل مصروف مدفوع مباشرة على حسابه (خزينة/بنك/عهدة)
 *   دائن: الموردون (2101) بالمتبقي المستحق له فقط
 * المدفوع هنا مقابل مستحق المورد (البضاعة + مصاريفه) — لا يتجاوزه.
 */
export function buildPurchaseEntryV2(args: {
  inventoryAccount: string // 1103 عادية أو 5110 لمشروع مقاولات
  inventoryNote: string
  grandTotalMinor: Minor // بضاعة + كل المصاريف (تدخل التكلفة دائماً)
  paidMinor: Minor // المدفوع من مستحق المورد
  payAccount: string // خزينة/بنك أو 1108 عهدة
  expensePayments: ExpensePaymentCredit[] // المصاريف المدفوعة مباشرة
  /**
   * ض.ق.م المدخلات القابلة للخصم (سد فجوة T1 — للمنشآت المسجلة ضريبياً):
   * تُقيَّد مدينة على 2102 فتخصم من ضريبة المخرجات في الإقرار،
   * ولا تدخل تكلفة المخزون إطلاقاً (لا تتضخم 1103 بضريبة قابلة للاسترداد).
   * غير المسجل يتركها 0 فتبقى الضريبة ضمن التكلفة كما كان (سلوك افتراضي سليم).
   */
  inputVatMinor?: Minor
}): JournalLine[] {
  const { grandTotalMinor, paidMinor, expensePayments } = args
  const inputVat = args.inputVatMinor ?? 0
  if (!Number.isInteger(grandTotalMinor) || grandTotalMinor <= 0) throw new RangeError('إجمالي الفاتورة يجب أن يكون موجباً')
  if (!Number.isInteger(paidMinor) || paidMinor < 0) throw new RangeError('المدفوع لا يكون سالباً')
  if (!Number.isInteger(inputVat) || inputVat < 0) throw new RangeError('ضريبة المدخلات لا تكون سالبة')
  for (const e of expensePayments) {
    if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) throw new RangeError('مبلغ مصروف مدفوع غير صالح')
  }
  const expensesPaidDirect = expensePayments.reduce((a, e) => a + e.amountMinor, 0)
  // مستحق المورد = بضاعة + مصاريف على حسابه + ضريبة المدخلات (المورد يقبضها ليوردها)
  const supplierDue = grandTotalMinor + inputVat - expensesPaidDirect
  if (supplierDue < 0) throw new RangeError('المصاريف المدفوعة مباشرة أكبر من إجمالي الفاتورة')
  if (paidMinor > supplierDue) throw new RangeError('المدفوع أكبر من مستحق المورد (البضاعة + الضريبة + المصاريف المحملة على حسابه)')
  const remaining = supplierDue - paidMinor
  const lines: JournalLine[] = [
    { accountCode: args.inventoryAccount, debit: grandTotalMinor, credit: 0, note: args.inventoryNote },
  ]
  if (inputVat > 0) lines.push({ accountCode: '2102', debit: inputVat, credit: 0, note: 'ض.ق.م مدخلات قابلة للخصم' })
  if (paidMinor > 0) lines.push({ accountCode: args.payAccount, debit: 0, credit: paidMinor, note: 'مدفوع للمورد' })
  for (const e of expensePayments) lines.push({ accountCode: e.account, debit: 0, credit: e.amountMinor, note: e.note })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'دين للمورد' })
  assertBalanced(lines)
  return lines
}

/**
 * قيد مصروف لاحق على فاتورة مرحّلة (Landed Cost Voucher):
 *   مدين: المخزون (1103) لنصيب البضاعة الباقية، و/أو تكلفة البضاعة المباعة (5101)
 *          لنصيب ما بيع بالفعل، أو تكاليف المشروع (5110) لفواتير المشاريع
 *   دائن: المورد (2101) أو الخزينة/البنك أو العهدة (1108) حسب من دفع
 */
export function buildLateExpenseEntry(args: {
  debits: { account: string; amountMinor: Minor; note: string }[]
  creditAccount: string
  creditNote: string
}): JournalLine[] {
  const total = args.debits.reduce((a, d) => a + d.amountMinor, 0)
  if (!Number.isInteger(total) || total <= 0) throw new RangeError('مبلغ المصروف يجب أن يكون موجباً')
  const lines: JournalLine[] = []
  for (const d of args.debits) {
    if (!Number.isInteger(d.amountMinor) || d.amountMinor < 0) throw new RangeError('نصيب توزيع غير صالح')
    if (d.amountMinor > 0) lines.push({ accountCode: d.account, debit: d.amountMinor, credit: 0, note: d.note })
  }
  lines.push({ accountCode: args.creditAccount, debit: 0, credit: total, note: args.creditNote })
  assertBalanced(lines)
  return lines
}

/* ─── مرتجع الشراء ─── */

export interface PurchaseReturnLine {
  itemId: number
  nameAr: string
  qty: number
  landedUnitCostMinor: Minor // تكلفة الوحدة النهائية من فاتورة الشراء الأصلية
  /** سعر الوحدة في فاتورة المورد (قبل المصاريف) — undefined = سجل قديم (يعامل كالمحمل) */
  unitPriceMinor?: Minor
}

/** سطر من فاتورة الشراء الأصلية كما تحتاجه حسابات المرتجع */
export interface OriginalPurchaseLine {
  itemId: number
  qty: number
  landedUnitCostMinor: Minor
  unitPriceMinor?: Minor
}

/** المتبقي القابل للإرجاع لكل صنف (المشترى − مجموع المرتجعات السابقة على نفس الفاتورة) */
export function remainingPurchasable(
  purchaseLines: OriginalPurchaseLine[],
  priorReturnLines: { itemId: number; qty: number }[],
): Map<number, number> {
  const map = new Map<number, number>()
  for (const l of purchaseLines) map.set(l.itemId, (map.get(l.itemId) ?? 0) + l.qty)
  for (const r of priorReturnLines) {
    map.set(r.itemId, Math.round(((map.get(r.itemId) ?? 0) - r.qty) * 1000) / 1000)
  }
  return map
}

/**
 * بناء سطور مرتجع الشراء بكميات مطلوبة — بتكلفة الوحدة النهائية من الأصل.
 * يرمي خطأ لو الكمية تتجاوز المتبقي القابل للإرجاع أو المخزون الحالي
 * (لا يمكن إرجاع بضاعة بِيعت بالفعل).
 */
export function buildPurchaseReturnLines(
  purchaseLines: OriginalPurchaseLine[],
  priorReturnLines: { itemId: number; qty: number }[],
  qtyByItem: Map<number, number>,
  itemInfo: (itemId: number) => { nameAr: string; stockQty: number } | undefined,
): PurchaseReturnLine[] {
  const remaining = remainingPurchasable(purchaseLines, priorReturnLines)
  const out: PurchaseReturnLine[] = []
  for (const [itemId, wanted] of qtyByItem) {
    if (wanted <= 0) continue
    const info = itemInfo(itemId)
    const name = info?.nameAr ?? `#${itemId}`
    // إصلاح (تدقيق المالك): سطران لنفس الصنف بسعرين — كان يؤخذ سعر أول سطر فقط،
    // الآن تكلفة/سعر الإرجاع = المتوسط المرجح لكل سطور الصنف في الفاتورة
    const itemLines = purchaseLines.filter((l) => l.itemId === itemId)
    if (itemLines.length === 0) throw new RangeError(`«${name}» ليس في فاتورة الشراء الأصلية`)
    const totQty = itemLines.reduce((s, l) => s + l.qty, 0)
    const avgLanded = totQty > 0 ? Math.round(itemLines.reduce((s, l) => s + l.qty * l.landedUnitCostMinor, 0) / totQty) : itemLines[0].landedUnitCostMinor
    const hasPrices = itemLines.every((l) => l.unitPriceMinor != null)
    const avgPrice = hasPrices && totQty > 0 ? Math.round(itemLines.reduce((s, l) => s + l.qty * (l.unitPriceMinor ?? 0), 0) / totQty) : itemLines[0].unitPriceMinor
    const canReturn = remaining.get(itemId) ?? 0
    if (wanted > canReturn + 1e-9) {
      throw new RangeError(`«${name}»: المطلوب إرجاع ${wanted} والمتبقي القابل للإرجاع ${canReturn}`)
    }
    if (info && wanted > info.stockQty + 1e-9) {
      throw new RangeError(`«${name}»: المخزون الحالي ${info.stockQty} فقط — لا يمكن إرجاع بضاعة بيعت بالفعل`)
    }
    out.push({ itemId, nameAr: name, qty: wanted, landedUnitCostMinor: avgLanded, unitPriceMinor: avgPrice })
  }
  if (!out.length) throw new RangeError('لا كميات للإرجاع')
  return out
}

/** قيمة المخزون الخارجة: بالتكلفة المحملة (نفس ما دخل به 1103) */
export function purchaseReturnTotal(lines: PurchaseReturnLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.landedUnitCostMinor), 0)
}

/**
 * G4: المسترد من المورد = سعر فاتورته فقط (قبل المصاريف الموزعة) —
 * المورد لا يرد شحناً/جماركاً دفعتُها أنا أو حُمّلت على حسابه كمصروف مستقل.
 * سجل قديم بلا unitPriceMinor يعامل بالتكلفة المحملة (توافق خلفي).
 */
export function purchaseReturnSupplierValue(lines: PurchaseReturnLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * (l.unitPriceMinor ?? l.landedUnitCostMinor)), 0)
}

/**
 * قيد مرتجع الشراء:
 *   دائن: المخزون (1103) بالتكلفة المحملة — البضاعة تخرج بقيمتها الدفترية كاملة
 *   دائن: 2102 عكس حصة ض.ق.م المدخلات (إن وُجدت)
 *   مدين: الخزينة (نقدي) أو الموردون 2101 (دين) بما يسترده المورد فعلاً =
 *          سعر فاتورته + حصة الضريبة (G4: بلا المصاريف الموزعة)
 *   مدين: 5111 هالك وتوالف — نصيب المصاريف الموزعة على البضاعة المرتجعة
 *          (شحن/جمارك دُفعت ولا تُسترد: خسارة محققة، نمط QuickBooks/Odoo
 *          «non-recoverable landed cost on returns»)
 */
export function buildPurchaseReturnEntry(
  totalMinor: Minor,
  refund: 'cash' | 'debt',
  treasury = '1101',
  /**
   * N2 (المراجعة الثانية): حصة ضريبة المدخلات المعكوسة عن البضاعة المرتجعة —
   * فاتورة سُجلت بضريبة مدخلات (2102 مدين) ورُدّ جزء من بضاعتها ⇒ يجب عكس
   * نصيب ذلك الجزء من الضريبة (2102 دائن) وإلا خصم الإقرار مدخلات عن بضاعة رُدَّت.
   * المسترد من المورد = قيمة بضاعته (بسعر فاتورته) + حصتها الضريبية.
   */
  inputVatShareMinor: Minor = 0,
  /**
   * G4: قيمة البضاعة بسعر فاتورة المورد (قبل المصاريف الموزعة) —
   * هي ما يسترده المورد. الافتراضي = totalMinor (توافق خلفي: فواتير بلا مصاريف).
   */
  supplierValueMinor: Minor = totalMinor,
): JournalLine[] {
  if (totalMinor <= 0) throw new RangeError('قيمة المرتجع يجب أن تكون موجبة')
  if (!Number.isInteger(inputVatShareMinor) || inputVatShareMinor < 0) throw new RangeError('حصة ضريبة المرتجع لا تكون سالبة')
  if (!Number.isInteger(supplierValueMinor) || supplierValueMinor <= 0) throw new RangeError('قيمة مستحق المورد عن المرتجع غير صالحة')
  if (supplierValueMinor > totalMinor) throw new RangeError('مستحق المورد عن المرتجع لا يتجاوز قيمته الدفترية')
  const refundTotal = supplierValueMinor + inputVatShareMinor
  const expenseLossMinor = totalMinor - supplierValueMinor // نصيب المصاريف الموزعة غير المسترد
  const lines: JournalLine[] = [
    {
      accountCode: refund === 'cash' ? treasury : '2101',
      debit: refundTotal,
      credit: 0,
      note: refund === 'cash' ? 'استرداد نقدي من المورد' : 'تخفيض دين المورد',
    },
    { accountCode: '1103', debit: 0, credit: totalMinor, note: 'بضاعة خارجة للمورد بتكلفتها المحملة' },
  ]
  if (expenseLossMinor > 0) {
    lines.push({ accountCode: '5111', debit: expenseLossMinor, credit: 0, note: 'مصاريف شراء موزعة غير مستردة (مرتجع)' })
  }
  if (inputVatShareMinor > 0) {
    lines.push({ accountCode: '2102', debit: 0, credit: inputVatShareMinor, note: 'عكس ض.ق.م مدخلات عن بضاعة مرتجعة' })
  }
  assertBalanced(lines)
  return lines
}
