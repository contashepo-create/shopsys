import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 3, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], suppliers: [], sales: [], purchases: [], vouchers: [], cheques: [], clientSettlements: [], partyOffsets: [], openingBalances: {}, journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' }); S().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 S().setOpeningBalance({ kind: 'customer', refId: S().customers[0].id, amountMinor: 1000, label: 'عميل' }); S().setOpeningBalance({ kind: 'supplier', refId: S().suppliers[0].id, amountMinor: 800, label: 'مورد' })
 vi.setSystemTime(new Date(2026, 10, 5, 12))
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const offset = (date?: string) => S().postPartyOffset({ customerId: S().customers[0].id, supplierId: S().suppliers[0].id, amountMinor: 500, ...(date === undefined ? {} : { date }) })
it('تربط المقاصة والقيد بتاريخها وكشفي الطرفين وتحفظ وقت التسجيل', () => {
 const doc = offset('2026-11-04'); expect(doc).toMatchObject({ date: '2026-11-04', createdAt: expect.stringContaining('2026-11-05') })
 const entry = S().journal.find(e => e.id === doc.journalEntryId)!; expect(entry.date).toBe(doc.date)
 expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1104', credit: 500 }), expect.objectContaining({ accountCode: '2101', debit: 500 })]))
 expect(S().getCustomerBalance(doc.customerId)).toBe(500); expect(S().getSupplierBalance(doc.supplierId)).toBe(300)
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض التاريخ %s بلا أثر', date => {
 const before = S(); expect(() => offset(date)).toThrow(/تاريخ/); expect(S().partyOffsets).toBe(before.partyOffsets); expect(S().journal).toBe(before.journal)
})
it('يرفض تاريخاً سابقاً لأصل الذمتين والسنة المقفلة', () => {
 expect(() => offset('2026-11-02')).toThrow(/ذمة/)
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => offset('2026-11-04')).toThrow(/مقفلة/); expect(S().partyOffsets).toHaveLength(0)
})
it('يرفض تقديم مقاصة على أخرى مسجلة', () => {
 offset('2026-11-04'); const before = S(); expect(() => offset('2026-11-03')).toThrow(/ذمة/); expect(S().partyOffsets).toBe(before.partyOffsets)
})
it('لا يطبق تاريخاً مبتوراً من ختم وقت؛ الافتراضي اليوم للمستدعي القديم', () => {
 expect(() => offset('2026-11-04T23:00:00Z')).toThrow(/تاريخ/)
 const doc = offset(); expect(doc.date).toBe('2026-11-05')
})
