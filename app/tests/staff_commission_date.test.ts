import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], sales: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 100000, isDefault: true }] as never })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const add = (date?: string) => S().addStaffCommission({ employeeId: S().employees[0].id, source: 'manual', sourceId: null, amountMinor: 1000, description: 'عمولة', ...(date === undefined ? {} : { date }) })
it('يثبت التاريخ على الاستحقاق والقيد مع وقت تسجيل مستقل', () => {
 const c = add('2026-11-03'), e = S().journal[0]
 expect(c.date).toBe('2026-11-03'); expect(e.date).toBe(c.date); expect(c.createdAt.slice(0, 10)).toBe('2026-11-05'); expect(e.createdAt.slice(0, 10)).toBe('2026-11-05')
 expect(e.lines.map(l => l.accountCode)).toEqual(['5117', '2116'])
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض التاريخ %s دون حركة', date => { expect(() => add(date)).toThrow(/تاريخ/); expect(S().staffCommissions).toHaveLength(0); expect(S().journal).toHaveLength(0) })
it('يحرس السنة المقفلة وتسلسل العمولة والقيد', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-02', status: 'closed' }, { id: 2, nameAr: 'مفتوحة', startDate: '2026-11-03', endDate: '2026-12-31', status: 'open' }] })
 expect(() => add('2026-11-02')).toThrow(/مقفلة/); add('2026-11-04'); expect(() => add('2026-11-03')).toThrow(/التسلسل/)
 useRawDataStore.setState({ staffCommissions: [] }); expect(() => add('2026-11-03')).toThrow(/حركة عمولات/)
 expect(S().journal).toHaveLength(1)
})
it('يرفض مصدر العملية السابقة دون دليل تسلسل وصلاحية غائبة', () => {
 useRawDataStore.setState({ sales: [{ id: 8 }] as never })
 expect(() => S().addStaffCommission({ employeeId: S().employees[0].id, source: 'sale', sourceId: 8, amountMinor: 1000, description: 'بيع', date: '2026-11-04' })).toThrow(/اليدوية فقط/)
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => add('2026-11-05')).toThrow(/صلاحية/)
 expect(S().staffCommissions).toHaveLength(0)
})
it('يبقي المسار القديم دون تاريخ مختار بتاريخ اليوم', () => { expect(add().date).toBe('2026-11-05') })

it('الصرف والإلغاء اللاحقان يبقيان يومهما ولا يغيران تاريخ الأصل', () => {
 const c = add('2026-11-03'); S().payStaffCommission({ commissionId: c.id, treasury: '1101' })
 expect(S().staffCommissions[0]).toMatchObject({ date: '2026-11-03', status: 'paid' }); expect(S().journal.map(e => e.date)).toEqual(['2026-11-03', '2026-11-05'])
 const second = add('2026-11-05'); S().cancelStaffCommission({ commissionId: second.id, reason: 'تصحيح' })
 expect(S().staffCommissions[1].status).toBe('cancelled'); expect(S().journal.at(-1)?.date).toBe('2026-11-05')
})
it('يلزم المستند المصدر في الواجهة ويمنع معرفاً لليدوية', () => {
 const base = { employeeId: S().employees[0].id, amountMinor: 1000, description: 'عمولة', date: '2026-11-05' }
 expect(() => S().addStaffCommission({ ...base, source: 'sale', sourceId: null })).toThrow(/المستند/)
 expect(() => S().addStaffCommission({ ...base, source: 'manual', sourceId: 1 })).toThrow(/اليدوية/)
 expect(S().journal).toHaveLength(0)
})
