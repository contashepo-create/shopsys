import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SaleReturnsPage } from '../src/ui/pages/SaleReturnsPage.tsx'
import { PurchaseReturnsPage } from '../src/ui/pages/PurchaseReturnsPage.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'
const control = vi.hoisted(() => ({ approve: null as null | (() => void), before: null as null | (() => void), failAfter: false, hold: false, release: null as null | (() => void) }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: true, request: (cb: () => void) => { control.approve = cb } }) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (control.hold) await new Promise<void>(resolve => { control.release = resolve })
 control.before?.(); const result = commit(); if (control.failAfter) throw new Error('flush failed'); return result
} }))
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', allowNegativeTreasury: true, requireOpenShiftForSales: false, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, branches: [], activeBranchId: null, items: [], customers: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [], batches: [], serials: [], variantStocks: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] as never })
 control.approve = null; control.before = null; control.failAfter = false; control.hold = false; control.release = null
 useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function setup(kind: 'sale' | 'purchase') {
 const s = useRawDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'سلعة', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0], supplier = useRawDataStore.getState().suppliers[0]
 const purchase = s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 4, unitPriceMinor: 100, warehouseId: 1 }], expenses: [], paidMinor: 400, treasury: '1101', notes: '' })
 if (kind === 'sale') {
  const sale = useRawDataStore.getState().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, warehouseId: 1 }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  render(<MemoryRouter><SaleReturnsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /مرتجع جديد/ })); fireEvent.click(screen.getByText(sale.invoiceNumber))
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: /التالي/ })); fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
  fireEvent.click(screen.getByRole('button', { name: /تأكيد وترحيل المرتجع/ }))
 } else {
  render(<MemoryRouter><PurchaseReturnsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /مرتجع شراء جديد/ })); fireEvent.click(screen.getByText(purchase.invoiceNumber))
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: /تنفيذ المرتجع/ }))
 }
 expect(control.approve).not.toBeNull()
}
for (const kind of ['sale', 'purchase'] as const) {
 const returns = () => kind === 'sale' ? useRawDataStore.getState().saleReturns : useRawDataStore.getState().purchaseReturns
 it(`${kind}: يرفض تغيير الأساس قبل الاعتماد`, () => {
  setup(kind); useRawDataStore.setState({ activeBranchId: 2 }); act(() => control.approve?.())
  expect(returns()).toHaveLength(0); expect(useToast.getState().msg).toContain('قبل الاعتماد')
 })
 it(`${kind}: يرفض تغير المسودة أثناء انتظار موافقة المشرف`, () => {
  setup(kind)
  if (kind === 'sale') { fireEvent.click(screen.getByRole('button', { name: /السابق/ })); fireEvent.click(screen.getByRole('button', { name: /السابق/ })); fireEvent.change(screen.getByPlaceholderText('تفاصيل إضافية (اختياري)…'), { target: { value: 'سبب مختلف' } }) }
  else fireEvent.change(screen.getByPlaceholderText(/سبب الإرجاع/), { target: { value: 'سبب مختلف' } })
  act(() => control.approve?.())
  expect(returns()).toHaveLength(0); expect(useToast.getState().msg).toContain('قبل الاعتماد')
 })
 it(`${kind}: يرفض تغير الأساس بعد إعادة التحميل وقبل التسجيل`, async () => {
  setup(kind); control.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }
  act(() => control.approve?.()); await waitFor(() => expect(useToast.getState().msg).toContain('قبل الترحيل'))
  expect(returns()).toHaveLength(0)
 })
 it(`${kind}: لا يكرر أثناء القفل ويحذر إذا تعذر تأكيد الحفظ بعد التسجيل`, async () => {
  setup(kind); control.hold = true; control.failAfter = true
  const approve = control.approve!; act(() => { approve(); approve() })
  await act(async () => { control.release?.(); await Promise.resolve() })
  await waitFor(() => expect(useToast.getState().msg).toContain('سُجل المرتجع محلياً'))
  expect(returns()).toHaveLength(1)
  expect(screen.queryByRole('button', { name: kind === 'sale' ? /تأكيد وترحيل المرتجع/ : /تنفيذ المرتجع/ })).toBeNull()
 })
}
