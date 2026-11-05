import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [], batches: [], serials: [], warehouses: [{ id: 1, nameAr: 'أ', isMain: true }, { id: 2, nameAr: 'ب', isMain: false }] as never })
})
it('لا يسحب دفعة مخزن آخر عند رد سطر صلاحية من مخزن محدد', () => {
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2098-01-01' }, { itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 2, expiryDate: '2099-01-01' }], expenses: [], paidMinor: 0, notes: '' })
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 1, qty: 1, warehouseId: 2 }], refund: 'debt', reason: 'رد' })).toThrow(/دفعة|صلاحية/)
 const after = useRawDataStore.getState()
 expect(after.batches).toBe(before.batches)
 expect(after.journal).toBe(before.journal)
 expect(after.purchaseReturns).toBe(before.purchaseReturns)
})
it('لا يستبدل دفعة الشراء المستنفدة بدفعة فاتورة أخرى تلقائياً حتى في مخزن وحيد', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'أ', isMain: true }] as never })
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0], supplierId = useRawDataStore.getState().suppliers[0].id
 const p = (expiryDate: string) => s.postPurchase({ supplierId, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate }], expenses: [], paidMinor: 0, notes: '' })
 const first = p('2098-01-01'); p('2099-01-01')
 s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], payment: 'cash', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const before = useRawDataStore.getState()
 expect(before.batches.some(batch => batch.purchaseId === first.id)).toBe(false)
 expect(() => s.postPurchaseReturn({ purchaseId: first.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })).toThrow(/دفعة|صلاحية/)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يتجاهل دفعة مثبتة في مخزن وحيد بعد تعطيل علم الصلاحية', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'أ', isMain: true }] as never })
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2099-01-01' }], expenses: [], paidMinor: 0, notes: '' })
 useRawDataStore.setState(state => ({ items: state.items.map(row => row.id === item.id ? { ...row, trackExpiry: false } : row) }))
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: p.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })).toThrow(/صلاحية|دفعة/)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يخصم دفعتين تشتركان في معرف واحد عند التخطيط لمرتجع مخزن وحيد', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'أ', isMain: true }] as never })
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0], supplierId = useRawDataStore.getState().suppliers[0].id
 const p = s.postPurchase({ supplierId, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2099-01-01' }], expenses: [], paidMinor: 0, notes: '' })
 useRawDataStore.setState(state => ({ batches: [...state.batches, { ...state.batches[0], purchaseId: 999 }] }))
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: p.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })).toThrow(/دفعة|فريد/)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
