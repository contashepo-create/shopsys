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

/** Return entry IDs participating in a verified company-wide inter-branch pair. */
export function pairedInterBranchTransferEntryIds(journal: readonly JournalEntry[]): Set<number> {
  const grouped = new Map<string, JournalEntry[]>()
  for (const entry of journal) {
    if (!entry.branchId || entry.sourceId == null) continue
    const key = entry.interBranchTransferId != null
      ? `inter-branch:${entry.interBranchTransferId}`
      : `${entry.sourceType}:${entry.sourceId}`
    const rows = grouped.get(key) ?? []
    rows.push(entry)
    grouped.set(key, rows)
  }
  const pairedIds = new Set<number>()
  for (const entries of grouped.values()) {
    const branchIds = new Set(entries.map((entry) => entry.branchId).filter((id): id is number => id != null))
    if (branchIds.size < 2) continue
    const dueLines = entries.flatMap((entry) => entry.lines
      .filter((line) => (line.accountCode === INTERBRANCH_RECEIVABLE || line.accountCode === INTERBRANCH_PAYABLE) && line.relatedBranchId != null)
      .map((line) => ({ entry, line })))
    const totalDue = dueLines.reduce((sum, row) => sum + row.line.debit - row.line.credit, 0)
    const allCounterpartiesPresent = dueLines.every(({ entry, line }) => branchIds.has(entry.branchId!) && branchIds.has(line.relatedBranchId!))
    if (dueLines.length > 0 && totalDue === 0 && allCounterpartiesPresent) {
      for (const entry of entries) pairedIds.add(entry.id)
    }
  }
  return pairedIds
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
