/**
 * الربط السحابي عبر Cloudflare (القرار 28) — نواة خالصة + جالبات
 * ───────────────────────────────────────────────────────────────
 * Worker بسيط عند المطوّر يخدم ثلاث نقاط (كلها JSON):
 *   GET /about                  → محتوى صفحة «حول» يتحكم فيه المطوّر عن بُعد
 *   GET /revoked                → قائمة بصمات المفاتيح المحروقة
 *   GET /subscription/:deviceId → حالة اشتراك العميل (عرض فقط — الحجية للمفتاح الموقّع)
 *   GET /notifications/:deviceId → تنبيهات المطوّر العامة والخاصة بالجهاز
 * التطبيق يعمل أوفلاين دائماً: الجلب تحسين، وفشله لا يعطل شيئاً،
 * وآخر نتيجة تُخزن محلياً وتُستخدم حتى يتوفر اتصال.
 */

// عامل الترخيص وصفحة «حول» الجديد.
export const LICENSE_CLOUD_BASE_URL = 'https://shopsys-control.mobileshop2026.workers.dev'

// الخدمات الأقدم لا تزال على العامل الكامل: أعلام الميزات وقناة الدعم.
export const APP_SERVICES_CLOUD_BASE_URL = 'https://shopsys-control.contashepo.workers.dev'

/** الاسم السابق يبقى للتوافق مع أي استيراد قديم داخل التطبيق. */
export const DEFAULT_CLOUD_BASE_URL = LICENSE_CLOUD_BASE_URL

/* ─── صفحة «حول» ─── */

/**
 * بند 9 (تدقيق 2026-10-08): حقول حرة يضيفها المطوّر من لوحته فتظهر في «حول».
 */
export interface AboutExtraField {
  label: string
  value: string
  /** رابط اختياري — يُعقَّم كباقي الروابط (لا javascript: ولا data:) */
  url?: string
}

export interface AboutContent {
  title: string
  body: string // نص/ماركداون بسيط يتحكم فيه المطوّر
  supportPhone: string
  /** رقم واتساب دولي بلا «+» — يُبنى منه رابط wa.me */
  supportWhatsapp: string
  supportTelegram: string // @username للتواصل
  supportEmail: string
  website: string
  address: string
  workHours: string
  /** قنوات إضافية (فيسبوك/إنستغرام/…) — روابط معقّمة */
  socialLinks: { label: string; url: string }[]
  /** حقول حرة يضيفها المطوّر من اللوحة */
  extraFields: AboutExtraField[]
  updatedAt: string
}

/**
 * النسخة الاحتياطية — تُعرض حين يتعذّر الوصول للعامل (أوفلاين) أو قبل نشره.
 * كانت حقول التواصل فيها فارغة، فعميلٌ انتهى اشتراكه ولا إنترنت عنده **لا يجد
 * أي وسيلة للتواصل مع المطوّر** على شاشة القفل. تُملأ هذه القيم من اللوحة
 * (`about.fallback` في KV) فتصل كل النسخ في أول مزامنة، وتبقى هنا كأرضية.
 */
export const FALLBACK_ABOUT: AboutContent = {
  title: 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
  body: 'نظام عربي متكامل للمبيعات والمخازن والحسابات العامة — يدعم أنشطة متعددة ويعمل بلا إنترنت.',
  supportPhone: '',
  supportWhatsapp: '',
  supportTelegram: '',
  supportEmail: '',
  website: '',
  address: '',
  workHours: '',
  socialLinks: [],
  extraFields: [],
  updatedAt: '',
}

/* ── تعقيم مدخلات «حول» ───────────────────────────────────────────────
 * المحتوى يكتبه المطوّر، لكنه **يُعرض في href** عند كل العملاء ⇒ أي رابط
 * `javascript:` أو `data:` يصير تنفيذ كود في تطبيق العميل. القاعدة:
 * http/https/mailto/tel فقط، وبلا محارف تكسر السمة أو تُخفي الوجهة. */
