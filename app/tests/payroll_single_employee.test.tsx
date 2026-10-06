import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { validatePayrollRun, computePayrollLine } from '../src/core/payroll.ts'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { EmployeesPage } = await import('../src/ui/pages/EmployeesPage.tsx')

const S = () => useDataStore.getState()
const line = (employeeId: number, baseMinor: number) =>
  computePayrollLine({ employeeId, baseMinor, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار', ownerName: 'م', features: [], modules: ['employees'], accountingMode: 'full' } })
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 50000000, label: 'خزينة' })
  S().addEmployee({ nameAr: 'أحمد سالم', phone: '01000000001', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, roleId: 'cashier', ext: undefined })
  S().addEmployee({ nameAr: 'سعاد مصطفى', phone: '01000000002', jobTitle: 'محاسبة', hireDate: '2026-01-01', baseSalaryMinor: 700000, allowancesMinor: 0, active: true, roleId: 'accountant', ext: undefined })
})

describe('مسير راتب موظف واحد', () => {
  it('يسمح بمسير لكل موظف على حدة في نفس الشهر ويمنع تكرار الموظف نفسه', () => {
    // القاعدة الجديدة: الشهر يقبل أكثر من مسير ما دام الموظف لا يتكرر
    const runs = [{ month: '2026-09', employeeIds: [1] }]
    expect(validatePayrollRun({ month: '2026-09', lines: [line(2, 700000)], existingMonths: ['2026-09'], existingRuns: runs })).toEqual([])
    expect(validatePayrollRun({ month: '2026-09', lines: [line(1, 500000)], existingMonths: ['2026-09'], existingRuns: runs }).join()).toMatch(/مرحّل بالفعل/)
    // القاعدة القديمة تبقى عند عدم تمرير المسيرات (توافق خلفي)
    expect(validatePayrollRun({ month: '2026-09', lines: [line(2, 700000)], existingMonths: ['2026-09'] }).join()).toMatch(/مرحّل بالفعل/)
    // تكرار الموظف داخل المسير الواحد مرفوض
    expect(validatePayrollRun({ month: '2026-10', lines: [line(1, 500000), line(1, 500000)], existingMonths: [], existingRuns: [] }).join()).toMatch(/مكرر داخل المسير/)
  })

  it('يرحّل راتب موظف واحد ثم يرفض تكراره ويقبل زميله في نفس الشهر', () => {
    const one = S().postPayroll({ month: '2026-08', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: 1, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
    expect(one.lines).toHaveLength(1)
    expect(() => S().postPayroll({ month: '2026-08', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: 1, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })).toThrow(/أحمد سالم/)
    const two = S().postPayroll({ month: '2026-08', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: 2, baseMinor: 700000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
    expect(two.lines[0].employeeId).toBe(2)
  })

  it('يعرض زرّي المسير: كل الموظفين وموظف واحد، ونافذة الموظف الواحد تفتح فارغة بالبحث', () => {
    const view = render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    const single = view.getByText('مسير مجمّع لموظف (قديم)')
    expect(view.getByText('مسير مجمّع للجميع (قديم)')).toBeTruthy()
    fireEvent.click(single)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain('مسير راتب موظف واحد')
    expect(dialog.textContent).toContain('اكتب أول حرف من اسم الموظف')
    // لا جدول قبل اختيار الموظف — ثم يظهر بعد الاختيار
    expect(dialog.querySelector('table')).toBeNull()
  })
})
