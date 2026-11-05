/** دفتر جزئي لسندات القبض الصريحة، لا يستنتج هوية المحصل من الطرف أو المستخدم. */
import type { Voucher } from '../data/repo.ts'
import { buildReceiptVoucherEntry } from './accounting.ts'
import { assertBalanced, buildReversalLines, type JournalEntry, type JournalLine } from './ledger.ts'
import { inPeriod, type Period } from './reports.ts'

export interface CollectorReceiptRow {
  date: string
  document: string
  kind: 'receipt' | 'reversal'
  collectorId: number | null
  collectorName: string
  counterAccountCode: string
  amountMinor: number
}
export interface CollectorReceiptResult { rows: CollectorReceiptRow[]; warnings: string[] }

const lineKey = (line: JournalLine) => JSON.stringify([line.accountCode, line.debit, line.credit, line.costCenterId ?? null, line.partyKind ?? null, line.partyId ?? null, line.relatedBranchId ?? null])
const sameLines = (left: JournalLine[], right: JournalLine[]) => left.length === right.length && JSON.stringify(left.map(lineKey).sort()) === JSON.stringify(right.map(lineKey).sort())

export function receiptCollectorReport(vouchers: readonly Voucher[], journal: readonly JournalEntry[], employees: readonly { id: number; nameAr: string }[], period: Period): CollectorReceiptResult {
  const rows: CollectorReceiptRow[] = [], warnings: string[] = []
  for (const voucher of vouchers) {
    if (voucher.kind !== 'receipt') continue
    const matches = journal.filter(entry => entry.id === voucher.journalEntryId)
    const entry = matches[0]
    const reversalMatches = voucher.reversalEntryId == null ? [] : journal.filter(row => row.id === voucher.reversalEntryId)
    const reversal = reversalMatches[0]
    // افحص إما يوم القبض أو يوم العكس؛ المستند غير المرتبط بالفترة لا ينتج تحذيراً مضللاً.
    if (!inPeriod(voucher.date, period) && (!reversal || !inPeriod(reversal.date, period))) continue
    let valid = vouchers.filter(row => row.id === voucher.id).length === 1 && matches.length === 1 && entry.sourceType === 'receipt_voucher' && entry.sourceId === voucher.id && (entry.sourceCollection == null || entry.sourceCollection === 'vouchers') && entry.reversesEntryId == null && !entry.memoOnly && entry.date === voucher.date.slice(0, 10) && Number.isSafeInteger(voucher.amountMinor) && voucher.amountMinor > 0
    const id = voucher.receiptCollectorEmployeeId ?? null
    if ((voucher.receiptCollectorEmployeeId !== undefined || entry?.receiptCollectorId !== undefined) && voucher.receiptCollectorEmployeeId !== entry?.receiptCollectorId) valid = false
    const person = id == null ? [] : employees.filter(employee => employee.id === id)
    if (id != null && (!Number.isSafeInteger(id) || person.length !== 1)) valid = false
    try {
      if (!entry || !Array.isArray(entry.lines)) throw new Error('entry')
      assertBalanced(entry.lines)
      if (!sameLines(entry.lines, buildReceiptVoucherEntry(voucher.treasury, voucher.counterAccountCode, voucher.amountMinor, voucher.description))) valid = false
      if (voucher.reversalEntryId == null) {
        if (entry.reversedByEntryId != null) valid = false
      } else {
        if (reversalMatches.length !== 1 || entry.reversedByEntryId !== reversal.id || reversal.sourceType !== 'reversal' || reversal.sourceId !== entry.id || reversal.reversesEntryId !== entry.id || reversal.reversedByEntryId != null || reversal.memoOnly || reversal.date < entry.date) valid = false
        else { assertBalanced(reversal.lines); if (!sameLines(reversal.lines, buildReversalLines(entry.lines))) valid = false }
      }
    } catch { valid = false }
    if (!valid) { warnings.push(`تعذر إثبات سند القبض أو عكسه ${voucher.voucherNumber}؛ لم يُدرج.`); continue }
    const common = { document: voucher.voucherNumber, collectorId: id, collectorName: id == null ? 'غير محدد' : person[0].nameAr, counterAccountCode: voucher.counterAccountCode, amountMinor: voucher.amountMinor }
    if (inPeriod(voucher.date, period)) rows.push({ ...common, date: voucher.date.slice(0, 10), kind: 'receipt' })
    if (reversal && inPeriod(reversal.date, period)) rows.push({ ...common, date: reversal.date, kind: 'reversal' })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.document.localeCompare(b.document))
  return { rows, warnings }
}
