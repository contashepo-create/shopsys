import { expect, it } from 'vitest'
import { assertProjectExtractOriginalIntegrity, assertProjectExtractRefundIntegrity } from '../src/core/projectExtractRefundIntegrity.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'

const extract = { id: 1, extractNumber: 'EX-1', journalEntryId: 1, date: '2026-01-01', payment: 'credit' as const, totals: { grossMinor: 100, vatMinor: 0, retentionMinor: 0, dueMinor: 100 } }
const entry = { id: 1, sourceType: 'project_extract', sourceId: 1, lines: [{ accountCode: '1104', debit: 100, credit: 0 }, { accountCode: '4107', debit: 0, credit: 100 }] }
it('يعامل إشعارات المستخلص التالفة كمراجعة مالية لا كاستثناء لغة', () => {
 const malformed = [null, { ...extract, totals: null }, { ...extract, refunds: {} }, { ...extract, refunds: [null] }, { ...extract, refunds: [5] }, { ...extract, quantityCreditVersion: 1, date: 5, refunds: [{}] }]
 for (const row of malformed) expect(() => assertProjectExtractRefundIntegrity([row] as never, new Map())).toThrow(FinancialDataReviewError)
 expect(() => assertProjectExtractRefundIntegrity(null as never, new Map())).toThrow(FinancialDataReviewError)
})
it('يرفض سطر قيد فارغاً في المستخلص الأصلي أو قيد الإشعار برسالة مراجعة', () => {
 const badOriginal = new Map([[1, { ...entry, lines: [null] }]])
 expect(() => assertProjectExtractOriginalIntegrity(extract, badOriginal as never)).toThrow(FinancialDataReviewError)
 const refund = { journalEntryId: 2, amountMinor: 10, taxShareMinor: 0, mode: 'customer_credit', date: '2026-01-01' }
 const badRefund = new Map([[2, { id: 2, sourceType: 'project_extract', sourceId: 1, lines: [null] }]])
 expect(() => assertProjectExtractRefundIntegrity([{ ...extract, refundedMinor: 10, refunds: [refund] }] as never, badRefund as never)).toThrow(FinancialDataReviewError)
})
