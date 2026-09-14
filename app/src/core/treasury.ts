/**
 * الخزائن والبنوك المتعددة — نواة خالصة
 * ──────────────────────────────────────
 * كان النظام مقيداً بخزينة واحدة (1101) وبنك واحد (1102).
 * الآن: عدد غير محدود من الخزائن والبنوك، كلٌّ بحساب ورقي خاص تحت
 * «الأصول المتداولة» (11)، وتظهر جميعها في كل شاشة دفع/تحصيل
 * ليختار المستخدم مصدر النقدية يدوياً (طلب المالك).
 */
import type { Account } from './ledger.ts'

export interface TreasuryDef {
  code: string // كود الحساب: 1101، 1102، ثم 1121+ للمخصصة
  nameAr: string
  kind: 'cash' | 'bank'
  isDefault?: boolean // الخزينة الرئيسية — لا تُحذف
}

/** الافتراضيات — تُزرع مع أول تشغيل وتُرحَّل للحسابات القديمة */
export const DEFAULT_TREASURIES: TreasuryDef[] = [
  { code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', isDefault: true },
  { code: '1102', nameAr: 'البنك الرئيسي', kind: 'bank' },
]

/**
 * الكود التالي لخزينة/بنك مخصص — يبدأ من 1121 (بعيداً عن أكواد
 * النظام 1103-1107 وترك فراغ لمستقبلها) ويزيد واحداً واحداً
 */
export function nextTreasuryCode(existing: TreasuryDef[]): string {
  let max = 1120
  for (const t of existing) {
    const n = Number(t.code)
    if (Number.isInteger(n) && n >= 1121 && n > max) max = n
  }
  return String(max + 1)
}

/** التحقق قبل إضافة/تعديل خزينة */
export function validateTreasury(nameAr: string, existing: TreasuryDef[], excludeCode?: string): string[] {
  const errors: string[] = []
  const name = nameAr.trim()
  if (name.length < 2) errors.push('اسم الخزينة/البنك قصير جداً')
  if (existing.some((t) => t.nameAr.trim() === name && t.code !== excludeCode)) {
    errors.push('يوجد خزينة/بنك بنفس الاسم')
  }
  return errors
}

/** تحويل الخزائن المخصصة لحسابات دفترية — تُدمج مع الشجرة القياسية في العرض والميزان */
export function treasuryAccounts(treasuries: TreasuryDef[]): Account[] {
  return treasuries
    .filter((t) => t.code !== '1101' && t.code !== '1102') // القياسيتان موجودتان بالشجرة أصلاً
    .map((t) => ({
      code: t.code,
      nameAr: t.nameAr,
      rootType: 'assets' as const,
      parentCode: '11',
      isPostable: true,
      systemKey: undefined,
    }))
}

/** اسم معروض بأيقونة النوع */
export function treasuryLabel(t: TreasuryDef): string {
  return `${t.kind === 'cash' ? '💰' : '🏦'} ${t.nameAr}`
}

/**
 * الشجرة الكاملة = القياسية + حسابات الخزائن المخصصة (تُدرج بعد «البنوك» 1102)
 * تُستخدم في: ميزان المراجعة، شجرة الحسابات، القيد اليدوي، اليومية
 */
export function fullCoa(base: Account[], treasuries: TreasuryDef[]): Account[] {
  const customs = treasuryAccounts(treasuries)
  if (customs.length === 0) return base
  const out: Account[] = []
  for (const a of base) {
    out.push(a)
    if (a.code === '1102') out.push(...customs)
  }
  return out
}
