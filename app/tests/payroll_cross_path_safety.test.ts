import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computePayrollLine, computePayrollTotals } from '../src/core/payroll.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { DesktopStateStorage, mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const monthly = (employeeId = 1) => ({ employeeId, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })
const slipRow = (employeeId = 1) => ({ employeeId, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 })
const run = (employeeId = 1, month = '2026-11') => S().postPayroll({ month, payMode: 'cash', treasury: '1101', notes: '', lines: [monthly(employeeId)] })
const accrue = (employeeId = 1, month = '2026-11') => S().accruePayrollSlips({ month, rows: [slipRow(employeeId)] })
const wrap = (state: object) => JSON.stringify({ state })
const empty = { employees: [{ id: 1 }], payrollRuns: [], payrollSlips: [], journal: [] }
const aggregated = { ...empty, payrollRuns: [{ id: 1, month: '2026-11', lines: [{ employeeId: 1 }] }] }
const individual = { ...empty, payrollSlips: [{ id: 1, month: '2026-11', employeeId: 1, status: 'accrued' }] }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف أول', active: true }, { id: 2, nameAr: 'موظف ثان', active: true }] as never, payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], employeeDeductions: [], advanceRepayments: [], staffCommissions: [], driverDues: [], custodyFiles: [], custodyTxs: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })

describe('عدم تكرار الراتب عبر المسير المجمّع والقسائم', () => {
  it('يرفض قسيمة بعد مسير الموظف نفسه ويحافظ على القيد والدفتر المساعد', () => {
    run(); const before = S()
    expect(() => accrue()).toThrow(/مسير مجمّع/)
    expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips); expect(S().payrollRuns).toBe(before.payrollRuns)
  })
  it('يرفض المسير بعد قسيمة مستحقة أو مصروفة للموظف والشهر نفسيهما', () => {
    const [slip] = accrue(); let before = S()
    expect(() => run()).toThrow(/مرحّل بالفعل/); expect(S().journal).toBe(before.journal)
    S().payPayrollSlip(slip.id, { treasury: '1101' }); before = S()
    expect(() => run()).toThrow(/مرحّل بالفعل/); expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns)
  })
  it('يسمح بموظف آخر أو شهر آخر، وقسيمة ألغيت فعلاً', () => {
    const [slip] = accrue(); run(2); run(1, '2026-10')
    S().cancelPayrollSlip(slip.id, 'إلغاء الاستحقاق')
    expect(() => run()).not.toThrow()
  })
  it('لا يسمح بمسير مجمّع بعد إلغاء غير مثبت ولا يكتب شيئاً', () => {
    const [slip] = accrue(); S().cancelPayrollSlip(slip.id, 'تصحيح')
    useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(row => ({ ...row, cancellationEntryId: undefined })) })
    const before = S()
    expect(() => run()).toThrow(/مراجعة/)
    expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns)
  })
  it('لا يحذف الموظف المرتبط بقسيمة حتى بعد إلغائها', () => {
    const [slip] = accrue(); S().cancelPayrollSlip(slip.id, 'تصحيح')
    expect(() => S().removeEmployee(1)).toThrow(/قسائم رواتب/)
    expect(S().employees.map(e => e.id)).toContain(1)
  })
  it('يمنع راتب الموظف في الفرع القديم بعد نقله لفرع آخر', () => {
    run(); useRawDataStore.setState({ payrollRuns: S().payrollRuns.map(row => ({ ...row, branchId: 2 })) } as never)
    const before = S(); expect(() => accrue()).toThrow(/مسير مجمّع/); expect(S().journal).toBe(before.journal)
  })
  it('لا يخمّن محتوى مسير تالف في الشهر عند ترحيل قسيمة أو مسير', () => {
    useRawDataStore.setState({ payrollRuns: [{ id: 1, month: '2026-11', lines: null }] } as never)
    const before = S(); expect(() => accrue()).toThrow(/غير صالح/); expect(() => run()).toThrow(/غير صالح/); expect(S().journal).toBe(before.journal)
  })
})

