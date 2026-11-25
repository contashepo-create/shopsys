import { FinancialDataReviewError } from './financialDataReview.ts'
import { assertBalanced, type JournalEntry } from './ledger.ts'
import type { ServiceRefundRecord } from './serviceRefund.ts'
import { planProjectCreditAmounts, projectCreditEvidence, type ProjectCreditLine } from './projectCreditAllocation.ts'
import type { ProjectRefundQuantity } from './projectRefundQuantities.ts'
import { creditedProjectRetention } from './projectExtractNet.ts'
import { isValidExpiryDate } from './batches.ts'
import type { ProjectAdvanceAllocation } from './projectAdvanceRecovery.ts'
import { planAdvanceCredit, type AdvanceCreditEvidence } from './projectAdvanceCreditPlan.ts'

/** لا تعكس ولا ترد مستخلصاً إذا لم يطابق القيد الأصلي مستنده. */
export function assertProjectExtractOriginalIntegrity(
  extract: { id: number; extractNumber: string; journalEntryId: number; payment: 'cash' | 'credit'; advanceRecoveryMinor?: number; totals: { grossMinor: number; vatMinor: number; retentionMinor: number; dueMinor: number } },
  journal: ReadonlyMap<number, JournalEntry>,
): void {
  if (!extract || typeof extract !== 'object' || Array.isArray(extract)) throw new FinancialDataReviewError('المستخلص')
  const fail = (): never => { throw new FinancialDataReviewError(`المستخلص ${extract.extractNumber}`) }
  const t = extract.totals
  const recovery = extract.advanceRecoveryMinor ?? 0
  if (!t || !Number.isSafeInteger(t.grossMinor) || t.grossMinor <= 0 || !Number.isSafeInteger(t.vatMinor) || t.vatMinor < 0 || !Number.isSafeInteger(t.retentionMinor) || t.retentionMinor < 0 || !Number.isSafeInteger(t.dueMinor) || t.dueMinor < 0 || t.dueMinor !== t.grossMinor + t.vatMinor - t.retentionMinor || !Number.isSafeInteger(recovery) || recovery < 0 || recovery > t.dueMinor || (extract.payment !== 'cash' && extract.payment !== 'credit')) return fail()
  const entry = journal.get(extract.journalEntryId)
  if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !line || typeof line !== 'object' || !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) return fail()
  try { assertBalanced(entry.lines) } catch { return fail() }
  const sum = (account: string, side: 'debit' | 'credit') => entry.lines.filter(line => line.accountCode === account).reduce((n, line) => n + line[side], 0)
  const totalDebit = entry.lines.reduce((n, line) => n + line.debit, 0)
  if (totalDebit !== t.grossMinor + t.vatMinor || sum('4107', 'credit') !== t.grossMinor || sum('2102', 'credit') !== t.vatMinor || sum('1105', 'debit') !== t.retentionMinor || sum('2109', 'debit') !== recovery || sum('1104', 'debit') !== (extract.payment === 'credit' ? t.dueMinor - recovery : 0) || sum('4107', 'debit') !== 0 || sum('2102', 'debit') !== 0 || sum('1105', 'credit') !== 0 || sum('2109', 'credit') !== 0 || sum('1104', 'credit') !== 0) return fail()
}

