import { quotationLineGrossMinor, quotationLineNetMinor, quotationTotals, type QuotationLine } from './contracting.ts'
import { computeTotals, normalizeMovementQty, type CartLine } from './pos.ts'

/** تحويل قيم العرض إلى تمثيل الفاتورة، أو الرفض إن لم يمكن الحفاظ على مبالغ كل بند. */
export function quotationInvoicePrices(lines: readonly QuotationLine[], taxEnabled: boolean, invoiceInclusive: boolean, roundingVersion?: 2): { unitPriceMinor: number; vatPercentOverride: number }[] {
  return lines.map((line) => {
    const vat = line.vatPercent ?? 0
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new Error('نسبة ضريبة العرض غير صالحة')
    if (!taxEnabled && vat > 0) throw new Error('لا يمكن نقل عرض خاضع للضريبة إلى فاتورة ضريبتها معطلة؛ فعّل الضريبة أولاً')
    try { normalizeMovementQty(line.qty) } catch { throw new Error('كمية في العرض لا يمكن نقلها للفاتورة بدقة ثلاث خانات؛ أدخل البند يدوياً') }
    const unit = { ...line, qty: 1 }
    const unitPriceMinor = !!line.taxIncluded === invoiceInclusive ? line.unitPriceMinor
      : invoiceInclusive ? quotationLineGrossMinor(unit) : quotationLineNetMinor(unit)
    const cartLine: CartLine = { itemId: 1, nameAr: line.nameAr, qty: line.qty, unitPriceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, vatPercentOverride: vat }
    const expected = quotationTotals([line])
    const actual = computeTotals([cartLine], 0, taxEnabled ? vat : 0, invoiceInclusive, roundingVersion)
    if (actual.taxBaseMinor !== expected.netMinor || actual.taxMinor !== expected.taxMinor || actual.totalMinor !== expected.grossMinor) {
      throw new Error('لا يمكن نقل أحد بنود العرض بدقة بسبب تقريب السعر والضريبة؛ أدخله يدوياً وراجع الإجمالي')
    }
    return { unitPriceMinor, vatPercentOverride: vat }
  })
}
