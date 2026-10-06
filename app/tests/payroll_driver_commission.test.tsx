import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

/**
 * بلاغ المالك: «عمولة سائق لوجيستي لم تظهر في الرواتب عند إصدار مسير».
 * العمولة تُستحق على 2111 (مستحقات سائقين) بينما المسير كان يقرأ 2116 فقط،
 * فلم يكن للسائق أي أثر في شاشة المسير ولا في قيده.
 */
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { EmployeesPage } = await import('../src/ui/pages/EmployeesPage.tsx')

const S = () => useDataStore.getState()
const DRIVER_COMMISSION = 75_00

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'logistics', shopName: 'نقل', ownerName: 'مالك', features: ['logistics'] } })
  S().seed(['logistics'])
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500_000_00, label: 'خزينة' })
  S().addCustomer({
    nameAr: 'مصنع الدلتا', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '',
    city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0, creditLimitMinor: 0,
  })
  S().addEmployee({
    nameAr: 'محمود السائق', phone: '01000000009', jobTitle: 'سائق', hireDate: '2026-01-01',
    baseSalaryMinor: 300000, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '',
    email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0,
  })
  const driverId = S().employees.at(-1)!.id
  S().postTrip({
    customerId: S().customers.at(-1)!.id, vehicleId: null, driverId, notes: '', treasury: '1101',
    driverCommissionMinor: DRIVER_COMMISSION,
    input: { fromLoc: 'طنطا', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 500000, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [] },
  })
})

const driver = () => S().employees.find((e) => e.jobTitle === 'سائق')!

describe('عمولة سائق النقلات في مسير الرواتب', () => {
  it('تُستحق على 2111 وتظهر كرصيد للسائق قبل المسير', () => {
    expect(S().getDriverDueBalance(driver().id)).toBe(DRIVER_COMMISSION)
    const accrual = S().journal.at(-1)!
    expect(accrual.lines.some((l) => l.accountCode === '2111' && l.credit === DRIVER_COMMISSION)).toBe(true)
  })

  it('تظهر في شاشة إصدار المسير بعمود العمولات مع وسم «نقلات»', () => {
    const view = render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    /* §93: المسير المجمّع أصبح ثانوياً — الرسمي قسائم مستقلة */
    fireEvent.click(view.getByText('مسير مجمّع للجميع (قديم)'))
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    const marker = dialog.querySelector('[data-driver-dues]')
    expect(marker).toBeTruthy()
    expect(marker!.textContent).toContain('نقلات')
    expect(dialog.textContent).toContain('75')
    view.unmount()
  })

  it('تُصرف مع الراتب: 2111 مدين، والخزينة بالصافي + العمولة، بلا صرف مزدوج', () => {
    const run = S().postPayroll({
      month: '2026-07', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: driver().id, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, driverDuesPaidMinor: DRIVER_COMMISSION }],
    })
    expect(run.totals.driverDuesPaidMinor).toBe(DRIVER_COMMISSION)
    const entry = S().journal.find((e) => e.id === run.journalEntryId)!
    expect(entry.lines.some((l) => l.accountCode === '2111' && l.debit === DRIVER_COMMISSION)).toBe(true)
    expect(entry.lines.some((l) => l.accountCode === '1101' && l.credit === 300000 + DRIVER_COMMISSION)).toBe(true)
    expect(S().getDriverDueBalance(driver().id)).toBe(0)
    expect(S().driverDues.every((d) => d.settled && d.settlementEntryId === run.journalEntryId)).toBe(true)
    expect(() => S().settleDriverDues(driver().id, '1101')).toThrow()
  })

  it('ترفض الصرف الجزئي أو ما يتجاوز رصيد السائق', () => {
    S().postTrip({
      customerId: S().customers.at(-1)!.id, vehicleId: null, driverId: driver().id, notes: '', treasury: '1101',
      driverCommissionMinor: 40_00,
      input: { fromLoc: 'طنطا', toLoc: 'بنها', qty: 1, unitPriceMinor: 200000, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [] },
    })
    const base = { month: '2026-08', payMode: 'cash' as const, treasury: '1101', custodyFileId: null, notes: '' }
    const line = (dues: number) => ({ employeeId: driver().id, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, driverDuesPaidMinor: dues })
    expect(() => S().postPayroll({ ...base, lines: [line(90_00)] })).toThrow(/أكبر من رصيده/)
    expect(() => S().postPayroll({ ...base, lines: [line(10_00)] })).toThrow(/كاملة مع الراتب/)
    expect(S().getDriverDueBalance(driver().id)).toBe(40_00)
  })
})
