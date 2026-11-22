import { isValidFiscalDate, type FiscalYear } from './fiscal.ts'
import type { JournalEntry } from './ledger.ts'

export interface FiscalCloseReview {
  valid: boolean
  checkedEntries: number
  periodEntries: number
  visibleUnassignedEntries: number
  invalidEntryIds: number[]
}

/** فحص بنيوي للدفتر المرئي حتى تاريخ الإقفال؛ لا يثبت صحة الأرصدة أو الجرد أو الإسناد. */
export function reviewFiscalCloseJournal(journal: readonly JournalEntry[], year: Pick<FiscalYear, 'startDate' | 'endDate'>): FiscalCloseReview {
  const invalidEntryIds: number[] = []
  let checkedEntries = 0, periodEntries = 0, visibleUnassignedEntries = 0
  let cumulativeDebit = 0, cumulativeCredit = 0
  const seen = new Set<number>()
  if (!isValidFiscalDate(year.startDate) || !isValidFiscalDate(year.endDate) || year.startDate > year.endDate) return { valid: false, checkedEntries, periodEntries, visibleUnassignedEntries, invalidEntryIds }
  for (const entry of journal) {
    if (!entry || typeof entry.date !== 'string' || !isValidFiscalDate(entry.date)) { invalidEntryIds.push(entry?.id ?? 0); continue }
    if (entry.date > year.endDate) continue
    checkedEntries++
    if (entry.date >= year.startDate) {
      periodEntries++
      if (entry.branchId == null) visibleUnassignedEntries++
    }
    const lines = Array.isArray(entry.lines) ? entry.lines : null
    const memo = entry.memoOnly === true
    let debit = 0, credit = 0, invalid = !Number.isSafeInteger(entry.id) || entry.id <= 0 || seen.has(entry.id) || !lines
      || (entry.memoOnly != null && typeof entry.memoOnly !== 'boolean')
      || (memo ? lines?.length !== 0 : (lines?.length ?? 0) < 2)
    seen.add(entry.id)
    for (const line of lines ?? []) {
      if (!line || typeof line.accountCode !== 'string' || !line.accountCode || !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0)) { invalid = true; continue }
      debit += line.debit; credit += line.credit
    }
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || (!memo && debit <= 0) || debit !== credit) invalid = true
    cumulativeDebit += debit; cumulativeCredit += credit
    if (!Number.isSafeInteger(cumulativeDebit) || !Number.isSafeInteger(cumulativeCredit)) invalid = true
    if (invalid) invalidEntryIds.push(entry.id)
  }
  return { valid: invalidEntryIds.length === 0, checkedEntries, periodEntries, visibleUnassignedEntries, invalidEntryIds }
}
