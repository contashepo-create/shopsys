import { describe, expect, it } from 'vitest'
import { costCenterExpensesCsv, expenseDetailsCsv, expenseSummaryCsv, invoiceExpenseCategoriesCsv, invoiceExpensesByCategory, invoiceExpensesByCostCenter } from '../src/core/expenseReports.ts'

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
  it('يرشح المركز وحالة السداد ويصدر CSV آمناً', () => {
    const docs = [{ date: '2026-09-10', internalExpenses: [{ projectId: 7, amountMinor: 1000, settlement: 'paid_now' as const }, { projectId: 7, amountMinor: 500, settlement: 'payable_later' as const }, { projectId: null, amountMinor: 200, settlement: 'paid_now' as const }] }]
    const report = invoiceExpensesByCostCenter(docs, { projectId: 7, settlement: 'payable_later' })
    expect(report.totalMinor).toBe(500)
    expect(report.rows[0]).toMatchObject({ paidMinor: 0, accruedMinor: 500 })
    expect(costCenterExpensesCsv(report.rows, () => 'مشروع, خاص')).toContain('\"مشروع, خاص\"')
  })
  it('يحلل الأنواع والعمولات والضريبة والمراكز وحالة السداد', () => {
    const report = invoiceExpensesByCategory([{ date: '2026-09-24', internalExpenses: [
      { label: 'عمولة', accountCode: '5201', projectId: 4, amountMinor: 1000, settlement: 'paid_now', taxTreatment: 'exclusive', taxPercent: 14 },
      { label: 'عمولة', accountCode: '5201', projectId: 5, amountMinor: 500, settlement: 'payable_later', taxTreatment: 'inclusive', taxPercent: 14 },
    ] }], {})
    expect(report.totalMinor).toBe(1500)
    expect(report.taxMinor).toBe(201)
    expect(report.rows[0]).toMatchObject({ label: 'عمولة', paidMinor: 1000, accruedMinor: 500, txCount: 2, costCenterCount: 2 })
    expect(invoiceExpenseCategoriesCsv(report.rows)).toContain('عمولة')
  })

  it('يصدر تقريري المصروفات المجمع والتفصيلي مع اقتباس آمن', () => {
    expect(expenseSummaryCsv([{ accountCode: '5101', accountName: 'شحن, ونقل', totalMinor: 100, txCount: 1, sharePercent: 100 }])).toContain('"شحن, ونقل"')
    expect(expenseDetailsCsv([{ entryId: 1, entryNumber: 4, date: '2026-09-24', description: 'مصروف "خاص"', sourceType: 'sale', amountMinor: 100, accountCode: '5101' }])).toContain('"مصروف ""خاص"""')
  })
})
