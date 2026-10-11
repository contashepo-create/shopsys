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
 *
 * v1.0.23 (بلاغ عميل 2026-10-11): فصل «لا اتصال» عن «خدمة التفعيل لم تُجب بعقد التفعيل».
 * العامل المنشور قبل إضافة `/activate` كان يرد على POST /activate بـ200 ونص
 * «shopsys-control»، فلا يطابق العقد ويسقط الفحص إلى فرع offline ⇒ يقرأ العميل
 * «تحقق من الاتصال» وهو متصل أصلاً. الآن: لا رد إطلاقاً = offline، وردٌّ من
 * الخادم بلا عقد التفعيل = unavailable برسالة تصف الخدمة نفسها (والسبب الغالب
 * نسيان نشر العامل — انظر AGENTS.md «نشر devbot مطلوب قبل الإصدار»).
 */
import { LICENSE_CLOUD_BASE_URL } from './cloud.ts'
import { acceptActivationKey, type LicensePayload } from './license.ts'

export const ACTIVATE_PATH = '/activate'
export const ACTIVATE_TIMEOUT_MS = 12_000

export type OnlineActivationResult =
  | { kind: 'accepted'; plan: string; expiresAt: string | null }
  | { kind: 'rejected'; code: string; reasonAr: string }
  /** لم يصل أي رد من الخادم: الشبكة مقطوعة أو المهلة انتهت */
  | { kind: 'offline' }
  /**
   * وصل رد فعلاً لكنه ليس عقد التفعيل: عامل قديم بلا `/activate`، أو صفحة
   * HTML/بوابة وسيطة، أو 5xx، أو 4xx بلا `reason`. ليست «لا إنترنت».
   */
  | { kind: 'unavailable'; status: number | null }

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
      cache: 'no-store',
    })
  } catch {
    return { kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }

  /* الجسم يُقرأ نصاً ثم يُفسَّر: عامل قديم/بوابة وسيطة قد ترد HTML أو نصاً صريحاً،
     و`res.json()` عليها يرمي فيسقط الفحص إلى «أوفلاين» كذباً. */
  const raw = await res.text().catch(() => '')
  let body: unknown = null
  try { body = raw ? JSON.parse(raw) : null } catch { body = null }
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
  // 5xx، أو 4xx بلا سبب مفهوم، أو 2xx بجسم ليس عقد التفعيل: الخادم أجاب — فلا نقول «لا إنترنت»
  return { kind: 'unavailable', status: res.status }
}

export const OFFLINE_ACTIVATION_AR =
  'التفعيل يتطلب اتصالاً بالإنترنت لمراجعة المفتاح لدى المطوّر — تحقق من الاتصال ثم أعد المحاولة. بعد التفعيل لن تحتاج الإنترنت للعمل اليومي.'

/**
 * رسالة الحالة «وصلنا للخادم ولم يُجب بعقد التفعيل» — منفصلة عن رسالة انقطاع
 * الاتصال كي لا يُطلب من عميل متصل أصلاً أن يفحص اتصاله (بلاغ 2026-10-11).
 * الرمز يُذكر صراحة ليسهل التشخيص من طرف الدعم.
 */
export function activationUnavailableAr(status: number | null): string {
  const code = status == null ? '' : ` (رمز ${status})`
  /* الرسالة تُعرض لعميل المحل: تنفي مسؤولية اتصاله وجهازه صراحةً (لا تشخيص داخلي
     يربكه)، ورمز HTTP داخلها هو ما يلزم المطوّر للتشخيص. */
  return `خدمة التفعيل ردّت بجواب غير صحيح${code} — الإنترنت عندك سليم، والعطل في خدمة التفعيل لا في جهازك. أعد المحاولة بعد قليل، وإن استمرّت أرسل هذه الرسالة للمطوّر كما هي.`
}

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
  if (online.kind === 'unavailable') throw new Error(activationUnavailableAr(online.status))
  if (online.kind === 'rejected') throw new Error(online.reasonAr)
  return payload
}