describe('مبالغ المسير المجمّع', () => {
  it('يرفض قيماً فردية ومجاميع غير آمنة قبل توليد قيد', () => {
    expect(() => computePayrollLine({ ...monthly(), baseMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/آمناً/)
    expect(() => computePayrollLine({ ...monthly(), baseMinor: Number.MAX_SAFE_INTEGER, allowancesMinor: 1 })).toThrow(/الحدود الآمنة/)
    const before = S()
    expect(() => S().postPayroll({ month: '2026-11', payMode: 'cash', treasury: '1101', notes: '', lines: [{ ...monthly(1), baseMinor: Number.MAX_SAFE_INTEGER }, monthly(2)] })).toThrow(/الحدود الآمنة/)
    expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns)
  })
  it('يقبل جمعاً آمناً ولا يغيّر تعريف صافي الراتب', () => {
    const line = computePayrollLine({ ...monthly(), deductionsMinor: 400, advancesMinor: 300 })
    expect(line.netMinor).toBe(9300); expect(computePayrollTotals([line])).toMatchObject({ grossMinor: 10000, deductionsMinor: 700, netMinor: 9300 })
  })
})

describe('تعارض أسس المسير أثناء دمج اللقطات', () => {
  it('يرفض المسير والقسيمة المتزامنين في الاتجاهين', () => {
    expect(() => mergeConcurrentSnapshots(wrap(empty), wrap(aggregated), wrap(individual))).toThrow(/تعارض مسير/)
    expect(() => mergeConcurrentSnapshots(wrap(empty), wrap(individual), wrap(aggregated))).toThrow(/تعارض مسير/)
  })
  it.each(['employeeAdvances', 'employeeDeductions', 'journal', 'employees', 'roleOverrides', 'branches', 'payrollSlips', 'projectCosts'])('يرفض تغيير أساس %s مع المسير', key => {
    const other = { ...empty, [key]: key === 'roleOverrides' ? { cashier: [] } : [{ id: 2 }] }
    expect(() => mergeConcurrentSnapshots(wrap(empty), wrap(aggregated), wrap(other))).toThrow(/تعارض مسير/)
    expect(() => mergeConcurrentSnapshots(wrap(empty), wrap(other), wrap(aggregated))).toThrow(/تعارض مسير/)
  })
  it('يسمح بتغيير غير متعلق بالأساس وباللقطة المطابقة', () => {
    const other = { ...empty, userPrefs: { owner: { theme: 'dark' } } }
    expect(JSON.parse(mergeConcurrentSnapshots(wrap(empty), wrap(aggregated), wrap(other))).state).toMatchObject({ payrollRuns: aggregated.payrollRuns, userPrefs: other.userPrefs })
    expect(JSON.parse(mergeConcurrentSnapshots(wrap(empty), wrap(aggregated), wrap(aggregated))).state).toEqual(aggregated)
  })
  it('يرفض تعارض كاتبين في ملف SQLite حقيقي ويبقي اللقطة المثبتة', async () => {
    vi.useRealTimers()
    const dir = mkdtempSync(join(tmpdir(), 'shopsys-payroll-conflict-')), path = join(dir, 'db.sqlite')
    let db = await ShopsysDatabase.open(path)
    const bridge: DesktopDatabaseBridge = {
      getSnapshot: async name => db.getSnapshot(name), saveSnapshot: async input => db.saveSnapshot(input), deleteSnapshot: async input => db.deleteSnapshot(input),
      enqueueOutbox: async () => ({ created: true }), claimOutbox: async () => [], completeOutbox: async () => ({ updated: true }), integrityCheck: async () => ({ ok: true, message: 'ok' }), schemaVersion: async () => 1,
    }
    try {
      const first = new DesktopStateStorage(bridge, null), second = new DesktopStateStorage(bridge, null)
      await first.setItem('shopsys-data', wrap(empty)); await second.getItem('shopsys-data')
      await first.setItem('shopsys-data', wrap(aggregated))
      await expect(second.setItem('shopsys-data', wrap(individual))).rejects.toThrow(/تعارض مسير/)
      expect(db.getSnapshot('shopsys-data').payloadJson).toBe(wrap(aggregated))
      await second.getItem('shopsys-data')
      db.close(); db = await ShopsysDatabase.open(path)
      expect(db.getSnapshot('shopsys-data').payloadJson).toBe(wrap(aggregated))
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
