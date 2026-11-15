import { describe, expect, it } from 'vitest'
import type { BoqItem } from '../src/core/contracting.ts'
import { assertSurveyFinalBilled, reviseProjectSurvey } from '../src/core/projectSurvey.ts'
const item: BoqItem = { id: 1, projectId: 1, code: '1', descriptionAr: 'دهانات', unit: 'م2', qty: 1000, unitPriceMinor: 100, estCostMinor: 0, progressPercent: 0 }
const ctx = { projectId: 1, items: [item], history: [], reason: '', at: '2026-11-07', by: 'مهندس', isFinal: false } as const
const line = (n: number) => [{ boqItemId: 1, cumulativeQty: n }]
const history = (q: number) => [{ id: 1, lines: [{ boqItemId: 1, prevProgressPercent: 0, newProgressPercent: q / 10, lineValueMinor: q * 100, prevExecutedQty: 0, newExecutedQty: q }] }]

describe('حصر وحيد للمشروع وحساب الكميات بلا تكرار', () => {
 it('حصر قبل المستخلص يحافظ على هويته ولا يضيف الكميات المكررة', () => {
  const survey = reviseProjectSurvey({ ...ctx, lines: line(500), source: 'manual' })
  const linked = reviseProjectSurvey({ ...ctx, survey, lines: line(300), source: 'extract', extractId: 1 })
  expect(linked.id).toBe(survey.id)
  expect(linked.lines).toMatchObject(line(500))
  expect(linked.revisions).toHaveLength(2)
  expect(() => reviseProjectSurvey({ ...ctx, survey: linked, lines: line(300), source: 'extract', extractId: 1 })).toThrow(/بالفعل/)
 })
 it('حصر أول من مستخلص 200 ثم كمية 856 لا يسمح بالزيادة دون تأكيد', () => {
  const survey = reviseProjectSurvey({ ...ctx, lines: line(200), source: 'extract', extractId: 1 })
  expect(() => reviseProjectSurvey({ ...ctx, survey, history: history(200), lines: line(856), source: 'extract', extractId: 2 })).toThrow(/أكد/)
  const next = reviseProjectSurvey({ ...ctx, survey, history: history(200), lines: line(856), source: 'extract', extractId: 2, acceptIncrease: true })
  expect(next.lines).toMatchObject(line(856))
 })
 it('الحصر مستقل عن المفوتر ويمنع تخفيض القياس بلا سبب', () => {
  const survey = reviseProjectSurvey({ ...ctx, history: history(200), lines: line(500), source: 'manual' })
  expect(reviseProjectSurvey({ ...ctx, survey, history: history(200), lines: line(100), source: 'manual', reason: 'تصحيح' }).lines).toMatchObject(line(100))
  expect(() => reviseProjectSurvey({ ...ctx, survey, history: history(200), lines: line(300), source: 'manual' })).toThrow(/سبب/)
  expect(reviseProjectSurvey({ ...ctx, survey, history: history(200), lines: line(300), source: 'manual', reason: 'تصحيح قياس' }).lines).toMatchObject(line(300))
 })
 it('يمنع إقفال مستخلص عندما توجد أعمال محصورة لم تُفوتر', () => {
  const survey = reviseProjectSurvey({ ...ctx, lines: line(856), source: 'manual', isFinal: true })
  expect(() => assertSurveyFinalBilled(survey, [item], history(200))).toThrow(/غير المستخلصة/)
  expect(() => assertSurveyFinalBilled(survey, [item], history(856))).not.toThrow()
 })
 it('يسجل الحصر اليدوي مستقلاً عن تاريخ النسب أو المبلغ الإجمالي', () => {
  const old = [{ id: 1, lines: [{ boqItemId: 1, prevProgressPercent: 0, newProgressPercent: 20, lineValueMinor: 20000 }] }]
  expect(reviseProjectSurvey({ ...ctx, history: old, lines: line(856), source: 'manual' }).lines).toMatchObject(line(856))
  expect(reviseProjectSurvey({ ...ctx, history: [{ id: 1 }], lines: line(856), source: 'manual' }).lines).toMatchObject(line(856))
 })
 it('يرفض نسخة قديمة وتكرار البند والكمية غير الصحيحة', () => {
  const survey = reviseProjectSurvey({ ...ctx, lines: line(200), source: 'manual' })
  expect(() => reviseProjectSurvey({ ...ctx, survey, expectedRevision: 0, lines: line(250), source: 'manual' })).toThrow(/تغير الحصر/)
  expect(() => reviseProjectSurvey({ ...ctx, survey, lines: [...line(250), ...line(300)], source: 'manual' })).toThrow(/مكرر/)
  expect(reviseProjectSurvey({ ...ctx, survey, lines: line(1001), source: 'manual' }).lines).toMatchObject(line(1001))
  expect(() => reviseProjectSurvey({ ...ctx, survey, lines: line(-1), source: 'manual' })).toThrow()
 })
})
it('لا يعيد المستخلص فتح حصر ختامي تلقائياً', () => {
 const survey = reviseProjectSurvey({ ...ctx, lines: line(856), source: 'manual', isFinal: true })
 const linked = reviseProjectSurvey({ ...ctx, survey, lines: line(200), source: 'extract', extractId: 1 })
 expect(linked.id).toBe(survey.id)
 expect(linked.isFinal).toBe(true)
 expect(() => reviseProjectSurvey({ ...ctx, survey: linked, lines: line(856), source: 'manual' })).toThrow(/سبب إعادة فتح/)
})
