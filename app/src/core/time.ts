/**
 * الوقت والتواريخ — مصدر واحد بدل `new Date().toISOString()` المتفرقة.
 *
 * العيب الذي يمنعه هذا الملف: `toISOString()` يحوّل إلى UTC. في القاهرة
 * (UTC+2/+3) فاتورة الساعة 01:00 تُرحَّل بتاريخ **أمس**، وساعة الطباعة تظهر
 * بفارق ساعتين. المستندات المحاسبية تُؤرَّخ بيوم المستخدم لا بيوم جرينتش.
 *
 * القاعدة:
 *  - الختم الزمني الكامل (createdAt) يبقى ISO/UTC — لحظة تقنية.
 *  - تاريخ المستند (`date`, `postingDate`) = اليوم المحلي عبر `todayLocalIso`.
 *  - عرض تاريخ مخزّن = `localDateTimeLabel` ليظهر بتوقيت المستخدم.
 */

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (لا UTC) */
export function todayLocalIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

/** تاريخ محلي من نص مخزّن (ISO كامل أو تاريخ مجرد) — التاريخ المجرد يُعاد كما هو */
export function localDateIso(stored: string): string {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (PLAIN_DATE.test(value)) return value
  const t = Date.parse(value)
  return Number.isNaN(t) ? value.slice(0, 10) : todayLocalIso(new Date(t))
}

/**
 * وسم التاريخ والوقت للطباعة: `YYYY-MM-DD HH:mm` بالتوقيت المحلي.
 * تاريخ مجرد يبقى بلا وقت. القيمة غير القابلة للتحليل تُعاد كما هي مقصوصة.
 */
export function localDateTimeLabel(stored: string): string {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (PLAIN_DATE.test(value)) return value
  const t = Date.parse(value)
  if (Number.isNaN(t)) return value.slice(0, 16).replace('T', ' ')
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${todayLocalIso(d)} ${hh}:${mm}`
}

/**
 * ختم زمني كامل يحمل فرق التوقيت المحلي (2026-10-22T01:05:00.000+03:00) —
 * يُستخدم لتواريخ المستندات: `slice(0,10)` منه يعطي يوم المستخدم لا يوم UTC،
 * و`Date.parse` يفهمه، والترتيب داخل نفس المنشأة (نفس الإزاحة) يبقى صحيحاً.
 */
export function localIsoTimestamp(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0')
  const offsetMin = -now.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  return `${todayLocalIso(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
}
