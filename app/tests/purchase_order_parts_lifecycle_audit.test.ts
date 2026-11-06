import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  const setup = { ...app.setup, taxRegistrationStatus: 'not_registered' as const, vatPercent: 0 }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'قطعة', stockQty: 10, costMinor: 1000, priceMinor: 1500, isService: false }, { ...draftFromCategory(undefined, 'B'), id: 2, nameAr: 'قطعة أخرى', stockQty: 0, costMinor: 1000, priceMinor: 1500, isService: false }], purchaseOrders: [], pendingPartOrders: [], purchases: [], journal: [], serials: [], batches: [], variantStocks: [], warehouses: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
const createOrder = () => S().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد', date: '2026-01-01', expectedDate: '', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'قطعة', qty: 1, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 1000, vatPercent: 0, notes: '' }] })
const addPart = (orderId: number | null, itemId = 1, qty = 1) => S().addPendingPartOrder({ itemId, itemNameAr: '', customerId: null, customerName: 'عميل', customerPhone: '', qty, orderedAt: '2026-01-01', linkedPurchaseOrderId: orderId })
const closeOrder = (id: number) => S().postPurchase({ sourcePurchaseOrderId: id, supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty: 1, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })

describe('سلامة وصول القطع عند تغير الطلبات بعد إغلاق الأمر', () => {
  it('إعادة فتح طلب ملغى تبطل وصولاً آلياً لم يعد مغطى في التحديث نفسه', () => {
    const order = createOrder()
    const first = addPart(order.id), second = addPart(order.id)
    S().setPendingPartOrderStatus(second.id, 'cancelled')
    closeOrder(order.id)
    expect(S().pendingPartOrders.find(row => row.id === first.id)?.status).toBe('arrived')
    const observations: string[][] = []
    const unsubscribe = useRawDataStore.subscribe(state => observations.push(state.pendingPartOrders.map(row => row.status)))
    S().setPendingPartOrderStatus(second.id, 'pending')
    unsubscribe()
    expect(observations).toEqual([['pending', 'pending']])
    expect(S().pendingPartOrders.map(row => row.status)).toEqual(['pending', 'pending'])
    expect(S().pendingPartOrders[0].autoArrivedFromPurchaseOrderId).toBeNull()
  })
  it('لا يتراجع عن وصول يدوي أو عن تسليم رغم نقص التغطية', () => {
    const order = createOrder()
    const automatic = addPart(order.id), manual = addPart(order.id), delivered = addPart(order.id), cancelled = addPart(order.id)
    S().setPendingPartOrderStatus(manual.id, 'arrived')
    S().setPendingPartOrderStatus(delivered.id, 'delivered')
    S().setPendingPartOrderStatus(cancelled.id, 'cancelled')
    // تعذرت التغطية بالفعل، فنحاكي وصولاً آلياً تاريخياً ثم نغيّر طلباً مرتبطاً.
    closeOrder(order.id)
    useRawDataStore.setState({ pendingPartOrders: S().pendingPartOrders.map(row => row.id === automatic.id ? { ...row, status: 'arrived', autoArrivedFromPurchaseOrderId: order.id, arrivedAt: '2026-01-01' } : row) })
    S().setPendingPartOrderStatus(cancelled.id, 'pending')
    expect(S().pendingPartOrders.find(row => row.id === automatic.id)?.status).toBe('pending')
    expect(S().pendingPartOrders.find(row => row.id === manual.id)?.status).toBe('arrived')
    expect(S().pendingPartOrders.find(row => row.id === delivered.id)?.status).toBe('delivered')
  })
  it('إذا ظلت المطالبات مغطاة لا تتغير حالة الوصول الآلي عند إعادة طلب ملغى', () => {
    const order = createOrder()
    const first = addPart(order.id, 1, 0.5), second = addPart(order.id, 1, 0.5)
    S().setPendingPartOrderStatus(second.id, 'cancelled')
    closeOrder(order.id)
    S().setPendingPartOrderStatus(second.id, 'pending')
    expect(S().pendingPartOrders.find(row => row.id === first.id)?.status).toBe('arrived')
    expect(S().pendingPartOrders.find(row => row.id === second.id)?.status).toBe('pending')
  })
  it('يرفض رابط أمر مكتمل أو ملغى أو مفقود أو صنف غير موجود فيه', () => {
    const first = createOrder()
    expect(() => addPart(999)).toThrow(/أمر الشراء/)
    expect(() => addPart(first.id, 2)).toThrow(/صنف/)
    S().setPurchaseOrderStatus(first.id, 'cancelled')
    expect(() => addPart(first.id)).toThrow(/أمر الشراء/)
    const second = createOrder()
    closeOrder(second.id)
    expect(() => addPart(second.id)).toThrow(/أمر الشراء/)
    expect(S().pendingPartOrders).toHaveLength(0)
  })
  it('لا يقبل كميات غير دقيقة أو غير منتهية ولا يغير حالة الطلبات عند الرفض', () => {
    const order = createOrder()
    expect(() => addPart(order.id, 1, Infinity)).toThrow(/كمية/)
    expect(() => addPart(order.id, 1, 0.0001)).toThrow(/كمية/)
    expect(S().pendingPartOrders).toHaveLength(0)
  })
})
