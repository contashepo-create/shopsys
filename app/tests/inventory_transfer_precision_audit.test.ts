import { beforeEach, expect, it } from 'vitest'
import { validateTransfer, computeWarehouseStock } from '../src/core/transfers.ts'
import { useDataStore } from '../src/data/repo.ts'

const input = (qty: number) => ({ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty }] })
const initial = useDataStore.getState()
beforeEach(() => {
 useDataStore.setState({ ...initial, branches: [], activeBranchId: null, warehouses: [{ id: 1, nameAr: 'الرئيسي', isMain: true }, { id: 2, nameAr: 'آخر', isMain: false }] as never, items: [{ id: 5, nameAr: 'وزني', sku: 'W', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 100, stockValueMinor: 100, stockQty: 1, priceMinor: 200, minQty: 0, isActive: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [] })
})
it('يرفض كمية أدق من أجزاء الألف بدلاً من تمرير كمية فعلية تتجاوز المتاح بعد التقريب', () => {
 expect(validateTransfer(input(1.0004), () => 1)).not.toEqual([])
 expect(validateTransfer(input(0.0004), () => 0)).not.toEqual([])
 expect(validateTransfer(input(Infinity), () => 1)).not.toEqual([])
 expect(validateTransfer(input(1), () => NaN)).not.toEqual([])
 expect(validateTransfer(input(1), () => Infinity)).not.toEqual([])
 expect(validateTransfer(input(0.1 + 0.2), () => 0.3)).toEqual([])
})
it('الترحيل يرفض دون تعديل الرصيد ثم يحفظ الكسر السليم مضبوطةً بثلاث خانات', () => {
 const s = useDataStore.getState()
 const before = s.transfers
 expect(() => s.postTransfer({ ...input(1.0004), notes: '' })).toThrow()
 expect(useDataStore.getState().transfers).toEqual(before)
 const transfer = s.postTransfer({ ...input(0.1 + 0.2), notes: '' })
 expect(transfer.lines[0].qty).toBe(0.3)
 const state = useDataStore.getState()
 const stock = computeWarehouseStock(state.items, state.warehouses, state.transfers)
 expect(stock.get(1)?.get(5)).toBeCloseTo(0.7)
 expect(stock.get(2)?.get(5)).toBe(0.3)
})
