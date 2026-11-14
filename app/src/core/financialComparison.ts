import { balanceSheet, cashFlowReport, incomeStatement, validFinancialPeriod, type FinPeriod } from './financialReports.ts'
import { closingMechanismIds } from './fiscal.ts'
import { STANDARD_COA, type JournalEntry } from './ledger.ts'
import { reviewFiscalCloseJournal } from './fiscalCloseReview.ts'
import { calendarDateIso } from './time.ts'

export interface ComparisonRow { key: string; label: string; currentMinor: number; priorMinor: number }
export interface ComparisonSection { key: string; label: string; rows: ComparisonRow[] }
export interface FinancialComparison { sections: ComparisonSection[]; currentBalanced: boolean; priorBalanced: boolean; currentEquityReconciled: boolean; priorEquityReconciled: boolean }

/** قيمة CSV عددية نصها مُولّد من عدد صحيح موثوق، بلا تحويل عائم أو صيغة مصدرها المستخدم. */
export function comparisonCsvAmount(minor: number, decimals: 0 | 2 | 3): string {
  if (!Number.isSafeInteger(minor)) throw new Error('قيمة المقارنة خارج النطاق الآمن')
  const scale = 10n ** BigInt(decimals), absolute = BigInt(Math.abs(minor))
  const whole = absolute / scale, fraction = absolute % scale
  return `${minor < 0 ? '-' : ''}${whole}${decimals ? `.${String(fraction).padStart(decimals, '0')}` : ''}`
}

