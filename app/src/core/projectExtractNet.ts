import { FinancialDataReviewError } from './financialDataReview.ts'

/** خصم محتجز الإشعار الكمي فقط؛ لا يُستنتج من إشعار مالي قديم. */
export function creditedProjectRetention(extract: { quantityCreditVersion?: number; refunds?: readonly { retentionMinor?: number }[] }): number {
  if (extract.quantityCreditVersion !== 2) return 0
  if (!extract.refunds?.length) throw new FinancialDataReviewError('محتجز إشعارات المستخلص')
  let sum = 0
  for (const refund of extract.refunds) {
    if (typeof refund.retentionMinor !== 'number' || !Number.isSafeInteger(refund.retentionMinor) || refund.retentionMinor < 0) throw new FinancialDataReviewError('محتجز إشعارات المستخلص')
    sum += refund.retentionMinor
    if (!Number.isSafeInteger(sum)) throw new FinancialDataReviewError('محتجز إشعارات المستخلص')
  }
  return sum
}
