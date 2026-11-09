import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ failAfter: false, changeBefore: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (lock.changeBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); useRawDataStore.setState(s => ({ employees: [...s.employees, { ...s.employees[0], id: 77 }] })) }
 const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result
} }))
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], vouchers: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().postManualEntry({ date: '2025-02-01', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 S().accruePayrollSlips({ month: '2025-02', date: '2025-02-03', rows: [{ employeeId: S().employees[0].id, grossMinor: 3000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
 lock.failAfter = false; lock.changeBefore = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="payroll" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: 'سند صرف' }))
 const date = screen.getByLabelText('تاريخ سند صرف الراتب') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-02-04' } }); return screen.getByRole('dialog')
}
it('يسجل تاريخ السند والدفعة في كتابة واحدة', async () => {
 const dialog = open(); fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل سند الصرف/ }))
 await waitFor(() => expect(S().payrollSlips[0].status).toBe('paid'))
 expect(S().payrollSlips[0].payments?.[0].date).toBe('2025-02-04'); expect(S().journal.at(-1)?.date).toBe('2025-02-04')
})
it('يرفض تغير الأساس ويحذر عند تعذر تأكيد الحفظ', async () => {
 let dialog = open(); lock.changeBefore = true; fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل سند الصرف/ }))
 await waitFor(() => expect(screen.getByText(/تغيرت القسيمة أو الخزينة/)).toBeTruthy()); expect(S().vouchers).toHaveLength(0)
 cleanup(); lock.changeBefore = false; lock.failAfter = true; dialog = open(); fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل سند الصرف/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().payrollSlips[0].status).toBe('paid'); expect(screen.queryByLabelText('تاريخ سند صرف الراتب')).toBeNull()
})
