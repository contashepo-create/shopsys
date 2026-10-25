import { describe, expect, it } from 'vitest'
import { balanceSheet, cashFlowReport, incomeStatement, trialBalance, vatReport } from '../src/core/financialReports.ts'
import { activityRevenueRows } from '../src/core/reports.ts'
import { expenseDetails, expensesSummary, journalExpensesByCostCenter } from '../src/core/expenseReports.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { economicSourceResolver } from '../src/core/journalSource.ts'

const openingEntry = (id: number, lines: JournalEntry['lines']): JournalEntry => ({
  id,
  entryNumber: id,
  date: '2026-10-24',
  description: 'رصيد افتتاحي للاختبار',
  sourceType: 'opening',
  sourceId: null,
  lines,
  createdBy: 'test',
  createdAt: '2026-10-24T10:00:00.000Z',
  reversedByEntryId: null,
  reversesEntryId: null,
})

const line = (accountCode: string, debit: number, credit: number, costCenterId?: number) => ({
  accountCode, debit, credit, note: '', ...(costCenterId == null ? {} : { costCenterId }),
})

const period = { from: '2026-10-01', to: '2026-10-31' }
const journal = [
  openingEntry(1, [line('1101', 1_000, 0), line('3101', 0, 1_000)]),
  openingEntry(2, [line('3101', 500, 0), line('4001', 0, 500)]),
  openingEntry(3, [line('5102', 200, 0, 7), line('3101', 0, 200)]),
  openingEntry(4, [line('3101', 300, 0), line('2102', 0, 300)]),
]

describe('opening balances are balances, not period activity', () => {
  it('keeps opening P&L balances out of current income but includes them in the balance sheet equation', () => {
    const income = incomeStatement(journal, period)
    expect(income.totalRevenueMinor).toBe(0)
    expect(income.totalExpenseMinor).toBe(0)
    expect(trialBalance(journal, period).rows.some((row) => row.code === '4001' && row.creditMinor === 500)).toBe(true)
    expect(balanceSheet(journal, '2026-10-31').balanced).toBe(true)
  })

  it('treats opening cash as the period opening position rather than an inflow', () => {
    expect(cashFlowReport(journal, ['1101'], period)).toMatchObject({
      openingCashMinor: 0,
      openingBalanceAdjustmentsMinor: 1_000,
      totalInMinor: 0,
      totalOutMinor: 0,
      netChangeMinor: 0,
      closingCashMinor: 1_000,
    })
  })

  it('places an opening cash balance dated before the period in beginning cash, not period adjustments', () => {
    const priorOpening = { ...journal[0], date: '2026-09-30' }
    expect(cashFlowReport([priorOpening], ['1101'], period)).toMatchObject({
      openingCashMinor: 1_000,
      openingBalanceAdjustmentsMinor: 0,
      totalInMinor: 0,
      totalOutMinor: 0,
      closingCashMinor: 1_000,
    })
  })

  it('does not treat opening VAT balances as declarations or settlements, including reversals', () => {
    const openingVatReversal = {
      ...openingEntry(5, [line('2102', 300, 0), line('3101', 0, 300)]),
      sourceType: 'reversal' as const,
      reversesEntryId: 4,
    }
    const withReversal = [...journal, openingVatReversal]
    expect(economicSourceResolver(withReversal)(openingVatReversal)).toBe('opening')
    expect(vatReport(withReversal, period)).toMatchObject({
      outputVatMinor: 0,
      inputVatMinor: 0,
      netDueMinor: 0,
      settledMinor: 0,
      remainingMinor: 0,
    })
  })

  it('keeps a reversal of opening cash out of period cash-flow activity', () => {
    const openingCashReversal = {
      ...openingEntry(6, [line('3101', 1_000, 0), line('1101', 0, 1_000)]),
      sourceType: 'reversal' as const,
      reversesEntryId: 1,
    }
    const withReversal = [...journal, openingCashReversal]
    expect(cashFlowReport(withReversal, ['1101'], period)).toMatchObject({
      openingCashMinor: 0,
      openingBalanceAdjustmentsMinor: 0,
      totalInMinor: 0,
      totalOutMinor: 0,
      netChangeMinor: 0,
      closingCashMinor: 0,
    })
  })

  it('labels and filters expense reversals by their economic source, not the technical reversal marker', () => {
    const original: JournalEntry = {
      ...openingEntry(8, [line('5102', 500, 0), line('1101', 0, 500)]),
      sourceType: 'voucher', sourceId: 44,
    }
    const reversal: JournalEntry = {
      ...openingEntry(9, [line('5102', 0, 500), line('1101', 500, 0)]),
      sourceType: 'reversal', reversesEntryId: original.id,
    }
    const rows = expenseDetails([original, reversal], { ...period, accountCode: '5102', sourceType: 'voucher' }, new Set())
    expect(rows.totalMinor).toBe(0)
    expect(rows.rows.map((row) => row.sourceType)).toEqual(['voucher', 'voucher'])
    expect(expenseDetails([original, reversal], { ...period, accountCode: '5102', sourceType: 'reversal' }, new Set()).rows).toHaveLength(0)
  })

  it('excludes opening revenues and expenses from operational reports, with explicit source drill-down available', () => {
    expect(activityRevenueRows(journal, period).totalMinor).toBe(0)
    const expenseCodes = new Set<string>()
    expect(expensesSummary(journal, period, (code) => code, expenseCodes).grandTotalMinor).toBe(0)
    expect(expenseDetails(journal, { ...period, accountCode: '5102' }, expenseCodes).rows).toHaveLength(0)
    expect(expenseDetails(journal, { ...period, accountCode: '5102', sourceType: 'opening' }, expenseCodes).totalMinor).toBe(200)
    expect(journalExpensesByCostCenter(journal, { ...period, costCenterId: 7 }, expenseCodes).totalMinor).toBe(0)
    expect(journalExpensesByCostCenter(journal, { ...period, costCenterId: 7, sourceType: 'opening' }, expenseCodes).totalMinor).toBe(200)

    const openingExpenseReversal = {
      ...openingEntry(7, [line('5102', 0, 200, 7), line('3101', 200, 0)]),
      sourceType: 'reversal' as const,
      reversesEntryId: 3,
    }
    const withReversal = [...journal, openingExpenseReversal]
    expect(expenseDetails(withReversal, { ...period, accountCode: '5102', sourceType: 'opening' }, expenseCodes)).toMatchObject({
      totalMinor: 0,
      rows: expect.arrayContaining([expect.objectContaining({ entryId: 7, sourceType: 'opening', amountMinor: -200 })]),
    })
    expect(journalExpensesByCostCenter(withReversal, { ...period, costCenterId: 7, sourceType: 'opening' }, expenseCodes).totalMinor).toBe(0)
  })
})
