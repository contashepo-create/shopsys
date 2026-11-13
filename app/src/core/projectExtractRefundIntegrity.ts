import { FinancialDataReviewError } from './financialDataReview.ts'
import { assertBalanced, type JournalEntry } from './ledger.ts'
import type { ServiceRefundRecord } from './serviceRefund.ts'
import { planProjectCreditAmounts, projectCreditEvidence, type ProjectCreditLine } from './projectCreditAllocation.ts'
import type { ProjectRefundQuantity } from './projectRefundQuantities.ts'
import { creditedProjectRetention } from './projectExtractNet.ts'
import { isValidExpiryDate } from './batches.ts'

/** لا تعكس ولا ترد مستخلصاً إذا لم يطابق القيد الأصلي مستنده. */
export function assertProjectExtractOriginalIntegrity(
  extract: { id: number; extractNumber: string; journalEntryId: number; payment: 'cash' | 'credit'; advanceRecoveryMinor?: number; totals: { grossMinor: number; vatMinor: number; retentionMinor: number; dueMinor: number } },
  journal: ReadonlyMap<number, JournalEntry>,
): void {
  const fail = (): never => { throw new FinancialDataReviewError(`المستخلص ${extract.extractNumber}`) }
  const t = extract.totals
  const recovery = extract.advanceRecoveryMinor ?? 0
  if (!t || !Number.isSafeInteger(t.grossMinor) || t.grossMinor <= 0 || !Number.isSafeInteger(t.vatMinor) || t.vatMinor < 0 || !Number.isSafeInteger(t.retentionMinor) || t.retentionMinor < 0 || !Number.isSafeInteger(t.dueMinor) || t.dueMinor < 0 || t.dueMinor !== t.grossMinor + t.vatMinor - t.retentionMinor || !Number.isSafeInteger(recovery) || recovery < 0 || recovery > t.dueMinor || (extract.payment !== 'cash' && extract.payment !== 'credit')) return fail()
  const entry = journal.get(extract.journalEntryId)
  if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) return fail()
  try { assertBalanced(entry.lines) } catch { return fail() }
  const sum = (account: string, side: 'debit' | 'credit') => entry.lines.filter(line => line.accountCode === account).reduce((n, line) => n + line[side], 0)
  const totalDebit = entry.lines.reduce((n, line) => n + line.debit, 0)
  if (totalDebit !== t.grossMinor + t.vatMinor || sum('4107', 'credit') !== t.grossMinor || sum('2102', 'credit') !== t.vatMinor || sum('1105', 'debit') !== t.retentionMinor || sum('2109', 'debit') !== recovery || sum('1104', 'debit') !== (extract.payment === 'credit' ? t.dueMinor - recovery : 0) || sum('4107', 'debit') !== 0 || sum('2102', 'debit') !== 0 || sum('1105', 'credit') !== 0 || sum('2109', 'credit') !== 0 || sum('1104', 'credit') !== 0) return fail()
}

