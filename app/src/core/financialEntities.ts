/** إعداد وصفي لتجميع الفروع للمراجعة، لا يغيّر الدفتر ولا يثبت كياناً أو إعفاءً نظامياً. */
export interface FinancialEntityProfile {
  id: string
  nameAr: string
  branchIds: number[]
  framework: 'undetermined' | 'sme' | 'full'
  externalAudit: 'undetermined' | 'required' | 'exempt'
}
export type FinancialEntityInput = Omit<FinancialEntityProfile, 'id'> & { id?: string }

/** يرفض التداخل أو الفروع المفقودة، لكنه لا يقرر متطلبات الهيئة أو صحة السجل التجاري. */
export function assertFinancialEntityProfiles(profiles: readonly FinancialEntityProfile[], branches: readonly { id: number }[]): void {
  if (!Array.isArray(profiles) || !Array.isArray(branches)) throw new Error('إعداد الكيانات أو الفروع غير صالح — راجع البيانات')
  const ids = new Set<string>(), used = new Set<number>(), branchIds = new Set<number>()
  for (const branch of branches) {
    if (!branch || !Number.isSafeInteger(branch.id) || branch.id <= 0 || branchIds.has(branch.id)) throw new Error('معرفات الفروع غير صالحة أو مكررة — راجع البيانات')
    branchIds.add(branch.id)
  }
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== 'string' || !profile.id.trim() || profile.id.length > 100 || ids.has(profile.id) || typeof profile.nameAr !== 'string' || !profile.nameAr.trim() || profile.nameAr.length > 200 || !['undetermined', 'sme', 'full'].includes(profile.framework) || !['undetermined', 'required', 'exempt'].includes(profile.externalAudit) || !Array.isArray(profile.branchIds)) throw new Error('إعداد الكيان غير صالح أو مكرر — راجع البيانات')
    ids.add(profile.id)
    for (const id of profile.branchIds) {
      if (!Number.isSafeInteger(id) || !branchIds.has(id) || used.has(id)) throw new Error('الفرع غير موجود أو مرتبط بأكثر من كيان — راجع الإعداد')
      used.add(id)
    }
  }
}

export function financialEntityBasis(profiles: readonly FinancialEntityProfile[], branches: readonly { id: number; nameAr: string; active: boolean }[]): string {
  return JSON.stringify({ profiles, branches })
}
