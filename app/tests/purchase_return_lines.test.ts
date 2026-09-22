import { describe, expect, it } from 'vitest'
import { buildPurchaseReturnLinesPerLine, remainingPurchaseByLine } from '../src/core/purchases.ts'
import { buildWarehouseDocs } from '../src/core/transfers.ts'

const lines = [
  { itemId: 1, qty: 2, landedUnitCostMinor: 110, unitPriceMinor: 100, warehouseId: 1 },
  { itemId: 1, qty: 3, landedUnitCostMinor: 220, unitPriceMinor: 200, warehouseId: 2 },
]

describe('مرتجع الشراء سطراً بسطر', () => {
  it('يحافظ على سعر وتكلفة ومخزن السطر المحدد', () => {
    const result = buildPurchaseReturnLinesPerLine(lines, [], [{ lineIndex: 1, qty: 1 }], () => 'صنف')
    expect(result[0]).toMatchObject({ purchaseLineIndex: 1, landedUnitCostMinor: 220, unitPriceMinor: 200, warehouseId: 2 })
  })

  it('يسمح بتحديد مخزن إخراج بديل ويثبته', () => {
    const result = buildPurchaseReturnLinesPerLine(lines, [], [{ lineIndex: 0, qty: 1, warehouseId: 2 }], () => 'صنف')
    expect(result[0].warehouseId).toBe(2)
  })

  it('يحسب المرتجعات الحديثة والقديمة تراكمياً لكل سطر', () => {
    expect(remainingPurchaseByLine(lines, [
      { itemId: 1, nameAr: 'صنف', qty: 2, landedUnitCostMinor: 110 },
      { itemId: 1, nameAr: 'صنف', qty: 1, landedUnitCostMinor: 220, purchaseLineIndex: 1 },
    ])).toEqual([0, 2])
  })

  it('يرفض تجاوز السطر حتى لو للصنف رصيد في سطر آخر', () => {
    expect(() => buildPurchaseReturnLinesPerLine(lines, [], [{ lineIndex: 0, qty: 2.5 }], () => 'صنف')).toThrow('المتبقي 2')
  })

  it('يسجل خروج المرتجع من المخزن المختار لا مخزن رأس الشراء', () => {
    const returned = buildPurchaseReturnLinesPerLine(lines, [], [{ lineIndex: 0, qty: 1, warehouseId: 2 }], () => 'صنف')
    const docs = buildWarehouseDocs(
      [{ id: 11, warehouseId: 1, lines }], [], [],
      [{ purchaseId: 11, lines: returned }],
    )
    expect(docs.some((doc) => doc.warehouseId === 2 && doc.lines[0].qtyDelta === -1)).toBe(true)
  })
})
