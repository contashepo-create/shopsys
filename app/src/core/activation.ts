/**
 * التفعيل عبر الإنترنت (v1.0.22) — لا يُحفظ مفتاح قبل تأكيد مركز الترخيص.
 *
 * الترتيب:
 *   1) الفحوص المحلية (الإبطال المحلي، التوقيع Ed25519، مطابقة النشاط) — بلا شبكة
 *   2) تأكيد الخادم: مُصدَر من المطوّر، غير مُبطل، لجهاز نفسه، غير منتهٍ
 *   3) فقط بعد الاثنين يُحفظ المفتاح (setActivated من الواجهة)
 *
 * إن تعذّر الوصول للخادم ⇒ التفعيل يفشل برسالة واضحة (لا تفعيل بلا اتصال).
 * أما بعد التفعيل فلا يحتاج التطبيق اتصالاً إلا للتحديثات والميزات الإضافية والدعم.
 */
import { LICENSE_CLOUD_BASE_URL } from './cloud.ts'
import { acceptActivationKey, type LicensePayload } from './license.ts'

export const ACTIVATE_PATH = '/activate'
export const ACTIVATE_TIMEOUT_MS = 12_000

export type OnlineActivationResult =
  | { kind: 'accepted'; plan: string; expiresAt: string | null }
  | { kind: 'rejected'; code: string; reasonAr: string }
  | { kind: 'offline' }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function checkActivationOnline(args: {
  deviceId: string
  key: string
  baseUrl?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<OnlineActivationResult> {
  const base = (args.baseUrl ?? LICENSE_CLOUD_BASE_URL).replace(/\/$/, '')
  const doFetch: FetchLike = args.fetchImpl ?? ((input, init) => fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? ACTIVATE_TIMEOUT_MS)
  let res: Response
  try {
    res = await doFetch(`${base}${ACTIVATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: args.deviceId, key: args.key.trim() }),
      signal: controller.signal,
    })
  } catch {
    return { kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }

  let body: unknown = null
  try { body = await res.json() } catch { body = null }
  const o = (body && typeof body === 'object') ? body as Record<string, unknown> : {}

  if (res.status === 200 && o.ok === true) {
    return {
      kind: 'accepted',
      plan: typeof o.plan === 'string' ? o.plan : '',
      expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : null,
    }
  }
  if (res.status >= 400 && res.status < 500 && typeof o.reason === 'string') {
    return { kind: 'rejected', code: typeof o.code === 'string' ? o.code : 'rejected', reasonAr: o.reason }
  }
  // 5xx أو استجابة غير مفهومة: الخادم غير متاح الآن — لا نحكم بالرفض
  return { kind: 'offline' }
}

export const OFFLINE_ACTIVATION_AR =
  'التفعيل يتطلب اتصالاً بالإنترنت لمراجعة المفتاح لدى المطوّر — تحقق من الاتصال ثم أعد المحاولة. بعد التفعيل لن تحتاج الإنترنت للعمل اليومي.'

/**
 * نقطة التفعيل الوحيدة لشاشتي القفل و«الترخيص»: فحوص محلية ثم تأكيد الخادم.
 * تُرمى الأخطاء برسائل عربية تُعرض مباشرة في الواجهة.
 */
export async function activateOnline(args: {
  key: string
  deviceId: string
  revokedKeys: readonly string[]
  activityId: string | null
  activityKeyHistory?: readonly string[]
  baseUrl?: string
  fetchImpl?: FetchLike
  /** اختياري للاختبار فقط */
  pubB64u?: string
}): Promise<LicensePayload> {
  const key = args.key.trim()
  const payload = await acceptActivationKey({
    key, deviceId: args.deviceId, revokedKeys: args.revokedKeys,
    activityId: args.activityId, activityKeyHistory: args.activityKeyHistory, pubB64u: args.pubB64u,
  })
  const online = await checkActivationOnline({
    deviceId: args.deviceId, key, baseUrl: args.baseUrl, fetchImpl: args.fetchImpl,
  })
  if (online.kind === 'offline') throw new Error(OFFLINE_ACTIVATION_AR)
  if (online.kind === 'rejected') throw new Error(online.reasonAr)
  return payload
}
