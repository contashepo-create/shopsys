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
   * البيع بوحدة أكبر (صيدلية: شريط/علبة — جولة الصيدلية):
   * qty بالوحدة المختارة، unitPriceMinor/unitCostMinor سعر وتكلفة الوحدة المختارة،
   * وunitFactor = كم وحدة أساسية فيها — خصم المخزون = qty × unitFactor.
   */
  unitFactor?: number
  unitLabel?: string
}

/** كمية السطر بالوحدة الأساسية (للمخزون/الدفعات) — qty × unitFactor */
export function baseQty(l: { qty: number; unitFactor?: number }): number {
  return Math.round(l.qty * (l.unitFactor ?? 1) * 1000) / 1000
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
  let cogs = 0
  for (const l of lines) {
    if (l.qty <= 0) throw new RangeError(`كمية غير صالحة للصنف ${l.nameAr}`)
    if (l.discountPercent < 0 || l.discountPercent > 100) throw new RangeError('خصم سطر خارج النطاق')
    const g = mulQty(l.unitPriceMinor, l.qty)
    gross += g
    lineDiscounts += percentOf(g, l.discountPercent)
    cogs += mulQty(l.unitCostMinor, l.qty)
  }
  if (invoiceDiscountPercent < 0 || invoiceDiscountPercent > 100) throw new RangeError('خصم فاتورة خارج النطاق')
  const afterLineDiscounts = gross - lineDiscounts
  const invoiceDiscount = percentOf(afterLineDiscounts, invoiceDiscountPercent)
  const net = afterLineDiscounts - invoiceDiscount

  // ═══ ضريبة لكل سطر (طلب المالك: نسبة خاصة لصنف أو إعفاؤه) ═══
  // لو أي سطر له تجاوز، نحسب الضريبة سطراً سطراً بنسبته الفعلية،
  // مع توزيع خصم الفاتورة نسبياً على السطور حتى لا يختل الأساس الضريبي.
  const hasOverrides = lines.some((l) => l.vatPercentOverride !== undefined)
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
      if (p <= 0) { baseSum += lineNet; continue }
      if (taxInclusive) {
        const [b, t] = splitInclusiveTax(lineNet, p)
        baseSum += b; taxSum += t
      } else {
        const [t] = addExclusiveTax(lineNet, p)
        baseSum += lineNet; taxSum += t
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
export function buildSaleEntry(
  totals: CartTotals,
  payment: PaymentMethod,
  treasury = '1101',
  paidMinorArg?: number,
): JournalLine[] {
  // الدفع المجزأ (طلب المالك): جزء نقدي في الخزينة المختارة والباقي آجل على العميل —
  // كاش كامل (المدفوع = الإجمالي) أو آجل كامل (المدفوع = 0) حالتان خاصتان من نفس القاعدة
  const paid = paidMinorArg ?? (payment === 'cash' ? totals.totalMinor : 0)
  if (!Number.isInteger(paid) || paid < 0) throw new RangeError('المدفوع نقداً لا يكون سالباً')
  if (paid > totals.totalMinor) throw new RangeError('المدفوع نقداً أكبر من إجمالي الفاتورة')
  const remainder = totals.totalMinor - paid
  const lines: JournalLine[] = []
  if (paid > 0) lines.push({ accountCode: treasury, debit: paid, credit: 0, note: 'نقدية' })
  if (remainder > 0) lines.push({ accountCode: '1104', debit: remainder, credit: 0, note: 'ذمم عملاء' })
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
