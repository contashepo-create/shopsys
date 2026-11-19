import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useScaleStore, SCALE_READING_TTL_MS } = await import('../src/stores/scale.store.ts')
const { PosPage } = await import('../src/ui/pages/PosPage.tsx')

const S = () => useDataStore.getState()

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة', ownerName: 'م', features: [], modules: ['pos', 'inventory'], accountingMode: 'full' },
  })
  S().addItem({ nameAr: 'جبنة رومي', sku: 'CHE-42', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 1800, stockQty: 30, priceMinor: 2500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  S().addItem({ nameAr: 'مياه', sku: 'WAT-1', barcodes: ['6281000123456'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 50, priceMinor: 150, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
})

beforeEach(() => {
  cleanup()
  useScaleStore.setState({ reading: null, connected: false, portLabel: null, error: null })
})

const rows = (view: ReturnType<typeof render>) => [...view.container.querySelectorAll('[data-entry-row]')] as HTMLElement[]
const qtyOf = (row: HTMLElement) => Number((row.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value)
const scan = (view: ReturnType<typeof render>, code: string) => {
  const input = view.container.querySelector('input[placeholder^="F2"]') as HTMLInputElement
  input.focus()
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('تطبيق وزن الميزان الحيّ على سطر الكاشير', () => {
  it('قراءة طازجة + سطر موزون مختار ⇒ زر التطبيق يضبط الكمية بالوزن', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, '6281000123456')
    await waitFor(() => expect(rows(view)).toHaveLength(1))

    // قراءة من الميزان (0.720 كجم) — تظهر لافتة الوزن الحيّ
    useScaleStore.setState({ reading: { kg: 0.72, grams: 720, stable: true, at: Date.now() } })
    await waitFor(() => expect(view.container.querySelector('[data-scale-banner]')).not.toBeNull())
    // الصنف المختار غير موزون ⇒ لا زر تطبيق، بل إرشاد
    expect(view.container.querySelector('[data-scale-banner]')?.textContent).toContain('اختر سطر صنف موزون')

    // أضف الجبنة (صنف موزون) واختر سطرها ثم طبّق
    scan(view, 'CHE-42')
    await waitFor(() => expect(rows(view)).toHaveLength(2))
    fireEvent.click(rows(view)[1])
    const applyBtn = [...view.container.querySelectorAll('[data-scale-banner] button')][0] as HTMLButtonElement
    expect(applyBtn.textContent).toContain('جبنة رومي')
    fireEvent.click(applyBtn)
    await waitFor(() => expect(qtyOf(rows(view)[1])).toBe(0.72))
  })

  it('قراءة قديمة (أكثر من 15 ثانية) لا تُعرض ولا تُطبَّق', async () => {
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    scan(view, 'CHE-42')
    await waitFor(() => expect(rows(view)).toHaveLength(1))
    useScaleStore.setState({ reading: { kg: 0.9, grams: 900, stable: true, at: Date.now() - SCALE_READING_TTL_MS - 1 } })
    await new Promise((r) => setTimeout(r, 60))
    expect(view.container.querySelector('[data-scale-banner]')).toBeNull()
    expect(qtyOf(rows(view)[0])).toBe(0.5)
  })
})
