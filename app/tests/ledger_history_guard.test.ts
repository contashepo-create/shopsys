import { describe, expect, it } from 'vitest'
import { assertJournalHistoryPreserved } from '../src/core/ledgerHistoryGuard.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const original: JournalEntry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'حركة', sourceType: 'manual', sourceId: null, branchId: 1, lines: [{ accountCode: '1101', debit: 100, credit: 0, costCenterId: 2, partyKind: 'customer', partyId: 3, relatedBranchId: 4 }, { accountCode: '4101', debit: 0, credit: 100 }], createdBy: 'م', createdAt: '2026-01-01', reversedByEntryId: null, reversesEntryId: null }
const reverse: JournalEntry = { ...original, id: 2, entryNumber: 2, date: '2026-01-02', sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, reversedByEntryId: null, lines: original.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
const marked = { ...original, reversedByEntryId: 2 }
describe('حراسة اليومية المحلية قبل الاستبدال', () => {
 it('يسمح ببيانات قديمة عند عدم وجود دفتر محلي وبإلحاق قيود وعكس سليم ويحافظ على تطبيع التاريخ', () => {
  expect(() => assertJournalHistoryPreserved([], undefined)).not.toThrow()
  expect(() => assertJournalHistoryPreserved([original], [marked, reverse])).not.toThrow()
  expect(() => assertJournalHistoryPreserved([{ ...original, date: '2026-01-01T10:00:00Z' }], [original])).not.toThrow()
 })
 it('يرفض إسقاط القيود وإعادة ترتيبها وتغيير أي دليل قديم كفرع أو منشئ أو سطور', () => {
  for (const candidate of [undefined, [], [reverse, original], [{ ...original, branchId: 9 }], [{ ...original, createdBy: 'آخر' }], [{ ...original, lines: reverse.lines }], [{ ...original, entryNumber: 8 }]]) {
   expect(() => assertJournalHistoryPreserved([original], candidate)).toThrow()
  }
 })
 it('يرفض حذف أو استبدال علامة عكس مثبتة أو عكساً مكرراً أو ناقص الأبعاد', () => {
  expect(() => assertJournalHistoryPreserved([marked, reverse], [original, reverse])).toThrow()
  expect(() => assertJournalHistoryPreserved([marked, reverse], [{ ...marked, reversedByEntryId: 5 }, reverse])).toThrow()
  expect(() => assertJournalHistoryPreserved([original], [marked, { ...reverse, lines: [{ ...reverse.lines[0], partyId: 8 }, reverse.lines[1]] }])).toThrow()
  expect(() => assertJournalHistoryPreserved([original], [marked, reverse, { ...reverse, id: 3, entryNumber: 3 }])).toThrow()
  expect(() => assertJournalHistoryPreserved([original], [original, reverse])).toThrow()
  expect(() => assertJournalHistoryPreserved([original], [marked, { ...reverse, branchId: undefined }])).toThrow()
 })
})

it('لا يسمح لنسخة الإعدادات بإسقاط أو فتح فترة محلية مقفلة، ويرفض التقويم التالف أو المتداخل', async () => {
 const { assertFiscalYearsPreserved } = await import('../src/core/ledgerHistoryGuard.ts')
 const closed = { id: 4, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' as const }
 expect(() => assertFiscalYearsPreserved([closed], [closed])).not.toThrow()
 expect(() => assertFiscalYearsPreserved([closed], [])).toThrow(/تسقط/)
 expect(() => assertFiscalYearsPreserved([closed], [{ ...closed, status: 'open' }])).toThrow(/تغيّر/)
 expect(() => assertFiscalYearsPreserved([closed], undefined)).toThrow(/تسقط/)
 expect(() => assertFiscalYearsPreserved([], [closed, closed])).toThrow(/مكررة/)
 expect(() => assertFiscalYearsPreserved([], [closed, { ...closed, id: 5, startDate: '2025-06-01', endDate: '2026-05-31' }])).toThrow(/متداخلة/)
})

it('يرفض معرفات القيود المكررة أو غير الصالحة في الإضافات حتى إن كان الدفتر المحلي فارغاً', () => {
 for (const rows of [[original, original], [original, { ...reverse, id: 1 }], [original, { ...reverse, id: 0 }], [original, null], [original, { ...reverse, id: 1.5 }]]) {
  expect(() => assertJournalHistoryPreserved([], rows)).toThrow(/معرف قيد غير صالح أو مكرراً/)
  expect(() => assertJournalHistoryPreserved([original], rows)).toThrow(/معرف قيد غير صالح أو مكرراً/)
 }
 expect(() => assertJournalHistoryPreserved([], [original, reverse])).not.toThrow()
})
