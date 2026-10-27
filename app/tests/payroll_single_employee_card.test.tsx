import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { EmployeesPage } = await import('../src/ui/pages/EmployeesPage.tsx')

const S = () => useDataStore.getState()

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار', ownerName: 'م', features: [], modules: ['employees' as never], accountingMode: 'full' } })
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 50000000, label: 'خزينة' })
  S().addEmployee({ nameAr: 'أحمد سالم', phone: '01000000001', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 10000, active: true, roleId: 'cashier', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  S().grantEmployeeAdvance({ employeeId: 1, amountMinor: 50000, treasury: '1101', notes: 'سلفة اختبار' })
  S().addEmployeeDeduction({ employeeId: 1, amountMinor: 20000, reason: 'تأخير', notes: '' })
  S().addLeaveRequest({ employeeId: 1, typeId: 'annual', from: '2026-01-05', to: '2026-01-07', reason: 'إجازة' })
  S().decideLeaveRequest(1, true, 'المالك')
})

afterEach(() => cleanup())

describe('بطاقة الموظف الواحد التفصيلية في مسير الرواتب', () => {
  it('تعرض البطاقة كاملة بعد اختيار الموظف بلا أخطاء، وتعرض السلف والجزاءات والإجازات', () => {
    const view = render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    fireEvent.click(view.getByText('مسير مجمّع لموظف (قديم)'))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const search = view.getByLabelText('بحث الموظف')
    fireEvent.change(search, { target: { value: 'أحمد' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(dialog.querySelector('[data-single-employee-card]')).toBeTruthy()
    expect(dialog.textContent).toContain('أحمد سالم')
    expect(dialog.textContent).toContain('سلف غير مسدَّدة')
    expect(dialog.textContent).toContain('خصومات غير مطبَّقة')
    expect(dialog.textContent).toContain('رصيد الإجازات وتسويته')
    expect(dialog.textContent).toContain('سنوية مدفوعة')
    expect(dialog.textContent).toContain('الحضور والغياب')
  })
})

describe('تطبيق تسوية الإجازة وترحيل المسير من بطاقة الموظف الواحد', () => {
  it('يطبّق صرف رصيد الإجازة نقداً على حقل المستحق ثم يرحّل المسير بنجاح', () => {
    const view = render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    fireEvent.click(view.getByText('مسير مجمّع لموظف (قديم)'))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const search = view.getByLabelText('بحث الموظف')
    fireEvent.change(search, { target: { value: 'أحمد' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    const dayInput = dialog.querySelector('[data-single-employee-card] input[type="number"]') as HTMLInputElement
    expect(dayInput).toBeTruthy()
    fireEvent.change(dayInput, { target: { value: '2' } })
    const applyBtn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('تطبيق التسوية على هذا المسير'))
    expect(applyBtn).toBeTruthy()
    fireEvent.click(applyBtn!)
    const excessInputs = Array.from(dialog.querySelectorAll('[data-single-employee-card] input')) as HTMLInputElement[]
    const excessField = excessInputs.find((i) => Number(i.value) > 0 && i.getAttribute('dir') === 'ltr')
    expect(excessField).toBeTruthy()
  })
})
