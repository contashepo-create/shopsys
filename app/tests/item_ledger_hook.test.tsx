import { renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useItemLedgerInput } from '../src/ui/hooks/useItemLedgerInput.ts'
import { buildItemLedger, scopeItemLedgerWarehouse } from '../src/core/itemLedger.ts'
const original = useRawDataStore.getState()
afterEach(() => useRawDataStore.setState(original))
it('يبني الدفتر من لقطة المخزن والكمية والمرتجع والإنتاج لا إعداد الوصفة الحالي', () => {
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, journal: [], stocktakes: [], processingOrders: [], transfers: [],
  materialRequisitions: [{ reqNumber: 'MR', date: '2026-01-01', journalEntryId: 1, lines: [{ itemId: 5, qty: 2, baseQty: 12, unitFactor: 6, warehouseId: 2, costMinor: 100 }] }],
  purchases: [{ id: 1, invoiceNumber: 'PROJECT', date: '2026-01-01', projectId: 7, lines: [{ itemId: 5, qty: 8, unitPriceMinor: 1 }] }, { id: 2, invoiceNumber: 'STORE', date: '2026-01-01', warehouseId: 1, lines: [{ itemId: 5, qty: 5, unitPriceMinor: 1, warehouseId: 2 }] }],
  purchaseReturns: [{ purchaseId: 2, returnNumber: 'PR', date: '2026-01-02', lines: [{ itemId: 5, qty: 1, landedUnitCostMinor: 1, purchaseLineIndex: 0 }] }],
  sales: [{ id: 1, invoiceNumber: 'S', date: '2026-01-01', warehouseId: 1, lines: [{ itemId: 5, qty: 1, unitFactor: 3, warehouseId: 2, unitPriceMinor: 4, discountPercent: 0 }] }],
  saleReturns: [{ saleId: 1, returnNumber: 'SR', date: '2026-01-03', lines: [{ itemId: 5, qty: 1, unitFactor: 3, unitPriceMinor: 4, saleLineIndex: 0 }] }],
  recipes: [{ id: 3, ingredients: [{ itemId: 5, qty: 999 }] }], productionOrders: [{ recipeId: 3, orderNumber: 'P', date: '2026-01-01', productItemId: 9, producedQty: 1, batches: 1, ingredientItems: [{ itemId: 5, qty: 2, warehouseId: 2 }] }],
 } as never)
 const { result } = renderHook(() => useItemLedgerInput(5)); const input = result.current!
 expect(input.purchases.map(p => p.invoiceNumber)).toEqual(['STORE']); expect(input.materialRequisitions[0].lines[0]).toMatchObject({ baseQty: 12, warehouseId: 2 })
 const ledger = buildItemLedger(scopeItemLedgerWarehouse(input, 2)); expect(ledger.rows.map(r => [r.docType, r.inQty, r.outQty])).toEqual([['purchase', 5, 0], ['sale', 0, 3], ['production', 0, 2], ['material_issue', 0, 12], ['purchase_return', 0, 1], ['sale_return', 3, 0]])
 expect(buildItemLedger(scopeItemLedgerWarehouse(input, 1)).rows).toHaveLength(0)
})
