/**
 * المصادقة وتسجيل الدخول (طلب المالك — سد ثغرة انتحال الصلاحيات):
 * قبل هذا الملف كان تبديل «المستخدم النشط» زر راديو بلا أي فحص — أي موظف
 * يصير مالكاً بنقرة. الآن: شاشة دخول فعلية بفحص PIN، وزر خروج، وحارس
 * محاولات فاشلة (قفل مؤقت)، واستعادة كلمة السر بمسارين:
 *   - الموظف: يسجل طلباً من شاشة الدخول ← إشعار للمالك ← المالك يعيّن PIN جديداً.
 *   - المالك: رقم مؤقت يُرسل إلى حساب تليجرام المالك عبر بوته (مجاني وعبر الإنترنت).
 * نواة خالصة بلا واجهات — التجزئة في audit.ts (SHA-256، لا يُخزن الرقم أبداً).
 */

/** سياسة طول كلمة السر (طلب المالك): 8 إلى 32 خانة — أرقام وحروف ورموز */
export const PIN_MIN_LENGTH = 8
export const PIN_MAX_LENGTH = 32

/** فحص صيغة كلمة السر قبل التجزئة — رسائل عربية جاهزة للعرض */
export function validatePinFormat(pin: string): string[] {
  const errors: string[] = []
  if (pin.length < PIN_MIN_LENGTH) errors.push(`كلمة السر قصيرة — ${PIN_MIN_LENGTH} خانات على الأقل`)
  if (pin.length > PIN_MAX_LENGTH) errors.push(`كلمة السر طويلة — ${PIN_MAX_LENGTH} خانة كحد أقصى`)
  if (/\s/.test(pin)) errors.push('كلمة السر لا تحتوي مسافات')
  return errors
}

/** حد المحاولات الفاشلة قبل القفل المؤقت */
export const MAX_LOGIN_FAILURES = 5
/** مدة القفل بعد استنفاد المحاولات (دقائق) */
export const LOCKOUT_MINUTES = 5
/** صلاحية الرقم المؤقت المُرسل للمالك عبر تليجرام (دقائق) */
export const TEMP_PIN_TTL_MIN = 15

/** حارس المحاولات الفاشلة — يُحفظ مع البيانات حتى لا يتحايل أحد بتحديث الصفحة */
export interface LoginGuard {
  failures: number
  lockedUntil: string | null // ISO — قبلها لا دخول
}

export const EMPTY_GUARD: LoginGuard = { failures: 0, lockedUntil: null }

/** تسجيل محاولة فاشلة — عند بلوغ الحد يُقفل الدخول مؤقتاً */
export function registerFailure(guard: LoginGuard, nowIso: string): LoginGuard {
  const failures = guard.failures + 1
  if (failures >= MAX_LOGIN_FAILURES) {
    const until = new Date(Date.parse(nowIso) + LOCKOUT_MINUTES * 60_000).toISOString()
    return { failures: 0, lockedUntil: until }
  }
  return { failures, lockedUntil: guard.lockedUntil }
}

/** الدقائق المتبقية على فك القفل (0 = غير مقفول) */
export function lockoutMinutesLeft(guard: LoginGuard, nowIso: string): number {
  if (!guard.lockedUntil) return 0
  const ms = Date.parse(guard.lockedUntil) - Date.parse(nowIso)
  return ms > 0 ? Math.ceil(ms / 60_000) : 0
}

/** رقم مؤقت 6 خانات بمولد عشوائي مشفّر (لا Math.random) */
export function generateTempPin(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

/** الرقم المؤقت للمالك — يُخزن التجزئة فقط + وقت الانتهاء */
export interface OwnerTempPin {
  pinHash: string
  expiresAt: string // ISO
}

export function tempPinExpired(t: OwnerTempPin, nowIso: string): boolean {
  return Date.parse(nowIso) >= Date.parse(t.expiresAt)
}

/** نص رسالة التليجرام للرقم المؤقت — نص عادي بلا Markdown */
export function buildTempPinMessage(shopName: string, tempPin: string, ttlMin: number): string {
  return [
    `🔐 ${shopName || 'تَحَكَّم'} — استعادة دخول المالك`,
    '',
    `الرقم المؤقت: ${tempPin}`,
    `صالح لمدة ${ttlMin} دقيقة ولاستخدام واحد.`,
    '',
    'ادخل به من شاشة الدخول ثم عيّن رقماً سرياً جديداً فوراً.',
    'إن لم تطلب هذا الرقم فتجاهل الرسالة — لا يستطيع أحد الدخول بدونه.',
  ].join('\n')
}

/* ─── طلبات استعادة كلمة سر الموظفين ─── */

export type PinResetStatus = 'open' | 'done' | 'cancelled'

export interface PinResetRequest {
  id: number
  userId: number // معرف المستخدم في appUsers
  nameAr: string // ثابت وقت الطلب (لو عُطل المستخدم لاحقاً يبقى السجل مفهوماً)
  requestedAt: string // ISO
  status: PinResetStatus
  resolvedAt: string | null
}

/** تحقق قبل تسجيل طلب استعادة — قائمة أخطاء عربية (فارغة = سليم) */
export function validateResetRequest(
  requests: readonly PinResetRequest[],
  userId: number,
  userExists: boolean,
): string[] {
  const errors: string[] = []
  if (!userExists) errors.push('المستخدم غير موجود أو معطل')
  if (requests.some((r) => r.userId === userId && r.status === 'open')) {
    errors.push('يوجد طلب استعادة مفتوح بالفعل لهذا المستخدم — أبلغ المالك')
  }
  return errors
}

/**
 * هل شاشة الدخول مطلوبة أصلاً؟
 * لا تُفرض على مالك وحيد لم يعيّن رقماً سرياً ولا أضاف موظفين —
 * أول ما يُعيَّن PIN للمالك أو يُضاف موظف نشط تصبح إلزامية.
 */
export function authRequired(ownerPinHash: string | null, activeUsersCount: number): boolean {
  return ownerPinHash != null || activeUsersCount > 0
}
