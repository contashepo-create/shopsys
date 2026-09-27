import { describe, expect, it } from 'vitest'
import { DEFAULT_RECEIPT_SETTINGS, INVOICE_TEMPLATE_OPTIONS, type ReceiptModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'

const model: ReceiptModel = {
  shopName: 'متجر الاختبار', headerLines: [], docTitle: 'إذن تسليم', operatorName: 'المحاسب أحمد', invoiceNumber: 'S-1', refCode: 'SAL-X',
  dateLabel: '2026-09-23', customerName: 'عميل', paymentLabel: 'نقدي',
  rows: [{ nameAr: 'صنف', qtyLabel: '2', unitPriceMinor: 1000, totalMinor: 2000, discountPercent: 0, vatPercent: 14, serials: [] }],
  itemCount: 1, totalQty: 2, grossMinor: 2000, discountMinor: 0, taxBaseMinor: 2000, taxMinor: 280,
  taxLabel: 'ضريبة 14٪', totalMinor: 2280, paidMinor: 2280, remainingMinor: 0, footerText: '',
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
  it('تظهر هوية القائم بالطباعة في القالب العادي والحراري', () => {
    expect(renderInvoiceA4Html(model, cur, DEFAULT_RECEIPT_SETTINGS)).toContain('المحاسب أحمد')
    expect(renderReceiptHtml(model, cur, DEFAULT_RECEIPT_SETTINGS)).toContain('طبع بواسطة: المحاسب أحمد')
  })
  it('مفتاح إعدادات الطباعة الحرارية يخفي اسم القائم بالطباعة ويبقي باقي الفاتورة', () => {
    const hidden = renderReceiptHtml(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, showOperator: false })
    expect(hidden).not.toContain('طبع بواسطة')
    expect(hidden).toContain('S-1')
    expect(hidden).toContain('الإجمالي المستحق')
  })
  it('الإيصال الحراري المعاد تصميمه يحمل كل بيانات المستند', () => {
    const html = renderReceiptHtml(model, cur, DEFAULT_RECEIPT_SETTINGS)
    expect(html).toContain('إذن تسليم') // شريط عنوان المستند
    expect(html).toContain('رقم الفاتورة')
    expect(html).toContain('مرجع التتبع')
    expect(html).toContain('التاريخ والوقت')
    expect(html).toContain('العميل')
    expect(html).toContain('طريقة الدفع')
    expect(html).toContain('عدد الأصناف / القطع')
    expect(html).toContain('الأساس الخاضع للضريبة')
    expect(html).toContain('المبلغ كتابةً')
    expect(html).toContain('تمت الطباعة')
    expect(html).toContain('<svg') // باركود رقم الفاتورة
  })
  it('الدفع المجزأ يطبع المدفوع والمتبقي، والسداد الكامل لا يطبعهما', () => {
    const partial = renderReceiptHtml({ ...model, paidMinor: 1000, remainingMinor: 1280 }, cur, DEFAULT_RECEIPT_SETTINGS)
    expect(partial).toContain('المتبقي (آجل)')
    expect(renderReceiptHtml(model, cur, DEFAULT_RECEIPT_SETTINGS)).not.toContain('المتبقي (آجل)')
  })
})