const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|tel:)[^\s<>"'`\\]{3,300}$/i
const PHONE_RE = /^\+?[0-9][0-9\s-]{5,23}$/
const TELEGRAM_RE = /^[A-Za-z0-9_]{4,40}$/
const EMAIL_RE = /^[^\s@<>]{3,64}@[^\s@<>]{3,64}$/

/**
 * رابط آمن للعرض في href. القاعدة **رفض لا تنظيف**: أي مسافة أو اقتباس أو زاوية
 * أو شرطة مائلة عكسية في المدخل ⇒ رفض كامل، لأن «تنظيف» الرابط بإزالة المحارف
 * الخطرة يترك رابطاً مشوّهاً قد يمرّ كصالح (https://a.app/" onclick="x ⇒
 * https://a.app/onclick=x). الرفض يجعل الخطأ ظاهراً للمطوّر بدل تمريره صامتاً.
 */
export function sanitizeAboutUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (v.length < 3 || v.length > 300) return ''
  if (/[\s<>"'`\\]/.test(v)) return ''
  return SAFE_URL_RE.test(v) ? v : ''
}

export function sanitizeAboutPhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim().slice(0, 24)
  return PHONE_RE.test(v) ? v : ''
}

/** واتساب: أرقام فقط (بلا + ولا مسافات) — يُبنى الرابط wa.me/<رقم> */
export function sanitizeAboutWhatsapp(value: unknown): string {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/[^\d]/g, '').slice(0, 15)
  return digits.length >= 8 ? digits : ''
}

export function sanitizeAboutTelegram(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim().replace(/^@+/, '').slice(0, 40)
  return TELEGRAM_RE.test(v) ? v : ''
}

export function sanitizeAboutEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim().slice(0, 128)
  return EMAIL_RE.test(v) ? v : ''
}

/** نص عرض عادي: بلا وسوم ولا محارف تحكم، بطول محدود */
export function sanitizeAboutText(value: unknown, max = 300): string {
  if (typeof value !== 'string') return ''
  return value
    // محارف التحكم مقصودة هنا: نزعها هو الهدف (لا تمرير نص يحتويها للعرض)
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

export function whatsappLink(number: string): string {
  const digits = number.replace(/[^\d]/g, '')
  return digits.length >= 8 ? `https://wa.me/${digits}` : ''
}

/** هل توجد أي وسيلة تواصل معروضة؟ (تُستخدم لعرض تلميح بدل فراغ صامت) */
export function hasAboutContact(about: AboutContent): boolean {
  return Boolean(
    about.supportPhone || about.supportWhatsapp || about.supportTelegram
    || about.supportEmail || about.website || about.socialLinks.length,
  )
}

/** تنقية استجابة /about — أي حقل ناقص يأخذ الاحتياطي (لا نثق بالشكل الخارجي) */
export function parseAbout(raw: unknown): AboutContent {
  const o = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb)
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  // بوت الترخيص القديم يعيد نص «حول» في الحقل text؛ العامل الكامل يعيد body.
  return {
    title: sanitizeAboutText(o.title, 120) || FALLBACK_ABOUT.title,
    body: sanitizeAboutText(str(o.body, str(o.text, '')), 4000) || FALLBACK_ABOUT.body,
    supportPhone: sanitizeAboutPhone(o.supportPhone),
    supportWhatsapp: sanitizeAboutWhatsapp(o.supportWhatsapp ?? o.whatsapp),
    supportTelegram: sanitizeAboutTelegram(o.supportTelegram),
    supportEmail: sanitizeAboutEmail(o.supportEmail ?? o.email),
    website: sanitizeAboutUrl(o.website),
    address: sanitizeAboutText(o.address, 200),
    workHours: sanitizeAboutText(o.workHours, 120),
    socialLinks: list(o.socialLinks).flatMap((entry): AboutContent['socialLinks'] => {
      if (typeof entry !== 'object' || entry === null) return []
      const item = entry as Record<string, unknown>
      const url = sanitizeAboutUrl(item.url)
      const label = sanitizeAboutText(item.label, 40)
      return url ? [{ label: label || 'رابط', url }] : []
    }).slice(0, 8),
    extraFields: list(o.extraFields).flatMap((entry): AboutExtraField[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const item = entry as Record<string, unknown>
      const label = sanitizeAboutText(item.label, 60)
      const value = sanitizeAboutText(item.value, 300)
      if (!label || !value) return []
      const url = sanitizeAboutUrl(item.url)
      return [{ label, value, ...(url ? { url } : {}) }]
    }).slice(0, 20),
    updatedAt: str(o.updatedAt, '').slice(0, 40),
  }
}

/* ─── قائمة الإبطال (حرق المفاتيح) ─── */

/** تنقية استجابة /revoked: مصفوفة بصمات hex فقط */
export function parseRevocationList(raw: unknown): string[] {
  let value = raw
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>).text
    if (typeof text === 'string') value = text
  }
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{8}$/.test(x))
}

