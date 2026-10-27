/**
 * قناة الدعم داخل **عامل التحكم الحيّ** (tools/devbot) — بلاغ المالك 2026-10-27.
 * ─────────────────────────────────────────────────────────────────────────────
 * المشكلة: العميل كان يرسل `/support/:deviceId` إلى نطاق عامل قديم غير منشور
 * (`shopsys-control.contashepo.workers.dev`)، بينما العامل الذي يعمل فعلاً —
 * والذي يملك ويبهوك بوت المطوّر الوحيد — هو هذا العامل
 * (`shopsys-control.mobileshop2026.workers.dev`). فكانت الرسالة تموت في طبقة
 * النقل ويُقال للمستخدم «تحقّق من اتصال الإنترنت» وهو متصل.
 *
 * الحل: نفس بروتوكول HMAC v2 + TOFU + nonce + تحديد المعدل الموجود في
 * `cloud/worker.js`، لكن **داخل هذا العامل وKV واحد** (`SHOPSYS_CONTROL`):
 *   GET  /support/:deviceId  → المحادثة كاملة (موقّع)
 *   POST /support/:deviceId  → رسالة العميل + إشعار المطوّر عبر تليجرام
 *   ردّ المطوّر (Reply أو /رد أو زر اللوحة) → يُكتب في نفس المحادثة محلياً
 *   (runLocalSupportAction) بلا جسر شبكة إلى عامل ثانٍ.
 *
 * العامل القديم/cloud يبقى كما هو للتوافق مع النسخ القديمة من التطبيق.
 * لا أسرار جديدة: يستخدم TELEGRAM_BOT_TOKEN و TELEGRAM_ADMIN_ID المضبوطين
 * أصلاً في هذا العامل، وKV التراخيص نفسه.
 */
export const SUPPORT_CLIENT_PATH = /^\/support\/([A-Za-z0-9_-]{6,64})$/

const SUPPORT_PROTOCOL = '2'
const DEVICE_RE = /^[A-Za-z0-9_-]{6,64}$/
const SUPPORT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/ // 32 bytes base64url
const TEXT_MAX = 1500
const LOG_MAX = 60_000
const CHAT_KEEP = 200
const CHAT_META_VERSION = 1
const CHAT_INBOX_MAX_READS = 30
const RATE_LIMIT = 10 // رسالة/ساعة/جهاز
const MAX_BODY_BYTES = 200_000

/* ─── أدوات ─────────────────────────────────────────────────────────────── */

function clean(value, max = TEXT_MAX) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function hexToBytes(value) {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function tokenHash(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
}

async function verifySignature(token, request, body) {
  const timestamp = request.headers.get('x-support-timestamp') ?? ''
  const requestNonce = request.headers.get('x-support-nonce') ?? ''
  const signature = request.headers.get('x-support-signature') ?? ''
  const timestampNumber = Number(timestamp)
  if (!/^\d{10}$/.test(timestamp) || !Number.isInteger(timestampNumber)) return null
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > 300) return null
  if (!/^[A-Za-z0-9_-]{24}$/.test(requestNonce) || !/^[0-9a-f]{64}$/i.test(signature)) return null
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const canonical = `${request.method.toUpperCase()}\n${new URL(request.url).pathname}\n${timestamp}\n${requestNonce}\n${body}`
  const valid = await crypto.subtle.verify('HMAC', key, hexToBytes(signature), new TextEncoder().encode(canonical))
  return valid ? { requestNonce } : null
}

/**
 * توثيق HMAC v2 + TOFU: أول اعتماد صحيح يُربط بالجهاز (تُخزن بصمته فقط)،
 * والـnonce يُمنع إعادة استخدامه 10 دقائق. مماثل حرفياً لعامل الدعم القديم
 * حتى يعتمد العميل الجديد والقديم نفس الاعتماد والتوقيع.
 */
export async function authorizeSupportRequest(request, cfg, deviceId, body = '') {
  if (!cfg.kv || !DEVICE_RE.test(deviceId)) return false
  if (request.headers.get('x-support-protocol') !== SUPPORT_PROTOCOL) return false
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Support ') ? auth.slice(8) : ''
  if (!SUPPORT_TOKEN_RE.test(token)) return false
  const signed = await verifySignature(token, request, body)
  if (!signed) return false

  const presented = await tokenHash(token)
  const authKey = `support-auth:${deviceId}`
  const stored = await cfg.kv.get(authKey)
  if (stored && !constantTimeEqual(stored, presented)) return false
  const nonceKey = `support-nonce:${deviceId}:${signed.requestNonce}`
  if (await cfg.kv.get(nonceKey)) return false
  if (!stored) await cfg.kv.put(authKey, presented)
  await cfg.kv.put(nonceKey, '1', { expirationTtl: 600 })
  return true
}

