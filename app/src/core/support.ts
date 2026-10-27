/**
 * الدعم الفني — محادثة العميل ↔ المطوّر (طلب المالك):
 * أي مستخدم يبلغ عن مشكلة من داخل التطبيق فتصل للمطوّر على بوت التليجرام
 * بكل بيانات الجهاز، والمطوّر يرد من البوت فيظهر رده داخل التطبيق كمحادثة.
 *
 * القناة: Cloudflare Worker وسيط (نفس ووركر التحكم):
 *   POST /support/:deviceId          → العميل يرسل رسالة (الووركر يعيد توجيهها لتليجرام المطوّر)
 *   GET  /support/:deviceId          → العميل يجلب المحادثة كاملة (رسائله وردود المطوّر)
 *   POST /support-bridge             → لوحة المطوّر/بوت تليجرام (سرّ مشترك)
 *
 * الحماية (طلب المالك — ضد الحقن والرفع):
 * - نصوص فقط: لا ملفات ولا وسائط إطلاقاً — الووركر يرفض أي شيء غير JSON نصي.
 * - كل نص يُعقَّم بـsanitizeText (لا وسوم ولا محارف تحكم) وبحد طول صارم.
 * - سجل التطبيق يُرفق فقط بموافقة صريحة (checkbox) ويُعلَم المستخدم بغرضه.
 *
 * ─── بلاغ المالك 2026-10-27: «إرسال رسالة للدعم يقول لازم اتصال بالإنترنت
 *     رغم أن الإنترنت موجود». سببان حقيقيان عولجا في هذه الوحدة:
 *   (أ) قناة الدعم كانت مربوطة حصراً بنطاق عامل قديم
 *       `shopsys-control.contashepo.workers.dev` لم يعد منشوراً/قابلاً للحل،
 *       بينما العامل الحيّ هو `shopsys-control.mobileshop2026.workers.dev`
 *       (صفحة «حول» والترخيص تعمل منه). لذلك كان كل إرسال يفشل في طبقة
 *       النقل (status 0) قبل أن يصل لأي خادم.
 *   (ب) أي فشل نقل كان يُترجم حرفياً إلى «تحقّق من اتصال الإنترنت» — تشخيص
 *       كاذب يخفي السبب (خادم ميت، DNS، شهادة، بروكسي، مضيف غير مسموح…).
 *   الحل: عنوان حيّ + بديل تلقائي للعامل القديم، ومسبار اتصال حقيقي قبل اتهام
 *   اتصال المستخدم، ومحاولة ثانية عبر شبكة Chromium في المُصيّر إن فشل طلب
 *   العملية الرئيسية، وسبب عربي صادق يحمل رمز الخطأ التقني.
 */
import { sanitizeText, isValidDeviceId } from './audit.ts'
import { LICENSE_CLOUD_BASE_URL, APP_SERVICES_CLOUD_BASE_URL, SUPPORT_CLOUD_FALLBACK_URLS, SUPPORT_PROBE_URLS } from './cloud.ts'

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

/**
 * قائمة المضيفين التي تُجرَّب بالترتيب: الأساسي (عامل التحكم الحيّ) ثم البديل
 * (عامل الخدمات القديم للتوافق مع المنشآت التي ما زالت تنشره). لا تكرار.
 * `baseUrl` يبقى الوسيط الأول ليحتفظ الاختبار/الاستدعاء القديم بسلوکه.
 */
export function supportBaseCandidates(baseUrl: string): string[] {
  const all = [baseUrl, ...SUPPORT_CLOUD_FALLBACK_URLS, LICENSE_CLOUD_BASE_URL, APP_SERVICES_CLOUD_BASE_URL]
  return all
    .map((url) => url.replace(/\/$/, ''))
    .filter((url, index, list) => Boolean(url) && list.indexOf(url) === index)
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

/* ─── ناقل الطلب ────────────────────────────────────────────────────────────
   في سطح Desktop يمرّ الطلب من **العملية الرئيسية** (بلا Origin ⇒ لا سياسة
   مصدر متصفح)؛ ويبقى الاعتماد (HMAC + TOFU) هو الحماية الحقيقية.
   الآن: لو فشل نقل العملية الرئيسية (Node fetch لا يمرّ ببروكسي النظام ولا
   يثق بشهاداته دائماً)، نُعيد المحاولة عبر `fetch` في المُصيّر (شبكة Chromium)
   قبل أن نُعلن الفشل — فالإنترنت قد يكون سليماً تماماً عند المستخدم.
   والواجهة تستلم **السبب الحقيقي** بدل رسالة عامة كاذبة. */
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
  /** رمز سبب تقني من العملية الرئيسية (network | timeout | host-not-allowed …) */
  errorCode?: string
}

