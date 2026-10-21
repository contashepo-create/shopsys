/**
 * نواة الكاشير POS — ShopSys
 * ─────────────────────────────
 * منطق خالص بلا واجهة: السلة، الخصومات، الضريبة (شامل/مضاف)،
 * التحقق من المخزون، وبناء القيد المحاسبي للفاتورة.
 * (وثيقة التصميم — القرارات 6، 8، 9، 14)
 */
import type { Minor } from './money.ts'
import { mulQty, percentOf, splitInclusiveTax, addExclusiveTax } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

export interface CartLine {
  itemId: number
  nameAr: string
  qty: number
  unitPriceMinor: Minor // سعر بيع الوحدة
  unitCostMinor: Minor // تكلفة الوحدة (متوسط مرجح) لقيد COGS
  discountPercent: number // خصم السطر
  soldByWeight: boolean
  /** سيريالات القطع المعيّنة (أصناف الموبايلات/الأجهزة) — طولها = qty عند الاستخدام */
  serials?: string[]
  /** تركيبة المتغير (ملابس): لون/مقاس — إلزامية لو للصنف مصفوفة برصيد */
  variantColor?: string
  variantSize?: string
  /** نسبة ضريبة السطر (تجاوز الصنف): undefined = نسبة الفاتورة العامة، 0 = معفى */
  vatPercentOverride?: number
  /**
   * ملاحظة البند (طلب المالك): عمود ملاحظات بجانب كل سطر في الفاتورة.
   * نص وصفي بحت (ملاحظة المنتج/الصنف في الصف) — لا affect أي حساب ولا قيد.
   */
  notes?: string
  /**
   * البيع بوحدة أكبر (صيدلية: شريط/علبة — جولة الصيدلية):
   * qty بالوحدة المختارة، unitPriceMinor/unitCostMinor سعر وتكلفة الوحدة المختارة،
   * وunitFactor = كم وحدة أساسية فيها — خصم المخزون = qty × unitFactor.
   */
  unitFactor?: number
  unitLabel?: string
  /** مخزن هذا السطر — يعلو على مخزن رأس الفاتورة في البيع متعدد المخازن */
  warehouseId?: number | null
  /**
   * ضمان ممتد اختياري لقطعة سيريال محددة (سد فجوة فورية — النشاط #6: أجهزة
   * كهربائية): أشهر إضافية تُثبَّت على `SerialUnit` وقت البيع فوق الضمان
   * الأساسي للصنف. يُطبَّق على كل سيريالات هذا السطر.
   */
  extendedWarrantyMonths?: number
  /** مزوّد ضمان ممتد خارجي اختياري (سد فجوة مستقبلية — النشاط #6) — نص حر */
  extendedWarrantyProvider?: string
  /**
   * جزء من سعر الوحدة (قبل الخصم) معفى بالكامل من ضريبة القيمة المضافة بصرف
   * النظر عن `vatPercentOverride` — سد فجوة فورية (النشاط #15: ذهب ومجوهرات):
   * بروتوكول مصلحة الضرائب المصرية مع شعبة الذهب والفضة (قرار 32 لسنة 2026،
   * منشور الجمارك 33 لسنة 2026) يفرض 14% على «المصنعية» فقط دون قيمة المعدن
   * النفيس نفسه. undefined/0 = كل السعر خاضع كالمعتاد (أي صنف غير ذهبي).
   */
  vatExemptPerUnitMinor?: Minor
}

/** كمية السطر بالوحدة الأساسية (للمخزون/الدفعات) — qty × unitFactor */
export function baseQty(l: { qty: number; unitFactor?: number }): number {
  return Math.round(l.qty * (l.unitFactor ?? 1) * 1000) / 1000
}

/**
 * حارس حد الائتمان (مراجعة المبيعات — سد فجوة SAP B1/أودو):
 * البرامج العالمية تفحص حد ائتمان العميل لحظة البيع الآجل لا بعد وقوعه —
 * رصيده القائم + الجزء الآجل الجديد لا يتجاوز حده، والتجاوز بموافقة مدير
 * تُسجَّل على الفاتورة وفي سجل التدقيق (نفس نمط تجاوز الصلاحية — القرار 8).
 * حد = 0 يعني «بلا حد» (لم يُضبط) — لا فحص.
 */
