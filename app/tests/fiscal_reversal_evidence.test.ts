import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fiscalCloseReversalClaims, fiscalCloseStateRepairs, isFiscalCloseReversalValid, type FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const activity: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const originalData = useRawDataStore.getState(), originalApp = useAppStore.getState()
const S = () => useRawDataStore.getState()
beforeEach(() => { useAppStore.setState({ ...originalApp, fiscalYears: [year] }); useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, appUsers: [], journal: [activity] }) })
afterEach(() => { useAppStore.setState(originalApp); useRawDataStore.setState(originalData) })

describe('دليل عكس قيد الإقفال قبل استعادة الفترة', () => {
 it('يحافظ على أبعاد السطور عند إنشاء العكس ويتحقق منها لاحقاً', () => {
  S().closeFiscalYear(year, [year])
  const closed = useAppStore.getState().fiscalYears[0]
  const closing = S().journal[1]
  const dimensional = { ...closing, lines: closing.lines.map((line, i) => i === 0 ? { ...line, costCenterId: 9, partyKind: 'customer' as const, partyId: 4, relatedBranchId: 2 } : line) }
  useRawDataStore.setState({ journal: [activity, dimensional] })
  S().reopenFiscalYear(closed, [closed])
  const [, saved, reversal] = S().journal
  expect(reversal.lines[0]).toMatchObject({ costCenterId: 9, partyKind: 'customer', partyId: 4, relatedBranchId: 2 })
  expect(isFiscalCloseReversalValid(S().journal, saved)).toBe(true)
  for (const patch of [{ costCenterId: 10 }, { partyKind: 'supplier' as const }, { partyId: 5 }, { relatedBranchId: 3 }]) {
   const corrupt = { ...reversal, lines: [{ ...reversal.lines[0], ...patch }, ...reversal.lines.slice(1)] }
   expect(isFiscalCloseReversalValid([activity, saved, corrupt], saved)).toBe(false)
   expect(fiscalCloseStateRepairs([closed], [activity, saved, corrupt])).toEqual({ closeIds: [], reopenIds: [] })
  }
 })
 it('يرفض عاكساً ثانياً أو عاكساً يسبق الأصل حتى لو تطابقت الأطراف', () => {
  S().closeFiscalYear(year, [year]); const closed = useAppStore.getState().fiscalYears[0]
  S().reopenFiscalYear(closed, [closed]); const [base, closing, reverse] = S().journal
  const ghost = { ...reverse, id: 99, entryNumber: 99, reversesEntryId: null }
  expect(fiscalCloseReversalClaims([base, closing, reverse, ghost], closing)).toHaveLength(2)
  expect(isFiscalCloseReversalValid([base, closing, reverse, ghost], closing)).toBe(false)
  expect(isFiscalCloseReversalValid([base, reverse, closing], closing)).toBe(false)
  useAppStore.setState({ fiscalYears: [closed] }); useRawDataStore.setState({ journal: [base, closing, reverse, ghost] })
  expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس قيد الإقفال غير مثبت/)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
 })
 it('لا يرمم حالة الإقفال أو ينشئ عكساً إذا وجدت مطالبة عكس غير مرتبطة بالأصل', () => {
  S().closeFiscalYear(year, [year]); const closed = useAppStore.getState().fiscalYears[0]
  const [base, closing] = S().journal
  const ghost: JournalEntry = { ...base, id: 88, entryNumber: 88, sourceType: 'reversal', sourceId: closing.id, reversesEntryId: null }
  const ledger = [base, closing, ghost]
  useRawDataStore.setState({ journal: ledger }); useAppStore.setState({ fiscalYears: [year] })
  expect(fiscalCloseStateRepairs([year], ledger)).toEqual({ closeIds: [], reopenIds: [] })
  expect(() => S().closeFiscalYear(year, [year])).toThrow(/عكس قيد الإقفال غير مثبت/)
  useAppStore.setState({ fiscalYears: [closed] })
  expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس قيد الإقفال غير مثبت/)
  expect(S().journal).toBe(ledger)
 })
})
