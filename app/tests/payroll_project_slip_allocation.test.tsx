import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
import { assertPayrollProjectHistoryPreserved } from '../src/core/payrollProjectHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
import { checkedPayrollProjectCosts } from '../src/core/payrollProjectCosts.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const project = (id: number) => ({ id, code: `PRJ-000${id}`, nameAr: `مشروع ${id}`, status: 'active', startDate: '2020-01-01', clientId: null, clientName: '', contractValueMinor: 1000, retentionPercent: 0, notes: '' })
const row = () => ({ employeeId: 1, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 })
const shares = [{ projectId: 1, basisPoints: 2500 }, { projectId: 2, basisPoints: 7500 }]
const wrap = (state: object) => JSON.stringify({ state })
beforeEach(() => {
  const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], projects: [project(1), project(2)] as never, projectCosts: [], payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], attendanceRecords: [], leaveRequests: [] })
  S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', baseSalaryMinor: 10000, active: true } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })

describe('حفظ إقرار توزيع قسيمة على مشاريع قائمة', () => {
  it('يحفظ النسب المعدلة ولقطات المشاريع مقابل قيد 5102 الأصلي دون تكلفة أو قيد إضافي', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    expect(slip.projectAllocation).toMatchObject({ version: 1, basis: 'payroll_5102_net_plus_advance', expenseMinor: 10000, journalEntryId: slip.accrualEntryId, projects: [{ ...shares[0], amountMinor: 2500, projectCode: 'PRJ-0001', projectName: 'مشروع 1' }, { ...shares[1], amountMinor: 7500, projectCode: 'PRJ-0002', projectName: 'مشروع 2' }] })
    expect(S().journal).toHaveLength(1); expect(S().journal[0].lines.find(line => line.accountCode === '5102')?.debit).toBe(10000)
    expect(S().projectCosts).toHaveLength(0)
    S().cancelPayrollSlip(slip.id, 'تصحيح'); expect(S().payrollSlips[0].projectAllocation).toEqual(slip.projectAllocation)
    expect(S().payrollSlips[0].status).toBe('cancelled'); expect(S().projectCosts).toHaveLength(0)
  })
  it('يرفض النسب غير الكاملة أو المكررة أو المشروع المغلق ويحفظ الحالة بلا تغير', () => {
    for (const invalid of [[{ projectId: 1, basisPoints: 5000 }], [{ projectId: 1, basisPoints: 5000 }, { projectId: 1, basisPoints: 5000 }], [{ projectId: 88, basisPoints: 10000 }], []]) {
      const before = S(); expect(() => S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: invalid }] })).toThrow()
      expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
    }
    useRawDataStore.setState({ projects: [{ ...project(1), status: 'completed' }] as never })
    expect(() => S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })).toThrow(/غير قائم/)
  })
  it.each(['on_hold', 'cancelled', 'finished'] as const)('يرفض التوزيع الجديد للمشروع المتوقف %s دون أثر', operationalStatus => {
    useRawDataStore.setState({ projects: [{ ...project(1), operationalStatus }] as never })
    const before = S()
    expect(() => S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })).toThrow(/المشروع/)
    expect(S().journal).toBe(before.journal)
    expect(S().payrollSlips).toBe(before.payrollSlips)
  })
  it('يدخل السلفة المستقطعة في 5102 ولا يُكررها بعد توزيع القسيمة', () => {
    S().grantEmployeeAdvance({ employeeId: 1, amountMinor: 2000, treasury: '1101', notes: '' })
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), deductionsMinor: 1000, advanceMinor: 2000, projectPercentages: shares }] })
    expect(slip.netMinor).toBe(7000)
    expect(slip.projectAllocation?.expenseMinor).toBe(9000)
    expect(slip.projectAllocation?.projects.map(project => project.amountMinor)).toEqual([2250, 6750])
    expect(S().journal.find(entry => entry.id === slip.accrualEntryId)?.lines.find(line => line.accountCode === '5102')?.debit).toBe(9000)
  })
  it('يرفض مشروع فرع آخر أو بداية لاحقة لشهر الراتب', () => {
    const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
    useRawDataStore.setState({ branches, activeBranchId: 1, employees: S().employees.map(employee => ({ ...employee, branchId: 1 })), projects: [{ ...project(1), branchId: 2 }] as never })
    expect(() => S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })).toThrow(/الفرع/)
    useRawDataStore.setState({ branches: [], activeBranchId: null, projects: [{ ...project(1), startDate: todayLocalIso() }] as never })
    expect(() => S().accruePayrollSlips({ month: '2020-01', rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })).toThrow(/بدايته/)
  })
  it('يعرض تنبيهاً بدلاً من انهيار الشاشة عند تلف لقطة التوزيع', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    useRawDataStore.setState({ payrollSlips: [{ ...slip, projectAllocation: { ...slip.projectAllocation!, projects: null } }] } as never)
    render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    expect(document.querySelector('[data-slip-project-snapshot="1"]')?.textContent).toContain('لقطة التوزيع غير صالحة')
  })
  it('لا يختلق توزيعاً عند عدم اختيار مشاريع', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [row()] })
    expect(slip.projectAllocation).toBeUndefined()
  })
})

