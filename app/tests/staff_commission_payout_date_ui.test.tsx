import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().postManualEntry({ date: '2025-01-01', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 1000, description: 'عمولة', date: '2025-02-01' })
 lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="commissions" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('صرف منفرد الآن من الخزينة'))
 const date = screen.getByLabelText('تاريخ صرف العمولة') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } }); return screen.getByRole('dialog')
}
it('يسجل تاريخ الصرف وقيده دون تغيير تاريخ الاستحقاق', async () => {
 const d = open(); fireEvent.click(within(d).getByRole('button', { name: /صرف الآن/ }))
 await waitFor(() => expect(S().staffCommissions[0].status).toBe('paid'))
 expect(S().staffCommissions[0]).toMatchObject({ date: '2025-02-01', payoutDate: '2025-05-01' }); expect(S().journal.at(-1)?.date).toBe('2025-05-01')
})
it('يرفض تغير الأساس ويحذر عند تعذر تأكيد الحفظ', async () => {
 let d = open(); S().addEmployee({ nameAr: 'آخر', phone: '', roleId: 'cashier', salaryMinor: 1, active: true } as never)
 fireEvent.click(within(d).getByRole('button', { name: /صرف الآن/ })); await waitFor(() => expect(screen.getByText(/تغيرت العمولة أو الخزائن/)).toBeTruthy()); expect(S().staffCommissions[0].status).toBe('accrued')
 cleanup(); d = open(); lock.failAfter = true; fireEvent.click(within(d).getByRole('button', { name: /صرف الآن/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().staffCommissions[0].status).toBe('paid'); expect(screen.queryByLabelText('تاريخ صرف العمولة')).toBeNull()
})
