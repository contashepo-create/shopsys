/**
 * خطّاف مشترك لبناء مُدخل «كارت الصنف» (دفتر حركة الصنف) من مستندات المتجر الفعلية.
 * كان المنطق محبوساً داخل صفحة الأصناف؛ استُخرج ليخدم أيضاً نافذة «حركة الصنف»
 * المفتوحة من داخل الفاتورة (دفعة المالك ⑩ي البند ⑦) بلا ازدواج منطق.
 */
import { useCallback, useMemo } from 'react'
import { useDataStore } from '../../data/repo.ts'
import type { ItemLedgerInput } from '../../core/itemLedger.ts'

export function useItemLedgerInput(itemId: number | null): ItemLedgerInput | null {
  const {
    purchases, purchaseReturns, sales, saleReturns, stocktakes, productionOrders,
    processingOrders, recipes, materialRequisitions, transfers, journal,
  } = useDataStore()
  const journalUser = useCallback((sourceType: string, sourceId: number | null | undefined) =>
    journal.find((j) => j.sourceType === sourceType && j.sourceId === sourceId)?.createdBy ?? null, [journal])

  const input = useMemo(() => {
    if (!itemId) return null
    return {
      itemId: itemId,
      openingQty: 0, // يُحسب عكسياً بالأسفل من الرصيد الحالي
      purchases: purchases.filter((p) => p.projectId == null).map((p) => ({ invoiceNumber: p.invoiceNumber, date: p.date, warehouseId: p.warehouseId ?? null, userName: journalUser('purchase', p.id), lines: p.lines })),
      purchaseReturns: purchaseReturns.filter((r) => purchases.find((p) => p.id === r.purchaseId)?.projectId == null).map((r) => {
        const purchase = purchases.find((p) => p.id === r.purchaseId)
        return { returnNumber: r.returnNumber, date: r.date, userName: journalUser('purchase_return', r.id), lines: r.lines.map((l) => {
          const source = l.purchaseLineIndex == null ? undefined : purchase?.lines[l.purchaseLineIndex]
          return { itemId: l.itemId, qty: l.qty, unitCostMinor: l.landedUnitCostMinor, warehouseId: l.warehouseId ?? (source?.itemId === l.itemId ? source.warehouseId ?? purchase?.warehouseId : null) ?? null }
        }) }
      }),
      sales: sales.map((sl) => ({ invoiceNumber: sl.invoiceNumber, date: sl.date, warehouseId: sl.warehouseId ?? null, userName: journalUser('sale', sl.id), lines: sl.lines })),
      saleReturns: saleReturns.map((r) => {
        const sale = sales.find((sl) => sl.id === r.saleId)
        return { returnNumber: r.returnNumber, date: r.date, userName: journalUser('sale_return', r.id), lines: r.lines.map((line) => {
          const source = line.saleLineIndex == null ? undefined : sale?.lines[line.saleLineIndex]
          return { ...line, warehouseId: line.warehouseId ?? (source?.itemId === line.itemId ? source.warehouseId ?? sale?.warehouseId : null) ?? null }
        }) }
      }),
      stocktakes: stocktakes.map((st) => ({ stocktakeNumber: st.stocktakeNumber, date: st.date, warehouseId: null, userName: journal.find((j) => j.id === st.journalEntryId)?.createdBy ?? null, rows: st.result.variances.map((v) => ({ itemId: v.itemId, systemQty: v.expectedQty, countedQty: v.countedQty })) })),
      productionOrders: productionOrders.map((po) => {
        const recipe = recipes.find((rc) => rc.id === po.recipeId)
        return {
          orderNumber: po.orderNumber, date: po.date, productItemId: po.productItemId, qty: po.producedQty, outputWarehouseId: po.outputWarehouseId ?? po.warehouseId ?? null,
          ingredients: po.ingredientItems ? po.ingredientItems.map((ing) => ({ itemId: ing.itemId, qty: ing.qty, warehouseId: ing.warehouseId ?? po.ingredientWarehouseId ?? po.warehouseId ?? null })) : (recipe?.ingredients ?? []).map((ing) => ({ itemId: ing.itemId, qty: ing.qty * po.batches, warehouseId: po.ingredientWarehouseId ?? po.warehouseId ?? null })),
        }
      }),
      materialRequisitions: materialRequisitions.map((mr) => ({ reqNumber: mr.reqNumber, date: mr.date, userName: journal.find((j) => j.id === mr.journalEntryId)?.createdBy ?? null, lines: mr.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, baseQty: l.baseQty, unitFactor: l.unitFactor, warehouseId: l.warehouseId, costMinor: l.costMinor })) })),
      processingOrders: processingOrders.map((pr) => ({ orderNumber: pr.orderNumber, date: pr.date.slice(0, 10), sourceItemId: pr.sourceItemId, sourceQty: pr.sourceQty, sourceWarehouseId: pr.sourceWarehouseId, outputWarehouseId: pr.outputWarehouseId ?? pr.sourceWarehouseId, outputs: pr.outputs.map((o) => ({ itemId: o.itemId, qty: o.qty })) })),
      transfers: transfers.map((tr) => ({ transferNumber: tr.transferNumber, date: tr.date, fromWarehouseId: tr.fromWarehouseId, toWarehouseId: tr.toWarehouseId, userName: null, lines: tr.lines })),
    }
  }, [itemId, purchases, purchaseReturns, sales, saleReturns, stocktakes, productionOrders, processingOrders, recipes, materialRequisitions, transfers, journal, journalUser])
  return input
}
