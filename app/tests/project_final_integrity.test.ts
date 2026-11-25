import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], customers: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], approvalRequests: [], paymentTerminalTransactions: [], paymentTerminals: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function setup() {
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const extract = S().addProjectExtract({ projectId: p.id, grossMinor: 10000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
 return { p, extract }
}
const wrap = (state: object) => JSON.stringify({ state })

describe('حفظ طبيعة المستخلص الختامي', () => {
 it('لا يحول الختامي إلى جزئي بتعديل صريح، ولا يسمح بإصدار مستخلص تالٍ', () => {
  const { p, extract } = setup()
  const before = S()
  expect(() => S().editProjectExtract({ extractId: extract.id, grossMinor: 9000, payment: 'cash', description: 'تغيير', vatPercent: 0, isFinal: false, reason: 'تصحيح' })).toThrow(/ختامي/)
  expect(S()).toBe(before)
  expect(() => S().addProjectExtract({ projectId: p.id, grossMinor: 1, payment: 'cash', description: 'لاحق', vatPercent: 0 })).toThrow(/ختامي/)
 })
 it('يحفظ طبيعة الختامي عند إغفال الحقل في تعديل مشروع، ويواصل فرض مساواة العقد', () => {
  const { p, extract } = setup()
  const input = { extractId: extract.id, grossMinor: 9000, payment: 'cash' as const, description: 'تعديل', vatPercent: 0, reason: 'تصحيح' }
  const before = S()
  expect(() => S().editProjectExtract(input)).toThrow(/ختامي/)
  expect(S()).toBe(before)
  const edited = S().editProjectExtract({ ...input, grossMinor: 10000 })
  expect(edited.isFinal).toBe(true)
  expect(S().journal).toHaveLength(3)
  expect(() => assertProjectFinancialHistoryPreserved(before as never, S() as never)).not.toThrow()
  expect(() => S().addProjectExtract({ projectId: p.id, grossMinor: 1, payment: 'cash', description: 'لاحق', vatPercent: 0 })).toThrow(/ختامي/)
 })
 it('يرفض إخفاء هوية الختامي أو تغيير مشروعه أو فرعه في استعادة ودمج، ويسمح بتعديل آخر يحتفظ بالطبيعة', () => {
  const { extract } = setup()
  const snapshot = { projectExtracts: S().projectExtracts, clientAdvances: [], retentionReleases: [] }
  for (const rows of [[], [{ ...extract, isFinal: false }], [{ ...extract, isFinal: undefined }], [{ ...extract, projectId: 999 }], [{ ...extract, branchId: 999 }], [extract, extract]]) {
   expect(() => assertProjectFinancialHistoryPreserved(snapshot, { ...snapshot, projectExtracts: rows })).toThrow(/ختامي|مكرر/)
  }
  for (const rows of [[extract, { ...extract, id: extract.id + 1, isFinal: false }], [extract, { ...extract, id: extract.id + 1, isFinal: true }]]) {
   expect(() => assertProjectFinancialHistoryPreserved(snapshot, { ...snapshot, projectExtracts: rows })).toThrow(/ختامي/)
  }
  const candidate = { ...snapshot, projectExtracts: [{ ...extract, description: 'تعديل مستقل' }] }
  expect(() => assertProjectFinancialHistoryPreserved(snapshot, candidate)).not.toThrow()
  const bad = { ...snapshot, projectExtracts: [{ ...extract, isFinal: false }] }
  expect(() => mergeConcurrentSnapshots(wrap(snapshot), wrap(bad), wrap({ ...snapshot, preferences: { theme: 'dark' } }))).toThrow(/ختامي/)
 })
 it('يرفض تغيير هوية الختامي أو أساسه المالي مع الإبقاء على قيده في لقطة واردة', () => {
  const { extract } = setup()
  const state = { projectExtracts: [extract], journal: S().journal, clientAdvances: [], retentionReleases: [] }
  const patches = [
   { extractNumber: 'PRX-آخر' }, { createdAt: '2025-01-01T00:00:00' },
   { date: '2025-01-01' }, { payment: 'credit' },
   { totals: { ...extract.totals, grossMinor: 5000, dueMinor: 5000 } },
   { lines: [{ boqItemId: 123, newProgressPercent: 50 }] }, { advanceRecoveryMinor: 100 },
   { advanceAllocations: [{ advanceId: 1, journalEntryId: 2, amountMinor: 100 }] },
  ]
  for (const patch of patches) {
   const bad = { ...state, projectExtracts: [{ ...extract, ...patch }] }
   expect(() => assertProjectFinancialHistoryPreserved(state, bad), JSON.stringify(patch)).toThrow(/ختامي/)
   expect(() => mergeConcurrentSnapshots(wrap(state), wrap(bad), wrap({ ...state, preferences: { theme: 'dark' } })), JSON.stringify(patch)).toThrow(/ختامي/)
  }
  for (const patch of [{ extractNumber: 'PRX-آخر' }, { createdAt: '2025-01-01T00:00:00' }]) {
   expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projectExtracts: [{ ...extract, ...patch, journalEntryId: 999 }] })).toThrow(/ختامي/)
  }
  const noId = { ...state, projectExtracts: [{ ...extract, journalEntryId: undefined }] }
  const changed = { ...noId, projectExtracts: [{ ...noId.projectExtracts[0], payment: 'credit' }] }
  expect(() => assertProjectFinancialHistoryPreserved(noId, changed)).toThrow(/ختامي/)
  expect(() => assertProjectFinancialHistoryPreserved(noId, structuredClone(noId))).not.toThrow()
 })
 it('يقبل أساساً مالياً تغير بتعديل فعلي مع عكس القيد، ويقبل التغيير الوصفي المستقل', () => {
  const { extract } = setup()
  const before = { projectExtracts: S().projectExtracts, journal: S().journal, clientAdvances: S().clientAdvances, retentionReleases: S().retentionReleases }
  const updated = S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'تصحيح ضريبة', vatPercent: 14, reason: 'تصحيح' })
  const after = { ...before, projectExtracts: S().projectExtracts, journal: S().journal }
  expect(updated.journalEntryId).not.toBe(extract.journalEntryId)
  expect(updated.totals.vatMinor).toBeGreaterThan(0)
  expect(() => assertProjectFinancialHistoryPreserved(before, after)).not.toThrow()
  const merged = JSON.parse(mergeConcurrentSnapshots(wrap(before), wrap(after), wrap({ ...before, preferences: { theme: 'dark' } })))
  expect(merged.state.projectExtracts[0]).toEqual(updated)
  expect(merged.state.preferences.theme).toBe('dark')
 })
 it('يرفض جعل مستخلص أقدم ختامياً مع وجود مستخلص لاحق حتى لو لم يكن ختامياً', () => {
  const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  const first = S().addProjectExtract({ projectId: p.id, grossMinor: 4000, payment: 'cash', description: 'أول', vatPercent: 0 })
  S().addProjectExtract({ projectId: p.id, grossMinor: 6000, payment: 'cash', description: 'ثان', vatPercent: 0 })
  const before = S()
  expect(() => S().editProjectExtract({ extractId: first.id, grossMinor: 4000, payment: 'cash', description: 'أول', vatPercent: 0, isFinal: true, reason: 'تصحيح' })).toThrow(/ختامي|أحدث/)
  expect(S()).toBe(before)
 })
 it('يرفض إنشاء ختامي ثانٍ عبر تعديل مستخلص سابق', () => {
  const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  const first = S().addProjectExtract({ projectId: p.id, grossMinor: 4000, payment: 'cash', description: 'أول', vatPercent: 0 })
  S().addProjectExtract({ projectId: p.id, grossMinor: 6000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
  const before = S()
  expect(() => S().editProjectExtract({ extractId: first.id, grossMinor: 4000, payment: 'cash', description: 'أول', vatPercent: 0, isFinal: true, reason: 'تصحيح' })).toThrow(/ختامي/)
  expect(S()).toBe(before)
 })
})
