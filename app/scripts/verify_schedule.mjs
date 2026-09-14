/**
 * فحص الإرسال المجدول عبر التليجرام (القرار 32)
 * node --experimental-strip-types scripts/verify_schedule.mjs
 */
import {
  DEFAULT_SCHEDULE_SETTINGS, sanitizeHour, isDailySendDue, localNowIso, hourLabelAr,
} from '../src/core/schedule.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }

/* ─── الافتراضيات ─── */
ok(DEFAULT_SCHEDULE_SETTINGS.enabled === true, 'الجدولة مفعلة افتراضياً')
ok(DEFAULT_SCHEDULE_SETTINGS.hour === 21, 'الساعة الافتراضية 21 (9 مساءً)')

/* ─── تنقية الساعة ─── */
ok(sanitizeHour(0) === 0, 'ساعة 0 صالحة')
ok(sanitizeHour(23) === 23, 'ساعة 23 صالحة')
ok(sanitizeHour('14') === 14, 'نص رقمي يُقبل')
ok(sanitizeHour(24) === 21, '24 ترجع للافتراضي')
ok(sanitizeHour(-1) === 21, 'سالب يرجع للافتراضي')
ok(sanitizeHour('abc') === 21, 'نص فاسد يرجع للافتراضي')
ok(sanitizeHour(9.7) === 9, 'كسور تُبتر')
ok(sanitizeHour(null) === 21, 'null يرجع للافتراضي')

/* ─── متى يستحق الإرسال؟ ─── */
// لم يُرسل قط + بعد الساعة ⇒ يُرسل
ok(isDailySendDue(null, '2026-09-14T21:05', 21) === true, 'لم يُرسل قط وبعد الساعة ⇒ يُرسل')
// لم يُرسل قط + قبل الساعة ⇒ لا
ok(isDailySendDue(null, '2026-09-14T20:59', 21) === false, 'قبل الساعة ⇒ لا يُرسل')
// عند الساعة تماماً ⇒ يُرسل
ok(isDailySendDue(null, '2026-09-14T21:00', 21) === true, 'عند الساعة تماماً ⇒ يُرسل')
// أُرسل اليوم بالفعل ⇒ لا يتكرر
ok(isDailySendDue('2026-09-14', '2026-09-14T22:30', 21) === false, 'أُرسل اليوم ⇒ لا تكرار')
// أُرسل أمس + اليوم بعد الساعة ⇒ يُرسل
ok(isDailySendDue('2026-09-13', '2026-09-14T21:00', 21) === true, 'أُرسل أمس ⇒ يُرسل اليوم')
// أُرسل أمس + اليوم قبل الساعة ⇒ ينتظر
ok(isDailySendDue('2026-09-13', '2026-09-14T08:00', 21) === false, 'صباح اليوم التالي قبل الساعة ⇒ ينتظر')
// catch-up: الجهاز كان مطفأً وقت الجدولة، فُتح منتصف الليل التالي (اليوم تغير) ⇒ يُرسل بعد ساعة الجدولة فقط
ok(isDailySendDue('2026-09-12', '2026-09-14T23:59', 21) === true, 'فوّت يومين ⇒ يُرسل عند أول فرصة')
// جدولة منتصف الليل (hour=0): أي وقت من اليوم يستحق
ok(isDailySendDue('2026-09-13', '2026-09-14T00:01', 0) === true, 'جدولة منتصف الليل تُرسل من أول دقيقة')
// ساعة فاسدة تعامل كالافتراضي 21
ok(isDailySendDue(null, '2026-09-14T20:00', 99) === false, 'ساعة فاسدة ⇒ الافتراضي 21 (لا يُرسل الساعة 20)')
ok(isDailySendDue(null, '2026-09-14T21:00', 99) === true, 'ساعة فاسدة ⇒ الافتراضي 21 (يُرسل الساعة 21)')
// مدخل زمن فاسد لا يرسل أبداً (أمان)
ok(isDailySendDue(null, 'ليس-تاريخاً', 21) === false, 'زمن فاسد ⇒ لا إرسال')

/* ─── localNowIso ─── */
const d = new Date(2026, 8, 14, 21, 5) // شهر 8 = سبتمبر (0-based)
ok(localNowIso(d) === '2026-09-14T21:05', 'صيغة محلية YYYY-MM-DDTHH:mm')
const d2 = new Date(2026, 0, 3, 7, 9)
ok(localNowIso(d2) === '2026-01-03T07:09', 'حشو الأصفار')

/* ─── تسميات الساعات ─── */
ok(hourLabelAr(0) === '12 منتصف الليل', 'منتصف الليل')
ok(hourLabelAr(9) === '9 صباحاً', 'صباحاً')
ok(hourLabelAr(12) === '12 ظهراً', 'ظهراً')
ok(hourLabelAr(21) === '9 مساءً', 'مساءً')
ok(hourLabelAr(99) === '9 مساءً', 'ساعة فاسدة تعرض الافتراضي')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص الإرسال المجدول — ${pass} اختباراً`)
