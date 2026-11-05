import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { A4_STYLES, DEFAULT_RECEIPT_SETTINGS, buildSimpleDocModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'
import { buildModelHtml, printModelWithTemplate } from '../src/ui/print/printDoc.ts'
import { QuickPrintSettings } from '../src/ui/components/QuickPrintSettings.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useAppStore, resolveBranchAppSettings } from '../src/stores/app.store.ts'
const initial = useAppStore.getState()
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
const settings = { ...DEFAULT_RECEIPT_SETTINGS, identityPhone: '010 1234 5678', headerLines: ['العنوان: الرياض', 'الهاتف: 010 1234 5678', '01012345678', 'الرقم الضريبي: 99912345', 'جوال: 0555000022'] }
const model = buildSimpleDocModel({ docTitle: 'فاتورة', invoiceNumber: 'S-1', refCode: '', dateIso: '2026-11-05', partyLabel: 'عميل', paymentLabel: 'نقدي', rows: [], totalMinor: 0, paidMinor: 0, settings })
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useAppStore.setState(initial) })
it('يخفي هاتف هوية المنشأة والترويسة المسماة في كل قوالب الفاتورة ويعيدهما عند تفعيله', () => {
 for (const style of A4_STYLES) for (const paper of ['a4', 'a5'] as const) {
  const options = { ...settings, a4Style: style.id }
  const visible = renderInvoiceA4Html(model, cur, options, paper)
  const hidden = renderInvoiceA4Html(model, cur, { ...options, showShopPhone: false }, paper)
  expect(visible).toContain('010 1234 5678')
  expect(hidden).not.toContain('010 1234 5678')
  expect(hidden).not.toContain('01012345678')
  expect(hidden).not.toContain('0555000022')
  expect(hidden).toContain('العنوان: الرياض')
  expect(hidden).toContain('99912345')
 }
 const hidden = renderReceiptHtml(model, cur, { ...settings, showShopPhone: false })
 expect(hidden).not.toContain('01012345678')
 expect(hidden).not.toContain('0555000022')
 expect(hidden).toContain('99912345')
 for (const template of ['thermal', 'a4', 'a5', 'tax', 'compact', 'delivery'] as const) expect(buildModelHtml(model, cur, { ...settings, showShopPhone: false }, template)).not.toContain('010 1234 5678')
})
it('تغير لوحة المعاينة الخيار وتعيد بناء المستند دون تغيير نموذج الفرع الآخر', () => {
 useAppStore.setState({ receipt: settings })
 printModelWithTemplate(model, cur, settings, 'a4')
 const preview = usePrintPreview.getState().handle!
 expect(preview.html).toContain('010 1234 5678')
 render(<QuickPrintSettings wide />)
 fireEvent.click(screen.getByLabelText('هاتف المنشأة'))
 expect(useAppStore.getState().receipt.showShopPhone).toBe(false)
 expect(preview.rebuild?.()).not.toContain('010 1234 5678')
 fireEvent.click(screen.getByLabelText('هاتف المنشأة'))
 expect(preview.rebuild?.()).toContain('010 1234 5678')
})
it('حل هوية المنشأة يحفظ الهاتف في النموذج ويظهر الافتراضي حتى للخيارات القديمة', () => {
 const state = useAppStore.getState()
 const resolved = resolveBranchAppSettings({ ...state, companySetup: { ...state.companySetup, phone: '01012345678' } }, null)
 expect(resolved.receipt.identityPhone).toBe('01012345678')
 expect(resolved.receipt.headerLines).toContain('الهاتف: 01012345678')
 const legacy = { ...settings, showShopPhone: undefined } as unknown as typeof settings
 expect(renderReceiptHtml(model, cur, legacy)).toContain('010 1234 5678')
})