describe('حفظ دليل التوزيع في اللقطات', () => {
  it('يمنع إسقاط التوزيع أو تغيير أساس القسيمة أو اختلاق توزيع لقسيمة قديمة', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    const current = { payrollSlips: [slip] }
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: [{ ...slip, projectAllocation: undefined }] })).toThrow(/توزيع الرواتب/)
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: [{ ...slip, netMinor: 1 }] })).toThrow(/أساس قسيمة/)
    const legacy = { payrollSlips: [{ ...slip, projectAllocation: undefined }] }
    expect(() => assertPayrollProjectHistoryPreserved(legacy, current)).toThrow(/توزيع الرواتب/)
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: [{ ...slip, status: 'cancelled' }] })).not.toThrow()
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: [] })).toThrow()
  })
  it('يرفض دمج تعديل المشاريع مع مسير متزامن في الاتجاهين', () => {
    const base = { payrollSlips: [], payrollRuns: [], projects: [project(1)] }
    const one = { ...base, payrollSlips: [{ id: 1 }] }, other = { ...base, projects: [project(2)] }
    expect(() => mergeConcurrentSnapshots(wrap(base), wrap(one), wrap(other))).toThrow(/تعارض مسير/)
    expect(() => mergeConcurrentSnapshots(wrap(base), wrap(other), wrap(one))).toThrow(/تعارض مسير/)
  })
})

it('يعرض اقتراح النسب وتعديلها ويحفظها مع القسيمة بعد تأكيد الحضور', async () => {
  render(<MemoryRouter><EmployeesPage initialTab="payroll" /><ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /استحقاق قسائم/ }))
  fireEvent.click(screen.getByLabelText('مشاركة موظف في مشروع 1'))
  expect((screen.getByLabelText('نسبة موظف في مشروع 1') as HTMLInputElement).value).toBe('100')
  fireEvent.click(screen.getByLabelText('مشاركة موظف في مشروع 2'))
  expect((screen.getByLabelText('نسبة موظف في مشروع 1') as HTMLInputElement).value).toBe('50')
  fireEvent.change(screen.getByLabelText('نسبة موظف في مشروع 1'), { target: { value: '25' } })
  expect(document.querySelector('[data-slip-project-error="1"]')?.textContent).toContain('100٪')
  fireEvent.change(screen.getByLabelText('نسبة موظف في مشروع 2'), { target: { value: '75' } })
  expect(document.querySelector('[data-slip-project-preview="1"]')?.textContent).toContain('مشروع 1')
  fireEvent.click(screen.getByRole('button', { name: /ترحيل المسير —/ }))
  const warning = screen.getByText(/ليس لديهم أي سجل حضور/).closest('[role="dialog"]') as HTMLElement
  fireEvent.click(within(warning).getByRole('button', { name: /الترحيل رغم ذلك/ }))
  await waitFor(() => expect(S().payrollSlips).toHaveLength(1))
  expect(S().payrollSlips[0].projectAllocation?.projects.map(project => project.basisPoints)).toEqual([2500, 7500])
  expect(document.querySelector('[data-slip-project-snapshot="1"]')?.textContent).toContain('25٪')
  expect(document.querySelector('[data-slip-project-snapshot="1"]')?.textContent).toContain('يدخل ربحية المشروع بعد التحقق')
})

