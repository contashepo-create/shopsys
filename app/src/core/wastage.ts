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

/**
 * نسبة الهالك الأسبوعية (سد فجوة النشاط #20 — مخبز وحلويات):
 * كل برامج المخابز العالمية (BakeSmart, Fournil, DoughOps, Logibake…) تتفق
 * على أن قياس نسبة الهالك أسبوعياً — لا رصدها كرقم إجمالي تراكمي فقط —
 * هو ما يحوّلها من "خسارة مؤجلة" إلى قرار إنتاج فوري (خبز أقل يوم الاثنين
 * مثلاً). دليل الاستخدام المدمج `core/guides.ts` (`bakery_wastage`) كان
 * **يَعِد** المستخدم فعلاً بهذا: "راقب نسبة الهالك أسبوعياً من التقارير:
 * نسبة تتجاوز 8-10٪ تعني أنك تخبز أكثر من طلب السوق" — رغم عدم وجود أي
 * تقرير كهذا في التطبيق قبل هذه الدفعة (`wastages` لم تكن تُستهلك إلا من
 * شاشة الإتلاف نفسها كمجموع كلي بلا تقسيم زمني ولا نسبة).
 *
 * المقياس: نسبة = تكلفة الهالك ÷ (تكلفة الهالك + تكلفة البضاعة المباعة
 * COGS لنفس الأسبوع) — أي "كم من تكلفة البضاعة المُعدة فعلاً لم يُباع
 * وذهب هالكاً"، بنفس منطق "(discarded / produced) × 100" الذي توثقه
 * Logibake بالضبط، لكن بوحدة القيمة (تكلفة) بدل الوزن لضمان التوحيد عبر
 * أصناف مختلفة الوزن والسعر.
 */
export interface WastageRatioReportRow {
  /** أسبوع ISO بصيغة YYYY-Www (الاثنين إلى الأحد، معيار ISO 8601) */
  period: string
  wastageCostMinor: Minor
  salesCogsMinor: Minor
  /** null إن لم توجد أي حركة (هالك أو مبيعات) في الأسبوع — لا قسمة على صفر */
  ratioPercent: number | null
}

/** مفتاح الأسبوع ISO (YYYY-Www) لتاريخ معيّن — حساب معياري بلا اعتماد على توقيت محلي */
export function isoWeekKey(dateIso: string): string {
  const parsed = new Date(dateIso)
  if (Number.isNaN(parsed.getTime())) throw new Error('تاريخ غير صالح لحساب الأسبوع')
  const d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
  const dayNum = (d.getUTCDay() + 6) % 7 // الاثنين = 0 … الأحد = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // أقرب خميس يحدد سنة الأسبوع ISO
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export function wastageRatioReport(
  wastages: readonly { date: string; totalCostMinor: Minor }[],
  sales: readonly { date: string; cogsMinor: Minor }[],
): WastageRatioReportRow[] {
  const byWeek = new Map<string, { wastageCostMinor: Minor; salesCogsMinor: Minor }>()
  const bucket = (period: string) => {
    let row = byWeek.get(period)
    if (!row) { row = { wastageCostMinor: 0, salesCogsMinor: 0 }; byWeek.set(period, row) }
    return row
  }
  for (const w of wastages) bucket(isoWeekKey(w.date)).wastageCostMinor += w.totalCostMinor
  for (const s of sales) bucket(isoWeekKey(s.date)).salesCogsMinor += s.cogsMinor
  return [...byWeek.entries()]
    .map(([period, row]) => {
      const base = row.wastageCostMinor + row.salesCogsMinor
      return { period, ...row, ratioPercent: base > 0 ? Math.round((row.wastageCostMinor / base) * 10000) / 100 : null }
    })
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
}

export interface WastageByItemReportRow {
  itemId: number
  nameAr: string
  docsCount: number
  totalQty: number
  totalCostMinor: Minor
}

/** تجميع الهالك حسب الصنف — "أي المنتجات تهلك أكثر" (إجماع برامج المخابز: BakeSmart/Logibake) */
export function wastageByItemReport(
  wastages: readonly { lines: readonly { itemId: number; nameAr: string; qty: number; unitCostMinor: Minor }[] }[],
): WastageByItemReportRow[] {
  const byItem = new Map<number, WastageByItemReportRow>()
  for (const w of wastages) {
    for (const l of w.lines) {
      let row = byItem.get(l.itemId)
      if (!row) { row = { itemId: l.itemId, nameAr: l.nameAr, docsCount: 0, totalQty: 0, totalCostMinor: 0 }; byItem.set(l.itemId, row) }
      row.docsCount += 1
      row.totalQty = Math.round((row.totalQty + l.qty) * 1000) / 1000
      row.totalCostMinor += Math.round(l.qty * l.unitCostMinor)
    }
  }
  return [...byItem.values()].sort((a, b) => b.totalCostMinor - a.totalCostMinor)
}

