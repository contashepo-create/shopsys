import { describe, expect, it } from 'vitest'
import { buildWarehouseDocs, computeWarehouseStock } from '../src/core/transfers.ts'

const warehouses = [{ id: 1, isMain: true }, { id: 2, isMain: false }]
const items = [{ id: 7, stockQty: 12 }]

describe('بيع متعدد المخازن على مستوى السطر', () => {
  it('يفضل مخزن السطر ويُبقي السطر القديم على مخزن الرأس', () => {
    const docs = buildWarehouseDocs([], [{ id: 1, warehouseId: 1, lines: [
      { itemId: 7, qty: 2, warehouseId: 2 },
      { itemId: 7, qty: 1 },
    ] }])
    expect(docs.map((doc) => [doc.warehouseId, doc.lines[0].qtyDelta])).toEqual([[2, -2], [1, -1]])
  })

  it('يعيد المرتجع المحدد إلى مخزن سطر الأصل ولا يعيد التالف', () => {
    const sales = [{ id: 8, warehouseId: 1, lines: [
      { itemId: 7, qty: 2, warehouseId: 1 },
      { itemId: 7, qty: 3, warehouseId: 2 },
    ] }]
    const returns = [{ saleId: 8, lines: [
      { itemId: 7, qty: 1, saleLineIndex: 1, condition: 'resellable' },
      { itemId: 7, qty: 1, saleLineIndex: 0, condition: 'damaged' },
    ] }]
    const docs = buildWarehouseDocs([], sales, returns)
    expect(docs.some((doc) => doc.warehouseId === 2 && doc.lines[0].qtyDelta === 1)).toBe(true)
    expect(docs.some((doc) => doc.warehouseId === 1 && doc.lines[0].qtyDelta > 0)).toBe(false)
  })

  it('يوزع الرصيد الإجمالي الحالي وفق مستندات مخزن السطر', () => {
    const sales = [{ id: 2, warehouseId: 1, lines: [{ itemId: 7, qty: 2, warehouseId: 2 }] }]
    const stock = computeWarehouseStock(items, warehouses, [], buildWarehouseDocs([], sales))
    expect(stock.get(2)?.get(7)).toBe(-2)
    expect(stock.get(1)?.get(7)).toBe(14)
  })
})
