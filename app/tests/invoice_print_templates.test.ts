import { describe, expect, it } from 'vitest'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS, INVOICE_TEMPLATE_OPTIONS, type ReceiptModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'
import { computeTotals } from '../src/core/pos.ts'
import { applySaleCustomerCharges } from '../src/core/documentCharges.ts'

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
  it('مبالغ على حساب العميل بلا ضريبة تُعرض صراحةً فيُجمع المستند (A4 وحراري)', () => {
    /* حالة فاتورة النقل: أجرة 100 + ضريبة 14 + مصاريف مستقلة 36 على حساب
       العميل ⇒ الأساس + الضريبة = 114، والإجمالي 150 — الفارق يُسمّى. */
    const trip = { ...model, taxBaseMinor: 10000, taxMinor: 1400, totalMinor: 15000, paidMinor: 0, remainingMinor: 15000 }
    for (const html of [renderInvoiceA4Html(trip, cur, DEFAULT_RECEIPT_SETTINGS), renderReceiptHtml(trip, cur, DEFAULT_RECEIPT_SETTINGS)]) {
      expect(html).toContain('مبالغ غير خاضعة للضريبة')
      expect(html).toContain('36.00')
    }
    // مستند متسق لا يُضاف له سطر وهمي
    expect(renderInvoiceA4Html(model, cur, DEFAULT_RECEIPT_SETTINGS)).not.toContain('مبالغ غير خاضعة للضريبة')
  })
  it('الدفع المجزأ يطبع المدفوع والمتبقي، والسداد الكامل لا يطبعهما', () => {
    const partial = renderReceiptHtml({ ...model, paidMinor: 1000, remainingMinor: 1280 }, cur, DEFAULT_RECEIPT_SETTINGS)
    expect(partial).toContain('المتبقي (آجل)')
    expect(renderReceiptHtml(model, cur, DEFAULT_RECEIPT_SETTINGS)).not.toContain('المتبقي (آجل)')
  })
  it('يطبع الرسوم وصافيها الصحيح ويشرح الضريبة المختلطة الشاملة والمضافة', () => {
    const lines = [{ itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1150, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }]
    const charges = [{ kind: 'shipping' as const, nameAr: 'نقل خاضع', amountMinor: 200, taxable: true }, { kind: 'service' as const, nameAr: 'رسم معفى', amountMinor: 100, taxable: false }]
    const totals = applySaleCustomerCharges(computeTotals(lines, 0, 15, true), charges, 15)
    const receipt = buildReceiptModel({ invoiceNumber: 'S-10', dateIso: '2026-10-01', lines, customerCharges: charges, totals, payment: 'credit', paidMinor: 0, customerName: 'عميل', taxPercent: 15, taxInclusive: true, settings: DEFAULT_RECEIPT_SETTINGS })
    expect(receipt).toMatchObject({ grossMinor: 1450, taxBaseMinor: 1300, taxMinor: 180, totalMinor: 1480, taxBaseLabel: 'صافي القيمة قبل الضريبة' })
    expect(receipt.taxLabel).toContain('ضريبة الأصناف مشمولة والرسوم مضافة')
    expect(receipt.rows.map(row => row.nameAr)).toEqual(['خدمة', 'نقل خاضع', 'رسم معفى'])
    for (const html of [renderInvoiceA4Html(receipt, cur, DEFAULT_RECEIPT_SETTINGS), renderReceiptHtml(receipt, cur, DEFAULT_RECEIPT_SETTINGS)]) {
      expect(html).toContain('رسم معفى')
      expect(html).toContain('صافي القيمة قبل الضريبة')
      expect(html).toContain('ضريبة الأصناف مشمولة والرسوم مضافة')
    }
  })

})
