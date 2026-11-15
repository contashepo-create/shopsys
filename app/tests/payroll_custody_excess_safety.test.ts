import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const branch = (id: number, isMain: boolean) => ({ id, nameAr: `فرع ${id}`, isMain, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1121' })
const file = { id: 1, employeeId: 1, branchId: 1, openedAt: '2026-10-01', status: 'open', fileNumber: 'عهدة 1' }
const tx = { id: 1, fileId: 1, branchId: 1, type: 'expense', date: '2026-11-01', amountMinor: 1000, excessMinor: 1000 }
const run = (excessPaidMinor = 500) => S().postPayroll({ month: '2026-11', payMode: 'cash', treasury: '1101', notes: '', lines: [{ employeeId: 1, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, excessPaidMinor }] })
const oldRun = { id: 2, branchId: 1, date: '2026-11-02T12:00:00', month: '2026-10', lines: [{ employeeId: 1, excessPaidMinor: 300 }] }
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [branch(1, true), branch(2, false)] as never, employees: [{ id: 1, nameAr: 'موظف', active: true, branchId: 1 }] as never, treasuries: [{ code: '1101', nameAr: 'رئيسية', kind: 'cash', isDefault: true, branchId: 1 }] as never, payrollRuns: [], journal: [], employeeAdvances: [], employeeDeductions: [], staffCommissions: [], driverDues: [], custodyFiles: [file] as never, custodyTxs: [tx] as never })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const reject = (pattern: RegExp) => { const before = S(); expect(() => run()).toThrow(pattern); expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns); expect(S().custodyTxs).toBe(before.custodyTxs) }
it('يصرف المستحق المحلي بعد استحقاقه ويعكس المبلغ في القيد', () => {
 useRawDataStore.setState({ payrollRuns: [oldRun] as never })
 const result = run(700); const entry = S().journal.find(j => j.id === result.journalEntryId)!
 expect(entry.lines.find(l => l.accountCode === '2107')?.debit).toBe(700)
 expect(S().getEmployeeExcessDue(1)).toBe(0)
})
it.each(['2026-11-06', '2026-02-30', ''])('يرفض تاريخ حركة غير صالح أو مستقبلي %s', date => { useRawDataStore.setState({ custodyTxs: [{ ...tx, date }] as never }); reject(/تاريخ/) })
it('يرفض استحقاقاً يسبق فتح الملف', () => { useRawDataStore.setState({ custodyTxs: [{ ...tx, date: '2026-09-30' }] as never }); reject(/تاريخ/) })
it('يرفض ملفاً أو حركة من فرع آخر وتكرار الهوية', () => {
 useRawDataStore.setState({ custodyFiles: [{ ...file, branchId: 2 }] as never }); reject(/فرع/)
 useRawDataStore.setState({ custodyFiles: [file] as never, custodyTxs: [{ ...tx, branchId: 2 }] as never }); reject(/فرع/)
 useRawDataStore.setState({ custodyTxs: [tx, { ...tx, fileId: 42 }] as never }); reject(/فريد/)
})
it('يرفض مسيراً سابقاً بفرع آخر أو بتاريخ مستقبلي', () => {
 useRawDataStore.setState({ payrollRuns: [{ ...oldRun, branchId: 2 }] as never }); reject(/فرع/)
 useRawDataStore.setState({ payrollRuns: [{ ...oldRun, date: '2026-11-06' }] as never }); reject(/تاريخ/)
})
it('يرفض تاريخياً دفع زيادة قبل نشوئها حتى لو بدا الإجمالي الحالي كافياً', () => {
 useRawDataStore.setState({ payrollRuns: [{ ...oldRun, date: '2026-10-30' }] as never }); reject(/تسلسل/)
})
it('يرفض مبالغ غير صالحة أو أكبر من أصل المصروف', () => {
 for (const excessMinor of [-1, NaN, undefined, 1001, Number.MAX_SAFE_INTEGER + 1]) { useRawDataStore.setState({ custodyTxs: [{ ...tx, excessMinor }] as never }); reject(/مبلغ/) }
})
it('يرفض مبلغ الصرف غير الآمن أو صرفاً سابقاً غير صالح أو مسيراً مكرراً', () => {
 expect(() => run(Number.MAX_SAFE_INTEGER + 1)).toThrow(/مبلغ/)
 useRawDataStore.setState({ payrollRuns: [{ ...oldRun, lines: [{ employeeId: 1, excessPaidMinor: -1 }] }] as never }); reject(/مبلغ/)
 useRawDataStore.setState({ payrollRuns: [oldRun, { ...oldRun, lines: [] }] as never }); reject(/فريد/)
})
it('يجمع زيادات اليوم قبل صرفه لعدم توفر ترتيب الساعة في السجلات القديمة', () => {
 useRawDataStore.setState({ payrollRuns: [{ ...oldRun, date: '2026-11-01' }] as never })
 expect(run(700).lines[0].excessPaidMinor).toBe(700)
})
it('يرفض صرفاً سابقاً يتجاوز المستحق وقتها ولو جاء مصروف آخر لاحقاً', () => {
 useRawDataStore.setState({ custodyTxs: [{ ...tx, amountMinor: 200, excessMinor: 200 }, { ...tx, id: 3, date: '2026-11-03' }] as never, payrollRuns: [oldRun] as never }); reject(/تسلسل/)
})
it('يرفض المبلغ الأكبر من المتبقي بعد المسيرات السابقة', () => { useRawDataStore.setState({ payrollRuns: [oldRun] as never }); expect(() => run(701)).toThrow(/أكبر من رصيده/); expect(S().journal).toHaveLength(0) })
