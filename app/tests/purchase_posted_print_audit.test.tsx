import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useToast } from '../src/ui/components/ui.tsx'
import { AdvancedPurchaseInvoicePage } from '../src/ui/pages/AdvancedPurchaseInvoicePage.tsx'
const lock = vi.hoisted(() => ({ failAfter: false, before: null as null | (() => void), after: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { lock.before?.(); const result = commit(); lock.after?.(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
const data = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], receipt: { ...app.receipt, silentPrint: false, printAfterSave: true, cashierPrint: false } })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ id: 7, nameAr: 'مورد الاختبار', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'POST'), id: 1, nameAr: 'صنف الاختبار', costMinor: 3000, priceMinor: 5000, stockQty: 30 }], purchases: [], purchaseOrders: [], journal: [], warehouses: [], batches: [], serials: [] })
 lock.failAfter = false; lock.before = null; lock.after = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(data); useAppStore.setState(app) })
function post() {
 const order = useRawDataStore.getState().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد الاختبار', date: '2026-01-01', expectedDate: '2026-01-02', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'صنف الاختبار', qty: 2, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 3000, vatPercent: 0, notes: '' }] })
 render(<MemoryRouter initialEntries={[`/purchases/invoices/new?po=${order.id}`]}><AdvancedPurchaseInvoicePage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
}
it('الطباعة بعد الحفظ تستخدم الفاتورة المسجلة ورقمها ومرجعها لا المسودة', async () => {
 post(); await waitFor(() => expect(usePrintPreview.getState().open).toBe(true))
 const invoice = useRawDataStore.getState().purchases[0], html = usePrintPreview.getState().handle!.html
 expect(html).toContain(invoice.invoiceNumber); expect(html).toContain(invoice.refCode)
 expect(html).toContain('صنف الاختبار'); expect(html).toContain('60.00')
 expect(html).not.toContain('مسودة فاتورة شراء')
})
it('فشل تأكيد الحفظ بعد الترحيل لا يطبع فاتورة يُظن أنها حُفظت', async () => {
 lock.failAfter = true; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('تعذّر تأكيد اكتمال الحفظ'))
 expect(useRawDataStore.getState().purchases).toHaveLength(1)
 expect(usePrintPreview.getState().open).toBe(false)
})

it('تغيير الفرع قبل دخول القفل يرفض الترحيل بلا مستند', async () => {
 lock.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('تغير المستخدم أو الفرع'))
 expect(useRawDataStore.getState().purchases).toHaveLength(0)
 expect(usePrintPreview.getState().open).toBe(false)
})
it('تغيير الفرع بعد التسجيل يمنع فتح الطبعة بسياق مختلف', async () => {
 lock.after = () => { useRawDataStore.setState({ activeBranchId: 2 }) }; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('لم تُفتح طباعتها'))
 expect(useRawDataStore.getState().purchases).toHaveLength(1)
 expect(usePrintPreview.getState().open).toBe(false)
})
