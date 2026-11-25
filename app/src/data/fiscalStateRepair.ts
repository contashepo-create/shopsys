import { fiscalCloseStateRepairs, type FiscalYear } from '../core/fiscal.ts'
import { hasAmbiguousUnassignedFiscalReversals, hasHiddenFiscalReversalClaims } from '../core/fiscalCloseLinkReview.ts'
import { getBranchScopedDataState, useRawDataStore } from './repo.ts'

type DataState = ReturnType<typeof useRawDataStore.getState>
type Repairs = { closeIds: number[]; reopenIds: number[] }

/**
 * مرشح إضافي لاستعادة حالة الفترات بعد تحميل المخزنين. لا يغيّر أي بيانات.
 * يستخدم نطاق كل فرع داخلياً دون إظهار الدفتر للمستخدم أو الاعتماد على
 * فرع الجلسة. عند تعذر تحديد النطاق أو فحصه لا تُستعاد حالة تلك السنة.
 */
export function guardedFiscalStateRepairs(state: DataState, years: readonly FiscalYear[]): Repairs {
  const none = (): Repairs => ({ closeIds: [], reopenIds: [] })
  if (!Array.isArray(state.branches) || !Array.isArray(state.journal) || !Array.isArray(years)) return none()
  const mains = state.branches.filter(branch => branch?.isMain)
  if (state.branches.length && mains.length !== 1) return none()
  let repairs: Repairs
  try { repairs = fiscalCloseStateRepairs(years, state.journal, mains[0]?.id) } catch { return none() }
  const scopes = new Map<number, typeof state.journal>()
  const safe = (id: number): boolean => {
    const matches = years.filter(year => year?.id === id)
    if (matches.length !== 1) return false
    const year = matches[0]
    try {
      if (hasAmbiguousUnassignedFiscalReversals(state.journal, year)) return false
      const branchId = year.branchId ?? mains[0]?.id
      let journal = state.journal
      if (state.branches.length) {
        if (branchId == null || !Number.isSafeInteger(branchId) || branchId <= 0) return false
        const branches = state.branches.filter(branch => branch?.id === branchId)
        if (branches.length !== 1 || !branches[0].active) return false
        const cached = scopes.get(branchId)
        if (cached) journal = cached
        else {
          // فحص داخلي فقط، وليس منحة وصول أو تغيير جلسة المستخدم الفعلية.
          journal = getBranchScopedDataState({ ...state, activeBranchId: branchId, currentUserId: null }).journal
          scopes.set(branchId, journal)
        }
      } else if (branchId != null) return false
      return !hasHiddenFiscalReversalClaims(state.journal, journal, year)
    } catch { return false }
  }
  return { closeIds: repairs.closeIds.filter(safe), reopenIds: repairs.reopenIds.filter(safe) }
}