export class CreditLimitError extends Error {
  customerName: string
  balanceMinor: Minor
  newCreditMinor: Minor
  limitMinor: Minor
  constructor(customerName: string, balanceMinor: Minor, newCreditMinor: Minor, limitMinor: Minor) {
    super(
      `«${customerName}» سيتجاوز حد ائتمانه: الرصيد ${(balanceMinor / 100).toFixed(2)} + آجل جديد ${(newCreditMinor / 100).toFixed(2)} > الحد ${(limitMinor / 100).toFixed(2)}`,
    )
    this.name = 'CreditLimitError'
    this.customerName = customerName
    this.balanceMinor = balanceMinor
    this.newCreditMinor = newCreditMinor
    this.limitMinor = limitMinor
  }
}

/** فحص خالص: هل يتجاوز البيع الآجل حد ائتمان العميل؟ (حد 0 = بلا حد) */
export function exceedsCreditLimit(balanceMinor: Minor, newCreditMinor: Minor, limitMinor: Minor): boolean {
  if (limitMinor <= 0) return false
  if (newCreditMinor <= 0) return false
  return balanceMinor + newCreditMinor > limitMinor
}

export type PaymentMethod = 'cash' | 'credit'

export interface CartTotals {
  grossMinor: Minor // قبل الخصم
  discountMinor: Minor // إجمالي الخصومات (سطور + فاتورة)
  netMinor: Minor // بعد الخصم (هذا ما يدفعه العميل إذا الضريبة شاملة)
  taxBaseMinor: Minor // الأساس الضريبي
  taxMinor: Minor // الضريبة
  totalMinor: Minor // الإجمالي النهائي المستحق
  cogsMinor: Minor // تكلفة البضاعة المباعة
}

/** إجمالي سطر بعد خصمه */
export function lineTotal(line: CartLine): Minor {
  const gross = mulQty(line.unitPriceMinor, line.qty)
  const discount = percentOf(gross, line.discountPercent)
  return gross - discount
}

/**
 * حساب إجماليات السلة.
 * taxInclusive=true: الأسعار شاملة الضريبة — تُفصل منها (الافتراضي للتجزئة).
 * taxInclusive=false: الضريبة تضاف فوق الصافي.
 */
export function computeTotals(
  lines: CartLine[],
  invoiceDiscountPercent: number,
  taxPercent: number,
  taxInclusive: boolean,
): CartTotals {
  let gross = 0
  let lineDiscounts = 0
  const cogsByCostBasis = new Map<string, { unitCostMinor: Minor; qty: number }>()
  for (const l of lines) {
    if (l.qty <= 0) throw new RangeError(`كمية غير صالحة للصنف ${l.nameAr}`)
    if (l.discountPercent < 0 || l.discountPercent > 100) throw new RangeError('خصم سطر خارج النطاق')
    const g = mulQty(l.unitPriceMinor, l.qty)
    gross += g
    lineDiscounts += percentOf(g, l.discountPercent)
    // Consolidate same-item/same-unit cost before rounding so duplicate fractional
    // lines cannot each round a half-minor upward and overstate COGS.
    const costBasisKey = `${l.itemId}:${l.unitFactor ?? 1}:${l.unitCostMinor}`
    const costBasis = cogsByCostBasis.get(costBasisKey)
    if (costBasis) costBasis.qty += l.qty
    else cogsByCostBasis.set(costBasisKey, { unitCostMinor: l.unitCostMinor, qty: l.qty })
  }
  const cogs = [...cogsByCostBasis.values()].reduce((sum, basis) => sum + mulQty(basis.unitCostMinor, basis.qty), 0)
  if (invoiceDiscountPercent < 0 || invoiceDiscountPercent > 100) throw new RangeError('خصم فاتورة خارج النطاق')
  const afterLineDiscounts = gross - lineDiscounts
  const invoiceDiscount = percentOf(afterLineDiscounts, invoiceDiscountPercent)
  const net = afterLineDiscounts - invoiceDiscount

  // ═══ ضريبة لكل سطر (طلب المالك: نسبة خاصة لصنف أو إعفاؤه) ═══
  // لو أي سطر له تجاوز أو جزءاً معفى (ذهب: قيمة المعدن معفاة والمصنعية
  // خاضعة ضمن نفس السطر — سد فجوة النشاط #15)، نحسب الضريبة سطراً سطراً
  // بنسبته الفعلية، مع توزيع خصم الفاتورة نسبياً على السطور حتى لا يختل
  // الأساس الضريبي.
  const hasOverrides = lines.some((l) => l.vatPercentOverride !== undefined || (l.vatExemptPerUnitMinor ?? 0) > 0)
  let taxBase: Minor, tax: Minor, total: Minor
  if (hasOverrides) {
    let taxSum = 0
    let baseSum = 0
    let netCheck = 0
    for (const l of lines) {
      const g = mulQty(l.unitPriceMinor, l.qty)
      const lineNetBeforeInvDisc = g - percentOf(g, l.discountPercent)
      // نصيب السطر من خصم الفاتورة (نسبي على صافي السطور)
      const share = afterLineDiscounts > 0 ? Math.round((invoiceDiscount * lineNetBeforeInvDisc) / afterLineDiscounts) : 0
      const lineNet = lineNetBeforeInvDisc - share
      netCheck += lineNet
      const p = l.vatPercentOverride !== undefined ? l.vatPercentOverride : taxPercent
      // جزء السطر المعفى بالكامل (قيمة الذهب) — يُستبعد من الأساس الخاضع
      // بنفس نسبة انكماش السطر بسبب الخصومات (g>0 دائماً هنا لأن qty>0 تحقق أعلاه)
      const exemptPerUnit = Math.max(0, Math.min(l.vatExemptPerUnitMinor ?? 0, l.unitPriceMinor))
      const exemptGross = mulQty(exemptPerUnit, l.qty)
      const exemptNet = g > 0 ? Math.round((exemptGross * lineNet) / g) : 0
      const taxableNet = lineNet - exemptNet
      baseSum += exemptNet // معفى: يدخل الأساس (إيراد) بلا أي ضريبة مهما كانت p
      if (p <= 0 || taxableNet <= 0) { baseSum += taxableNet; continue }
      if (taxInclusive) {
        const [b, t] = splitInclusiveTax(taxableNet, p)
        baseSum += b; taxSum += t
      } else {
        const [t] = addExclusiveTax(taxableNet, p)
        baseSum += taxableNet; taxSum += t
      }
    }
    // فرق تقريب توزيع الخصم يذهب لأساس آخر سطر — الصافي الكلي مضمون
    baseSum += net - netCheck
    taxBase = baseSum
    tax = taxSum
    total = taxInclusive ? net : net + taxSum
  } else if (taxPercent <= 0) {
    taxBase = net; tax = 0; total = net
  } else if (taxInclusive) {
    ;[taxBase, tax] = splitInclusiveTax(net, taxPercent)
    total = net // الشامل: العميل يدفع الصافي كما هو
  } else {
    taxBase = net
    ;[tax, total] = addExclusiveTax(net, taxPercent)
  }

  return {
    grossMinor: gross,
    discountMinor: lineDiscounts + invoiceDiscount,
    netMinor: net,
    taxBaseMinor: taxBase,
    taxMinor: tax,
    totalMinor: total,
    cogsMinor: cogs,
  }
}

