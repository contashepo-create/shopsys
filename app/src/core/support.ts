/**
 * الدعم الفني — محادثة العميل ↔ المطوّر (طلب المالك):
 * أي مستخدم يبلغ عن مشكلة من داخل التطبيق فتصل للمطوّر على بوت التليجرام
 * بكل بيانات الجهاز، والمطوّر يرد من البوت فيظهر رده داخل التطبيق كمحادثة.
 *
 * القناة: Cloudflare Worker وسيط (نفس ووركر التحكم):
 *   POST /support/:deviceId          → العميل يرسل رسالة (الووركر يعيد توجيهها لتليجرام المطوّر)
 *   GET  /support/:deviceId          → العميل يجلب المحادثة كاملة (رسائله وردود المطوّر)
 *   POST /tg-webhook                 → تليجرام يستدعيها عند رد المطوّر (Reply على رسالة العميل)
 *
 * الحماية (طلب المالك — ضد الحقن والرفع):
 * - نصوص فقط: لا ملفات ولا وسائط إطلاقاً — الووركر يرفض أي شيء غير JSON نصي.
 * - كل نص يُعقَّم بـsanitizeText (لا وسوم ولا محارف تحكم) وبحد طول صارم.
 * - سجل التطبيق يُرفق فقط بموافقة صريحة (checkbox) ويُعلَم المستخدم بغرضه.
 */
import { sanitizeText, isValidDeviceId } from './audit.ts'

export interface SupportMessage {
  id: number
  from: 'client' | 'developer'
  text: string
  at: string // ISO
}

export const SUPPORT_TEXT_MAX = 1500
/** إصدار بروتوكول الدعم الموقّع: يمنع إعادة تشغيل طلب صالح خارج نافذته الزمنية. */
export const SUPPORT_PROTOCOL = '2'
/** فترة تحديث المحادثة داخل التطبيق */
export const SUPPORT_POLL_MS = 30_000

/** حمولة رسالة العميل للووركر — نصوص معقمة فقط */
export interface ClientSupportPayload {
  text: string
  customer: string // اسم المحل/العميل
  activity: string
  appVersion: string
  /** سجل التطبيق — يُرسل فقط بموافقة صريحة من المستخدم */
  log?: string
}

/** تجهيز حمولة الإرسال — يرمي أخطاء عربية عند مدخلات غير صالحة */
export function buildSupportPayload(input: {
  text: string
  customer: string
  activity: string
  appVersion: string
  attachLog: boolean
  logText: string
}): ClientSupportPayload {
  const text = sanitizeText(input.text, SUPPORT_TEXT_MAX)
  if (text.length < 3) throw new Error('اكتب رسالتك أولاً (3 أحرف على الأقل)')
  return {
    text,
    customer: sanitizeText(input.customer, 80) || 'غير مسمى',
    activity: sanitizeText(input.activity, 40),
    appVersion: sanitizeText(input.appVersion, 20),
    // اللوج يُقص لحد آمن — والووركر يقصه أيضاً (دفاع مزدوج)
    ...(input.attachLog && input.logText ? { log: input.logText.slice(-60_000) } : {}),
  }
}

/** تنقية محادثة واردة من الووركر — لا نثق بالشكل الخارجي أبداً */
export function parseConversation(raw: unknown): SupportMessage[] {
  if (!Array.isArray(raw)) return []
  const out: SupportMessage[] = []
  for (const m of raw) {
    if (m == null || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    const from = o.from === 'developer' ? 'developer' : o.from === 'client' ? 'client' : null
    const text = sanitizeText(o.text, SUPPORT_TEXT_MAX)
    if (!from || !text) continue
    out.push({
      id: typeof o.id === 'number' ? o.id : out.length + 1,
      from,
      text,
      at: typeof o.at === 'string' ? o.at.slice(0, 24) : '',
    })
  }
  return out.slice(-200) // آخر 200 رسالة تكفي للعرض
}

export function supportUrl(baseUrl: string, deviceId: string): string {
  if (!isValidDeviceId(deviceId)) throw new Error('معرف جهاز غير صالح')
  return `${baseUrl.replace(/\/$/, '')}/support/${deviceId}`
}

/* ─── الجالبات (متسامحة مع الفشل — أوفلاين لا يكسر شيئاً) ─── */

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function nonce(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(18)))
}

