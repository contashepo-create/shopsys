import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], employeeAdvances: [], employeeDeductions: [], staffCommissions: [], driverDues: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 10000, active: true } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يستقطع الأقدم بتاريخ المستند لا بترتيب إدخاله ويبقي ترتيب السجلات', () => {
 const employeeId = S().employees[0].id
 const advances = ['2026-10-20', '2026-09-01', '2026-09-01'].map((date, i) => ({ id: i + 1, employeeId, date, advanceNumber: `ADV-${i + 1}`, amountMinor: 1000, recoveredMinor: 0, source: 'cash', treasury: '1101', notes: '' }))
 const deductions = ['2026-10-21', '2026-09-02', '2026-09-02'].map((date, i) => ({ id: i + 1, employeeId, date, dedNumber: `DED-${i + 1}`, amountMinor: 1000, recoveredMinor: 0, reason: 'تأخير', notes: '' }))
 useRawDataStore.setState({ employeeAdvances: advances as never, employeeDeductions: deductions as never })
 const run = S().postPayroll({ month: '2026-11', payMode: 'cash', treasury: '1101', notes: '', lines: [{ employeeId, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 1500, advancesMinor: 1500 }] })
 expect(S().employeeAdvances.map(a => [a.id, a.recoveredMinor])).toEqual([[1, 0], [2, 1000], [3, 500]])
 expect(S().employeeDeductions.map(d => [d.id, d.recoveredMinor])).toEqual([[1, 0], [2, 1000], [3, 500]])
 expect(run.lines[0].carryItems?.map(i => [i.number, i.takenMinor])).toEqual([['ADV-2', 1000], ['ADV-3', 500], ['DED-2', 1000], ['DED-3', 500]])
})
