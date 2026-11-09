import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], vouchers: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().postManualEntry({ date: '2026-11-02', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 S().accruePayrollSlips({ month: '2026-11', date: '2026-11-03', rows: [{ employeeId: S().employees[0].id, grossMinor: 3000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const pay = (date: string, amountMinor = 1000) => S().payPayrollSlip(S().payrollSlips[0].id, { treasury: '1101', amountMinor, date })
it('قيد الصرف والدفعة بتاريخ مختار ووقت تسجيل حقيقي مستقلاً', () => {
 const c = pay('2026-11-04'); expect(c.payments?.[0]).toMatchObject({ date: '2026-11-04', createdAt: expect.stringContaining('2026-11-05') })
 expect(S().journal.at(-1)).toMatchObject({ date: '2026-11-04', createdAt: expect.stringContaining('2026-11-05') }); expect(() => pay('2026-11-03')).toThrow(/لاحق|التسلسل/)
 pay('2026-11-05', 2000); expect(S().payrollSlips[0]).toMatchObject({ status: 'paid', paidAt: expect.stringContaining('2026-11-05') })
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z', '2026-11-02'])('يرفض التاريخ %s دون كتابة', date => {
 const before = S(); expect(() => pay(date)).toThrow(/تاريخ/); expect(S().payrollSlips).toBe(before.payrollSlips); expect(S().journal).toBe(before.journal)
})
it('يحجب الفترة المقفلة وعدم كفاية رصيد الماضي والحركة اللاحقة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] }); expect(() => pay('2026-11-04')).toThrow(/مقفلة/)
 useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ journal: S().journal.filter(e => e.sourceType !== 'manual') }); expect(() => pay('2026-11-04')).toThrow(/لا يكفي/)
 S().postManualEntry({ date: '2026-11-05', description: 'حركة', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] }); expect(() => pay('2026-11-04')).toThrow(/التسلسل/)
})
it('يمنع فقد الدليل أو تناقض الدفعة السابقة', () => {
 const slip = S().payrollSlips[0]; useRawDataStore.setState({ payrollSlips: [{ ...slip, accrualEntryId: 999 }] }); expect(() => pay('2026-11-04')).toThrow(/غير مثبت/)
 useRawDataStore.setState({ payrollSlips: [slip] }); pay('2026-11-04'); useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(s => ({ ...s, payments: s.payments?.map(p => ({ ...p, date: '2026-11-03' })) })) }); expect(() => pay('2026-11-05')).toThrow(/غير مثبت/)
})
it('لا يحتسب تمويلاً مثبتاً في فرع آخر كرصيد تاريخي للخزينة', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, employees: S().employees.map(e => ({ ...e, branchId: 1 })), treasuries: S().treasuries.map(t => ({ ...t, branchId: 1 })), payrollSlips: S().payrollSlips.map(s => ({ ...s, branchId: 1 })), journal: S().journal.map(e => ({ ...e, branchId: e.sourceType === 'manual' ? 2 : 1 })) })
 const before = S(); expect(() => pay('2026-11-04')).toThrow(/خارج الفرع/); expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
})
