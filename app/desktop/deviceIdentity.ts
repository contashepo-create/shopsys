/**
 * هوية الجهاز على سطح المكتب — مرساة خارج القاعدة (دالة خالصة).
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة (بند 2 من طلب المالك): معرّف الجهاز كان يعيش في مكانين فقط —
 * مرساة `localStorage` داخل واجهة Chromium، وداخل قاعدة البيانات نفسها. ومسح
 * القاعدة (أو فقد مرساة Chromium) كان يُنشئ معرّفاً جديداً ⇒ يخرج العميل من
 * لوحة المطوّر كـ«عميل جديد» ويُفقد الترخيص المرتبط بالجهاز.
 *
 * الحل: العملية الرئيسية تحفظ الهوية في `userData/device-identity.json` —
 * ملف **خارج** قاعدة البيانات (مثل مرساة التجربة) ⇒ survives مسح القاعدة
 * وفقد ملفات Chromium. والعملية الرئيسية هي **المرجع**: لا تُغيّر معرّفاً
 * ثبتّاً أبداً.
 *
 * القواعد (مطابقة لـ src/core/registration.ts وsrc/core/license.ts):
 *   • صيغة المعرّف: SHOP-XXXX-XXXX-XXXX (بلا أحرف ملتبسة).
 *   • المعرّف المحفوظ مفضّل دائماً على أي مرشّح وارد — لا تغيّر هوية جهاز.
 *   • إن لم يكن هناك محفوظ، يُعتمد المرشّح الوارد من الواجهة (localStorage)
 *     إن كان صالحاً ⇒ ترقية التطبيق لا تكسر الترخيص.
 *   • بداية التجربة: **الأقدم** بين المحفوظ والوارد (كما في trialAnchor.ts).
 *
 * منفصلة عن electron كي تُختبر (انظر deviceKeyStore.ts لنفس النمط).
 */

export interface DeviceIdentityValues {
  /** معرّف الجهاز SHOP-XXXX-XXXX-XXXX — أو null إن لم يُعرَّف بعد */
  deviceId: string | null
  /** أقدم بداية تجربة معروفة لهذا الجهاز (ISO) — أو null */
  firstTrialAt: string | null
}

/** الصيغة نفسها المستخدمة في src/core/registration.ts (DEVICE_RE) */
export const DEVICE_ID_PATTERN = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/** الأبجدية نفسها في src/core/license.ts (generateDeviceId) — بلا أحرف ملتبسة */
const DEVICE_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** تاريخ صالح: بادئة YYYY-MM-DD تُقرأ فعلاً (الوقت بعدها اختياري) */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10) return false
  const day = value.slice(0, 10)
  return ISO_DAY_RE.test(day) && Number.isFinite(Date.parse(day))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** تطبيع معرّف الجهاز: أحرف كبيرة + فحص الصيغة — أو null */
export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return DEVICE_ID_PATTERN.test(v) ? v : null
}

/** هل المعرّف صالح؟ */
export function isValidDeviceId(value: unknown): boolean {
  return normalizeDeviceId(value) !== null
}

/** توليد معرّف من بايتات عشوائية — نفس خوارزمية src/core/license.ts */
export function generateDeviceIdFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < 12; i++) s += DEVICE_ID_ALPHABET[bytes[i] % DEVICE_ID_ALPHABET.length]
  return `SHOP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** أقدم تاريخ صالح بين المرشحين (أو null) */
function pickOldestIso(candidates: unknown[]): string | null {
  let best: string | null = null
  for (const c of candidates) {
    if (!isIsoDay(c)) continue
    if (best === null) { best = c; continue }
    if (c.slice(0, 10) < best.slice(0, 10)) best = c
  }
  return best
}

/**
 * يدمج المحفوظ مع المرشّح الوارد من الواجهة.
 * المحفوظ هو المرجع: معرّف ثابت لا يتغيّر أبداً (حتى لو وصل مرشّح مختلف).
 * `changed` يخبر المستدعي هل يلزم الكتابة على القرص.
 */
export function mergeDeviceIdentity(
  saved: unknown,
  incoming: unknown,
): { identity: DeviceIdentityValues; changed: boolean } {
  const s = asRecord(saved)
  const i = asRecord(incoming)
  const savedId = normalizeDeviceId(s.deviceId)
  const incomingId = normalizeDeviceId(i.deviceId)
  const identity: DeviceIdentityValues = {
    /* المحفوظ أولاً: هوية الجهاز لا تُغيَّر — أبداً */
    deviceId: savedId ?? incomingId,
    firstTrialAt: pickOldestIso([s.firstTrialAt, i.firstTrialAt]),
  }
  const before: DeviceIdentityValues = {
    deviceId: savedId,
    firstTrialAt: pickOldestIso([s.firstTrialAt]),
  }
  return {
    identity,
    changed: identity.deviceId !== before.deviceId || identity.firstTrialAt !== before.firstTrialAt,
  }
}
