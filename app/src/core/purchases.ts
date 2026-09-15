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
}): JournalLine[] {
  const { grandTotalMinor, paidMinor, expensePayments } = args
  if (!Number.isInteger(grandTotalMinor) || grandTotalMinor <= 0) throw new RangeError('إجمالي الفاتورة يجب أن يكون موجباً')
  if (!Number.isInteger(paidMinor) || paidMinor < 0) throw new RangeError('المدفوع لا يكون سالباً')
  for (const e of expensePayments) {
    if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) throw new RangeError('مبلغ مصروف مدفوع غير صالح')
  }
  const expensesPaidDirect = expensePayments.reduce((a, e) => a + e.amountMinor, 0)
  const supplierDue = grandTotalMinor - expensesPaidDirect // بضاعة + مصاريف على حسابه
  if (supplierDue < 0) throw new RangeError('المصاريف المدفوعة مباشرة أكبر من إجمالي الفاتورة')
  if (paidMinor > supplierDue) throw new RangeError('المدفوع أكبر من مستحق المورد (البضاعة + المصاريف المحملة على حسابه)')
  const remaining = supplierDue - paidMinor
  const lines: JournalLine[] = [
    { accountCode: args.inventoryAccount, debit: grandTotalMinor, credit: 0, note: args.inventoryNote },
  ]
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
}

/** سطر من فاتورة الشراء الأصلية كما تحتاجه حسابات المرتجع */
export interface OriginalPurchaseLine {
  itemId: number
  qty: number
  landedUnitCostMinor: Minor
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
    const orig = purchaseLines.find((l) => l.itemId === itemId)
    if (!orig) throw new RangeError(`«${name}» ليس في فاتورة الشراء الأصلية`)
    const canReturn = remaining.get(itemId) ?? 0
    if (wanted > canReturn + 1e-9) {
      throw new RangeError(`«${name}»: المطلوب إرجاع ${wanted} والمتبقي القابل للإرجاع ${canReturn}`)
    }
    if (info && wanted > info.stockQty + 1e-9) {
      throw new RangeError(`«${name}»: المخزون الحالي ${info.stockQty} فقط — لا يمكن إرجاع بضاعة بيعت بالفعل`)
    }
    out.push({ itemId, nameAr: name, qty: wanted, landedUnitCostMinor: orig.landedUnitCostMinor })
  }
  if (!out.length) throw new RangeError('لا كميات للإرجاع')
  return out
}

export function purchaseReturnTotal(lines: PurchaseReturnLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.landedUnitCostMinor), 0)
}

/**
 * قيد مرتجع الشراء:
 *   دائن: المخزون (1103) — البضاعة تخرج بقيمتها
 *   مدين: الخزينة (1101) استرداد نقدي، أو الموردون (2101) تخفيض الدين
 */
export function buildPurchaseReturnEntry(
  totalMinor: Minor,
  refund: 'cash' | 'debt',
  treasury = '1101',
): JournalLine[] {
  if (totalMinor <= 0) throw new RangeError('قيمة المرتجع يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    {
      accountCode: refund === 'cash' ? treasury : '2101',
      debit: totalMinor,
      credit: 0,
      note: refund === 'cash' ? 'استرداد نقدي من المورد' : 'تخفيض دين المورد',
    },
    { accountCode: '1103', debit: 0, credit: totalMinor, note: 'بضاعة خارجة للمورد' },
  ]
  assertBalanced(lines)
  return lines
}
