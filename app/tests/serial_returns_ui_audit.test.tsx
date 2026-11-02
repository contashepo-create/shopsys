import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SaleReturnsPage } from '../src/ui/pages/SaleReturnsPage.tsx'
import { PurchaseReturnsPage } from '../src/ui/pages/PurchaseReturnsPage.tsx'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function fixture(sell: boolean) {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], serials: [], journal: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', isMain: true }] })
  const s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: true, warrantyMonths: 12, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0], supplier = useDataStore.getState().suppliers[0]
  const purchase = s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-1\nSER-2' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  const sale = sell ? s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-1', 'SER-2'] }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false }) : null
  return { purchase, sale, item }
}
it('يطلب معالج بيع اختيار السيريال قبل متابعة المرتجع ويعرض المختار في المراجعة', () => {
  const { sale } = fixture(true)
  render(<MemoryRouter><SaleReturnsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /مرتجع جديد/ }))
  fireEvent.click(screen.getByText(sale!.invoiceNumber))
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
  expect((screen.getByRole('button', { name: /التالي/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('SER-2'))
  expect((screen.getByRole('button', { name: /التالي/ }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
  fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
  expect(screen.getByText('SER-2')).toBeTruthy()
})
it('يعرض مرتجع الشراء اختيار السيريال مع التعبئة الصحيحة بفهرس السطر', () => {
  const { purchase, item } = fixture(false)
  render(<MemoryRouter initialEntries={[`/returns?purchase=${purchase.id}&item=${item.id}&qty=1`]}><PurchaseReturnsPage /></MemoryRouter>)
  expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('1')
  fireEvent.click(screen.getByLabelText('SER-2'))
  expect((screen.getByLabelText('SER-2') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('SER-1') as HTMLInputElement).checked).toBe(false)
})
