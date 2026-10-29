import { FinancialDataReviewError } from './financialDataReview.ts'
import { assertBalanced, type JournalEntry } from './ledger.ts'
import type { ServiceRefundRecord } from './serviceRefund.ts'

/** لا نعدّ الإشعار دليلاً على تخفيض الذمة أو الإيراد حتى يطابق قيده. */
export function assertProjectExtractRefundIntegrity(
  extracts: readonly { id: number; extractNumber: string; totals: { dueMinor: number; vatMinor: number }; refundedMinor?: number; refundedTaxMinor?: number; refunds?: readonly ServiceRefundRecord[] }[],
  journal: ReadonlyMap<number, JournalEntry>,
): void {
  const used = new Set<number>()
  for (const extract of extracts) {
    const fail = (): never => { throw new FinancialDataReviewError(`إشعارات المستخلص ${extract.extractNumber}`) }
    let amount = 0, tax = 0
    for (const refund of extract.refunds ?? []) {
      if (!Number.isSafeInteger(refund.journalEntryId) || used.has(refund.journalEntryId) || !Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0 || !Number.isSafeInteger(refund.taxShareMinor) || refund.taxShareMinor < 0 || refund.taxShareMinor > refund.amountMinor || (refund.mode !== 'cash' && refund.mode !== 'customer_credit')) return fail()
      used.add(refund.journalEntryId)
      const entry = journal.get(refund.journalEntryId)
      if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) return fail()
      try { assertBalanced(entry.lines) } catch { return fail() }
      const sum = (account: string, side: 'debit' | 'credit') => entry.lines.filter(line => line.accountCode === account).reduce((n, line) => n + line[side], 0)
      const totalDebit = entry.lines.reduce((n, line) => n + line.debit, 0)
      if (totalDebit !== refund.amountMinor || sum('4102', 'debit') !== refund.amountMinor - refund.taxShareMinor || sum('2102', 'debit') !== refund.taxShareMinor || sum('4102', 'credit') !== 0 || sum('2102', 'credit') !== 0 || sum('1104', 'debit') !== 0 || sum('1104', 'credit') !== (refund.mode === 'customer_credit' ? refund.amountMinor : 0)) return fail()
      amount += refund.amountMinor
      tax += refund.taxShareMinor
    }
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(tax) || amount !== (extract.refundedMinor ?? 0) || tax !== (extract.refundedTaxMinor ?? 0) || amount > extract.totals.dueMinor || tax > extract.totals.vatMinor) return fail()
  }
}

/** بعد مطابقة القيود، افصل رد الضريبة عن الإيراد في كل تقارير المشروع. */
export function netProjectExtractTotals(extract: { totals: { grossMinor: number; vatMinor: number }; refundedMinor?: number; refundedTaxMinor?: number }): { grossMinor: number; vatMinor: number } {
  const tax = extract.refundedTaxMinor ?? 0
  return { grossMinor: extract.totals.grossMinor - ((extract.refundedMinor ?? 0) - tax), vatMinor: extract.totals.vatMinor - tax }
}
