import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PosPage } = await import('../src/ui/pages/PosPage.tsx')

const S = () => useDataStore.getState()

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار', ownerName: 'م', features: [], modules: ['pos', 'inventory'], accountingMode: 'full' } })
  S().addItem({ nameAr: 'مياه معدنية 1.5ل', sku: 'WAT-1', barcodes: ['622100'], categoryId: 1, baseUnit: 'زجاجة', extraUnits: [], costMinor: 1000, stockQty: 50, priceMinor: 1500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  S().addItem({ nameAr: 'جبنة بيضاء', sku: 'CHE-2', barcodes: ['622200'], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 2000, stockQty: 30, priceMinor: 2500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
})

describe('بحث الكاشير', () => {
  it('يعرض نافذة النتائج عند كتابة حرف واحد وبأشكال مختلفة للحرف', () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    const input = view.container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'م' } })
    expect(view.getByRole('dialog', { name: /نتائج بحث الأصناف في الكاشير/ })).toBeTruthy()
    expect(document.querySelectorAll('[data-pos-result]').length).toBeGreaterThan(0)
    // تاء مربوطة ↔ هاء + أرقام عربية
    fireEvent.change(input, { target: { value: 'جبنه' } })
    expect(document.querySelectorAll('[data-pos-result]').length).toBe(1)
    fireEvent.change(input, { target: { value: '٦٢٢١٠٠' } })
    expect(document.querySelectorAll('[data-pos-result]').length).toBe(1)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(view.getByRole('dialog', { name: /نتائج بحث الأصناف في الكاشير/ })).toBeTruthy()
    expect(document.querySelectorAll('[data-pos-result]').length).toBe(0)
  })
})
