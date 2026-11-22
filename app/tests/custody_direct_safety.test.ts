import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildCustodyExpenseEntry, buildCustodyFundEntry, buildCustodySettleEntry, checkedOpenCustodySummary, splitCustodyExpense } from '../src/core/custody.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const employee = { id: 1, nameAr: 'موظف', active: true }
const project = { id: 3, code: 'P1', nameAr: 'مشروع', clientName: '', clientId: null, contractValueMinor: 1000, retentionPercent: 0, startDate: '2026-01-01', status: 'active', notes: '' }
const fund = (id: number, amountMinor = 1000, treasury = '1101') => S().fundCustodyFile({ fileId: id, amountMinor, treasury, description: 'تعزيز' })
const expense = (id: number, options: object = {}) => S().postCustodyExpense({ fileId: id, amountMinor: 400, description: 'تكلفة', ...options })
const settle = (id: number, returnedMinor = 500, treasury = '1101') => S().settleCustodyFile({ fileId: id, returnedMinor, treasury })
const open = (projectId: number | null = 3) => S().openCustodyFile({ employeeId: 1, projectId, reason: 'عهدة موقع', notes: '' })

beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 12))
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [employee], projects: [project], custodyFiles: [], custodyTxs: [], employeeAdvances: [], projectCosts: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })

it('الدورة المباشرة: تمويل ومصروف وعجز ومرتجع بقيد وبند مشروع مرتبطين دون تكرار', () => {
 const f = open(); const t = fund(f.id); const x = expense(f.id); const end = settle(f.id)
 expect([t.amountMinor, x.amountMinor, end.returnedMinor, end.shortageMinor]).toEqual([1000, 400, 500, 100])
 expect(S().projectCosts[0]).toMatchObject({ projectId: 3, amountMinor: 400, journalEntryId: x.journalEntryId })
 expect(S().employeeAdvances[0]).toMatchObject({ employeeId: 1, amountMinor: 100, custodyFileId: f.id })
 expect(S().journal.map(e => e.lines.map(l => [l.accountCode, l.debit, l.credit]))).toEqual([
  [['1108', 1000, 0], ['1101', 0, 1000]], [['5110', 400, 0], ['1108', 0, 400]], [['1101', 500, 0], ['1107', 100, 0], ['1108', 0, 600]],
 ])
 const before = S(); expect(() => settle(f.id)).toThrow(/مغلق/); expect(S()).toBe(before)
})
it('زيادة المصروف تبقى مستحقة للموظف ولا تستهلك عهداً سالبة', () => {
 const f = open(null); fund(f.id, 100); const x = expense(f.id, { amountMinor: 300, allowExcess: true })
 expect(x.excessMinor).toBe(200); expect(S().getCustodySummary(f.id).remainingMinor).toBe(0)
 expect(S().journal[1].lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['5108', 300, 0], ['1108', 0, 100], ['2107', 0, 200]])
 expect(settle(f.id, 0).status).toBe('settled')
})
it('صلاحية إدارة الموظفين مطلوبة عند كل كتابة والفرع مطلوب إن وجد', () => {
 const f = open(); useRawDataStore.setState({ currentUserId: 7, appUsers: [{ id: 7, nameAr: 'كاشير', roleId: 'cashier', active: true }] } as never)
 for (const act of [() => open(), () => fund(f.id), () => expense(f.id), () => settle(f.id, 0)]) { const before = S(); expect(act).toThrow(/صلاحية/); expect(S()).toBe(before) }
})
it('هوية الموظف والمشروع والملف والفرع لا تقبل المكرر أو الغريب', () => {
 const f = open(); useRawDataStore.setState({ employees: [employee, employee] } as never)
 let before = S(); expect(() => fund(f.id)).toThrow(/فريد/); expect(S()).toBe(before)
 useRawDataStore.setState({ employees: [employee], custodyFiles: [f, f] } as never)
 before = S(); expect(() => expense(f.id)).toThrow(/فريد/); expect(S()).toBe(before)
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'فرع', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, custodyFiles: [{ ...f, branchId: 2 }] as never, employees: [{ ...employee, branchId: 1 }] as never, projects: [{ ...project, branchId: 1 }] as never })
 before = S(); expect(() => fund(f.id)).toThrow(/فرع/); expect(S()).toBe(before)
 useRawDataStore.setState({ custodyFiles: [{ ...f, branchId: 1 }] as never, projects: [{ ...project, branchId: 2 }] as never })
 before = S(); expect(() => expense(f.id)).toThrow(/فرع/); expect(S()).toBe(before)
})
it('الخزينة مطلوبة ومسموح بها للتمويل أو المرتجع، ولا أثر عند رفضها', () => {
 const f = open(); let before = S(); expect(() => fund(f.id, 1000, '4107')).toThrow(/الخزينة/); expect(S()).toBe(before)
 fund(f.id); before = S(); expect(() => settle(f.id, 500, '4107')).toThrow(/الخزينة/); expect(S()).toBe(before)
})
it('الفترة المقفلة توقف التمويل والمصروف والتسوية الإدارية ذات الرصيد الصفري', () => {
 const f = open(); useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 for (const act of [() => fund(f.id), () => expense(f.id), () => settle(f.id, 0)]) { const before = S(); expect(act).toThrow(); expect(S()).toBe(before) }
})
it('يمنع حساب الأصول أو حساباً مختلفاً عن تكلفة المشروع', () => {
 const f = open(); fund(f.id); for (const account of ['1108', '5108', '2107']) { const before = S(); expect(() => expense(f.id, { expenseAccount: account })).toThrow(/حساب مصروف/); expect(S()).toBe(before) }
})
it('الحركات التاريخية التالفة توقف التمويل والمصروف والتسوية دون تعديل', () => {
 const f = open(); const tx = fund(f.id); const corruptions = [
  { ...tx, amountMinor: -1 }, { ...tx, amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { ...tx, excessMinor: 1 }, { ...tx, date: '2026-02-30' }, { ...tx, date: '2026-11-16' }, { ...tx, type: 'return' },
 ]
 for (const row of corruptions) {
  useRawDataStore.setState({ custodyTxs: [row] } as never)
  for (const act of [() => fund(f.id), () => expense(f.id), () => settle(f.id, 0)]) { const before = S(); expect(act).toThrow(/حركات العهدة/); expect(S()).toBe(before) }
 }
 useRawDataStore.setState({ custodyTxs: [tx, tx] } as never); expect(() => expense(f.id)).toThrow(/مكررة/)
})
it('النواة ترفض مبالغ غير صحيحة أو غير آمنة بما فيها NaN', () => {
 for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  expect(() => buildCustodyFundEntry(value, '1101', 'x')).toThrow()
  expect(() => splitCustodyExpense(value, 1, true)).toThrow()
  expect(() => buildCustodyExpenseEntry('5108', value, 1, 'x')).toThrow()
  expect(() => buildCustodySettleEntry(value, 0, '1101', 'x')).toThrow()
 }
 const f = open(); expect(checkedOpenCustodySummary(f, [], '2026-11-15').remainingMinor).toBe(0)
})