describe('فحص أساس تكلفة المشروع في قسائم الراتب', () => {
  const read = (projectId = 1) => checkedPayrollProjectCosts({ projectId, asOf: todayLocalIso(), slips: S().payrollSlips, visibleSlips: S().payrollSlips, journal: S().journal, visibleJournal: S().journal, payrollRuns: S().payrollRuns, projectCosts: S().projectCosts })
  it('يقرأ توزيع القيد الأصلي ثم يستبعد القسيمة فقط بعد إثبات قيد الإلغاء', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    expect(read()).toMatchObject([{ slipId: slip.id, amountMinor: 2500, journalEntryId: slip.accrualEntryId }])
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    expect(S().payrollSlips[0].cancellationEntryId).toBe(S().journal[1].id)
    expect(read()).toEqual([])
    useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(s => ({ ...s, cancellationEntryId: undefined })) })
    expect(() => read()).toThrow(/مراجعة توزيع رواتب/)
  })
  it('يرفض قيداً غير مطابق أو مكرراً أو مخفياً أو مرتبطاً بتكلفة مشروع أخرى', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    const state = S(), base = { projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal, payrollRuns: state.payrollRuns, projectCosts: state.projectCosts }
    expect(() => checkedPayrollProjectCosts({ ...base, journal: [{ ...state.journal[0], lines: state.journal[0].lines.map(line => line.accountCode === '5102' ? { ...line, debit: 9999 } : line) }] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, journal: [state.journal[0], state.journal[0]] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, visibleJournal: [] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, projectCosts: [{ journalEntryId: slip.accrualEntryId }] })).toThrow(/مراجعة/)
  })
  it('يرفض لقطة تالفة أو عكساً إضافياً يتيماً ولو بقي مجموع اللقطة سليماً', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    const state = S(), entry = state.journal[0]
    const base = { projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal, payrollRuns: state.payrollRuns, projectCosts: state.projectCosts }
    const bad = { ...slip, projectAllocation: { ...slip.projectAllocation!, expenseMinor: 1 } }
    expect(() => checkedPayrollProjectCosts({ ...base, slips: [bad], visibleSlips: [bad] })).toThrow(/مراجعة/)
    const orphan = { ...entry, id: 99, entryNumber: 99, lines: [{ accountCode: '5102', debit: 0, credit: 10 }, { accountCode: '2104', debit: 10, credit: 0 }] }
    expect(() => checkedPayrollProjectCosts({ ...base, journal: [...base.journal, orphan] })).toThrow(/مراجعة/)
  })
})

describe('أدلة الإلغاء في سجل توزيع الرواتب', () => {
  it('يحمي مرجع الإلغاء وحالة القسيمة من التراجع في نسخة واردة', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    const cancelled = S().payrollSlips[0], before = { payrollSlips: [cancelled] }
    expect(() => assertPayrollProjectHistoryPreserved(before, { payrollSlips: [{ ...cancelled, cancellationEntryId: undefined }] })).toThrow(/مرجع إلغاء/)
    expect(() => assertPayrollProjectHistoryPreserved(before, { payrollSlips: [{ ...cancelled, cancellationEntryId: 999 }] })).toThrow(/مرجع إلغاء/)
    expect(() => assertPayrollProjectHistoryPreserved(before, { payrollSlips: [{ ...cancelled, status: 'accrued' }] })).toThrow(/ملغاة/)
    expect(() => assertPayrollProjectHistoryPreserved(before, before)).not.toThrow()
  })
  it('يرفض قيد إلغاء معدل أو متكرر أو مخفياً أو منفصلاً عن القسيمة', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    const state = S(), cancel = state.journal.find(entry => entry.id === state.payrollSlips[0].cancellationEntryId)!
    const base = { projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal, payrollRuns: state.payrollRuns, projectCosts: state.projectCosts }
    expect(() => checkedPayrollProjectCosts({ ...base, journal: state.journal.map(entry => entry.id === cancel.id ? { ...cancel, lines: cancel.lines.map(line => line.accountCode === '5102' ? { ...line, credit: 1 } : line) } : entry) })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, journal: [...state.journal, cancel] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, visibleJournal: state.journal.filter(entry => entry.id !== cancel.id) })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, slips: [{ ...state.payrollSlips[0], status: 'accrued' }], visibleSlips: [{ ...state.payrollSlips[0], status: 'accrued' }] })).toThrow(/مراجعة/)
  })
  it('يرفض تكرار الموظف والشهر عبر قسيمة أخرى أو المسير المجمّع ولو كان سجل الإلغاء غير مثبت', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    const state = S(), base = { projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal, payrollRuns: state.payrollRuns, projectCosts: state.projectCosts }
    expect(() => checkedPayrollProjectCosts({ ...base, slips: [...base.slips, { ...slip, id: 999, runId: 999, status: 'cancelled', projectAllocation: undefined }] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, payrollRuns: [{ id: 999, month: slip.month, lines: [{ employeeId: slip.employeeId }] }] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, payrollRuns: [{ id: 999, month: slip.month }] })).toThrow(/مراجعة/)
    expect(checkedPayrollProjectCosts({ ...base, payrollRuns: [{ id: 999, month: slip.month, lines: [{ employeeId: 42 }] }] })).toHaveLength(1)
  })
  it('يرفض تاريخاً سابقاً للقيد وأدلة مجموعة قسائم مخفية أو متكررة', () => {
    S().addEmployee({ nameAr: 'موظف آخر', phone: '', roleId: 'cashier', baseSalaryMinor: 5000, active: true } as never)
    S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }, { ...row(), employeeId: 2, grossMinor: 5000 }] })
    const state = S(), base = { projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal, payrollRuns: state.payrollRuns, projectCosts: state.projectCosts }
    expect(() => checkedPayrollProjectCosts({ ...base, asOf: '2000-01-01' })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, visibleSlips: [state.payrollSlips[0]] })).toThrow(/مراجعة/)
    expect(() => checkedPayrollProjectCosts({ ...base, slips: [...state.payrollSlips, state.payrollSlips[1]] })).toThrow(/مراجعة/)
  })
})

