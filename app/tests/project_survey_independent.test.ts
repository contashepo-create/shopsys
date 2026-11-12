import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', activityId: 'contracting', modules: ['contracting'] } as never })
 useRawDataStore.setState({ ...original, currentUserId: null, branches: [], activeBranchId: null, customers: [], projects: [], boqItems: [], projectSurveys: [], projectExtracts: [], projectExtractDrafts: [], changeOrders: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [] } as never)
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
const project = () => S().projects[0]
const item = () => S().boqItems[0]
const extract = (qty: number, isFinal = false) => S().addProjectExtract({ projectId: project().id, vatPercent: 0, payment: 'credit', description: 'أعمال', isFinal, extractQtyLines: [{ boqItemId: item().id, cumulativeQty: qty }] })
const survey = (qty: number, rev = 0, reason = '') => S().saveProjectSurvey({ projectId: project().id, lines: [{ boqItemId: item().id, cumulativeQty: qty }], expectedRevision: rev, reason, isFinal: false })
it('لا ينشئ المستخلص حصرًا، ولا يعدل الحصر المستقل عند الإصدار أو تعديل المستخلص', () => {
 const first = extract(20)
 expect(S().projectSurveys).toEqual([])
 survey(15)
 const saved = S().projectSurveys
 S().editProjectExtract({ extractId: first.id, description: 'تصحيح', payment: 'credit', vatPercent: 0, reason: 'تصحيح', extractQtyLines: [{ boqItemId: item().id, cumulativeQty: 25 }] })
 expect(S().projectSurveys).toBe(saved)
 extract(50)
 expect(S().projectSurveys).toBe(saved)
 expect(S().projectSurveys[0].lines[0].cumulativeQty).toBe(15)
})
it('يسجل القياس المستقل فوق كمية العقد دون أن يسمح بمستخلص يتجاوز كمية العقد', () => {
 survey(110)
 const before = S()
 expect(() => extract(110)).toThrow(/تتجاوز كمية العقد/)
 expect(S().journal).toBe(before.journal)
 expect(S().projectSurveys[0].lines[0].cumulativeQty).toBe(110)
})
it('الختامي يرفض فرق القيمة قبل القيد، ويقبل مطابقة العقد', () => {
 extract(20)
 const before = S()
 expect(() => extract(90, true)).toThrow(/مساواة/)
 expect(S().journal).toBe(before.journal)
 const final = extract(100, true)
 expect(final.totals.grossMinor).toBe(8000)
 expect(S().projectExtracts.reduce((n, ex) => n + ex.totals.grossMinor, 0)).toBe(project().contractValueMinor)
 expect(S().projectSurveys).toEqual([])
})
it('المستخلص لا يتجاوز سقف العقد عند وجود فاتورة إضافية للمشروع ولا يحتسب التوثيق مرتين', () => {
 const p = project()
 useRawDataStore.setState({ sales: [{ id: 1, projectId: p.id, projectBilling: 'extra', totals: { totalMinor: 2000, taxMinor: 0 } }] as never, saleReturns: [] })
 const before = S()
 expect(() => extract(100, true)).toThrow(/فواتير المشروع الإضافية/)
 expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ sales: [{ id: 1, projectId: p.id, projectBilling: 'documentation', totals: { totalMinor: 2000, taxMinor: 0 } }] as never })
 expect(extract(100, true).totals.grossMinor).toBe(10000)
})
