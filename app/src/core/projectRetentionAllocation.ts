import { FinancialDataReviewError } from './financialDataReview.ts'

/** توزيع التحصيل الكامل فقط؛ لا يستنتج توزيعاً لتحصيل سابق. */
export interface RetentionExtractAllocation { extractId: number; journalEntryId: number; amountMinor: number }
interface RetentionExtract {
  id: number
  journalEntryId: number
  totals: { retentionMinor: number }
  quantityCreditVersion?: number
  refunds?: readonly { journalEntryId: number; retentionMinor?: number }[]
}

/**
 * يحدد حصة كل مستخلص في التحصيل الكامل عند تسلسل قيد معين.
 * يجب على المستدعي فحص الأصل والقيود والإشعارات وتسلسلها أولاً؛
 * هذه ليست تسوية لمحتجز محصل أو إثباتاً لعكس أو تخصيص جزئي.
 */
export function fullRetentionAllocations(extracts: readonly RetentionExtract[], beforeEntryId: number): RetentionExtractAllocation[] {
  const fail = (): never => { throw new FinancialDataReviewError('توزيع تحصيل المحتجز', 'تعذر إثبات محتجز المستخلصات عند التحصيل') }
  if (!Number.isSafeInteger(beforeEntryId) || beforeEntryId <= 0) return fail()
  const ids = new Set<number>(), entries = new Set<number>()
  const result: RetentionExtractAllocation[] = []
  for (const extract of extracts) {
    if (!Number.isSafeInteger(extract.id) || extract.id <= 0 || ids.has(extract.id) || !Number.isSafeInteger(extract.journalEntryId) || extract.journalEntryId <= 0 || entries.has(extract.journalEntryId)) return fail()
    ids.add(extract.id); entries.add(extract.journalEntryId)
    if (extract.journalEntryId >= beforeEntryId) continue
    const held = extract.totals?.retentionMinor
    if (!Number.isSafeInteger(held) || held < 0) return fail()
    let credited = 0
    if (extract.quantityCreditVersion === 2) for (const refund of extract.refunds ?? []) {
      if (!Number.isSafeInteger(refund.journalEntryId) || refund.journalEntryId <= extract.journalEntryId || !Number.isSafeInteger(refund.retentionMinor) || refund.retentionMinor! < 0) return fail()
      if (refund.journalEntryId < beforeEntryId) credited += refund.retentionMinor!
      if (!Number.isSafeInteger(credited)) return fail()
    }
    const remaining = held - credited
    if (!Number.isSafeInteger(remaining) || remaining < 0) return fail()
    if (remaining) result.push({ extractId: extract.id, journalEntryId: extract.journalEntryId, amountMinor: remaining })
  }
  return result.sort((a, b) => a.journalEntryId - b.journalEntryId)
}
