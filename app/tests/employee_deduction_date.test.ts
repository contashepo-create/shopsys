import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], payrollRuns: [], payrollSlips: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const add = (date?: string) => S().addEmployeeDeduction({ employeeId: S().employees[0].id, amountMinor: 1000, reason: 'غياب', ...(date === undefined ? {} : { date }) })
it('يحفظ تاريخ الجزاء ووقت إنشائه الفعلي دون قيد', () => {
 const d = add('2026-11-03'); expect(d).toMatchObject({ date: '2026-11-03', createdAt: expect.stringContaining('2026-11-05'), dateSelected: true })
 expect(S().journal).toHaveLength(0); expect(S().employeeDeductions).toHaveLength(1)
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض التاريخ غير الصالح %s دون حفظ', date => {
 expect(() => add(date)).toThrow(/تاريخ/); expect(S().employeeDeductions).toHaveLength(0)
})
it('يمنع السنة المغلقة وتقديم الجزاء أو استقطاع قسيمة على الجزاء', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-02', status: 'closed' }, { id: 2, nameAr: 'مفتوحة', startDate: '2026-11-03', endDate: '2026-12-31', status: 'open' }] })
 expect(() => add('2026-11-02')).toThrow(/مقفلة/); add('2026-11-04')
 expect(() => add('2026-11-03')).toThrow(/التسلسل/)
 const args = { month: '2026-11', rows: [{ employeeId: S().employees[0].id, grossMinor: 5000, allowancesMinor: 0, deductionsMinor: 100, advanceMinor: 0 }] }
 expect(() => S().accruePayrollSlips({ ...args, date: '2026-11-03' })).toThrow(/التسلسل/)
 expect(S().journal).toHaveLength(0); S().accruePayrollSlips({ ...args, date: '2026-11-04' }); expect(S().employeeDeductions[0].recoveredMinor).toBe(100)
})
it('لا يقدم الجزاء على عفو تم لاحقاً', () => {
 const d = add('2026-11-03'); S().waiveEmployeeDeduction({ deductionId: d.id, approvedBy: 'المالك', reason: 'صفح' })
 expect(() => add('2026-11-04')).toThrow(/التسلسل/); expect(S().employeeDeductions).toHaveLength(1)
})
it('لا يقبل موظفاً من فرع آخر أو مستخدماً دون صلاحية', () => {
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => add()).toThrow(/صلاحية/)
 expect(S().employeeDeductions).toHaveLength(0)
})
