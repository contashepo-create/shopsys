import { describe, expect, it } from 'vitest'
import { allocateProjectAdvance, undoProjectAdvanceRecovery, type ProjectAdvanceRecord } from '../src/core/projectAdvanceRecovery.ts'

const a: ProjectAdvanceRecord = { id: 1, projectId: 1, date: '2024-01-01', amountMinor: 1000, recoveredMinor: 600, journalEntryId: 1 }
const b: ProjectAdvanceRecord = { id: 2, projectId: 1, date: '2024-01-02', amountMinor: 1000, recoveredMinor: 300, journalEntryId: 2 }
const other: ProjectAdvanceRecord = { id: 3, projectId: 2, date: '2024-01-03', amountMinor: 1000, recoveredMinor: 900, journalEntryId: 3 }
const target = { id: 1, projectId: 1, journalEntryId: 4, date: '2024-02-01T10:00:00', advanceRecoveryMinor: 900, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 600 }, { advanceId: 2, journalEntryId: 2, amountMinor: 300 }] }

describe('دفاع مستقل في مساعدَي تخصيص المقدمات', () => {
 it('يرفض التكرار والمراجع المفقودة ومشروعاً آخر والمبلغ غير الصحيح عند عكس التوزيع', () => {
  const cases = [
   [{ advanceId: 1, journalEntryId: 1, amountMinor: 450 }, { advanceId: 1, journalEntryId: 1, amountMinor: 450 }],
   [{ advanceId: 99, journalEntryId: 99, amountMinor: 900 }],
   [{ advanceId: 3, journalEntryId: 3, amountMinor: 900 }],
   [{ advanceId: 1, journalEntryId: 2, amountMinor: 900 }],
   [{ advanceId: 1, journalEntryId: 1, amountMinor: -1 }, { advanceId: 2, journalEntryId: 2, amountMinor: 901 }],
   [{ advanceId: 1, journalEntryId: 1, amountMinor: 0 }, { advanceId: 2, journalEntryId: 2, amountMinor: 900 }],
   [{ advanceId: 1, journalEntryId: 1, amountMinor: 1.5 }],
   [{ advanceId: 1, journalEntryId: 1, amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
  ]
  for (const allocations of cases) {
   const bad = { ...target, advanceAllocations: allocations }
   const advances = [a, b, other], before = structuredClone(advances)
   expect(() => undoProjectAdvanceRecovery(1, advances, [bad], bad)).toThrow(/راجع/)
   expect(advances).toEqual(before)
  }
 })
 it('يرفض معرّفات أو تواريخ دفعات تالفة وترتيبها، حتى لو لم يصل التوزيع إلى الدفعة الأخيرة', () => {
  for (const invalid of [{ ...b, id: 1 }, { ...b, journalEntryId: 1 }, { ...b, date: '2023-12-31' }, { ...b, date: '2024-02-30' }, { ...b, recoveredMinor: 1001 }, { ...b, amountMinor: 1.5 }]) {
   expect(() => allocateProjectAdvance(1, [a, invalid], 1)).toThrow(/راجع/)
   expect(() => undoProjectAdvanceRecovery(1, [a, invalid], [target], target)).toThrow(/راجع/)
  }
 })
 it('يرفض تخصيص دفعة بعد المستخلص أو أكثر من المسترد المسجل دون كتابة', () => {
  for (const bad of [
   { ...target, journalEntryId: 2 },
   { ...target, date: '2024-01-01' },
   { ...target, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 700 }, { advanceId: 2, journalEntryId: 2, amountMinor: 200 }] },
   { ...target, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 599 }, { advanceId: 2, journalEntryId: 2, amountMinor: 300 }] },
   { ...target, advanceRecoveryMinor: -1 },
  ]) expect(() => undoProjectAdvanceRecovery(1, [a, b], [bad], bad)).toThrow(/راجع/)
 })
 it('يعيد التوزيع الصحيح فقط ويحافظ على مشروع آخر، ويدعم التاريخ القديم ذي الدفعة الوحيدة', () => {
  const result = undoProjectAdvanceRecovery(1, [a, b, other], [target], target)
  expect(result.map(x => x.recoveredMinor)).toEqual([0, 0, 900]); expect(result[2]).toBe(other)
  const legacy = { ...target, advanceRecoveryMinor: 600, advanceAllocations: undefined }
  expect(undoProjectAdvanceRecovery(1, [a, other], [legacy], legacy).map(x => x.recoveredMinor)).toEqual([0, 900])
  expect(() => undoProjectAdvanceRecovery(1, [a, b], [legacy], legacy)).toThrow(/التاريخي غير مثبت/)
 })
 it('لا يعكس مستخلصاً غائباً أو مكرراً أو مختلفاً عن دليله المحفوظ', () => {
  const advances = [a, b], snapshot = structuredClone(advances)
  const changedAllocation = { ...target, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 500 }, { advanceId: 2, journalEntryId: 2, amountMinor: 400 }] }
  const cases = [
   { records: [], candidate: target },
   { records: [target, { ...target }], candidate: target },
   { records: [target, { ...target, id: 2 }], candidate: target },
   { records: [target, { ...target, id: 2, journalEntryId: 1, advanceRecoveryMinor: 0, advanceAllocations: [] }], candidate: target },
   { records: [target], candidate: { ...target, date: '2024-02-02T10:00:00' } },
   { records: [target], candidate: { ...target, journalEntryId: 5 } },
   { records: [target], candidate: changedAllocation },
  ]
  for (const { records, candidate } of cases) {
   const original = structuredClone(records)
   expect(() => undoProjectAdvanceRecovery(1, advances, records, candidate)).toThrow(/راجع/)
   expect(advances).toEqual(snapshot)
   expect(records).toEqual(original)
  }
  expect(undoProjectAdvanceRecovery(1, advances, [structuredClone(target)], structuredClone(target)).map(row => row.recoveredMinor)).toEqual([0, 0])
 })
 it('يرفض مجموع تخصيصات يتجاوز الحد الآمن حتى إن كان كل مبلغ آمناً', () => {
  const max = Number.MAX_SAFE_INTEGER
  const advances = [{ ...a, amountMinor: max, recoveredMinor: max }, { ...b, amountMinor: max, recoveredMinor: max }]
  const bad = { ...target, advanceRecoveryMinor: max, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: max }, { advanceId: 2, journalEntryId: 2, amountMinor: 1 }] }
  expect(() => undoProjectAdvanceRecovery(1, advances, [bad], bad)).toThrow(/غير آمن/)
 })
 it('يبقي الصفر بلا توزيع ولا يختلق تغييراً أو يتحقق من دفعات لم تُستخدم', () => {
  expect(allocateProjectAdvance(1, [{ ...a, amountMinor: -1 }], 0).allocations).toEqual([])
  const zero = { ...target, advanceRecoveryMinor: 0, advanceAllocations: [] }
  expect(undoProjectAdvanceRecovery(1, [a], [zero], zero)).toEqual([a])
  expect(() => undoProjectAdvanceRecovery(1, [a], [target], { ...target, advanceRecoveryMinor: 0 })).toThrow(/راجع/)
 })
 it('يخصص الأقدم دون تغيير البيانات ويرفض تجاوز الرصيد', () => {
  const advances = [a, b, other], before = structuredClone(advances)
  const result = allocateProjectAdvance(1, advances, 500)
  expect(result.allocations).toEqual([{ advanceId: 1, journalEntryId: 1, amountMinor: 400 }, { advanceId: 2, journalEntryId: 2, amountMinor: 100 }])
  expect(result.advances.map(row => row.recoveredMinor)).toEqual([1000, 400, 900]); expect(advances).toEqual(before)
  expect(() => allocateProjectAdvance(1, advances, 1101)).toThrow(/أكبر من رصيد/)
  expect(advances).toEqual(before)
 })
})
