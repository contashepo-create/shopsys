import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fiscalCloseStateRepairs, isFiscalCloseBasisValid, type FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const originalData = useRawDataStore.getState(), originalApp = useAppStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const activity: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const S = () => useRawDataStore.getState()
beforeEach(() => { useAppStore.setState({ ...originalApp, fiscalYears: [year] }); useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, appUsers: [], journal: [activity] }) })
afterEach(() => { useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('أساس قيد الإقفال التاريخي', () => {
  it('يمنع الاستعادة والعكس لقيد متوازن بمبلغ لا يطابق دفتر الفترة', () => {
    S().closeFiscalYear(year, [year])
    const closed = useAppStore.getState().fiscalYears[0]
    const corrupt = { ...S().journal[1], lines: S().journal[1].lines.map(line => ({ ...line, debit: line.debit * 2, credit: line.credit * 2 })) }
    const ledger = [activity, corrupt]
    useRawDataStore.setState({ journal: ledger })
    expect(isFiscalCloseBasisValid(ledger, year, corrupt)).toBe(false)
    expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/أساس الدفتر/)
    expect(S().journal).toBe(ledger)
    useAppStore.setState({ fiscalYears: [year] })
    expect(fiscalCloseStateRepairs([year], ledger)).toEqual({ closeIds: [], reopenIds: [] })
    expect(() => S().closeFiscalYear(year, [year])).toThrow(/أساس الدفتر/)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  })
  it('يقبل التذكاري الصفر والفرع الآخر، ويرفض تاريخاً أو سطوراً تالفة في الأساس', () => {
    S().closeFiscalYear(year, [year])
    const close = { ...S().journal[1], branchId: 1 }
    const local = { ...activity, branchId: 1 }
    const memo = { ...local, id: 3, memoOnly: true, lines: [] }
    const other = { ...activity, id: 4, branchId: 2, date: 'تالف' }
    expect(isFiscalCloseBasisValid([local, memo, other, close], { ...year, branchId: 1 }, close, 1)).toBe(true)
    expect(isFiscalCloseBasisValid([{ ...local, branchId: undefined }, close], { ...year, branchId: 1 }, close, 1)).toBe(true)
    expect(isFiscalCloseBasisValid([{ ...local, branchId: undefined }, close], { ...year, branchId: 1 }, close, 2)).toBe(false)
    expect(isFiscalCloseBasisValid([local, { ...local, id: 5, sourceType: 'year_closing', sourceId: 99 }, close], { ...year, branchId: 1 }, close, 1)).toBe(false)
    expect(isFiscalCloseBasisValid([{ ...local, date: '2024-02-30' }, close], { ...year, branchId: 1 }, close, 1)).toBe(false)
    expect(isFiscalCloseBasisValid([{ ...local, lines: [{ accountCode: '4101', debit: 0, credit: 100 }] }, close], { ...year, branchId: 1 }, close, 1)).toBe(false)
    expect(isFiscalCloseBasisValid([close], { ...year, branchId: 1 }, close, 1)).toBe(false)
  })
  it('يسمح بتتابع إقفال وفتح وإقفال جديد على أساس الحركة الصحيحة', () => {
    S().closeFiscalYear(year, [year])
    S().reopenFiscalYear(useAppStore.getState().fiscalYears[0], [useAppStore.getState().fiscalYears[0]])
    S().postManualEntry({ date: '2024-07-01', description: 'تصحيح', lines: activity.lines })
    S().closeFiscalYear(useAppStore.getState().fiscalYears[0], [useAppStore.getState().fiscalYears[0]])
    const ledger = S().journal
    useAppStore.setState({ fiscalYears: [year] })
    expect(fiscalCloseStateRepairs([year], ledger)).toEqual({ closeIds: [1], reopenIds: [] })
    expect(() => S().closeFiscalYear(year, [year])).toThrow(/تمت استعادة حالة الإقفال/)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
  })
  it('يرفض استعادة الفتح عند حركة بين الإقفال وعكسه أو بعد العكس', () => {
    S().closeFiscalYear(year, [year])
    const closed = useAppStore.getState().fiscalYears[0]
    S().reopenFiscalYear(closed, [closed])
    const [first, close, reverse] = S().journal
    const later = { ...activity, id: 10, entryNumber: 10 }
    for (const ledger of [[first, close, later, reverse], [first, close, reverse, later]]) {
      useRawDataStore.setState({ journal: ledger }); useAppStore.setState({ fiscalYears: [closed] })
      expect(fiscalCloseStateRepairs([closed], ledger)).toEqual({ closeIds: [], reopenIds: [] })
      expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس|حركة/)
      expect(S().journal).toBe(ledger)
      expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
    }
  })
})

it('يرفض إنشاء إقفال لا يمكن إثبات أساسه عند إعادة الفتح بسبب اختلاف إسناد عكس قديم', () => {
  const branches = [
    { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' },
    { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' },
  ]
  const branchYear = { ...year, branchId: 2 }
  const first = { ...activity, branchId: 2 }
  const reversal: JournalEntry = { ...activity, id: 2, entryNumber: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: activity.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
  const later = { ...activity, id: 3, entryNumber: 3, branchId: 2, lines: activity.lines.map(line => ({ ...line, debit: line.debit * 2, credit: line.credit * 2 })) }
  const journal = [first, reversal, later]
  useAppStore.setState({ fiscalYears: [branchYear] })
  useRawDataStore.setState({ branches, activeBranchId: 2, journal })
  expect(() => S().closeFiscalYear(branchYear, [branchYear])).toThrow(/أساس الإقفال.*إسناد/)
  expect(S().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})

it('لا يربط السنة القديمة أو يغيّر اليومية عندما يختلف الأساس في الفرع الرئيسي', () => {
  const branches = [
    { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' },
    { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' },
  ]
  const other = { ...activity, branchId: 2 }
  const reversal: JournalEntry = { ...activity, id: 2, entryNumber: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: activity.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
  const local = { ...activity, id: 3, entryNumber: 3, branchId: 1, lines: activity.lines.map(line => ({ ...line, debit: line.debit * 2, credit: line.credit * 2 })) }
  const journal = [other, reversal, local]
  useRawDataStore.setState({ branches, activeBranchId: 1, journal })
  expect(() => S().closeFiscalYear(year, [year])).toThrow(/أساس الإقفال.*إسناد/)
  expect(S().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0]).toEqual(year)
})

it('يسمح بإقفال الفرع ثم إعادة فتحه عندما يثبت أساس القيود المسندة', () => {
  const branches = [
    { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' },
    { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' },
  ]
  const branchYear = { ...year, branchId: 2 }
  useAppStore.setState({ fiscalYears: [branchYear] })
  useRawDataStore.setState({ branches, activeBranchId: 2, journal: [{ ...activity, branchId: 2 }] })
  expect(S().closeFiscalYear(branchYear, [branchYear]).netProfitMinor).toBe(100)
  const closed = useAppStore.getState().fiscalYears[0]
  S().reopenFiscalYear(closed, [closed])
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})
