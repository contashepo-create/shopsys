import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SaleReturnsPage } from '../src/ui/pages/SaleReturnsPage.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يطلب فحص الدفعات المستلمة ويعيد طلب التأكيد بعد تغيير الكمية ثم يرحلها', async () => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [{ id: 1, nameAr: 'دواء', sku: 'D', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockValueMinor: 300, stockQty: 3, priceMinor: 1000, minQty: 0, isActive: true, trackExpiry: true }] as never, warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], journal: [], batches: [{ id: 1, itemId: 1, qty: 3, expiryDate: '2099-01-01', lotNumber: 'LOT', purchaseId: 1, receivedAt: '2026-01-01', warehouseId: 1 }] })
 const sale = useDataStore.getState().postSale({ lines: [{ itemId: 1, nameAr: 'دواء', qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 render(<MemoryRouter><SaleReturnsPage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /مرتجع جديد/ }))
 fireEvent.click(screen.getByText(sale.invoiceNumber))
 fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
 const next = screen.getByRole('button', { name: /التالي/ }) as HTMLButtonElement
 expect(next.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('كمية الدفعة LOT المرتجعة بالوحدة الأساسية'), { target: { value: '1' } })
 expect(next.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText('أؤكد فحص الدفعات والكميات المستلمة فعلياً'))
 expect(next.disabled).toBe(false)
 fireEvent.change(screen.getByLabelText('كمية الدفعة LOT المرتجعة بالوحدة الأساسية'), { target: { value: '2' } })
 expect(next.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('كمية الدفعة LOT المرتجعة بالوحدة الأساسية'), { target: { value: '1' } })
 // لا يعتبر تغيير الكمية والعودة إليها إقراراً جديداً؛ يلزم التحقق مجدداً.
 expect((screen.getByLabelText('أؤكد فحص الدفعات والكميات المستلمة فعلياً') as HTMLInputElement).checked).toBe(false)
 fireEvent.click(screen.getByLabelText('أؤكد فحص الدفعات والكميات المستلمة فعلياً'))
 fireEvent.click(next)
 fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
 expect(screen.getByText(/دفعة LOT · صلاحية 2099-01-01 · كمية 1/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: /تأكيد وترحيل المرتجع/ }))
 await waitFor(() => expect(useDataStore.getState().saleReturns).toHaveLength(1))
 expect(useDataStore.getState().batches[0].qty).toBe(2)
})
