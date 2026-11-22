import { describe, expect, it } from 'vitest'
import { assertProjectDocumentHistoryPreserved as guard } from '../src/core/projectDocumentHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
const closeout = { id: 4, projectId: 1, basis: 'v1', lines: [{ itemId: 7, qty: 1 }] }
const quoteDeletion = { id: 5, quoteNumber: 'QT-5', projectId: 1, at: '2026-01-01', reason: 'إلغاء' }
const surveyDeletion = { id: 6, projectId: 1, at: '2026-01-01', reason: 'إلغاء' }
const current = { projectCloseouts: [closeout], quotationDeletionRecords: [quoteDeletion], surveyDeletionRecords: [surveyDeletion] }
const wrap = (state: object) => JSON.stringify({ state })
describe('سجل محاضر المشروع وحذف العروض والحصر', () => {
 it.each(['projectCloseouts', 'quotationDeletionRecords', 'surveyDeletionRecords'] as const)('يرفض إسقاط أو تعديل أو تكرار %s', key => {
  const row = current[key][0]
  for (const rows of [[], [{ ...row, changed: true }], [row, row]]) expect(() => guard(current, { ...current, [key]: rows })).toThrow()
  const omitted = { ...current } as Record<string, unknown>; delete omitted[key]; expect(() => guard(current, omitted)).toThrow(/تسقط/)
 })
 it('يقبل إضافة دليل وإعادة ترتيب مفاتيح، ولا يختلق أدلة للقديم', () => {
  expect(() => guard({}, {})).not.toThrow()
  const reordered = { ...current, projectCloseouts: [{ basis: 'v1', lines: [{ qty: 1, itemId: 7 }], projectId: 1, id: 4 }, { id: 9 }] }
  expect(() => guard(current, reordered)).not.toThrow()
 })
 it('يرفض سجلاً تالفاً أو معرفاً غير موجب أو مكرراً في الوارد ولو لم يوجد محلياً', () => {
  for (const value of [null, {}, [null], [{ id: 0 }], [{ id: 1 }, { id: 1 }]]) expect(() => guard({}, { surveyDeletionRecords: value })).toThrow(/سجل حذف الحصر/)
 })
 it('يرفض إحياء عرض أو حصر محذوف حتى لو كان الحذف وارداً فقط', () => {
  expect(() => guard({}, { quotationDeletionRecords: [quoteDeletion], quotations: [{ id: 5 }] })).toThrow(/عرض سعر محذوف/)
  expect(() => guard({}, { surveyDeletionRecords: [surveyDeletion], projectSurveys: [{ id: 6 }] })).toThrow(/حصر محذوف/)
  expect(() => guard({}, { quotationDeletionRecords: [quoteDeletion], quotations: [{ id: 5, deletedAt: 'قديم' }] })).not.toThrow()
 })
 it('يرفض الدمج الذي يسقط دليلاً ويحفظ إضافة دليل وعمل مستقل', () => {
  const base = { ...current, quotations: [], projectSurveys: [] }
  const bad = { ...base, projectCloseouts: [] }
  expect(() => mergeConcurrentSnapshots(wrap(base), wrap(bad), wrap({ ...base, preferences: { theme: 'dark' } }))).toThrow()
  const added = { ...base, projectCloseouts: [...base.projectCloseouts, { ...closeout, id: 9, basis: 'v2' }] }
  const result = JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(added), wrap({ ...base, preferences: { theme: 'dark' } }))).state
  expect(result.projectCloseouts).toHaveLength(2); expect(result.preferences.theme).toBe('dark')
 })
})
