import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { LabReferrersPage } from '../src/ui/pages/LabPages.tsx'
import { JewelryPage } from '../src/ui/pages/JewelryPage.tsx'
import { DeliveryTasksPage } from '../src/ui/pages/DeliveryTasksPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

/**
 * تصحيح الملفات المرجعية وحذف الجدولة الخاطئة — أربع عمليات كانت منفّذة في النواة
 * وبلا شاشة تناديها: تصحيح نسبة جهة التأمين، تصحيح نسبة الطبيب المُحيل،
 * إزالة الوصف الذهبي، وإلغاء جدولة توصيل. فتبقى النسبة الخاطئة أو الوصف الخاطئ
 * نافذاً إلى الأبد، والجدولة الخاطئة تُربك المندوب بلا مخرج.
 */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const base = () => {
  const setup = { ...app.setup, completed: true, countryCode: 'SA' as const, activityId: 'pharmacy' as const, vatPercent: 0 }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...initial, currentUserId: null, activeBranchId: null, branches: [],
    insuranceProviders: [{ id: 1, nameAr: 'بوبا', coveragePercent: 80, phone: '011', notes: '', isActive: true }] as never,
    insuranceClaims: [], items: [], paymentTerminals: [], treasuries: [],
    labReferrers: [{ id: 3, nameAr: 'د. سعد', phone: '050', commissionPercent: 10, notes: '', isActive: true }] as never,
    labOrders: [], sales: [], deliveryJobs: [], jewelryProfiles: [], gramPrices: { k18: 0, k21: 0, k24: 0, updatedAt: '' }, scrapLots: [], scrapSales: [], goldTradeIns: [], customers: [],
  })
  useToast.setState({ msg: null, kind: 'success' })
}

beforeEach(base)
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(initial); useAppStore.setState(app) })

it('يصحّح نسبة تحمّل جهة التأمين من زر تعديل', async () => {
  render(<InsuranceProvidersSection />)
  fireEvent.click(document.querySelector('[data-insurance-provider-edit="1"]') as HTMLElement)
  const percent = document.querySelector('[data-insurance-provider-save]')!.closest('div')!.parentElement!.querySelectorAll('input')[1] as HTMLInputElement
  expect(percent.value).toBe('80')
  fireEvent.change(percent, { target: { value: '65' } })
  fireEvent.click(document.querySelector('[data-insurance-provider-save]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().insuranceProviders[0].coveragePercent).toBe(65))
  expect(useRawDataStore.getState().insuranceProviders).toHaveLength(1)
  expect(useToast.getState().msg).toContain('حُدِّثت الجهة')
})

it('يصحّح نسبة عمولة الطبيب المُحيل دون تكرار ملفه', async () => {
  render(<MemoryRouter><LabReferrersPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-lab-referrer-edit="3"]') as HTMLElement)
  const inputs = [...document.querySelectorAll('.fixed input')] as HTMLInputElement[]
  expect(inputs[0].value).toBe('د. سعد')
  fireEvent.change(inputs[2], { target: { value: '7.5' } })
  fireEvent.click(document.querySelector('[data-lab-referrer-save]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().labReferrers[0].commissionPercent).toBe(7.5))
  expect(useRawDataStore.getState().labReferrers).toHaveLength(1)
  expect(useToast.getState().msg).toContain('حُدِّث ملف الطبيب')
})

it('يزيل الوصف الذهبي بعد التأكيد ويبقي الصنف', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const item = { id: 9, nameAr: 'خاتم 21', sku: 'G9', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 1, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }
  useRawDataStore.setState({
    items: [item] as never,
    jewelryProfiles: [{ itemId: 9, karat: 'k21', weightGrams: 5, workmanshipMinor: 10_000, makingCostMode: 'fixed' }] as never,
    gramPrices: { k18: 0, k21: 300_000, k24: 0, updatedAt: '2026-11-17T08:00:00Z' } as never,
  })
  render(<MemoryRouter><JewelryPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-remove-jewelry-profile="9"]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().jewelryProfiles).toHaveLength(0))
  expect(useRawDataStore.getState().items).toHaveLength(1)
  expect(useToast.getState().msg).toContain('أُزيل وصف')
})

it('يلغي جدولة توصيل لم تبدأ ولا يمسّ طلباً بدأ تنفيذه', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  useRawDataStore.setState({
    sales: [{ id: 1, invoiceNumber: 'INV-1' }, { id: 2, invoiceNumber: 'INV-2' }] as never,
    deliveryJobs: [
      { id: 4, saleId: 1, scheduledAt: '2026-11-18', status: 'scheduled', completedAt: null, assignedTo: 'خالد' },
      { id: 5, saleId: 2, scheduledAt: '2026-11-18', status: 'in_progress', completedAt: null, assignedTo: 'خالد' },
    ] as never,
  })
  render(<MemoryRouter><DeliveryTasksPage /></MemoryRouter>)
  expect(document.querySelector('[data-delete-delivery-job="5"]')).toBeNull()
  fireEvent.click(document.querySelector('[data-delete-delivery-job="4"]') as HTMLElement)
  await waitFor(() => expect(useRawDataStore.getState().deliveryJobs.map((job) => job.id)).toEqual([5]))
  expect(useToast.getState().msg).toContain('أُلغيت الجدولة')
})
