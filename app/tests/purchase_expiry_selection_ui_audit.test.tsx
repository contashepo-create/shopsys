import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PurchaseReturnsPage } from '../src/ui/pages/PurchaseReturnsPage.tsx'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يطلب اختيار دفعة الشراء الفعلية والإقرار مجدداً عند تغيير الكمية', async () => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [], batches: [], serials: [], transfers: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'فرعي', isMain: false }] as never })
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 100, warehouseId: 2, expiryDate: '2099-01-01', lotNumber: 'LOT-B' }], expenses: [], paidMinor: 0, notes: '' })
 render(<MemoryRouter><PurchaseReturnsPage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /مرتجع شراء جديد/ }))
 fireEvent.click(screen.getByText(p.invoiceNumber))
 const qty = screen.getByPlaceholderText('0')
 fireEvent.change(qty, { target: { value: '1' } })
 const submit = screen.getByRole('button', { name: /تنفيذ المرتجع/ }) as HTMLButtonElement
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText('اختيار دفعة LOT-B للمورد'))
 fireEvent.click(screen.getByLabelText('أؤكد فحص الدفعات والكميات الخارجة فعلياً للمورد'))
 expect(submit.disabled).toBe(false)
 fireEvent.change(qty, { target: { value: '2' } })
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText('أؤكد فحص الدفعات والكميات الخارجة فعلياً للمورد'))
 fireEvent.click(submit)
 await waitFor(() => expect(useRawDataStore.getState().purchaseReturns).toHaveLength(1))
 expect(useRawDataStore.getState().batches[0].qty).toBe(1)
})