/** لا نعدّ الإشعار دليلاً على تخفيض الذمة أو الإيراد حتى يطابق قيده. */
export function assertProjectExtractRefundIntegrity(
  extracts: readonly { id: number; extractNumber: string; journalEntryId?: number; date?: string; totals: { dueMinor: number; vatMinor: number; grossMinor?: number; retentionMinor?: number }; lines?: readonly ProjectCreditLine[]; advanceRecoveryMinor?: number; refundedMinor?: number; refundedTaxMinor?: number; quantityCreditVersion?: number; refunds?: readonly (ServiceRefundRecord & { quantities?: readonly ProjectRefundQuantity[]; grossMinor?: number; retentionMinor?: number })[] }[],
  journal: ReadonlyMap<number, JournalEntry>,
): void {
  const used = new Set<number>()
  for (const extract of extracts) {
    const fail = (): never => { throw new FinancialDataReviewError(`إشعارات المستخلص ${extract.extractNumber}`) }
    const refunds = extract.refunds ?? []
    const hasEvidence = refunds.some(row => row.quantities != null || row.grossMinor != null || row.retentionMinor != null)
    if (extract.quantityCreditVersion != null && extract.quantityCreditVersion !== 1 && extract.quantityCreditVersion !== 2) return fail()
    if (extract.quantityCreditVersion != null && !refunds.length) return fail()
    if (hasEvidence && extract.quantityCreditVersion == null) return fail()
    if (extract.quantityCreditVersion != null) {
      if ((extract.advanceRecoveryMinor ?? 0) !== 0 || !extract.date || !isValidExpiryDate(extract.date.slice(0, 10)) || !Number.isSafeInteger(extract.journalEntryId) || extract.journalEntryId! <= 0) return fail()
      const original = journal.get(extract.journalEntryId!)
      if (!original || original.date !== extract.date.slice(0, 10) || original.sourceType !== 'project_extract' || original.sourceId !== extract.id) return fail()
      try {
        const evidence = projectCreditEvidence(refunds)
        const { grossMinor, retentionMinor, dueMinor, vatMinor } = extract.totals
        if (!extract.lines?.length || grossMinor == null || retentionMinor == null || (extract.quantityCreditVersion === 1 && retentionMinor !== 0) || (extract.quantityCreditVersion === 2 && retentionMinor <= 0)) return fail()
        let refundedMinor = 0, refundedTaxMinor = 0
        for (let index = 0; index < evidence.length; index++) {
          const row = evidence[index]
          const expected = planProjectCreditAmounts({ lines: extract.lines, totals: { grossMinor, retentionMinor, dueMinor, vatMinor }, refunds: evidence.slice(0, index), refundedMinor, refundedTaxMinor, selected: row.quantities })
          if (expected.amountMinor !== row.amountMinor || expected.taxShareMinor !== row.taxShareMinor || expected.grossMinor !== row.grossMinor || expected.retentionMinor !== row.retentionMinor) return fail()
          refundedMinor += row.amountMinor
          refundedTaxMinor += row.taxShareMinor
        }
      } catch { return fail() }
    }
    let amount = 0, tax = 0, previousDate = '', previousEntryId = extract.journalEntryId ?? 0
    for (const refund of extract.refunds ?? []) {
      if (!Number.isSafeInteger(refund.journalEntryId) || used.has(refund.journalEntryId) || !Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0 || !Number.isSafeInteger(refund.taxShareMinor) || refund.taxShareMinor < 0 || refund.taxShareMinor > refund.amountMinor || (refund.mode !== 'cash' && refund.mode !== 'customer_credit')) return fail()
      used.add(refund.journalEntryId)
      const entry = journal.get(refund.journalEntryId)
      if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) return fail()
      if (extract.quantityCreditVersion != null && (!isValidExpiryDate(refund.date) || entry.date !== refund.date || refund.date < previousDate || refund.date < extract.date!.slice(0, 10) || refund.journalEntryId <= previousEntryId)) return fail()
      previousDate = refund.date
      previousEntryId = refund.journalEntryId
      try { assertBalanced(entry.lines) } catch { return fail() }
      const sum = (account: string, side: 'debit' | 'credit') => entry.lines.filter(line => line.accountCode === account).reduce((n, line) => n + line[side], 0)
      const totalDebit = entry.lines.reduce((n, line) => n + line.debit, 0)
      const retention = extract.quantityCreditVersion === 2 ? refund.retentionMinor! : 0
      if (totalDebit !== refund.amountMinor + retention || sum('4102', 'debit') !== refund.amountMinor - refund.taxShareMinor + retention || sum('2102', 'debit') !== refund.taxShareMinor || sum('1105', 'credit') !== retention || sum('1105', 'debit') !== 0 || sum('4102', 'credit') !== 0 || sum('2102', 'credit') !== 0 || sum('1104', 'debit') !== 0 || sum('1104', 'credit') !== (refund.mode === 'customer_credit' ? refund.amountMinor : 0)) return fail()
      amount += refund.amountMinor
      tax += refund.taxShareMinor
    }
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(tax) || amount !== (extract.refundedMinor ?? 0) || tax !== (extract.refundedTaxMinor ?? 0) || amount > extract.totals.dueMinor || tax > extract.totals.vatMinor) return fail()
  }
}

/** بعد مطابقة القيود، افصل رد الضريبة عن الإيراد في كل تقارير المشروع. */
export function netProjectExtractTotals(extract: { totals: { grossMinor: number; vatMinor: number }; refundedMinor?: number; refundedTaxMinor?: number; quantityCreditVersion?: number; refunds?: readonly { retentionMinor?: number }[] }): { grossMinor: number; vatMinor: number } {
  const tax = extract.refundedTaxMinor ?? 0
  const retained = creditedProjectRetention(extract)
  return { grossMinor: extract.totals.grossMinor - ((extract.refundedMinor ?? 0) - tax + retained), vatMinor: extract.totals.vatMinor - tax }
}
