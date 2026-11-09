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
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], payrollRuns: [], payrollSlips: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="deductions" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /تسجيل خصم \/ جزاء/ }))
 const date = screen.getByLabelText('تاريخ الجزاء') as HTMLInputElement
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '10' } }); fireEvent.change(within(dialog).getByPlaceholderText('غياب 3 أيام بدون إذن'), { target: { value: 'غياب' } })
 return dialog
}
it('يسجل الجزاء بتاريخ المعاينة دون قيد', async () => {
 const dialog = open(); fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل الخصم/ }))
 await waitFor(() => expect(S().employeeDeductions).toHaveLength(1)); expect(S().employeeDeductions[0].date).toBe('2025-05-01'); expect(S().journal).toHaveLength(0)
})
it('يرفض تغير البيانات ويحذر عند تعذر تأكيد الحفظ', async () => {
 let dialog = open(); S().addEmployee({ nameAr: 'موظف آخر', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل الخصم/ })); await waitFor(() => expect(screen.getByText(/تغيرت بيانات الموظفين/)).toBeTruthy()); expect(S().employeeDeductions).toHaveLength(0)
 cleanup(); dialog = open(); lock.failAfter = true; fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل الخصم/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().employeeDeductions).toHaveLength(1); expect(screen.queryByLabelText('تاريخ الجزاء')).toBeNull()
})
