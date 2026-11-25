import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots, newJournalEntries } from '../src/data/persistentStorage.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], projects: [], customers: [], clientAdvances: [], projectExtracts: [], retentionReleases: [], journal: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function setup() {
 S().addPaymentTerminal({ id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' })
 const project = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().receiveClientAdvance({ projectId: project.id, amountMinor: 1000, treasury: '1101', terminalPayment: { terminalId: 't1', providerReference: 'PAY-123' } })
 return { project, advance: S().clientAdvances[0], charge: S().paymentTerminalTransactions[0] }
}
const wrap = (state: object) => JSON.stringify({ state })
describe('دليل ماكينة تحصيل المقدمة', () => {
 it.each(['refund', 'void'] as const)('يرفض %s حركة مقدمة منفردة بلا تسوية للقيد', kind => {
  const { charge } = setup(), before = S()
  const reversal = { ...charge, id: `r-${kind}`, idempotencyKey: `key-${kind}`, kind, documentId: `return-${kind}`, originalTransactionId: charge.id, providerReference: 'refund-ref' }
  expect(() => S().recordPaymentTerminalTransaction(reversal)).toThrow(/مقدمة/)
  expect(S()).toBe(before)
 })
 it('يرفض حذف أو تغيير الحركة المعروفة أو إضافة رد عند مقارنة اللقطات أو الحفظ المباشر', () => {
  const { charge } = setup(), current = S()
  const state = { clientAdvances: current.clientAdvances, projectExtracts: current.projectExtracts, retentionReleases: current.retentionReleases, paymentTerminalTransactions: current.paymentTerminalTransactions, journal: current.journal }
  const reversal = { ...charge, id: 'r', kind: 'refund' as const, originalTransactionId: charge.id }
  for (const list of [[], [{ ...charge, amountMinor: 999 }], [charge, charge], [charge, reversal]]) {
   const after = { ...state, paymentTerminalTransactions: list }
   expect(() => assertProjectFinancialHistoryPreserved(state, after)).toThrow(/ماكينة.*مقدمة/)
   expect(() => newJournalEntries(wrap(after), wrap(state))).toThrow(/ماكينة.*مقدمة/)
  }
  expect(() => assertProjectFinancialHistoryPreserved(state, structuredClone(state))).not.toThrow()
 })
 it('يحفظ الحركة في دمج اللقطات ويقبل حركة مستقلة أخرى', () => {
  const { charge } = setup(), current = S()
  const base = { clientAdvances: current.clientAdvances, projectExtracts: current.projectExtracts, retentionReleases: current.retentionReleases, paymentTerminalTransactions: current.paymentTerminalTransactions, journal: current.journal }
  const bad = { ...base, paymentTerminalTransactions: [{ ...charge, amountMinor: 999 }] }
  for (const [left, right] of [[bad, { ...base, prefs: { theme: 'dark' } }], [{ ...base, prefs: { theme: 'dark' } }, bad]]) expect(() => mergeConcurrentSnapshots(wrap(base), wrap(left), wrap(right))).toThrow(/ماكينة.*مقدمة|تعارض/)
  expect(() => assertProjectFinancialHistoryPreserved(base, { ...base, paymentTerminalTransactions: [charge, { ...charge, id: 'other', documentId: 'other' }] })).not.toThrow()
 })
 it('يمنع استرداد مقدمة ذات حركة معروفة تالفة أو مردودة بلا تسوية، دون ادعاء معرفة المقدمة النقدية القديمة', () => {
  const { project, charge } = setup()
  const issue = () => S().addProjectExtract({ projectId: project.id, grossMinor: 2000, payment: 'cash', vatPercent: 0, description: 'أعمال', advanceRecoveryMinor: 200 })
  expect(S().clientAdvances[0].paymentEvidence?.terminalCharge?.id).toBe(charge.id)
  for (const list of [[], [{ ...charge, amountMinor: 999 }], [charge, charge], [charge, { ...charge, id: 'r', kind: 'refund' as const, originalTransactionId: charge.id }]]) {
   useRawDataStore.setState({ paymentTerminalTransactions: list }); const before = S()
   expect(issue).toThrow(/مراجعة|ماكينة/); expect(S()).toBe(before)
  }
  useRawDataStore.setState({ paymentTerminalTransactions: [charge] })
  const advance = S().clientAdvances[0], evidence = advance.paymentEvidence!
  for (const paymentEvidence of [{ ...evidence, treasuryCode: '1102' }, { ...evidence, terminalCharge: { ...charge, amountMinor: 999 } }, { ...evidence, terminalCharge: undefined }]) {
   useRawDataStore.setState({ clientAdvances: [{ ...advance, paymentEvidence }] }); const before = S()
   expect(issue).toThrow(/مراجعة|ماكينة/); expect(S()).toBe(before)
  }
  useRawDataStore.setState({ clientAdvances: [advance] })
  expect(issue().advanceRecoveryMinor).toBe(200)
 })
 it('يترك المقدمة القديمة بلا دليل دفع مجهولاً ولا يستنتج لها حركة من العدم', () => {
  const { project } = setup(), advance = S().clientAdvances[0]
  const { paymentEvidence: _evidence, createdAt: _createdAt, ...legacy } = advance; void _evidence; void _createdAt
  useRawDataStore.setState({ clientAdvances: [legacy], paymentTerminalTransactions: [] })
  expect(() => S().addProjectExtract({ projectId: project.id, grossMinor: 2000, payment: 'cash', vatPercent: 0, description: 'أعمال', advanceRecoveryMinor: 200 })).not.toThrow()
 })
})
