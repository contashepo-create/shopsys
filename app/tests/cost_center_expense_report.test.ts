import { describe, expect, it } from 'vitest'
import { invoiceExpensesByCostCenter } from '../src/core/expenseReports.ts'

describe('تحليل مصروفات الفواتير حسب مركز التكلفة', () => {
  it('يفصل المدفوع عن المستحق ويجمع غير المرتبط', () => {
    const report = invoiceExpensesByCostCenter([
      { date: '2026-09-10', internalExpenses: [{ projectId: 7, amountMinor: 1000, settlement: 'paid_now' }, { projectId: 7, amountMinor: 500, settlement: 'payable_later' }] },
      { date: '2026-09-11', internalExpenses: [{ projectId: null, amountMinor: 250, settlement: 'paid_now' }] },
      { date: '2026-08-01', internalExpenses: [{ projectId: 7, amountMinor: 9000, settlement: 'paid_now' }] },
    ], { from: '2026-09-01', to: '2026-09-30' })
    expect(report.totalMinor).toBe(1750)
    expect(report.rows[0]).toEqual({ projectId: 7, totalMinor: 1500, paidMinor: 1000, accruedMinor: 500, txCount: 2 })
    expect(report.rows[1]).toMatchObject({ projectId: null, totalMinor: 250 })
  })
})
