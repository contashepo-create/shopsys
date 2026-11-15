import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().postManualEntry({ date: '2026-11-02', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 1000, description: 'عمولة', date: '2026-11-03' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const pay = (date: string) => S().payStaffCommission({ commissionId: S().staffCommissions[0].id, treasury: '1101', date })
it('تاريخ الصرف وقيده مستقلان عن الاستحقاق ووقت التسجيل', () => {
 const c = pay('2026-11-04'), e = S().journal.at(-1)!
 expect(c).toMatchObject({ date: '2026-11-03', status: 'paid', payoutDate: '2026-11-04', payoutCreatedAt: expect.stringContaining('2026-11-05'), payoutEntryId: e.id })
 expect(e.date).toBe('2026-11-04'); expect(e.createdAt.slice(0, 10)).toBe('2026-11-05'); expect(e.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['2116', 1000, 0], ['1101', 0, 1000]])
 expect(() => pay('2026-11-04')).toThrow(/مصروفة/)
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z', '2026-11-02'])('يرفض التاريخ %s دون تغيير', date => {
 const before = S(); expect(() => pay(date)).toThrow(/تاريخ/); expect(S().journal).toBe(before.journal); expect(S().staffCommissions).toBe(before.staffCommissions)
})
it('يرفض السنة المقفلة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => pay('2026-11-04')).toThrow(/مقفلة/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يرفض حركة خزينة لاحقة أو رصيداً غير كاف', () => {
 S().postManualEntry({ date: '2026-11-05', description: 'قبض', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '3101', debit: 0, credit: 100 }] })
 expect(() => pay('2026-11-04')).toThrow(/التسلسل/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يرفض فقد أو اختلاف أدلة الاستحقاق', () => {
 const c = S().staffCommissions[0]
 useRawDataStore.setState({ staffCommissions: [{ ...c, amountMinor: 1500 }] })
 expect(() => pay('2026-11-04')).toThrow(/لا يطابق/)
 useRawDataStore.setState({ staffCommissions: [{ ...c, accrualEntryId: 999 }] })
 expect(() => pay('2026-11-04')).toThrow(/غير مثبتة/); expect(S().journal).toHaveLength(2)
})
it('يرفض رصيداً لا يكفي رغم السماح بالسالب', () => {
 useRawDataStore.setState({ journal: S().journal.filter(e => e.sourceType !== 'manual') })
 expect(() => pay('2026-11-04')).toThrow(/لا يكفي/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يحمي صلاحية الموظف وخزينة الصرف', () => {
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => pay('2026-11-04')).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null, treasuries: [] }); expect(() => pay('2026-11-04')).toThrow(/الخزينة/)
 expect(S().staffCommissions[0].status).toBe('accrued')
})
it('لا يسبق قيد عمولة آخر أو تاريخاً مبهماً حتى دون حركة خزينة', () => {
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 200, description: 'عمولة أخرى', date: '2026-11-05' })
 expect(() => pay('2026-11-04')).toThrow(/التسلسل/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يرفض الخزينة المكررة أو الصلاحية المرفوضة', () => {
 useRawDataStore.setState({ treasuries: [...S().treasuries, S().treasuries[0]] })
 expect(() => pay('2026-11-04')).toThrow(/فريدة/)
 useRawDataStore.setState({ treasuries: [S().treasuries[0]], currentUserId: 9, appUsers: [{ id: 9, nameAr: 'مالك', active: true, roleId: 'owner', treasuryAccess: { grants: [] } }] as never })
 expect(() => pay('2026-11-04')).toThrow(/غير مسموح/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يرفض الموظف أو العمولة من فرع آخر', () => {
 useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'ثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }] as never, activeBranchId: 2 })
 expect(() => pay('2026-11-04')).toThrow(/الفرع/); expect(S().staffCommissions[0].status).toBe('accrued')
})
