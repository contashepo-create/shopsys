import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], employeeAdvances: [], advanceRepayments: [], payrollRuns: [], payrollSlips: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const grant = (date?: string) => S().grantEmployeeAdvance({ employeeId: S().employees[0].id, amountMinor: 1000, treasury: '1101', notes: '', ...(date === undefined ? {} : { date }) })
const repay = (date?: string) => S().repayEmployeeAdvance({ employeeId: S().employees[0].id, amountMinor: 500, treasury: '1101', ...(date === undefined ? {} : { date }) })
it('يربط تاريخ الصرف والسداد بالقيد ويحفظ وقت التسجيل ويوزع الاسترداد', () => {
 const a = grant('2026-11-03'); const r = repay('2026-11-04')
 expect(a).toMatchObject({ date: '2026-11-03', createdAt: expect.stringContaining('2026-11-05'), dateSelected: true })
 expect(r).toMatchObject({ date: '2026-11-04', createdAt: expect.stringContaining('2026-11-05') })
 expect(S().journal.map(x => x.date)).toEqual(['2026-11-03', '2026-11-04'])
 expect(S().employeeAdvances[0].recoveredMinor).toBe(500)
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض التاريخ الخاطئ %s دون حركة', date => {
 expect(() => grant(date)).toThrow(/تاريخ/); expect(S().employeeAdvances).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('يرفض السنة المقفلة والتاريخ الذي يعكس تسلسل السلف والسداد', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-02', status: 'closed' }, { id: 2, nameAr: 'مفتوحة', startDate: '2026-11-03', endDate: '2026-12-31', status: 'open' }] })
 expect(() => grant('2026-11-02')).toThrow(/مقفلة/); grant('2026-11-03')
 expect(() => repay('2026-11-02')).toThrow(/مقفلة/)
 repay('2026-11-04'); const before = S()
 expect(() => grant('2026-11-03')).toThrow(/تسلسل/)
 expect(S().journal).toBe(before.journal); expect(S().employeeAdvances).toBe(before.employeeAdvances)
})
it('يحظر قسيمة استقطاع تسبق السلفة أو السداد المختارين', () => {
 grant('2026-11-03'); repay('2026-11-04')
 const args = { month: '2026-11', rows: [{ employeeId: S().employees[0].id, grossMinor: 5000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100 }] }
 expect(() => S().accruePayrollSlips({ ...args, date: '2026-11-03' })).toThrow(/تسلسل/)
 expect(S().payrollSlips).toHaveLength(0)
 S().accruePayrollSlips({ ...args, date: '2026-11-04' }); expect(S().employeeAdvances[0].recoveredMinor).toBe(600)
})
it('يرفض الصرف بأثر رجعي قبل حركة خزينة لاحقة لتجنب رصيد زمني مجهول', () => {
 S().postManualEntry({ date: '2026-11-04', description: 'حركة', lines: [{ accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 1000 }] })
 expect(() => grant('2026-11-03')).toThrow(/رصيد/); expect(S().employeeAdvances).toHaveLength(0)
})
it('يحمي الفرع والخزينة وصلاحية المستخدم', () => {
 useRawDataStore.setState({ currentUserId: 999 })
 expect(() => grant()).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null })
 expect(() => S().grantEmployeeAdvance({ employeeId: S().employees[0].id, amountMinor: 1000, treasury: '9999', notes: '' })).toThrow(/الخزينة/)
 expect(S().journal).toHaveLength(0)
})
it('لا يعكس استقطاع قسيمة تلقائياً بعد استخدام سلف مؤرخة دون دليل تخصيص', () => {
 grant('2026-11-03')
 const [slip] = S().accruePayrollSlips({ month: '2026-11', date: '2026-11-04', rows: [{ employeeId: S().employees[0].id, grossMinor: 5000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100 }] })
 const before = S()
 expect(() => S().cancelPayrollSlip(slip.id, 'تصحيح')).toThrow(/تسوية يدوية/)
 expect(S().employeeAdvances).toBe(before.employeeAdvances); expect(S().journal).toBe(before.journal)
})
