import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ failAfter: false, defer: false, approval: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); if (mocks.failAfter) throw new Error('flush failed'); return result } }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: mocks.defer, request: (cb: () => void) => { if (mocks.defer) mocks.approval = cb; else cb() } }) }))
import { TreasuryPage } from '../src/ui/pages/TreasuryPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], vouchers: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }, { code: '1102', nameAr: 'البنك', kind: 'bank' }] })
 S().postManualEntry({ date: '2025-01-01', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 mocks.failAfter = false; mocks.defer = false; mocks.approval = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<><TreasuryPage /><ToastHost /></>); fireEvent.click(screen.getByRole('button', { name: /تحويل بين الخزائن/ }))
 const date = screen.getByLabelText('تاريخ التحويل') as HTMLInputElement; expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getAllByPlaceholderText('0')[0], { target: { value: '5' } }); return dialog
}
it('يسجل تاريخ المستند والقيد المختار', async () => {
 const d = open(); fireEvent.click(within(d).getByRole('button', { name: /تنفيذ التحويل/ }))
 await waitFor(() => expect(S().vouchers).toHaveLength(1)); expect(S().vouchers[0].date.slice(0, 10)).toBe('2025-05-01'); expect(S().journal.at(-1)?.date).toBe('2025-05-01')
})
it('يحجب تغير البيانات ويحذر من تعذر تأكيد الحفظ', async () => {
 let d = open(); S().postManualEntry({ date: '2025-02-01', description: 'تغيير', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '3101', debit: 0, credit: 100 }] })
 fireEvent.click(within(d).getByRole('button', { name: /تنفيذ التحويل/ })); await waitFor(() => expect(screen.getByText(/تغيرت بيانات الخزائن/)).toBeTruthy()); expect(S().vouchers).toHaveLength(0)
 cleanup(); d = open(); mocks.failAfter = true; fireEvent.click(within(d).getByRole('button', { name: /تنفيذ التحويل/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().vouchers).toHaveLength(1); expect(screen.queryByLabelText('تاريخ التحويل')).toBeNull()
})
it('يلغي أثر اعتماد متأخر إذا تغيرت المسودة أو أغلقت', async () => {
 mocks.defer = true; const d = open(); fireEvent.click(within(d).getByRole('button', { name: /تنفيذ التحويل/ }))
 fireEvent.change(screen.getByLabelText('تاريخ التحويل'), { target: { value: '2025-05-02' } })
 act(() => mocks.approval?.()); expect(S().vouchers).toHaveLength(0); expect(screen.getByText(/تغير التحويل قبل الاعتماد/)).toBeTruthy()
 fireEvent.click(within(d).getByRole('button', { name: /تنفيذ التحويل/ })); fireEvent.click(within(d).getByRole('button', { name: 'إلغاء' }))
 act(() => mocks.approval?.()); expect(S().vouchers).toHaveLength(0)
})
