import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const branch = (id: number, isMain: boolean) => ({ id, nameAr: `فرع ${id}`, isMain, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1121' })
const line = { employeeId: 1, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }
const run = (patch: Partial<typeof line> & { commissionsPaidMinor?: number; driverDuesPaidMinor?: number } = {}) => S().postPayroll({ month: '2026-11', payMode: 'cash', treasury: '1101', notes: '', lines: [{ ...line, ...patch }] })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [branch(1, true), branch(2, false)] as never, employees: [{ id: 1, nameAr: 'موظف', active: true, branchId: 1 }] as never, treasuries: [{ code: '1101', nameAr: 'رئيسية', kind: 'cash', isDefault: true, branchId: 1 }, { code: '1121', nameAr: 'أخرى', kind: 'cash', branchId: 2 }] as never, payrollRuns: [], journal: [], employeeAdvances: [], employeeDeductions: [], staffCommissions: [], driverDues: [], custodyFiles: [], custodyTxs: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يرفض موظف فرع آخر ومعرف موظف مكرر دون قيد', () => {
 useRawDataStore.setState({ employees: [{ ...S().employees[0], branchId: 2 }] as never }); expect(() => run()).toThrow(/الفرع/)
 useRawDataStore.setState({ employees: [{ ...S().employees[0], branchId: 1 }, { ...S().employees[0], branchId: 2 }] as never }); expect(() => run()).toThrow(/فريد/)
 expect(S().journal).toHaveLength(0); expect(S().payrollRuns).toHaveLength(0)
})
it.each(['advance', 'deduction', 'commission', 'driver'])('يمنع استقطاع سجل %s من فرع آخر', kind => {
 const date = '2026-11-03', branchId = 2
 if (kind === 'advance') useRawDataStore.setState({ employeeAdvances: [{ id: 1, employeeId: 1, date, branchId, amountMinor: 500, recoveredMinor: 0 }] as never })
 if (kind === 'deduction') useRawDataStore.setState({ employeeDeductions: [{ id: 1, employeeId: 1, date, branchId, amountMinor: 500, recoveredMinor: 0 }] as never })
 if (kind === 'commission') useRawDataStore.setState({ staffCommissions: [{ id: 1, employeeId: 1, date, branchId, amountMinor: 500, status: 'accrued' }] as never })
 if (kind === 'driver') useRawDataStore.setState({ driverDues: [{ id: 1, driverId: 1, date, branchId, amountMinor: 500, settled: false }] as never })
 const before = S(); const patch = kind === 'advance' ? { advancesMinor: 500 } : kind === 'deduction' ? { deductionsMinor: 500 } : kind === 'commission' ? { commissionsPaidMinor: 500 } : { driverDuesPaidMinor: 500 }
 expect(() => run(patch)).toThrow(/فرع آخر/); expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns)
})
it('يرفض تاريخ مستند مبهماً أو لاحقاً للمسير', () => {
 useRawDataStore.setState({ employeeAdvances: [{ id: 1, employeeId: 1, date: '2026-11-06', branchId: 1, amountMinor: 500, recoveredMinor: 0 }] as never })
 expect(() => run({ advancesMinor: 500 })).toThrow(/لاحق/); expect(S().journal).toHaveLength(0)
})
it('يمنع خزينة فرع آخر أو عهدته ويمنع غياب الصلاحية', () => {
 const args = { month: '2026-11', payMode: 'cash' as const, treasury: '1121' as const, notes: '', lines: [line] }
 expect(() => S().postPayroll(args)).toThrow(/الفرع/)
 useRawDataStore.setState({ custodyFiles: [{ id: 1, branchId: 2, status: 'open' }] as never })
 expect(() => S().postPayroll({ ...args, treasury: '1101', custodyFileId: 1 })).toThrow(/الفرع/)
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => run()).toThrow(/صلاحية/); expect(S().journal).toHaveLength(0)
})
it('يقبل المسير الاعتيادي داخل الفرع', () => { const result = run(); expect(result.lines[0].employeeId).toBe(1); expect(S().journal).toHaveLength(1) })
it('يطبق صلاحية خزينة المسير على مجموع المصروف', () => {
 useRawDataStore.setState({ currentUserId: 9, appUsers: [{ id: 9, nameAr: 'مالك', active: true, roleId: 'owner', treasuryAccess: { grants: [] } }] as never })
 expect(() => run()).toThrow(/غير مسموح/); expect(S().journal).toHaveLength(0)
})
it('يرفض تكرار معرف سجل مرتبط حتى لو تكرر لموظف آخر', () => {
 useRawDataStore.setState({ employeeAdvances: [{ id: 1, employeeId: 1, date: '2026-11-03', branchId: 1, amountMinor: 500, recoveredMinor: 0 }, { id: 1, employeeId: 2, date: '2026-11-03', branchId: 2, amountMinor: 500, recoveredMinor: 0 }] as never })
 expect(() => run({ advancesMinor: 500 })).toThrow(/فريد/); expect(S().journal).toHaveLength(0)
})
