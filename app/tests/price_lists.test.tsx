import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockData = vi.hoisted(() => ({
  items: [{ id: 1, nameAr: 'سكر أبيض', sku: 'SUG-1', barcodes: [], priceMinor: 1500, costMinor: 1000, isActive: true }],
  customers: [],
  priceLists: [{ id: 1, nameAr: 'جملة', defaultDiscountPercent: 10, isActive: true }],
  priceListEntries: [],
  addPriceList: vi.fn(),
  updatePriceList: vi.fn(),
  updateItem: vi.fn(),
  togglePriceList: vi.fn(),
  removePriceList: vi.fn(),
  setPriceListEntry: vi.fn(),
  setCustomerPriceList: vi.fn(),
}))

vi.mock('../src/data/repo.ts', () => ({ useDataStore: () => mockData }))
vi.mock('../src/stores/app.store.ts', () => ({ useAppStore: () => ({ setup: { countryCode: 'EG' } }) }))

import { PriceListsPage } from '../src/ui/pages/PriceListsPage.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('جدول أسعار الأصناف', () => {
  it('يفتح وضع بدء التعديل ويكتب السعر الخاص مباشرة داخل الخلية', () => {
    const view = render(<PriceListsPage />)
    fireEvent.click(view.getByRole('button', { name: 'جدول أسعار الأصناف' }))
    fireEvent.click(view.getByRole('button', { name: 'بدء التعديل' }))

    const retailInput = view.getByRole('textbox', { name: 'السعر القطاعي سكر أبيض' })
    const priceInput = view.getByRole('textbox', { name: 'سعر سكر أبيض في جملة' })
    expect(view.getByRole('button', { name: 'إنهاء التعديل' })).toBeTruthy()
    expect(priceInput.getAttribute('placeholder')).toBe('13.50')

    fireEvent.change(retailInput, { target: { value: '16.00' } })
    fireEvent.blur(retailInput)
    expect(mockData.updateItem).toHaveBeenCalledWith(1, { priceMinor: 1600 })

    fireEvent.change(priceInput, { target: { value: '12.50' } })
    fireEvent.blur(priceInput)
    expect(mockData.setPriceListEntry).toHaveBeenCalledWith(1, 1, 1250)
  })
})