/** نتيجة الإرسال — سبب مفهوم للمستخدم + هل المشكلة انقطاع شبكة */
export interface SupportSendResult {
  ok: boolean
  status: number
  /** سبب جاهز للعرض (عربي) */
  reason: string
  /** تعذّر الوصول إلى أي خادم ⇒ لا إثبات أن اتصال العميل مقطوع */
  offline: boolean
  /** تفصيل تقني مختصر (رسالة النقل/الرمز) للتشخيص واللوج */
  detail?: string
  /** عدد المضيفين/النواقل التي جُرّبت */
  attempts: number
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
  if (status === 404) return 'مسار خدمة الدعم غير منشور على الخادم (404) — حدّث البرنامج أو اطلب من المطوّر نشر عامل التحكم'
  if (status === 413) return 'اللوج المرفق أكبر من المسموح — أرسل الرسالة بلا لوج'
  if (status === 429) return 'تجاوزت حدّ الرسائل في هذه الساعة — انتظر قليلاً ثم أعد المحاولة'
  if (status >= 500) return 'خطأ في خادم الدعم — حاول بعد قليل'
  if (status >= 400) return `طلب غير مقبول من الخادم${detail ? ` (${detail})` : ''}`
  return 'تعذّر الوصول إلى خادم الدعم — تحقّق من اتصال الإنترنت'
}

/**
 * مسبار الاتصال الحقيقي: هل يصل هذا الجهاز إلى **أي** خدمة سحابية يعتمد عليها
 * التطبيق؟ يُستدعى فقط حين يفشل طلب الدعم في طبقة النقل (status 0). نجاح المسبار
 * يعني أن الإنترنت سليم ⇒ لا يجوز اتهام اتصال المستخدم (بلاغ المالك).
 */
export async function probeSupportConnectivity(timeoutMs = 5000): Promise<boolean> {
  if (typeof fetch !== 'function') return false
  for (const url of SUPPORT_PROBE_URLS) {
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return true
    } catch { /* المسبار التالي */ }
  }
  return false
}

/**
 * سبب صادق لفشل النقل: يفرّق بين «الإنترنت سليم وخدمة الدعم لا تستجيب»
 * و«لا يمكن الوصول لأي خادم». لا يُعرض «تحقّق من اتصال الإنترنت» إلا حين
 * يفشل مسبار الاتصال فعلاً. التفصيل التقني يُقصّ ويُنقّى قبل العرض.
 */
export function supportTransportReason(input: {
  online: boolean
  detail?: string
  errorCode?: string
  attempts: number
}): string {
  const cleanDetail = sanitizeText(input.detail ?? '', 90)
  const code = input.errorCode ? sanitizeText(input.errorCode, 24) : ''
  const technical = [code, cleanDetail].filter(Boolean).join(' — ')
  const suffix = technical ? ` (${technical})` : ''
  const tried = input.attempts > 1 ? ` — جُرّب ${input.attempts} عنواناً للخدمة` : ''
  if (input.online) {
    return `الإنترنت عندك سليم ✓ لكن خادم الدعم لم يستجب — العطل في عنوان الخدمة أو الخادم نفسه لا في جهازك${tried}${suffix}. أعد المحاولة بعد قليل، وإن استمرّت أرسل هذه الرسالة للمطوّر.`
  }
  return `تعذّر الوصول إلى خدمات التحكّم السحابية — تحقّق من اتصال الإنترنت أو من جدار الحماية/البروكسي الذي قد يحجب نطاق workers.dev${tried}${suffix}.`
}

