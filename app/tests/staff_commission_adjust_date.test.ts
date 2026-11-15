import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], sales: [], saleReturns: [], journal: [] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 1000, description: 'عمولة', date: '2026-11-03' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const edit = (date: string) => S().updateStaffCommissionAmount({ commissionId: S().staffCommissions[0].id, newAmountMinor: 1500, reason: 'تصحيح', date })
it('تاريخ إلغاء الأصل والبديل والقيدين واحد ووقت التسجيل مستقل والكتابة ذرية', () => {
 const snapshots: string[][] = []; const off = useRawDataStore.subscribe(s => snapshots.push(s.staffCommissions.map(c => c.status)))
 const c = edit('2026-11-04'); off()
 expect(snapshots).toEqual([['cancelled', 'accrued']]); expect(S().staffCommissions[0]).toMatchObject({ date: '2026-11-03', cancelDate: '2026-11-04', cancelCreatedAt: expect.stringContaining('2026-11-05') })
 expect(c).toMatchObject({ date: '2026-11-04', createdAt: expect.stringContaining('2026-11-05'), amountMinor: 1500 })
 expect(S().journal.slice(1).map(e => e.date)).toEqual(['2026-11-04', '2026-11-04'])
 const rows = S().getEmployeeStatementRows(c.employeeId); const balance = (date: string) => rows.filter(r => r.date <= date).reduce((n, r) => n + r.creditMinor - r.debitMinor, 0)
 expect(balance('2026-11-03')).toBe(1000); expect(balance('2026-11-04')).toBe(1500)
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z', '2026-11-02'])('يرفض التاريخ %s دون تغيير', date => {
 const before = S(); expect(() => edit(date)).toThrow(/تاريخ/); expect(S().journal).toBe(before.journal); expect(S().staffCommissions).toBe(before.staffCommissions)
})
it('يرفض الفترة المقفلة أو قيد عمولة لاحق', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => edit('2026-11-04')).toThrow(/مقفلة/); useAppStore.setState({ fiscalYears: [] })
 S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 500, description: 'أخرى', date: '2026-11-05' })
 expect(() => edit('2026-11-04')).toThrow(/التسلسل/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('يرفض قيداً مفقوداً ومستخدماً غير مصرح وفرعاً مختلفاً', () => {
 const com = S().staffCommissions[0]; useRawDataStore.setState({ staffCommissions: [{ ...com, accrualEntryId: 999 }] })
 expect(() => edit('2026-11-04')).toThrow(/غير مثبت/)
 useRawDataStore.setState({ staffCommissions: [com], currentUserId: 999 }); expect(() => edit('2026-11-04')).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null, branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'ثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }] as never, activeBranchId: 2 })
 expect(() => edit('2026-11-04')).toThrow(/الفرع/); expect(S().staffCommissions[0].status).toBe('accrued')
})
it('لا يعيد تأريخ عمولة مرتبطة بمستند دون إثبات ترتيبه', () => {
 const c = S().staffCommissions[0]; useRawDataStore.setState({ staffCommissions: [{ ...c, source: 'sale', sourceId: 7 }], sales: [{ id: 7 }] as never })
 expect(() => edit('2026-11-04')).toThrow(/اليدوية/); expect(S().staffCommissions[0].status).toBe('accrued')
})
