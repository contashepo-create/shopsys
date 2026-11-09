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
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], employeeAdvances: [], advanceRepayments: [], payrollRuns: [], payrollSlips: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function openGrant() {
 render(<MemoryRouter><EmployeesPage initialTab="advances" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /صرف سلفة$/ }))
 const date = screen.getByLabelText('تاريخ صرف السلفة') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.type).toBe('date'); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const dialog = screen.getByRole('dialog')
 const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement
 fireEvent.change(amount, { target: { value: '10' } })
}
it('يحفظ تاريخ السلفة من الواجهة في القيد والمستند', async () => {
 openGrant(); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /صرف السلفة/ }))
 await waitFor(() => expect(S().employeeAdvances).toHaveLength(1))
 expect(S().employeeAdvances[0].date).toBe('2025-05-01'); expect(S().journal[0].date).toBe('2025-05-01')
})
it('التغير بعد فتح النافذة يمنع الترحيل، وفشل تأكيد الحفظ لا يشجع التكرار', async () => {
 openGrant(); S().addEmployee({ nameAr: 'موظف جديد', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /صرف السلفة/ }))
 await waitFor(() => expect(screen.getByText(/تغيرت بيانات السلف أو اليومية/)).toBeTruthy())
 expect(S().employeeAdvances).toHaveLength(0); cleanup()
 openGrant(); lock.failAfter = true; fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /صرف السلفة/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy())
 expect(S().employeeAdvances).toHaveLength(1); expect(screen.queryByLabelText('تاريخ صرف السلفة')).toBeNull()
})
it('يختار تاريخ السداد ويحفظه في المستند والقيد', async () => {
 S().grantEmployeeAdvance({ employeeId: S().employees[0].id, amountMinor: 2000, treasury: '1101', notes: '', date: '2025-04-01' })
 render(<MemoryRouter><EmployeesPage initialTab="advances" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /سداد نقدي لسلفة/ }))
 const date = screen.getByLabelText('تاريخ سداد السلفة') as HTMLInputElement
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const dialog = screen.getByRole('dialog')
 const amount = within(dialog).getByPlaceholderText('0')
 fireEvent.change(amount, { target: { value: '10' } })
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل السداد/ }))
 await waitFor(() => expect(S().advanceRepayments).toHaveLength(1))
 expect(S().advanceRepayments[0].date).toBe('2025-05-01'); expect(S().journal[1].date).toBe('2025-05-01')
})
