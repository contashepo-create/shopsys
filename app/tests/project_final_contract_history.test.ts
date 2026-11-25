import { describe, expect, it } from 'vitest'
import { assertProjectFinancialHistoryPreserved, assertProjectFinalHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots, newJournalEntries } from '../src/data/persistentStorage.ts'
const snapshot = () => ({
 projectExtracts: [{ id: 1, projectId: 1, isFinal: true, journalEntryId: 1 }],
 projects: [{ id: 1, contractValueMinor: 1000, retentionPercent: 10, branchId: 1, nameAr: 'أ' }, { id: 2, contractValueMinor: 500, retentionPercent: 5, branchId: 1, nameAr: 'ب' }],
 changeOrders: [{ id: 1, projectId: 1, status: 'approved', amountMinor: 200, approvedAt: '2026-01-01', date: '2026-01-01' }, { id: 2, projectId: 2, status: 'approved', amountMinor: 100, approvedAt: '2026-01-01', date: '2026-01-01' }],
 journal: [],
})
const wrap = (state: object) => JSON.stringify({ state })
describe('حفظ أساس العقد المعتمد بعد الختامي', () => {
 for (const [name, mutate] of [
  ['تغيير أصل العقد', (s: ReturnType<typeof snapshot>) => { s.projects[0].contractValueMinor++ }],
  ['تغيير نسبة المحتجز', (s: ReturnType<typeof snapshot>) => { s.projects[0].retentionPercent++ }],
  ['نقل فرع المشروع', (s: ReturnType<typeof snapshot>) => { s.projects[0].branchId++ }],
  ['حذف المشروع', (s: ReturnType<typeof snapshot>) => { s.projects.shift() }],
  ['تغيير قيمة أمر معتمد', (s: ReturnType<typeof snapshot>) => { s.changeOrders[0].amountMinor++ }],
  ['سحب اعتماد أمر', (s: ReturnType<typeof snapshot>) => { s.changeOrders[0].status = 'draft' }],
  ['حذف أمر معتمد', (s: ReturnType<typeof snapshot>) => { s.changeOrders.shift() }],
  ['إضافة أمر معتمد', (s: ReturnType<typeof snapshot>) => { s.changeOrders.push({ ...s.changeOrders[0], id: 3 }) }],
  ['نقل أمر معتمد إلى المشروع', (s: ReturnType<typeof snapshot>) => { s.changeOrders[1].projectId = 1 }],
 ] as const) it(`يرفض ${name} في الحفظ والدمج`, () => {
  const before = snapshot(), after = structuredClone(before); mutate(after)
  expect(() => assertProjectFinancialHistoryPreserved(before, after)).toThrow(/ختامي/)
  expect(() => assertProjectFinalHistoryPreserved(before, after)).toThrow(/ختامي/)
  expect(() => newJournalEntries(wrap(after), wrap(before))).toThrow(/ختامي/)
  expect(() => mergeConcurrentSnapshots(wrap(before), wrap(after), wrap({ ...before, preferences: { theme: 'dark' } }))).toThrow(/ختامي|تعارض/)
 })
 it('يقبل الوصف والمشروع الآخر ووضع مُستخلَص لأمر معتمد دون تغيير قيمته', () => {
  const before = snapshot(), after = structuredClone(before)
  after.projects[0].nameAr = 'تصحيح'; after.projects[1].contractValueMinor++; after.changeOrders[0].status = 'invoiced'
  expect(() => assertProjectFinancialHistoryPreserved(before, after)).not.toThrow()
  expect(() => newJournalEntries(wrap(after), wrap(before))).not.toThrow()
 })
})
