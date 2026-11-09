import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const transfer = (date: string) => S().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 1000, feeMinor: 100, description: 'تحويل', date })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], vouchers: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }, { code: '1102', nameAr: 'البنك', kind: 'bank' }] })
 S().postManualEntry({ date: '2026-11-02', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يربط تاريخ التحويل والسند والقيد والرسوم ويفصل وقت الإنشاء', () => {
 const v = transfer('2026-11-03'), e = S().journal.at(-1)!
 expect(v.date.slice(0, 10)).toBe('2026-11-03'); expect(v.createdAt?.slice(0, 10)).toBe('2026-11-05'); expect(e.date).toBe('2026-11-03'); expect(e.createdAt.slice(0, 10)).toBe('2026-11-05')
 expect(e.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['1102', 1000, 0], ['5108', 100, 0], ['1101', 0, 1100]])
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-03T12:00:00Z'])('يرفض التاريخ %s دون حركة', date => { const before = S(); expect(() => transfer(date)).toThrow(/تاريخ/); expect(S().journal).toBe(before.journal); expect(S().vouchers).toBe(before.vouchers) })
it('يرفض السنة المقفلة قبل إنشاء السند', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-03', status: 'closed' }] })
 expect(() => transfer('2026-11-03')).toThrow(/مقفلة/); expect(S().vouchers).toHaveLength(0)
})
it('يرفض تقديم التحويل على حركة المصدر أو الوجهة، ويقبل المساواة في اليوم', () => {
 S().postManualEntry({ date: '2026-11-04', description: 'بنك', lines: [{ accountCode: '1102', debit: 500, credit: 0 }, { accountCode: '3101', debit: 0, credit: 500 }] })
 expect(() => transfer('2026-11-03')).toThrow(/التسلسل/); expect(S().vouchers).toHaveLength(0); expect(transfer('2026-11-04').date.slice(0, 10)).toBe('2026-11-04')
})
it('لا يعتمد رصيداً حالياً لتمويل سابق أو يسمح بمصدر غير كاف رغم إعداد السالب', () => {
 expect(() => S().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 5000, feeMinor: 1, description: '', date: '2026-11-03' })).toThrow(/لا يكفي/)
 expect(S().vouchers).toHaveLength(0)
})
it('يتحقق من المستخدم والصلاحية والتعريف الفريد للخزينة', () => {
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => transfer('2026-11-03')).toThrow(/المستخدم/)
 useRawDataStore.setState({ currentUserId: null, treasuries: [...S().treasuries, S().treasuries[0]] }); expect(() => transfer('2026-11-03')).toThrow(/فريدة/)
 expect(S().vouchers).toHaveLength(0)
})
it('يرفض التأريخ السابق بين فرعين ويقبل اليوم ويؤرخ قيدي الفرعين', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'فرع', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1 })
 expect(() => transfer('2026-11-03')).toThrow(/بين فرعين/)
 const v = transfer('2026-11-05'); expect(v.branchTransfer).toBeDefined(); expect(S().journal.slice(-2).map(e => e.date)).toEqual(['2026-11-05', '2026-11-05'])
})
it('يحترم أذونات الخزينتين وحد المبلغ بما فيه الرسوم', () => {
 const user = { id: 9, active: true, roleId: 'cashier', treasuryAccess: { grants: [{ treasuryCode: '1101', operations: ['transfer_from'], maxAmountMinor: 1050 }, { treasuryCode: '1102', operations: ['transfer_to'] }] } }
 useRawDataStore.setState({ currentUserId: 9, appUsers: [user] as never })
 expect(() => transfer('2026-11-03')).toThrow(/الحد|حد المستخدم/); expect(S().vouchers).toHaveLength(0)
})
it('يرفض السنة المقفلة للفرع الوجهة في تحويل اليوم', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'فرع', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1 })
 useAppStore.setState({ fiscalYears: [{ id: 1, branchId: 2, nameAr: 'مقفلة الوجهة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 expect(() => transfer('2026-11-05')).toThrow(/مقفلة الوجهة/); expect(S().vouchers).toHaveLength(0)
})
it('يرفض فرع وجهة متوقف أو ربط خزينة متناقض', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'فرع', isMain: false, active: false, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1 })
 expect(() => transfer('2026-11-05')).toThrow(/فرع الخزينة/)
 useRawDataStore.setState({ branches: branches.map(b => ({ ...b, active: true })) as never, treasuries: S().treasuries.map(t => t.code === '1102' ? { ...t, branchId: 1 } : t) })
 expect(() => transfer('2026-11-05')).toThrow(/فرع الخزينة/); expect(S().vouchers).toHaveLength(0)
})