/* ─── حالة الاشتراك (عرض) ─── */

export interface CloudSubscription {
  plan: string
  expiresAt: string | null
  message: string // رسالة من المطوّر للعميل (تجديد قريب…)
}

/**
 * تنبيه أرسله المطوّر من البوت إلى جهاز واحد أو إلى جميع العملاء.
 * بند 10 (تدقيق 2026-10-08): درجة التنبيه هي التي تحدّد طريقة عرضه.
 *   info      ⇒ الجرس + توست فقط (السلوك السابق — لا مقاطعة)
 *   important ⇒ نافذة منبثقة قابلة للتأجيل («لاحقاً») + إيصال قراءة
 *   critical  ⇒ نافذة منبثقة **إلزامية الإقرار** — لا تُغلق إلا بـ«تمّت القراءة»
 * القيمة الافتراضية info ⇒ كل التنبيهات القديمة المحفوظة تعمل كما كانت.
 */
export type NoticeLevel = 'info' | 'important' | 'critical'

export const NOTICE_LEVELS: NoticeLevel[] = ['info', 'important', 'critical']

export function parseNoticeLevel(value: unknown): NoticeLevel {
  return value === 'critical' || value === 'important' ? value : 'info'
}

export interface CloudNotice {
  id: string
  title: string
  body: string
  createdAt: string
  expiresAt: string | null
  /** درجة الإلزام — انظر NoticeLevel */
  level: NoticeLevel
  /**
   * هل يطلب المطوّر إيصال قراءة؟ حقل **مشتق من الدرجة** في الطرفين
   * (`level !== 'info'`) ومحفوظ في السلك للتوافق وللإحصاء على العامل؛ القرار
   * في العميل مرجعه `level` وحدها (`isAckMandatory`/`isPopupNotice` في
   * core/devNotice.ts) حتى لا يتباعد مصدران للحقيقة.
   */
  requiresAck: boolean
}

export function parseCloudNotices(raw: unknown): CloudNotice[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).notifications)
      ? (raw as Record<string, unknown>).notifications as unknown[]
      : []
  const now = Date.now()
  return list.flatMap((entry): CloudNotice[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const o = entry as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.body !== 'string') return []
    const expiresAt = typeof o.expiresAt === 'string' ? o.expiresAt : null
    if (expiresAt && Date.parse(expiresAt) <= now) return []
    const level = parseNoticeLevel(o.level)
    return [{
      id: o.id.slice(0, 64),
      title: sanitizeAboutText(o.title, 120) || 'رسالة من المطوّر',
      body: sanitizeAboutText(o.body, 1500),
      createdAt: typeof o.createdAt === 'string' ? o.createdAt.slice(0, 40) : '',
      expiresAt,
      level,
      requiresAck: typeof o.requiresAck === 'boolean' ? o.requiresAck : level !== 'info',
    }]
  })
}

export function parseSubscription(raw: unknown): CloudSubscription | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    plan: typeof o.plan === 'string' ? o.plan : '',
    expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : null,
    message: typeof o.message === 'string' ? o.message : '',
  }
}

/* ─── الجالبات (فشلها الصامت مقصود — أوفلاين أولاً) ─── */

async function getJson(url: string, timeoutMs = 6000): Promise<unknown | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchAbout(baseUrl: string): Promise<AboutContent | null> {
  const raw = await getJson(`${baseUrl.replace(/\/$/, '')}/about`)
  return raw == null ? null : parseAbout(raw)
}

export async function fetchRevocationList(baseUrl: string): Promise<string[] | null> {
  const raw = await getJson(`${baseUrl.replace(/\/$/, '')}/revoked`)
  return raw == null ? null : parseRevocationList(raw)
}

export async function fetchSubscription(baseUrl: string, deviceId: string): Promise<CloudSubscription | null> {
  const raw = await getJson(`${baseUrl.replace(/\/$/, '')}/subscription/${encodeURIComponent(deviceId)}`)
  return parseSubscription(raw)
}

export async function fetchCloudNotices(baseUrl: string, deviceId: string): Promise<CloudNotice[] | null> {
  const raw = await getJson(`${baseUrl.replace(/\/$/, '')}/notifications/${encodeURIComponent(deviceId)}`)
  return raw == null ? null : parseCloudNotices(raw)
}
