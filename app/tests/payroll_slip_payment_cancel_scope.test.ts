import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const branch = (id: number, isMain: boolean) => ({ id, nameAr: `فرع ${id}`, isMain, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1121' })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [branch(1, true), branch(2, false)] as never, employees: [{ id: 1, nameAr: 'موظف', active: true, branchId: 1 }] as never, treasuries: [{ code: '1101', nameAr: 'رئيسية', kind: 'cash', isDefault: true, branchId: 1 }, { code: '1121', nameAr: 'أخرى', kind: 'cash', branchId: 2 }] as never, payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], employeeDeductions: [] })
 S().accruePayrollSlips({ month: '2026-11', rows: [{ employeeId: 1, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const pay = (treasury = '1101') => S().payPayrollSlip(S().payrollSlips[0].id, { treasury, amountMinor: 500 })
const cancel = () => S().cancelPayrollSlip(S().payrollSlips[0].id, 'تصحيح')
it('يرفض صرف أو إلغاء قسيمة فرع آخر أو مستخدم بلا صلاحية دون كتابة', () => {
 useRawDataStore.setState({ activeBranchId: 2 }); let before = S(); expect(() => pay('1121')).toThrow(/فرع آخر/); expect(() => cancel()).toThrow(/فرع آخر/); expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ activeBranchId: 1, currentUserId: 999 }); before = S(); expect(() => pay()).toThrow(/صلاحية/); expect(() => cancel()).toThrow(/صلاحية/); expect(S().payrollSlips).toBe(before.payrollSlips)
})
it('يمنع خزينة فرع آخر وسقف الخزينة في الصرف المباشر', () => {
 expect(() => pay('1121')).toThrow(/فرع آخر/)
 useRawDataStore.setState({ currentUserId: 9, appUsers: [{ id: 9, nameAr: 'مالك', active: true, roleId: 'owner', treasuryAccess: { grants: [] } }] as never })
 expect(() => pay()).toThrow(/غير مسموح/); expect(S().payrollSlips[0].payments).toBeUndefined()
})
it('يمنع عكس تخصيص جزاء مفقود أو غير كاف دون تعديل القيد أو الجزاء', () => {
 const slip = S().payrollSlips[0]; useRawDataStore.setState({ payrollSlips: [{ ...slip, deductionsMinor: 500, recoveredDeductions: [{ deductionId: 7, minor: 500 }] }] })
 let before = S(); expect(() => cancel()).toThrow(/غير مثبت/); expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ employeeDeductions: [{ id: 7, employeeId: 1, branchId: 1, date: '2026-11-01', amountMinor: 500, recoveredMinor: 100, reason: 'سبب', notes: '' }] as never })
 before = S(); expect(() => cancel()).toThrow(/غير كاف/); expect(S().employeeDeductions).toBe(before.employeeDeductions)
})
it('يعكس تخصيص الجزاء الصحيح مرة واحدة', () => {
 const slip = S().payrollSlips[0]; useRawDataStore.setState({ payrollSlips: [{ ...slip, deductionsMinor: 500, recoveredDeductions: [{ deductionId: 7, minor: 500 }] }], employeeDeductions: [{ id: 7, employeeId: 1, branchId: 1, date: '2026-11-01', amountMinor: 700, recoveredMinor: 600, reason: 'سبب', notes: '' }] as never })
 cancel(); expect(S().employeeDeductions[0].recoveredMinor).toBe(100); expect(() => cancel()).toThrow(/ملغاة/)
})
