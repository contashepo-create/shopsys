import { expect, it } from 'vitest'
import { A4_STYLES, DEFAULT_RECEIPT_SETTINGS, buildSimpleDocModel, type A4Style } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
const model = buildSimpleDocModel({ docTitle: 'عرض سعر', invoiceNumber: 'QT-21', refCode: 'REF', dateIso: '2026-11-04', partyLabel: 'عميل اختبار', paymentLabel: 'ساري', rows: [{ nameAr: 'بند & وصف', qty: 2, unitPriceMinor: 1000, totalMinor: 2000, notes: 'ملاحظة اختبار' }], totalMinor: 2280, paidMinor: 2280, operatorName: 'موظف الفرع', settings: DEFAULT_RECEIPT_SETTINGS, extraFooter: 'شروط العرض', tax: { label: 'الضريبة', minor: 280, baseMinor: 2000 } })
const extra = ['ledger', 'split', 'letter', 'register', 'project'] as A4Style[]
it('يوفر خمسة تخطيطات إضافية متميزة للفواتير وعروض الأسعار', () => {
 expect(A4_STYLES.map(x => x.id)).toEqual(expect.arrayContaining(extra))
 const bodies = extra.map(style => renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style: style }).split('</style>')[1])
 expect(new Set(bodies).size).toBe(5)
 for (let index = 0; index < extra.length; index++) {
  for (const paper of ['a4', 'a5'] as const) {
   const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style: extra[index] }, paper)
   for (const text of ['عرض سعر', 'QT-21', 'عميل اختبار', 'موظف الفرع', 'بند &amp; وصف', 'ملاحظة اختبار', 'الضريبة', '22.80', 'شروط العرض']) expect(html, `${extra[index]} ${paper}`).toContain(text)
  }
 }
})
it('تحترم التخطيطات الجديدة إخفاء الأسعار واسم المستخدم', () => {
 for (const a4Style of extra) {
  const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style, hidePrices: true, showOperator: false })
  expect(html, a4Style).not.toContain('سعر الوحدة')
  expect(html, a4Style).not.toContain('22.80')
  expect(html, a4Style).not.toContain('موظف الفرع')
  expect(html, a4Style).toContain('بند &amp; وصف')
 }
})
