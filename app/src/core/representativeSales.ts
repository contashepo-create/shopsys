/** قراءة جزئية صريحة لمندوب فواتير البيع؛ ليست تقريراً شاملاً لكل الأنشطة. */
import type { SaleInvoice, SaleReturn } from '../data/repo.ts'
import { assertBalanced, buildReversalLines, type JournalEntry, type JournalLine } from './ledger.ts'
import { inPeriod, type Period } from './reports.ts'
import { representativeReportSum } from './representativeReportMoney.ts'

export interface RepresentativeSaleRow {
  date: string
  /** ترتيب القيد لتفادي قلب أحداث متتابعة في اليوم نفسه. */
  sequence: number
  document: string
  kind: 'sale' | 'reversal' | 'return'
  representativeId: number | null
  representativeName: string
  amountMinor: number
}
export interface RepresentativeSalesResult {
  rows: RepresentativeSaleRow[]
  warnings: string[]
  salesMinor: number
  returnsMinor: number
  reversalsMinor: number
  unassignedCount: number
}
const lineKey = (line: JournalLine) => JSON.stringify([line.accountCode, line.debit, line.credit, line.costCenterId ?? null, line.partyKind ?? null, line.partyId ?? null, line.relatedBranchId ?? null])
const sameLines = (left: JournalLine[], right: JournalLine[]) => left.length === right.length && JSON.stringify(left.map(lineKey).sort()) === JSON.stringify(right.map(lineKey).sort())

