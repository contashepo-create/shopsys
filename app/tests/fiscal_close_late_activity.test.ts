import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fiscalCloseStateRepairs, hasActivityAfterFiscalClose, type FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const originalData = useRawDataStore.getState()
const originalApp = useAppStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const entry: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const S = () => useRawDataStore.getState()

beforeEach(() => {
  useAppStore.setState({ ...originalApp, fiscalYears: [year] })
  useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, appUsers: [], journal: [entry] })
})
afterEach(() => { useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('مراجعة الحركة اللاحقة لقيد إقفال السنة', () => {
  it('لا تصلح حالة السنة المفتوحة ولا تستعيدها بطلب إقفال عند وجود قيد لاحق داخلها', () => {
    S().closeFiscalYear(year, [year])
    const closedJournal = S().journal
    const late = { ...entry, id: 3, entryNumber: 3, date: '2024-03-01' }
    useRawDataStore.setState({ journal: [...closedJournal, late] }) // محاكاة لقطة استعادة/دمج
    useAppStore.setState({ fiscalYears: [year] })
    const before = S().journal
    expect(fiscalCloseStateRepairs([year], before)).toEqual({ closeIds: [], reopenIds: [] })
    expect(() => S().closeFiscalYear(year, [year])).toThrow(/حركة لاحقة/)
    expect(S().journal).toBe(before)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
    expect(() => S().postManualEntry({ date: '2024-07-01', description: 'جديد', lines: entry.lines })).toThrow(/حالتها مفتوحة/)
    expect(S().journal).toBe(before)
  })
  it('لا يعكس إقفالاً نشطاً تغير أساسه عند طلب إعادة الفتح', () => {
    S().closeFiscalYear(year, [year])
    const closedYear = useAppStore.getState().fiscalYears[0]
    useRawDataStore.setState({ journal: [...S().journal, { ...entry, id: 3, entryNumber: 3 }] })
    const before = S().journal
    expect(() => S().reopenFiscalYear(closedYear, [closedYear])).toThrow(/حركة لاحقة/)
    expect(S().journal).toBe(before)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
  })
  it('يميز الفرع الآخر والفترة الأخرى ويرفض تاريخاً مجهولاً في فرع الفترة', () => {
    S().closeFiscalYear(year, [year])
    const closing = S().journal[1]
    const later = { ...entry, id: 3, entryNumber: 3 }
    expect(hasActivityAfterFiscalClose([entry, closing, { ...later, date: '2025-01-01' }], year, closing)).toBe(false)
    expect(hasActivityAfterFiscalClose([entry, closing, { ...later, branchId: 2 }], year, closing, 1)).toBe(false)
    expect(hasActivityAfterFiscalClose([entry, closing, { ...later, date: '2024-02-30' }], year, closing)).toBe(true)
    expect(hasActivityAfterFiscalClose([entry], year, closing)).toBe(true)
  })
  it('تسمح بفك إقفال مثبت بلا حركة لاحقة وإعادة الإقفال بعد تصحيح مشروع', () => {
    S().closeFiscalYear(year, [year])
    const closedYear = useAppStore.getState().fiscalYears[0]
    S().reopenFiscalYear(closedYear, [closedYear])
    S().postManualEntry({ date: '2024-07-01', description: 'تصحيح', lines: entry.lines })
    const reopened = useAppStore.getState().fiscalYears[0]
    expect(() => S().closeFiscalYear(reopened, [reopened])).not.toThrow()
  })
})
