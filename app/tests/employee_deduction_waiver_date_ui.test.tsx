import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ failAfter: false, changeBefore: false, defer: false, approval: null as null | ((by?: string) => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (mocks.changeBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); useRawDataStore.setState(s => ({ employeeDeductions: s.employeeDeductions.map(d => ({ ...d, notes: 'تغير' })) })) }
 const result = commit(); if (mocks.failAfter) throw new Error('flush failed'); return result
} }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: mocks.defer, request: (cb: (by?: string) => void) => { if (mocks.defer) mocks.approval = cb; else cb('المعتمد') } }) }))
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], journal: [], employeeDeductions: [] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().addEmployeeDeduction({ employeeId: S().employees[0].id, date: '2025-02-03', amountMinor: 1000, reason: 'غياب' })
 mocks.failAfter = false; mocks.changeBefore = false; mocks.defer = false; mocks.approval = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="deductions" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /عفو/ }))
 const date = screen.getByLabelText('تاريخ عفو الجزاء') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-02-04' } }); fireEvent.change(screen.getByLabelText('سبب عفو الجزاء'), { target: { value: 'صفح' } })
 return within(date.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: /اعتماد العفو/ })
}
it('يحفظ تاريخ وسبب العفو دون قيد', async () => {
 fireEvent.click(open()); await waitFor(() => expect(S().employeeDeductions[0].waivedMinor).toBe(1000))
 expect(S().employeeDeductions[0]).toMatchObject({ waivedDate: '2025-02-04', waivedReason: 'صفح', waivedBy: 'المعتمد' }); expect(S().journal).toHaveLength(0)
})
it('يرفض تغير البيانات ويحذر عند تعذر تأكيد الحفظ', async () => {
 let button = open(); mocks.changeBefore = true; fireEvent.click(button); await waitFor(() => expect(screen.getByText(/تغيرت بيانات العفو/)).toBeTruthy()); expect(S().employeeDeductions[0].waivedMinor).toBeUndefined()
 cleanup(); mocks.changeBefore = false; mocks.failAfter = true; button = open(); fireEvent.click(button); await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().employeeDeductions[0].waivedMinor).toBe(1000); expect(screen.queryByLabelText('تاريخ عفو الجزاء')).toBeNull()
})
it('لا يستخدم اعتماداً معلقاً بعد تغيير السبب', async () => {
 mocks.defer = true; fireEvent.click(open()); expect(mocks.approval).toBeTypeOf('function')
 fireEvent.change(screen.getByLabelText('سبب عفو الجزاء'), { target: { value: 'سبب مختلف' } }); mocks.approval!('مشرف')
 await waitFor(() => expect(screen.getByText(/تغيرت بيانات العفو/)).toBeTruthy()); expect(S().employeeDeductions[0].waivedMinor).toBeUndefined()
})
