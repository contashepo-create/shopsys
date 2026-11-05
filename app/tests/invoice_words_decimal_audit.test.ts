import { expect, it } from 'vitest'
import { amountInWords } from '../src/ui/print/printInvoiceA4.ts'
const currency = (decimals: 0 | 2 | 3) => ({ code: decimals === 3 ? 'KWD' : 'EGP', symbol: '', name: decimals === 3 ? 'دينار' : 'جنيه', decimals })
it('تفقيط كسور عملة بثلاث خانات يذكر أجزاء الألف لا أجزاء المائة', () => {
 expect(amountInWords(1001, currency(3))).toBe('واحد دينار وواحد من الألف فقط لا غير')
 expect(amountInWords(1999, currency(3))).toBe('واحد دينار وتسعمائة وتسعة وتسعون من الألف فقط لا غير')
})
it('يحافظ على صيغة أجزاء المائة ولا يختلق كسراً لعملة صحيحة', () => {
 expect(amountInWords(101, currency(2))).toBe('واحد جنيه وواحد من المائة فقط لا غير')
 expect(amountInWords(12, currency(0))).toBe('اثنا عشر جنيه فقط لا غير')
})
it('لا يفقد إشارة السالب أو المراتب الكبيرة ضمن النطاق الآمن', () => {
 expect(amountInWords(-101, currency(2))).toBe('سالب واحد جنيه وواحد من المائة فقط لا غير')
 expect(amountInWords(1_000_000_000_000, currency(0))).toBe('تريليون جنيه فقط لا غير')
 expect(amountInWords(2_000_000_000_000_000, currency(0))).toBe('كوادريليونان جنيه فقط لا غير')
})

it('تظهر أجزاء الألف في كل قوالب A4 وA5 وفي الطباعة الحرارية', async () => {
 const { A4_STYLES, DEFAULT_RECEIPT_SETTINGS, buildSimpleDocModel } = await import('../src/core/receipt.ts')
 const { renderInvoiceA4Html } = await import('../src/ui/print/printInvoiceA4.ts')
 const { renderReceiptHtml } = await import('../src/ui/print/printReceipt.ts')
 const cur = currency(3)
 const model = buildSimpleDocModel({ docTitle: 'فاتورة', invoiceNumber: 'X', refCode: 'X', dateIso: '2026-11-04', partyLabel: 'عميل', paymentLabel: 'نقدي', rows: [{ nameAr: 'بند', qty: 1, unitPriceMinor: 1001, totalMinor: 1001 }], totalMinor: 1001, paidMinor: 1001, operatorName: 'موظف', settings: DEFAULT_RECEIPT_SETTINGS })
 const expected = 'واحد دينار وواحد من الألف فقط لا غير'
 for (const style of A4_STYLES) for (const paper of ['a4', 'a5'] as const) {
  const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, showWords: true, a4Style: style.id }, paper)
  expect(html, `${style.id} ${paper}`).toContain(expected)
 }
 expect(renderReceiptHtml(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, showWords: true })).toContain(expected)
})
