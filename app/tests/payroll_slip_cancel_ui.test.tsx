import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

/**
 * إلغاء قسيمة راتب لم تُصرف — `cancelPayrollSlip` كان مكتوباً ومحروساً في النواة
 * (يرفض المصروفة/الجزئية/الملغاة ويطلب سبباً) وبلا أي زر في شاشة الموظفين،
 * فتبقى القسيمة الخاطئة معلّقة على 2104 ولا سبيل لتصحيحها من الواجهة.
 * الاختبار يثبت: ظهور زر الإلغاء للمستحقة غير المصروفة فقط، وترحيل قيد عكسي
 * يُدين 2104 ويعكس 5102، مع منع التنفيذ بلا سبب.
 */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const employee = { id: 1, nameAr: 'سالم العتيبي', name: 'سالم العتيبي', type: 'employee' as const, active: true }

const slip = (overrides: Record<string, unknown> = {}) => ({
  id: 1, runId: 1, slipNumber: 'PS-2026-0001', employeeId: 1, employeeName: 'سالم العتيبي',
  month: '2026-10', netMinor: 400_000, advanceMinor: 0, deductionsMinor: 0, grossMinor: 400_000,
  status: 'accrued' as const, payments: [], recoveredAdvances: [], recoveredDeductions: [],
  notes: '', accruedAt: '2026-10-31T10:00:00+03:00', createdAt: '2026-10-31T10:00:00+03:00',
  ...overrides,
})

beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'SA' as const, activityId: 'general' as const, vatPercent: 0, allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [employee] as never,
    payrollRuns: [], payrollSlips: [slip()] as never, employeeAdvances: [], advanceRepayments: [], employeeDeductions: [],
    attendanceRecords: [], leaveRequests: [], vouchers: [], treasuries: [], journal: [],
  })
  useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })

it('يلغي قسيمة مستحقة بقيد عكسي متوازن بعد كتابة السبب', async () => {
  render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)

  const cancel = document.querySelector('[data-cancel-slip]') as HTMLButtonElement
  fireEvent.click(cancel)

  const reason = document.querySelector('[data-cancel-slip-modal] input') as HTMLInputElement
  const post = document.querySelector('[data-cancel-slip-post]') as HTMLButtonElement
  expect(post.disabled).toBe(true)

  fireEvent.change(reason, { target: { value: 'استحقاق مكرر عن نفس الشهر' } })
  expect(post.disabled).toBe(false)
  fireEvent.click(post)

  await waitFor(() => expect(useRawDataStore.getState().journal).toHaveLength(1))
  const entry = useRawDataStore.getState().journal[0]
  expect(entry.description).toContain('إلغاء قسيمة PS-2026-0001')
  expect(entry.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(entry.lines.reduce((sum, line) => sum + line.credit, 0))
  const net = (code: string) => entry.lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + line.debit - line.credit, 0)
  expect(net('2104')).toBe(400_000)
  expect(net('5102')).toBe(-400_000)
  expect(useRawDataStore.getState().payrollSlips[0].status).toBe('cancelled')
  expect(useRawDataStore.getState().payrollSlips[0].notes).toContain('استحقاق مكرر')
  await waitFor(() => expect(document.querySelector('[data-cancel-slip]')).toBeNull())
})

it('لا يظهر زر الإلغاء لقسيمة مصروفة ولا لقسمة عليها صرف جزئي', () => {
  useRawDataStore.setState({
    payrollSlips: [
      slip({ id: 1, slipNumber: 'PS-0001', status: 'paid' }),
      slip({ id: 2, slipNumber: 'PS-0002', payments: [{ entryId: 9, amountMinor: 100_000, date: '2026-11-01', treasury: '1101' }] }),
    ] as never,
  })
  render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
  expect(document.querySelector('[data-cancel-slip]')).toBeNull()
})
