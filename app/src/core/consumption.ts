/**
 * الصرف الداخلي — استهلاك المخزون للتشغيل (طلب المالك — سد فجوة الأنشطة
 * التي تشتري مخزوناً ولا تبيعه: عيادة تستهلك مستلزمات، مغسلة تستهلك منظفات،
 * ورشة تستهلك زيوتاً وقطعاً، مكتب يستهلك أدوات...):
 *
 * المعالجة العالمية (نمط Odoo/QuickBooks/SAP «Inventory Consumption / Internal Use»):
 *   مستند صرف داخلي موثق بغرض ← قيد متوازن بمتوسط التكلفة المرجح:
 *     من ح/ 5114 مستهلكات تشغيل داخلي (أو أي حساب مصروف يختاره المستخدم)
 *       إلى ح/ 1103 المخزون
 *   فيخرج المخزون من الأصول ويظهر مصروفاً في قائمة الدخل فور الاستهلاك —
 *   لا عند الشراء (الشراء أصل) ولا يضرب COGS لأنه ليس بيعاً.
 * نواة خالصة بلا واجهات — كل الأموال أعداد صحيحة (Minor).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/** حساب المصروف الافتراضي للصرف الداخلي */
export const INTERNAL_USE_ACCOUNT = '5114'

export const CONSUMPTION_PURPOSES = [
  'مواد تشغيل',
  'مستلزمات عيادة / معمل',
  'صيانة داخلية',
  'تجهيز وتغليف',
  'ضيافة ونظافة',
  'استخدام إداري',
  'أخرى',
] as const

export interface ConsumptionLineInput {
  itemId: number
  nameAr: string
  qty: number
  unitCostMinor: Minor // متوسط التكلفة المرجح وقت الصرف
}

export interface ConsumptionInput {
  purpose: string
  expenseAccount: string // 5114 افتراضياً — أو حساب مصروف آخر (5xxx)
  lines: ConsumptionLineInput[]
}

/** تحقق شامل قبل الترحيل — قائمة أخطاء عربية (فارغة = سليم) */
export function validateConsumption(
  input: ConsumptionInput,
  availableQty: (itemId: number) => number,
  isExpenseAccount: (code: string) => boolean,
): string[] {
  const errors: string[] = []
  if (!input.purpose.trim()) errors.push('حدد الغرض من الصرف — مستند الاستهلاك يجب أن يكون موثقاً')
  if (!input.expenseAccount.trim()) errors.push('حدد حساب المصروف')
  else if (!isExpenseAccount(input.expenseAccount)) errors.push('حساب الصرف يجب أن يكون حساب مصروفات (5xxx) قابلاً للترحيل')
  if (input.lines.length === 0) errors.push('أضف صنفاً واحداً على الأقل')
  const seen = new Set<number>()
  input.lines.forEach((l, i) => {
    if (seen.has(l.itemId)) errors.push(`سطر ${i + 1}: الصنف مكرر — اجمع الكمية في سطر واحد`)
    seen.add(l.itemId)
    if (!(l.qty > 0)) errors.push(`سطر ${i + 1}: الكمية يجب أن تكون موجبة`)
    else if (l.qty > availableQty(l.itemId)) errors.push(`سطر ${i + 1}: الكمية تتجاوز رصيد «${l.nameAr}» (المتاح ${availableQty(l.itemId)})`)
    if (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0) errors.push(`سطر ${i + 1}: تكلفة غير سليمة`)
  })
  return errors
}

/** إجمالي قيمة الصرف بالتكلفة */
export function consumptionTotalMinor(lines: ConsumptionLineInput[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.unitCostMinor), 0)
}

/** قيد الصرف الداخلي المتوازن: حساب المصروف / 1103 المخزون */
export function buildConsumptionEntry(
  lines: ConsumptionLineInput[],
  expenseAccount: string,
  label: string,
): JournalLine[] {
  const total = consumptionTotalMinor(lines)
  if (total <= 0) throw new Error('قيمة الصرف يجب أن تكون موجبة — أصناف بتكلفة صفرية لا تولّد قيداً')
  const entry: JournalLine[] = [
    { accountCode: expenseAccount, debit: total, credit: 0, note: `صرف داخلي ${label}` },
    { accountCode: '1103', debit: 0, credit: total, note: 'استهلاك مخزون للتشغيل' },
  ]
  assertBalanced(entry)
  return entry
}
