import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], customers: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], approvalRequests: [], paymentTerminalTransactions: [], paymentTerminals: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
it('لا يغير أساس جدول الكميات مباشرة بعد الختامي ويبقي المشروع الآخر والتعديل الوصفي متاحين', () => {
 const project = S().addProject({ nameAr: 'الأول', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
 const other = S().addProject({ nameAr: 'آخر', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const otherItem = S().addBoqItem({ projectId: other.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
 S().addProjectExtract({ projectId: project.id, grossMinor: 10000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
 const before = S()
 for (const action of [
  () => S().addBoqItem({ projectId: project.id, code: '2', descriptionAr: 'بند', unit: 'م', qty: 1, unitPriceMinor: 1 }),
  () => S().updateBoqItem(item.id, { qty: 101 }),
  () => S().updateBoqItem(item.id, { unitPriceMinor: 101 }),
  () => S().updateBoqItem(item.id, { unit: 'كم' }),
  () => S().updateBoqProgress(item.id, 40),
  () => S().removeBoqItem(item.id),
 ]) { expect(action).toThrow(/ختامي/); expect(S()).toBe(before) }
 expect(S().updateBoqItem(item.id, { descriptionAr: 'وصف مصحح' }).descriptionAr).toBe('وصف مصحح')
 expect(S().updateBoqItem(otherItem.id, { qty: 101 }).qty).toBe(101)
 S().updateBoqProgress(otherItem.id, 40)
 expect(S().boqItems.find(row => row.id === otherItem.id)?.progressPercent).toBe(40)
})
it('يرفض حقول نقل البند أو تقدمه خارج قائمة التعديل حتى قبل الختامي', () => {
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const item = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
 for (const changes of [{ id: 99 }, { projectId: 99 }, { branchId: 99 }, { progressPercent: 100 }, { quantityChange: {} }]) {
  const before = S()
  expect(() => S().updateBoqItem(item.id, changes as never)).toThrow(/حقل/)
  expect(S()).toBe(before)
 }
 expect(() => S().updateBoqProgress(item.id, NaN)).toThrow(/نسبة/)
 expect(() => S().updateBoqProgress(999, 50)).toThrow(/غير موجود/)
})
