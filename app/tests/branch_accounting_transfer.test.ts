import { describe, expect, it } from 'vitest'
import { buildInterBranchTransferLines, eliminatePairedInterBranchLines } from '../src/core/branchAccounting.ts'
import { STANDARD_COA, type JournalEntry } from '../src/core/ledger.ts'
import { validateManualEntry } from '../src/core/accounting.ts'

const entry = (args: Partial<JournalEntry> & Pick<JournalEntry, 'id' | 'branchId' | 'lines'>): JournalEntry => ({
  id: args.id, branchId: args.branchId, entryNumber: args.id, date: '2026-10-01',
  description: 'تحويل بين فرعين', sourceType: 'payment_voucher', sourceId: 7,
  lines: args.lines, createdBy: 'owner', createdAt: '2026-10-01T00:00:00.000Z',
  reversedByEntryId: null, reversesEntryId: null,
})

describe('inter-branch accounting', () => {
  it('posts two balanced entries and clears a pre-existing payable first', () => {
    const pair = buildInterBranchTransferLines({
      sourceBranchId: 2, destinationBranchId: 1, sourceTreasury: '2201', destinationTreasury: '1101',
      amountMinor: 10000, feeMinor: 100, sourcePositionMinor: -4000,
    })
    expect(pair.sourceLines.reduce((n, line) => n + line.debit, 0)).toBe(pair.sourceLines.reduce((n, line) => n + line.credit, 0))
    expect(pair.destinationLines.reduce((n, line) => n + line.debit, 0)).toBe(pair.destinationLines.reduce((n, line) => n + line.credit, 0))
    expect(pair.sourceLines.find((line) => line.accountCode === '2118')?.debit).toBe(4000)
    expect(pair.sourceLines.find((line) => line.accountCode === '1114')?.debit).toBe(6000)
    expect(pair.destinationLines.find((line) => line.accountCode === '1114')?.credit).toBe(4000)
    expect(pair.destinationLines.find((line) => line.accountCode === '2118')?.credit).toBe(6000)
  })

  it('blocks manual postings to the dedicated due-to/due-from accounts', () => {
    const errors = validateManualEntry([
      { accountCode: '1114', debit: 100, credit: 0 },
      { accountCode: '3101', debit: 0, credit: 100 },
    ], STANDARD_COA)
    expect(errors.some((message) => message.includes('حساب مراقبة'))).toBe(true)
  })

  it('eliminates verified clearing lines only in the paired company-wide view', () => {
    const pair = buildInterBranchTransferLines({ sourceBranchId: 2, destinationBranchId: 1, sourceTreasury: '2201', destinationTreasury: '1101', amountMinor: 5000 })
    const rows = [entry({ id: 10, branchId: 2, lines: pair.sourceLines }), entry({ id: 11, branchId: 1, lines: pair.destinationLines })]
    const consolidated = eliminatePairedInterBranchLines(rows)
    expect(consolidated.flatMap((row) => row.lines).some((line) => line.accountCode === '1114' || line.accountCode === '2118')).toBe(false)
    expect(eliminatePairedInterBranchLines(rows.slice(0, 1))[0].lines).toEqual(pair.sourceLines)
    const mismatched = [rows[0], { ...rows[1], lines: rows[1].lines.map((line) => line.accountCode === '2118' ? { ...line, credit: line.credit - 1 } : line) }]
    expect(eliminatePairedInterBranchLines(mismatched).flatMap((row) => row.lines).some((line) => line.accountCode === '1114' || line.accountCode === '2118')).toBe(true)
  })
})
