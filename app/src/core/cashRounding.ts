/**
 * F8 — التقريب النقدي للفئات (Cash rounding).
 *
 * لماذا: في مصر لا توجد فئات أقل من 25 قرشاً عملياً (ربع جنيه)، ففاتورة 10.03
 * لا يستطيع العميل دفعها نقداً. الأنظمة الحقيقية تقرّب **المبلغ النقدي المستلم**
 * فقط، وتبقي إجمالي الفاتورة الضريبية كما هو، وتقيّد الفرق في حساب فروق
 * التسويات النقدية (5112) — ربحاً أو خسارة، ظاهراً لا مخفياً.
 *
 * في السعودية (هللة) الخطوة صفر والسلوك لا يتغيّر إطلاقاً.
 */

/** الخطوات المسموحة بالقرش: 0 (معطّل) · 0.05 · 0.10 · 0.25 · 0.50 · 1.00 */
export const CASH_ROUNDING_STEPS = [0, 5, 10, 25, 50, 100] as const

/** خطوة التقريب الصالحة؛ أي قيمة أخرى ⇒ 0 (معطّل) — لا سلوك عشوائي */
export function normalizeRoundingStep(step: number | null | undefined): number {
  const value = Math.trunc(Number(step ?? 0))
  return (CASH_ROUNDING_STEPS as readonly number[]).includes(value) ? value : 0
}

export interface CashRounding {
  /** المبلغ النقدي المطلوب بعد التقريب */
  roundedMinor: number
  /** الفرق: موجب = العميل دفع أكثر (ربح تقريب) · سالب = دفع أقل (خسارة تقريب) */
  diffMinor: number
  stepMinor: number
}

/**
 * تقريب المبلغ النقدي لأقرب خطوة (نصف الخطوة يصعد — اتفاق العرف في الكاشير:
 * لا يشترط على العميل أن يدفع أكثر من النصف).
 */
export function roundCashAmount(totalMinor: number, step: number | null | undefined): CashRounding {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new RangeError('مبلغ التقريب غير صالح')
  const stepMinor = normalizeRoundingStep(step)
  if (stepMinor === 0) return { roundedMinor: totalMinor, diffMinor: 0, stepMinor }
  const roundedMinor = Math.round(totalMinor / stepMinor) * stepMinor
  return { roundedMinor, diffMinor: roundedMinor - totalMinor, stepMinor }
}

/** حساب فروق التسويات النقدية — الطرف الوحيد الذي يستقبل فرق التقريب */
export const CASH_ROUNDING_ACCOUNT = '5112'
