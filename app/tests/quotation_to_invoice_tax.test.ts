import { describe, expect, it } from 'vitest'
import { quotationTotals, type QuotationLine } from '../src/core/contracting.ts'
import { quotationInvoicePrices } from '../src/core/quotationToInvoice.ts'
import { computeTotals, type CartLine } from '../src/core/pos.ts'

const line = (price: number, vat: number, included: boolean, qty = 1): QuotationLine => ({ nameAr: 'بند', descriptionAr: 'تفاصيل', qty, unitAr: 'عدد', unitPriceMinor: price, estCostMinor: 0, vatPercent: vat, taxIncluded: included })

describe('نقل ضريبة عرض السعر إلى الفاتورة دون تغيير المبلغ', () => {
  it('أسعار شاملة ومضافة وإعفاء تُنقل إلى فاتورة غير شاملة مع نسبها', () => {
    const lines = [line(10000, 15, false), line(11500, 15, true), line(2000, 0, false)]
    const prices = quotationInvoicePrices(lines, true, false, 2)
    expect(prices).toEqual([{ unitPriceMinor: 10000, vatPercentOverride: 15 }, { unitPriceMinor: 10000, vatPercentOverride: 15 }, { unitPriceMinor: 2000, vatPercentOverride: 0 }])
    const cart: CartLine[] = prices.map((p, i) => ({ ...p, itemId: i + 1, nameAr: 'بند', qty: 1, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }))
    const actual = computeTotals(cart, 0, 15, false, 2)
    const expected = quotationTotals(lines)
    expect([actual.taxBaseMinor, actual.taxMinor, actual.totalMinor]).toEqual([expected.netMinor, expected.taxMinor, expected.grossMinor])
  })
  it('لا يغيّر الإجمالي المدخل للسعر الشامل بسبب تقريب الضريبة', () => {
    for (const vat of [5, 14, 15, 20, 100]) for (let price = 1; price <= 200; price++) {
      const source = line(price, vat, true)
      const expected = quotationTotals([source])
      expect(expected.grossMinor, `سعر ${price} ونسبة ${vat}`).toBe(price)
      expect(expected.netMinor + expected.taxMinor).toBe(price)
      const [converted] = quotationInvoicePrices([source], true, true, 2)
      expect(converted.unitPriceMinor).toBe(price)
    }
  })
  it('يدعم الفاتورة التي أسعارها شاملة عند تعديل فاتورة قديمة', () => {
    expect(quotationInvoicePrices([line(10000, 15, false), line(11500, 15, true)], true, true, 2)).toEqual([{ unitPriceMinor: 11500, vatPercentOverride: 15 }, { unitPriceMinor: 11500, vatPercentOverride: 15 }])
  })
  it('يرفض نقل ضريبة معطلة بدلاً من إسقاطها من الفاتورة', () => {
    expect(() => quotationInvoicePrices([line(10000, 15, false)], false, false, 2)).toThrow(/ضريبتها معطلة/)
    expect(quotationInvoicePrices([line(10000, 0, false)], false, false, 2)).toHaveLength(1)
  })
  it('يرفض فرق التقريب والكمية غير القابلة للتمثيل ولا يغير المبلغ بصمت', () => {
    expect(() => quotationInvoicePrices([line(1, 15, true, 4)], true, false, 2)).toThrow(/تقريب/)
    expect(() => quotationInvoicePrices([line(100, 0, false, 0.1234)], true, false, 2)).toThrow(/كمية/)
  })
})

it('يوثق اختلاف إعادة احتساب عرض شامل قديم لم يحتفظ بإجمالي تاريخي', () => {
  const input = line(4, 15, true)
  const oldNet = Math.round(input.qty * input.unitPriceMinor * 100 / 115)
  const oldTax = Math.round(oldNet * 15 / 100)
  expect({ net: oldNet, tax: oldTax, gross: oldNet + oldTax }).toEqual({ net: 3, tax: 0, gross: 3 })
  expect(quotationTotals([input])).toEqual({ netMinor: 3, taxMinor: 1, grossMinor: 4 })
})
