/**
 * حسابات مخصصة يضيفها المالك لشجرة الحسابات (طلب المالك — بند 11):
 * الشجرة القياسية ليست مفروضة: يضيف المالك حساباً تحت أي مجموعة،
 * ويستخدمه فوراً في القيد اليدوي واليومية وميزان المراجعة والتقارير المالية.
 * نواة خالصة بلا واجهات.
 */
import type { Account, AccountRootType } from './ledger.ts'

export interface CustomAccount {
  code: string // رقمي 4-6 خانات، أول خانة تطابق جذر المجموعة
  nameAr: string
  parentCode: string // مجموعة قياسية غير قابلة للترحيل: 11/12/2/21…
  rootType: AccountRootType
  createdAt: string
}

/** المجموعات المسموح الإدراج تحتها = الحسابات التجميعية في الشجرة القياسية */
export function customParentGroups(coa: Account[]): Account[] {
  return coa.filter((a) => !a.isPostable)
}

const rootDigit: Record<AccountRootType, string> = {
  assets: '1',
  liabilities: '2',
  equity: '3',
  revenue: '4',
  expenses: '5',
}

/** يستنتج جذر الحساب من مجموعته الأم */
export function rootOfParent(parentCode: string, coa: Account[]): AccountRootType | null {
  return coa.find((a) => a.code === parentCode)?.rootType ?? null
}

export function validateCustomAccount(
  args: { code: string; nameAr: string; parentCode: string },
  coa: Account[],
  existing: CustomAccount[],
): string[] {
  const errors: string[] = []
  const code = args.code.trim()
  const name = args.nameAr.trim()
  if (!name) errors.push('اسم الحساب مطلوب')
  if (!/^\d{4,6}$/.test(code)) errors.push('كود الحساب أرقام فقط من 4 إلى 6 خانات (مثال: 1115)')
  const parent = coa.find((a) => a.code === args.parentCode)
  if (!parent) errors.push('اختر المجموعة الأم')
  else {
    if (parent.isPostable) errors.push(`«${parent.nameAr}» حساب ترحيل وليس مجموعة — اختر مجموعة تجميعية`)
    if (code && code[0] !== rootDigit[parent.rootType]) {
      errors.push(`كود الحساب تحت «${parent.nameAr}» يجب أن يبدأ بالرقم ${rootDigit[parent.rootType]}`)
    }
    if (code && !code.startsWith(parent.code)) {
      errors.push(`الكود يجب أن يبدأ بكود المجموعة الأم ${parent.code} (مثال: ${parent.code}${'9'})`)
    }
  }
  if (coa.some((a) => a.code === code)) errors.push(`الكود ${code} مستخدم في الشجرة القياسية`)
  if (existing.some((a) => a.code === code)) errors.push(`الكود ${code} مستخدم في حساب مخصص آخر`)
  if (coa.some((a) => a.nameAr === name) || existing.some((a) => a.nameAr === name)) {
    errors.push(`الاسم «${name}» مستخدم من قبل`)
  }
  return errors
}

/** تحويل الحسابات المخصصة لبنية Account للدمج في الشجرة الكاملة */
export function customAsAccounts(customs: CustomAccount[]): Account[] {
  return customs.map((c) => ({
    code: c.code,
    nameAr: c.nameAr,
    rootType: c.rootType,
    parentCode: c.parentCode,
    isPostable: true,
    systemKey: undefined,
  }))
}
