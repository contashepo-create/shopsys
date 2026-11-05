import { FinancialDataReviewError } from './financialDataReview.ts'

/** المجاميع المالية لا يجوز أن تتجاوز دقة أصغر وحدة حتى مع كثرة المستندات. */
export function representativeReportSum(amounts: Iterable<number>): number {
  let total = 0
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw new FinancialDataReviewError('إجمالي دفتر المناديب والتحصيل', 'المبلغ أو مجموع الحركات خارج النطاق الآمن')
    total += amount
  }
  return total
}
