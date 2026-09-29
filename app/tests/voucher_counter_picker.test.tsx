import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { VouchersPage } = await import('../src/ui/pages/VouchersPage.tsx')

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار', ownerName: 'م', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full' } })
})

describe('الحساب المقابل في السندات', () => {
  it('صار خانة بحث فعلية بدل النص الميت «اختر الحساب المقابل من القائمة»', () => {
    const view = render(<MemoryRouter><VouchersPage /></MemoryRouter>)
    fireEvent.click(view.getAllByText(/سند صرف/)[0].closest('button')!)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).not.toContain('اختر الحساب المقابل من القائمة')

    /* القوائم ≤١٠ بنود صارت منسدلة أصلية (قرار المالك)، والأطول تبقى بحثاً */
    const native = document.querySelector('[data-quick-native] select[aria-label="بحث الحساب المقابل"]') as HTMLSelectElement | null
    if (native) {
      const option = [...native.options].find((row) => row.textContent?.includes('رواتب'))
      expect(option, 'حساب الرواتب غير معروض في القائمة المنسدلة').toBeTruthy()
      fireEvent.change(native, { target: { value: option!.value } })
    } else {
      const search = view.getByLabelText('بحث الحساب المقابل') as HTMLInputElement
      fireEvent.focus(search)
      fireEvent.change(search, { target: { value: 'رواتب' } })
      const options = [...document.querySelectorAll('[data-quick-option]')] as HTMLElement[]
      expect(options.length).toBeGreaterThan(0)
      expect(options.every((option) => option.textContent?.includes('رواتب'))).toBe(true)
      fireEvent.click(options[0])
    }
    // شريط التأكيد يعرض الحساب المختار بالكود والاسم
    expect(dialog.textContent).toContain('الحساب المختار')
    expect(dialog.textContent).toContain('رواتب')
  })
})