describe('قراءة توزيع الرواتب من مستودع المشاريع', () => {
  it('يضيف 5102 إلى الربحية دون مستند تكلفة أو قيد إضافي، ثم يستبعد الملغى', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    expect(S().getProjectPayrollCosts(1)).toMatchObject([{ slipId: slip.id, amountMinor: 2500 }])
    expect(S().getProjectProfit(1)).toMatchObject({ costsMinor: 2500, profitMinor: -2500, costsByKind: { labor: 2500 } })
    expect(S().getProjectProfit(2)).toMatchObject({ costsMinor: 7500, profitMinor: -7500 })
    expect(S().projectCosts).toHaveLength(0); expect(S().journal).toHaveLength(1)
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    expect(S().getProjectProfit(1).costsMinor).toBe(0)
  })
  it('يتوقف بدلاً من عرض ربحية ناقصة عند تلف القيد أو فقد مرجع الإلغاء', () => {
    const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
    const initial = S().journal
    useRawDataStore.setState({ journal: initial.map(entry => ({ ...entry, lines: entry.lines.map(line => line.accountCode === '5102' ? { ...line, debit: 1 } : line) })) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
    useRawDataStore.setState({ journal: initial })
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(row => ({ ...row, cancellationEntryId: undefined })) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
  })
  it('يرفض إخفاء قسيمة خصصت المشروع أو تغيير الفرع ويدع الفرع الآخر منفصلاً', () => {
    const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
    useRawDataStore.setState({ branches, activeBranchId: 1, employees: S().employees.map(employee => ({ ...employee, branchId: 1 })), projects: [{ ...project(1), branchId: 1 }, { ...project(2), branchId: 2 }] as never })
    S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })
    expect(S().getProjectProfit(1).costsMinor).toBe(10000)
    const slips = S().payrollSlips
    useRawDataStore.setState({ payrollSlips: slips.map(slip => ({ ...slip, branchId: 2 })) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
    useRawDataStore.setState({ payrollSlips: slips, activeBranchId: 2 })
    expect(S().getProjectProfit(2).costsMinor).toBe(0)
    expect(() => S().getProjectPayrollCosts(1)).toThrow(/مراجعة/)
  })
})

it('يحسب المجموعة مع إلغاء قسيمة واحدة فقط ويمنع عكساً يتيمًا للقيد الأصلي', () => {
  S().addEmployee({ nameAr: 'موظف آخر', phone: '', roleId: 'cashier', baseSalaryMinor: 5000, active: true } as never)
  const slips = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }, { ...row(), employeeId: 2, grossMinor: 5000, projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })
  expect(S().getProjectProfit(1).costsMinor).toBe(15000)
  S().cancelPayrollSlip(slips[0].id, 'تصحيح')
  expect(S().getProjectProfit(1).costsMinor).toBe(5000)
  const entry = S().journal[0]
  useRawDataStore.setState({ journal: [...S().journal, { ...entry, id: 999, entryNumber: 999, sourceType: 'reversal', reversesEntryId: entry.id }] })
  expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
})

