/**
 * الإرسال المجدول عبر بوت التليجرام — تَحَكَّم TAHAKAM ERP (القرار 32)
 * ─────────────────────────────────────────────────────────────────
 * منطق نقي بلا شبكة: متى يُرسل تقرير اليوم/النسخة الاحتياطية تلقائياً؟
 *
 * القاعدة: إرسال واحد لكل يوم بعد ساعة محددة (افتراضياً 21:00 بتوقيت الجهاز).
 * - التطبيق يفحص كل بضع دقائق: هل حانت الساعة ولم يُرسل اليوم؟ ⇒ أرسل وسجّل.
 * - لو كان الجهاز مطفأً وقت الجدولة، يُرسل فور أول تشغيل تالٍ (catch-up)
 *   لتقرير اليوم نفسه أو أمس إن تغيّر اليوم (lastSentDay يمنع التكرار).
 * - فشل الإرسال (أوفلاين) لا يسجل الإرسال — يُعاد تلقائياً في الفحص التالي.
 */

export interface ScheduleSettings {
  /** تفعيل الإرسال المجدول ككل (التقرير والنسخة حسب مفاتيح telegram) */
  enabled: boolean
  /** ساعة الإرسال اليومي 0-23 (افتراضياً 21 = 9 مساءً بعد إقفال اليوم) */
  hour: number
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  enabled: true,
  hour: 21,
}

/** تنقية ساعة مدخلة من المستخدم إلى 0-23 صحيحة */
export function sanitizeHour(h: unknown): number {
  if (h == null || h === '') return DEFAULT_SCHEDULE_SETTINGS.hour
  const n = Math.trunc(Number(h))
  if (!Number.isFinite(n) || n < 0 || n > 23) return DEFAULT_SCHEDULE_SETTINGS.hour
  return n
}

/**
 * هل حان إرسال اليوم؟ (نقية — تُختبر بتواريخ صريحة)
 * @param lastSentDay آخر يوم أُرسل فيه بنجاح «YYYY-MM-DD» أو null
 * @param nowIso لحظة الفحص الحالية بتوقيت الجهاز المحلي مثل «2026-09-14T21:05»
 * @param hour ساعة الجدولة 0-23
 */
export function isDailySendDue(lastSentDay: string | null, nowIso: string, hour: number): boolean {
  const day = nowIso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}/.test(day)) return false
  if (lastSentDay === day) return false // أُرسل اليوم بالفعل
  const nowHour = Number(nowIso.slice(11, 13))
  if (!Number.isFinite(nowHour)) return false
  return nowHour >= sanitizeHour(hour)
}

/** «الآن» المحلي بصيغة ISO بلا منطقة زمنية: YYYY-MM-DDTHH:mm (لأن الجدولة بساعة الجهاز) */
export function localNowIso(d: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** تسميات ساعات العرض للاختيار من الإعدادات: «9 مساءً»… */
export function hourLabelAr(h: number): string {
  const clean = sanitizeHour(h)
  if (clean === 0) return '12 منتصف الليل'
  if (clean < 12) return `${clean} صباحاً`
  if (clean === 12) return '12 ظهراً'
  return `${clean - 12} مساءً`
}
