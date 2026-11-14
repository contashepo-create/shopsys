import { describe, expect, it } from 'vitest'
import { buildInterBranchTransferLines, eliminatePairedInterBranchLines } from '../src/core/branchAccounting.ts'
import { cashFlowReport } from '../src/core/financialReports.ts'
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

  it('excludes internal transfer principal from consolidated cash-flow gross lines but keeps fees', () => {
    const pair = buildInterBranchTransferLines({
      sourceBranchId: 2, destinationBranchId: 1, sourceTreasury: '2201', destinationTreasury: '1101', amountMinor: 5000, feeMinor: 100,
    })
    const rows = [
      entry({ id: 10, branchId: 2, lines: pair.sourceLines }),
      entry({ id: 11, branchId: 1, lines: pair.destinationLines }),
    ]
    const report = cashFlowReport(rows, ['1101', '2201'], { from: '2026-10-01', to: '2026-10-31' })
    expect(report.totalInMinor).toBe(0)
    expect(report.totalOutMinor).toBe(100)
    expect(report.netChangeMinor).toBe(-100)
    expect(report.outflows).toEqual([{ label: 'مصروفات عمومية', amountMinor: 100, activity: 'operating' }])

    const branchReport = cashFlowReport(rows.slice(0, 1), ['1101', '2201'], { from: '2026-10-01', to: '2026-10-31' })
    expect(branchReport.totalOutMinor).toBe(5100)
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

describe('حدود استبعاد التحويلات', () => {
  const pair = buildInterBranchTransferLines({ sourceBranchId: 1, destinationBranchId: 2, sourceTreasury: '1101', destinationTreasury: '1102', amountMinor: 5000, feeMinor: 100 })
  const source = { ...entry({ id: 1, branchId: 1, lines: pair.sourceLines }), date: '2026-09-30', interBranchTransferId: 7 }
  const destination = { ...entry({ id: 2, branchId: 2, lines: pair.destinationLines }), date: '2026-10-01', interBranchTransferId: 7 }
  it('يحتفظ بالحركة العابرة لحد الفترة ويطابق أرصدة النقدية الفعلية دون تأثر بالطرف المستقبلي', () => {
    const period = { from: '2026-10-01', to: '2026-10-31' }
    const result = cashFlowReport([source, destination], ['1101', '1102'], period)
    expect(result).toMatchObject({ openingCashMinor: -5100, totalInMinor: 5000, totalOutMinor: 0, netChangeMinor: 5000, closingCashMinor: -100 })
    const before = cashFlowReport([source, destination], ['1101', '1102'], { from: '2026-09-01', to: '2026-09-30' })
    expect(before).toMatchObject({ openingCashMinor: 0, totalOutMinor: 5100, closingCashMinor: -5100 })
  })
  it('لا يستبعد مبلغاً من النقد عند اختيار طرف خزينة واحد فقط', () => {
    const sameDay = [{ ...source, date: '2026-10-01' }, destination]
    const report = cashFlowReport(sameDay, ['1101'], { from: '2026-10-01', to: '2026-10-31' })
    expect(report).toMatchObject({ totalOutMinor: 5100, closingCashMinor: -5100 })
  })
  it('لا يكتفي بتصافر المقاصة إذا لم تتطابق الحسابات المتقابلة', () => {
    const wrong = { ...destination, lines: destination.lines.map(line => line.accountCode === '2118' ? { ...line, accountCode: '1114' } : line) }
    const rows = [source, wrong]
    expect(eliminatePairedInterBranchLines(rows)).toEqual(rows)
  })
  it('يستبعد أصل التحويل وعكسه في الفترة نفسها كل على حدة ويحافظ على النقد', () => {
    const forward = [{ ...source, date: '2026-10-01' }, destination]
    const reversals = forward.map((e, i) => ({ ...e, id: i + 3, entryNumber: i + 3, date: '2026-10-02', sourceType: 'reversal' as const, sourceId: e.id, reversesEntryId: e.id, lines: e.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }))
    const report = cashFlowReport([...forward, ...reversals], ['1101', '1102'], { from: '2026-10-01', to: '2026-10-31' })
    expect(report).toMatchObject({ totalInMinor: 100, totalOutMinor: 100, closingCashMinor: 0 })
    expect(eliminatePairedInterBranchLines([...forward, ...reversals]).flatMap(e => e.lines).some(l => l.relatedBranchId != null)).toBe(false)
  })
})

it('يفصل حركات الحسابات المتشابهة بالاسم إذا اختلف نشاطها', () => {
  const rows = [entry({ id: 21, branchId: 1, lines: [{ accountCode: '5102', debit: 300, credit: 0 }, { accountCode: '1101', debit: 0, credit: 300 }] }), entry({ id: 22, branchId: 1, lines: [{ accountCode: '1201', debit: 700, credit: 0 }, { accountCode: '1101', debit: 0, credit: 700 }] })]
  const report = cashFlowReport(rows, ['1101'], { from: '2026-10-01', to: '2026-10-31' }, { '5102': 'اسم متكرر', '1201': 'اسم متكرر' })
  expect(report.outflows).toEqual(expect.arrayContaining([{ label: 'اسم متكرر', amountMinor: 300, activity: 'operating' }, { label: 'اسم متكرر', amountMinor: 700, activity: 'investing' }]))
  expect(report).toMatchObject({ operatingNetMinor: -300, investingNetMinor: -700, totalOutMinor: 1000 })
})

it('يترك القيد المركب غير المثبت ضمن حركة النقد بدلاً من استبعاد جزء تخميني', () => {
  const pair = buildInterBranchTransferLines({ sourceBranchId: 1, destinationBranchId: 2, sourceTreasury: '1101', destinationTreasury: '1102', amountMinor: 5000 })
  const source = { ...entry({ id: 1, branchId: 1, lines: [...pair.sourceLines, { accountCode: '5102', debit: 100, credit: 0 }, { accountCode: '1101', debit: 0, credit: 100 }] }), interBranchTransferId: 7 }
  const destination = { ...entry({ id: 2, branchId: 2, lines: pair.destinationLines }), interBranchTransferId: 7 }
  const report = cashFlowReport([source, destination], ['1101', '1102'], { from: '2026-10-01', to: '2026-10-31' })
  expect(report).toMatchObject({ totalInMinor: 5000, totalOutMinor: 5100, closingCashMinor: -100 })
})