/** توقيع HMAC للطلب نفسه؛ التوكن لا يرسل وحده كاعتماد قابل لإعادة التشغيل. */
async function requestSignature(token: string, method: string, path: string, timestamp: string, requestNonce: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestNonce}\n${body}`
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))))
}

async function supportHeaders(token: string, method: string, url: string, body = '', json = false): Promise<Record<string, string>> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('اعتماد قناة الدعم غير صالح')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestNonce = nonce()
  const path = new URL(url).pathname
  return {
    Authorization: `Support ${token}`,
    'X-Support-Protocol': SUPPORT_PROTOCOL,
    'X-Support-Timestamp': timestamp,
    'X-Support-Nonce': requestNonce,
    'X-Support-Signature': await requestSignature(token, method, path, timestamp, requestNonce, body),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

/* ─── ناقل الطلب (بند 5: طلب المالك) ───────────────────────────────────────
   كان الطلب يذهب من الواجهة مباشرة ⇒ في نسخة سطح المكتب (file://) يُرسل
   المتصفح Origin: null ⇒ يرفضه العامل (403 ⇒ «تعذر الإرسال» بلا سبب)،
   وكان أي فشل يُعرض للمستخدم كـ«لا يوجد اتصال بالإنترنت» حتى لو كان الخادم
   قد ردّ 401/429.
   الحل: في سطح Desktop يمرّ الطلب من **العملية الرئيسية** (طلب بلا Origin
   ⇒ لا политиة مصدر متصفح)؛ ويبقى الاعتماد (HMAC + TOFU) هو الحماية الحقيقية.
   والواجهة تستلم الآن **السبب الحقيقي** بدل رسالة عامة كاذبة. */
export interface SupportHttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

export interface SupportHttpResponse {
  ok: boolean
  status: number
  body: string
  /** رسالة خطأ من العملية الرئيسية (فشل شبكة/مضيف غير مسموح) */
  error?: string
}

/** نتيجة الإرسال — سبب مفهوم للمستخدم + هل المشكلة انقطاع شبكة */
export interface SupportSendResult {
  ok: boolean
  status: number
  /** سبب جاهز للعرض (عربي) */
  reason: string
  /** تعذّر الوصول إلى الخادم أصلاً (شبكة) — لا خادم رافض */
  offline: boolean
}

/** جسر سطح المكتب (إن وُجد) — من src/data/desktopBridge.ts */
function desktopSupportBridge(): {
  request(args: SupportHttpRequest): Promise<SupportHttpResponse>
  getToken(): Promise<string | null>
  setToken(token: string): Promise<boolean>
} | null {
  if (typeof window === 'undefined') return null
  const bridge = window.shopsysSupport
  return bridge && typeof bridge.request === 'function' ? bridge : null
}

/** ترجمة رمز الخادم إلى سبب يفهمه العميل (لا «لا يوجد اتصال» كاذبة) */
export function supportFailureReason(status: number, detail = ''): string {
  if (status === 401) return 'رفض الخادم اعتماد قناة الدعم لهذا الجهاز — اطلب من المطوّر إعادة ربط القناة'
  if (status === 403) return 'رفض الخادم الطلب — حدّث البرنامج ثم أعد المحاولة'
  if (status === 404) return 'هذا الجهاز غير مسجَّل لدى خادم الدعم'
  if (status === 413) return 'اللوج المرفق أكبر من المسموح — أرسل الرسالة بلا لوج'
  if (status === 429) return 'تجاوزت حدّ الرسائل في هذه الساعة — انتظر قليلاً ثم أعد المحاولة'
  if (status >= 500) return 'خطأ في خادم الدعم — حاول بعد قليل'
  if (status >= 400) return `طلب غير مقبول من الخادم${detail ? ` (${detail})` : ''}`
  return 'تعذّر الوصول إلى خادم الدعم — تحقّق من اتصال الإنترنت'
}

/** تنفيذ الطلب: من العملية الرئيسية على سطح المكتب، أو من المتصفح على الويب */
async function requestSupport(
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<SupportHttpResponse> {
  const bridge = desktopSupportBridge()
  if (bridge) {
    try {
      return await bridge.request({ url, method, headers, body })
    } catch (error) {
      return { ok: false, status: 0, body: '', error: (error as Error).message }
    }
  }
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, status: res.status, body: await res.text() }
  } catch (error) {
    return { ok: false, status: 0, body: '', error: (error as Error).message }
  }
}

export async function fetchConversation(baseUrl: string, deviceId: string, token: string): Promise<SupportMessage[] | null> {
  try {
    const url = supportUrl(baseUrl, deviceId)
    const headers = await supportHeaders(token, 'GET', url)
    const res = await requestSupport(url, 'GET', headers, undefined, 10_000)
    if (!res.ok) return null
    return parseConversation(JSON.parse(res.body) as unknown)
  } catch { return null }
}

/**
 * إرسال رسالة دعم — يعيد **السبب الحقيقي** عند الفشل (لا «لا يوجد اتصال»).
 */
export async function sendSupportMessage(
  baseUrl: string,
  deviceId: string,
  token: string,
  payload: ClientSupportPayload,
): Promise<SupportSendResult> {
  try {
    const url = supportUrl(baseUrl, deviceId)
    const body = JSON.stringify(payload)
    const headers = await supportHeaders(token, 'POST', url, body, true)
    const res = await requestSupport(url, 'POST', headers, body, 15_000)
    if (res.ok) return { ok: true, status: res.status, reason: 'وصلت رسالتك للمطوّر', offline: false }
    /* سبب من جسم الاستجابة إن وُجد (رسالة العامل) — يُقصّ ويُنقّى */
    let detail = ''
    try {
      const parsed = JSON.parse(res.body) as { error?: unknown }
      if (typeof parsed?.error === 'string') detail = parsed.error.slice(0, 80)
    } catch { /* جسم غير JSON — نكتفي بالرمز */ }
    return { ok: false, status: res.status, reason: supportFailureReason(res.status, detail), offline: res.status === 0 }
  } catch (error) {
    const message = (error as Error).message
    return {
      ok: false,
      status: 0,
      reason: message.includes('اعتماد قناة الدعم')
        ? 'اعتماد قناة الدعم غير صالح على هذا الجهاز'
        : `تعذّر إرسال الرسالة: ${message.slice(0, 120)}`,
      offline: true,
    }
  }
}
