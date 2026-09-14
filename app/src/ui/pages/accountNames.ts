/** خريطة أسماء الحسابات للعرض — مشتقة من شجرة الحسابات القياسية */
import { STANDARD_COA } from '../../core/ledger.ts'

export const ACCOUNT_NAMES: Record<string, string> = Object.fromEntries(
  STANDARD_COA.map((a) => [a.code, a.nameAr]),
)
