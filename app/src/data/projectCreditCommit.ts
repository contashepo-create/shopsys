import { useRawDataStore } from './repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { withInvoiceCommitLock } from './invoiceCommitLock.ts'
import { ProjectCommitUnconfirmedError } from './projectExtractCommit.ts'

/**
 * أساس محافظ للإشعار كما كان عند فتح نافذته. تشمل المقارنة البيانات الخام
 * والصلاحيات والأدلة التي قد لا تكون ظاهرة في الفرع، لا مجرد المستخلص الظاهر.
 * ليست قفلاً على مخزن الفترات المستقل أو على كاتب/جهاز لا يشارك قفل الترحيل.
 */
export function projectCreditFingerprint(projectId: number): string {
  const state = useRawDataStore.getState(), app = useAppStore.getState()
  return JSON.stringify({
    projectId,
    projects: state.projects, customers: state.customers, entities: state.financialEntityProfiles, extracts: state.projectExtracts, boq: state.boqItems,
    surveys: state.projectSurveys, drafts: state.projectExtractDrafts, closeouts: state.projectCloseouts,
    advances: state.clientAdvances, releases: state.retentionReleases, changes: state.changeOrders,
    journal: state.journal, sales: state.sales, returns: state.saleReturns, items: state.items,
    stockMoves: state.stockMoves, commissions: state.staffCommissions,
    vouchers: state.vouchers, settlements: state.clientSettlements,
    treasuries: state.treasuries, terminals: state.paymentTerminals, transactions: state.paymentTerminalTransactions,
    branches: state.branches, activeBranch: state.activeBranchId, users: state.appUsers, user: state.currentUserId,
    loggedOut: state.loggedOut, ownerPinHash: state.ownerPinHash, roles: state.roleOverrides,
    branchRoles: state.branchRoleOverrides, customRoles: state.customRoles,
    fiscalYears: app.fiscalYears, setup: app.setup, companySetup: app.companySetup,
  })
}

/** إعادة التحميل والمقارنة داخل قفل الترحيل، وتجنب إعادة تنفيذ حفظ غير مؤكد. */
export async function withProjectCreditCommit<T>(projectId: number, basis: string, commit: () => T): Promise<T> {
  let completed = false
  let result: T
  try {
    return await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => {
      if (!basis || projectCreditFingerprint(projectId) !== basis) throw new Error('تغير أساس إشعار المستخلص منذ فتح النافذة — أغلقها وراجع البيانات قبل المحاولة')
      result = commit()
      completed = true
      return result
    })
  } catch (error) {
    if (completed) throw new ProjectCommitUnconfirmedError(result!, error)
    throw error
  }
}
