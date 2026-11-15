import { expect, it } from 'vitest'
import { renderExtractHtml, renderExtractClientInvoiceHtml } from '../src/ui/print/printExtract.ts'
const args = { shopName: 'المقاول', extractNumber: 'PRX-2', dateIso: '2026-11-07', projectName: 'فيلا', projectCode: 'P1', clientName: 'المالك', contractValue: '1000', description: '', previousGross: '200', currentGross: '656', cumulativeGross: '856', progressPercent: 85.6, vat: '0', retention: '0', retentionPercent: 0, advanceRecovery: '100', due: '556', payment: 'credit' as const, currencySymbol: 'ر.س' }
const line = { code: '1', descriptionAr: '<دهانات>', prevPercent: 20, newPercent: 85.6, currentSlicePercent: 65.6, value: '656', unit: 'م2', boqQty: 1000, unitPrice: '1 ر.س', previousQty: 200, currentQty: 656, cumulativeQty: 856, remainingQty: 144, previousQtyEstimated: false }
it('المستخلص وفاتورة العميل يطبعان حصر الكميات بعناوين منفصلة وبلا حقن HTML', () => {
 for (const html of [renderExtractHtml({ ...args, lines: [line], isFinal: true }), renderExtractClientInvoiceHtml({ ...args, lines: [line], isFinal: true })]) {
  expect(html).toContain('حصر كميات الأعمال')
  expect(html).toContain('كمية العقد')
  expect(html).toContain('الكمية السابقة')
  expect(html).toContain('كمية المستخلص')
  expect(html).toContain('الكمية التراكمية')
  expect(html).toContain('الكمية المتبقية')
  for (const n of ['200', '656', '856', '144', '556']) expect(html).toContain(n)
  expect(html).toContain('&lt;دهانات&gt;')
  expect(html).not.toContain('<دهانات>')
  expect(html).toContain('مستخلص ختامي')
  expect(html).toContain('table-header-group')
 }
})
it('لا يدعي كميات لبند قديم محفوظ بالنسبة فقط', () => {
 const html = renderExtractHtml({ ...args, lines: [{ code: '1', descriptionAr: 'قديم', prevPercent: 0, newPercent: 20, value: '200' }] })
 expect(html).not.toContain('حصر كميات الأعمال')
})
