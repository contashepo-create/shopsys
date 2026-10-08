/**
 * تذكير العميل بقرب انتهاء اشتراكه (بند 5 من تدقيق 2026-10-08) — نواة خالصة.
 * ────────────────────────────────────────────────────────────────────────────
 * الطلب: «رسالة غير مزعجة للعميل أنه متبقي فقط 10 أيام على انتهاء اشتراكه».
 *
 * ما كان موجوداً: شارة سلبية داخل صفحة الترخيص لا يراها إلا من فتحها، ثم شاشة
 * القفل **بعد** الانتهاء. أي لا شيء بين الاثنين — والعميل يُفاجأ.
 *
 * القرار التصميمي (غير مزعج فعلاً، لا شكلاً):
 *   • يُحسب **محلياً** من `expiresAt` الموقّع في الرخصة ⇒ يعمل أوفلاين تماماً
 *     (لا يعتمد على السحابة ولا على `notices` التي يكتبها المطوّر يدوياً).
 *   • لا نافذة حوارية حاجبة أبداً: إدراج في الجرس + شريط رفيع غير حاجب.
 *   • الشريط يُغلق بـ«×» ويسكت بقية اليوم (ولا يعود إلا غداً) — الحق في الإسكات.
 *   • التدرج: 30 يوماً صامت في الجرس · 10 أيام شريط · 3 أيام شريط كهرماني
 *     بزر «تواصل للتجديد» · منتهي ⇒ شاشة القفل كما هي (لا تكرار).
 *   • مدى الحياة (expiresAt = null) ⇒ لا تذكير إطلاقاً.
 */
import type { LicensePlan } from './license.ts'

/** عتبات التذكير بالأيام — 10 هي المطلوبة صراحةً في طلب المالك */
export const REMINDER_BELL_DAYS = 30
export const REMINDER_BANNER_DAYS = 10
export const REMINDER_URGENT_DAYS = 3

/**
 * درجات التذكير:
 *   none   — لا شيء: مدى الحياة، أو بعيدة، أو منتهية (شاشة القفل تتكفل)
 *   bell   — إدراج صامت في جرس التنبيهات فقط (لا شريط)
 *   banner — الشريط الرفيع غير الحاجب (≤ 10 أيام)
 *   urgent — الشريط نفسه بلون كهرماني + زر «تواصل للتجديد» (≤ 3 أيام)
 *
 * الاتحاد في سطر واحد عمداً: بوابة `verify_literal_comparisons` تبني كتالوج
 * القيم الشرعية من `type X = 'a' | 'b'`، وتعليق كتلي بين الأعضاء يُخرجه من الكتالوج
 * فتُرفض كل مقارنة بـ'banner'/'urgent' كقيمة غير معلنة.
 */
export type ReminderKind = 'none' | 'bell' | 'banner' | 'urgent'

export interface RenewalReminder {
  kind: ReminderKind
  daysLeft: number
  severity: 'info' | 'warn' | 'danger'
  titleAr: string
  bodyAr: string
  /** مسار صفحة الترخيص — نقر التنبيه يفتحها */
  route: string
  /** هل يُعرض زر «تواصل للتجديد»؟ */
  showContact: boolean
  expiresAt: string
}

const LICENSE_ROUTE = '/settings/license'

/** صيغة عربية صحيحة للعدد: يوم واحد · يومان · 3–10 أيام · 11+ يوماً */
export function daysWordAr(days: number): string {
  if (days === 1) return 'يوم واحد'
  if (days === 2) return 'يومان'
  if (days <= 10) return `${days} أيام`
  return `${days} يوماً`
}

/**
 * قرار التذكير — دالة خالصة قابلة للفحص:
 * @param expiresAt من الرخصة الموقّعة (null = مدى الحياة)
 * @param todayIso  اليوم (ISO أو YYYY-MM-DD)
 * @param dismissedDay آخر يوم أسكت فيه المستخدم الشريط (null = لم يُسكت)
 */