/** فحص توافر المخزون قبل البيع — يعيد أسماء الأصناف الناقصة */
export function checkStock(
  lines: CartLine[],
  stockOf: (itemId: number) => number,
): { itemId: number; nameAr: string; available: number; requested: number }[] {
  const shortages: { itemId: number; nameAr: string; available: number; requested: number }[] = []
  const requested = new Map<number, { nameAr: string; qty: number }>()
  for (const l of lines) {
    const cur = requested.get(l.itemId)
    requested.set(l.itemId, { nameAr: l.nameAr, qty: (cur?.qty ?? 0) + l.qty })
  }
  for (const [itemId, r] of requested) {
    const available = stockOf(itemId)
    if (r.qty > available) shortages.push({ itemId, nameAr: r.nameAr, available, requested: r.qty })
  }
  return shortages
}

/**
 * بناء القيد المحاسبي لفاتورة البيع (القرار 9) — أربعة/خمسة أطراف:
 *   مدين: الخزينة (كاش) أو العملاء (آجل) بالإجمالي
 *   مدين: تكلفة البضاعة المباعة
 *   دائن: المبيعات (الأساس الضريبي)
 *   دائن: ضريبة القيمة المضافة المستحقة (إن وجدت)
 *   دائن: المخزون (بالتكلفة)
 * يتحقق التوازن بنيوياً قبل الإرجاع — UnbalancedEntryError إن اختل.
 */
export interface SalePaymentAllocation { accountCode: string; amountMinor: number; note?: string }

/**
 * ذمم الجزء الآجل من فاتورة البيع حسب نوع الطرف (§91 — بيع لعميل أو مورد أو موظف):
 * عميل ⇒ 1104 ذمم عملاء · مورد ⇒ 2101 يخفض دينه أو يجعله مديناً · موظف ⇒ 1107 جاري الموظفين.
 */
export type SalePartyKind = 'customer' | 'supplier' | 'employee'

