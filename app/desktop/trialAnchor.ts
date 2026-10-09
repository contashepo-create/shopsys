/**
 * مرساة التجربة و«آخر ظهور» خارج التخزين المحلي للواجهة (سطح المكتب) — دالة خالصة.
 * ─────────────────────────────────────────────────────────────────────────────
 * الملف userData/trial-anchor.json يُقرأ ويُكتب من العملية الرئيسية فقط. قاعدته:
 * - بداية التجربة: **الأقدم** بين المحفوظ والمُرسَل — مسح القاعدة أو التخزين لا يعيد التجربة.
 * - آخر ظهور: **الأحدث** بينهما — لا رجوع للخلف (خط الدفاع ضد إرجاع ساعة الجهاز).
 * - القيم التالفة (ليست تواريخ) لا تُقبل أبداً: نص فارغ كان يصير «الأقدم» فيُفسد المرساة.
 *
 * ح5 (مراجعة ③): قبل هذا الإصلاح كان الملف يقبل أي نص يرسله التطبيق، ولا يحمل
 * «آخر ظهور» أصلاً، فإعادة الساعة بتعديل التخزين المحلي لم تكن تُكشف على سطح المكتب.
 *
 * منفصلة عن electron كي تُختبر (انظر deviceKeyStore.ts لنفس النمط).
 */

export interface TrialAnchorValues {
  firstTrialAt: string | null
  lastSeenAt: string | null
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** تاريخ صالح: بادئة YYYY-MM-DD تُقرأ فعلاً (الوقت بعدها اختياري) */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10) return false
  const day = value.slice(0, 10)
  return ISO_DAY_RE.test(day) && Number.isFinite(Date.parse(day))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** أقدم (older=true) أو أحدث (older=false) تاريخ صالح بين المرشحين */
function pickValid(candidates: unknown[], older: boolean): string | null {
  let best: string | null = null
  for (const c of candidates) {
    if (!isIsoDay(c)) continue
    if (best === null) { best = c; continue }
    const a = c.slice(0, 10)
    const b = best.slice(0, 10)
    if (older ? a < b : a > b) best = c
  }
  return best
}

/**
 * يدمج المحفوظ مع ما أرسله التطبيق. `changed` يخبر المستدعي هل يلزم الكتابة
 * (حارس الفرق: لا كتابة على القرص عند عدم تغيّر شيء — كل ساعة).
 */
export function mergeTrialAnchor(saved: unknown, incoming: unknown): { anchor: TrialAnchorValues; changed: boolean } {
  const s = asRecord(saved)
  const i = asRecord(incoming)
  const anchor: TrialAnchorValues = {
    firstTrialAt: pickValid([s.firstTrialAt, i.firstTrialAt], true),
    lastSeenAt: pickValid([s.lastSeenAt, i.lastSeenAt], false),
  }
  const before: TrialAnchorValues = {
    firstTrialAt: isIsoDay(s.firstTrialAt) ? s.firstTrialAt : null,
    lastSeenAt: isIsoDay(s.lastSeenAt) ? s.lastSeenAt : null,
  }
  return { anchor, changed: anchor.firstTrialAt !== before.firstTrialAt || anchor.lastSeenAt !== before.lastSeenAt }
}