export function renewalReminder(args: {
  expiresAt: string | null
  todayIso: string
  plan?: LicensePlan | null
  dismissedDay?: string | null
}): RenewalReminder {
  const today = args.todayIso.slice(0, 10)
  const none: RenewalReminder = {
    kind: 'none', daysLeft: Number.MAX_SAFE_INTEGER, severity: 'info',
    titleAr: '', bodyAr: '', route: LICENSE_ROUTE, showContact: false, expiresAt: '',
  }
  if (!args.expiresAt) return none // مدى الحياة — لا تذكير

  const expiry = args.expiresAt.slice(0, 10)
  const daysLeft = Math.floor((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (Number.isNaN(daysLeft)) return none
  // منتهية ⇒ شاشة القفل هي الواجهة، ولا نكرر الرسالة فوقها
  if (daysLeft < 0) return none
  if (daysLeft > REMINDER_BELL_DAYS) return none

  const base = { daysLeft, route: LICENSE_ROUTE, expiresAt: expiry }
  if (daysLeft <= REMINDER_URGENT_DAYS) {
    return {
      ...base,
      kind: 'urgent',
      severity: 'danger',
      titleAr: daysLeft === 0 ? 'اشتراكك ينتهي اليوم' : `يتبقى ${daysWordAr(daysLeft)} على انتهاء اشتراكك`,
      bodyAr: `جدّد قبل ${expiry} لتستمر كل أقسامك وبياناتك دون انقطاع — بياناتك محفوظة بالكامل في الحالتين.`,
      showContact: true,
    }
  }
  if (daysLeft <= REMINDER_BANNER_DAYS) {
    return {
      ...base,
      kind: 'banner',
      severity: 'warn',
      titleAr: `يتبقى ${daysWordAr(daysLeft)} على انتهاء اشتراكك`,
      bodyAr: `ينتهي في ${expiry} — يمكنك التجديد في أي وقت قبل هذا التاريخ.`,
      showContact: false,
    }
  }
  return {
    ...base,
    kind: 'bell',
    severity: 'info',
    titleAr: `اشتراكك ينتهي خلال ${daysWordAr(daysLeft)}`,
    bodyAr: `تاريخ الانتهاء ${expiry} — لا إجراء مطلوب الآن.`,
    showContact: false,
  }
}

/**
 * هل يُعرض الشريط اليوم؟ (بند «غير مزعج»): لا يُعرض إذا أسكته المستخدم اليوم.
 * الجرس لا يتأثر بالإسكات — الإسكات للشريط الظاهر فقط.
 */
export function shouldShowReminderBar(args: {
  reminder: RenewalReminder
  todayIso: string
  dismissedDay?: string | null
}): boolean {
  if (args.reminder.kind !== 'banner' && args.reminder.kind !== 'urgent') return false
  return args.dismissedDay !== args.todayIso.slice(0, 10)
}

/**
 * إدراج الجرس — يُمرَّر إلى `collectNotifications` كي يستفيد من آليات الجرس
 * الموجودة (غير المقروء · التعليم كمقروء · الفتح بالنقر) بلا اختراع واجهة جديدة.
 */
export function reminderAsNotification(reminder: RenewalReminder): {
  id: string; icon: string; title: string; body: string; severity: 'danger' | 'warn' | 'info'; route: string; perm: string | null
} | null {
  if (reminder.kind === 'none') return null
  return {
    // المعرف ثابت لكل يوم: لا يتكرر في الجرس، ويتجدد غداً تلقائياً
    id: `license:renewal:${reminder.expiresAt}:${reminder.daysLeft}`,
    icon: reminder.kind === 'urgent' ? '⛔' : reminder.kind === 'banner' ? '⏳' : '📅',
    title: reminder.titleAr,
    body: reminder.bodyAr,
    severity: reminder.severity,
    route: reminder.route,
    perm: null, // يراه كل المستخدمين — لكن الشريط نفسه للمالك عملياً (الجرس للجميع)
  }
}
