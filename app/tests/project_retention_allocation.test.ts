import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
function create() {
  const p = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
  const a = S().addProjectExtract({ projectId: p.id, date: '2026-11-03', grossMinor: 4000, payment: 'credit', vatPercent: 0, description: 'الأول' })
  const b = S().addProjectExtract({ projectId: p.id, date: '2026-11-04', grossMinor: 6000, payment: 'credit', vatPercent: 0, description: 'الثاني' })
  return { p, a, b }
}
it('يثبت تحصيل كامل المحتجز على المستخلصين وقيد كل منهما دون قيد إضافي', () => {
  const { p, a, b } = create()
  expect(S().releaseRetention(p.id).amount).toBe(1000)
  expect(S().retentionReleases[0].allocationEvidence).toEqual({ version: 1, allocations: [
    { extractId: a.id, journalEntryId: a.journalEntryId, amountMinor: 400 },
    { extractId: b.id, journalEntryId: b.journalEntryId, amountMinor: 600 },
  ] })
  expect(S().journal).toHaveLength(3); expect(S().getRemainingRetention(p.id)).toBe(0)
})
it('يحجب الحساب عند تبديل أو فقد أو تكرار تخصيص أو إسقاطه في لقطة مقارنة', () => {
  const { p } = create(); S().releaseRetention(p.id)
  const release = S().retentionReleases[0], allocation = release.allocationEvidence!
  const snap = { clientAdvances: S().clientAdvances, projectExtracts: S().projectExtracts, retentionReleases: S().retentionReleases }
  const invalid = [[], [...allocation.allocations].reverse(), [allocation.allocations[0], allocation.allocations[0]], [{ ...allocation.allocations[0], amountMinor: 600 }, { ...allocation.allocations[1], amountMinor: 400 }]]
  for (const allocations of invalid) {
    const changed = { ...release, allocationEvidence: { version: 1 as const, allocations } }
    useRawDataStore.setState({ retentionReleases: [changed] })
    expect(() => S().getRemainingRetention(p.id)).toThrow(FinancialDataReviewError)
    expect(() => S().getProjectProfit(p.id)).toThrow(FinancialDataReviewError)
    expect(() => assertProjectFinancialHistoryPreserved(snap, { ...snap, retentionReleases: [changed] })).toThrow(/تحصيل المحتجز/)
  }
})
it('لا يخترع تخصيصاً لما بقي بعد تحصيل تاريخي جزئي مجهول', () => {
  const { p } = create(); S().releaseRetention(p.id)
  const release = S().retentionReleases[0]
  const { allocationEvidence: _allocation, ...legacy } = release
  void _allocation
  useRawDataStore.setState({ projects: S().projects.map(row => row.id === p.id ? { ...row, status: 'active', completedAt: undefined } : row), retentionReleases: [{ ...legacy, amountMinor: 500 }], journal: S().journal.map(entry => entry.id === release.journalEntryId ? { ...entry, lines: entry.lines.map(line => ({ ...line, debit: line.debit ? 500 : 0, credit: line.credit ? 500 : 0 })) } : entry) })
  expect(S().getRemainingRetention(p.id)).toBe(500)
  const before = S()
  expect(() => S().releaseRetention(p.id)).toThrow(/تحصيل محتجز سابق/)
  expect(S().journal).toBe(before.journal); expect(S().retentionReleases).toBe(before.retentionReleases)
})
it('يرفض في مقارنة اللقطات إسقاط أصل مستخلص موزع أو تعديل ربطه أو محتجزه رغم بقاء التحصيل', () => {
  const { p } = create(); S().releaseRetention(p.id)
  const extracts = S().projectExtracts, release = S().retentionReleases[0]
  const state = { clientAdvances: [], projectExtracts: extracts, retentionReleases: [release] }
  const candidates = [extracts.slice(1), extracts.map((row, i) => i === 0 ? { ...row, projectId: p.id + 1 } : row), extracts.map((row, i) => i === 0 ? { ...row, journalEntryId: row.journalEntryId + 10 } : row), extracts.map((row, i) => i === 0 ? { ...row, totals: { ...row.totals, retentionMinor: row.totals.retentionMinor + 1 } } : row)]
  for (const projectExtracts of candidates) expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projectExtracts })).toThrow(/أساس توزيع تحصيل المحتجز/)
  expect(() => assertProjectFinancialHistoryPreserved(state, structuredClone(state))).not.toThrow()
})
it('يرفض مستخلص محتجز أضيف بأثر رجعي قبل التحصيل لكنه يسمح بإضافة أحدث للمراجعة اللاحقة', () => {
  const { p } = create(); S().releaseRetention(p.id)
  const extracts = S().projectExtracts, release = S().retentionReleases[0]
  const state = { clientAdvances: [], projectExtracts: extracts, retentionReleases: [release] }
  const inserted = { ...extracts[0], id: 99, journalEntryId: release.journalEntryId - 1 }
  expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projectExtracts: [...extracts, inserted] })).toThrow(/أساس توزيع تحصيل المحتجز/)
  const newer = { ...inserted, journalEntryId: release.journalEntryId + 1 }
  expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projectExtracts: [...extracts, newer] })).not.toThrow()
})
it('يحافظ على أصل مستخلص صُفّي محتجزه بإشعار قبل التحصيل حتى لو لم يحصل على حصة', () => {
  const baseExtract = { id: 1, projectId: 1, journalEntryId: 1, totals: { retentionMinor: 100 }, quantityCreditVersion: 2, refunds: [{ journalEntryId: 2, amountMinor: 100, taxShareMinor: 0, retentionMinor: 100 }], refundedMinor: 100, refundedTaxMinor: 0 }
  const other = { id: 2, projectId: 1, journalEntryId: 3, totals: { retentionMinor: 200 } }
  const release = { id: 1, projectId: 1, journalEntryId: 4, amountMinor: 200, allocationEvidence: { version: 1, allocations: [{ extractId: 2, journalEntryId: 3, amountMinor: 200 }] } }
  const state = { projectExtracts: [baseExtract, other], retentionReleases: [release] }
  expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, projectExtracts: [other] })).toThrow(/أساس توزيع تحصيل المحتجز/)
})
