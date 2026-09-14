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

  let taxBase: Minor, tax: Minor, total: Minor
  if (taxPercent <= 0) {
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
export function buildSaleEntry(totals: CartTotals, payment: PaymentMethod): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? '1101' : '1104', debit: totals.totalMinor, credit: 0, note: payment === 'cash' ? 'نقدية' : 'ذمم عملاء' },
    { accountCode: '4101', debit: 0, credit: totals.taxBaseMinor, note: 'مبيعات' },
  ]
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
