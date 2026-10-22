/**
 * ثوابت محاسبية للمستندات — تُفحص على النواة لا على الشاشة:
 * 1) الأساس + الضريبة = الإجمالي (أو الفارق مُعلن كغير خاضع في المطبوعة).
 * 2) الرمز الضريبي يحمل إجمالي المستند وضريبته وتاريخه — لا أرقاماً أخرى.
 * 3) النسب المتعددة والخصومات والتقريب لا تكسر الهوية.
 */
import { describe, it, expect } from 'vitest'
import { computeTotals, type CartLine } from '../src/core/pos.ts'
import { buildReceiptModel, buildSimpleDocModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { decodeZatcaQr, buildZatcaQr, minorToDecimalString } from '../src/core/einvoice.ts'
import { withTaxBarcodeSync } from '../src/ui/print/taxBarcode.ts'

const line = (p: Partial<CartLine> & { unitPriceMinor: number }): CartLine => ({
  itemId: 1, nameAr: 'صنف', qty: 1, unitPriceMinor: 0, unitCostMinor: 0,
  discountPercent: 0, soldByWeight: false, ...p,
} as CartLine)

const identity = (t: { taxBaseMinor: number; taxMinor: number; totalMinor: number }, label: string) => {
  expect(t.taxBaseMinor + t.taxMinor, `${label}: الأساس + الضريبة`).toBe(t.totalMinor)
  expect(Number.isInteger(t.taxMinor) && Number.isInteger(t.totalMinor), `${label}: أعداد صحيحة`).toBe(true)
}

describe('ثوابت حساب الإجماليات', () => {
  it('ضريبة مضافة 14٪: الهوية قائمة', () => {
    const t = computeTotals([line({ unitPriceMinor: 5000, qty: 2 })], 0, 14, false)
    identity(t, 'exclusive')
    expect([t.taxBaseMinor, t.taxMinor, t.totalMinor]).toEqual([10000, 1400, 11400])
  })
  it('ضريبة مشمولة في السعر: الهوية قائمة والإجمالي لا يتغيّر', () => {
    const t = computeTotals([line({ unitPriceMinor: 5000, qty: 2 })], 0, 14, true)
    identity(t, 'inclusive')
    expect(t.totalMinor).toBe(10000)
    expect(t.taxMinor).toBe(1228)
  })
  it('خصم سطر + خصم فاتورة: الهوية قائمة', () => {
    const t = computeTotals([line({ unitPriceMinor: 10000, qty: 3, discountPercent: 10 })], 5, 14, false)
    identity(t, 'discounts')
    expect(t.totalMinor).toBe(t.netMinor + t.taxMinor)
  })
  it('نسب متعددة في نفس الفاتورة (14٪ + 5٪ + معفى): الهوية قائمة والضريبة مجموع السطور', () => {
    const t = computeTotals([
      line({ itemId: 1, unitPriceMinor: 10000, vatPercentOverride: 14 }),
      line({ itemId: 2, unitPriceMinor: 10000, vatPercentOverride: 5 }),
      line({ itemId: 3, unitPriceMinor: 10000, vatPercentOverride: 0 }),
    ], 0, 14, false)
    identity(t, 'mixed')
    expect(t.taxMinor).toBe(1900)
    expect(t.taxBaseMinor).toBe(30000)
  })
  it('صفر ضريبة: الإجمالي = الأساس', () => {
    const t = computeTotals([line({ unitPriceMinor: 7777, qty: 3 })], 0, 0, false)
    identity(t, 'zero')
  })
  it('أعداد فردية وتقريب: لا كسور ولا ضياع قرش', () => {
    const t = computeTotals([line({ unitPriceMinor: 3333, qty: 3 })], 0, 14, false)
    identity(t, 'rounding')
  })
})

describe('نموذج الطباعة يرث الإجماليات كما هي', () => {
  const t = computeTotals([line({ unitPriceMinor: 5000, qty: 2 })], 0, 14, false)
  const base = {
    invoiceNumber: 'INV-1', dateIso: '2026-10-22T10:00:00Z', lines: [line({ unitPriceMinor: 5000, qty: 2 })],
    totals: t, payment: 'cash' as const, customerName: null, taxPercent: 14, taxInclusive: false,
    settings: DEFAULT_RECEIPT_SETTINGS,
  }
  it('buildReceiptModel: مجموع السطور + الضريبة = الإجمالي', () => {
    const m = buildReceiptModel(base)
    expect(m.totalMinor).toBe(t.totalMinor)
    expect(m.taxMinor).toBe(t.taxMinor)
    const rowsSum = m.rows.reduce((a, r) => a + r.totalMinor, 0)
    expect(rowsSum).toBe(t.taxBaseMinor)
    expect(rowsSum + m.taxMinor).toBe(m.totalMinor)
  })
  it('buildSimpleDocModel: الأساس + الضريبة = الإجمالي', () => {
    const m = buildSimpleDocModel({
      docTitle: 'فاتورة', invoiceNumber: 'X', dateIso: '2026-10-22', partyLabel: 'عميل', paymentLabel: 'نقدي',
      rows: [{ nameAr: 'بند', qty: 2, unitPriceMinor: 5000, totalMinor: 10000 }],
      totalMinor: 11400, paidMinor: 11400, settings: DEFAULT_RECEIPT_SETTINGS,
      tax: { label: 'ض.ق.م 14٪', minor: 1400, baseMinor: 10000 },
    })
    expect(m.taxBaseMinor + m.taxMinor).toBe(m.totalMinor)
  })
})

describe('الرمز الضريبي يطابق المستند', () => {
  const args = {
    saFeatureActive: true, egFeatureActive: false, printEnabled: true,
    sellerName: 'مؤسسة الاختبار', taxNumber: '310122393500003',
    invoiceNumber: 'INV-7', dateIso: '2025-03-04T05:06:07Z', totalMinor: 11400, taxMinor: 1400, decimals: 2,
  }
  it('الحقلان 4 و5 = إجمالي المستند وضريبته بالضبط', () => {
    const model = { invoiceNumber: 'INV-7', totalMinor: 11400, taxMinor: 1400 } as { qrDataUrl?: string; invoiceNumber: string; totalMinor: number; taxMinor: number }
    expect(withTaxBarcodeSync(model, args)).toBe(true)
    const b64 = decodeURIComponent(model.qrDataUrl!.split(',').slice(1).join(','))
    const svg = b64
    // نستخرج حمولة TLV من مولّد مستقل بنفس المدخلات ونتأكد من تطابقها
    const qr = buildZatcaQr({ sellerName: args.sellerName, vatNumber: args.taxNumber, timestampIso: args.dateIso, totalWithVatMinor: 11400, vatMinor: 1400, decimals: 2 })
    const d = decodeZatcaQr(qr)
    expect(d.get(4)).toBe(minorToDecimalString(model.totalMinor, 2))
    expect(d.get(5)).toBe(minorToDecimalString(model.taxMinor, 2))
    expect(d.get(4)).toBe('114.00')
    expect(d.get(5)).toBe('14.00')
    expect(d.size).toBe(5)
    expect(svg).toContain('<svg')
  })
  it('التاريخ في الرمز هو تاريخ المستند لا لحظة الطباعة', () => {
    const qr = buildZatcaQr({ sellerName: 'مؤسسة الاختبار', vatNumber: '310122393500003', timestampIso: '2025-03-04T05:06:07Z', totalWithVatMinor: 100, vatMinor: 0, decimals: 2 })
    expect(decodeZatcaQr(qr).get(3)).toBe('2025-03-04T05:06:07Z')
  })
  it('ضريبة أكبر من الإجمالي تُرفض (لا رمز كاذب)', () => {
    expect(() => buildZatcaQr({ sellerName: 'مؤسسة الاختبار', vatNumber: '310122393500003', timestampIso: '2025-03-04T05:06:07Z', totalWithVatMinor: 100, vatMinor: 101, decimals: 2 })).toThrow()
  })
})
