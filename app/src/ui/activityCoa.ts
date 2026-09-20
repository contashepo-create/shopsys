/**
 * خطاف الشجرة المفلترة حسب النشاط — يستخدمه كل مكان يعرض قائمة حسابات
 * (أمر المالك: «شجرة الحسابات لا تظهر فيها أسماء حسابات نشاط آخر»)
 * الفلترة عرضية فقط: التحقق في repo يظل على الشجرة الكاملة (سلامة البيانات)،
 * وصمام الأمان يُبقي أي حساب عليه حركة فعلية ظاهراً.
 */
import { useMemo } from 'react'
import { STANDARD_COA, type Account } from '../core/ledger.ts'
import { coaForModules, usedAccountCodes } from '../core/coaVisibility.ts'
import { useAppStore } from '../stores/app.store.ts'
import { useDataStore } from '../data/repo.ts'

/** الشجرة القياسية مفلترة لنشاط الجهاز (بلا خزائن ولا مخصصة — أضفها حسب حاجة الشاشة) */
export function useActivityBaseCoa(): Account[] {
  const { setup } = useAppStore()
  const journal = useDataStore((s) => s.journal)
  return useMemo(
    () => coaForModules(STANDARD_COA, setup.modules, usedAccountCodes(journal)),
    [setup.modules, journal],
  )
}
