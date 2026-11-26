import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WindowHostContext, type WindowHostApi } from '../src/ui/windows/windowHostContext.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'
import { AdvancedPurchaseInvoicePage } from '../src/ui/pages/AdvancedPurchaseInvoicePage.tsx'
const lock = vi.hoisted(() => ({ resume: null as null | (() => void), failure: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); await new Promise<void>(resolve => { lock.resume = resolve }); if (lock.failure) throw new Error('تعذر الكتابة'); return result } }))
const data = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
let host: WindowHostApi
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], receipt: { ...app.receipt, printAfterSave: false } })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'CONFIRM'), id: 1, nameAr: 'سلعة', costMinor: 3000, priceMinor: 5000, stockQty: 30 }], purchases: [], purchaseOrders: [], journal: [], warehouses: [], batches: [], serials: [] })
 lock.failure = false; lock.resume = null; useToast.setState({ msg: null, kind: 'success' })
 host = { windowId: 'purchase-test', props: {}, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() }
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })
function open() {
 const order = S().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد', date: '2026-01-01', expectedDate: '2026-01-02', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'سلعة', qty: 2, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 3000, vatPercent: 0, notes: '' }] })
 host.props = { prefill: { purchaseOrderId: order.id } }
 render(<MemoryRouter><WindowHostContext.Provider value={host}><AdvancedPurchaseInvoicePage /></WindowHostContext.Provider></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
}
it('لا يعرض نجاحاً نهائياً قبل تأكيد الكتابة، ثم يغلق نافذة الشراء بعد التأكيد', async () => {
 open()
 expect(S().purchases).toHaveLength(1)
 expect(host.close).not.toHaveBeenCalled()
 expect(useToast.getState().msg ?? '').not.toContain('تم ترحيل')
 expect(screen.getByRole('button', { name: /جارٍ الترحيل/ }).hasAttribute('disabled')).toBe(true)
 await act(async () => { lock.resume?.() })
 await waitFor(() => expect(host.close).toHaveBeenCalledOnce())
 expect(useToast.getState().msg).toContain('تم ترحيل')
 expect(S().purchases).toHaveLength(1)
})
it('فشل تأكيد الكتابة يبقي المستند مفتوحاً ويبين أن الفاتورة سجلت محلياً', async () => {
 lock.failure = true; open()
 await act(async () => { lock.resume?.() })
 await waitFor(() => expect(useToast.getState().msg).toContain('تعذّر تأكيد اكتمال الحفظ'))
 expect(host.close).not.toHaveBeenCalled()
 expect(S().purchases).toHaveLength(1)
})
