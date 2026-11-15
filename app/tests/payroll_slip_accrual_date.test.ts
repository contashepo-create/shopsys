import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const row = { employeeId: 1, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }
const accrue = (date: string, extra = {}) => S().accruePayrollSlips({ month: '2026-10', date, rows: [{ ...row, ...extra }] })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف', active: true }] as never, payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('تاريخ الاستحقاق والقيد يطابق المختار ووقت التسجيل حقيقي', () => {
 const [slip] = accrue('2026-11-03'); expect(slip.accruedAt).toContain('2026-11-03'); expect(slip.createdAt).toContain('2026-11-05'); expect(S().journal[0]).toMatchObject({ date: '2026-11-03', createdAt: expect.stringContaining('2026-11-05') })
})
it.each(['', '2026-02-30', '2026-11-06', '2026-11-04T12:00:00Z'])('يرفض التاريخ غير الصالح أو المستقبلي %s دون كتابة', date => {
 const before = S(); expect(() => accrue(date)).toThrow(/تاريخ/); expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
})
it('يرفض شهراً غير صالح وفترة مقفلة', () => {
 expect(() => S().accruePayrollSlips({ month: '2026-13', rows: [row] })).toThrow(/الشهر/)
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] }); expect(() => accrue('2026-11-03')).toThrow(/مقفلة/)
})
it('يرفض الاستحقاق قبل حركة رواتب لاحقة', () => {
 accrue('2026-11-04'); const before = S(); expect(() => S().accruePayrollSlips({ month: '2026-09', date: '2026-11-03', rows: [row] })).toThrow(/التسلسل/); expect(S().journal).toBe(before.journal)
})
it.each(['advance', 'deduction'])('يرفض استقطاع سجل %s لاحق حتى دون علامة التاريخ المختار', kind => {
 const record = { id: 1, employeeId: 1, date: '2026-11-04', amountMinor: 2000, recoveredMinor: 0, reason: 'سبب', notes: '' }
 if (kind === 'advance') useRawDataStore.setState({ employeeAdvances: [record] as never }); else useRawDataStore.setState({ employeeDeductions: [record] as never })
 const before = S(); expect(() => accrue('2026-11-03', kind === 'advance' ? { advanceMinor: 1000 } : { deductionsMinor: 1000 })).toThrow(/التسلسل|تسلسل/); expect(S().journal).toBe(before.journal)
})
it('يرفض تجاوز الحدود الآمنة في إجمالي الصف أو المسير دون أي أثر', () => {
 const before = S(); expect(() => accrue('2026-11-03', { grossMinor: Number.MAX_SAFE_INTEGER, allowancesMinor: 1 })).toThrow(/الحدود الآمنة/); expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ employees: [...S().employees, { id: 2, nameAr: 'ثان', active: true } as never] })
 const before2 = S(); expect(() => S().accruePayrollSlips({ month: '2026-10', date: '2026-11-03', rows: [{ ...row, grossMinor: Number.MAX_SAFE_INTEGER }, { ...row, employeeId: 2, grossMinor: 100 }] })).toThrow(/الحدود الآمنة/); expect(S().journal).toBe(before2.journal)
})
