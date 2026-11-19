import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { StocktakePage } = await import('../src/ui/pages/StocktakePage.tsx')
const { ean13CheckDigit } = await import('../src/core/barcode.ts')

const scaleCode = (plu: number, grams: number) => {
  const body = `22${String(plu).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return body + ean13CheckDigit(body)
}

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة', ownerName: 'م', features: [], modules: ['pos', 'inventory'], accountingMode: 'full' },
  })
  const S = () => useDataStore.getState()
  S().addItem({ nameAr: 'جبنة رومي', sku: 'CHE-42', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 1800, stockQty: 10, priceMinor: 2500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  S().addItem({ nameAr: 'مياه', sku: 'WAT-1', barcodes: ['6281000123456'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 10, priceMinor: 150, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
})

beforeEach(() => cleanup())

const countedInputFor = (view: ReturnType<typeof render>, nameAr: string) => {
  const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(nameAr))!
  return row.querySelector('input') as HTMLInputElement
}

describe('الجرد بالباركود — الأوزان لا تُحسب قطعاً', () => {
  it('مسح ملصق ميزان يضيف 0.750 كجم لا 1، والمسحة العادية +1', async () => {
    const view = render(<MemoryRouter><StocktakePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /بدء الجرد/ }))
    const scanInput = await waitFor(() => view.container.querySelector('input[placeholder^="امسح الباركود"]') as HTMLInputElement)

    fireEvent.change(scanInput, { target: { value: scaleCode(42, 750) } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    await waitFor(() => expect(countedInputFor(view, 'جبنة رومي').value).toBe('0.75'))

    // مسحة ثانية لملصق آخر تجمع الأوزان
    fireEvent.change(scanInput, { target: { value: scaleCode(42, 250) } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    await waitFor(() => expect(countedInputFor(view, 'جبنة رومي').value).toBe('1'))

    // صنف بالعدد: كل مسحة +1
    fireEvent.change(scanInput, { target: { value: '6281000123456' } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    await waitFor(() => expect(countedInputFor(view, 'مياه').value).toBe('1'))
    // الفارق ظاهر في الجدول (10 دفتري − 1.000 معدود) — بالوزن لا بالقطع
    const cheeseRow = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('جبنة رومي'))!
    expect(cheeseRow.textContent).toContain('-9')
  })
})
