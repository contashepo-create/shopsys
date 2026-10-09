/**
 * بلاغ التسجيل الجديد — بند 2 من تدقيق 2026-10-08.
 * ─────────────────────────────────────────────────────
 * ما كان: العميل يملأ معالج أول التشغيل (الاسم، الهاتف، البريد، اسم المنشأة،
 * النشاط، المدينة، الشارع) ثم… **لا يصل المطوّر شيء**. لا طلب POST في الكود
 * كله، ولا سجل على الخادم، ولا إشعار. المطوّر لا يعرف بوجود عميل جديد إلا إذا
 * أرسل له العميل معرف الجهاز يدوياً وطلب مفتاحاً.
 *
 * ما صار: بلاغ واحد لكل جهاز يُرسل بعد اكتمال الإعداد مباشرة إلى مركز التحكم
 * (`tools/devbot`)، فيصل المطوّر على التليجرام بكل بيانات العميل، ويُسجَّل
 * الجهاز في KV للبحث لاحقاً.
 *
 * قواعد لا تُكسر:
 *   • **لا يمنع الإقلاع ولا يعطّل العمل**: الإرسال fire-and-forget، وأي فشل
 *     شبكة يُبتلع — العميل أوفلاين يكمل عمله عادي ويُعاد المحاولة في الإقلاع
 *     التالي (بند 6: لا إجبار على الإنترنت).
 *   • **مرة واحدة لكل جهاز**: العلامة `registrationReportedAt` تُحفظ محلياً،
 *     فلا إزعاج متكرر للمطوّر عند كل إقلاع.
 *   • **لا بيانات مالية ولا مستندات**: بيانات التواصل والمنشأة التي كتبها
 *     العميل بنفسه في المعالج فقط، وبطول محدود. لا فواتير ولا أرصدة ولا أصناف.
 *   • **موافقة صريحة سابقة**: خانة اختيار في معالج أول التشغيل (غير مفعّلة
 *     افتراضياً ولا تمنع الإكمال) + إفصاح كامل في سياسة الخصوصية (الحقول،
 *     الغرض، ما لا يُرسل أبداً، مكان التخزين، الحذف). بلا `registrationConsentAt`
 *     لا يُرسل شيء إطلاقاً — انظر `shouldReportRegistration` و`LEGAL_VERSION`.
 */

export const REGISTRATION_PATH = '/register'
/** حد حجم البلاغ — العامل يرفض ما فوقه (دفاع مزدوج) */
export const REGISTRATION_MAX_BYTES = 8_192

const DEVICE_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

export interface RegistrationReport {
  deviceId: string
  appVersion: string
  /** 'desktop' | 'web' — يساعد المطوّر على معرفة قناة العميل */
  platform: string
  shopName: string
  ownerName: string
  phone: string
  email: string
  city: string
  street: string
  countryCode: string
  activityId: string
  activityNameAr: string
  accountingMode: string
  plan: string
  /** خصوصية العيادة — تُرسل فقط إن وُجدت (نشاط طبي) */
  doctorSpecialty?: string
  registeredAt: string
}

/** نزع محارف التحكم والوسوم + قصّ الطول (مطابق لتعقيم العامل) */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

/** بريد بالقاعدة نفسها التي يفحصها المعالج (`\S+@\S+\.\S+`) وبحد 254 حرفاً */
function cleanEmail(value: unknown): string {
  const v = clean(value, 254)
  return /^\S+@\S+\.\S+$/.test(v) ? v : ''
}

/** أرقام الهند العربية (٠–٩) والفارسية (۰–۹) ⇒ لاتينية */
function toAsciiDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
}

/**
 * رقم الهاتف: قاعدة واحدة للمعالج والبلاغ (مطابقة لـ tools/devbot/src/registrations.js).
 * «+» اختيارية في البداية، ثم أرقام وفواصل شائعة، و7–15 رقماً. يعيد النص بتنسيق
 * العميل بعد تحويل الأرقام، أو '' إن لم يكن رقماً. كان المعالج يقبل ما يرفضه الخادم
 * فيسقط الهاتف من البلاغ بصمت.
 */
export function normalizePhone(value: unknown): string {
  const v = toAsciiDigits(clean(value, 40))
  if (!/^\+?[0-9 ()./-]+$/.test(v)) return ''
  const digits = v.replace(/\D/g, '').length
  return digits >= 7 && digits <= 15 ? v : ''
}

