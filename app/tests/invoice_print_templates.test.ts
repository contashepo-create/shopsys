import { describe, expect, it } from 'vitest'
import { DEFAULT_RECEIPT_SETTINGS, INVOICE_TEMPLATE_OPTIONS, type ReceiptModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'

const model: ReceiptModel = {
  shopName: 'متجر الاختبار', headerLines: [], docTitle: 'إذن تسليم', invoiceNumber: 'S-1', refCode: 'SAL-X',
  dateLabel: '2026-09-23', customerName: 'عميل', paymentLabel: 'نقدي',
  rows: [{ nameAr: 'صنف', qtyLabel: '2', unitPriceMinor: 1000, totalMinor: 2000, discountPercent: 0, vatPercent: 14, serials: [] }],
  itemCount: 1, totalQty: 2, grossMinor: 2000, discountMinor: 0, taxBaseMinor: 2000, taxMinor: 280,
  taxLabel: 'ضريبة 14٪', totalMinor: 2280, paidMinor: 2280, remainingMinor: 0,
}
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: 'جنيه' }

describe('قوالب طباعة الفواتير المتقدمة', () => {
  it('تعرض القوالب الضريبي والمختصر وإذن التسليم', () => {
    expect(INVOICE_TEMPLATE_OPTIONS.map((x) => x.id)).toEqual(expect.arrayContaining(['tax', 'compact', 'delivery']))
  })
  it('إذن التسليم يحجب الأسعار والإجماليات ويبقي الكميات', () => {
    const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, hidePrices: true, showWords: false }, 'a4')
    expect(html).toContain('الكمية')
    expect(html).not.toContain('سعر الوحدة')
    expect(html).not.toContain('الإجمالي المستحق')
    expect(html).not.toContain('22.80')
  })
})
