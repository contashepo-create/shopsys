import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HrPage } from '../src/ui/pages/HrPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { monthlySummary } from '../src/core/attendance.ts'
import { useToast } from '../src/ui/components/ui.tsx'
const control = vi.hoisted(() => ({ before: null as null | (() => void), failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { control.before?.(); const result = commit(); if (control.failAfter) throw new Error('flush failed'); return result } }))
const initial = useRawDataStore.getState(), app = useAppStore.getState(), state = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [], attendanceRecords: [], leaveRequests: [], payrollRuns: [], payrollSlips: [] })
 state().addEmployee({ nameAr: 'أحمد', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 state().addEmployee({ nameAr: 'مريم', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 control.before = null; control.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
const add = (employeeId: number, from = '2026-11-02', to = '2026-11-03') => {
 const leave = state().addLeaveRequest({ employeeId, typeId: 'annual', from, to, reason: '' })
 return state().decideLeaveRequest(leave.id, true, 'المدير')
}
const renderPage = () => render(<MemoryRouter initialEntries={['/hr/leaves']}><Routes><Route path="/hr/:tab" element={<HrPage />} /></Routes></MemoryRouter>)
it('إلغاء إجازة يعيد الحضور الأصلي والرصيد، ويحتفظ بتعديل لاحق وأيام موظف آخر', () => {
 const [a, b] = state().employees
 state().setAttendanceDay({ employeeId: a.id, date: '2026-11-02', status: 'present', checkIn: '09:10', checkOut: '17:00', notes: 'حضور أصلي' })
 const original = state().attendanceRecords[0]
 const leave = add(a.id); add(b.id)
 state().setAttendanceDay({ employeeId: a.id, date: '2026-11-03', status: 'absent', notes: 'تصحيح لاحق' })
 expect(state().getLeaveBalances(a.id, 2026).find(r => r.typeId === 'annual')?.usedDays).toBe(2)
 const cancelled = state().cancelLeaveRequest(leave.id, 'مدير', 'تراجع الموظف')
 expect(cancelled).toMatchObject({ status: 'cancelled', cancelledBy: 'مدير', cancellationReason: 'تراجع الموظف', decidedBy: 'المدير' })
 expect(state().attendanceRecords.find(r => r.employeeId === a.id && r.date === '2026-11-02')).toEqual(original)
 expect(state().attendanceRecords.find(r => r.employeeId === a.id && r.date === '2026-11-03')?.status).toBe('absent')
 expect(state().attendanceRecords.filter(r => r.employeeId === b.id)).toHaveLength(2)
 expect(state().getLeaveBalances(a.id, 2026).find(r => r.typeId === 'annual')?.usedDays).toBe(0)
 expect(monthlySummary({ employeeId: a.id, month: '2026-11', records: state().attendanceRecords, leaves: state().leaveRequests, types: state().leaveTypes }).paidLeaveDays).toBe(0)
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', 'مرة ثانية')).toThrow(/غير معتمد/)
 expect(() => state().addLeaveRequest({ employeeId: a.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-03', reason: '' })).not.toThrow()
})
it('الإجازة القديمة تؤرشف علامات الحضور المجهولة قبل إزالتها ولا تمس موظفاً آخر', () => {
 const [a, b] = state().employees; const leave = add(a.id); add(b.id)
 useRawDataStore.setState({ leaveRequests: state().leaveRequests.map(l => l.id === leave.id ? { ...l, attendanceAtApproval: undefined } : l) })
 const old = state().attendanceRecords.filter(r => r.employeeId === a.id)
 const result = state().cancelLeaveRequest(leave.id, 'مدير', 'إلغاء')
 expect(result.legacyAttendanceAtCancellation).toEqual(old)
 expect(state().attendanceRecords.filter(r => r.employeeId === a.id)).toHaveLength(0)
 expect(state().attendanceRecords.filter(r => r.employeeId === b.id)).toHaveLength(2)
})
it('يرفض إلغاء مرتبط بقسيمة أو مسير أو فترة مقفلة أو صلاحية مسحوبة', () => {
 const leave = add(state().employees[0].id)
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', ' ')).toThrow(/سبب/)
 useRawDataStore.setState({ payrollSlips: [{ employeeId: leave.employeeId, month: '2026-11', status: 'accrued' }] as never })
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', 'سبب')).toThrow(/قسيمة/)
 useRawDataStore.setState({ payrollSlips: [], payrollRuns: [{ month: '2026-11', lines: [{ employeeId: leave.employeeId }] }] as never })
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', 'سبب')).toThrow(/مسير/)
 useRawDataStore.setState({ payrollRuns: [] })
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', 'سبب')).toThrow(/مقفلة/)
 useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ currentUserId: 999 })
 expect(() => state().cancelLeaveRequest(leave.id, 'مدير', 'سبب')).toThrow(/صلاحية/)
 expect(state().leaveRequests[0].status).toBe('approved')
})
it('تقويم الفريق يرشح كل موظف على حدة ويتيح إلغاء الإجازة المعتمدة', async () => {
 const [a, b] = state().employees; add(a.id); add(b.id, '2026-11-05', '2026-11-05')
 renderPage(); fireEvent.change(screen.getByLabelText('شهر التقويم'), { target: { value: '2026-11' } })
 const calendarDay = (day: string) => document.querySelector(`[data-leave-date="2026-11-${day}"]`) as HTMLElement
 expect(calendarDay('02').title).toContain('أحمد'); expect(calendarDay('05').title).toContain('مريم')
 fireEvent.change(screen.getByLabelText('موظف تقويم الإجازات'), { target: { value: String(a.id) } })
 expect(calendarDay('02').title).toContain('أحمد'); expect(calendarDay('05').title).toBe('لا إجازات')
 fireEvent.change(screen.getByLabelText('موظف تقويم الإجازات'), { target: { value: String(b.id) } })
 expect(calendarDay('02').title).toBe('لا إجازات'); expect(calendarDay('05').title).toContain('مريم')
 const row = screen.getAllByRole('row').find(row => row.textContent?.includes('أحمد') && within(row).queryByRole('button', { name: 'إلغاء الإجازة' }))!
 fireEvent.click(within(row).getByRole('button', { name: 'إلغاء الإجازة' }))
 fireEvent.change(screen.getByLabelText('سبب إلغاء الإجازة'), { target: { value: 'طلب الموظف' } })
 fireEvent.click(screen.getByRole('button', { name: /تأكيد إلغاء الإجازة/ }))
 await waitFor(() => expect(state().leaveRequests.find(l => l.employeeId === a.id)?.status).toBe('cancelled'))
 expect(state().leaveRequests.find(l => l.employeeId === b.id)?.status).toBe('approved')
 expect(screen.getByText('ملغاة')).toBeTruthy()
})
it('تغير الفرع قبل الإلغاء يمنع المساس بالسجلات', async () => {
 const leave = add(state().employees[0].id); renderPage()
 fireEvent.click(screen.getByRole('button', { name: 'إلغاء الإجازة' }))
 fireEvent.change(screen.getByLabelText('سبب إلغاء الإجازة'), { target: { value: 'سبب' } })
 control.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: /تأكيد إلغاء الإجازة/ })) })
 expect(state().leaveRequests.find(l => l.id === leave.id)?.status).toBe('approved')
 expect(useToast.getState().msg).toContain('تغير المستخدم أو الفرع')
})
it('فشل تأكيد الحفظ بعد الإلغاء يحذر ولا يعيد عملية الإلغاء', async () => {
 const leave = add(state().employees[0].id); renderPage()
 fireEvent.click(screen.getByRole('button', { name: 'إلغاء الإجازة' }))
 fireEvent.change(screen.getByLabelText('سبب إلغاء الإجازة'), { target: { value: 'سبب' } }); control.failAfter = true
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: /تأكيد إلغاء الإجازة/ })) })
 expect(state().leaveRequests.find(l => l.id === leave.id)?.status).toBe('cancelled')
 expect(useToast.getState().msg).toContain('تعذر تأكيد الحفظ')
 expect(screen.queryByRole('button', { name: 'إلغاء الإجازة' })).toBeNull()
})
it('الإجازة العابرة للسنة تستهلك رصيد كل سنة وتتحقق من تواريخ حقيقية', () => {
 const employee = state().employees[0]
 const leave = state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-12-31', to: '2027-01-02', reason: '' })
 state().decideLeaveRequest(leave.id, true, 'مدير')
 expect(state().getLeaveBalances(employee.id, 2026).find(r => r.typeId === 'annual')?.usedDays).toBe(1)
 expect(state().getLeaveBalances(employee.id, 2027).find(r => r.typeId === 'annual')?.usedDays).toBe(2)
 expect(() => state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2027-02-30', to: '2027-03-02', reason: '' })).toThrow(/تاريخ/)
})
it('إعادة فحص الرصيد عند الاعتماد تمنع طلبين معلقين من تجاوز الرصيد', () => {
 const employee = state().employees[0]
 const one = state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-01-01', to: '2026-01-15', reason: '' })
 const two = state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-02-01', to: '2026-02-15', reason: '' })
 state().decideLeaveRequest(one.id, true, 'مدير')
 expect(() => state().decideLeaveRequest(two.id, true, 'مدير')).toThrow(/لا يكفي/)
 expect(state().leaveRequests.find(l => l.id === two.id)?.status).toBe('pending')
})
