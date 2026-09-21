/**
 * إتلاف المخزون — الهالك والتوالف (مراجعة نشاط الأغذية/السوبرماركت):
 * البضاعة المنتهية/التالفة تُعدم بمستند إتلاف موثق بسبب، ويتولد قيد متوازن:
 *   من ح/ 5111 هالك وتوالف مخزون (بمتوسط التكلفة المرجح)
 *     إلى ح/ 1103 المخزون
 * نواة خالصة بلا واجهات — كل الأموال أعداد صحيحة (Minor).
 * تخدم أيضاً الصيدلية (أدوية منتهية) والمطعم (خامات فاسدة) وكل الأنشطة المخزنية.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export const WASTAGE_REASONS = [
  'انتهاء صلاحية',
  'تلف / كسر',
  'فساد تخزين',
  'سحب من السوق',
  'عينات ومجاملات',
  'أخرى',
] as const

export interface WastageLineInput {
  itemId: number
  nameAr: string
  qty: number
  unitCostMinor: Minor // متوسط التكلفة المرجح وقت الإتلاف
}

export interface WastageInput {
  reason: string
  lines: WastageLineInput[]
}

/** تحقق شامل قبل الترحيل — قائمة أخطاء عربية (فارغة = سليم) */
export function validateWastage(input: WastageInput, availableQty: (itemId: number) => number): string[] {
  const errors: string[] = []
  if (!input.reason.trim()) errors.push('حدد سبب الإتلاف — مستند الإعدام يجب أن يكون موثقاً')
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

/** إجمالي قيمة الإتلاف بالتكلفة */
export function wastageTotalMinor(lines: WastageLineInput[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.unitCostMinor), 0)
}

/** قيد الإتلاف المتوازن: 5111 هالك / 1103 مخزون */
export function buildWastageEntry(lines: WastageLineInput[], label: string): JournalLine[] {
  const total = wastageTotalMinor(lines)
  if (total <= 0) throw new Error('قيمة الإتلاف يجب أن تكون موجبة — أصناف بتكلفة صفرية لا تولّد قيداً')
  const entry: JournalLine[] = [
    { accountCode: '5111', debit: total, credit: 0, note: `هالك وتوالف ${label}` },
    { accountCode: '1103', debit: 0, credit: total, note: 'إعدام بضاعة من المخزون' },
  ]
  assertBalanced(entry)
  return entry
}
