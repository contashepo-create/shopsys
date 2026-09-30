import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockData = vi.hoisted(() => ({
  items: [
    { id: 1, nameAr: 'سكر أبيض', sku: 'SUG-1', barcodes: [], priceMinor: 1500, costMinor: 1000, isActive: true, categoryId: 1 },
    { id: 2, nameAr: 'زيت ذرة', sku: 'OIL-2', barcodes: [], priceMinor: 8000, costMinor: 6000, isActive: true, categoryId: 2 },
  ],
  customers: [],
  categories: [{ id: 1, nameAr: 'فئة أ', parentId: null, features: [] }, { id: 2, nameAr: 'فئة ب', parentId: null, features: [] }],
  priceLists: [{ id: 1, nameAr: 'جملة', defaultDiscountPercent: 10, isActive: true }],
  priceListEntries: [],
  priceListCategoryRules: [],
  setPriceListCategoryRule: vi.fn(),
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
import { priceSource, resolvePrice } from '../src/core/priceLists.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('جدول أسعار الأصناف', () => {
  it('يطبق سعر فئة العميل الافتراضي أو الخاص قبل إضافة الصنف للفاتورة', () => {
    const lists = [{ id: 1, nameAr: 'جملة', defaultDiscountPercent: 10, isActive: true }]
    expect(resolvePrice(1, 1500, 1, lists, [])).toBe(1350)
    expect(resolvePrice(1, 1500, 1, lists, [{ listId: 1, itemId: 1, priceMinor: 1200 }])).toBe(1200)
  })

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

describe('خصم لكل فئة داخل نفس القائمة (قرار المالك ⑩ي البند ⑧)', () => {
  const lists = [{ id: 1, nameAr: 'جملة', defaultDiscountPercent: 10, isActive: true }]
  const rules = [
    { listId: 1, categoryId: 1, discountPercent: 0 },
    { listId: 1, categoryId: 2, discountPercent: 25 },
  ]

  it('يطبق خصم الفئة قبل الخصم الافتراضي للقائمة', () => {
    // فئة ب: 8000 − 25٪ = 6000 (بدل خصم القائمة 10٪)
    expect(resolvePrice(2, 8000, 1, lists, [], rules, 2)).toBe(6000)
    // فئة أ بخصم صفر ⇒ يسري الخصم الافتراضي 10٪
    expect(resolvePrice(1, 1500, 1, lists, [], rules, 1)).toBe(1350)
    // فئة بلا قاعدة ⇒ الخصم الافتراضي
    expect(resolvePrice(1, 1500, 1, lists, [], rules, 9)).toBe(1350)
  })

  it('سعر الصنف الخاص يسبق خصم الفئة', () => {
    const entries = [{ listId: 1, itemId: 2, priceMinor: 7000 }]
    expect(resolvePrice(2, 8000, 1, lists, entries, rules, 2)).toBe(7000)
  })

  it('يوضّح مصدر السعر لكل حالة', () => {
    expect(priceSource(2, 1, lists, [{ listId: 1, itemId: 2, priceMinor: 7000 }], rules, 2)).toBe('item')
    expect(priceSource(2, 1, lists, [], rules, 2)).toBe('category')
    expect(priceSource(1, 1, lists, [], rules, 1)).toBe('list')
    expect(priceSource(1, null, lists, [], rules, 1)).toBe('retail')
  })

  it('شاشة قوائم الأسعار تعرض زر «خصم لكل فئة» لكل قائمة', () => {
    const view = render(<PriceListsPage />)
    const button = view.container.querySelector('[data-category-rules]')
    expect(button).toBeTruthy()
    fireEvent.click(button!)
    expect(view.getByLabelText('خصم فئة فئة أ ٪')).toBeTruthy()
    expect(view.getByLabelText('خصم فئة فئة ب ٪')).toBeTruthy()
    fireEvent.blur(view.getByLabelText('خصم فئة فئة ب ٪'), { target: { value: '25' } })
    expect(mockData.setPriceListCategoryRule).toHaveBeenCalledWith(1, 2, 25)
  })
})
