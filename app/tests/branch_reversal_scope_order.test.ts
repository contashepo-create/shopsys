import { expect, it } from 'vitest'
import type { JournalEntry } from '../src/core/ledger.ts'
import { getBranchScopedDataState, useRawDataStore } from '../src/data/repo.ts'

const state = useRawDataStore.getState()
const branches = [{ id: 1, nameAr: 'الأول', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
const make = (id: number, branchId?: number): JournalEntry => ({ id, entryNumber: id, date: '2024-06-01', description: 'قيد', sourceType: 'manual', sourceId: null, ...(branchId != null ? { branchId } : {}), lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null })
const rev = (id: number, parent: number, branchId?: number): JournalEntry => ({ ...make(id, branchId), sourceType: 'reversal', sourceId: parent, reversesEntryId: parent })
const scoped = (journal: JournalEntry[], branchId: number) => getBranchScopedDataState({ ...state, currentUserId: null, branches, activeBranchId: branchId, journal }).journal.map(row => row.id)

it('يظهر العكس غير المسند في فرع أصله حتى لو سبق الأصل في المصفوفة ويحفظ الترتيب', () => {
 const one = make(1, 1), other = make(2, 2), reversal = rev(3, 1)
 expect(scoped([reversal, other, one], 1)).toEqual([3, 1])
 expect(scoped([reversal, other, one], 2)).toEqual([2])
 expect(scoped([one, other, reversal], 1)).toEqual([1, 3])
})
it('يتتبع السلسلة ولا يكشف عكساً مسنداً صراحة لفرع آخر أو عكساً مجهول الأصل', () => {
 const journal = [rev(4, 3), rev(3, 1), rev(5, 1, 2), rev(6, 99), make(1, 1), make(2, 2)]
 expect(scoped(journal, 1)).toEqual([4, 3, 1])
 expect(scoped(journal, 2)).toEqual([5, 2])
})
it('لا يخمن انتماء العكس عندما يكون رقم الأصل مكرراً بين فرعين', () => {
 const journal = [rev(3, 1), make(1, 1), make(1, 2)]
 expect(scoped(journal, 1)).toEqual([1])
 expect(scoped(journal, 2)).toEqual([1])
})