/* ─── تخزين المحادثة (نفس شكل chat:<deviceId> في عامل الدعم القديم) ────── */

export async function readSupportChat(cfg, deviceId) {
  try {
    const raw = await cfg.kv.get(`chat:${deviceId}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function chatMetadata(chat) {
  const last = chat.length ? chat[chat.length - 1] : {}
  return {
    v: CHAT_META_VERSION,
    count: chat.length,
    lastFrom: String(last.from ?? '').slice(0, 12),
    lastAt: String(last.at ?? '').slice(0, 30),
    lastText: clean(last.text, 120),
  }
}

export async function pushSupportChat(cfg, deviceId, from, text) {
  const chat = await readSupportChat(cfg, deviceId)
  const id = chat.length ? Math.max(...chat.map((m) => m.id || 0)) + 1 : 1
  chat.push({ id, from, text, at: new Date().toISOString() })
  const trimmed = chat.length > CHAT_KEEP ? chat.slice(chat.length - CHAT_KEEP) : chat
  await cfg.kv.put(`chat:${deviceId}`, JSON.stringify(trimmed), { metadata: chatMetadata(trimmed) })
  return id
}

/* ─── إشعار المطوّر عبر بوت تليجرام نفسه ────────────────────────────────── */

/** نص عادي بلا parse_mode — يمنع حقن HTML/Markdown في رسالة المطوّر */
async function tgSendPlain(cfg, text) {
  if (!cfg.token || !cfg.adminId) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.adminId, text: String(text).slice(0, 4000) }),
    })
    const data = await res.json()
    return data?.ok ? data.result?.message_id ?? null : null
  } catch { return null }
}

async function tgSendLog(cfg, deviceId, logText) {
  if (!cfg.token || !cfg.adminId || !logText) return
  try {
    const form = new FormData()
    form.append('chat_id', cfg.adminId)
    form.append('document', new Blob([logText], { type: 'text/plain' }), `log-${deviceId}.txt`)
    form.append('caption', `سجل التطبيق — ${deviceId} (بموافقة العميل، للتشخيص فقط)`)
    await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, { method: 'POST', body: form })
  } catch { /* إرفاق اللوج تحسين — لا يُفقد الرسالة */ }
}

/* ─── نقطة العميل: GET/POST /support/:deviceId ──────────────────────────── */

export function supportJson(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: cors })
}

/**
 * يعالج طلب العميل. يقرأ الجسم مرة واحدة قبل التحقق لأن HMAC مبني على النص الخام،
 * تماماً كما في `cloud/worker.js`. يُعيد Response جاهزاً.
 */
export async function handleSupportClientRequest({ request, cfg, deviceId, cors }) {
  let rawBody = ''
  if (request.method === 'POST') {
    rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return supportJson({ error: 'too large' }, 413, cors)
    }
  }
  if (!(await authorizeSupportRequest(request, cfg, deviceId, rawBody))) {
    return supportJson({ error: 'unauthorized' }, 401, cors)
  }

  if (request.method === 'GET') {
    return supportJson(await readSupportChat(cfg, deviceId), 200, cors)
  }
  if (request.method !== 'POST') return supportJson({ error: 'method' }, 405, cors)

  let body
  try { body = JSON.parse(rawBody) } catch { return supportJson({ error: 'json only' }, 400, cors) }

  const hourKey = `rate:${deviceId}:${new Date().toISOString().slice(0, 13)}`
  const count = Number((await cfg.kv.get(hourKey)) || 0)
  if (count >= RATE_LIMIT) return supportJson({ error: 'rate limit' }, 429, cors)
  await cfg.kv.put(hourKey, String(count + 1), { expirationTtl: 3700 })

  const text = clean(body?.text)
  if (text.length < 3) return supportJson({ error: 'empty' }, 400, cors)
  const customer = clean(body?.customer, 80) || 'غير مسمى'
  const activity = clean(body?.activity, 40)
  const appVersion = clean(body?.appVersion, 20)

  await pushSupportChat(cfg, deviceId, 'client', text)
  const header = `📩 بلاغ دعم\n👤 ${customer}${activity ? ` · ${activity}` : ''}\n🖥️ ${deviceId}${appVersion ? ` · v${appVersion}` : ''}\n${'─'.repeat(20)}\n`
  const messageId = await tgSendPlain(cfg, `${header}${text}\n\n↩️ رد على هذه الرسالة (Reply) ليصل ردك للعميل داخل التطبيق`)
  if (messageId != null) await cfg.kv.put(`tgmap:${messageId}`, deviceId, { expirationTtl: 60 * 60 * 24 * 30 })
  if (typeof body?.log === 'string' && body.log.length > 0) {
    const logText = body.log.slice(-LOG_MAX).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    await tgSendLog(cfg, deviceId, logText)
  }
  return supportJson({ ok: true }, 200, cors)
}

/* ─── أفعال اللوحة/البوت محلياً (بديل الجسر إلى العامل القديم) ──────────── */

/**
 * نفس عقد `/support-bridge` في cloud/worker.js حرفياً، لكنه يقرأ/يكتب KV هذا
 * العامل مباشرة. يُستدعى من supportBridge.js حين يكون SUPPORT_LOCAL_CHANNEL=1.
 * لا يرمي استثناءً أبداً — أي فشل يعود {ok:false,error}.
 */
export async function runLocalSupportAction(cfg, action, payload = {}) {
  try {
    if (!cfg?.kv) return { ok: false, error: 'قناة الدعم المحلية غير مضبوطة (KV)' }
    const deviceId = clean(payload?.deviceId, 64)
    const text = clean(payload?.text, TEXT_MAX)

    if (action === 'telegram-reply') {
      const messageId = String(payload?.messageId ?? '')
      if (!messageId || text.length < 1) return { ok: false, error: 'empty' }
      const target = await cfg.kv.get(`tgmap:${messageId}`)
      if (!target || !DEVICE_RE.test(target)) return { ok: false, error: 'unknown message' }
      await pushSupportChat(cfg, target, 'developer', text)
      return { ok: true, deviceId: target }
    }

    if (action === 'inbox') {
      const list = await cfg.kv.list({ prefix: 'chat:', limit: 200 })
      const rows = []
      let reads = 0
      let truncated = 0
      for (const key of list.keys) {
        const id = key.name.slice('chat:'.length)
        const meta = key.metadata
        if (meta && meta.v === CHAT_META_VERSION) {
          rows.push({
            deviceId: id,
            messages: Number(meta.count) || 0,
            awaitingReply: meta.lastFrom === 'client',
            lastFrom: String(meta.lastFrom ?? ''),
            lastText: clean(meta.lastText, 200),
            lastAt: String(meta.lastAt ?? ''),
          })
          continue
        }
        if (reads >= CHAT_INBOX_MAX_READS) { truncated++; continue }
        reads++
        const chat = await readSupportChat(cfg, id)
        if (!chat.length) continue
        const last = chat[chat.length - 1]
        rows.push({
          deviceId: id,
          messages: chat.length,
          awaitingReply: last?.from === 'client',
          lastFrom: last?.from ?? '',
          lastText: clean(last?.text, 200),
          lastAt: String(last?.at ?? ''),
        })
      }
      rows.sort((a, b) => (b.awaitingReply - a.awaitingReply) || String(b.lastAt).localeCompare(String(a.lastAt)))
      return { ok: true, conversations: rows.slice(0, 50), truncated }
    }

    if (action === 'thread') {
      if (!DEVICE_RE.test(deviceId)) return { ok: false, error: 'bad device' }
      return { ok: true, deviceId, messages: (await readSupportChat(cfg, deviceId)).slice(-40) }
    }

    if (action === 'reply') {
      if (!DEVICE_RE.test(deviceId)) return { ok: false, error: 'bad device' }
      if (text.length < 1) return { ok: false, error: 'empty' }
      await pushSupportChat(cfg, deviceId, 'developer', text)
      return { ok: true, deviceId }
    }

    return { ok: false, error: 'unknown action' }
  } catch (error) {
    return { ok: false, error: (error && error.message) || 'خطأ في قناة الدعم المحلية' }
  }
}