/** يوم ما قبل بداية الفترة، دون تحويل محلي أو معالجة خاطئة للسنة الكبيسة. */
function dayBefore(value: string): string {
  if (value === '0001-01-01') throw new Error('بداية الفترة مبكرة جداً لحساب الرصيد السابق')
  const d = new Date(`${value}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return calendarDateIso(d)
}

function equityReview(journal: readonly JournalEntry[], period: FinPeriod, names?: Record<string, string>) {
  const start = balanceSheet(journal, dayBefore(period.from), names)
  const end = balanceSheet(journal, period.to, names)
  const total = (statement: typeof end) => statement.equity.reduce((sum, row) => sum + row.amountMinor, 0) + statement.retainedEarningsMinor
  const currentResult = incomeStatement(journal, period, names).netProfitMinor
  const resultIncludingOpening = incomeStatement(journal, period, names, { includeOpeningBalances: true }).netProfitMinor
  const openingResult = resultIncludingOpening - currentResult
  const closing = closingMechanismIds(journal)
  let directMovement = 0
  for (const entry of journal) {
    if (entry.date < period.from || entry.date > period.to || closing.has(entry.id)) continue
    for (const line of entry.lines) {
      const known = STANDARD_COA.find(account => account.code === line.accountCode)
      if ((known?.rootType ?? (line.accountCode.startsWith('3') ? 'equity' : '')) === 'equity') directMovement += line.credit - line.debit
    }
  }
  const beginning = total(start), ending = total(end)
  const difference = ending - beginning - currentResult - openingResult - directMovement
  return { beginning, currentResult, openingResult, directMovement, ending, difference }
}

/** مقارنة تشغيلية للدفتر المرئي فقط؛ الفترات يحددها المستخدم، ولا يُستنتج إطار أو كيان قانوني. */
export function financialComparison(journal: readonly JournalEntry[], current: FinPeriod, prior: FinPeriod, cashCodes: readonly string[], names?: Record<string, string>): FinancialComparison {
  if (!validFinancialPeriod(current) || !validFinancialPeriod(prior)) throw new Error('فترة المقارنة غير صالحة — راجع التواريخ')
  if (prior.to >= current.from) throw new Error('يجب أن تنتهي فترة المقارنة قبل بداية الفترة الحالية دون تداخل')
  const review = reviewFiscalCloseJournal(journal, { startDate: current.from, endDate: current.to })
  if (!review.valid) throw new Error(`قيود الدفتر المرئي غير سليمة أو متوازنة — راجع ${review.invalidEntryIds.slice(0, 10).map(id => `#${id}`).join('، ')}`)
  const income = [incomeStatement(journal, current, names), incomeStatement(journal, prior, names)] as const
  const position = [balanceSheet(journal, current.to, names), balanceSheet(journal, prior.to, names)] as const
  const flows = [cashFlowReport(journal, [...cashCodes], current, names), cashFlowReport(journal, [...cashCodes], prior, names)] as const
  const equity = [equityReview(journal, current, names), equityReview(journal, prior, names)] as const
  const section = (key: string, label: string, rows: ComparisonRow[]): ComparisonSection => ({ key, label, rows })
  const row = (key: string, label: string, currentMinor: number, priorMinor: number): ComparisonRow => ({ key, label, currentMinor, priorMinor })
  const align = (key: string, left: readonly { code: string; nameAr: string; amountMinor: number }[], right: readonly { code: string; nameAr: string; amountMinor: number }[]) => {
    const codes = [...new Set([...left.map(item => item.code), ...right.map(item => item.code)])].sort((a, b) => a.localeCompare(b))
    return codes.map(code => { const a = left.find(item => item.code === code), b = right.find(item => item.code === code); return row(`${key}:${code}`, `${code} — ${a?.nameAr ?? b?.nameAr ?? code}`, a?.amountMinor ?? 0, b?.amountMinor ?? 0) })
  }
  const sections = [
    section('revenue', 'الإيرادات', [...align('rev', income[0].revenues, income[1].revenues), row('revenue-total', 'إجمالي الإيرادات', income[0].totalRevenueMinor, income[1].totalRevenueMinor)]),
    section('cost', 'التكاليف المباشرة', [...align('cost', income[0].costOfSales, income[1].costOfSales), row('cost-total', 'إجمالي التكاليف المباشرة', income[0].totalCostOfSalesMinor, income[1].totalCostOfSalesMinor), row('gross', 'مجمل الربح / الخسارة', income[0].grossProfitMinor, income[1].grossProfitMinor)]),
    section('expenses', 'المصروفات التشغيلية', [...align('expenses', income[0].operatingExpenses, income[1].operatingExpenses), row('expense-total', 'إجمالي المصروفات التشغيلية', income[0].totalOperatingExpenseMinor, income[1].totalOperatingExpenseMinor), row('net', 'صافي الربح / الخسارة', income[0].netProfitMinor, income[1].netProfitMinor)]),
    section('assets', 'المركز المالي — الأصول', [...align('assets', position[0].assets, position[1].assets), row('assets-total', 'إجمالي الأصول', position[0].totalAssetsMinor, position[1].totalAssetsMinor)]),
    section('liabilities', 'المركز المالي — الالتزامات وحقوق الملكية', [...align('liability', position[0].liabilities, position[1].liabilities), ...align('equity', position[0].equity, position[1].equity), row('retained', 'نتيجة النشاط غير المقفلة', position[0].retainedEarningsMinor, position[1].retainedEarningsMinor), row('le-total', 'إجمالي الالتزامات وحقوق الملكية', position[0].totalLiabilitiesEquityMinor, position[1].totalLiabilitiesEquityMinor)]),
    section('equity', 'تسوية إجمالي حقوق الملكية', [row('equity-start', 'حقوق الملكية أول الفترة', equity[0].beginning, equity[1].beginning), row('equity-income', 'صافي نتيجة الفترة', equity[0].currentResult, equity[1].currentResult), row('equity-opening', 'أرصدة نتائج افتتاحية داخل الفترة', equity[0].openingResult, equity[1].openingResult), row('equity-direct', 'حركة مباشرة على حقوق الملكية باستثناء آلية الإقفال', equity[0].directMovement, equity[1].directMovement), row('equity-end', 'حقوق الملكية آخر الفترة', equity[0].ending, equity[1].ending), row('equity-difference', 'فرق التسوية — يلزم مراجعته إن لم يكن صفراً', equity[0].difference, equity[1].difference)]),
    section('cash', 'ملخص التدفقات النقدية — تصنيف تقديري', [row('cash-opening', 'النقدية أول الفترة', flows[0].openingCashMinor, flows[1].openingCashMinor), row('cash-adjust', 'تسويات الأرصدة الافتتاحية داخل الفترة', flows[0].openingBalanceAdjustmentsMinor, flows[1].openingBalanceAdjustmentsMinor), row('cash-operating', 'صافي التدفق التشغيلي', flows[0].operatingNetMinor, flows[1].operatingNetMinor), row('cash-investing', 'صافي التدفق الاستثماري', flows[0].investingNetMinor, flows[1].investingNetMinor), row('cash-financing', 'صافي التدفق التمويلي', flows[0].financingNetMinor, flows[1].financingNetMinor), row('cash-net', 'صافي التدفقات', flows[0].netChangeMinor, flows[1].netChangeMinor), row('cash-closing', 'النقدية آخر الفترة', flows[0].closingCashMinor, flows[1].closingCashMinor)]),
  ]
  if (sections.some(s => s.rows.some(r => !Number.isSafeInteger(r.currentMinor) || !Number.isSafeInteger(r.priorMinor)))) throw new Error('مبالغ المقارنة خارج النطاق الآمن — راجع الدفتر')
  return { sections, currentBalanced: position[0].balanced, priorBalanced: position[1].balanced, currentEquityReconciled: equity[0].difference === 0, priorEquityReconciled: equity[1].difference === 0 }
}
