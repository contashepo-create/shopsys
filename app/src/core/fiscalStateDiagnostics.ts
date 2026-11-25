import { hasActivityAfterFiscalClose, isFiscalCloseArtifactValid, isFiscalCloseReversalSequenceValid, validateFiscalYear, type FiscalYear } from './fiscal.ts'
import type { JournalEntry } from './ledger.ts'

/**
 * مؤشرات للمراجعة فقط من سنوات وقيود ظاهرة للمستخدم. عدم وجود تنبيه لا
 * يثبت سلامة الإقفال أو صلاحية روابطه، ولا يغيّر حالة السنة أو اليومية.
 */
export function fiscalYearStateWarnings(years: readonly FiscalYear[], journal: readonly JournalEntry[], mainBranchId?: number): number[] {
  if (!Array.isArray(years) || !Array.isArray(journal)) return []
  const rowsById = new Map<number, JournalEntry[]>()
  const positions = new Map<JournalEntry, number>()
  const claimsById = new Map<number, Set<JournalEntry>>()
  const yearCounts = new Map<number, number>()
  const closingsByYear = new Map<number, JournalEntry[]>()
  for (const year of years) if (year && typeof year === 'object') yearCounts.set(year.id, (yearCounts.get(year.id) ?? 0) + 1)
  journal.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    positions.set(entry, index)
    const rows = rowsById.get(entry.id) ?? []
    rows.push(entry); rowsById.set(entry.id, rows)
    const claims = new Set<number>()
    if (entry.reversesEntryId != null) claims.add(entry.reversesEntryId)
    if (entry.sourceType === 'reversal' && entry.sourceId != null) claims.add(entry.sourceId)
    for (const id of claims) {
      const list = claimsById.get(id) ?? new Set<JournalEntry>()
      list.add(entry); claimsById.set(id, list)
    }
    if (entry.sourceType === 'year_closing' && entry.sourceId != null) {
      const list = closingsByYear.get(entry.sourceId) ?? []
      list.push(entry); closingsByYear.set(entry.sourceId, list)
    }
  })
  const reversalInvalid = (entry: JournalEntry): boolean => {
    const claims = claimsById.get(entry.id) ?? new Set<JournalEntry>()
    if (entry.reversedByEntryId == null) return claims.size > 0
    if (!Number.isSafeInteger(entry.reversedByEntryId) || entry.reversedByEntryId <= 0) return true
    const rows = rowsById.get(entry.reversedByEntryId) ?? [], reverse = rows[0]
    if (rows.length !== 1 || claims.size !== 1 || !claims.has(reverse) || reverse.sourceType !== 'reversal'
      || reverse.sourceId !== entry.id || reverse.reversesEntryId !== entry.id || reverse.reversedByEntryId != null
      || reverse.date !== entry.date || (positions.get(reverse) ?? -1) <= (positions.get(entry) ?? -1)
      || (reverse.branchId != null && entry.branchId != null && reverse.branchId !== entry.branchId)
      || !Array.isArray(entry.lines) || !Array.isArray(reverse.lines) || entry.lines.length !== reverse.lines.length) return true
    return reverse.lines.some((line, index) => {
      const old = entry.lines[index]
      return !line || !old || line.accountCode !== old.accountCode || line.debit !== old.credit || line.credit !== old.debit
        || (line.costCenterId ?? null) !== (old.costCenterId ?? null) || (line.partyKind ?? null) !== (old.partyKind ?? null)
        || (line.partyId ?? null) !== (old.partyId ?? null) || (line.relatedBranchId ?? null) !== (old.relatedBranchId ?? null)
    })
  }
  const warnings = new Set<number>()
  for (const year of years) {
    if (!year || !Number.isSafeInteger(year.id) || year.id <= 0) continue
    const closings = closingsByYear.get(year.id) ?? []
    const invalidYear = typeof year.nameAr !== 'string' || typeof year.startDate !== 'string' || typeof year.endDate !== 'string' || validateFiscalYear(year, []).length > 0
    const invalid = invalidYear || yearCounts.get(year.id) !== 1 || (year.status !== 'open' && year.status !== 'closed') || closings.some(entry =>
      rowsById.get(entry.id)?.length !== 1 || !isFiscalCloseArtifactValid(entry, year, entry.branchId, entry.branchId)
      || entry.reversesEntryId != null || reversalInvalid(entry)
      || (entry.branchId != null && year.branchId != null && entry.branchId !== year.branchId)
      || (entry.sourceCollection != null && entry.sourceCollection !== 'fiscalYears'),
    )
    const active = closings.filter(entry => entry.reversedByEntryId == null)
    // اتبع حارس الاستعادة للتسلسل الظاهر؛ الحركة بعد عكس مكتمل قد تكون تصحيحاً مشروعاً.
    const invalidSequence = !invalid && closings.some(entry => entry.reversedByEntryId != null && !isFiscalCloseReversalSequenceValid(journal, year, entry, mainBranchId))
    const lateActivity = !invalidYear && year.status === 'closed' && active.length === 1 && hasActivityAfterFiscalClose(journal, year, active[0], mainBranchId)
    if (invalid || invalidSequence || active.length > 1 || (year.status === 'open' && active.length > 0) || (year.status === 'closed' && active.length !== 1) || lateActivity) warnings.add(year.id)
  }
  return [...warnings]
}
