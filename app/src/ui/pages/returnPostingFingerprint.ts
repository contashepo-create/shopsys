import { useRawDataStore } from '../../data/repo.ts'
import { todayLocalIso } from '../../core/time.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { currentPreviewScope } from '../components/printPreviewStore.ts'

/** أساس موافقة المستخدم: تتغير الأرصدة أو الصلاحية أو يوم الترحيل ⇒ أعد المعاينة. */
export function returnPostingFingerprint(kind: 'sale' | 'purchase', id: number): string {
  const s = useRawDataStore.getState()
  const source = kind === 'sale' ? s.sales.filter(row => row.id === id) : s.purchases.filter(row => row.id === id)
  const returns = kind === 'sale' ? s.saleReturns.filter(row => row.saleId === id) : s.purchaseReturns.filter(row => row.purchaseId === id)
  return JSON.stringify([currentPreviewScope(), todayLocalIso(), source, returns, s.appUsers, s.employees, s.branches, s.roleOverrides, s.branchRoleOverrides, s.customRoles, s.treasuries, s.customers, s.suppliers, s.warehouses, s.items, s.serials, s.batches, s.variantStocks, s.journal, s.clientSettlements, s.vouchers, s.paymentTerminalTransactions, s.installmentPlans, s.staffCommissions, s.employeeDeductions, s.purchaseOrders, s.pendingPartOrders, s.recipes, useAppStore.getState().setup, useAppStore.getState().fiscalYears])
}