/** لا نعدّ الإشعار دليلاً على تخفيض الذمة أو الإيراد حتى يطابق قيده. */
export function assertProjectExtractRefundIntegrity(
  extracts: readonly { id: number; extractNumber: string; journalEntryId?: number; date?: string; totals: { dueMinor: number; vatMinor: number; grossMinor?: number; retentionMinor?: number }; lines?: readonly ProjectCreditLine[]; advanceRecoveryMinor?: number; advanceAllocations?: readonly ProjectAdvanceAllocation[]; refundedMinor?: number; refundedTaxMinor?: number; quantityCreditVersion?: number; refunds?: readonly (ServiceRefundRecord & { quantities?: readonly ProjectRefundQuantity[]; grossMinor?: number; retentionMinor?: number; restoredAdvanceMinor?: number; restoredAdvanceAllocations?: readonly ProjectAdvanceAllocation[] })[] }[],
  journal: ReadonlyMap<number, JournalEntry>,
  options?: { experimentalAdvanceReplay?: boolean },
): void {
  if (!Array.isArray(extracts as unknown)) throw new FinancialDataReviewError('إشعارات المستخلصات')
  const used = new Set<number>()
  for (const extract of extracts) {
    if (!extract || typeof extract !== 'object' || Array.isArray(extract)) throw new FinancialDataReviewError('إشعارات المستخلصات')
    const fail = (): never => { throw new FinancialDataReviewError(`إشعارات المستخلص ${extract.extractNumber}`) }
    // بيانات النسخ القديمة قد تكون غير مطابقة للأنواع في الذاكرة؛ يجب أن
    // تذهب للمراجعة المالية بدلاً من تعطيل التقرير بخطأ TypeError.
    if (!extract.totals || typeof extract.totals !== 'object' || !Number.isSafeInteger(extract.totals.dueMinor) || extract.totals.dueMinor < 0 || !Number.isSafeInteger(extract.totals.vatMinor) || extract.totals.vatMinor < 0 || (extract.refunds != null && !Array.isArray(extract.refunds))) return fail()
    const refunds = extract.refunds ?? []
    if (refunds.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return fail()
    const hasEvidence = refunds.some(row => row.quantities != null || row.grossMinor != null || row.retentionMinor != null || row.restoredAdvanceMinor != null)
    // نسخة إعادة المقدمة تجريبية فقط؛ لا تفتح المسار التشغيلي أو التقارير.
    const experimental = extract.quantityCreditVersion === 3 && options?.experimentalAdvanceReplay === true
    if (extract.quantityCreditVersion != null && extract.quantityCreditVersion !== 1 && extract.quantityCreditVersion !== 2 && !experimental) return fail()
    if (extract.quantityCreditVersion != null && !refunds.length) return fail()
    if (hasEvidence && extract.quantityCreditVersion == null) return fail()
    if (extract.quantityCreditVersion != null) {
      const recovery = extract.advanceRecoveryMinor ?? 0
      if (!Number.isSafeInteger(recovery) || recovery < 0 || recovery > extract.totals.dueMinor || typeof extract.date !== 'string' || !isValidExpiryDate(extract.date.slice(0, 10)) || !Number.isSafeInteger(extract.journalEntryId) || extract.journalEntryId! <= 0) return fail()
      if (recovery > 0) {
        const allocations = extract.advanceAllocations
        if (!Array.isArray(allocations) || !allocations.length || (!experimental && refunds.some(row => row.restoredAdvanceMinor !== 0))) return fail()
        let allocated = 0
        const ids = new Set<number>(), entries = new Set<number>()
        for (const row of allocations) {
          if (!row || !Number.isSafeInteger(row.advanceId) || row.advanceId <= 0 || ids.has(row.advanceId) || !Number.isSafeInteger(row.journalEntryId) || row.journalEntryId <= 0 || row.journalEntryId >= extract.journalEntryId! || entries.has(row.journalEntryId) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) return fail()
          ids.add(row.advanceId); entries.add(row.journalEntryId); allocated += row.amountMinor
          if (!Number.isSafeInteger(allocated)) return fail()
        }
        if (allocated !== recovery || (!experimental && (extract.refundedMinor ?? 0) > extract.totals.dueMinor - recovery)) return fail()
        if (experimental) {
          const previous: AdvanceCreditEvidence[] = []
          for (const refund of refunds) {
            if (!Number.isSafeInteger(refund.restoredAdvanceMinor) || !Array.isArray(refund.restoredAdvanceAllocations)) return fail()
            let plan: ReturnType<typeof planAdvanceCredit>
            try { plan = planAdvanceCredit({ dueMinor: extract.totals.dueMinor, recoveryMinor: recovery, allocations, previous, amountMinor: refund.amountMinor, restoredAdvanceMinor: refund.restoredAdvanceMinor! }) } catch { return fail() }
            if (plan.allocations.length !== refund.restoredAdvanceAllocations.length || plan.allocations.some((row, index) => row.advanceId !== refund.restoredAdvanceAllocations![index]?.advanceId || row.journalEntryId !== refund.restoredAdvanceAllocations![index]?.journalEntryId || row.amountMinor !== refund.restoredAdvanceAllocations![index]?.amountMinor)) return fail()
            previous.push({ amountMinor: refund.amountMinor, restoredAdvanceMinor: refund.restoredAdvanceMinor!, allocations: refund.restoredAdvanceAllocations })
          }
        }
      } else if (experimental || refunds.some(row => row.restoredAdvanceMinor != null && row.restoredAdvanceMinor !== 0)) return fail()
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
      if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !line || typeof line !== 'object' || !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) return fail()
      if (extract.quantityCreditVersion != null && (!isValidExpiryDate(refund.date) || entry.date !== refund.date || refund.date < previousDate || refund.date < extract.date!.slice(0, 10) || refund.journalEntryId <= previousEntryId)) return fail()
      previousDate = refund.date
      previousEntryId = refund.journalEntryId
      try { assertBalanced(entry.lines) } catch { return fail() }
      const sum = (account: string, side: 'debit' | 'credit') => entry.lines.filter(line => line.accountCode === account).reduce((n, line) => n + line[side], 0)
      const totalDebit = entry.lines.reduce((n, line) => n + line.debit, 0)
      const retention = extract.quantityCreditVersion === 2 || experimental ? refund.retentionMinor! : 0
      const restored = experimental ? refund.restoredAdvanceMinor! : 0
      if (extract.quantityCreditVersion != null && (sum('2109', 'debit') !== 0 || sum('2109', 'credit') !== restored)) return fail()
      if (totalDebit !== refund.amountMinor + retention || sum('4102', 'debit') !== refund.amountMinor - refund.taxShareMinor + retention || sum('2102', 'debit') !== refund.taxShareMinor || sum('1105', 'credit') !== retention || sum('1105', 'debit') !== 0 || sum('4102', 'credit') !== 0 || sum('2102', 'credit') !== 0 || sum('1104', 'debit') !== 0 || sum('1104', 'credit') !== (refund.mode === 'customer_credit' ? refund.amountMinor - restored : 0)) return fail()
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
