import { describe, expect, it } from 'vitest'
import { assertProjectFinancialHistoryPreserved, assertProjectFinalHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { newJournalEntries } from '../src/data/persistentStorage.ts'

const baseline = () => ({
 projectExtracts: [{ id: 5, projectId: 1, isFinal: true, journalEntryId: 9 }],
 boqItems: [{ id: 1, projectId: 1, qty: 10, unitPriceMinor: 100, unit: 'م', progressPercent: 50, descriptionAr: 'قديم' }, { id: 2, projectId: 2, qty: 3, unitPriceMinor: 50, unit: 'م', progressPercent: 0 }],
 journal: [],
})
const wrap = (state: object) => JSON.stringify({ state })
describe('حماية جدول الكميات المحلي بعد الختامي عند الحفظ والاستعادة', () => {
 for (const [name, change] of [
  ['حذف البند', (s: ReturnType<typeof baseline>) => { s.boqItems.shift() }],
  ['تغيير الكمية', (s: ReturnType<typeof baseline>) => { s.boqItems[0].qty++ }],
  ['تغيير السعر', (s: ReturnType<typeof baseline>) => { s.boqItems[0].unitPriceMinor++ }],
  ['تغيير الوحدة', (s: ReturnType<typeof baseline>) => { s.boqItems[0].unit = 'سم' }],
  ['تغيير التقدم', (s: ReturnType<typeof baseline>) => { s.boqItems[0].progressPercent++ }],
  ['نقل البند', (s: ReturnType<typeof baseline>) => { s.boqItems[0].projectId = 2 }],
  ['إضافة بند', (s: ReturnType<typeof baseline>) => { s.boqItems.push({ ...s.boqItems[0], id: 3 }) }],
 ] as const) it(`يرفض ${name} دون دليل إعادة فتح في كل حارس`, () => {
  const before = baseline(), after = structuredClone(before); change(after)
  expect(() => assertProjectFinancialHistoryPreserved(before, after)).toThrow(/ختامي/)
  expect(() => assertProjectFinalHistoryPreserved(before, after)).toThrow(/ختامي/)
  expect(() => newJournalEntries(wrap(after), wrap(before))).toThrow(/ختامي/)
 })
 it('يسمح بالوصف وتعديل مشروع آخر دون اختلاق تاريخ قديم', () => {
  const before = baseline(), after = structuredClone(before)
  after.boqItems[0].descriptionAr = 'تصحيح'; after.boqItems[1].qty++
  expect(() => assertProjectFinancialHistoryPreserved(before, after)).not.toThrow()
  expect(() => newJournalEntries(wrap(after), wrap(before))).not.toThrow()
 })
 it('يرفض إسقاط المجموعة أو تكرار معرفات البنود', () => {
  const before = baseline()
  expect(() => assertProjectFinancialHistoryPreserved(before, { ...before, boqItems: undefined })).toThrow(/ختامي/)
  expect(() => assertProjectFinancialHistoryPreserved(before, { ...before, boqItems: [before.boqItems[0], before.boqItems[0]] })).toThrow(/مكرر/)
 })
})
