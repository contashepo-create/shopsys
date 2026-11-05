import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {}, insuranceClaims: [], clinicPatients: [], labPatients: [] })
})

it('لا يعتمد رصيد عميل أو توزع ذممه أو يرحّل رداً آخر إذا فُقد قيد إشعار المستخلص', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = s.customers.at(-1) ?? useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'مستخلص', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const updated = s.refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  const entryId = updated.refunds!.at(-1)!.journalEntryId
  expect(s.getCustomerBalance(customer.id)).toBe(6000)
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(entry => entry.id !== entryId) })
  const before = useDataStore.getState()
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
  expect(() => s.getOpenClientInvoices(customer.id, true)).toThrow(/مراجعة/)
  expect(() => s.receiveClientPayment({ customerId: customer.id, amountMinor: 1000, treasury: '1101' })).toThrow(/مراجعة/)
  expect(() => s.postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'قبض' })).toThrow(/مراجعة/)
  expect(() => s.getProjectProfit(project.id)).toThrow(/مراجعة/)
  expect(() => s.refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'آخر' })).toThrow(/مراجعة/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  expect(useDataStore.getState().projectExtracts).toBe(before.projectExtracts)
})

it('ربح المشروع يحسب صافي إشعار مستخلص موثق ويفصل ضريبته عن الإيراد', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل ضريبي', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'مستخلص', grossMinor: 10000, vatPercent: 15, payment: 'credit' })
  s.refundProjectExtract({ extractId: extract.id, amountMinor: 4600, mode: 'customer_credit', reason: 'إشعار' })
  expect(s.getProjectProfit(project.id).extractedMinor).toBe(6000)
  expect(s.getProjectProfit(project.id).profitMinor).toBe(6000)
})

it('يرفض القيد غير المتزن أو الخاطئ المصدر، ولا يحجب عميل مشروع آخر', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'متأثر', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'سليم', phone: '', creditLimitMinor: 0, notes: '' })
  const other = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع متأثر', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const ex = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const updated = s.refundProjectExtract({ extractId: ex.id, amountMinor: 4000, mode: 'customer_credit', reason: 'رد' })
  const id = updated.refunds!.at(-1)!.journalEntryId
  const journal = useDataStore.getState().journal
  for (const bad of [
    journal.map(e => e.id === id ? { ...e, sourceId: ex.id + 1 } : e),
    journal.map(e => e.id === id ? { ...e, lines: e.lines.map((l, i) => i === 0 ? { ...l, debit: l.debit + 1 } : l) } : e),
    journal.map(e => e.id === id ? { ...e, lines: e.lines.map(l => l.accountCode === '1104' ? { ...l, accountCode: '1101' } : l) } : e),
  ]) {
    useDataStore.setState({ journal: bad })
    expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
    expect(() => s.getProjectProfit(project.id)).toThrow(/مراجعة/)
    expect(s.getCustomerBalance(other.id)).toBe(0)
  }
})

it('لا يحسب إشعار المستخلص الدائن تحصيلاً ولا يخصم الرد النقدي من ذمة قائمة مرتين', async () => {
  const { projectExtractSettlement } = await import('../src/core/projectReportBalances.ts')
  const extract = { id: 1, payment: 'credit' as const, totals: { dueMinor: 10000 }, refunds: [
    { journalEntryId: 9, mode: 'customer_credit' as const, amountMinor: 4000 },
  ] }
  expect(projectExtractSettlement(extract, { settledMinor: 4000, adjustmentAllocations: [{ key: 'extract-credit:9', amountMinor: 4000 }] })).toEqual({ settled: 0, remaining: 6000 })
  expect(projectExtractSettlement({ ...extract, refunds: [{ journalEntryId: 9, mode: 'cash' as const, amountMinor: 4000 }] }, { settledMinor: 0 })).toEqual({ settled: -4000, remaining: 10000 })
  expect(projectExtractSettlement({ ...extract, payment: 'cash' }, undefined)).toEqual({ settled: 10000, remaining: 0 })
  expect(projectExtractSettlement({ ...extract, payment: 'cash', refunds: [{ journalEntryId: 9, mode: 'cash' as const, amountMinor: 4000 }] }, undefined)).toEqual({ settled: 6000, remaining: 0 })
})

it('الرصيد الاحتياطي لمستخلص غير مرتبط بعميل يراعي إشعاره الدائن ولا يتظاهر بالتحصيل', async () => {
  const { projectOpenBalances } = await import('../src/core/projectReportBalances.ts')
  const project = [{ id: 1, clientId: null }]
  const extracts = [{ id: 3, projectId: 1, payment: 'credit' as const, totals: { dueMinor: 10000 }, refunds: [{ mode: 'customer_credit', amountMinor: 4000 }] }]
  expect(projectOpenBalances(project, extracts, () => []).get(1)).toBe(6000)
  expect(projectOpenBalances(project, [{ ...extracts[0], refunds: [{ mode: 'cash', amountMinor: 4000 }] }], () => []).get(1)).toBe(10000)
})
