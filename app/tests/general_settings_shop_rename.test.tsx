/**
 * الفجوة أ (بلاغ المالك): اسم المنشأة كان يُكتب مرة واحدة فقط في معالج الإعداد
 * الأول بلا أي شاشة لاحقة لتعديله. هذا الاختبار يثبت وجود عنصر تحكم عام لإعادة
 * التسمية من شاشة الإعدادات العامة، وأنه يحفظ الاسم الجديد في متجر الإعداد.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { GeneralSettingsPage } = await import('../src/ui/pages/GeneralSettingsPage.tsx')

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery',
      shopName: 'بقالة الأمل', ownerName: 'المالك', features: [], modules: [], accountingMode: 'full',
      vatPercent: 0, taxInclusive: false, taxRegistrationStatus: 'exempt',
    },
  })
})

afterEach(() => cleanup())

describe('إعادة تسمية المنشأة من الإعدادات العامة', () => {
  it('تعرض الاسم الحالي ويمكن تعديله وحفظه فيتحدّث في متجر الإعداد فوراً', () => {
    render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
    expect(screen.getByText(/اسم المنشأة/)).toBeTruthy()
    const input = screen.getByPlaceholderText('اسم منشأتك') as HTMLInputElement
    expect(input.value).toBe('بقالة الأمل')

    fireEvent.change(input, { target: { value: 'سوبر ماركت النور' } })
    const saveBtn = screen.getByText('💾 حفظ')
    fireEvent.click(saveBtn)

    expect(useAppStore.getState().setup.shopName).toBe('سوبر ماركت النور')
  })

  it('لا يحفظ اسماً فارغاً (مسافات فقط)', () => {
    render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
    const input = screen.getByPlaceholderText('اسم منشأتك') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    const saveBtn = screen.getByText('💾 حفظ').closest('button') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })
})
