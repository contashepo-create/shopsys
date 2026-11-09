import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const branch = (id: number, isMain: boolean) => ({ id, nameAr: `فرع ${id}`, isMain, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1121' })
const line = { employeeId: 1, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }
const post = (rows = [line]) => S().accruePayrollSlips({ month: '2026-11', rows })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [branch(1, true), branch(2, false)] as never, employees: [{ id: 1, nameAr: 'موظف', active: true, branchId: 1 }] as never, payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], employeeDeductions: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يرفض تكرار الموظف قبل أي قيد أو قسيمة', () => { const before = S(); expect(() => post([line, line])).toThrow(/مكرر/); expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips) })
it('يرفض موظف فرع آخر أو مستخدماً لا يملك الصلاحية', () => {
 useRawDataStore.setState({ employees: [{ ...S().employees[0], branchId: 2 }] as never }); expect(() => post()).toThrow(/فرع آخر/)
 useRawDataStore.setState({ employees: [{ ...S().employees[0], branchId: 1 }] as never, currentUserId: 999 }); expect(() => post()).toThrow(/صلاحية/); expect(S().journal).toHaveLength(0)
})
it.each(['advance', 'deduction'])('يرفض تخصيص %s من فرع آخر أو بمعرف مكرر', kind => {
 const row = { id: 1, employeeId: 1, date: '2026-11-03', branchId: 2, amountMinor: 1000, recoveredMinor: 0, advanceNumber: 'ADV-1', dedNumber: 'DED-1', reason: 'سبب', notes: '' }
 if (kind === 'advance') useRawDataStore.setState({ employeeAdvances: [row] as never }); else useRawDataStore.setState({ employeeDeductions: [row] as never })
 const draft = kind === 'advance' ? { ...line, advanceMinor: 500 } : { ...line, deductionsMinor: 500 }
 const before = S(); expect(() => post([draft])).toThrow(/فرع آخر/); expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
 const rows = [{ ...row, branchId: 1 }, { ...row, employeeId: 2 }]
 if (kind === 'advance') useRawDataStore.setState({ employeeAdvances: rows as never }); else useRawDataStore.setState({ employeeDeductions: rows as never })
 expect(() => post([draft])).toThrow(/فريد/)
})
it('يرفض المبالغ غير الآمنة قبل الترحيل', () => { expect(() => post([{ ...line, grossMinor: NaN }])).toThrow(/صحيحة/); expect(S().journal).toHaveLength(0) })
it('يخصم الأقدم بتاريخ المستند ويحفظ تخصيص الجزاء وإدخاله الأصلي', () => {
 const advances = ['2026-10-20', '2026-09-01', '2026-09-01'].map((date, i) => ({ id: i + 1, employeeId: 1, date, branchId: 1, advanceNumber: `ADV-${i + 1}`, amountMinor: 1000, recoveredMinor: 0, source: 'cash', treasury: '1101', notes: '' }))
 const deductions = ['2026-10-21', '2026-09-02', '2026-09-02'].map((date, i) => ({ id: i + 1, employeeId: 1, date, branchId: 1, dedNumber: `DED-${i + 1}`, amountMinor: 1000, recoveredMinor: 0, reason: 'تأخير', notes: '' }))
 useRawDataStore.setState({ employeeAdvances: advances as never, employeeDeductions: deductions as never })
 const [slip] = post([{ ...line, advanceMinor: 1500, deductionsMinor: 1500 }])
 expect(S().employeeAdvances.map(a => [a.id, a.recoveredMinor])).toEqual([[1, 0], [2, 1000], [3, 500]])
 expect(S().employeeDeductions.map(d => [d.id, d.recoveredMinor])).toEqual([[1, 0], [2, 1000], [3, 500]])
 expect(slip.recoveredDeductions).toEqual([{ deductionId: 2, minor: 1000 }, { deductionId: 3, minor: 500 }])
})
it('تعطي كل دفعة استحقاق رقماً فريداً مشتركاً مع المسير المجمّع واليومية القديمة', () => {
 const [first] = post()
 const [second] = S().accruePayrollSlips({ month: '2026-10', rows: [line] })
 expect(first.runId).not.toBe(second.runId)
 const run = S().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', notes: '', lines: [{ employeeId: 1, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
 expect(new Set([first.runId, second.runId, run.id]).size).toBe(3)
 const [third] = S().accruePayrollSlips({ month: '2026-08', rows: [line] }); expect(third.runId).toBeGreaterThan(run.id)
 expect(S().journal.filter(j => j.sourceType === 'payroll').map(j => j.sourceId)).toEqual([first.runId, second.runId, run.id, third.runId])
})
it('يتجنب معرّف مسير يتيم في اليومية القديمة', () => {
 useRawDataStore.setState({ journal: [{ id: 1, entryNumber: 1, sourceType: 'payroll', sourceId: 42, date: '2026-11-03', description: 'قديم', lines: [{ accountCode: '5102', debit: 100, credit: 0 }, { accountCode: '2104', debit: 0, credit: 100 }], createdBy: 'قديم', createdAt: '2026-11-03', reversedByEntryId: null, reversesEntryId: null }] as never })
 expect(post()[0].runId).toBe(43)
})
it('إلغاء قسيمة جديدة يعكس تخصيص السلفة نفسه لا المسترد من سجل آخر', () => {
 const advances = ['2026-10-20', '2026-09-01'].map((date, i) => ({ id: i + 1, employeeId: 1, date, branchId: 1, advanceNumber: `ADV-${i + 1}`, amountMinor: 1000, recoveredMinor: i === 0 ? 500 : 0, source: 'cash', treasury: '1101', notes: '' }))
 useRawDataStore.setState({ employeeAdvances: advances as never })
 const [slip] = post([{ ...line, advanceMinor: 1000 }]); expect(slip.recoveredAdvances).toEqual([{ advanceId: 2, minor: 1000 }])
 S().cancelPayrollSlip(slip.id, 'تصحيح'); expect(S().employeeAdvances.map(a => a.recoveredMinor)).toEqual([500, 0])
})
it('لا يعكس قسيمة بتخصيص سلفة تالف أو مفقود من سجلاتها', () => {
 const a = { id: 1, employeeId: 1, date: '2026-09-01', branchId: 1, advanceNumber: 'ADV-1', amountMinor: 1000, recoveredMinor: 0, source: 'cash', treasury: '1101', notes: '' }
 useRawDataStore.setState({ employeeAdvances: [a] as never }); const [slip] = post([{ ...line, advanceMinor: 500 }])
 useRawDataStore.setState({ employeeAdvances: [] }); const before = S()
 expect(() => S().cancelPayrollSlip(slip.id, 'تصحيح')).toThrow(/غير مثبت/); expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
})
it('لا يخمن عكس السلفة عند غياب تخصيص قسيمة قديمة', () => {
 const a = { id: 1, employeeId: 1, date: '2026-09-01', branchId: 1, advanceNumber: 'ADV-1', amountMinor: 1000, recoveredMinor: 0, source: 'cash', treasury: '1101', notes: '' }
 useRawDataStore.setState({ employeeAdvances: [a] as never }); const [slip] = post([{ ...line, advanceMinor: 500 }])
 useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(row => ({ ...row, recoveredAdvances: undefined })) }); const before = S()
 expect(() => S().cancelPayrollSlip(slip.id, 'تصحيح')).toThrow(/تسوية يدوية/); expect(S().journal).toBe(before.journal); expect(S().employeeAdvances).toBe(before.employeeAdvances)
})
