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
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], attendanceRecords: [], leaveRequests: [] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', baseSalaryMinor: 30000, active: true } as never)
 lock.failAfter = false; lock.changeBefore = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="payroll" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /استحقاق قسائم/ }))
 const date = screen.getByLabelText('تاريخ استحقاق القسائم') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-02-04' } })
 fireEvent.change(screen.getByLabelText('gross موظف'), { target: { value: '300' } })
 fireEvent.click(screen.getByRole('button', { name: /ترحيل المسير —/ }))
 const warning = screen.getByText(/ليس لديهم أي سجل حضور/).closest('[role="dialog"]') as HTMLElement
 return within(warning).getByRole('button', { name: /الترحيل رغم ذلك/ })
}
it('يختار تاريخ الاستحقاق ويؤكد الحضور ثم يسجل القيد والقسيمة', async () => {
 fireEvent.click(open()); await waitFor(() => expect(S().payrollSlips).toHaveLength(1))
 expect(S().payrollSlips[0].accruedAt).toContain('2025-02-04'); expect(S().journal[0].date).toBe('2025-02-04')
})
it('يرفض تغير الأساس ويحذر من تعذر تأكيد الحفظ', async () => {
 let button = open(); lock.changeBefore = true; fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تغير أساس المسير/)).toBeTruthy()); expect(S().payrollSlips).toHaveLength(0)
 cleanup(); useRawDataStore.setState({ employees: S().employees.filter(e => e.id !== 77) }); lock.changeBefore = false; lock.failAfter = true; button = open(); fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().payrollSlips).toHaveLength(1); expect(screen.queryByLabelText('تاريخ استحقاق القسائم')).toBeNull()
})
