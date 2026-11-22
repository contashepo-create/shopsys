import type { useDataStore } from '../../data/repo.ts'

/**
 * لقطة أساس العرض لا تُصدَّر ولا تثبت صحة السجلات. إذا تغيّر مستند متعلق
 * بالتقرير بعد فتح معاينة أو قبل تصديرها، تُطلب إعادة بنائها بدلاً من طباعة
 * مؤشرات قديمة. فحص المستودع المالي يظل مطلوباً بالإضافة إلى هذه المقارنة.
 */
export function projectReportBasis(state: ReturnType<typeof useDataStore.getState>): string {
  return JSON.stringify([
    state.currentUserId, state.activeBranchId, state.loggedOut, state.projects,
    state.projectCosts, state.projectExtracts, state.purchases, state.purchaseReturns,
    state.payrollSlips, state.payrollRuns, state.journal, state.retentionReleases,
    state.changeOrders, state.clientAdvances, state.customers, state.suppliers,
    state.treasuries, state.custodyFiles, state.boqItems, state.clientSettlements,
    state.vouchers, state.cheques, state.partyOffsets, state.sales, state.saleReturns,
    state.installmentPlans, state.openingBalances,
  ])
}
