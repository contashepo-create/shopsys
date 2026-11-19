import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PosPage } = await import('../src/ui/pages/PosPage.tsx')
const { ean13CheckDigit } = await import('../src/core/barcode.ts')

const S = () => useDataStore.getState()
const scaleCode = (plu: number, grams: number) => {
  const body = `22${String(plu).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return body + ean13CheckDigit(body)
}

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة الاختبار', ownerName: 'م', features: [], modules: ['pos', 'inventory'], accountingMode: 'full' },
  })
  S().addItem({ nameAr: 'مياه معدنية', sku: 'WAT-1', barcodes: ['6281000123456'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 50, priceMinor: 150, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  S().addItem({ nameAr: 'أرز بسمتي', sku: 'RIC-1', barcodes: ['6281000999999'], categoryId: 1, baseUnit: 'كيس', extraUnits: [], costMinor: 800, stockQty: 50, priceMinor: 1200, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  // صنف موزون: PLU = 42 (من SKU) والوحدة كجم
  S().addItem({ nameAr: 'جبنة رومي', sku: 'CHE-42', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 1800, stockQty: 30, priceMinor: 2500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  // صنف بالعدد لكن كوده الرقمي 43 — يجب ألا يُباع بالوزن
  S().addItem({ nameAr: 'علبة جبنة', sku: 'BOX-43', barcodes: [], categoryId: 1, baseUnit: 'علبة', extraUnits: [], costMinor: 500, stockQty: 30, priceMinor: 900, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  /* صنف مصنع يحمل باركود EAN يستطيع الميزان تفكيكه (بادئة 22):
     التطابق الحرفي لأي باركود مسجل يجب أن يسبق تفكيك الميزان،
     وإلا بيع هذا المنتج «وزناً» أو رُفض بـ«كود صنف غير معروف». */
  S().addItem({ nameAr: 'عصير مانجو', sku: 'JUI-1', barcodes: [scaleCode(77, 100)], categoryId: 1, baseUnit: 'علبة', extraUnits: [], costMinor: 300, stockQty: 20, priceMinor: 700, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
})

beforeEach(() => cleanup())

const searchInput = (view: ReturnType<typeof render>) => view.container.querySelector('input[placeholder^="F2"]') as HTMLInputElement
const rows = (view: ReturnType<typeof render>) => [...view.container.querySelectorAll('[data-entry-row]')] as HTMLElement[]
const qtyOf = (row: HTMLElement) => Number((row.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value)
const scan = (view: ReturnType<typeof render>, code: string) => {
  const input = searchInput(view)
  input.focus()
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('كاشير البقالة — المسح المتواصل', () => {
  it('ثلاث مسحات متتالية تُضيف الأصناف ولا تُكتب داخل خانة الكمية', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, '6281000123456')
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    expect(document.activeElement).toBe(searchInput(view))

    scan(view, '6281000999999')
    await waitFor(() => expect(rows(view)).toHaveLength(2))
    expect(document.activeElement).toBe(searchInput(view))

    // نفس الصنف مرة أخرى: تزيد الكمية ولا تُضاف سطراً جديداً
    scan(view, '6281000123456')
    await waitFor(() => expect(qtyOf(rows(view)[0])).toBe(2))
    expect(rows(view)).toHaveLength(2)
    expect(document.activeElement).toBe(searchInput(view))
    expect(qtyOf(rows(view)[1])).toBe(1)
  })

  it('باركود مرسل بأرقام عربية (تخطيط لوحة مفاتيح عربي) يُطابق الصنف نفسه', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, '٦٢٨١٠٠٠١٢٣٤٥٦')
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    expect(rows(view)[0].textContent).toContain('مياه معدنية')
    expect(qtyOf(rows(view)[0])).toBe(1)
  })

  it('مسح ملصق ميزان لصنف موزون يضيف الوزن الصحيح (0.750 كجم)', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, scaleCode(42, 750))
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    expect(rows(view)[0].textContent).toContain('جبنة رومي')
    expect(qtyOf(rows(view)[0])).toBe(0.75)
    expect(document.activeElement).toBe(searchInput(view))
  })

  it('ملصق ميزان بكود صنف يُباع بالعدد يُرفض ولا يخصم كسوراً من مخزونه', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    const before = S().items.find((it) => it.sku === 'BOX-43')?.stockQty
    scan(view, scaleCode(43, 500))
    await new Promise((r) => setTimeout(r, 120))
    expect(rows(view)).toHaveLength(0)
    expect(S().items.find((it) => it.sku === 'BOX-43')?.stockQty).toBe(before)
    // لا سطر ولا كمية كسرية على صنف بالعدد — مصدر العيب كان matchScaleItem
    expect(view.container.textContent).toContain('السلة فارغة')
  })

  it('الاختيار اليدوي بالاسم يُبقي دورة الكمية ← السعر (لم يتغير سلوك الكاشير)', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    const input = searchInput(view)
    input.focus()
    fireEvent.change(input, { target: { value: 'مياه' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    const active = document.activeElement as HTMLInputElement
    expect(active).not.toBe(searchInput(view))
    expect(active.getAttribute('inputmode')).toBe('decimal')
  })
})

describe('ترتيب القرار: الباركود المسجل يسبق تفكيك الميزان', () => {
  it('رقم يفككه الميزان (بادئة 22) ومسجل كباركود منتج ⇒ يُضاف المنتج قطعة لا وزناً', async () => {
    const label = scaleCode(77, 100)
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, label)
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    expect(rows(view)[0].textContent).toContain('عصير مانجو')
    expect(qtyOf(rows(view)[0])).toBe(1)
    expect(S().items.find((it) => it.sku === 'JUI-1')?.soldByWeight).toBe(false)
  })
})
