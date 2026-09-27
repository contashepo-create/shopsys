import { describe, expect, it } from 'vitest'
import { buildWarehouseDocs, computeWarehouseStock } from '../src/core/transfers.ts'

describe('حركة التصنيع حسب المخزن', () => {
  it('تخصم الخامات وتضيف الناتج في مخزن التصنيع دون تلويث مخزن آخر', () => {
    const items = [{ id: 1, stockQty: 70 }, { id: 2, stockQty: 25 }]
    const warehouses = [{ id: 1, isMain: true }, { id: 2, isMain: false }]
    const transfers = [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 40 }] }]
    const docs = buildWarehouseDocs([], [], [], [], [{ warehouseId: 2, productItemId: 2, producedQty: 25, ingredientItems: [{ itemId: 1, qty: 30 }] }])
    const stock = computeWarehouseStock(items, warehouses, transfers, docs)
    expect(stock.get(2)?.get(1)).toBe(10)
    expect(stock.get(2)?.get(2)).toBe(25)
    expect(stock.get(1)?.get(1)).toBe(60)
    expect(stock.get(1)?.get(2)).toBe(0)
  })
  it('يدعم صرف الخامات واستلام الناتج في مخزنين منفصلين', () => {
    const items = [{ id: 1, stockQty: 70 }, { id: 2, stockQty: 25 }]
    const warehouses = [{ id: 1, isMain: true }, { id: 2, isMain: false }]
    const transfers = [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 40 }] }]
    const docs = buildWarehouseDocs([], [], [], [], [{ ingredientWarehouseId: 2, outputWarehouseId: 1, productItemId: 2, producedQty: 25, ingredientItems: [{ itemId: 1, qty: 30 }] }])
    const stock = computeWarehouseStock(items, warehouses, transfers, docs)
    expect(stock.get(2)?.get(1)).toBe(10)
    expect(stock.get(1)?.get(2)).toBe(25)
    expect(stock.get(2)?.get(2) ?? 0).toBe(0)
  })

})
