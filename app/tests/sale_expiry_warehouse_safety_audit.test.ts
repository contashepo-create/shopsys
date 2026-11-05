import { beforeEach, expect, it } from 'vitest'
import { useRawDataStore, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const line = { itemId: 1, nameAr: 'دواء', qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }
const args = { lines: [line], customerId: null, payment: 'cash' as const, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false }
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [{ id: 1, nameAr: 'دواء', sku: 'D', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockValueMinor: 10000, stockQty: 10, priceMinor: 2000, minQty: 0, isActive: true, trackExpiry: true }] as never, warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], journal: [], batches: [{ id: 1, itemId: 1, qty: 10, expiryDate: '2099-01-01', purchaseId: null, receivedAt: '2026-01-01', warehouseId: 1 }] })
})
it('لا يرد صنف صلاحية غير مسلسل إلى مخزون دون إثبات الدفعة المستلمة', () => {
 const s = useDataStore.getState(), sale = s.postSale(args), before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[1, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/دفعة|صلاحية/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
})
it('لا يستهلك FEFO دفعة مخزن آخر في بيع عادي متعدد المخازن', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'فرعي', isMain: false }] as never, transfers: [{ id: 1, transferNumber: 'T', date: '2026-01-01', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 5, nameAr: 'دواء' }], totalQty: 5, notes: '' }], batches: [{ id: 1, itemId: 1, qty: 5, expiryDate: '2099-01-01', purchaseId: null, receivedAt: '2026-01-01', warehouseId: 1 }, { id: 2, itemId: 1, qty: 5, expiryDate: '2099-02-01', purchaseId: null, receivedAt: '2026-01-01', warehouseId: 2 }] })
 const s = useDataStore.getState()
 s.postSale({ ...args, warehouseId: 2 })
 expect(useRawDataStore.getState().batches.map(batch => [batch.id, batch.qty])).toEqual([[1, 5], [2, 3]])
 expect(useRawDataStore.getState().items[0].stockQty).toBe(8)
})
it('يرفض بيعاً متعدد المخازن عند غياب دفعة مثبتة في مخزن السطر', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'فرعي', isMain: false }] as never, transfers: [{ id: 1, transferNumber: 'T', date: '2026-01-01', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 5, nameAr: 'دواء' }], totalQty: 5, notes: '' }] })
 const s = useDataStore.getState(), before = useRawDataStore.getState()
 expect(() => s.postSale({ ...args, warehouseId: 2 })).toThrow(/دفعات/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يغيّر فاتورة صنف صلاحية دون تسوية الدفعات الأصلية والجديدة', () => {
 const s = useDataStore.getState(), sale = s.postSale(args), before = useRawDataStore.getState()
 expect(() => s.editSale({ saleId: sale.id, lines: [{ ...line, qty: 1 }], customerId: null, payment: 'cash', paidMinor: 2000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تعديل', einvoiceActive: false })).toThrow(/صلاحية|دفعات/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يصرف سطور الصنف الموزعة على مخزنين من دفعات كل مخزن وحده', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'فرعي', isMain: false }] as never, transfers: [{ id: 1, transferNumber: 'T', date: '2026-01-01', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 5, nameAr: 'دواء' }], totalQty: 5, notes: '' }], batches: [{ id: 1, itemId: 1, qty: 5, expiryDate: '2099-01-01', purchaseId: null, receivedAt: '2026-01-01', warehouseId: 1 }, { id: 2, itemId: 1, qty: 5, expiryDate: '2099-02-01', purchaseId: null, receivedAt: '2026-01-01', warehouseId: 2 }] })
 const s = useDataStore.getState()
 s.postSale({ ...args, lines: [{ ...line, qty: 1, warehouseId: 1 }, { ...line, qty: 3, warehouseId: 2 }], warehouseId: 1 })
 expect(useRawDataStore.getState().batches.map(batch => [batch.id, batch.qty])).toEqual([[1, 4], [2, 2]])
 expect(useRawDataStore.getState().items[0].stockQty).toBe(6)
})
it('لا يعتبر الدفعة القديمة بلا مخزن دليلاً على توفرها في المخزن المختار', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'فرعي', isMain: false }] as never, transfers: [{ id: 1, transferNumber: 'T', date: '2026-01-01', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 5, nameAr: 'دواء' }], totalQty: 5, notes: '' }], batches: [{ id: 1, itemId: 1, qty: 10, expiryDate: '2099-01-01', purchaseId: null, receivedAt: '2026-01-01' }] })
 const s = useDataStore.getState(), before = useRawDataStore.getState()
 expect(() => s.postSale({ ...args, warehouseId: 2 })).toThrow(/دفعات/)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('شراء جديد بلا اختيار مخزن يثبت الدفعة في المخزن الفعلي المحفوظ على الفاتورة', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }] as never, items: useRawDataStore.getState().items.map(item => ({ ...item, warehouseId: 2 })) })
 const s = useDataStore.getState()
 const purchase = s.postPurchase({ supplierId: 0, date: '2026-01-01', lines: [{ itemId: 1, qty: 4, unitPriceMinor: 1000, expiryDate: '2099-01-01' }], expenses: [], paidMinor: 4000, treasury: '1101', notes: '' })
 expect(purchase.lines[0].warehouseId).toBe(1)
 expect(useRawDataStore.getState().batches.find(batch => batch.purchaseId === purchase.id)?.warehouseId).toBe(1)
})
it('تحويل صنف صلاحية بلا تحديد دفعة لا يغير أرصدة المخازن مع بقاء الدفعة في المصدر', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }] as never })
 const s = useDataStore.getState(), before = useRawDataStore.getState()
 expect(() => s.postTransfer({ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 3 }], notes: '' })).toThrow(/دفعات|صلاحية/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
})
it('لا يرحل طبقاً من مخزن آخر قبل توثيق حركة خاماته لكل مخزن', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }] as never, items: [
  { id: 1, nameAr: 'خام', sku: 'R', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockValueMinor: 1000, stockQty: 10, priceMinor: 200, minQty: 0, isActive: true },
  { id: 2, nameAr: 'طبق', sku: 'P', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, isActive: true },
 ] as never, batches: [], transfers: [{ id: 1, transferNumber: 'T', date: '2026-01-01', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 5, nameAr: 'خام' }], totalQty: 5, notes: '' }] })
 const s = useDataStore.getState()
 s.addRecipe({ productItemId: 2, mode: 'made_to_order', yieldQty: 1, ingredients: [{ itemId: 1, qty: 1 }], overheadMinor: 0, isActive: true, notes: '' })
 const before = useRawDataStore.getState()
 expect(() => s.postSale({ ...args, warehouseId: 2, lines: [{ ...line, itemId: 2, nameAr: 'طبق', qty: 1, unitPriceMinor: 1000 }] })).toThrow(/خامات|مخزن/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