it('يرفض تضارب مبلغ تكلفة المشروع مع بنودها وتجاوز المجاميع الآمنة', () => {
  const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
  useRawDataStore.setState({ projectCosts: [{ id: 10, projectId: 1, kind: 'labor', amountMinor: 100, date: todayLocalIso(), description: '', payment: 'cash', journalEntryId: 888, lines: [{ kind: 'labor', netMinor: 99 }] }] as never })
  expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectCosts: [{ id: 10, projectId: 1, kind: 'labor', amountMinor: Number.MAX_SAFE_INTEGER, date: todayLocalIso(), description: '', payment: 'cash', journalEntryId: 888 }] as never })
  expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
  expect(slip.projectAllocation?.expenseMinor).toBe(10000)
})

it('يمنع حذف المشروع المرتبط بتوزيع محفوظ ولو ألغيت القسيمة', async () => {
  useRawDataStore.setState({ ownerPinHash: 'dd963634ae8f2839313302f03077c41b6de321c73056d69b1f34334c193c425e' })
  const [slip] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
  await expect(S().deleteUnpostedProject(1, 'سبب', undefined, '123456')).rejects.toThrow(/مرتبط/)
  S().cancelPayrollSlip(slip.id, 'تصحيح')
  await expect(S().deleteUnpostedProject(1, 'سبب', undefined, '123456')).rejects.toThrow(/مرتبط/)
  expect(S().projects).toHaveLength(2)
})

describe('إصدار قسيمة بديلة بعد إلغاء مثبت', () => {
  const month = () => todayLocalIso().slice(0, 7)
  const accrue = (extra = {}) => S().accruePayrollSlips({ month: month(), rows: [{ ...row(), ...extra }] })[0]

  it('يتحقق من كل المجموعات ويحتسب البديلة فقط حتى مع إلغاء متكرر وتغيير المشاريع', () => {
    S().addEmployee({ nameAr: 'زميل', phone: '', roleId: 'cashier', baseSalaryMinor: 5000, active: true } as never)
    const [first] = S().accruePayrollSlips({ month: month(), rows: [{ ...row(), projectPercentages: shares }, { ...row(), employeeId: 2, grossMinor: 5000, projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })
    S().cancelPayrollSlip(first.id, 'تعديل')
    const second = accrue({ grossMinor: 8000, projectPercentages: [{ projectId: 2, basisPoints: 10000 }] })
    expect(S().getProjectProfit(1).costsMinor).toBe(5000)
    expect(S().getProjectProfit(2).costsMinor).toBe(8000)
    expect(S().getProjectBudgetVariance(1).totalActualMinor).toBe(5000)
    expect(S().getProjectEvm(2).actualCostMinor).toBe(8000)
    S().cancelPayrollSlip(second.id, 'تعديل آخر')
    const third = accrue({ grossMinor: 6000, projectPercentages: [{ projectId: 1, basisPoints: 10000 }] })
    expect(S().getProjectPayrollCosts(1).map(r => [r.slipId, r.amountMinor])).toEqual([[first.id + 1, 5000], [third.id, 6000]])
    expect(S().getProjectProfit(1).costsMinor).toBe(11000)
    expect(S().getProjectProfit(2).costsMinor).toBe(0)
    expect(S().projectCosts).toHaveLength(0)
    expect(S().journal).toHaveLength(5)
  })

  it.each([true, false])('يرفض إنشاء بديل عند فساد دليل الإلغاء سواء كان السابق موزعاً %s أم لا دون أي كتابة', (allocated) => {
    const first = accrue(allocated ? { projectPercentages: shares } : {})
    S().cancelPayrollSlip(first.id, 'تصحيح')
    useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(slip => ({ ...slip, cancellationEntryId: undefined })) })
    const before = S()
    expect(() => accrue({ projectPercentages: shares })).toThrow(/مراجعة/)
    expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
    expect(S().employeeAdvances).toBe(before.employeeAdvances); expect(S().employeeDeductions).toBe(before.employeeDeductions)
  })

  it('يحمي القسيمة القديمة غير الموزعة التي أصبحت دليلاً لبديلة موزعة في الاستعادة', () => {
    const first = accrue()
    S().cancelPayrollSlip(first.id, 'تصحيح')
    const beforeReplacement = { payrollSlips: [...S().payrollSlips] }
    const second = accrue({ projectPercentages: shares })
    const current = { payrollSlips: [...S().payrollSlips] }
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: [second] })).toThrow(/سقطت/)
    expect(() => assertPayrollProjectHistoryPreserved(current, { payrollSlips: current.payrollSlips.map(slip => slip.id === first.id ? { ...slip, cancellationEntryId: undefined } : slip) })).toThrow(/مرجع إلغاء/)
    expect(() => assertPayrollProjectHistoryPreserved(beforeReplacement, { payrollSlips: [{ ...beforeReplacement.payrollSlips[0], netMinor: 1 }, second] })).toThrow(/أساس قسيمة/)
    expect(() => assertPayrollProjectHistoryPreserved(current, current)).not.toThrow()
  })

  it('يوقف التقرير إذا تغير إلغاء سابق أو اختفى أو أُضيف استحقاق غير ملغى أو تعكس ترتيب القيد', () => {
    const first = accrue({ projectPercentages: shares })
    S().cancelPayrollSlip(first.id, 'تصحيح')
    const second = accrue({ projectPercentages: shares })
    const state = S(), slips = state.payrollSlips, journal = state.journal
    useRawDataStore.setState({ journal: journal.filter(j => j.id !== slips[0].cancellationEntryId) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
    useRawDataStore.setState({ journal, payrollSlips: slips.map(s => s.id === first.id ? { ...s, status: 'accrued' as const, cancellationEntryId: undefined } : s) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
    useRawDataStore.setState({ payrollSlips: slips, journal: journal.map(j => j.id === second.accrualEntryId ? { ...j, date: '2000-01-01' } : j) })
    expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
  })

  it('لا يتجاوز دليلاً مخفياً في فرع آخر عند استبدال قسيمة', () => {
    const first = accrue({ projectPercentages: shares })
    S().cancelPayrollSlip(first.id, 'تصحيح')
    const state = S()
    expect(() => checkedPayrollProjectCosts({ projectId: 1, asOf: todayLocalIso(), slips: state.payrollSlips, visibleSlips: state.payrollSlips, journal: state.journal, visibleJournal: state.journal.filter(e => e.id !== state.payrollSlips[0].cancellationEntryId), payrollRuns: state.payrollRuns, projectCosts: state.projectCosts })).toThrow(/مراجعة/)
  })
})

it('يمنع المسير المجمّع كبديل لقسيمة موزعة ملغاة إلى أن يُدعم مساره في تقارير المشاريع', () => {
  const [first] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: shares }] })
  S().cancelPayrollSlip(first.id, 'تصحيح')
  const before = S()
  expect(() => S().postPayroll({ month: todayLocalIso().slice(0, 7), payMode: 'cash', treasury: '1101', notes: '', lines: [{ employeeId: 1, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })).toThrow(/المسير المجمّع غير مدعومة/)
  expect(S().journal).toBe(before.journal); expect(S().payrollRuns).toBe(before.payrollRuns)
})