export const SALE_PARTY_RECEIVABLE: Record<SalePartyKind, { accountCode: string; noteAr: string }> = {
  customer: { accountCode: '1104', noteAr: 'ذمم عملاء' },
  supplier: { accountCode: '2101', noteAr: 'بيع آجل — حساب المورد' },
  employee: { accountCode: '1107', noteAr: 'بيع آجل — حساب الموظف' },
}

/** حساب ووصف سطر الذمة في القيد — undefined = الافتراضي (1104 عملاء) */
export interface SaleReceivableOptions {
  receivableAccount?: string
  receivableNote?: string
}

/** قيد بيع بتحصيل مختلط بين عدة خزائن/بنوك/ماكينات والباقي ذمم. */
export function buildSaleEntryWithAllocations(totals: CartTotals, allocations: SalePaymentAllocation[], receivable?: SaleReceivableOptions): JournalLine[] {
  if (!allocations.length) return buildSaleEntry(totals, 'credit', '1101', 0, receivable)
  const seen = new Set<string>()
  let paid = 0
  const lines: JournalLine[] = allocations.map((allocation) => {
    if (!allocation.accountCode.trim()) throw new RangeError('حساب وسيلة التحصيل مطلوب')
    if (!Number.isInteger(allocation.amountMinor) || allocation.amountMinor <= 0) throw new RangeError('قيمة وسيلة التحصيل غير صالحة')
    const key = `${allocation.accountCode}:${allocation.note ?? ''}`
    if (seen.has(key)) throw new RangeError('وسيلة التحصيل مكررة')
    seen.add(key); paid += allocation.amountMinor
    return { accountCode: allocation.accountCode, debit: allocation.amountMinor, credit: 0, note: allocation.note ?? 'تحصيل فاتورة' }
  })
  if (paid > totals.totalMinor) throw new RangeError('إجمالي التحصيل أكبر من إجمالي الفاتورة')
  if (paid < totals.totalMinor) lines.push({ accountCode: receivable?.receivableAccount ?? '1104', debit: totals.totalMinor - paid, credit: 0, note: receivable?.receivableNote ?? 'ذمم عملاء' })
  lines.push({ accountCode: '4101', debit: 0, credit: totals.taxBaseMinor, note: 'مبيعات' })
  if (totals.taxMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.taxMinor, note: 'ض.ق.م مستحقة' })
  if (totals.cogsMinor > 0) {
    lines.push({ accountCode: '5101', debit: totals.cogsMinor, credit: 0, note: 'تكلفة مبيعات' })
    lines.push({ accountCode: '1103', debit: 0, credit: totals.cogsMinor, note: 'مخزون' })
  }
  assertBalanced(lines)
  return lines
}

export function buildSaleEntry(
  totals: CartTotals,
  payment: PaymentMethod,
  treasury = '1101',
  paidMinorArg?: number,
  receivable?: SaleReceivableOptions,
): JournalLine[] {
  // الدفع المجزأ (طلب المالك): جزء نقدي في الخزينة المختارة والباقي آجل على العميل —
  // كاش كامل (المدفوع = الإجمالي) أو آجل كامل (المدفوع = 0) حالتان خاصتان من نفس القاعدة
  const paid = paidMinorArg ?? (payment === 'cash' ? totals.totalMinor : 0)
  if (!Number.isInteger(paid) || paid < 0) throw new RangeError('المدفوع نقداً لا يكون سالباً')
  if (paid > totals.totalMinor) throw new RangeError('المدفوع نقداً أكبر من إجمالي الفاتورة')
  const remainder = totals.totalMinor - paid
  const lines: JournalLine[] = []
  if (paid > 0) lines.push({ accountCode: treasury, debit: paid, credit: 0, note: 'نقدية' })
  if (remainder > 0) lines.push({ accountCode: receivable?.receivableAccount ?? '1104', debit: remainder, credit: 0, note: receivable?.receivableNote ?? 'ذمم عملاء' })
  lines.push({ accountCode: '4101', debit: 0, credit: totals.taxBaseMinor, note: 'مبيعات' })
  if (totals.taxMinor > 0) {
    lines.push({ accountCode: '2102', debit: 0, credit: totals.taxMinor, note: 'ض.ق.م مستحقة' })
  }
  if (totals.cogsMinor > 0) {
    lines.push({ accountCode: '5101', debit: totals.cogsMinor, credit: 0, note: 'تكلفة مبيعات' })
    lines.push({ accountCode: '1103', debit: 0, credit: totals.cogsMinor, note: 'مخزون' })
  }
  assertBalanced(lines)
  return lines
}
