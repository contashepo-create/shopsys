import { useRawDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'

/** أساس المعاينة؛ المقارنة وقائية ولا تغني عن قفل تشارك فيه جميع عمليات المخزون. */
export function inventoryOutflowFingerprint(): string {
  const s = useRawDataStore.getState(), app = useAppStore.getState()
  return JSON.stringify([s.currentUserId, s.activeBranchId, s.branches, s.appUsers, s.roleOverrides, s.customRoles,
    s.warehouses, s.items, s.transfers, s.purchases, s.sales, s.saleReturns, s.purchaseReturns,
    s.productionOrders, s.processingOrders, s.serials, s.batches, s.customAccounts,
    s.wastages, s.consumptions, s.journal, app.fiscalYears, app.setup])
}
