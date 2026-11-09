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
const edit = (amount = 1500) => S().updateStaffCommissionAmount({ commissionId: S().staffCommissions[0].id, newAmountMinor: amount, reason: 'تصحيح' })
it('الإلغاء والاستحقاق الجديد وقيداهما في تحديث واحد دون تغيير تاريخ الأصل', () => {
 const snapshots: { statuses: string[]; journal: number }[] = []
 const off = useRawDataStore.subscribe(s => snapshots.push({ statuses: s.staffCommissions.map(c => c.status), journal: s.journal.length }))
 const revised = edit(); off()
 expect(snapshots).toEqual([{ statuses: ['cancelled', 'accrued'], journal: 3 }])
 expect(S().staffCommissions[0]).toMatchObject({ date: '2026-11-03', status: 'cancelled', cancelEntryId: S().journal[1].id })
 expect(revised).toMatchObject({ date: '2026-11-05', amountMinor: 1500, accrualEntryId: S().journal[2].id })
 expect(S().journal.slice(1).map(e => [e.sourceType, e.date])).toEqual([['staff_commission_cancel', '2026-11-05'], ['staff_commission', '2026-11-05']])
})
it('يرفض موظفاً موقوفاً أو مصدراً مفقوداً دون إلغاء الأصل', () => {
 useRawDataStore.setState({ employees: S().employees.map(e => ({ ...e, active: false })) })
 let before = S(); expect(() => edit()).toThrow(/غير نشط/); expect(S().journal).toBe(before.journal); expect(S().staffCommissions).toBe(before.staffCommissions)
 useRawDataStore.setState({ employees: S().employees.map(e => ({ ...e, active: true })), staffCommissions: S().staffCommissions.map(c => ({ ...c, source: 'sale', sourceId: 999 })) })
 before = S(); expect(() => edit()).toThrow(/المستند المصدر/); expect(S().journal).toBe(before.journal); expect(S().staffCommissions).toBe(before.staffCommissions)
})
it('يرفض الأرقام غير الآمنة والمرتجع السابق دون أي كتابة', () => {
 const before = S(); expect(() => edit(Number.MAX_SAFE_INTEGER + 1)).toThrow(/المبلغ/); expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ staffCommissions: S().staffCommissions.map(c => ({ ...c, returnAdjustedMinor: 100 })) })
 const after = S(); expect(() => edit()).toThrow(/مرتجع/); expect(S().staffCommissions).toBe(after.staffCommissions); expect(S().journal).toBe(after.journal)
})
it('لا يبقى إلغاء جزئي إن رفض الدفتر الفترة المقفلة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 const before = S(); expect(() => edit()).toThrow(/مقفلة/); expect(S().staffCommissions).toBe(before.staffCommissions); expect(S().journal).toBe(before.journal)
})
