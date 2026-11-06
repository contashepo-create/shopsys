import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), originalApp = useAppStore.getState()
const S = () => useRawDataStore.getState()
const input = (sourcePurchaseOrderId: number, qty: number, sourceDraftId: string) => ({
  sourcePurchaseOrderId, sourceDraftId, supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty, unitPriceMinor: 1000, vatPercent: 0 }], expenses: [], paidMinor: 0, notes: '',
})
const addOrder = (qty = 3) => S().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد', date: '2026-01-01', expectedDate: '2026-01-01', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'صنف', qty, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 1000, vatPercent: 0, notes: '' }] })

beforeEach(() => {
  const setup = { ...originalApp.setup, taxRegistrationStatus: 'not_registered' as const, vatPercent: 0, requireOpenShiftForSales: false }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'صنف', costMinor: 1000, priceMinor: 1500, stockQty: 10, isService: false }], purchases: [], purchaseOrders: [], purchaseReturns: [], journal: [], pendingPartOrders: [], warehouses: [], serials: [], batches: [], variantStocks: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(originalApp) })

describe('ترحيل فاتورة وأمر شراء كوحدة واحدة', () => {
  it('المراقب لا يرى فاتورة دون ارتباطها بالأمر ويُعاد الطلب نفسه بلا مضاعفة', () => {
    const order = addOrder()
    const observations: { purchases: number; received: number; invoiceIds: number[] }[] = []
    const unsubscribe = useRawDataStore.subscribe(state => { observations.push({ purchases: state.purchases.length, received: state.purchaseOrders[0].lines[0].receivedQty, invoiceIds: state.purchaseOrders[0].invoiceIds }) })
    try {
      const first = S().postPurchase(input(order.id, 3, 'same-request'))
      expect(S().purchaseOrders[0].status).toBe('closed')
      expect(S().purchaseOrders[0].invoiceIds).toEqual([first.id])
      expect(observations.filter(row => row.purchases > 0)).toEqual([{ purchases: 1, received: 3, invoiceIds: [first.id] }])
      const second = S().postPurchase(input(order.id, 3, 'same-request'))
      expect(second.id).toBe(first.id)
      expect(S().purchases).toHaveLength(1)
      expect(S().journal).toHaveLength(1)
      expect(S().purchaseOrders[0].lines[0].receivedQty).toBe(3)
    } finally { unsubscribe() }
  })
  it('طلب الاعتماد يحفظ ارتباط الأمر وينفذ الفاتورة والاستلام معاً عند الاعتماد', () => {
    const order = addOrder()
    useAppStore.setState({ approvals: { enabled: true, scope: ['purchase'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
    useRawDataStore.setState({ currentUserId: 5, appUsers: [{ id: 5, nameAr: 'مستخدم', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never, docApprovals: [] })
    expect(() => S().postPurchase(input(order.id, 3, 'approve'))).toThrow(/الاعتماد/)
    expect(S().purchases).toHaveLength(0)
    expect(S().purchaseOrders[0].lines[0].receivedQty).toBe(0)
    const request = S().docApprovals[0]
    expect(JSON.parse(request.payload).sourcePurchaseOrderId).toBe(order.id)
    useRawDataStore.setState({ currentUserId: null })
    S().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
    expect(S().purchases).toHaveLength(1)
    expect(S().purchaseOrders[0].invoiceIds).toEqual([S().purchases[0].id])
    expect(S().purchaseOrders[0].status).toBe('closed')
  })
  it('الاعتماد المتأخر يراجع المتبقي ولا يرحّل طلباً تقادمت كميته', () => {
    const order = addOrder(3)
    useAppStore.setState({ approvals: { enabled: true, scope: ['purchase'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
    useRawDataStore.setState({ currentUserId: 5, appUsers: [{ id: 5, nameAr: 'مستخدم', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never, docApprovals: [] })
    expect(() => S().postPurchase(input(order.id, 2, 'waiting'))).toThrow(/الاعتماد/)
    const request = S().docApprovals[0]
    useRawDataStore.setState({ currentUserId: null })
    S().postPurchase(input(order.id, 2, 'other'))
    expect(() => S().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })).toThrow(/المتبقي/)
    expect(S().purchases).toHaveLength(1)
    expect(S().docApprovals[0].status).toBe('pending')
    expect(S().purchaseOrders[0].lines[0].receivedQty).toBe(2)
  })
  it('مسودة متقادمة لا تكرر استقبال كمية استُلمت بفاتورة أخرى', () => {
    const order = addOrder(3)
    S().postPurchase(input(order.id, 2, 'first'))
    const before = { purchases: S().purchases, journal: S().journal, items: S().items, orders: S().purchaseOrders }
    expect(() => S().postPurchase(input(order.id, 2, 'second'))).toThrow(/المتبقي/)
    expect(S().purchases).toBe(before.purchases)
    expect(S().journal).toBe(before.journal)
    expect(S().items).toBe(before.items)
    expect(S().purchaseOrders).toBe(before.orders)
  })
  it('تكرار ربط فاتورة استلام جزئي لا يضيف كميتها مرة ثانية', () => {
    const order = addOrder(3)
    const invoice = S().postPurchase(input(order.id, 1, 'partial'))
    S().receivePurchaseOrder(order.id, [{ itemId: 1, qty: 1 }], invoice.id)
    expect(S().purchaseOrders[0].lines[0].receivedQty).toBe(1)
    expect(S().purchaseOrders[0].status).toBe('partial')
  })
  it('السطور المكررة توزع على بنود الأمر مرة واحدة ويصل طلب القطعة عند الإكمال', () => {
    const order = S().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد', date: '2026-01-01', expectedDate: '2026-01-01', warehouseId: null, notes: '', lines: [1, 2].map(qty => ({ itemId: 1, nameAr: 'صنف', qty, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 1000, vatPercent: 0, notes: '' })) })
    useRawDataStore.setState({ pendingPartOrders: [{ id: 1, linkedPurchaseOrderId: order.id, status: 'pending' }] as never })
    const args = input(order.id, 1, 'split')
    const invoice = S().postPurchase({ ...args, lines: [...args.lines, { ...args.lines[0], qty: 2 }] })
    expect(S().purchaseOrders[0].lines.map(line => line.receivedQty)).toEqual([1, 2])
    expect(S().pendingPartOrders[0].status).toBe('arrived')
    S().receivePurchaseOrder(order.id, [{ itemId: 1, qty: 3 }], invoice.id)
    expect(S().purchaseOrders[0].lines.map(line => line.receivedQty)).toEqual([1, 2])
    expect(S().purchaseOrders[0].invoiceIds).toEqual([invoice.id])
  })
  it('يرفض أصنافاً خارجة عن الأمر دون تغيير المخزون أو الدفتر', () => {
    const order = addOrder()
    const secondItem = { ...draftFromCategory(undefined, 'B'), id: 2, nameAr: 'آخر', costMinor: 1000, priceMinor: 1500, stockQty: 2, isService: false }
    useRawDataStore.setState({ items: [...S().items, secondItem] })
    const before = { items: S().items, journal: S().journal, orders: S().purchaseOrders }
    const args = input(order.id, 1, 'extra')
    expect(() => S().postPurchase({ ...args, lines: [...args.lines, { ...args.lines[0], itemId: 2 }] })).toThrow(/لا تنتمي/)
    expect(S().items).toBe(before.items)
    expect(S().journal).toBe(before.journal)
    expect(S().purchaseOrders).toBe(before.orders)
  })
  it('إعادة إرسال فاتورة تاريخية لم تربط بالأمر لا تربطها تلقائياً ولا تنشئ نسخة جديدة', () => {
    const order = addOrder()
    const originalInvoice = S().postPurchase({ ...input(order.id, 1, 'old'), sourcePurchaseOrderId: null })
    expect(() => S().postPurchase(input(order.id, 1, 'old'))).toThrow(/أُنشئت سابقاً دون ربط/)
    expect(S().purchases.map(row => row.id)).toEqual([originalInvoice.id])
    expect(S().purchaseOrders[0].invoiceIds).toEqual([])
    expect(S().journal).toHaveLength(1)
  })
  it('أمر مفقود أو مورد غير مطابق لا ينشئ فاتورة أو قيداً', () => {
    const order = addOrder()
    expect(() => S().postPurchase(input(999, 1, 'missing'))).toThrow(/أمر الشراء/)
    useRawDataStore.setState({ suppliers: [...S().suppliers, { ...EMPTY_EXTENDED, id: 8, nameAr: 'آخر', phone: '', active: true }] as never })
    expect(() => S().postPurchase({ ...input(order.id, 1, 'wrong'), supplierId: 8 })).toThrow(/مورد/)
    expect(S().purchases).toHaveLength(0)
    expect(S().journal).toHaveLength(0)
    expect(S().purchaseOrders[0].lines[0].receivedQty).toBe(0)
  })
})
