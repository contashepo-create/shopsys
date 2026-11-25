import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const snapshot = () => {
 const s = S()
 return structuredClone({ projects: s.projects, projectExtracts: s.projectExtracts, journal: s.journal, clientAdvances: s.clientAdvances, retentionReleases: s.retentionReleases })
}
const wrap = (s: unknown) => JSON.stringify({ state: s })
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], customers: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], approvalRequests: [], paymentTerminalTransactions: [], paymentTerminals: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })

it('لا يقبل تغيير مرجع الختامي وحده ويقبل سلسلة تعديلين حقيقيين ويرفض فساد كل حلقة', () => {
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const extract = S().addProjectExtract({ projectId: p.id, grossMinor: 10000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
 const before = snapshot()
 const fake = structuredClone(before)
 fake.projectExtracts[0].journalEntryId = 999
 fake.projectExtracts[0].totals = { ...fake.projectExtracts[0].totals, grossMinor: 9000, dueMinor: 9000 }
 expect(() => assertProjectFinancialHistoryPreserved(before, fake)).toThrow(/ختامي/)
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(fake), wrap({ ...before, preferences: { theme: 'dark' } }))).toThrow(/ختامي/)
 S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'أول', vatPercent: 14, reason: 'تصحيح' })
 const first = snapshot()
 const stranded = structuredClone(first)
 stranded.projectExtracts[0] = structuredClone(before.projectExtracts[0])
 expect(() => assertProjectFinancialHistoryPreserved(before, stranded)).toThrow(/ختامي/)
 S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'ثان', vatPercent: 15, reason: 'تصحيح' })
 const second = snapshot()
 expect(() => assertProjectFinancialHistoryPreserved(before, first)).not.toThrow()
 expect(() => assertProjectFinancialHistoryPreserved(first, second)).not.toThrow()
 expect(() => assertProjectFinancialHistoryPreserved(before, second)).not.toThrow()
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(second), wrap({ ...before, preferences: { theme: 'dark' } }))).not.toThrow()
 const cases = [
  (s: typeof second) => { s.journal[1].sourceId = 999 },
  (s: typeof second) => { s.journal[3].sourceId = 999 },
  (s: typeof second) => { s.journal[2].sourceId = 999 },
  (s: typeof second) => { s.journal[3].lines[0].debit += 1 },
  (s: typeof second) => { s.journal[2].branchId = 999 },
  (s: typeof second) => { s.journal[4].branchId = 999 },
  (s: typeof second) => { s.projectExtracts[0].editReversalEntryId = s.journal[1].id },
  (s: typeof second) => { s.journal.push({ ...s.journal[4] }) },
  (s: typeof second) => { s.journal[4].sourceId = 999 },
  (s: typeof second) => { s.projectExtracts[0].totals = { ...s.projectExtracts[0].totals, grossMinor: 9000, dueMinor: s.projectExtracts[0].totals.dueMinor - 1000 } },
  (s: typeof second) => { s.projectExtracts[0].date = '2025-01-01' },
  (s: typeof second) => { s.journal.splice(3, 1) },
 ]
 for (const mutate of cases) {
  const broken = structuredClone(second); mutate(broken)
  expect(() => assertProjectFinancialHistoryPreserved(before, broken)).toThrow(/ختامي/)
 }
})

it('لا يغير عكساً تاريخياً محفوظاً مختلف المصدر عند فحص تعديل لاحق سليم', () => {
 const p = S().addProject({ nameAr: 'قديم', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const extract = S().addProjectExtract({ projectId: p.id, grossMinor: 10000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
 S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'أول', vatPercent: 0, reason: 'قديم' })
 const oldReversalId = S().projectExtracts[0].editReversalEntryId
 useRawDataStore.setState({ journal: S().journal.map(row => row.id === oldReversalId ? { ...row, sourceId: 999 } : row) })
 const before = snapshot()
 S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'ثان', vatPercent: 14, reason: 'تصحيح' })
 const after = snapshot()
 expect(() => assertProjectFinancialHistoryPreserved(before, after)).not.toThrow()
 expect(after.journal.find(row => row.id === oldReversalId)?.sourceId).toBe(999)
})
