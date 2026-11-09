import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ changeBefore: false, failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (lock.changeBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); useRawDataStore.setState(s => ({ items: s.items.map(i => ({ ...i, stockQty: 1 })) })) }
 const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result
} }))
import { TransfersPage } from '../src/ui/pages/TransfersPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }], items: [{ id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockValueMinor: 1000, stockQty: 10, priceMinor: 200, minQty: 0, isActive: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [] })
 lock.changeBefore = false; lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><TransfersPage /><ToastHost /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /تحويل جديد/ }))
 const date = screen.getByLabelText('تاريخ التحويل المخزني') as HTMLInputElement
 expect([date.value, date.min, date.max]).toEqual([todayLocalIso(), todayLocalIso(), todayLocalIso()])
 const dialog = date.closest('[role="dialog"]') as HTMLElement
 const selects = within(dialog).getAllByRole('combobox'); fireEvent.change(selects[1], { target: { value: '2' } }); fireEvent.change(selects[2], { target: { value: '5' } })
 return within(dialog).getByRole('button', { name: /ترحيل التحويل/ })
}
it('يرحل تحويل اليوم مرة واحدة دون قيد', async () => {
 const button = open(); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(S().transfers).toHaveLength(1)); expect(S().transfers[0].date.slice(0, 10)).toBe(todayLocalIso()); expect(S().journal).toHaveLength(0)
})
it('يرفض أساساً متغيراً وينبه عند تعذر تأكيد الحفظ', async () => {
 let button = open(); lock.changeBefore = true; fireEvent.click(button); await waitFor(() => expect(screen.getByText(/تغيرت أرصدة المخزون/)).toBeTruthy()); expect(S().transfers).toHaveLength(0)
 cleanup(); useRawDataStore.setState({ items: S().items.map(i => ({ ...i, stockQty: 10 })) }); lock.changeBefore = false; lock.failAfter = true; button = open(); fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().transfers).toHaveLength(1); expect(screen.queryByLabelText('تاريخ التحويل المخزني')).toBeNull()
})
