import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HrPage } from '../src/ui/pages/HrPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { monthlySummary } from '../src/core/attendance.ts'
import { useToast } from '../src/ui/components/ui.tsx'
const control = vi.hoisted(() => ({ before: null as null | (() => void), failAfter: false, hold: false, release: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { if (control.hold) await new Promise<void>(resolve => { control.release = resolve }); control.before?.(); const result = commit(); if (control.failAfter) throw new Error('flush failed'); return result } }))
const initial = useRawDataStore.getState(), app = useAppStore.getState(), state = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [], attendanceRecords: [], leaveRequests: [], payrollRuns: [], payrollSlips: [] })
 state().addEmployee({ nameAr: 'أحمد', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 state().addEmployee({ nameAr: 'مريم', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 control.before = null; control.failAfter = false; control.hold = false; control.release = null; useToast.setState({ msg: null, kind: 'success' })
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
it('لا يعتمد إجازة في فترة دخلت مسيراً أو قسيمة أو أقفلت، ولا يغير الحضور عند الرفض', () => {
 const employee = state().employees[0]
 const request = state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-03', reason: '' })
 const approve = () => state().decideLeaveRequest(request.id, true, 'مدير')
 useRawDataStore.setState({ payrollSlips: [{ employeeId: employee.id, month: '2026-11', status: 'accrued' }] as never })
 expect(approve).toThrow(/قسيمة/); expect(state().attendanceRecords).toHaveLength(0)
 useRawDataStore.setState({ payrollSlips: [], payrollRuns: [{ month: '2026-11', lines: [{ employeeId: employee.id }] }] as never })
 expect(approve).toThrow(/مسير/)
 useRawDataStore.setState({ payrollRuns: [] })
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 expect(approve).toThrow(/مقفلة/)
 state().decideLeaveRequest(request.id, false, 'مدير')
 expect(state().attendanceRecords).toHaveLength(0)
 expect(() => state().deleteLeaveRequest(request.id)).toThrow(/محسوم/)
})
it('يحافظ على سجل الإلغاء ويرفض تكرار الهوية أو سجلات حضور متعارضة قبل الاعتماد والإلغاء', () => {
 const employee = state().employees[0]
 const req = state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-02', reason: '' })
 const row = { employeeId: employee.id, date: '2026-11-02', status: 'present' as const, source: 'manual' as const }
 useRawDataStore.setState({ attendanceRecords: [{ ...row, id: 1 }, { ...row, id: 2 }] })
 expect(() => state().decideLeaveRequest(req.id, true, 'مدير')).toThrow(/غير فريد/)
 useRawDataStore.setState({ attendanceRecords: [] }); state().decideLeaveRequest(req.id, true, 'مدير')
 const applied = state().attendanceRecords[0]
 useRawDataStore.setState({ attendanceRecords: [applied, { ...applied, id: 9 }] })
 expect(() => state().cancelLeaveRequest(req.id, 'مدير', 'سبب')).toThrow(/غير فريد/)
 expect(state().leaveRequests[0].status).toBe('approved')
 useRawDataStore.setState({ attendanceRecords: [applied] }); state().cancelLeaveRequest(req.id, 'مدير', 'سبب')
 expect(() => state().deleteLeaveRequest(req.id)).toThrow(/محسوم/)
 expect(state().leaveRequests[0].status).toBe('cancelled')
})
it('صلاحية الإجازات تُفحص مجدداً عند إنشاء الطلب والقرار والحذف', () => {
 const employee = state().employees[0]
 const args = { employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-02', reason: '' }
 const req = state().addLeaveRequest(args)
 useRawDataStore.setState({ currentUserId: 999 })
 expect(() => state().addLeaveRequest(args)).toThrow(/صلاحية/)
 expect(() => state().decideLeaveRequest(req.id, true, 'مدير')).toThrow(/صلاحية/)
 expect(() => state().deleteLeaveRequest(req.id)).toThrow(/صلاحية/)
 expect(state().leaveRequests[0].status).toBe('pending')
})
it('اعتماد الطلب من الواجهة يقفل التنفيذ ويمنع تكراره', async () => {
 const employee = state().employees[0]
 state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-02', reason: '' })
 renderPage(); control.hold = true
 const approve = screen.getByRole('button', { name: 'اعتماد' })
 fireEvent.click(approve); fireEvent.click(approve)
 expect(approve.hasAttribute('disabled')).toBe(true)
 await act(async () => { control.release?.(); await Promise.resolve() })
 await waitFor(() => expect(state().leaveRequests[0].status).toBe('approved'))
 expect(state().attendanceRecords).toHaveLength(1)
})
it('يرفض الاعتماد إذا تغير الحضور أو الفرع أثناء انتظار القفل', async () => {
 const employee = state().employees[0]
 state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-02', reason: '' })
 renderPage(); control.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'اعتماد' })) })
 expect(state().leaveRequests[0].status).toBe('pending')
 expect(state().attendanceRecords).toHaveLength(0)
 expect(useToast.getState().msg).toContain('تغيرت بيانات الإجازة')
})
it('فشل تأكيد حفظ الاعتماد يحذر من مراجعة السجل بدلاً من تكراره', async () => {
 const employee = state().employees[0]
 state().addLeaveRequest({ employeeId: employee.id, typeId: 'annual', from: '2026-11-02', to: '2026-11-02', reason: '' })
 renderPage(); control.failAfter = true
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'اعتماد' })) })
 expect(state().leaveRequests[0].status).toBe('approved')
 expect(state().attendanceRecords).toHaveLength(1)
 expect(useToast.getState().msg).toContain('تعذر تأكيد الحفظ')
 expect(screen.queryByRole('button', { name: 'اعتماد' })).toBeNull()
})
it('قطع الإجازة يحفظ الأيام السابقة والرصيد ويستعيد المتبقي بلا محو تعديل لاحق', () => {
 const a = state().employees[0]
 state().setAttendanceDay({ employeeId: a.id, date: '2026-11-03', status: 'present', notes: 'الأصل' })
 const previous = state().attendanceRecords[0]; const leave = add(a.id, '2026-11-01', '2026-11-04')
 state().setAttendanceDay({ employeeId: a.id, date: '2026-11-04', status: 'present', notes: 'عودة مسجلة' })
 const result = state().returnFromLeave(leave.id, '2026-11-03', 'مدير', 'عودة مبكرة')
 expect(result).toMatchObject({ status: 'approved', from: '2026-11-01', to: '2026-11-02', days: 2, returnHistory: [{ returnDate: '2026-11-03', previousTo: '2026-11-04', reason: 'عودة مبكرة' }] })
 expect(state().attendanceRecords.find(r => r.date === '2026-11-03')).toEqual(previous)
 expect(state().attendanceRecords.find(r => r.date === '2026-11-04')?.notes).toBe('عودة مسجلة')
 expect(state().getLeaveBalances(a.id, 2026).find(r => r.typeId === 'annual')?.usedDays).toBe(2)
 expect(monthlySummary({ employeeId: a.id, month: '2026-11', records: state().attendanceRecords, leaves: state().leaveRequests, types: state().leaveTypes }).paidLeaveDays).toBe(2)
 expect(() => state().addLeaveRequest({ employeeId: a.id, typeId: 'annual', from: '2026-11-03', to: '2026-11-04', reason: '' })).not.toThrow()
})
it('يمنع قطع الفترة المتأثرة برواتب أو تاريخ خاطئ، دون حجب راتب شهر سابق لم يتغير', () => {
 const a = state().employees[0]; const leave = add(a.id, '2026-10-30', '2026-11-03')
 expect(() => state().returnFromLeave(leave.id, '2026-11-31', 'مدير', 'سبب')).toThrow(/تاريخ/)
 useRawDataStore.setState({ payrollSlips: [{ employeeId: a.id, month: '2026-11', status: 'accrued' }] as never })
 expect(() => state().returnFromLeave(leave.id, '2026-11-02', 'مدير', 'سبب')).toThrow(/قسيمة/)
 expect(state().leaveRequests[0].to).toBe('2026-11-03')
 useRawDataStore.setState({ payrollSlips: [{ employeeId: a.id, month: '2026-10', status: 'accrued' }] as never })
 expect(state().returnFromLeave(leave.id, '2026-11-02', 'مدير', 'سبب').to).toBe('2026-11-01')
})
it('يعالج الإجازة القديمة ويؤرشف الأيام الملغاة فقط؛ أول يوم عودة يلغي الكل', () => {
 const a = state().employees[0]; const leave = add(a.id, '2026-11-01', '2026-11-04')
 useRawDataStore.setState({ leaveRequests: state().leaveRequests.map(l => ({ ...l, attendanceAtApproval: undefined })) })
 const result = state().returnFromLeave(leave.id, '2026-11-03', 'مدير', 'سبب')
 expect(result.returnHistory?.[0].legacyAttendance?.map(r => r.date)).toEqual(['2026-11-03', '2026-11-04'])
 expect(state().attendanceRecords.map(r => r.date)).toEqual(['2026-11-01', '2026-11-02'])
 expect(state().returnFromLeave(leave.id, '2026-11-01', 'مدير', 'إلغاء').status).toBe('cancelled')
})
it('تسجيل العودة من الواجهة يحدّث السجل والتقويم مع بقاء الأيام الماضية', async () => {
 const a = state().employees[0]; add(a.id, '2026-11-01', '2026-11-04'); renderPage()
 fireEvent.change(screen.getByLabelText('شهر التقويم'), { target: { value: '2026-11' } })
 fireEvent.click(screen.getByRole('button', { name: 'قطع الإجازة وعودة للعمل' }))
 fireEvent.change(screen.getByLabelText('تاريخ العودة للعمل'), { target: { value: '2026-11-03' } })
 fireEvent.change(screen.getByLabelText('سبب قطع الإجازة'), { target: { value: 'عودة مبكرة' } })
 fireEvent.click(screen.getByRole('button', { name: /تأكيد قطع الإجازة/ }))
 await waitFor(() => expect(state().leaveRequests[0].to).toBe('2026-11-02'))
 expect((document.querySelector('[data-leave-date="2026-11-02"]') as HTMLElement).title).toContain('أحمد')
 expect((document.querySelector('[data-leave-date="2026-11-03"]') as HTMLElement).title).toBe('لا إجازات')
 expect(screen.getByText('تفاصيل العودة')).toBeTruthy()
})
it('يمنع تغير السياق قبل العودة ويحذر عند تعذر تأكيد الحفظ', async () => {
 const leave = add(state().employees[0].id, '2026-11-01', '2026-11-04'); renderPage()
 fireEvent.click(screen.getByRole('button', { name: 'قطع الإجازة وعودة للعمل' }))
 fireEvent.change(screen.getByLabelText('تاريخ العودة للعمل'), { target: { value: '2026-11-03' } })
 fireEvent.change(screen.getByLabelText('سبب قطع الإجازة'), { target: { value: 'سبب' } })
 control.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: /تأكيد قطع الإجازة/ })) })
 expect(state().leaveRequests[0].to).toBe('2026-11-04')
 expect(useToast.getState().msg).toContain('تغيرت بيانات الإجازة')
 control.before = null; control.failAfter = true
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: /تأكيد قطع الإجازة/ })) })
 expect(state().leaveRequests.find(l => l.id === leave.id)?.to).toBe('2026-11-02')
 expect(useToast.getState().msg).toContain('تعذر تأكيد الحفظ')
})
