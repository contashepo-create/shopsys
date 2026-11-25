import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertProjectExtractRefundIntegrity } from '../src/core/projectExtractRefundIntegrity.ts'
import { assertAdvanceRecoveryBasis } from '../src/core/projectAdvanceRecovery.ts'
import { planAdvanceCredit } from '../src/core/projectAdvanceCreditPlan.ts'
import { planProjectAdvanceCreditEntry } from '../src/core/projectAdvanceCreditEntry.ts'
import { planProjectCreditAmounts } from '../src/core/projectCreditAllocation.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], approvalRequests: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function example() {
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
 const item = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
 S().receiveClientAdvance({ projectId: p.id, amountMinor: 3000, treasury: '1101' })
 const extract = S().addProjectExtract({ projectId: p.id, description: 'أعمال', payment: 'cash', vatPercent: 15, advanceRecoveryMinor: 2000, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }] })
 const initial = S(), journal = structuredClone(initial.journal), refunds = [], previous = []
 for (const [qty, restored] of [[40, 1200], [20, 800]]) {
  const amounts = planProjectCreditAmounts({ lines: extract.lines!, totals: extract.totals, refunds, refundedMinor: refunds.reduce((n, row) => n + row.amountMinor, 0), refundedTaxMinor: refunds.reduce((n, row) => n + row.taxShareMinor, 0), selected: [{ boqItemId: item.id, qty }] })
  const allocation = planAdvanceCredit({ dueMinor: extract.totals.dueMinor, recoveryMinor: extract.advanceRecoveryMinor!, allocations: extract.advanceAllocations!, previous, amountMinor: amounts.amountMinor, restoredAdvanceMinor: restored })
  const entryId = journal.at(-1)!.id + 1
  const refund = { date: '2026-11-05', journalEntryId: entryId, mode: 'cash' as const, reason: 'اختبار', amountMinor: amounts.amountMinor, taxShareMinor: amounts.taxShareMinor, grossMinor: amounts.grossMinor, retentionMinor: amounts.retentionMinor, restoredAdvanceMinor: restored, restoredAdvanceAllocations: allocation.allocations, quantities: [{ boqItemId: item.id, qty }] }
  const planned = planProjectAdvanceCreditEntry({ grossMinor: amounts.grossMinor, taxMinor: amounts.taxShareMinor, retentionMinor: amounts.retentionMinor, amountMinor: amounts.amountMinor, restoredAdvanceMinor: restored, mode: 'cash', treasury: '1101', treasuryCodes: new Set(['1101']) })
  journal.push({ id: entryId, entryNumber: entryId, date: refund.date, description: 'إشعار تجريبي', sourceType: 'project_extract', sourceId: extract.id, lines: planned.lines, createdBy: 'اختبار', createdAt: refund.date, reversedByEntryId: null, reversesEntryId: null } as JournalEntry)
  refunds.push(refund); previous.push({ amountMinor: amounts.amountMinor, restoredAdvanceMinor: restored, allocations: allocation.allocations })
 }
 const updated = { ...extract, quantityCreditVersion: 3, refunds, refundedMinor: refunds.reduce((n, row) => n + row.amountMinor, 0), refundedTaxMinor: refunds.reduce((n, row) => n + row.taxShareMinor, 0) }
 const advances = initial.clientAdvances.map(row => ({ ...row, recoveredMinor: 0 }))
 const check = (ex = updated, entries = journal) => assertProjectExtractRefundIntegrity([ex], new Map(entries.map(row => [row.id, row])), { experimentalAdvanceReplay: true })
 return { p, updated, journal, advances, check }
}
it('يدقق تجريبياً إشعارين كميين مع إعادة المقدمة والضريبة والمحتجز وقيدي التسوية، دون تفعيل الترحيل', () => {
 const x = example()
 expect(() => x.check()).not.toThrow()
 expect(() => assertAdvanceRecoveryBasis(x.p.id, x.advances, [x.updated], new Map(x.journal.map(row => [row.id, row])), new Set(['1101']), { experimentalCreditReplay: true })).not.toThrow()
 expect(() => assertProjectExtractRefundIntegrity([x.updated], new Map(x.journal.map(row => [row.id, row])))).toThrow(/مراجعة/)
 expect(() => assertAdvanceRecoveryBasis(x.p.id, x.advances, [x.updated], new Map(x.journal.map(row => [row.id, row])), new Set(['1101']))).toThrow(/مراجعة/)
})
it('يرفض اختيار مقدمة أو توزيعا أو كميات أو أطراف قيد معدلة ولو بقي القيد متزناً', () => {
 const x = example()
 const cases = [
  (s: typeof x.updated) => { s.refunds[0].restoredAdvanceMinor += 1 },
  (s: typeof x.updated) => { s.refunds[0].restoredAdvanceAllocations[0].amountMinor -= 1 },
  (s: typeof x.updated) => { s.refunds[0].quantities[0].qty += 1 },
  (s: typeof x.updated) => { s.refunds[0].retentionMinor += 1 },
  (s: typeof x.updated) => { s.refunds[0].journalEntryId = s.refunds[1].journalEntryId },
 ]
 for (const mutate of cases) { const bad = structuredClone(x.updated); mutate(bad); expect(() => x.check(bad)).toThrow(/مراجعة/) }
 const badJournal = structuredClone(x.journal)
 const row = badJournal.find(entry => entry.id === x.updated.refunds[0].journalEntryId)!
 row.lines.find(line => line.accountCode === '2109')!.credit -= 1
 row.lines.find(line => line.accountCode === '1101')!.credit += 1
 expect(() => x.check(x.updated, badJournal)).toThrow(/مراجعة/)
})
