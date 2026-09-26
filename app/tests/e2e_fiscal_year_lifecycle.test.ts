import { describe, expect, it } from 'vitest'
import { buildFiscalYearReport, buildYearClosingLines, dateInClosedYear, dateInOpenYear, suggestFiscalYear, validateFiscalYear, validateYearClose, type FiscalYear } from '../src/core/fiscal.ts'
const y2025: FiscalYear = { id: 1, ...suggestFiscalYear(2025), status: 'open' }
const operations = [
  { id: 1, date: '2025-01-01', lines: [{ accountCode: '1101', debit: 100_000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 100_000 }] },
  { id: 2, date: '2025-03-10', lines: [{ accountCode: '1101', debit: 80_000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 80_000 }] },
  { id: 3, date: '2025-06-20', lines: [{ accountCode: '5101', debit: 30_000, credit: 0 }, { accountCode: '1101', debit: 0, credit: 30_000 }] },
  { id: 4, date: '2025-12-31', lines: [{ accountCode: '5102', debit: 5_000, credit: 0 }, { accountCode: '2102', debit: 0, credit: 5_000 }] },
]
describe('رحلة المستخدم من فتح السنة إلى سنة جديدة بأرصدة مرحلة', () => {
  it('يفتح سنة واحدة ويمنع التداخل أو فتح ثانية قبل الإقفال', () => {
    expect(validateFiscalYear(suggestFiscalYear(2025), [])).toEqual([])
    expect(validateFiscalYear(suggestFiscalYear(2026), [y2025]).join(' ')).toContain('ما زالت مفتوحة')
    expect(dateInOpenYear('2025-07-01', [y2025])?.id).toBe(1)
  })
  it('ينفذ سنة تشغيل كاملة ويحسب الربح والتوازن', () => {
    const report = buildFiscalYearReport(operations, y2025)
    expect(report).toMatchObject({ totalRevenueMinor: 80_000, totalExpenseMinor: 35_000, netProfitMinor: 45_000 })
    const close = buildYearClosingLines(operations, y2025)
    expect(close.netProfitMinor).toBe(45_000)
    expect(close.lines.reduce((s,l)=>s+l.debit,0)).toBe(close.lines.reduce((s,l)=>s+l.credit,0))
  })
  it('يغلق المنتهية ويمنع الأثر الرجعي ثم يفتح التالية', () => {
    expect(validateYearClose(y2025, [y2025], '2026-01-01')).toEqual([])
    const closed = { ...y2025, status: 'closed' as const }
    expect(dateInClosedYear('2025-12-31', [closed])?.id).toBe(1)
    expect(validateFiscalYear(suggestFiscalYear(2026), [closed])).toEqual([])
  })
  it('يرحل أرصدة الميزانية والأرباح المرحلة دون أرصدة الدخل القديمة', () => {
    const closing = buildYearClosingLines(operations, y2025)
    const all = [...operations, { id: 5, date: '2025-12-31', lines: closing.lines }]
    const y2026: FiscalYear = { id: 2, ...suggestFiscalYear(2026), status: 'open' }
    const report = buildFiscalYearReport(all, y2026, [5])
    expect(report.rows.find(r=>r.accountCode==='1101')?.openingMinor).toBe(150_000)
    expect(report.rows.find(r=>r.accountCode==='3102')?.openingMinor).toBe(-45_000)
    expect(report.totalRevenueMinor).toBe(0)
    expect(report.totalExpenseMinor).toBe(0)
  })
})
