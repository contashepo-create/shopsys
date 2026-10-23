import { describe, expect, it } from 'vitest'
import { STANDARD_COA, type JournalEntry } from '../src/core/ledger.ts'
import { validateEntry } from '../src/core/ledgerGuard.ts'

const baseEntry = (branchId?: number): JournalEntry => ({
  id: 1,
  entryNumber: 1,
  ...(branchId != null ? { branchId } : {}),
  date: '2025-06-30',
  description: 'اختبار قيد فرعي',
  sourceType: 'manual',
  sourceId: null,
  lines: [
    { accountCode: '1101', debit: 100, credit: 0, note: 'مدين' },
    { accountCode: '3101', debit: 0, credit: 100, note: 'دائن' },
  ],
  createdBy: 'اختبار',
  createdAt: '2025-06-30T12:00:00.000Z',
  reversedByEntryId: null,
  reversesEntryId: null,
})

const context = {
  coa: STANDARD_COA,
  fiscalYears: [{ branchId: 2, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' as const }],
}

describe('حارس القيود والفترات المستقلة للفروع', () => {
  it('يمنع قيد الفرع داخل فترة فرعه المقفلة', () => {
    expect(validateEntry(baseEntry(2), context).join(' ')).toContain('داخل السنة المالية المقفلة')
  })

  it('لا يطبّق إقفال فرع على قيد فرع آخر أو على قيد تاريخي غير منسوب', () => {
    expect(validateEntry(baseEntry(3), context)).toEqual([])
    expect(validateEntry(baseEntry(), context)).toEqual([])
  })
})
