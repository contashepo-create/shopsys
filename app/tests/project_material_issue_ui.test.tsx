import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mock = vi.hoisted(() => ({ changeBefore: false, failAfter: false, wait: null as null | Promise<void> }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (mock.wait) await mock.wait
 if (mock.changeBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); useRawDataStore.setState(s => ({ items: s.items.map(item => ({ ...item, stockQty: 1 })) })) }
 const result = commit(); if (mock.failAfter) throw new Error('flush failed'); return result
} }))
import { MaterialIssuesPage } from '../src/ui/pages/ProjectOpsPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }], items: [{ id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 33, stockValueMinor: 100, stockQty: 3, priceMinor: 200, minQty: 0, isActive: true }], projects: [{ id: 1, code: 'P1', nameAr: 'مشروع', clientName: 'عميل', clientId: null, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', status: 'active', notes: '' }], employees: [{ id: 10, nameAr: 'الصارف', active: true }, { id: 11, nameAr: 'المستلم', active: true }], transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [], journal: [], projectCosts: [], materialRequisitions: [], stockMoves: [], approvalFlows: [], approvalRequests: [] } as never)
 mock.changeBefore = false; mock.failAfter = false; mock.wait = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><MaterialIssuesPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /إذن صرف$/ }))
 const date = screen.getByLabelText('تاريخ صرف المواد') as HTMLInputElement
 expect([date.value, date.min, date.max]).toEqual([todayLocalIso(), todayLocalIso(), todayLocalIso()])
 const dialog = date.closest('[role="dialog"]') as HTMLElement
 const selects = within(dialog).getAllByRole('combobox')
 fireEvent.change(selects[0], { target: { value: '1' } }); fireEvent.change(selects[1], { target: { value: '10' } }); fireEvent.change(selects[2], { target: { value: '11' } }); fireEvent.change(selects[3], { target: { value: '5' } })
 return { date, dialog, button: within(dialog).getByRole('button', { name: /صرف المواد/ }) }
}
it('يرحّل مرة واحدة بتاريخ اليوم وقيد مطابق', async () => {
 const { button } = open(); fireEvent.click(button); fireEvent.click(button)
 await waitFor(() => expect(S().materialRequisitions).toHaveLength(1))
 expect(S().journal[0].date).toBe(todayLocalIso()); expect(S().projectCosts[0].amountMinor).toBe(33); expect(S().items[0].stockValueMinor).toBe(67)
})
it('يرفض تغيّر الرصيد ويغلق النافذة مع التحذير إن تعذر تأكيد الحفظ', async () => {
 let { button } = open(); mock.changeBefore = true; fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تغير نموذج الإذن/)).toBeTruthy()); expect(S().materialRequisitions).toHaveLength(0)
 cleanup(); useRawDataStore.setState({ items: S().items.map(i => ({ ...i, stockQty: 3 })) }); mock.changeBefore = false; mock.failAfter = true
 button = open().button; fireEvent.click(button); await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy())
 expect(S().materialRequisitions).toHaveLength(1); expect(screen.queryByLabelText('تاريخ صرف المواد')).toBeNull()
})
it('يرفض تغيير النموذج أثناء انتظار القفل', async () => {
 let release!: () => void; mock.wait = new Promise<void>(resolve => { release = resolve })
 const { dialog, button } = open(); fireEvent.click(button)
 fireEvent.change(within(dialog).getByPlaceholderText(/صبّة القواعد/), { target: { value: 'تعديل' } })
 await act(async () => { release(); await mock.wait })
 await waitFor(() => expect(screen.getByText(/تغير نموذج الإذن/)).toBeTruthy()); expect(S().materialRequisitions).toHaveLength(0)
})
it('لا يسقط سطر كمية صفر بصمت', async () => {
 const { dialog, button } = open(); fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '0' } }); fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/كمية.*موجبة/)).toBeTruthy()); expect(S().materialRequisitions).toHaveLength(0)
})
