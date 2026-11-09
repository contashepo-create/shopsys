import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], vouchers: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 S().postManualEntry({ date: '2026-11-02', description: 'تمويل', lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 5000 }] })
 S().accruePayrollSlips({ month: '2026-11', date: '2026-11-03', rows: [{ employeeId: S().employees[0].id, grossMinor: 3000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const args = (date: string, amountMinor = 1000) => ({ kind: 'payment' as const, date, treasury: '1101', counterAccountCode: '2104', partyKind: 'employee' as const, partyId: S().employees[0].id, amountMinor, description: 'راتب', settleSlipIds: [S().payrollSlips[0].id] })
const post = (date: string, amount = 1000) => S().postVoucher(args(date, amount))
it('يحفظ السند والقيد وتخصيص الدفعة ذرياً بتاريخه مع وقت تسجيل مستقل وكشف صحيح', () => {
 const snapshots: number[][] = []; const off = useRawDataStore.subscribe(s => snapshots.push([s.vouchers.length, s.journal.length, s.payrollSlips[0].payments?.length ?? 0]))
 const v = post('2026-11-04'); off()
 expect(snapshots).toEqual([[1, 3, 1]]); expect(v).toMatchObject({ date: expect.stringContaining('2026-11-04'), createdAt: expect.stringContaining('2026-11-05') })
 expect(S().journal.at(-1)?.date).toBe('2026-11-04'); expect(S().payrollSlips[0].payments?.[0]).toMatchObject({ date: '2026-11-04', amountMinor: 1000, entryId: v.journalEntryId })
 const rows = S().getEmployeeStatementRows(S().employees[0].id); const bal = (day: string) => rows.filter(r => r.date.slice(0, 10) <= day).reduce((n, r) => n + r.creditMinor - r.debitMinor, 0)
 expect(bal('2026-11-03')).toBe(3000); expect(bal('2026-11-04')).toBe(2000)
})
it('الدفعة الثانية لا تسبق الأولى وتستكمل القسيمة بتاريخ السند', () => {
 post('2026-11-04'); const before = S(); expect(() => post('2026-11-03')).toThrow(/لاحق|التسلسل/); expect(S().journal).toBe(before.journal)
 post('2026-11-05', 2000); expect(S().payrollSlips[0]).toMatchObject({ status: 'paid', paidAt: expect.stringContaining('2026-11-05') }); expect(S().payrollSlips[0].payments?.map(p => p.date)).toEqual(['2026-11-04', '2026-11-05'])
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z', '2026-11-02'])('يرفض التاريخ %s دون أثر', date => {
 const before = S(); expect(() => post(date)).toThrow(/تاريخ/); expect(S().vouchers).toBe(before.vouchers); expect(S().payrollSlips).toBe(before.payrollSlips); expect(S().journal).toBe(before.journal)
})
it('يحجب الفترة المقفلة أو التاريخ السابق لحركة خزينة لاحقة أو الرصيد غير الكافي', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] }); expect(() => post('2026-11-04')).toThrow(/مقفلة/)
 useAppStore.setState({ fiscalYears: [] }); expect(() => post('2026-11-04', 6000)).toThrow(/لا يكفي/)
 S().postManualEntry({ date: '2026-11-05', description: 'حركة', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '3101', debit: 0, credit: 100 }] }); expect(() => post('2026-11-04')).toThrow(/التسلسل/)
})
it('يحمي القسيمة المكررة والفرع والصلاحية والأصل المفقود', () => {
 const x = args('2026-11-04'); expect(() => S().postVoucher({ ...x, settleSlipIds: [...x.settleSlipIds, ...x.settleSlipIds] })).toThrow(/مكررة/)
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => post('2026-11-04')).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null, payrollSlips: S().payrollSlips.map(s => ({ ...s, accrualEntryId: 999 })) }); expect(() => post('2026-11-04')).toThrow(/غير مثبت/); expect(S().vouchers).toHaveLength(0)
})
it('يرفض بيانات دفعة سابقة متناقضة ويمنع عكس السند أو قيده بلا إعادة تخصيص', () => {
 const v = post('2026-11-04'); const before = S(); expect(() => S().reverseVoucher(v.id, 'تصحيح')).toThrow(/تسوية القسيمة/); expect(() => S().reverseEntry(v.journalEntryId, 'تصحيح')).toThrow(/تسوية القسيمة/); expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(s => ({ ...s, payments: s.payments?.map(p => ({ ...p, date: '2026-11-03' })) })) }); expect(() => post('2026-11-05')).toThrow(/غير مثبت/)
})
