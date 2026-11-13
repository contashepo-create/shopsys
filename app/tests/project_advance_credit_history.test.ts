import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertAdvanceRecoveryBasis } from '../src/core/projectAdvanceRecovery.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function example() {
  const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 5000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  for (let i = 0; i < 2; i++) S().receiveClientAdvance({ projectId: p.id, amountMinor: 1000, treasury: '1101' })
  const ex = S().addProjectExtract({ projectId: p.id, grossMinor: 2000, payment: 'cash', vatPercent: 0, description: 'أعمال', advanceRecoveryMinor: 1200 })
  const original = S(), id = original.journal.at(-1)!.id + 1
  const allocations = [{ advanceId: 2, journalEntryId: 2, amountMinor: 200 }, { advanceId: 1, journalEntryId: 1, amountMinor: 50 }]
  const refund = { date: '2026-11-05', amountMinor: 400, restoredAdvanceMinor: 250, restoredAdvanceAllocations: allocations, journalEntryId: id }
  const entry = { id, entryNumber: id, date: refund.date, description: 'إشعار', sourceType: 'project_extract' as const, sourceId: ex.id, lines: [{ accountCode: '4102', debit: 400, credit: 0 }, { accountCode: '2109', debit: 0, credit: 250 }, { accountCode: '1101', debit: 0, credit: 150 }], createdBy: 'اختبار', createdAt: '2026-11-05', reversedByEntryId: null, reversesEntryId: null }
  const advances = original.clientAdvances.map((row, i) => ({ ...row, recoveredMinor: i === 0 ? 950 : 0 }))
  const extracts = [{ ...ex, quantityCreditVersion: 3, refunds: [refund] }]
  const journal = [...original.journal, entry]
  const check = (a = advances, e = extracts, j = journal) => assertAdvanceRecoveryBasis(p.id, a, e, new Map(j.map(row => [row.id, row])), new Set(['1101']), { experimentalCreditReplay: true })
  return { p, ex, advances, extracts, journal, check }
}
it('يعيد تشغيل FIFO الأصلي ثم تخصيص العكس على الدفعتين دون تغيير أصل المستخلص', () => {
  const x = example()
  expect(() => x.check()).not.toThrow()
  expect(x.extracts[0].advanceRecoveryMinor).toBe(1200)
  expect(x.advances.map(row => row.recoveredMinor)).toEqual([950, 0])
  expect(() => assertAdvanceRecoveryBasis(x.p.id, x.advances, x.extracts, new Map(x.journal.map(row => [row.id, row])), new Set(['1101']))).toThrow(/مراجعة/)
})
it('يرفض قيد 2109 أو رصيداً أو تخصيص عكس غير مطابق', () => {
  const x = example()
  expect(() => x.check(x.advances.map((row, i) => i === 0 ? { ...row, recoveredMinor: 951 } : row))).toThrow(/مراجعة/)
  expect(() => x.check(x.advances, x.extracts.map(row => ({ ...row, refunds: row.refunds.map(r => ({ ...r, restoredAdvanceAllocations: [...r.restoredAdvanceAllocations].reverse() })) })))).toThrow(/مراجعة/)
  expect(() => x.check(x.advances, x.extracts, x.journal.map((row, i) => i === x.journal.length - 1 ? { ...row, lines: row.lines.map(line => line.accountCode === '2109' ? { ...line, credit: 249 } : line.accountCode === '1101' ? { ...line, credit: 151 } : line) } : row))).toThrow(/مراجعة/)
})
it('يرفض توزيعاً تاريخياً غير مثبت أو استرداداً جديداً بعد أول إشعار', () => {
  const x = example()
  expect(() => x.check(x.advances, x.extracts.map(row => ({ ...row, advanceAllocations: undefined })))).toThrow(/مراجعة/)
  const later = { ...x.extracts[0], id: 99, journalEntryId: x.journal.at(-1)!.id + 1, quantityCreditVersion: undefined, refunds: undefined, advanceRecoveryMinor: 1, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 1 }] }
  expect(() => x.check(x.advances, [...x.extracts, later] as typeof x.extracts)).toThrow(/مراجعة/)
})

it('يعيد تشغيل إشعارين بالترتيب ويطابق رصيد كل دفعة بعد العكس التراكمي', () => {
  const x = example(), first = x.extracts[0].refunds[0], id = first.journalEntryId + 1
  const second = { date: first.date, journalEntryId: id, amountMinor: 300, restoredAdvanceMinor: 200, restoredAdvanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 200 }] }
  const entry = { ...x.journal.at(-1)!, id, entryNumber: id, lines: [{ accountCode: '4102', debit: 300, credit: 0 }, { accountCode: '2109', debit: 0, credit: 200 }, { accountCode: '1101', debit: 0, credit: 100 }] }
  const advances = x.advances.map((row, i) => i === 0 ? { ...row, recoveredMinor: 750 } : row)
  const extracts = x.extracts.map(row => ({ ...row, refunds: [...row.refunds, second] }))
  const journal = [...x.journal, entry]
  expect(() => x.check(advances, extracts, journal)).not.toThrow()
  expect(() => x.check(advances, extracts.map(row => ({ ...row, refunds: [...row.refunds].reverse() })), journal)).toThrow(/مراجعة/)
  expect(() => x.check(advances, extracts.map(row => ({ ...row, refunds: row.refunds.map((r, i) => i ? { ...r, restoredAdvanceMinor: 201 } : r) })), journal)).toThrow(/مراجعة/)
})
