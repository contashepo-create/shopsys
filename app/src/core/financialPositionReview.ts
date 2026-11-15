import { isValidFiscalDate } from './fiscal.ts'
import { balanceSheet } from './financialReports.ts'
import { reviewFiscalCloseJournal } from './fiscalCloseReview.ts'
import type { JournalEntry } from './ledger.ts'

export type Maturity = 'current' | 'noncurrent' | 'unclassified'
export type PositionClassifications = Readonly<Record<string, Maturity>>
export interface PositionRow { key: string; label: string; values: number[]; code?: string; root?: 'assets' | 'liabilities' }
export interface PositionSection { key: string; label: string; rows: PositionRow[]; total: PositionRow }
export interface PositionReview { dates: string[]; sections: PositionSection[]; totalAssets: PositionRow; totalLiabilities: PositionRow; totalEquity: PositionRow; liabilitiesAndEquity: PositionRow; difference: PositionRow; workingCapital: PositionRow | null; unclassifiedCount: number }

/**
 * تقرير استرشادي للتواريخ المحددة حتى تاريخ التقرير. تبويب الاستحقاق قرار
 * المستخدم لا يُستنتج من رقم الحساب، وقد يحتوي الحساب الواحد على آجال مختلطة.
 * النتيجة لا تنشئ أو تعدّل قيوداً ولا تثبت صحة الإسناد أو القوائم القانونية.
 */
export function financialPositionReview(journal: readonly JournalEntry[], asOf: string, comparisonDates: readonly string[], classifications: PositionClassifications = {}, names?: Record<string, string>): PositionReview {
  if (!isValidFiscalDate(asOf) || comparisonDates.length > 3 || comparisonDates.some(date => !isValidFiscalDate(date) || date >= asOf) || new Set(comparisonDates).size !== comparisonDates.length) throw new Error('تواريخ المقارنة غير صالحة أو مكررة — اختر تواريخ سابقة مختلفة')
  const dates = [...comparisonDates].sort().concat(asOf)
  const audit = reviewFiscalCloseJournal(journal, { startDate: asOf, endDate: asOf })
  if (!audit.valid) throw new Error(`تعذر إعداد المركز المالي: قيود غير سليمة في الدفتر المرئي ${audit.invalidEntryIds.slice(0, 10).map(id => `#${id}`).join('، ')}`)
  const snapshots = dates.map(date => balanceSheet(journal, date, names))
  const row = (key: string, label: string, values: number[], code?: string, root?: 'assets' | 'liabilities'): PositionRow => ({ key, label, values, ...(code ? { code } : {}), ...(root ? { root } : {}) })
  const accountRows = (root: 'assets' | 'liabilities') => {
    const codes = [...new Set(snapshots.flatMap(snapshot => snapshot[root].map(item => item.code)))].sort((a, b) => a.localeCompare(b))
    return codes.map(code => {
      const items = snapshots.map(snapshot => snapshot[root].find(item => item.code === code))
      const maturities = dates.map(date => classifications[JSON.stringify([code, date])] ?? 'unclassified')
      if (maturities.some(maturity => !['current', 'noncurrent', 'unclassified'].includes(maturity))) throw new Error(`تصنيف الحساب ${code} غير صالح`)
      return { maturities, row: row(`${root}:${code}`, items.find(Boolean)?.nameAr ?? code, items.map(item => item?.amountMinor ?? 0), code, root) }
    })
  }
  const assets = accountRows('assets'), liabilities = accountRows('liabilities')
  const sum = (rows: readonly PositionRow[]) => dates.map((_, index) => {
    let value = 0
    for (const item of rows) {
      value += item.values[index]
      if (!Number.isSafeInteger(value)) throw new Error('مجموع المركز المالي خارج النطاق الآمن — راجع الدفتر')
    }
    return value
  })
  const section = (key: string, label: string, rows: PositionRow[]): PositionSection => ({ key, label, rows, total: row(`total:${key}`, `إجمالي ${label}`, sum(rows)) })
  const select = (items: typeof assets, maturity: Maturity) => items.map(item => ({ ...item.row, values: item.row.values.map((value, index) => item.maturities[index] === maturity ? value : 0) })).filter(item => item.values.some(value => value !== 0))
  const equityCodes = [...new Set(snapshots.flatMap(snapshot => snapshot.equity.map(item => item.code)))].sort((a, b) => a.localeCompare(b))
  const equityRows = equityCodes.map(code => {
    const items = snapshots.map(snapshot => snapshot.equity.find(item => item.code === code))
    return row(`equity:${code}`, items.find(Boolean)?.nameAr ?? code, items.map(item => item?.amountMinor ?? 0), code)
  })
  equityRows.push(row('equity:unclosed', 'نتائج تراكمية غير مقفلة', snapshots.map(snapshot => snapshot.retainedEarningsMinor)))
  const sections = [section('assets-current', 'الأصول المتداولة', select(assets, 'current')), section('assets-noncurrent', 'الأصول غير المتداولة', select(assets, 'noncurrent')), section('assets-unclassified', 'الأصول غير المصنفة', select(assets, 'unclassified')), section('liabilities-current', 'الالتزامات المتداولة', select(liabilities, 'current')), section('liabilities-noncurrent', 'الالتزامات غير المتداولة', select(liabilities, 'noncurrent')), section('liabilities-unclassified', 'الالتزامات غير المصنفة', select(liabilities, 'unclassified')), section('equity', 'حقوق الملكية', equityRows)]
  const totalAssets = row('total-assets', 'إجمالي الأصول', snapshots.map(snapshot => snapshot.totalAssetsMinor))
  const totalLiabilities = row('total-liabilities', 'إجمالي الالتزامات', sum(liabilities.map(item => item.row)))
  const totalEquity = row('total-equity', 'إجمالي حقوق الملكية', sum(equityRows))
  const liabilitiesAndEquity = row('total-liabilities-equity', 'إجمالي الالتزامات وحقوق الملكية', snapshots.map(snapshot => snapshot.totalLiabilitiesEquityMinor))
  const difference = row('difference', 'فرق التوازن', dates.map((_, index) => totalAssets.values[index] - liabilitiesAndEquity.values[index]))
  const unclassifiedCount = [...assets, ...liabilities].reduce((count, item) => count + item.maturities.filter((maturity, index) => maturity === 'unclassified' && item.row.values[index] !== 0).length, 0)
  const workingCapital = unclassifiedCount ? null : row('working-capital', 'صافي رأس المال العامل', dates.map((_, index) => sections[0].total.values[index] - sections[3].total.values[index]))
  const results = [...sections.flatMap(item => [item.total, ...item.rows]), totalAssets, totalLiabilities, totalEquity, liabilitiesAndEquity, difference, ...(workingCapital ? [workingCapital] : [])]
  if (results.some(item => item.values.some(value => !Number.isSafeInteger(value)))) throw new Error('مبلغ المركز المالي خارج النطاق الآمن — راجع الدفتر')
  return { dates, sections, totalAssets, totalLiabilities, totalEquity, liabilitiesAndEquity, difference, workingCapital, unclassifiedCount }
}
