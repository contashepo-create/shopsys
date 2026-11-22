import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ConfirmHost, acceptConfirmDialog, cancelConfirmDialog } from './helpers/confirmUi.tsx'
import { RecipesPage } from '../src/ui/pages/RecipesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

/**
 * إدارة التركيبات المحفوظة — `updateRecipe` و`toggleRecipe` و`removeRecipe`
 * و`getRecipeUnitCost` كانت منفّذة ومختبرة في النواة وبلا أي شاشة تناديها،
 * فالشاشة تحفظ التركيبة فقط: لا تصحيح لمكوناتها، ولا تعطيل، ولا حذف،
 * فتبقى التركيبة الخاطئة تُحمَّل في أوامر الإنتاج إلى الأبد.
 */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const item = (id: number, nameAr: string, costMinor: number) => ({
  id, nameAr, sku: `SKU-${id}`, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [],
  costMinor, stockQty: 100, priceMinor: costMinor * 2, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
})

// لتر عصير ناتج عن ٢ كجم برتقال + ١ كجم سكر
const recipe = {
  id: 7, productItemId: 3, mode: 'prepped' as const, yieldQty: 4,
  ingredients: [{ itemId: 1, qty: 2 }, { itemId: 2, qty: 1 }], overheadMinor: 0, isActive: true, notes: 'وصفة الصيف',
}

beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'SA' as const, activityId: 'restaurant' as const, vatPercent: 0 }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...initial, currentUserId: null, activeBranchId: null, branches: [],
    items: [item(1, 'برتقال طازج', 1_000), item(2, 'سكر', 500), item(3, 'عصير برتقال', 0)] as never,
    recipes: [{ ...recipe }] as never, productionOrders: [], processingOrders: [], stocktakes: [],
    warehouses: [], transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], customAccounts: [],
  })
  useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(initial); useAppStore.setState(app) })

it('يعرض تكلفة الوحدة محسوبة من الخامات الحالية', () => {
  render(<RecipesPage />)
  // ٢×١٠٠٠ + ١×٥٠٠ = ٢٥٠٠ على ناتج ٤ وحدات ⇒ ٦٢٥ لكل وحدة = 6.25
  expect(document.querySelector('[data-recipe-unit-cost="7"]')?.textContent).toBe('6.25')
})

it('يعطّل التركيبة ثم يعيد تفعيلها من نفس الزر', async () => {
  render(<RecipesPage />)
  fireEvent.click(document.querySelector('[data-recipe-toggle="7"]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().recipes[0].isActive).toBe(false))
  fireEvent.click(document.querySelector('[data-recipe-toggle="7"]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().recipes[0].isActive).toBe(true))
})

it('يعدّل تركيبة محفوظة بدل إنشاء نسخة مكررة', async () => {
  render(<RecipesPage />)
  fireEvent.click(document.querySelector('[data-recipe-edit="7"]') as HTMLElement)
  await waitFor(() => expect((document.querySelector('[data-save-recipe]') as HTMLButtonElement).textContent).toContain('حفظ تعديل التركيبة'))

  // الكمية الناتجة ٤ محمّلة سلفاً؛ نغيّرها إلى ٨ ثم نحفظ
  const qtyInput = document.querySelector('input[placeholder="مثال: 3"]') as HTMLInputElement
  fireEvent.change(qtyInput, { target: { value: '8' } })
  fireEvent.click(document.querySelector('[data-save-recipe]') as HTMLElement)

  await waitFor(() => expect(useRawDataStore.getState().recipes[0].yieldQty).toBe(8))
  expect(useRawDataStore.getState().recipes).toHaveLength(1)
  expect(useRawDataStore.getState().recipes[0]).toMatchObject({ mode: 'prepped', isActive: true, notes: 'وصفة الصيف' })
  expect(useToast.getState().msg).toContain('حُدِّثت التركيبة')
  await waitFor(() => expect((document.querySelector('[data-save-recipe]') as HTMLButtonElement).textContent).toContain('حفظ كتركيبة'))
})

it('يحذف التركيبة بعد تأكيد صريح', async () => {
  render(<MemoryRouter><ConfirmHost /><RecipesPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-recipe-remove="7"]') as HTMLElement)
  await acceptConfirmDialog()
  await waitFor(() => expect(useRawDataStore.getState().recipes).toHaveLength(0))
  expect(useToast.getState().msg).toContain('حُذفت تركيبة')
  expect(document.querySelector('[data-recipes-panel]')).toBeNull()
})

it('لا يحذف التركيبة إن رفض المستخدم التأكيد', async () => {
  render(<MemoryRouter><ConfirmHost /><RecipesPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-recipe-remove="7"]') as HTMLElement)
  await cancelConfirmDialog()
  expect(useRawDataStore.getState().recipes).toHaveLength(1)
})
