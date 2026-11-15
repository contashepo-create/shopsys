import type { JournalEntry, JournalLine } from './ledger.ts'

/** Restricted clearing accounts used only by balanced inter-branch transfer pairs. */
export const INTERBRANCH_RECEIVABLE = '1114'
export const INTERBRANCH_PAYABLE = '2118'

export interface InterBranchTransferLines {
  sourceLines: JournalLine[]
  destinationLines: JournalLine[]
}

/**
 * Build both sides of an inter-branch cash transfer. A branch's position is
 * debit-minus-credit on its due-to/due-from account against this counterparty.
 * A negative position means this branch already owes the counterparty.
 */
export function buildInterBranchTransferLines(args: {
  sourceBranchId: number
  destinationBranchId: number
  sourceTreasury: string
  destinationTreasury: string
  amountMinor: number
  feeMinor?: number
  sourcePositionMinor?: number
  description?: string
}): InterBranchTransferLines {
  const { sourceBranchId, destinationBranchId, sourceTreasury, destinationTreasury } = args
  const { amountMinor, feeMinor = 0, sourcePositionMinor = 0 } = args
  if (!Number.isInteger(sourceBranchId) || !Number.isInteger(destinationBranchId) || sourceBranchId === destinationBranchId) throw new RangeError('يجب أن يكون التحويل بين فرعين مختلفين')
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || !Number.isInteger(feeMinor) || feeMinor < 0) throw new RangeError('مبلغ التحويل أو الرسوم غير صالح')
  if (sourceTreasury === destinationTreasury) throw new RangeError('خزينة المصدر والوجهة متطابقتان')

  const settle = sourcePositionMinor < 0 ? Math.min(amountMinor, -sourcePositionMinor) : 0
  const newReceivable = amountMinor - settle
  const note = args.description || 'تحويل بين الفروع'
  const sourceLines: JournalLine[] = []
  const destinationLines: JournalLine[] = [
    { accountCode: destinationTreasury, debit: amountMinor, credit: 0, note },
  ]
  if (settle > 0) {
    sourceLines.push({ accountCode: INTERBRANCH_PAYABLE, debit: settle, credit: 0, note, relatedBranchId: destinationBranchId })
    destinationLines.push({ accountCode: INTERBRANCH_RECEIVABLE, debit: 0, credit: settle, note, relatedBranchId: sourceBranchId })
  }
  if (newReceivable > 0) {
    sourceLines.push({ accountCode: INTERBRANCH_RECEIVABLE, debit: newReceivable, credit: 0, note, relatedBranchId: destinationBranchId })
    destinationLines.push({ accountCode: INTERBRANCH_PAYABLE, debit: 0, credit: newReceivable, note, relatedBranchId: sourceBranchId })
  }
  if (feeMinor > 0) sourceLines.push({ accountCode: '5108', debit: feeMinor, credit: 0, note: 'رسوم تحويل بين الفروع' })
  sourceLines.push({ accountCode: sourceTreasury, debit: 0, credit: amountMinor + feeMinor, note })
  return { sourceLines, destinationLines }
}

/**
 * Conservative structural pairing; this is not proof of legal consolidation.
 * Match every clearing line to the opposite account and reciprocal branch.
 * A shared source id or an overall zero alone is not sufficient evidence.
 */
export function pairedInterBranchTransferGroups(journal: readonly JournalEntry[]): JournalEntry[][] {
  const grouped = new Map<string, JournalEntry[]>()
  for (const entry of journal) {
    if (!entry.branchId || entry.sourceId == null) continue
    const key = entry.interBranchTransferId != null
      ? `inter-branch:${entry.interBranchTransferId}:${entry.reversesEntryId != null || entry.sourceType === 'reversal' ? 'reversal' : 'original'}`
      : `${entry.sourceType}:${entry.sourceId}`
    const rows = grouped.get(key) ?? []
    rows.push(entry)
    grouped.set(key, rows)
  }
  const groups: JournalEntry[][] = []
  for (const entries of grouped.values()) {
    const branches = new Set(entries.map(entry => entry.branchId))
    if (branches.size !== 2 || entries.length !== 2 || new Set(entries.map(entry => entry.id)).size !== entries.length) continue
    const amounts = new Map<string, number>()
    let valid = true
    for (const entry of entries) {
      const due = entry.lines.filter(line => (line.accountCode === INTERBRANCH_RECEIVABLE || line.accountCode === INTERBRANCH_PAYABLE) && line.relatedBranchId != null)
      if (!due.length) { valid = false; break }
      for (const line of due) {
        if (!Number.isSafeInteger(entry.branchId) || entry.branchId! <= 0 || line.relatedBranchId == null || !Number.isSafeInteger(line.relatedBranchId) || line.relatedBranchId <= 0 || line.relatedBranchId === entry.branchId || !branches.has(line.relatedBranchId) || !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0) || line.debit === line.credit) { valid = false; break }
        const key = JSON.stringify([entry.branchId, line.relatedBranchId, line.accountCode])
        const total = (amounts.get(key) ?? 0) + line.debit - line.credit
        if (!Number.isSafeInteger(total)) { valid = false; break }
        amounts.set(key, total)
      }
      if (!valid) break
    }
    if (!valid) continue
    for (const [key, amount] of amounts) {
      const [branch, other, code] = JSON.parse(key) as [number, number, string]
      const opposite = code === INTERBRANCH_RECEIVABLE ? INTERBRANCH_PAYABLE : INTERBRANCH_RECEIVABLE
      const counterpart = JSON.stringify([other, branch, opposite])
      if (!amounts.has(counterpart) || amount !== -amounts.get(counterpart)!) { valid = false; break }
    }
    if (valid) groups.push(entries)
  }
  return groups
}

/** Return IDs belonging to structurally paired visible inter-branch transfers. */
export function pairedInterBranchTransferEntryIds(journal: readonly JournalEntry[]): Set<number> {
  return new Set(pairedInterBranchTransferGroups(journal).flatMap(entries => entries.map(entry => entry.id)))
}

/** Eliminate only verified, paired clearing lines in company-wide reports. */
export function eliminatePairedInterBranchLines(journal: readonly JournalEntry[]): JournalEntry[] {
  const pairedIds = pairedInterBranchTransferEntryIds(journal)
  return journal.map((entry) => pairedIds.has(entry.id)
    ? { ...entry, lines: entry.lines.filter((line) =>
        !((line.accountCode === INTERBRANCH_RECEIVABLE || line.accountCode === INTERBRANCH_PAYABLE) && line.relatedBranchId != null),
      ) }
    : entry)
}
