/**
 * عقد شاشة الكاشير للبقالة — تدقيق واجهة البيع لا الحساب وحده:
 * ① كمية الصنف بالقطعة لا تقبل كسراً (0.5 علبة بيض)، والموزون يقبل الكسر.
 * ② الباقي للعميل يظهر عند كتابة نقد أكثر من الإجمالي (مع فئات سريعة).
 * ③ تغيير العميل/قائمة الأسعار لا يمحو سعراً عدّله الكاشير يدوياً.
 * ④ سطر البيع يُحسب بعقد `lineTotal` نفسه الذي يعتمده الترحيل.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { repriceCartForPriceList, lineTotal, type CartLine } from '../src/core/pos.ts'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PosPage } = await import('../src/ui/pages/PosPage.tsx')

afterEach(cleanup)

const S = () => useDataStore.getState()

const cartLine = (over: Partial<CartLine> = {}): CartLine => ({
  itemId: 1, nameAr: 'صنف', qty: 1, unitPriceMinor: 1000, unitCostMinor: 700,
  discountPercent: 0, soldByWeight: false, ...over,
})

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'اختبار بقالة',
      ownerName: 'م', features: ['weight_scale', 'multi_unit', 'price_lists'], modules: ['pos', 'inventory', 'purchases'],
      accountingMode: 'full', vatPercent: 15, taxInclusive: true,
    },
  })
  const item = (nameAr: string, sku: string, barcode: string, costMinor: number, priceMinor: number, extra = {}) =>
    S().addItem({
      nameAr, sku, barcodes: [barcode], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor,
      stockQty: 100, priceMinor, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0,
      soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra,
    } as never)
  item('بيض 30 حبة', 'EGG-1', '622100', 1200, 1800)
  item('تفاح أحمر', 'APL-2', '622200', 500, 900, { soldByWeight: true, baseUnit: 'كجم' })
  if (!S().shifts.some((s) => s.status === 'open')) S().openShift('كاشير بقالة', 0)
})

const scan = (barcode: string) => {
  const input = document.querySelector('input') as HTMLInputElement
  fireEvent.change(input, { target: { value: barcode } })
}

describe('البقالة — كمية السطر في الكاشير', () => {
  it('الصنف بالقطعة يرفض الكسر: كتابة 0.5 تُبقي الكمية صحيحة', () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan('622100')
    fireEvent.keyDown(document.querySelector('input') as HTMLInputElement, { key: 'Enter' })
    const qty = view.container.querySelector('input[title*="كمية صحيحة"]') as HTMLInputElement
    expect(qty).toBeTruthy()
    fireEvent.change(qty, { target: { value: '0.5' } })
    // الحقل لا يقبل النقطة أصلاً، فالقيمة المعروضة تبقى كما هي
    expect(qty.value).not.toContain('.')
    fireEvent.change(qty, { target: { value: '3' } })
    expect(qty.value).toBe('3')
  })

  it('الصنف الموزون يقبل الكسر بثلاث خانات', () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan('622200')
    fireEvent.keyDown(document.querySelector('input') as HTMLInputElement, { key: 'Enter' })
    const titles = [...view.container.querySelectorAll('input')].map((i) => i.getAttribute('title') ?? i.className.slice(0, 20))
    const qty = view.container.querySelector('input[title*="كجم"]') as HTMLInputElement
    expect(qty, titles.join(' | ')).toBeTruthy()
    fireEvent.change(qty, { target: { value: '1.25' } })
    expect(qty.value).toBe('1.25')
    // ومجموع السطر يتبع عقد lineTotal نفسه
    expect(lineTotal(cartLine({ qty: 1.25, unitPriceMinor: 900 }), 2)).toBe(1125)
  })
})

describe('البقالة — الثلث النقدي والباقي للعميل', () => {
  it('كتابة 50 لفاتورة أقل تُظهر الباقي للعميل وتوفّر فئات سريعة', () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan('622100')
    fireEvent.keyDown(document.querySelector('input') as HTMLInputElement, { key: 'Enter' })
    fireEvent.click(view.getByText(/الدفع \(F9\)/))
    // المودال يُركَّب في Portal خارج حاوية الشاشة
    const cash = document.querySelector('input[type="number"]') as HTMLInputElement
    expect(cash).toBeTruthy()
    fireEvent.change(cash, { target: { value: '50' } })
    const due = document.querySelector('[data-testid="pos-change-due"]') as HTMLElement
    expect(due.textContent).toBeTruthy()
    expect(document.querySelector('[data-testid="pos-quick-cash"]')).toBeTruthy()
    // 50 ريال − 18.00 = 32.00 باقي للعميل (ليس ديناً)
    expect(due.textContent!.replace(/[^\d.]/g, '')).toContain('32')
    expect(document.body.textContent).toContain('الباقي للعميل')
  })
})

describe('البقالة — سعر الكاشير اليدوي وقائمة أسعار العميل', () => {
  it('إعادة التسعير تحفظ السطر المعدَّل يدوياً وتحدّث الباقي', () => {
    const cart = [
      cartLine({ itemId: 1, unitPriceMinor: 1500 }), // سعر عادي
      cartLine({ itemId: 2, unitPriceMinor: 700, priceManual: true }), // اتفاق سعر مع الكاشير
    ]
    const after = repriceCartForPriceList(cart, (itemId) => (itemId === 1 ? 1600 : 800))
    expect(after[0].unitPriceMinor).toBe(1600)
    expect(after[1].unitPriceMinor).toBe(700)
    expect(after[1].priceManual).toBe(true)
  })
})
