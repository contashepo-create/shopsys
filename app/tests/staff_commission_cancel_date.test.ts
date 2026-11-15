import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], journal: [] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 1000, description: 'عمولة', date: '2026-11-03' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const cancel = (date: string) => S().cancelStaffCommission({ commissionId: S().staffCommissions[0].id, reason: 'تصحيح', date })
it('تاريخ الإلغاء وقيده مستقلان عن الاستحقاق ووقت التسجيل وينعكسان في الكشف', () => {
 const c = cancel('2026-11-04'), e = S().journal.at(-1)!
 expect(c).toMatchObject({ date: '2026-11-03', status: 'cancelled', cancelDate: '2026-11-04', cancelCreatedAt: expect.stringContaining('2026-11-05'), cancelEntryId: e.id })
 expect(e.date).toBe('2026-11-04'); expect(e.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['2116', 1000, 0], ['5117', 0, 1000]])
 expect(S().getEmployeeStatementRows(c.employeeId).map(r => [r.date, r.debitMinor, r.creditMinor])).toEqual([['2026-11-03', 0, 1000], ['2026-11-04', 1000, 0]])
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z', '2026-11-02'])('يرفض التاريخ %s دون تغيير', date => {
 const before = S(); expect(() => cancel(date)).toThrow(/تاريخ/); expect(S().journal).toBe(before.journal); expect(S().staffCommissions).toBe(before.staffCommissions)
})
it('يرفض السنة المقفلة والحركة اللاحقة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => cancel('2026-11-04')).toThrow(/مقفلة/); useAppStore.setState({ fiscalYears: [] })
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 500, description: 'أخرى', date: '2026-11-05' })
 expect(() => cancel('2026-11-04')).toThrow(/التسلسل/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يوقف البيانات القديمة بلا قيد مثبت والمستخدم بلا صلاحية', () => {
 const com = S().staffCommissions[0]; useRawDataStore.setState({ staffCommissions: [{ ...com, accrualEntryId: 999 }] })
 expect(() => cancel('2026-11-04')).toThrow(/غير مثبت/)
 useRawDataStore.setState({ staffCommissions: [com], currentUserId: 999 }); expect(() => cancel('2026-11-04')).toThrow(/صلاحية/)
 expect(S().staffCommissions[0].status).toBe('accrued')
})
it('لا تلغي عمولة غير مثبتة في الفرع المحدد', () => {
 useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'ثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }] as never, activeBranchId: 2 })
 expect(() => cancel('2026-11-04')).toThrow(/الفرع/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('تمنع تكرار معرف القيد حتى لو بقيت حركة أخرى مطابقة', () => {
 const entry = S().journal[0]; useRawDataStore.setState({ journal: [...S().journal, { ...entry, description: 'مكرر' }] })
 expect(() => cancel('2026-11-04')).toThrow(/غير مثبت/); expect(S().staffCommissions[0].status).toBe('accrued')
})
