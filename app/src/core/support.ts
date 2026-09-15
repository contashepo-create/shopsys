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

export async function fetchConversation(baseUrl: string, deviceId: string): Promise<SupportMessage[] | null> {
  try {
    const res = await fetch(supportUrl(baseUrl, deviceId), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return parseConversation(await res.json())
  } catch { return null }
}

export async function sendSupportMessage(baseUrl: string, deviceId: string, payload: ClientSupportPayload): Promise<boolean> {
  try {
    const res = await fetch(supportUrl(baseUrl, deviceId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch { return false }
}
