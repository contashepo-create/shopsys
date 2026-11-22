import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildCustodyExpenseEntry, summarizeCustodyExcessAllocation, summarizeCustodyExcessByFile } from '../src/core/custody.ts'
import { vatReport } from '../src/core/financialReports.ts'
import { buildProjectExpenseLedger } from '../src/core/projectExpenseLedger.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 12))
  const setup = { ...app.setup, activityId: 'contracting' as const, countryCode: 'SA', taxRegistrationStatus: 'registered' as const, vatPercent: 15, allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف', active: true }], projects: [{ id: 1, code: 'P', nameAr: 'مشروع', status: 'active' }], custodyFiles: [], custodyTxs: [], payrollRuns: [], employeeAdvances: [], projectCosts: [], journal: [], treasuries: [{ code: '1101', nameAr: 'خزينة', kind: 'cash', isDefault: true }] } as never)
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
const open = () => S().openCustodyFile({ employeeId: 1, projectId: 1, reason: 'موقع', notes: '' })
const post = (id: number, patch: object = {}) => S().postCustodyExpense({ fileId: id, amountMinor: 11500, description: 'مواد', allowExcess: true, inputVatMinor: 1500, taxInvoiceRef: 'فاتورة 42', confirmRecoverableVat: true, ...patch })
const period = { from: '2026-01-01', to: '2026-12-31' }

it('يقيد الضريبة وصافي المشروع ويقسم الإجمالي بين العهدة والمستحق ويصنف التقرير', () => {
 const f = open(); S().fundCustodyFile({ fileId: f.id, amountMinor: 8000, treasury: '1101', description: '' })
 const tx = post(f.id); const entry = S().journal.find(j => j.id === tx.journalEntryId)!
 expect(tx).toMatchObject({ amountMinor: 11500, excessMinor: 3500, inputVatMinor: 1500, taxInvoiceRef: 'فاتورة 42' })
 expect(entry.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['5110', 10000, 0], ['2102', 1500, 0], ['1108', 0, 8000], ['2107', 0, 3500]])
 expect(S().getCustodySummary(f.id).remainingMinor).toBe(0)
 expect(S().projectCosts[0]).toMatchObject({ amountMinor: 10000, vatMinor: 1500, grossMinor: 11500, invoiceRef: 'فاتورة 42', custodyFileId: f.id })
 const ledger = buildProjectExpenseLedger(S().projectCosts, { supplierName: () => '', treasuryName: () => '', custodyLabel: () => 'عهدة', boqLabel: () => '', journalEntryNumber: id => id })
 expect(ledger.totals).toMatchObject({ netMinor: 10000, vatMinor: 1500, grossMinor: 11500 })
 expect(vatReport(S().journal, period)).toMatchObject({ inputVatMinor: 1500, settledMinor: 0, netDueMinor: -1500 })
 const reverse: JournalEntry = { ...entry, id: 99, entryNumber: 99, sourceType: 'reversal', sourceId: entry.id, reversesEntryId: entry.id, lines: entry.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) }
 expect(vatReport([...S().journal, reverse], period)).toMatchObject({ inputVatMinor: 0, settledMinor: 0 })
})
it('مصروف بلا ضريبة يحافظ على المعالجة القديمة', () => {
 const f = open(); S().fundCustodyFile({ fileId: f.id, amountMinor: 20000, treasury: '1101', description: '' })
 const t = post(f.id, { inputVatMinor: 0, taxInvoiceRef: undefined, confirmRecoverableVat: false })
 expect(S().journal.find(e => e.id === t.journalEntryId)?.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['5110', 11500, 0], ['1108', 0, 11500]])
 expect(S().projectCosts[0].amountMinor).toBe(11500)
})
it.each([-1, 0.5, 11500, 12000, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('يرفض ضريبة غير صالحة %s دون كتابة', value => {
 const f = open(); const before = S(); expect(() => post(f.id, { inputVatMinor: value })).toThrow(); expect(S()).toBe(before)
})
it('لا يفصل ضريبة بلا تأكيد أو مرجع أو عندما تمنعها صفة المنشأة', () => {
 const f = open(); const before = S()
 expect(() => post(f.id, { confirmRecoverableVat: false })).toThrow(/أكد/)
 expect(() => post(f.id, { taxInvoiceRef: '  ' })).toThrow(/مرجع/)
 const setup = { ...useAppStore.getState().setup, taxRegistrationStatus: 'exempt' as const }; useAppStore.setState({ setup })
 expect(() => post(f.id)).toThrow(/غير مؤهلة/); expect(S()).toBe(before)
})
it('يرفض القيد الضريبي بأجزاء غير آمنة أو ضريبة تساوي الإجمالي', () => {
 expect(() => buildCustodyExpenseEntry('5108', 80, 35, 'x', 115)).toThrow()
 expect(() => buildCustodyExpenseEntry('5108', Number.MAX_SAFE_INTEGER, 1, 'x', 1)).toThrow()
})
it('FIFO يوم ثم معرف بغض النظر عن ترتيب المدخلات ولا يحمل صرفاً إلى استحقاق لاحق', () => {
 const files = [{ id: 1, employeeId: 1 }, { id: 2, employeeId: 1 }, { id: 3, employeeId: 1 }]
 const txs = [{ id: 8, fileId: 2, date: '2026-01-02T08:00:00', excessMinor: 20 }, { id: 3, fileId: 1, date: '2026-01-02', excessMinor: 10 }, { id: 1, fileId: 3, date: '2026-01-03', excessMinor: 30 }]
 const runs = [{ id: 1, date: '2026-01-01', lines: [{ employeeId: 1, excessPaidMinor: 100 }] }, { id: 2, date: '2026-01-02T12:00:00', lines: [{ employeeId: 1, excessPaidMinor: 15 }] }]
 const allocation = summarizeCustodyExcessAllocation(files, txs, runs)
 expect(allocation.unallocatedPaidByEmployee.get(1)).toBe(100)
 const result = allocation.balances
 expect([result.get(1)?.paidMinor, result.get(2)?.paidMinor, result.get(3)?.paidMinor]).toEqual([10, 5, 0])
 expect([...summarizeCustodyExcessByFile(files, [...txs].reverse(), [...runs].reverse()).values()]).toEqual([...result.values()])
})
it('المعاملة القديمة لسند سداد ضريبة تبقى تسوية، وعكس المصروف في فترة لاحقة يخفض المدخلات في تلك الفترة', () => {
 const f = open(); const tx = post(f.id); const entry = S().journal.find(j => j.id === tx.journalEntryId)!
 const reverse: JournalEntry = { ...entry, id: 99, entryNumber: 99, date: '2027-01-03', sourceType: 'reversal', sourceId: entry.id, reversesEntryId: entry.id, lines: entry.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) }
 const settlement: JournalEntry = { ...entry, id: 98, entryNumber: 98, sourceCollection: 'vouchers', custodyInputVatMinor: undefined, lines: [{ accountCode: '2102', debit: 200, credit: 0 }, { accountCode: '1101', debit: 0, credit: 200 }] }
 expect(vatReport([entry, settlement, reverse], period)).toMatchObject({ inputVatMinor: 1500, settledMinor: 200 })
 expect(vatReport([entry, settlement, reverse], { from: '2027-01-01', to: '2027-12-31' })).toMatchObject({ inputVatMinor: -1500, settledMinor: 0 })
})
it('حركة المصروف الضريبي تصمد بعد نسخة JSON ولا تغير الحركات السابقة', () => {
 const f = open(); const fund = S().fundCustodyFile({ fileId: f.id, amountMinor: 20000, treasury: '1101', description: '' })
 const old = JSON.stringify(S().journal); const tx = post(f.id)
 expect(JSON.stringify(S().journal.slice(0, 1))).toBe(old)
 expect(JSON.parse(JSON.stringify(tx))).toMatchObject({ inputVatMinor: 1500, taxInvoiceRef: 'فاتورة 42' })
 expect(S().custodyTxs[0]).toEqual(fund)
 expect(vatReport(JSON.parse(JSON.stringify(S().journal)), period).inputVatMinor).toBe(1500)
})
