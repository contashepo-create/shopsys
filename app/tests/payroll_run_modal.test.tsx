import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { EmployeesPage } = await import('../src/ui/pages/EmployeesPage.tsx')
const S = () => useDataStore.getState()
beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'x', ownerName: 'م', features: [], modules: ['employees'], accountingMode: 'full' } })
  S().addEmployee({ nameAr: 'أحمد سالم', phone: '01000000001', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 10000, active: true, roleId: 'cashier', ext: undefined })
  S().addEmployee({ nameAr: 'سعاد مصطفى', phone: '01000000002', jobTitle: 'محاسبة', hireDate: '2026-01-01', baseSalaryMinor: 700000, allowancesMinor: 0, active: true, roleId: 'accountant', ext: undefined })
})
describe('نافذة مسير الرواتب المعاد تصميمها — كل الموظفين', () => {
  it('يعرض الجدول والإجماليات والبحث داخل المسير', () => {
    const view = render(<MemoryRouter><EmployeesPage initialTab="payroll" /></MemoryRouter>)
    fireEvent.click(view.getByText('مسير رواتب لكل الموظفين').closest('button')!)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const t = dialog.textContent ?? ''
    expect(t).toContain('① بيانات المسير')
    expect(t).toContain('② الموظفون المدرجون (2)')
    expect(t).toContain('أحمد سالم')
    expect(t).toContain('سعاد مصطفى')
    expect(t).toContain('الإجماليات (2 موظف)')
    expect(t).toContain('③ الملخص والترحيل')
    expect(t).toContain('صافي الرواتب')
    expect(dialog.querySelectorAll('tbody tr').length).toBe(2)
    // بحث داخل المسير يصفّي الصفوف بلا حذف أحد من المسير
    const filter = dialog.querySelector('input[placeholder*="بحث داخل المسير"]') as HTMLInputElement
    fireEvent.change(filter, { target: { value: 'سعاد' } })
    expect(dialog.querySelectorAll('tbody tr').length).toBe(1)
    expect(dialog.textContent).toContain('الإجماليات (2 موظف)')
  })
})
