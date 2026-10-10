/**
 * التفعيل عبر الإنترنت (v1.0.22) — نقطة POST /activate.
 *
 * القاعدة: التفعيل لا يتم إلا بعد تأكيد الخادم أن المفتاح:
 *   1) مُصدَر من المطوّر (السجل lic:<بصمة المفتاح> موجود وتطابقت قيمته حرفياً)،
 *   2) غير مُبطَل (علم revoked في السجل، أو بصمته ضمن قائمة revoked)،
 *   3) مربوط بالجهاز نفسه (payload.deviceId = معرّف الجهاز)،
 *   4) غير منتهٍ (expiresAt لم يمرّ — YYYY-MM-DD، والتاريخ بتوقيت UTC).
 *
 * التحقق المحلي بالتوقيع Ed25519 يبقى قائماً في التطبيق؛ هذه النقطة تضيف ما لا
 * يستطيع الجهاز وحده معرفته: الإبطال والانتهاء بعد الإصدار.
 * لا تُعاد بيانات العميل (اسم/هاتف) — فقط الخطة وتاريخ الانتهاء.
 */
import { keyFingerprint } from './licenseLib.js'

export const ACTIVATE_MAX_BYTES = 4_096
const DEVICE_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const KEY_RE = /^SHOPSYS1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function parseList(raw) {
  try {
    const value = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

/**
 * @returns {Promise<{status:number, body:object}>}
 */
export async function verifyActivation(cfg, rawText) {
  if (typeof rawText !== 'string' || rawText.length > ACTIVATE_MAX_BYTES) {
    return { status: 413, body: { ok: false, code: 'payload_too_large', reason: 'الطلب أكبر من الحد المسموح' } }
  }
  let body
  try { body = JSON.parse(rawText) } catch {
    return { status: 400, body: { ok: false, code: 'bad_json', reason: 'طلب غير صالح' } }
  }
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!DEVICE_RE.test(deviceId)) {
    return { status: 400, body: { ok: false, code: 'bad_device', reason: 'معرّف الجهاز غير صالح' } }
  }
  if (!KEY_RE.test(key)) {
    return { status: 400, body: { ok: false, code: 'bad_key', reason: 'صيغة مفتاح التفعيل غير صحيحة' } }
  }

  const fingerprint = keyFingerprint(key)
  const raw = await cfg.kv.get(`lic:${fingerprint}`)
  let record = null
  try { record = raw ? JSON.parse(raw) : null } catch { record = null }
  if (!record || record.key !== key) {
    return { status: 404, body: { ok: false, code: 'unknown_key', reason: 'المفتاح غير مُصدَر من المطوّر — تحقق من نسخه كاملاً' } }
  }

  const revoked = parseList(await cfg.kv.get('revoked'))
  if (record.revoked === true || revoked.includes(fingerprint)) {
    return { status: 403, body: { ok: false, code: 'revoked', reason: 'تم إبطال هذا المفتاح — تواصل مع المطوّر' } }
  }

  const payload = record.payload ?? {}
  if (payload.deviceId !== deviceId) {
    return { status: 403, body: { ok: false, code: 'device_mismatch', reason: 'هذا المفتاح مُصدَر لجهاز آخر' } }
  }

  const today = new Date().toISOString().slice(0, 10)
  if (payload.expiresAt && String(payload.expiresAt) < today) {
    return { status: 403, body: { ok: false, code: 'expired', reason: 'انتهت صلاحية هذا المفتاح — تواصل مع المطوّر للتجديد' } }
  }

  return {
    status: 200,
    body: {
      ok: true,
      plan: payload.plan ?? '',
      expiresAt: payload.expiresAt ?? null,
    },
  }
}
