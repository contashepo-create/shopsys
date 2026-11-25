import { describe, expect, it } from 'vitest'
import { fullRetentionAllocations } from '../src/core/projectRetentionAllocation.ts'
import { creditedProjectRetention } from '../src/core/projectExtractNet.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'

const one = { id: 1, journalEntryId: 1, totals: { retentionMinor: 100 } }
const two = { id: 2, journalEntryId: 4, totals: { retentionMinor: 200 } }
const credited = { ...one, quantityCreditVersion: 2, refunds: [{ journalEntryId: 2, retentionMinor: 30 }, { journalEntryId: 3, retentionMinor: 20 }] }

describe('سلامة مساعد محتجز المستخلص', () => {
 it('يخصص الموجود عند القيد ولا يحسب الإشعار اللاحق', () => {
  const input = [two, credited], before = structuredClone(input)
  expect(fullRetentionAllocations(input, 3)).toEqual([{ extractId: 1, journalEntryId: 1, amountMinor: 70 }])
  expect(fullRetentionAllocations(input, 5)).toEqual([{ extractId: 1, journalEntryId: 1, amountMinor: 50 }, { extractId: 2, journalEntryId: 4, amountMinor: 200 }])
  expect(input).toEqual(before)
 })
 it('يرفض تكرار القيود أو الإشعارات وغيابها وترتيبها غير الصحيح', () => {
  const broken = [
   [{ ...one }, { ...two, id: 1 }], [{ ...one }, { ...two, journalEntryId: 1 }],
   [{ ...credited, refunds: [] }], [{ ...credited, refunds: [{ journalEntryId: 2, retentionMinor: 30 }, { journalEntryId: 2, retentionMinor: 20 }] }],
   [{ ...credited, refunds: [{ journalEntryId: 3, retentionMinor: 30 }, { journalEntryId: 2, retentionMinor: 20 }] }],
   [{ ...credited, refunds: [{ journalEntryId: 4, retentionMinor: 30 }] }, two],
   [{ ...credited, refunds: [{ journalEntryId: 2, retentionMinor: 101 }] }],
   [{ ...one, quantityCreditVersion: 3 }],
  ]
  for (const input of broken) expect(() => fullRetentionAllocations(input, 5)).toThrow(FinancialDataReviewError)
 })
 it('يرفض إجمالي الحصص خارج النطاق الصحيح بدلاً من إنشاء دليل مشوه', () => {
  expect(() => fullRetentionAllocations([{ ...one, totals: { retentionMinor: Number.MAX_SAFE_INTEGER } }, { ...two, totals: { retentionMinor: 1 } }], 5)).toThrow(FinancialDataReviewError)
 })
 it('يرفض بنية إشعار غير صالحة برسالة مراجعة مالية بدل خطأ واجهة', () => {
  for (const bad of [null, [null], [{ retentionMinor: -1 }], [{ retentionMinor: 0.5 }], [{ retentionMinor: Number.MAX_SAFE_INTEGER }, { retentionMinor: 1 }]]) {
   expect(() => creditedProjectRetention({ quantityCreditVersion: 2, refunds: bad as never })).toThrow(FinancialDataReviewError)
  }
  expect(creditedProjectRetention({ quantityCreditVersion: 2, refunds: [{ retentionMinor: 30 }, { retentionMinor: 20 }] })).toBe(50)
 })
})
