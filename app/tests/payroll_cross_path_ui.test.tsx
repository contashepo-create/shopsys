import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const month = () => todayLocalIso().slice(0, 7)
const line = (employeeId: number) => ({ employeeId, baseMinor: 30000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })
const slipRow = (employeeId: number) => ({ employeeId, grossMinor: 30000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 })
beforeEach(() => {
  const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], attendanceRecords: [], leaveRequests: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addEmployee({ nameAr: 'أحمد', phone: '', roleId: 'cashier', baseSalaryMinor: 30000, active: true } as never)
  S().addEmployee({ nameAr: 'سعاد', phone: '', roleId: 'cashier', baseSalaryMinor: 40000, active: true } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
const open = () => render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)

describe('تنبيه مساري الرواتب داخل الفرع الظاهر', () => {
  it('يبيّن المسير السابق في القسائم ويمنع الترحيل مع حفظ التعديلات وإمكانية استبعاده', () => {
    S().postPayroll({ month: month(), payMode: 'cash', treasury: '1101', notes: '', lines: [line(1)] })
    open(); fireEvent.click(screen.getByRole('button', { name: /استحقاق قسائم/ }))
    expect(document.querySelector('[data-slip-duplicate="1"]')).toBeTruthy()
    const button = screen.getByRole('button', { name: /ترحيل المسير —/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('gross سعاد'), { target: { value: '123' } })
    fireEvent.click(screen.getByLabelText('اختيار أحمد'))
    expect(button.disabled).toBe(false); expect((screen.getByLabelText('gross سعاد') as HTMLInputElement).value).toBe('123')
    fireEvent.click(screen.getByLabelText('اختيار أحمد'))
    fireEvent.change(screen.getByLabelText('شهر المسير'), { target: { value: '2020-01' } })
    expect(button.disabled).toBe(false); expect((screen.getByLabelText('gross سعاد') as HTMLInputElement).value).toBe('123')
    fireEvent.change(screen.getByLabelText('شهر المسير'), { target: { value: month() } })
    expect(button.disabled).toBe(true)
  })
  it('يستبعد القسيمة غير الملغاة من المسير المجمّع ويتيح الملغاة', () => {
    const [slip] = S().accruePayrollSlips({ month: month(), rows: [slipRow(1)] })
    open(); fireEvent.click(screen.getByText('مسير مجمّع للجميع (قديم)'))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).not.toContain('أحمد'); expect(dialog.textContent).toContain('سعاد')
    fireEvent.click(screen.getByRole('button', { name: /إلغاء/ }))
    act(() => { S().cancelPayrollSlip(slip.id, 'تصحيح') })
    fireEvent.click(screen.getByText('مسير مجمّع للجميع (قديم)'))
    expect((document.querySelector('[role="dialog"]') as HTMLElement).textContent).toContain('أحمد')
  })
  it('يستبعد القسيمة الموزعة الملغاة من المسير المجمّع مع شرح البديل، دون منع القسائم', () => {
    useRawDataStore.setState({ projects: [{ id: 1, code: 'PRJ-1', nameAr: 'مشروع', status: 'active', startDate: '2020-01-01', contractValueMinor: 1000 }] as never })
    const [slip] = S().accruePayrollSlips({ month: month(), rows: [{ ...slipRow(1), projectPercentages: [{ projectId: 1, basisPoints: 10000 }] }] })
    S().cancelPayrollSlip(slip.id, 'تصحيح')
    open(); fireEvent.click(screen.getByText('مسير مجمّع للجميع (قديم)'))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).not.toContain('أحمد'); expect(dialog.textContent).toContain('سعاد')
    expect(dialog.textContent).toContain('استخدم قسيمة بديلة')
    fireEvent.click(screen.getByRole('button', { name: /إلغاء/ }))
    fireEvent.click(screen.getByRole('button', { name: /استحقاق قسائم/ }))
    expect(document.querySelector('[data-slip-duplicate="1"]')).toBeNull()
  })
  it('يتحدث التحذير إذا تغيرت القسيمة بينما النافذة مفتوحة', () => {
    const [slip] = S().accruePayrollSlips({ month: month(), rows: [slipRow(1)] })
    open(); fireEvent.click(screen.getByRole('button', { name: /استحقاق قسائم/ }))
    expect(document.querySelector('[data-slip-duplicate="1"]')).toBeTruthy()
    act(() => { S().cancelPayrollSlip(slip.id, 'تصحيح') })
    expect(document.querySelector('[data-slip-duplicate="1"]')).toBeNull()
    expect((screen.getByRole('button', { name: /ترحيل المسير —/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