/** طلب عبر شبكة المتصفح/المُصيّر (Chromium) — يحترم بروكسي النظام وشهاداته */
async function rendererFetch(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body: string | undefined, timeoutMs: number): Promise<SupportHttpResponse> {
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, status: res.status, body: await res.text() }
  } catch (error) {
    const failure = error as Error
    return { ok: false, status: 0, body: '', error: failure.message, errorCode: failure.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}

/**
 * تنفيذ الطلب: من العملية الرئيسية على سطح المكتب، أو من المتصفح على الويب.
 * كل محاولة نقل تُوقَّع من جديد (nonce/وقت جديدان): لو كان الطلب الأول قد وصل
 * الخادم واستهلك الـnonce ثم ضاع رده، فإن إعادة التوقيع تمنع رفض المحاولة
 * الثانية كـ«إعادة تشغيل» — وهو ما كان سيُظهر للمستخدم «أعد ربط القناة» كذباً.
 */
async function requestSupport(
  url: string,
  method: 'GET' | 'POST',
  token: string,
  body: string | undefined,
  timeoutMs: number,
  json: boolean,
): Promise<SupportHttpResponse> {
  const bridge = desktopSupportBridge()
  if (bridge) {
    let primary: SupportHttpResponse | null = null
    try {
      const headers = await supportHeaders(token, method, url, body, json)
      primary = await bridge.request({ url, method, headers, body })
      if (primary.ok || primary.status !== 0) return primary
    } catch (error) {
      primary = { ok: false, status: 0, body: '', error: (error as Error).message, errorCode: 'bridge' }
    }
    /* فشل نقل العملية الرئيسية ⇒ محاولة أخيرة عبر شبكة Chromium في المُصيّر.
       نجاحها يعني أن المشكلة كانت في ناقل واحد لا في اتصال المستخدم. */
    const retryHeaders = await supportHeaders(token, method, url, body, json)
    const fallback = await rendererFetch(url, method, retryHeaders, body, timeoutMs)
    if (fallback.ok || fallback.status !== 0) return fallback
    return {
      ...primary,
      error: [primary?.error, fallback.error].filter(Boolean).join(' | ').slice(0, 180),
      errorCode: primary?.errorCode ?? fallback.errorCode,
    }
  }
  const headers = await supportHeaders(token, method, url, body, json)
  return rendererFetch(url, method, headers, body, timeoutMs)
}

export async function fetchConversation(baseUrl: string, deviceId: string, token: string): Promise<SupportMessage[] | null> {
  try {
    for (const base of supportBaseCandidates(baseUrl)) {
      const url = supportUrl(base, deviceId)
      const res = await requestSupport(url, 'GET', token, undefined, 10_000, false)
      if (!res.ok) continue
      return parseConversation(JSON.parse(res.body) as unknown)
    }
    return null
  } catch { return null }
}

/**
 * إرسال رسالة دعم — يعيد **السبب الحقيقي** عند الفشل (لا «لا يوجد اتصال»).
 * يجرّب المضيف الحيّ ثم البديل عند انقطاع النقل أو 404 (عامل قديم بلا المسار).
 * ردّ صريح من خادم (401/403/429/5xx…) لا يُعاد إرساله على مضيف آخر.
 */
export async function sendSupportMessage(
  baseUrl: string,
  deviceId: string,
  token: string,
  payload: ClientSupportPayload,
): Promise<SupportSendResult> {
  let attempts = 0
  try {
    const body = JSON.stringify(payload)
    const urls = supportBaseCandidates(baseUrl).map((base) => supportUrl(base, deviceId))
    let last: SupportHttpResponse = { ok: false, status: 0, body: '' }
    /* ردّ صريح من خادم (مثل 404 «المسار غير منشور») أدقّ من فشل نقل لاحق
       على مضيف بديل ميت — لا يُستبدل به فيسبق تشخيصاً عاماً «الخادم لم يستجب». */
    let serverFailure: SupportHttpResponse | null = null
    for (const url of urls) {
      attempts += 1
      const res = await requestSupport(url, 'POST', token, body, 15_000, true)
      if (res.ok) return { ok: true, status: res.status, reason: 'وصلت رسالتك للمطوّر', offline: false, attempts }
      last = res
      if (res.status !== 0) serverFailure = res
      /* status 0 = لم يصل أي رد؛ 404 = العامل لا يخدم /support (غير منشور) */
      if (res.status !== 0 && res.status !== 404) break
    }
    const decisive = last.status !== 0 ? last : serverFailure
    let detail = ''
    try {
      const parsed = JSON.parse((decisive ?? last).body) as { error?: unknown }
      if (typeof parsed?.error === 'string') detail = parsed.error.slice(0, 80)
    } catch { /* جسم غير JSON — نكتفي بالرمز */ }
    if (decisive && decisive.status !== 0) {
      return {
        ok: false, status: decisive.status, reason: supportFailureReason(decisive.status, detail),
        offline: false, detail: detail || decisive.error, attempts,
      }
    }
    /* فشل نقل: لا نقول «لا يوجد إنترنت» قبل أن نختبر الاتصال فعلياً */
    const online = await probeSupportConnectivity()
    const technical = [last.errorCode, last.error, detail].filter(Boolean).join(' — ')
    return {
      ok: false,
      status: 0,
      reason: supportTransportReason({ online, detail: technical, errorCode: last.errorCode, attempts }),
      offline: !online,
      detail: technical || undefined,
      attempts,
    }
  } catch (error) {
    const message = (error as Error).message
    const invalidCredential = message.includes('اعتماد قناة الدعم')
    return {
      ok: false,
      status: 0,
      reason: invalidCredential
        ? 'اعتماد قناة الدعم غير صالح على هذا الجهاز'
        : `تعذّر إرسال الرسالة: ${message.slice(0, 120)}`,
      offline: false,
      detail: message.slice(0, 120),
      attempts,
    }
  }
}
