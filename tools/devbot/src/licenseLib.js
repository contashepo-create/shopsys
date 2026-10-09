/**
 * مكتبة إصدار مفاتيح التفعيل — نسخة خادم Cloudflare Worker.
 * مستنسخة **حرفياً** من app/src/core/license.ts (canonicalPayload/b64u/keyFingerprint):
 * أي فرق في ترتيب الحقول أو الترميز يكسر التوقيع عند العميل.
 * الملف مشترك: worker.js يستورده، واختبار التوافق الذهبي
 * (app/tests/devbot_license_compat.test.ts) يتحقق أن مفاتيحه تمر بـverifyLicenseKey.
 */

export const KEY_PREFIX = 'SHOPSYS1'

/** base64url بلا حشوة (مطابق b64uEncode) */
export function b64uEncode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url فك (مطابق b64uDecode) */
export function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * ترتيب حتمي للحقول قبل التوقيع — نفس ترتيب license.ts بالضبط:
 * الحقلان الاختياريان (extraUsers/extraBranches) يدخلان الصيغة فقط عند وجودهما،
 * كي تبقى توقيعات المفاتيح القديمة (بلا زيادات) صحيحة كما هي.
 */
export function canonicalPayload(p) {
  const base = {
    v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
    features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
  }
  if (p.extraUsers != null) base.extraUsers = p.extraUsers
  if (p.extraBranches != null) base.extraBranches = p.extraBranches
  if (p.activityId != null) base.activityId = p.activityId
  if (p.extraModules != null) base.extraModules = [...p.extraModules].sort()
  return JSON.stringify(base)
}

/**
 * بصمة المفتاح للحرق/الإبطال — djb2 على جزء التوقيع (مطابق keyFingerprint):
 * 8 خانات hex صغيرة، وهي الصيغة الوحيدة التي تقبلها parseRevocationList بالعميل.
 */
export function keyFingerprint(key) {
  // ح1 (مراجعة ③): تطبيع البايتات المعيارية — مطابق لـkeyFingerprint في core/license.ts
  const raw = key.trim().split('.')[2] ?? key
  let sigPart = raw
  try { sigPart = b64uEncode(b64uDecode(raw)) } catch { /* ترميز تالف — التحقق سيفشل أصلاً */ }
  let h = 5381
  for (let i = 0; i < sigPart.length; i++) h = ((h << 5) + h + sigPart.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** استيراد المفتاح الخاص (pkcs8 b64u) للتوقيع — Ed25519 عبر WebCrypto (متاح في Workers وNode 18+) */
export async function importPrivateKey(privB64u) {
  return crypto.subtle.importKey('pkcs8', b64uDecode(privB64u), 'Ed25519', false, ['sign'])
}

/** إصدار مفتاح تفعيل موقّع: SHOPSYS1.<payload-b64u>.<sig-b64u> (مطابق encodeLicenseKey) */
export async function issueLicenseKey(payload, privB64u) {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return `${KEY_PREFIX}.${b64uEncode(msg)}.${b64uEncode(new Uint8Array(sig))}`
}

/* ═══ v1.0.7: مفتاح تغيير النشاط SHOPSYS2 — موافقة المالك ═══
 * مستنسخ حرفياً من license.ts (canonicalActivityChangePayload) — أي فرق يكسر التوقيع. */
export const ACTIVITY_KEY_PREFIX = 'SHOPSYS2'

export function canonicalActivityChangePayload(p) {
  return JSON.stringify({ v: p.v, deviceId: p.deviceId, fromActivityId: p.fromActivityId, toActivityId: p.toActivityId, issuedAt: p.issuedAt })
}

/** إصدار مفتاح تغيير نشاط موقّع: SHOPSYS2.<payload-b64u>.<sig-b64u> */
export async function issueActivityChangeKey(payload, privB64u) {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalActivityChangePayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return `${ACTIVITY_KEY_PREFIX}.${b64uEncode(msg)}.${b64uEncode(new Uint8Array(sig))}`
}

/** فك حمولة مفتاح (للعرض/البحث فقط — التحقق الكامل يجريه العميل بتوقيعه) */
export function decodeLicenseKey(key) {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) throw new Error('صيغة مفتاح التفعيل غير صحيحة')
  const payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])))
  if (payload.v !== 1 || !payload.deviceId || !payload.plan) throw new Error('محتوى المفتاح ناقص')
  return { payload, body: parts[1], sig: parts[2] }
}

/** تاريخ انتهاء ISO (YYYY-MM-DD) بعد عدد الأيام — null = مدى الحياة */
export function expiresAfterDays(days, todayIso = new Date().toISOString().slice(0, 10)) {
  if (days == null || days <= 0) return null
  const d = new Date(todayIso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
