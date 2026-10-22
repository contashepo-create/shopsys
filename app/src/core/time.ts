/**
 * الوقت والتواريخ — مصدر واحد بدل `new Date().toISOString()` المتفرقة.
 *
 * العيب الذي يمنعه هذا الملف: `toISOString()` يحوّل إلى UTC. في القاهرة
 * (UTC+2/+3) فاتورة الساعة 01:00 تُرحَّل بتاريخ **أمس**، وساعة الطباعة تظهر
 * بفارق ساعتين. المستندات المحاسبية تُؤرَّخ بيوم المستخدم لا بيوم جرينتش.
 *
 * القاعدة:
 *  - تاريخ المستند (`date`, `postingDate`) = اليوم المحلي عبر `todayLocalIso`.
 *  - الختم الكامل (createdAt) = `localIsoTimestamp` بإزاحة صريحة، فلا يُقرأ
 *    كيوم UTC عند القص إلى عشرة أحرف ولا يضيع ترتيبه؛ عرضه = `localDateTimeLabel`.
 *  - الأختام القديمة المحفوظة بـ`Z` لا تُعدَّل بياناتها؛ العرض يحوّلها فقط.
 */

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (لا UTC) */
export function todayLocalIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
/* ختم محلي كَتَبْناه بإزاحته (+03:00). ساعته «ساعة المستند» لا لحظة كونية:
   تحويلها بإزاحة اليوم (صيف/شتاء) كان يعرض فاتورة يوليو 12:00 الساعة 11:00
   في يناير. الأختام القديمة بـZ تبقى لحظات كونية تُحوَّل لبتوقيت العارض. */
const LOCAL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?[+-]\d{2}:\d{2}$/

/**
 * تاريخ `YYYY-MM-DD` من كائن Date بُني **بـUTC عمداً** (تقويم مجرّد لا لحظة).
 * لا تستخدمه إلا على تاريخ مجرّد؛ لحظات المستخدم تُقرأ بـ`todayLocalIso`.
 */
export function calendarDateIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * إضافة أشهر تقويمية مع تثبيت آخر يوم في الشهر.
 * `setMonth(+1)` على 31 يناير يعطي 3 مارس (انسكاب)، فيصبح قسط/إيجار في شهر خاطئ.
 * 31 يناير + شهر = 28/29 فبراير — وهو ما يتوقعه المستخدم والتقويم.
 */
export function addCalendarMonths(dateIso: string, months: number): string {
  const day = (dateIso ?? '').slice(0, 10)
  const base = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(base.getTime()) || !Number.isInteger(months)) return day
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay))
  return calendarDateIso(target)
}

/** تاريخ محلي من نص مخزّن (ISO كامل أو تاريخ مجرد) — التاريخ المجرد يُعاد كما هو */
export function localDateIso(stored: string): string {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (PLAIN_DATE.test(value)) return value
  /* ختم محلي بإزاحته: يومه مكتوب فيه — لا يُعاد حسابه بإزاحة اليوم */
  if (LOCAL_STAMP.test(value)) return value.slice(0, 10)
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
  /* ساعة المستند كما كُتبت — ثابتة في كل المناطق وفصول السنة */
  if (LOCAL_STAMP.test(value)) return `${value.slice(0, 10)} ${value.slice(11, 16)}`
  const t = Date.parse(value)
  if (Number.isNaN(t)) return value.slice(0, 16).replace('T', ' ')
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${todayLocalIso(d)} ${hh}:${mm}`
}

/**
 * وسم مضغوط لأسماء الملفات: `YYYY-MM-DD-HHmm` بالتوقيت المحلي للعارض.
 * يخدم الأختام القديمة المحفوظة بـ`Z` (اسم نسخة احتياطية يحمل ساعة UTC كان
 * يبدو «من المستقبل/الماضي» بفارق ساعتين لقارئ القاهرة).
 */
export function localStampCompact(stored: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2}))?$/.exec(localDateTimeLabel(stored))
  if (!m) return ''
  return m[2] ? `${m[1]}-${m[2]}${m[3]}` : m[1]
}

/**
 * ختم زمني كامل يحمل فرق التوقيت المحلي (2026-10-22T01:05:00.000+03:00) —
 * يُستخدم لتواريخ المستندات: `slice(0,10)` منه يعطي يوم المستخدم لا يوم UTC،
 * و`Date.parse` يفهمه، والترتيب داخل نفس المنشأة (نفس الإزاحة) يبقى صحيحاً.
 */
const pad2 = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0')
/** إزاحة المنطقة الزمنية للكائن (أو الآن) بصيغة +03:00 — للطباعة والمقارنة */
export const offsetSuffix = (now: Date = new Date()) => {
  const offsetMin = -now.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  return `${sign}${pad2(offsetMin / 60)}:${pad2(offsetMin % 60)}`
}

export function localIsoTimestamp(now: Date = new Date()): string {
  return `${todayLocalIso(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.${pad2(now.getMilliseconds(), 3)}${offsetSuffix(now)}`
}

/**
 * ختم على يوم محدَّد بوقت ثابت وإزاحة محلية — لقيود تُرحَّل بتاريخ مختار
 * (رواتب/صرف براتب): تاريخ المستند هو اليوم المطلوب، والإزاحة تمنع عرضه منزاحاً.
 */
export function localTimestampOn(dateIso: string, hour = 9): string {
  const day = (dateIso ?? '').slice(0, 10)
  if (!PLAIN_DATE.test(day)) return localIsoTimestamp()
  // إزاحة اليوم المطلوب نفسه لا إزاحة اليوم الحالي: قيد يناير على جهاز صيفي
  // يجب أن يحمل +02:00 لا +03:00 وإلا عُرضت ساعته منزاحة عند الطباعة.
  const clock = `${pad2(hour)}:00:00.000`
  return `${day}T${clock}${offsetSuffix(new Date(`${day}T${clock}`))}`
}

/**
 * ختم ليوم محدَّد مع **ساعة اللحظة الحالية** وإزاحة ذلك اليوم.
 * يُستخدم للمستند المؤرَّخ في الماضي (فاتورة متأخرة الإدخال): تاريخ القيد هو
 * اليوم المختار، والساعة المعروضة هي ساعة الإدخال نفسها في ذلك اليوم — لا
 * ساعةً مزاحة بفارق التوقيت الصيفي بين اليومين.
 */
export function localTimestampOnDay(dateIso: string, at: Date = new Date()): string {
  const day = (dateIso ?? '').slice(0, 10)
  if (!PLAIN_DATE.test(day)) return localIsoTimestamp(at)
  const clock = `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}.${pad2(at.getMilliseconds(), 3)}`
  const onDay = new Date(`${day}T${clock}`)
  return `${day}T${clock}${Number.isNaN(onDay.getTime()) ? offsetSuffix(at) : offsetSuffix(onDay)}`
}
