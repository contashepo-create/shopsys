import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { StocktakePage } from '../src/ui/pages/StocktakePage.tsx'

/**
 * أداء شاشة الجرد — بقالة بآلاف الأصناف.
 *
 * العيب قبل الإصلاح: الجدول كان يرسم **كل** الأصناف النشطة، فكل مسحة باركود
 * تعيد رسم آلاف الصفوف (تجمّد محسوس). الآن: بحث فوري + مرشّح «المعدود فقط»
 * + سقف رسم 200 صف مع دعوة صريحة للبحث، والمسح يبقى المسار الأساسي.
 */

const initial = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useDataStore.getState()

afterEach(() => {
  cleanup()
  useRawDataStore.setState(initial, true)
  useAppStore.setState(app, true)
})

function seedMany(count: number) {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'SA', allowNegativeTreasury: true } })
  useRawDataStore.setState({
    ...initial, branches: [], activeBranchId: null, items: [], stocktakes: [], journal: [], currentUserId: null, appUsers: [],
    warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }],
  } as never)
  for (let i = 1; i <= count; i++) {
    S().addItem({
      nameAr: `صنف ${i}`, sku: `SKU-${String(i).padStart(4, '0')}`,
      barcodes: [`628000000${String(i).padStart(3, '0')}`], categoryId: 1, baseUnit: 'علبة', extraUnits: [],
      costMinor: 100, stockQty: 10, priceMinor: 200, minQty: 0, trackExpiry: false,
      trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
    } as never)
  }
}

describe('جرد بآلاف الأصناف: رسم محدود وبحث فوري', () => {
  it('لا يرسم أكثر من 200 صف ويقول ذلك صراحةً', () => {
    seedMany(300)
    render(<StocktakePage />)
    fireEvent.click(screen.getByText(/بدء الجرد/))
    expect(document.querySelectorAll('[data-stocktake-row]').length).toBe(200)
    expect(screen.getByText(/يُعرض 200 من 300 صنفاً/)).toBeTruthy()
  })

  it('البحث يضيّق الصفوف بالاسم أو الباركود فوراً', () => {
    seedMany(300)
    render(<StocktakePage />)
    fireEvent.click(screen.getByText(/بدء الجرد/))
    fireEvent.change(document.querySelector('[data-stocktake-search]')!, { target: { value: 'صنف 217' } })
    expect(document.querySelectorAll('[data-stocktake-row]').length).toBe(1)
    fireEvent.change(document.querySelector('[data-stocktake-search]')!, { target: { value: '628000000255' } })
    expect(document.querySelectorAll('[data-stocktake-row]').length).toBe(1)
  })

  it('مرشّح «المعدود فقط» يعرض ما مُسح وحده بعد مسح الباركود', () => {
    seedMany(300)
    render(<StocktakePage />)
    fireEvent.click(screen.getByText(/بدء الجرد/))
    const scanInput = screen.getByPlaceholderText(/امسح الباركود/)
    fireEvent.change(scanInput, { target: { value: '628000000042' } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    fireEvent.click(document.querySelector('[data-stocktake-counted-only="true"]')!)
    const rows = document.querySelectorAll('[data-stocktake-row]')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('صنف 42')
  })
})
