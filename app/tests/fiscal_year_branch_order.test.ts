import { afterEach, describe, expect, it } from 'vitest'
import type { JournalEntry } from '../src/core/ledger.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initialData = useRawDataStore.getState()
const initialApp = useAppStore.getState()

const year = (id: number, branchId: number, startYear: number, status: FiscalYear['status'] = 'open'): FiscalYear => ({
  id,
  branchId,
  nameAr: String(startYear),
  startDate: `${startYear}-01-01`,
  endDate: `${startYear}-12-31`,
  status,
})

const revenueEntry = (id: number, branchId: number, startYear: number): JournalEntry => ({
  id,
  entryNumber: id,
  branchId,
  date: `${startYear}-06-15`,
  description: `إيراد اختبار الفرع ${branchId}`,
  sourceType: 'manual',
  sourceId: null,
  lines: [
    { accountCode: '1101', debit: 100_00, credit: 0, note: 'نقدية' },
    { accountCode: '4101', debit: 0, credit: 100_00, note: 'إيراد' },
  ],
  createdBy: 'اختبار',
  createdAt: `${startYear}-06-15T12:00:00.000Z`,
  reversedByEntryId: null,
  reversesEntryId: null,
})

afterEach(() => {
  useRawDataStore.setState(initialData, true)
  useAppStore.setState(initialApp, true)
})

describe('ترتيب الإقفال وإعادة الفتح مستقل لكل فرع', () => {
  it('لا تجعل سنة أقدم مفتوحة في فرع آخر حائلًا دون إقفال، ولا تمنع إعادة الفتح بين الفروع', () => {
    const years = [year(1, 10, 2024), year(2, 10, 2025), year(3, 20, 2024)]
    useAppStore.setState({ ...initialApp, fiscalYears: years })
    useRawDataStore.setState({
      ...initialData,
      currentUserId: null,
      appUsers: [],
      activeBranchId: 10,
      branches: [
        { id: 10, nameAr: 'الرئيسي', isMain: true, warehouseId: 10, treasuryCode: 'cash-10', active: true },
        { id: 20, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 20, treasuryCode: 'cash-20', active: true },
      ],
      journal: [revenueEntry(1, 10, 2024), revenueEntry(2, 10, 2025), revenueEntry(3, 20, 2024)],
    })

    const closeYear = (id: number) => {
      const allYears = useAppStore.getState().fiscalYears
      const target = allYears.find((candidate) => candidate.id === id)!
      return useRawDataStore.getState().closeFiscalYear(target, allYears)
    }
    const reopenYear = (id: number) => {
      const allYears = useAppStore.getState().fiscalYears
      const target = allYears.find((candidate) => candidate.id === id)!
      return useRawDataStore.getState().reopenFiscalYear(target, allYears)
    }

    expect(() => closeYear(2)).toThrow(/أقفل السنة الأقدم/)
    closeYear(1)
    expect(() => closeYear(2)).not.toThrow()

    // الفرع الثاني يستطيع إقفال سنته ثم فتحها حتى مع وجود سنة أحدث مقفلة في الرئيسي.
    useRawDataStore.setState({ activeBranchId: 20 })
    closeYear(3)
    expect(reopenYear(3).reversedEntryId).toBeTypeOf('number')

    // يبقى ترتيب العكس مفروضاً داخل الفرع نفسه: افتح 2025 قبل 2024.
    useRawDataStore.setState({ activeBranchId: 10 })
    expect(() => reopenYear(1)).toThrow(/أعد فتح السنة الأحدث المقفلة/)
    expect(reopenYear(2).reversedEntryId).toBeTypeOf('number')
    expect(reopenYear(1).reversedEntryId).toBeTypeOf('number')
  })
})
