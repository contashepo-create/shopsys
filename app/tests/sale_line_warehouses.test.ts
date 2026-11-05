import { describe, expect, it } from 'vitest'
import { buildWarehouseDocs, computeWarehouseStock } from '../src/core/transfers.ts'
import { buildReturnLinesPerLine } from '../src/core/returns.ts'

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

  it('يسمح باستقبال المرتجع السليم في مخزن مختلف لكل سطر', () => {
    const saleLines = [{
      itemId: 7, nameAr: 'صنف', qty: 2, unitPriceMinor: 100, unitCostMinor: 60,
      discountPercent: 0, soldByWeight: false, warehouseId: 1,
    }]
    const returned = buildReturnLinesPerLine(saleLines, [], [
      { lineIndex: 0, qty: 1, condition: 'resellable', warehouseId: 2 },
    ])
    expect(returned[0].warehouseId).toBe(2)
    const docs = buildWarehouseDocs([], [{ id: 9, warehouseId: 1, lines: saleLines }], [{ saleId: 9, lines: returned }])
    expect(docs.some((doc) => doc.warehouseId === 2 && doc.lines[0].qtyDelta === 1)).toBe(true)
  })

  it('يوزع الرصيد الإجمالي الحالي وفق مستندات مخزن السطر', () => {
    const sales = [{ id: 2, warehouseId: 1, lines: [{ itemId: 7, qty: 2, warehouseId: 2 }] }]
    const stock = computeWarehouseStock(items, warehouses, [], buildWarehouseDocs([], sales))
    expect(stock.get(2)?.get(7)).toBe(-2)
    expect(stock.get(1)?.get(7)).toBe(14)
  })
})

describe('توزيع كمية المرتجع على سطور الأصل', () => {
  it('يستهلك المرتجع التالف كميته من سطر الأصل دون إدخاله المخزون، فلا يستعيرها مرتجع لاحق', () => {
    const sales = [{ id: 20, warehouseId: 1, lines: [{ itemId: 7, qty: 2, warehouseId: 1 }, { itemId: 7, qty: 2, warehouseId: 2 }] }]
    const returns = [
      { saleId: 20, lines: [{ itemId: 7, qty: 2, condition: 'damaged', saleLineIndex: 0 }] },
      { saleId: 20, lines: [{ itemId: 7, qty: 2, condition: 'resellable' }] },
    ]
    const docs = buildWarehouseDocs([], sales, returns)
    expect(docs.filter(doc => doc.lines[0].qtyDelta > 0).map(doc => [doc.warehouseId, doc.lines[0].qtyDelta])).toEqual([[2, 2]])
    // الإجمالي النهائي = 8، وتحويل سابق 5 من المخزن 1 إلى 2.
    const stock = computeWarehouseStock([{ id: 7, stockQty: 8 }], warehouses, [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 7, qty: 5 }] }], docs)
    expect(stock.get(1)?.get(7)).toBe(3)
    expect(stock.get(2)?.get(7)).toBe(5)
  })
})

it('لا يضيف البيع أو المرتجع المثبت كخدمة إلى حركات المخازن', () => {
  const sales = [{ id: 30, warehouseId: 2, lines: [{ itemId: 7, qty: 2, isServiceAtSale: true }] }]
  const returns = [{ saleId: 30, lines: [{ itemId: 7, qty: 1, saleLineIndex: 0, condition: 'resellable' }] }]
  expect(buildWarehouseDocs([], sales, returns)).toEqual([])
})

it('كارت المخزون لا يحسب سطور الخدمة المثبتة كصادر ووارد', async () => {
  const { buildItemLedger } = await import('../src/core/itemLedger.ts')
  const ledger = buildItemLedger({ itemId: 7, openingQty: 0, purchases: [], purchaseReturns: [], stocktakes: [], productionOrders: [], materialRequisitions: [], sales: [{ invoiceNumber: 'S1', date: '2026-01-01', lines: [{ itemId: 7, qty: 2, unitPriceMinor: 100, discountPercent: 0, isServiceAtSale: true }] }], saleReturns: [{ returnNumber: 'R1', date: '2026-01-02', lines: [{ itemId: 7, qty: 1, unitPriceMinor: 100, isServiceAtSale: true }] }] })
  expect(ledger.rows).toEqual([])
  expect(ledger.closingQty).toBe(0)
})
