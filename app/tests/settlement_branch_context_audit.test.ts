import { afterEach, beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
beforeEach(() => {
 useAppStore.setState({ ...app, fiscalYears: [], setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...original, branches, activeBranchId: 1, currentUserId: null, settlements: [], journal: [], customers: [], suppliers: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
it('رصيد التسوية يقتصر على قيود الفرع ولا يضم قيداً تاريخياً من فرع آخر', () => {
 const day = todayLocalIso()
 const entry = (id: number, branchId: number, amount: number) => ({ id, entryNumber: id, date: day, branchId, sourceType: 'opening' as const, sourceId: null, description: 'افتتاحي', lines: [{ accountCode: '1101', debit: amount, credit: 0 }, { accountCode: '3101', debit: 0, credit: amount }], createdBy: 'المالك', createdAt: day, reversedByEntryId: null, reversesEntryId: null })
 useRawDataStore.setState({ journal: [entry(1, 1, 100), entry(2, 2, 500)] })
 const doc = useDataStore.getState().applySettlement({ section: 'treasury', refId: '1101', actualMinor: 100, reason: 'مطابقة' })
 expect(doc.bookMinor).toBe(100)
 expect(doc.varianceMinor).toBe(0)
 expect(doc.journalEntryId).toBeNull()
})
it('يرفض المبلغ غير الآمن حتى عندما لا ينشأ قيد', () => {
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().applySettlement({ section: 'treasury', refId: '1101', actualMinor: Number.MAX_SAFE_INTEGER + 1, reason: 'مطابقة' })).toThrow(/الدقة الآمنة/)
 expect(useRawDataStore.getState().settlements).toBe(before.settlements)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا تسوية في النطاق الشامل أو على خزينة فرع آخر أو في سنة مقفلة حتى بلا فرق', () => {
 const apply = () => useDataStore.getState().applySettlement({ section: 'treasury', refId: '1101', actualMinor: 0, reason: 'مطابقة' })
 useRawDataStore.setState({ activeBranchId: null })
 let before = useRawDataStore.getState(); expect(apply).toThrow(/حدد الفرع/); expect(useRawDataStore.getState().settlements).toBe(before.settlements)
 useRawDataStore.setState({ activeBranchId: 2 })
 before = useRawDataStore.getState(); expect(apply).toThrow(/الفرع/); expect(useRawDataStore.getState().journal).toBe(before.journal)
 useRawDataStore.setState({ activeBranchId: 1 })
 const day = todayLocalIso()
 useAppStore.setState({ fiscalYears: [{ id: 1, branchId: 1, nameAr: 'مقفلة', startDate: day, endDate: day, status: 'closed' }] })
 before = useRawDataStore.getState(); expect(apply).toThrow(/المقفلة/); expect(useRawDataStore.getState().settlements).toBe(before.settlements)
})
