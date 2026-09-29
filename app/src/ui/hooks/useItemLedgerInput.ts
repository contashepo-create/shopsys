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
    processingOrders, recipes, materialRequisitions, transfers, warehouses, journal,
  } = useDataStore()
  const journalUser = useCallback((sourceType: string, sourceId: number | null | undefined) =>
    journal.find((j) => j.sourceType === sourceType && j.sourceId === sourceId)?.createdBy ?? null, [journal])

  const input = useMemo(() => {
    if (!itemId) return null
    return {
      itemId: itemId,
      openingQty: 0, // يُحسب عكسياً بالأسفل من الرصيد الحالي
      purchases: purchases.map((p) => ({ invoiceNumber: p.invoiceNumber, date: p.date, warehouseId: p.warehouseId ?? null, userName: journalUser('purchase', p.id), lines: p.lines })),
      purchaseReturns: purchaseReturns.map((r) => ({ returnNumber: r.returnNumber, date: r.date, warehouseId: purchases.find((p) => p.id === r.purchaseId)?.warehouseId ?? null, userName: journalUser('purchase_return', r.id), lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCostMinor: l.landedUnitCostMinor })) })),
      sales: sales.map((sl) => ({ invoiceNumber: sl.invoiceNumber, date: sl.date, warehouseId: sl.warehouseId ?? null, userName: journalUser('sale', sl.id), lines: sl.lines })),
      saleReturns: saleReturns.map((r) => ({ returnNumber: r.returnNumber, date: r.date, warehouseId: sales.find((sl) => sl.id === r.saleId)?.warehouseId ?? null, userName: journalUser('sale_return', r.id), lines: r.lines })),
      stocktakes: stocktakes.map((st) => ({ stocktakeNumber: st.stocktakeNumber, date: st.date, warehouseId: null, userName: journal.find((j) => j.id === st.journalEntryId)?.createdBy ?? null, rows: st.result.variances.map((v) => ({ itemId: v.itemId, systemQty: v.expectedQty, countedQty: v.countedQty })) })),
      productionOrders: productionOrders.map((po) => {
        const recipe = recipes.find((rc) => rc.id === po.recipeId)
        return {
          orderNumber: po.orderNumber, date: po.date, productItemId: po.productItemId, qty: po.producedQty,
          ingredients: (recipe?.ingredients ?? []).map((ing) => ({ itemId: ing.itemId, qty: ing.qty * po.batches })),
        }
      }),
      materialRequisitions: materialRequisitions.map((mr) => ({ reqNumber: mr.reqNumber, date: mr.date, warehouseId: warehouses.find((w) => w.isMain)?.id ?? null, userName: journal.find((j) => j.id === mr.journalEntryId)?.createdBy ?? null, lines: mr.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) })),
      processingOrders: processingOrders.map((pr) => ({ orderNumber: pr.orderNumber, date: pr.date.slice(0, 10), sourceItemId: pr.sourceItemId, sourceQty: pr.sourceQty, outputs: pr.outputs.map((o) => ({ itemId: o.itemId, qty: o.qty })) })),
      transfers: transfers.map((tr) => ({ transferNumber: tr.transferNumber, date: tr.date, fromWarehouseId: tr.fromWarehouseId, toWarehouseId: tr.toWarehouseId, userName: null, lines: tr.lines })),
    }
  }, [itemId, purchases, purchaseReturns, sales, saleReturns, stocktakes, productionOrders, processingOrders, recipes, materialRequisitions, transfers, warehouses, journal, journalUser])
  return input
}
