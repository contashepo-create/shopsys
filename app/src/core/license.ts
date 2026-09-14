/**
 * الترخيص — ShopSys (المرحلة 5) — منقول مفهومياً من نظام mobileshop (القرار 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Ed25519 عبر WebCrypto (متاح في المتصفحات الحديثة وElectron وNode):
 * - المفتاح الخاص عند المطوّر فقط (scripts/license_tool.mjs)
 * - المفتاح العام مضمّن في التطبيق — لا يمكن تزوير مفتاح تفعيل
 * - المفتاح مربوط بمعرّف الجهاز، له خطة وصلاحيات وتاريخ انتهاء
 * - ميزات حساسة (مثل الفاتورة الإلكترونية — القرار 21) تُفعَّل فقط
 *   عبر خصائص المفتاح الذي يصدره المطوّر
 * - كشف إرجاع ساعة الجهاز (trial anchor + آخر ظهور)
 */

/**
 * المفتاح العام للمطوّر (base64url — 32 بايت raw).
 * الخاص المقابل عند المطوّر فقط (خارج المستودع — انظر scripts/license_tool.mjs)
 */
export const DEVELOPER_PUBLIC_KEY_B64U = 'fBHN_qnQPMzYrgYRTYndwwsZUEWfXCASFQHl4G0Td9g'

export type LicensePlan = 'trial' | 'basic' | 'pro' | 'lifetime'

/** ميزات تُفعَّل بمفتاح الترخيص فقط (قرار 21: الفاتورة الإلكترونية بيد المطوّر) */
export type LicenseFeature = 'einvoice_eg' | 'einvoice_sa' | 'multi_branch' | 'telegram_bot'

export interface LicensePayload {
  v: 1 // إصدار الصيغة
  deviceId: string
  customer: string // اسم العميل/المحل
  plan: LicensePlan
  features: LicenseFeature[]
  issuedAt: string // YYYY-MM-DD
  expiresAt: string | null // null = مدى الحياة
}

export type LicenseState =
  | { status: 'trial'; daysLeft: number }
  | { status: 'trial_expired' }
  | { status: 'active'; payload: LicensePayload; daysLeft: number | null }
  | { status: 'expired'; payload: LicensePayload }
  | { status: 'invalid'; reason: string }
  | { status: 'clock_tampered' }

export const TRIAL_DAYS = 14
const KEY_PREFIX = 'SHOPSYS1'

/* ─── base64url ─── */
export function b64uEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** ترتيب حتمي للحقول قبل التوقيع — نفس الترتيب دائماً في الإصدار والتحقق */
export function canonicalPayload(p: LicensePayload): string {
  return JSON.stringify({
    v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
    features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
  })
}

/** توليد معرّف جهاز ثابت المظهر: SHOP-XXXX-XXXX-XXXX */
export function generateDeviceId(randomBytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // بلا حروف ملتبسة
  let s = ''
  for (let i = 0; i < 12; i++) s += alphabet[randomBytes[i] % alphabet.length]
  return `SHOP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** بنية مفتاح التفعيل: SHOPSYS1.<payload-b64u>.<sig-b64u> */
export function encodeLicenseKey(payload: LicensePayload, signature: Uint8Array): string {
  const body = b64uEncode(new TextEncoder().encode(canonicalPayload(payload)))
  return `${KEY_PREFIX}.${body}.${b64uEncode(signature)}`
}

export function decodeLicenseKey(key: string): { payload: LicensePayload; body: string; sig: Uint8Array } {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) throw new Error('صيغة مفتاح التفعيل غير صحيحة')
  let payload: LicensePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1]))) as LicensePayload
  } catch {
    throw new Error('محتوى المفتاح تالف')
  }
  if (payload.v !== 1 || !payload.deviceId || !payload.plan) throw new Error('محتوى المفتاح ناقص')
  return { payload, body: parts[1], sig: b64uDecode(parts[2]) }
}

/* ─── توقيع وتحقق (WebCrypto Ed25519) ─── */

export async function importPublicKey(pubB64u: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64uDecode(pubB64u) as unknown as ArrayBuffer, 'Ed25519', true, ['verify'])
}

/** تحقق كامل من مفتاح: توقيع صحيح + الجهاز مطابق. يعيد الحمولة أو يرمي */
export async function verifyLicenseKey(
  key: string,
  deviceId: string,
  pubB64u: string = DEVELOPER_PUBLIC_KEY_B64U,
): Promise<LicensePayload> {
  const { payload, sig } = decodeLicenseKey(key)
  const pub = await importPublicKey(pubB64u)
  // التحقق على الصيغة القانونية المعاد بناؤها — أي تلاعب بالحمولة يكسر التوقيع
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const ok = await crypto.subtle.verify('Ed25519', pub, sig as unknown as ArrayBuffer, msg as unknown as ArrayBuffer)
  if (!ok) throw new Error('التوقيع غير صحيح — المفتاح ليس صادراً من المطوّر')
  if (payload.deviceId !== deviceId) throw new Error(`المفتاح صادر لجهاز آخر (${payload.deviceId})`)
  return payload
}

/* ─── حالة الترخيص (منطق خالص قابل للفحص) ─── */

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000)
}

/**
 * تقييم الحالة:
 * - ساعة مرجعة (اليوم < آخر ظهور مسجل) ⇒ clock_tampered
 * - مفتاح مفعّل: سارٍ أو منتهٍ حسب expiresAt
 * - لا مفتاح: تجربة 14 يوماً من مرساة أول تشغيل
 */
export function evaluateLicense(args: {
  activatedPayload: LicensePayload | null
  trialStartedAt: string // ISO أول تشغيل
  lastSeenAt: string // آخر يوم شوهد (مرساة ضد إرجاع الساعة)
  today: string // ISO اليوم
}): LicenseState {
  const today = args.today.slice(0, 10)
  if (today < args.lastSeenAt.slice(0, 10)) return { status: 'clock_tampered' }

  if (args.activatedPayload) {
    const p = args.activatedPayload
    if (p.expiresAt === null) return { status: 'active', payload: p, daysLeft: null }
    const left = daysBetween(today, p.expiresAt)
    if (left < 0) return { status: 'expired', payload: p }
    return { status: 'active', payload: p, daysLeft: left }
  }

  const used = daysBetween(args.trialStartedAt, today)
  if (used < 0) return { status: 'clock_tampered' } // اليوم قبل بداية التجربة
  const left = TRIAL_DAYS - used
  if (left <= 0) return { status: 'trial_expired' }
  return { status: 'trial', daysLeft: left }
}

/** هل ميزة مرخّصة؟ (الفاتورة الإلكترونية وغيرها لا تعمل إلا بمفتاح يحملها) */
export function hasFeature(state: LicenseState, feature: LicenseFeature): boolean {
  return state.status === 'active' && state.payload.features.includes(feature)
}

/** هل الاستخدام مسموح أصلاً؟ (تجربة سارية أو مفتاح سارٍ) */
export function isUsable(state: LicenseState): boolean {
  return state.status === 'trial' || state.status === 'active'
}

export const PLAN_LABELS: Record<LicensePlan, string> = {
  trial: 'تجريبي',
  basic: 'أساسي',
  pro: 'احترافي',
  lifetime: 'مدى الحياة',
}

export const FEATURE_LABELS: Record<LicenseFeature, string> = {
  einvoice_eg: 'الفاتورة الإلكترونية — مصر',
  einvoice_sa: 'الفاتورة الإلكترونية — السعودية (زاتكا)',
  multi_branch: 'فروع متعددة',
  telegram_bot: 'بوت التليجرام',
}
