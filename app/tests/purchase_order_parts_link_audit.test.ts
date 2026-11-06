import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, taxRegistrationStatus: 'not_registered' as const, vatPercent: 0 }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'صنف', stockQty: 10, costMinor: 1000, priceMinor: 1500, isService: false }], purchaseOrders: [], pendingPartOrders: [], purchases: [], journal: [], serials: [], batches: [], variantStocks: [], warehouses: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function setup(qty: number) {
 const order = S().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد', date: '2026-01-01', expectedDate: '', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'صنف', qty, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 1000, vatPercent: 0, notes: '' }] })
 return order
}
function post(id: number, qty: number) { return S().postPurchase({ sourcePurchaseOrderId: id, supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' }) }
it('إغلاق أمر لا يعلن وصول طلب قطعة لصنف مختلف', () => {
 const order = setup(1)
 useRawDataStore.setState({ pendingPartOrders: [{ id: 1, itemId: 2, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending', arrivedAt: null }] as never })
 post(order.id, 1)
 expect(S().pendingPartOrders[0].status).toBe('pending')
})
it('لا يعلن وصول طلبات تزيد كميتها المجمعة على مستلم الأمر', () => {
 const order = setup(1)
 useRawDataStore.setState({ pendingPartOrders: [{ id: 1, itemId: 1, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending' }, { id: 2, itemId: 1, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending' }] as never })
 post(order.id, 1)
 expect(S().pendingPartOrders.map(row => row.status)).toEqual(['pending', 'pending'])
})
it('الاستلام القديم بلا فاتورة يخضع لنفس حارس الصنف والكمية', () => {
 const order = setup(1)
 useRawDataStore.setState({ pendingPartOrders: [{ id: 1, itemId: 2, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending' }] as never })
 S().receivePurchaseOrder(order.id, [{ itemId: 1, qty: 1 }])
 expect(S().pendingPartOrders[0].status).toBe('pending')
})
it('طلبات الكمية المثبتة تستقبل آلياً، والملغى لا يستهلك منها', () => {
 const order = setup(2)
 useRawDataStore.setState({ pendingPartOrders: [{ id: 1, itemId: 1, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending' }, { id: 2, itemId: 1, qty: 1, linkedPurchaseOrderId: order.id, status: 'pending' }, { id: 3, itemId: 1, qty: 100, linkedPurchaseOrderId: order.id, status: 'cancelled' }] as never })
 post(order.id, 2)
 expect(S().pendingPartOrders.map(row => row.status)).toEqual(['arrived', 'arrived', 'cancelled'])
})
