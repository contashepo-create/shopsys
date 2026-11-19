/**
 * شاشات البقالة التي لم يكن لها أي اختبار قبل هذه الجولة:
 * العروض والباقات · الباركود والملصقات · الموردون (أرصدتهم).
 * كل شاشة تُركَّب ببيانات حقيقية من المستودع ويُتحقق من أثرها الفعلي لا من شكلها.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
vi.stubGlobal('confirm', () => true)
vi.stubGlobal('print', () => {})

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PromotionsPage } = await import('../src/ui/pages/PromotionsPage.tsx')
const { BarcodeCenterPage } = await import('../src/ui/pages/BarcodeCenterPage.tsx')
const { SuppliersPage } = await import('../src/ui/pages/PartiesPages.tsx')
const { promotionCartLines } = await import('../src/core/promotions.ts')

afterEach(cleanup)
const S = () => useDataStore.getState()
let water = 0
let juice = 0

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة اختبار',
      ownerName: 'م', features: ['weight_scale', 'multi_unit', 'price_lists'], modules: ['pos', 'inventory', 'purchases'],
      accountingMode: 'full', vatPercent: 15, taxInclusive: true,
    },
  })
  const add = (nameAr: string, sku: string, costMinor: number, priceMinor: number, extra = {}) => {
    S().addItem({
      nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor,
      stockQty: 100, priceMinor, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0,
      soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra,
    } as never)
    return S().items.find((i) => i.sku === sku)!.id
  }
  water = add('مياه 600مل', 'W-1', 300, 500)
  juice = add('عصير برتقال', 'J-1', 700, 1000)
  if (!S().shifts.some((s) => s.status === 'open')) S().openShift('كاشير', 0)
})

describe('البقالة — شاشة العروض والباقات (لم تكن مغطاة)', () => {
  it('إنشاء باقة من الشاشة نفسها يوزّع سعر الباقة على المكونات بقرش مضبوط', () => {
    const view = render(<MemoryRouter><PromotionsPage /></MemoryRouter>)
    fireEvent.click(view.getByText(/عرض\/باقة جديدة|عرض جديد|جديد/))
    const dialog = view.getByRole('dialog')
    fireEvent.change(dialog.querySelector('input[placeholder="باقة رمضان…"]') as HTMLInputElement, { target: { value: 'باقة الإفطار' } })

    // كمية كل صنف داخل الباقة
    const waterRow = within(dialog).getByText('مياه 600مل').closest('div') as HTMLElement
    fireEvent.change(within(waterRow).getByTitle('كمية الصنف داخل الباقة الواحدة'), { target: { value: '3' } })
    const juiceRow = within(dialog).getByText('عصير برتقال').closest('div') as HTMLElement
    fireEvent.change(within(juiceRow).getByTitle('كمية الصنف داخل الباقة الواحدة'), { target: { value: '1' } })

    const priceInput = within(dialog).getAllByRole('textbox').at(-1) as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '20' } })
    // 3×5.00 + 1×10.00 = 25.00 تجزئة ⇒ وفر 5.00
    expect(within(dialog).getByText(/وفر العميل/)).toBeTruthy()
    fireEvent.click(within(dialog).getByText('إنشاء العرض'))

    const promo = S().promotions.find((p) => p.nameAr === 'باقة الإفطار')!
    expect(promo.bundlePriceMinor).toBe(2000)
    expect(promo.components).toEqual(expect.arrayContaining([{ itemId: water, qty: 3 }, { itemId: juice, qty: 1 }]))

    // نفس ما سيصل للسلة: 4 وحدات بسعر إجمالي 2000 بلا كسور ولا فرق تقريب
    const lines = promotionCartLines(promo, 1, S().items)
    expect(lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0)).toBe(2000)
    expect(lines.every((l) => Number.isInteger(l.unitPriceMinor))).toBe(true)
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(4)
  })

  it('باقة أغلى من التجزئة تظهر تحذيراً أحمر ولا تدّعي وفراً', () => {
    const view = render(<MemoryRouter><PromotionsPage /></MemoryRouter>)
    fireEvent.click(view.getByText(/عرض\/باقة جديدة|عرض جديد|جديد/))
    const dialog = view.getByRole('dialog')
    fireEvent.change(dialog.querySelector('input[placeholder="باقة رمضان…"]') as HTMLInputElement, { target: { value: 'باقة خاطئة' } })
    const row = within(dialog).getByText('مياه 600مل').closest('div') as HTMLElement
    fireEvent.change(within(row).getByTitle('كمية الصنف داخل الباقة الواحدة'), { target: { value: '2' } })
    const priceInput = within(dialog).getAllByRole('textbox').at(-1) as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '30' } })
    expect(within(dialog).getByText(/أغلى من التجزئة/)).toBeTruthy()
  })
})

describe('البقالة — مركز الباركود والملصقات (لم يكن مغطى)', () => {
  it('يعرض الأصناف ويحسب إجمالي الملصقات المطلوبة', () => {
    const view = render(<MemoryRouter><BarcodeCenterPage /></MemoryRouter>)
    expect(view.getByText('مياه 600مل')).toBeTruthy()
    const row = view.getByText('مياه 600مل').closest('tr') as HTMLElement
    const countInput = within(row).getAllByRole('spinbutton').at(0) ?? within(row).getAllByRole('textbox').at(0)
    fireEvent.change(countInput as HTMLInputElement, { target: { value: '12' } })
    expect(view.container.textContent).toMatch(/12/)
  })
})

describe('البقالة — شاشة الموردين (لم تكن مغطاة)', () => {
  it('رصيد المورد يظهر من المصدر الموحّد بعد فاتورة شراء آجلة', () => {
    S().addSupplier({ nameAr: 'شركة الألبان', phone: '0500000000' } as never)
    const supplier = S().suppliers.find((s) => s.nameAr === 'شركة الألبان')!
    S().postPurchase({
      supplierId: supplier.id, date: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: water, qty: 10, unitPriceMinor: 300 }],
      expenses: [], paidMinor: 0, treasury: '1101',
    } as never)
    expect(S().getSupplierBalance(supplier.id)).toBe(3000)
    const view = render(<MemoryRouter><SuppliersPage /></MemoryRouter>)
    const row = view.getByText('شركة الألبان').closest('tr') as HTMLElement
    expect(row.textContent).toMatch(/30/)
  })
})
