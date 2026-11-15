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
const rows = () => S().getEmployeeStatementRows(S().employees[0].id).filter(r => r.ref === S().staffCommissions[0].code)
const balances = (date: string) => rows().filter(r => r.date <= date).reduce((sum, r) => sum + r.creditMinor - r.debitMinor, 0)
it('يعكس رصيد العمولة بعد الاستحقاق وقبل الصرف وبعده دون أثر مزدوج', () => {
 S().payStaffCommission({ commissionId: S().staffCommissions[0].id, treasury: '1101', date: '2026-11-04' })
 expect(rows().map(r => [r.date, r.debitMinor, r.creditMinor])).toEqual([['2026-11-03', 0, 1000], ['2026-11-04', 1000, 0]])
 expect(balances('2026-11-02')).toBe(0); expect(balances('2026-11-03')).toBe(1000); expect(balances('2026-11-04')).toBe(0)
})
it('يعرض الإلغاء بتاريخ قيده ويُبقي الاستحقاق الأصلي', () => {
 S().cancelStaffCommission({ commissionId: S().staffCommissions[0].id, reason: 'تصحيح' })
 expect(rows().map(r => [r.date, r.debitMinor, r.creditMinor])).toEqual([['2026-11-03', 0, 1000], ['2026-11-05', 1000, 0]])
 expect(balances('2026-11-04')).toBe(1000); expect(balances('2026-11-05')).toBe(0)
})
it('لا يختلق تاريخاً للبيانات التي فُقد قيدها', () => {
 S().payStaffCommission({ commissionId: S().staffCommissions[0].id, treasury: '1101', date: '2026-11-04' })
 useRawDataStore.setState({ journal: S().journal.filter(e => e.sourceType !== 'staff_commission_payout') })
 expect(rows()).toHaveLength(1); expect(rows()[0].description).toContain('غير مثبت'); expect(rows()[0].debitMinor).toBe(rows()[0].creditMinor)
})
it('يعرض تخفيض الاستحقاق المثبت قبل الصرف في يومه', () => {
 const c = S().staffCommissions[0], origin = S().journal.find(e => e.id === c.accrualEntryId)!
 const adjustment = { ...origin, id: 99, entryNumber: 99, date: '2026-11-04', description: 'تسوية مرتجع', lines: [{ accountCode: '2116', debit: 400, credit: 0 }, { accountCode: '5117', debit: 0, credit: 400 }] }
 useRawDataStore.setState({ staffCommissions: [{ ...c, amountMinor: 600, originalAmountMinor: 1000, returnAdjustedMinor: 400 }], journal: [...S().journal, adjustment] })
 S().payStaffCommission({ commissionId: c.id, treasury: '1101', date: '2026-11-05' })
 expect(rows().map(r => [r.date, r.debitMinor, r.creditMinor])).toEqual([['2026-11-03', 0, 1000], ['2026-11-04', 400, 0], ['2026-11-05', 600, 0]])
 expect(balances('2026-11-03')).toBe(1000); expect(balances('2026-11-04')).toBe(600); expect(balances('2026-11-05')).toBe(0)
})
it('تعديل العمولة يعرض الأصل وإلغاءه والبديل في تاريخهما', () => {
 const newCom = S().updateStaffCommissionAmount({ commissionId: S().staffCommissions[0].id, newAmountMinor: 1500, reason: 'تصحيح' })
 expect(rows().map(r => [r.date, r.debitMinor, r.creditMinor])).toEqual([['2026-11-03', 0, 1000], ['2026-11-05', 1000, 0]])
 const all = S().getEmployeeStatementRows(S().employees[0].id)
 expect(all.find(r => r.ref === newCom.code)).toMatchObject({ date: '2026-11-05', creditMinor: 1500 })
 expect(all.reduce((n, r) => n + r.creditMinor - r.debitMinor, 0)).toBe(1500)
})
