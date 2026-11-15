import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const waive = (date?: string) => S().waiveEmployeeDeduction({ deductionId: 1, date, approvedBy: 'معتمد', reason: 'صفح' })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف', active: true }] as never, payrollRuns: [], payrollSlips: [], journal: [], employeeDeductions: [{ id: 1, dedNumber: 'DED-1', employeeId: 1, date: '2026-11-03', amountMinor: 1000, recoveredMinor: 0, reason: 'غياب', notes: '' }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يسجل تاريخ العفو ووقت التسجيل الفعلي دون قيد', () => {
 const result = waive('2026-11-04'); expect(result).toMatchObject({ waivedDate: '2026-11-04', waivedAt: expect.stringContaining('2026-11-05'), waivedMinor: 1000 }); expect(S().journal).toHaveLength(0)
 expect(() => S().addEmployeeDeduction({ employeeId: 1, date: '2026-11-03', amountMinor: 100, reason: 'غياب' })).toThrow(/التسلسل/)
})
it.each(['', '2026-02-30', '2026-11-06', '2026-11-02'])('يرفض التاريخ %s دون تغيير', date => { const before = S(); expect(() => waive(date)).toThrow(/تاريخ/); expect(S().employeeDeductions).toBe(before.employeeDeductions) })
it('يرفض السنة المقفلة وتخصيصاً غير صالح', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] }); expect(() => waive('2026-11-04')).toThrow(/مقفلة/)
 useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ employeeDeductions: S().employeeDeductions.map(d => ({ ...d, recoveredMinor: 1100 })) }); expect(() => waive()).toThrow(/غير صالح/)
})
it('يرفض الفرع والصلاحية أو المعرف المكرر دون تعديل', () => {
 const branches = [{ id: 1, nameAr: 'أ', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'ب', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, employees: [{ ...S().employees[0], branchId: 1 }], employeeDeductions: [{ ...S().employeeDeductions[0], branchId: 2 } as never] }); let before = S(); expect(() => waive()).toThrow(/فرع آخر/); expect(S().employeeDeductions).toBe(before.employeeDeductions)
 useRawDataStore.setState({ employeeDeductions: [{ ...S().employeeDeductions[0], branchId: 1 } as never], currentUserId: 999 }); expect(() => waive()).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null, employeeDeductions: [...S().employeeDeductions, S().employeeDeductions[0]] }); before = S(); expect(() => waive()).toThrow(/فريد/); expect(S().employeeDeductions).toBe(before.employeeDeductions)
})

it('لا يؤرخ عفواً سابقاً عن جزاء سبق استقطاعه دون دليل تخصيص كاف', () => {
 useRawDataStore.setState({ employeeDeductions: S().employeeDeductions.map(d => ({ ...d, recoveredMinor: 200 })) }); const before = S(); expect(() => waive('2026-11-04')).toThrow(/لا يمكن إثبات/); expect(S().employeeDeductions).toBe(before.employeeDeductions); expect(waive().waivedMinor).toBe(800)
})
