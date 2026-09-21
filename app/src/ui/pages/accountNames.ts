/** خريطة أسماء الحسابات للعرض — الشجرة القياسية + الخزائن والبنوك المخصصة */
import { STANDARD_COA } from '../../core/ledger.ts'
import { useDataStore } from '../../data/repo.ts'

export const ACCOUNT_NAMES: Record<string, string> = Object.fromEntries(
  STANDARD_COA.map((a) => [a.code, a.nameAr]),
)

/** اسم حساب شامل الخزائن المخصصة — استخدمه داخل المكوّنات */
export function accountName(code: string): string {
  const st = useDataStore.getState()
  const t = st.treasuries.find((x) => x.code === code)
  const c = st.customAccounts.find((x) => x.code === code)
  return t?.nameAr ?? c?.nameAr ?? ACCOUNT_NAMES[code] ?? code
}
