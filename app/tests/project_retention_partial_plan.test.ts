import { describe, expect, it } from 'vitest'
import { planRetentionAllocations } from '../src/core/projectRetentionAllocation.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'

const extracts = [{ id: 1, journalEntryId: 1, totals: { retentionMinor: 100 } }, { id: 2, journalEntryId: 2, totals: { retentionMinor: 200 } }]
const part = (journalEntryId: number, amountMinor: number, allocations: { extractId: number; journalEntryId: number; amountMinor: number }[]) => ({ journalEntryId, amountMinor, allocationEvidence: { version: 1, allocations } })

describe('تخطيط توزيع تحصيل المحتجز دون ترحيل جزئي', () => {
 it('يوزع FIFO ويعيد تشغيل تحصيلين مثبتين، مع حفظ المدخلات', () => {
  const first = planRetentionAllocations(extracts, [], 3, 120)
  expect(first).toEqual([{ extractId: 1, journalEntryId: 1, amountMinor: 100 }, { extractId: 2, journalEntryId: 2, amountMinor: 20 }])
  const releases = [part(3, 120, first)]
  const before = structuredClone({ extracts, releases })
  const second = planRetentionAllocations(extracts, releases, 4, 50)
  expect(second).toEqual([{ extractId: 2, journalEntryId: 2, amountMinor: 50 }])
  expect(planRetentionAllocations(extracts, [...releases, part(4, 50, second)], 5, 130)).toEqual([{ extractId: 2, journalEntryId: 2, amountMinor: 130 }])
  expect({ extracts, releases }).toEqual(before)
  expect(planRetentionAllocations(extracts, [], 3, 300)).toEqual([{ extractId: 1, journalEntryId: 1, amountMinor: 100 }, { extractId: 2, journalEntryId: 2, amountMinor: 200 }])
 })
 it('يرفض دليلاً تاريخياً مجهولاً أو مكرراً أو بترتيب أو توزيع خاطئ حتى لو تساوى الإجمالي', () => {
  const original = part(3, 120, [{ extractId: 1, journalEntryId: 1, amountMinor: 100 }, { extractId: 2, journalEntryId: 2, amountMinor: 20 }])
  const wrong = [
   [{ ...original, allocationEvidence: undefined }],
   [part(3, 120, [{ extractId: 1, journalEntryId: 1, amountMinor: 90 }, { extractId: 2, journalEntryId: 2, amountMinor: 30 }])],
   [part(3, 120, [...original.allocationEvidence.allocations].reverse())],
   [original, { ...original }],
   [part(4, 120, original.allocationEvidence.allocations), part(3, 1, [{ extractId: 2, journalEntryId: 2, amountMinor: 1 }])],
   [part(3, 120, [{ extractId: 1, journalEntryId: 1, amountMinor: 120 }])],
  ]
  for (const releases of wrong) expect(() => planRetentionAllocations(extracts, releases, 5, 1)).toThrow(FinancialDataReviewError)
  for (const amount of [0, -1, 0.5, 301, NaN]) expect(() => planRetentionAllocations(extracts, [], 3, amount)).toThrow(FinancialDataReviewError)
 })
 it('يتوقف عندما يؤدي إشعار لاحق إلى أن يتجاوز التحصيل السابق رصيد المستخلص المحصل', () => {
  const rows = [{ ...extracts[0], quantityCreditVersion: 2, refunds: [{ journalEntryId: 4, retentionMinor: 50 }] }, extracts[1]]
  const releases = [part(3, 90, [{ extractId: 1, journalEntryId: 1, amountMinor: 90 }])]
  expect(() => planRetentionAllocations(rows, releases, 5, 10)).toThrow(FinancialDataReviewError)
  expect(planRetentionAllocations(rows, [part(3, 30, [{ extractId: 1, journalEntryId: 1, amountMinor: 30 }])], 5, 30)).toEqual([{ extractId: 1, journalEntryId: 1, amountMinor: 20 }, { extractId: 2, journalEntryId: 2, amountMinor: 10 }])
 })
})
