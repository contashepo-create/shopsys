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

export interface AboutContent {
  title: string
  body: string // نص/ماركداون بسيط يتحكم فيه المطوّر
  supportPhone: string
  supportTelegram: string // @username للتواصل
  website: string
  updatedAt: string
}

export const FALLBACK_ABOUT: AboutContent = {
  title: 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
  body: 'نظام عربي متكامل للمبيعات والمخازن والحسابات العامة — يدعم أنشطة متعددة ويعمل بلا إنترنت.',
  supportPhone: '',
  supportTelegram: '',
  website: '',
  updatedAt: '',
}

/** تنقية استجابة /about — أي حقل ناقص يأخذ الاحتياطي (لا نثق بالشكل الخارجي) */
export function parseAbout(raw: unknown): AboutContent {
  const o = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb)
  // بوت الترخيص القديم يعيد نص «حول» في الحقل text؛ العامل الكامل يعيد body.
  return {
    title: str(o.title, FALLBACK_ABOUT.title),
    body: str(o.body, str(o.text, FALLBACK_ABOUT.body)),
    supportPhone: str(o.supportPhone, ''),
    supportTelegram: str(o.supportTelegram, ''),
    website: str(o.website, ''),
    updatedAt: str(o.updatedAt, ''),
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

/** تنبيه أرسله المطوّر من البوت إلى جهاز واحد أو إلى جميع العملاء. */
export interface CloudNotice {
  id: string
  title: string
  body: string
  createdAt: string
  expiresAt: string | null
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
    return [{
      id: o.id,
      title: typeof o.title === 'string' ? o.title : 'رسالة من المطوّر',
      body: o.body.slice(0, 1500),
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      expiresAt,
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