/** يعرض القيود في تواريخها الفعلية: القيد الأصلي وعكسه ثم القيد البديل؛ لا يعيد كتابة الماضي. */
export function representativeSalesReport(sales: readonly SaleInvoice[], returns: readonly SaleReturn[], journal: readonly JournalEntry[], employees: readonly { id: number; nameAr: string }[], period: Period): RepresentativeSalesResult {
  const rows: RepresentativeSaleRow[] = [], warnings: string[] = []
  const validAmount = (amount: number) => Number.isSafeInteger(amount) && amount >= 0
  const findEntry = (id: number, source: 'sale' | 'sale_return', sourceId: number) => {
    const matches = journal.filter(entry => entry.id === id)
    if (matches.length !== 1) return null
    const entry = matches[0]
    if (entry.sourceType !== source || entry.sourceId !== sourceId || entry.reversesEntryId != null || entry.memoOnly) return null
    try { assertBalanced(entry.lines) } catch { return null }
    return entry
  }
  const amountOf = (entry: JournalEntry, base: string, direction: 'debit' | 'credit') => {
    const sum = entry.lines.filter(line => line.accountCode === base || line.accountCode === '2102').reduce((total, line) => total + line[direction], 0)
    return validAmount(sum) ? sum : null
  }
  const info = (sale: SaleInvoice) => {
    if (sales.filter(row => row.id === sale.id).length !== 1 || sale.projectBilling === 'documentation' || (sale.editHistory != null && !Array.isArray(sale.editHistory))) return null
    const history = sale.editHistory ?? []
    if (typeof sale.date !== 'string' || history.some(edit => !edit || typeof edit.at !== 'string' || !Number.isSafeInteger(edit.previousEntryId) || !Number.isSafeInteger(edit.reversalEntryId))) return null
    const ids = [...history.map(edit => edit.previousEntryId), sale.journalEntryId]
    if (new Set(ids).size !== ids.length) return null
    const entries = ids.map(id => findEntry(id, 'sale', sale.id))
    if (entries.some(entry => !entry)) return null
    const validEntries = entries as JournalEntry[]
    const current = validEntries[validEntries.length - 1]
    if (validEntries[0].date !== sale.date.slice(0, 10) || !validAmount(sale.totals?.totalMinor) || amountOf(current, '4101', 'credit') !== sale.totals.totalMinor || current.reversedByEntryId != null) return null
    if (validEntries.some(entry => (sale.salesRepEmployeeId !== undefined || entry.saleRepresentativeId !== undefined) && sale.salesRepEmployeeId !== entry.saleRepresentativeId)) return null
    const representativeId = sale.salesRepEmployeeId ?? null
    const people = representativeId == null ? [] : employees.filter(employee => employee.id === representativeId)
    if (representativeId != null && (!Number.isSafeInteger(representativeId) || people.length !== 1)) return null
    const representativeName = representativeId == null ? 'غير محدد' : people[0].nameAr
    const events: RepresentativeSaleRow[] = []
    for (let i = 0; i < validEntries.length; i++) {
      const entry = validEntries[i], amount = amountOf(entry, '4101', 'credit')
      if (amount == null) return null
      events.push({ date: entry.date, sequence: entry.id, document: sale.invoiceNumber, kind: 'sale', representativeId, representativeName, amountMinor: amount })
      if (i === history.length) continue
      const edit = history[i], reverseMatches = journal.filter(row => row.id === edit.reversalEntryId), reversal = reverseMatches[0]
      if (reverseMatches.length !== 1 || entry.reversedByEntryId !== reversal.id || reversal.sourceType !== 'reversal' || reversal.sourceId !== entry.id || reversal.reversesEntryId !== entry.id || reversal.reversedByEntryId != null || reversal.memoOnly || reversal.date !== edit.at.slice(0, 10) || reversal.date < entry.date || validEntries[i + 1].date !== reversal.date) return null
      try { assertBalanced(reversal.lines); if (!sameLines(reversal.lines, buildReversalLines(entry.lines))) return null } catch { return null }
      events.push({ date: reversal.date, sequence: reversal.id, document: sale.invoiceNumber, kind: 'reversal', representativeId, representativeName, amountMinor: amount })
    }
    return { representativeId, representativeName, events }
  }
  for (const sale of sales) {
    if (sale.projectBilling === 'documentation') continue
    if (typeof sale.date !== 'string' || (sale.editHistory != null && !Array.isArray(sale.editHistory)) || sale.editHistory?.some(edit => !edit || typeof edit.at !== 'string')) { warnings.push(`تاريخ أو سجل تعديل ${sale.invoiceNumber} غير صالح؛ لم تُدرج.`); continue }
    const relevant = inPeriod(sale.date, period) || sale.editHistory?.some(edit => inPeriod(edit.at, period))
    if (!relevant) continue
    const representative = info(sale)
    if (!representative) { warnings.push(`تعذر إثبات مندوب أو سلسلة قيد ${sale.invoiceNumber}؛ لم تُدرج.`); continue }
    rows.push(...representative.events.filter(event => inPeriod(event.date, period)))
  }
  for (const ret of returns) {
    if (ret.projectBilling === 'documentation') continue
    if (typeof ret.date !== 'string') { warnings.push(`تاريخ ${ret.returnNumber} غير صالح؛ لم يُدرج.`); continue }
    if (!inPeriod(ret.date, period)) continue
    const originals = sales.filter(sale => sale.id === ret.saleId)
    const representative = originals[0] && info(originals[0])
    const entry = findEntry(ret.journalEntryId, 'sale_return', ret.id)
    if (returns.filter(row => row.id === ret.id).length !== 1 || originals.length !== 1 || !representative || !entry || entry.reversedByEntryId != null || entry.date !== ret.date.slice(0, 10) || !validAmount(ret.totals.totalMinor) || amountOf(entry, '4102', 'debit') !== ret.totals.totalMinor || ((entry.saleReturnOriginalSaleId !== undefined || entry.saleReturnRepresentativeId !== undefined) && (entry.saleReturnOriginalSaleId !== ret.saleId || entry.saleReturnRepresentativeId !== representative.representativeId))) { warnings.push(`تعذر إثبات أصل أو قيد ${ret.returnNumber}؛ لم يُدرج.`); continue }
    rows.push({ date: ret.date.slice(0, 10), sequence: entry.id, document: ret.returnNumber, kind: 'return', representativeId: representative.representativeId, representativeName: representative.representativeName, amountMinor: ret.totals.totalMinor })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence)
  return { rows, warnings, salesMinor: representativeReportSum(rows.filter(row => row.kind === 'sale').map(row => row.amountMinor)), returnsMinor: representativeReportSum(rows.filter(row => row.kind === 'return').map(row => row.amountMinor)), reversalsMinor: representativeReportSum(rows.filter(row => row.kind === 'reversal').map(row => row.amountMinor)), unassignedCount: rows.filter(row => row.representativeId == null).length }
}