it('لا يعتمد رصيد حركة عهدة بلا قيد أو بقيد مختلف أو معكوس', () => {
 const f = open(); const tx = fund(f.id); const entry = S().journal[0]
 for (const journal of [[], [{ ...entry, reversedByEntryId: 99 }], [{ ...entry, date: '2026-11-14' }], [{ ...entry, sourceId: 999 }], [{ ...entry, lines: [{ accountCode: '1108', debit: 999, credit: 0 }, { accountCode: '1101', debit: 0, credit: 999 }] }], [entry, entry]]) {
  useRawDataStore.setState({ journal } as never)
  for (const act of [() => fund(f.id), () => expense(f.id), () => settle(f.id, 0)]) { const before = S(); expect(act).toThrow(/قيد العهدة/); expect(S()).toBe(before) }
 }
 expect(tx.journalEntryId).toBe(entry.id)
})
it('يطابق قيداً مشتركاً يخص حركتين للعهدة مجتمعتين', () => {
 const f = open(); fund(f.id, 1000)
 const shared = { id: 2, entryNumber: 2, date: '2026-11-15', description: 'فاتورة مشتركة', sourceType: 'purchase', sourceId: 1, lines: [{ accountCode: '5108', debit: 300, credit: 0 }, { accountCode: '1108', debit: 0, credit: 300 }], reversedByEntryId: null, reversesEntryId: null }
 const rows = [100, 200].map((amountMinor, i) => ({ id: i + 2, fileId: f.id, type: 'expense', date: '2026-11-15', amountMinor, excessMinor: 0, description: 'فاتورة', treasury: null, projectId: null, purchaseId: 1, journalEntryId: 2 }))
 useRawDataStore.setState({ custodyTxs: [...S().custodyTxs, ...rows], journal: [...S().journal, shared] } as never)
 expect(() => fund(f.id, 10)).not.toThrow()
 useRawDataStore.setState({ custodyTxs: S().custodyTxs.filter(row => row.id !== 3) })
 const before = S(); expect(() => expense(f.id)).toThrow(/قيد العهدة/); expect(S()).toBe(before)
})

it('لا يفتح عهدة جديدة أو يسجل تكلفة من العهدة على مشروع مقفل، وتظل تسوية الملف ممكنة', () => {
 const f = open(); fund(f.id); useRawDataStore.setState({ projects: [{ ...project, status: 'completed' }] } as never)
 let before = S(); expect(() => open()).toThrow(/مقفل/); expect(S()).toBe(before)
 before = S(); expect(() => expense(f.id)).toThrow(/مقفل/); expect(S()).toBe(before)
 expect(settle(f.id, 1000).status).toBe('settled')
})
