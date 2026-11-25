import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const raw = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const wrap = (state: unknown) => JSON.stringify({ state })
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...raw, currentUserId: null, activeBranchId: null, branches: [], projects: [], projectExtracts: [], projectCosts: [], retentionReleases: [], projectSurveys: [], projectCloseouts: [], projectExtractDrafts: [], boqItems: [], clientAdvances: [], journal: [], customers: [], suppliers: [], employees: [], changeOrders: [], subContracts: [], subCertificates: [], subPayments: [], subAdvances: [], dailyWorkers: [], dailyWorkRecords: [], paymentTerminals: [], paymentTerminalTransactions: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], treasuries: [{ code: '1101', nameAr: 'خزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(raw); useAppStore.setState(app) })
function create() {
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
 const boq = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'تغيير', amountMinor: 100 })
 const sub = S().addSubContract({ projectId: p.id, contractorName: 'مقاول', scopeAr: 'بند', contractValueMinor: 1000, retentionPercent: 0, startDate: '2025-01-01' })
 return { p, boq, order, sub }
}

describe('حماية الحالة بعد تحصيل المحتجز', () => {
 it('يحمي إقفال المشروع وتوقيته من الاستعادة أو دمج متزامن، دون منع تعديل مستقل', () => {
  const { p } = create()
  S().addProjectExtract({ projectId: p.id, grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
  const beforeRelease = { projects: S().projects, projectExtracts: S().projectExtracts, retentionReleases: S().retentionReleases, clientAdvances: S().clientAdvances }
  S().releaseRetention(p.id)
  const state = { projects: S().projects, projectExtracts: S().projectExtracts, retentionReleases: S().retentionReleases, clientAdvances: S().clientAdvances }
  expect(() => assertProjectFinancialHistoryPreserved(beforeRelease, state)).not.toThrow()
  const closed = state.projects[0]
  for (const projects of [[], [{ ...closed, status: 'active' }], [{ ...closed, completedAt: '2020-01-01' }], [{ ...closed, branchId: 999 }], [closed, closed]]) {
   expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projects })).toThrow(/إقفال المشروع/)
  }
  const allowed = { ...state, projects: [{ ...closed, notes: 'ملاحظة' }] }
  expect(() => assertProjectFinancialHistoryPreserved(state, allowed)).not.toThrow()
  const bad = { ...state, projects: [{ ...closed, status: 'active' }] }
  expect(() => mergeConcurrentSnapshots(wrap(state), wrap(bad), wrap({ ...state, preferences: { theme: 'dark' } }))).toThrow(/إقفال المشروع/)
 })
 it('لا يختلق حالة إقفال لمشروع قديم مرتبط بتحصيل وحالته غير مكتملة', () => {
  const state = { projects: [{ id: 1, status: 'active' }], projectExtracts: [], retentionReleases: [{ id: 1, projectId: 1 }] }
  expect(() => assertProjectFinancialHistoryPreserved(state, structuredClone(state))).not.toThrow()
 })
})

describe('تعديل بيانات المشروع', () => {
 it('يرفض حقول تعديل المشروع غير المسموحة زمن التنفيذ ولا يغير الهوية أو الفرع أو حالة الإقفال', () => {
  const { p } = create()
  for (const changes of [{ id: 99 }, { branchId: 2 }, { status: 'active' }, { completedAt: '2020-01-01' }, { code: 'fake' }]) {
   const before = S(); expect(() => S().updateProject(p.id, changes as never)).toThrow(/حقل/); expect(S()).toBe(before)
  }
  expect(S().updateProject(p.id, { notes: 'تعديل مشروع' }).notes).toBe('تعديل مشروع')
 })
})