export function buildRegistrationReport(input: {
  deviceId: string
  appVersion: string
  platform?: string
  shopName?: string
  ownerName?: string
  phone?: string
  email?: string
  city?: string
  street?: string
  countryCode?: string | null
  activityId?: string | null
  activityNameAr?: string
  accountingMode?: string
  plan?: string | null
  doctorSpecialty?: string
  registeredAt?: string
}): RegistrationReport | null {
  const deviceId = clean(input.deviceId, 24).toUpperCase()
  // بلا معرف جهاز صالح لا فائدة من البلاغ — المطوّر لن يستطيع ربطه بعميل
  if (!DEVICE_RE.test(deviceId)) return null
  const specialty = clean(input.doctorSpecialty, 60)
  const report: RegistrationReport = {
    deviceId,
    appVersion: clean(input.appVersion, 20),
    platform: clean(input.platform, 16) === 'web' ? 'web' : 'desktop',
    shopName: clean(input.shopName, 120),
    ownerName: clean(input.ownerName, 120),
    phone: normalizePhone(input.phone),
    email: cleanEmail(input.email),
    city: clean(input.city, 80),
    street: clean(input.street, 160),
    countryCode: clean(input.countryCode, 4).toUpperCase(),
    activityId: clean(input.activityId, 40),
    activityNameAr: clean(input.activityNameAr, 60),
    accountingMode: clean(input.accountingMode, 10) === 'full' ? 'full' : 'simple',
    plan: clean(input.plan, 12) || 'trial',
    ...(specialty ? { doctorSpecialty: specialty } : {}),
    registeredAt: clean(input.registeredAt, 30) || new Date().toISOString(),
  }
  return report
}

/**
 * هل نرسل البلاغ الآن؟ — بعد اكتمال الإعداد، وبموافقة صريحة، ومرة واحدة لكل جهاز.
 *
 * الترتيب مقصود: **الموافقة أولاً** لأنها شرط قانوني لا تحسين — سياسة الخصوصية
 * المنشورة تقول إن البيانات محلية، فلا يجوز إرسال بيانات المنشأة والتواصل بلا
 * خانة موافقة فعّلها العميل بنفسه. و`reportedAt` تُحفظ عند النجاح فقط، فيُعاد
 * المحاولة في الإقلاع التالي لو كان العميل أوفلاين (بند 6).
 */
export function shouldReportRegistration(input: {
  setupCompleted: boolean
  deviceId: string
  reportedAt: string | null
  /** وقت الموافقة الصريحة — null/فارغ ⇒ لا إرسال إطلاقاً */
  consentAt: string | null
}): boolean {
  if (!input.setupCompleted) return false
  if (!input.consentAt) return false
  if (input.reportedAt) return false
  return DEVICE_RE.test(clean(input.deviceId, 24).toUpperCase())
}

/**
 * إرسال البلاغ إلى مركز التحكم — **لا يرمي استثناء أبداً**.
 * يعيد:
 *   'sent'      ⇒ قُبل وأُبلغ المطوّر (أول بلاغ للجهاز)
 *   'duplicate' ⇒ قُبل لكن الجهاز معروف مسبقاً (تحديث صامت)
 *   'failed'    ⇒ شبكة/خادم — لا يُعلَّم المتجر، فتُعاد المحاولة في الإقلاع التالي
 * المهلة 12 ثانية: لا نترك طلباً معلّقاً يستهلك بطارية/شبكة بلا داعٍ.
 */
export async function sendRegistrationReport(
  baseUrl: string,
  report: RegistrationReport,
): Promise<'sent' | 'duplicate' | 'failed'> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${REGISTRATION_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      signal: controller.signal,
    })
    if (!res.ok) return 'failed'
    const parsed = (await res.json().catch(() => null)) as { isNew?: boolean } | null
    return parsed?.isNew ? 'sent' : 'duplicate'
  } catch {
    return 'failed' // أوفلاين — حالة طبيعية تماماً
  } finally {
    /* في مسار الفشل أيضاً: وإلا يبقى مؤقّت 12 ثانية معلّقاً بعد كل محاولة أوفلاين */
    clearTimeout(timer)
  }
}

/** صياغة عربية للبلاغ — تُعرض للمطوّر على التليجرام (مطابقة لصياغة العامل) */
export function formatRegistrationAr(report: RegistrationReport): string {
  const lines = [
    '🆕 <b>تسجيل عميل جديد</b>',
    '',
    `🏪 المنشأة: ${report.shopName || '—'}`,
    `👤 المالك: ${report.ownerName || '—'}`,
    report.phone ? `📞 الهاتف: <code>${report.phone}</code>` : '',
    report.email ? `📧 البريد: <code>${report.email}</code>` : '',
    report.city || report.street ? `📍 العنوان: ${[report.city, report.street].filter(Boolean).join(' — ')}` : '',
    `🧭 النشاط: ${report.activityNameAr || report.activityId || '—'}${report.countryCode ? ` (${report.countryCode})` : ''}`,
    report.doctorSpecialty ? `🩺 التخصص: ${report.doctorSpecialty}` : '',
    `📦 الخطة: ${report.plan} · المحاسبة: ${report.accountingMode === 'full' ? 'متقدمة' : 'بسيطة'}`,
    `🖥️ الجهاز: <code>${report.deviceId}</code> · ${report.platform === 'web' ? 'المتصفح' : 'تطبيق سطح المكتب'}`,
    `🔖 الإصدار: ${report.appVersion || '—'}`,
    `🕒 الوقت: ${report.registeredAt}`,
  ]
  return lines.filter(Boolean).join('\n')
}
