import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { A4_STYLES, DEFAULT_RECEIPT_SETTINGS, buildSimpleDocModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'

const raw = useRawDataStore.getState(), app = useAppStore.getState()
const quote = { id: 7, branchId: 2, quoteNumber: 'QT-7', kind: 'quotation' as const, clientName: 'عميل', clientId: null, titleAr: 'اختبار', date: '2026-11-04', validUntil: '2027-01-01', lines: [{ nameAr: 'خدمة', descriptionAr: 'تفاصيل', qty: 1, unitAr: 'قطعة', unitPriceMinor: 1000, estCostMinor: 0, vatPercent: 0 }], status: 'draft' as const, notes: '', projectId: null, winProbability: 50, bidBondMinor: 0 }
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ setup: { ...app.setup, ownerName: 'المالك الرئيسي', countryCode: 'EG' }, receipt: { ...app.receipt, silentPrint: false, showOperator: true } })
 useRawDataStore.setState({ ...raw, branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 2, appUsers: [{ id: 12, nameAr: 'موظف الفرع', roleId: 'cashier', active: true, pinHash: '', branchId: 2 }], currentUserId: 12, quotations: [quote] })
 useAppStore.getState().setActiveBranchContext({ id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2 })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(raw); useAppStore.getState().setActiveBranchContext(null); if (!app.branchBusinessProfiles[2]) useAppStore.getState().removeBranchBusinessProfile(2); useAppStore.setState({ setup: app.setup, receipt: app.receipt }) })
it('طباعة عرض محفوظ تظهر المستخدم الحالي لا اسم مالك المنشأة', () => {
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة العرض (A4)'))
 const preview = usePrintPreview.getState().handle!
 expect(preview.html).toContain('موظف الفرع')
 expect(preview.html).not.toContain('المالك الرئيسي')
 expect(preview.rebuild?.()).toContain('موظف الفرع')
})
it('معاينة العرض المفتوح تعرض المستخدم نفسه في الشاشة والمطبوعة', () => {
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
 expect(document.querySelector('.invoice-doc-cardbar-session')!.textContent).toContain('موظف الفرع')
 fireEvent.click(screen.getByRole('button', { name: /معاينة/ }))
 expect(usePrintPreview.getState().handle?.html).toContain('موظف الفرع')
})
it('إخفاء المستخدم يعمل في جميع أشكال A4 وA5', () => {
 const model = buildSimpleDocModel({ docTitle: 'عرض سعر', invoiceNumber: 'QT-1', refCode: '', dateIso: '2026-11-04', partyLabel: 'عميل', paymentLabel: '', rows: [], totalMinor: 0, paidMinor: 0, operatorName: 'موظف الفرع', settings: DEFAULT_RECEIPT_SETTINGS })
 const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
 for (const style of A4_STYLES) for (const paper of ['a4', 'a5'] as const) {
  const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style: style.id, showOperator: false }, paper)
  expect(html).not.toContain('موظف الفرع')
  expect(html).not.toContain('طبع بواسطة')
  expect(html).toContain('QT-1')
 }
})
it('عند تعذر العثور على المستخدم لا ينسب الطبعة خطأً للمالك', () => {
 useRawDataStore.setState({ currentUserId: 999 })
 useAppStore.getState().setActiveBranchContext(null)
 useRawDataStore.setState({ branches: [] })
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة العرض (A4)'))
 expect(usePrintPreview.getState().handle?.html).toContain('مستخدم غير معروف')
 expect(usePrintPreview.getState().handle?.html).not.toContain('المالك الرئيسي')
})
it('جلسة المالك القديمة بلا هوية مستخدم تظهر اسم المالك', () => {
 useRawDataStore.setState({ currentUserId: null, branches: [], activeBranchId: null })
 useAppStore.getState().setActiveBranchContext(null)
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة العرض (A4)'))
 expect(usePrintPreview.getState().handle?.html).toContain('المالك الرئيسي')
})

it('نسخة PDF للعرض المحفوظ تستخدم المستخدم الحالي أيضاً', () => {
 const bridge = vi.fn().mockResolvedValue({ ok: true, copied: false })
 const context = globalThis as typeof globalThis & { shopsysPdfShare?: typeof bridge }
 const original = context.shopsysPdfShare
 context.shopsysPdfShare = bridge
 try {
  render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('إرسال PDF واتساب'))
  expect(bridge).toHaveBeenCalledTimes(1)
  expect(bridge.mock.calls[0][0]).toContain('موظف الفرع')
  expect(bridge.mock.calls[0][0]).not.toContain('المالك الرئيسي')
 } finally { context.shopsysPdfShare = original }
})
it('معاينة عرض الفرع المحفوظ تعيد بناء النمط المختار من إعدادات الفرع نفسه', () => {
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة العرض (A4)'))
 const preview = usePrintPreview.getState().handle!
 useAppStore.getState().updateReceipt({ a4Style: 'project' })
 const rebuilt = preview.rebuild?.() ?? ''
 expect(rebuilt).toContain('sheet project')
 expect(rebuilt).toContain('موظف الفرع')
 expect(rebuilt).toContain('QT-7')
})