it('يرفض إعادة إصدار سابقها مخفي في فرع آخر ولا يمس البيانات', () => {
  const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
  useRawDataStore.setState({ branches, activeBranchId: 1, employees: S().employees.map(employee => ({ ...employee, branchId: 1 })), projects: [{ ...project(1), branchId: 1 }] as never })
  const [first] = S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })
  S().cancelPayrollSlip(first.id, 'تصحيح')
  useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(slip => ({ ...slip, branchId: 2 })) })
  const before = S()
  expect(() => S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ ...row(), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })).toThrow(/مراجعة/)
  expect(S().journal).toBe(before.journal); expect(S().payrollSlips).toBe(before.payrollSlips)
})

it('يرفض بقاء دليل الاستحقاق والإلغاء صحيحين شكلياً إذا سبق استحقاق البديل إلغاء السابق', () => {
  const month = todayLocalIso().slice(0, 7)
  const [first] = S().accruePayrollSlips({ month, rows: [{ ...row(), projectPercentages: shares }] })
  S().cancelPayrollSlip(first.id, 'تصحيح')
  const [second] = S().accruePayrollSlips({ month, rows: [{ ...row(), projectPercentages: shares }] })
  const oldCancel = S().payrollSlips[0].cancellationEntryId!, newEntry = second.accrualEntryId
  useRawDataStore.setState({
    journal: S().journal.map(entry => entry.id === oldCancel ? { ...entry, id: newEntry } : entry.id === newEntry ? { ...entry, id: oldCancel } : entry),
    payrollSlips: S().payrollSlips.map(slip => slip.id === first.id ? { ...slip, cancellationEntryId: newEntry } : slip.id === second.id ? { ...slip, accrualEntryId: oldCancel, projectAllocation: { ...slip.projectAllocation!, journalEntryId: oldCancel } } : slip),
  })
  expect(() => S().getProjectProfit(1)).toThrow(/مراجعة/)
})
