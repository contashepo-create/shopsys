import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { renderSurveyHtml } from '../src/ui/print/printSurvey.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], employees: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], changeOrders: [] })
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100, estCostMinor: 0 })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
const save = (date?: string, expectedRevision = 0, qty = 10) => S().saveProjectSurvey({ projectId: S().projects[0].id, lines: [{ boqItemId: S().boqItems[0].id, cumulativeQty: qty }], expectedRevision, reason: '', isFinal: false, ...(date === undefined ? {} : { measurementDate: date }) })
const print = () => renderSurveyHtml({ shopName: 'المقاول', project: S().projects[0], survey: S().projectSurveys[0], items: S().boqItems, history: S().projectExtracts, fmt: String, currency: 'جنيه' })
it('يحفظ يوم القياس السابق منفصلاً عن وقت التسجيل ويعرضه في كشف المراجعة بلا قيد', () => {
 const survey = save('2026-11-03')
 expect(survey.revisions[0]).toMatchObject({ measurementDate: '2026-11-03', source: 'manual' })
 expect(survey.revisions[0].at.slice(0, 10)).toBe('2026-11-05')
 expect(print()).toContain('تاريخ قياس المراجعة الأخيرة:</b> 2026-11-03')
 expect(print()).toContain('لا يثبت تاريخ جميع الكميات السابقة')
 expect(S().journal).toHaveLength(0)
})
it.each(['', '2026-11-06', '2026-02-30', '2026-11-04T12:00:00Z'])('يرفض يوم قياس غير صحيح أو مستقبلي %s بلا أثر', date => {
 expect(() => save(date)).toThrow(/تاريخ/); expect(S().projectSurveys).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('لا يخمن تاريخ قياس لمراجعة قديمة أو ربط مستخلص', () => {
 const legacy = save()
 expect(legacy.revisions[0].measurementDate).toBeUndefined()
 expect(print()).toContain('تاريخ قياس المراجعة الأخيرة:</b> غير مسجل')
 S().addProjectExtract({ projectId: S().projects[0].id, description: 'مستخلص', payment: 'cash', vatPercent: 0, extractQtyLines: [{ boqItemId: S().boqItems[0].id, cumulativeQty: 10 }] })
 expect(S().projectSurveys[0].revisions[1].source).toBe('extract')
 expect(S().projectSurveys[0].revisions[1].measurementDate).toBeUndefined()
 expect(print()).toContain('تاريخ قياس المراجعة الأخيرة:</b> غير مسجل')
})
it('يحافظ على تواريخ المراجعات ويرفض التأريخ الأسبق من قياس معروف أو مستخلص', () => {
 save('2026-11-04')
 const before = S().projectSurveys
 expect(() => save('2026-11-03', 1, 20)).toThrow(/التسلسل/)
 expect(S().projectSurveys).toBe(before)
 save('2026-11-04', 1, 20)
 expect(S().projectSurveys[0].revisions.map(row => row.measurementDate)).toEqual(['2026-11-04', '2026-11-04'])
 S().addProjectExtract({ projectId: S().projects[0].id, description: 'مستخلص', payment: 'cash', vatPercent: 0, extractQtyLines: [{ boqItemId: S().boqItems[0].id, cumulativeQty: 10 }] })
 const after = S().projectSurveys
 expect(() => save('2026-11-04', 3, 20)).toThrow(/التسلسل/)
 expect(S().projectSurveys).toBe(after)
})
it('يرفض طباعة سجل يتضمن تاريخ قياس تالفاً دون تصحيحه', () => {
 save('2026-11-04')
 const survey = S().projectSurveys[0]
 useRawDataStore.setState({ projectSurveys: [{ ...survey, revisions: [{ ...survey.revisions[0], measurementDate: '2026-02-30' }] }] })
 expect(() => print()).toThrow(/تاريخ قياس/)
})
