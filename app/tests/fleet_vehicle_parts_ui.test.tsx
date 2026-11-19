import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ConfirmHost, acceptConfirmDialog, cancelConfirmDialog } from './helpers/confirmUi.tsx'
import { MemoryRouter } from 'react-router-dom'
import { FleetPage } from '../src/ui/pages/FleetPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

/**
 * مخزون قطع الغيار — `addVehiclePart` و`updateVehiclePart` و`removeVehiclePart`
 * كانت منفّذة ومحروسة في النواة بلا شاشة: القطعة تدخل السجل من نموذج المصروف
 * فقط، فلا تُصحَّح تكلفتها ولا يُضبط رصيدها ولا يُحدَّد حد إعادة الطلب.
 */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const part = (id: number, nameAr: string, qty: number, unitCostMinor: number, minQty = 0) => ({ id, nameAr, qty, unitCostMinor, minQty, notes: '' })

beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'SA' as const, activityId: 'transport' as const, vatPercent: 0 }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...initial, currentUserId: null, activeBranchId: null, branches: [],
    vehicles: [], employees: [], trips: [], vehicleCostEntries: [], vehicleParts: [part(1, 'فلتر زيت', 2, 12_500, 3)] as never,
  })
  useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(initial); useAppStore.setState(app) })

const inputs = () => [...document.querySelectorAll('[data-vehicle-part-form] input')] as HTMLInputElement[]

it('يضيف قطعة غيار جديدة بمخزونها وحد إعادة الطلب', async () => {
  render(<MemoryRouter><FleetPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-add-vehicle-part]') as HTMLElement)
  const [name, qty, minQty, cost, notes] = inputs()
  fireEvent.change(name, { target: { value: 'طرمبة بنزين' } })
  fireEvent.change(qty, { target: { value: '4' } })
  fireEvent.change(minQty, { target: { value: '2' } })
  fireEvent.change(cost, { target: { value: '350.5' } })
  fireEvent.change(notes, { target: { value: 'أصلية' } })
  fireEvent.click(document.querySelector('[data-vehicle-part-save]') as HTMLElement)

  await waitFor(() => expect(useRawDataStore.getState().vehicleParts).toHaveLength(2))
  expect(useRawDataStore.getState().vehicleParts.at(-1)).toMatchObject({ nameAr: 'طرمبة بنزين', qty: 4, minQty: 2, unitCostMinor: 35_050, notes: 'أصلية' })
  expect(useToast.getState().msg).toContain('أُضيفت قطعة')
  await waitFor(() => expect(document.querySelector('[data-vehicle-part-form]')).toBeNull())
})

it('يعدّل رصيد قطعة قائمة بدل إضافة نسخة مكررة', async () => {
  render(<MemoryRouter><FleetPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-vehicle-part-edit="1"]') as HTMLElement)
  const [name, qty] = inputs()
  expect((name as HTMLInputElement).value).toBe('فلتر زيت')
  fireEvent.change(qty, { target: { value: '9' } })
  fireEvent.click(document.querySelector('[data-vehicle-part-save]') as HTMLElement)

  await waitFor(() => expect(useRawDataStore.getState().vehicleParts[0].qty).toBe(9))
  expect(useRawDataStore.getState().vehicleParts).toHaveLength(1)
  expect(useToast.getState().msg).toContain('حُدِّثت قطعة')
})

it('ينبّه على القطع التي وصلت حد إعادة الطلب ويحذف بعد التأكيد', async () => {
  render(<MemoryRouter><ConfirmHost /><FleetPage /></MemoryRouter>)
  // الرصيد ٢ وحد الطلب ٣ ⇒ تنبيه ظاهر
  expect(document.body.textContent).toContain('قطع وصلت حد إعادة الطلب')
  fireEvent.click(document.querySelector('[data-vehicle-part-remove="1"]') as HTMLElement)
  await acceptConfirmDialog()
  await waitFor(() => expect(useRawDataStore.getState().vehicleParts).toHaveLength(0))
  expect(useToast.getState().msg).toContain('حُذفت')
})

it('لا يحذف القطعة إن رُفض التأكيد', async () => {
  render(<MemoryRouter><ConfirmHost /><FleetPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-vehicle-part-remove="1"]') as HTMLElement)
  await cancelConfirmDialog()
  expect(useRawDataStore.getState().vehicleParts).toHaveLength(1)
  expect(useToast.getState().msg).toBeNull()
})
