/**
 * ShopSys Control — Cloudflare Worker (القرار 28 + قناة الدعم)
 * ────────────────────────────────────────────────────────────
 * لوحة تحكم المطوّر السحابية: صفحة «حول»، قائمة حرق المفاتيح، حالة الاشتراكات،
 * وقناة الدعم الفني (محادثة العميل ↔ المطوّر عبر بوت التليجرام).
 * النشر: wrangler deploy — ثم اربط KV باسم SHOPSYS_KV وأسرار البوت:
 *   wrangler secret put DEV_BOT_TOKEN     ← توكن بوت المطوّر
 *   wrangler secret put DEV_CHAT_ID       ← محادثة المطوّر
 *   wrangler secret put TG_WEBHOOK_SECRET ← سر ويبهوك تليجرام (secret_token)
 * ثم سجّل الويبهوك:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>/tg-webhook&secret_token=<SECRET>&allowed_updates=["message"]
 *
 * مفاتيح KV التي يديرها المطوّر:
 *   about                 → JSON: {title, body, supportPhone, supportTelegram, website, updatedAt}
 *   revoked               → JSON: ["deadbeef", …] بصمات المفاتيح المحروقة
 *   sub:<deviceId>        → JSON: {plan, expiresAt, message}
 *   chat:<deviceId>       → JSON: [{id, from, text, at}, …] محادثة الدعم
 *   tgmap:<messageId>     → deviceId — لربط رد المطوّر (Reply) بالعميل الصحيح
 *
 * حماية (طلب المالك — ضد الحقن والرفع):
 * - نصوص JSON فقط: لا ملفات ولا وسائط — أي رد تليجرام غير نصي يُتجاهل.
 * - كل نص يُعقَّم (لا وسوم ولا محارف تحكم) وبحدود طول صارمة.
 * - معرف الجهاز يُطابق نمطاً صارماً؛ حد معدل للإرسال لكل جهاز (10 رسائل/ساعة).
 * - ويبهوك تليجرام محمي بـsecret_token — أي استدعاء بدونه يُرفض.
 *
 * ملاحظة أمان: نقاط العرض للعرض فقط — الحجية القانونية دائماً للمفتاح
 * الموقّع Ed25519 الذي يتحقق منه التطبيق محلياً بلا إنترنت.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
}

const DEVICE_RE = /^[A-Za-z0-9_-]{6,64}$/
const TEXT_MAX = 1500
const LOG_MAX = 60_000
const CHAT_KEEP = 200 // آخر 200 رسالة لكل جهاز
const RATE_LIMIT = 10 // رسائل لكل جهاز في الساعة

/** تعقيم نص وارد: لا وسوم، لا محارف تحكم، طول محدود */
function clean(v, max = TEXT_MAX) {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

async function readChat(env, deviceId) {
  try {
    const raw = await env.SHOPSYS_KV.get(`chat:${deviceId}`)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

async function pushChat(env, deviceId, from, text) {
  const chat = await readChat(env, deviceId)
  const id = chat.length ? Math.max(...chat.map((m) => m.id || 0)) + 1 : 1
  chat.push({ id, from, text, at: new Date().toISOString() })
  const trimmed = chat.length > CHAT_KEEP ? chat.slice(chat.length - CHAT_KEEP) : chat
  await env.SHOPSYS_KV.put(`chat:${deviceId}`, JSON.stringify(trimmed))
  return id
}

/** إرسال نص لتليجرام المطوّر — يرجع message_id أو null */
async function tgSend(env, text) {
  if (!env.DEV_BOT_TOKEN || !env.DEV_CHAT_ID) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.DEV_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // نص عادي بلا parse_mode — يمنع أي حقن Markdown/HTML في التليجرام
      body: JSON.stringify({ chat_id: env.DEV_CHAT_ID, text: text.slice(0, 4000) }),
    })
    const data = await res.json()
    return data?.ok ? data.result?.message_id ?? null : null
  } catch { return null }
}

/** إرسال اللوج كمستند نصي (أطول من حد رسالة تليجرام) */
async function tgSendLog(env, deviceId, logText) {
  if (!env.DEV_BOT_TOKEN || !env.DEV_CHAT_ID) return
  try {
    const form = new FormData()
    form.append('chat_id', env.DEV_CHAT_ID)
    form.append('document', new Blob([logText], { type: 'text/plain' }), `log-${deviceId}.txt`)
    form.append('caption', `سجل التطبيق — ${deviceId} (أرسله العميل بموافقته لأغراض الإصلاح)`)
    await fetch(`https://api.telegram.org/bot${env.DEV_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form })
  } catch { /* صامت */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/$/, '')

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })

    /* ─── قناة الدعم: GET يجلب المحادثة، POST يرسل رسالة ─── */
    const sm = path.match(/^\/support\/([A-Za-z0-9_-]{6,64})$/)
    if (sm) {
      const deviceId = sm[1]
      if (!DEVICE_RE.test(deviceId)) return json({ error: 'bad device' }, 400)

      if (request.method === 'GET') {
        return json(await readChat(env, deviceId))
      }

      if (request.method === 'POST') {
        // حد الحجم الكلي (نص + لوج) — يمنع إغراق الووركر
        if ((Number(request.headers.get('content-length')) || 0) > 200_000) return json({ error: 'too large' }, 413)
        let body
        try { body = await request.json() } catch { return json({ error: 'json only' }, 400) }

        // حد المعدل: 10 رسائل/ساعة لكل جهاز
        const hourKey = `rate:${deviceId}:${new Date().toISOString().slice(0, 13)}`
        const count = Number((await env.SHOPSYS_KV.get(hourKey)) || 0)
        if (count >= RATE_LIMIT) return json({ error: 'rate limit' }, 429)
        await env.SHOPSYS_KV.put(hourKey, String(count + 1), { expirationTtl: 3700 })

        const text = clean(body?.text)
        if (text.length < 3) return json({ error: 'empty' }, 400)
        const customer = clean(body?.customer, 80) || 'غير مسمى'
        const activity = clean(body?.activity, 40)
        const appVersion = clean(body?.appVersion, 20)

        await pushChat(env, deviceId, 'client', text)
        // رسالة المطوّر تتضمن كل بيانات الجهاز — والرد عليها Reply يصل للعميل
        const header = `📩 بلاغ دعم\n👤 ${customer}${activity ? ` · ${activity}` : ''}\n🖥️ ${deviceId}${appVersion ? ` · v${appVersion}` : ''}\n${'─'.repeat(20)}\n`
        const msgId = await tgSend(env, header + text + `\n\n↩️ رد على هذه الرسالة (Reply) ليصل ردك للعميل داخل التطبيق`)
        if (msgId != null) {
          await env.SHOPSYS_KV.put(`tgmap:${msgId}`, deviceId, { expirationTtl: 60 * 60 * 24 * 30 })
        }
        // اللوج (بموافقة العميل) يُرسل كمستند منفصل — نصي فقط
        if (typeof body?.log === 'string' && body.log.length > 0) {
          const logText = String(body.log).slice(-LOG_MAX).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
          await tgSendLog(env, deviceId, logText)
        }
        return json({ ok: true })
      }

      return json({ error: 'method' }, 405)
    }

    /* ─── ويبهوك تليجرام: رد المطوّر (Reply) يدخل محادثة العميل ─── */
    if (path === '/tg-webhook' && request.method === 'POST') {
      // secret_token إلزامي — أي استدعاء بدونه يُرفض (حماية من حقن البوت)
      if (!env.TG_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_WEBHOOK_SECRET) {
        return json({ error: 'forbidden' }, 403)
      }
      let update
      try { update = await request.json() } catch { return json({ ok: true }) }
      const msg = update?.message
      // نقبل فقط: رسالة نصية، من محادثة المطوّر نفسها، وهي Reply على رسالة بلاغ
      const replyTo = msg?.reply_to_message?.message_id
      const text = clean(msg?.text)
      const fromDevChat = String(msg?.chat?.id ?? '') === String(env.DEV_CHAT_ID ?? '')
      if (replyTo && text && fromDevChat) {
        const deviceId = await env.SHOPSYS_KV.get(`tgmap:${replyTo}`)
        if (deviceId && DEVICE_RE.test(deviceId)) {
          await pushChat(env, deviceId, 'developer', text)
        }
      }
      // أي شيء آخر (ملفات/وسائط/محادثات غريبة) يُتجاهل بصمت
      return json({ ok: true })
    }

    if (request.method !== 'GET') return json({ error: 'GET only' }, 405)

    // GET /about — محتوى صفحة «حول» يتحكم فيه المطوّر
    if (path === '/about') {
      const raw = await env.SHOPSYS_KV.get('about')
      return new Response(raw ?? JSON.stringify({
        title: 'نظام المحاسبة والكاشير',
        body: 'نظام عربي متكامل — تواصل مع المطوّر للتفعيل والدعم.',
        supportPhone: '', supportTelegram: '', website: '',
        updatedAt: new Date().toISOString(),
      }), { headers: JSON_HEADERS })
    }

    // GET /revoked — بصمات المفاتيح المحروقة (حرق نهائي، لا يعاد الاستخدام)
    if (path === '/revoked') {
      const raw = await env.SHOPSYS_KV.get('revoked')
      return new Response(raw ?? '[]', { headers: JSON_HEADERS })
    }

    // GET /version — أحدث إصدار منشور (البند 6: زر «فحص التحديثات» في «حول»)
    // المطوّر يحدّثه من بوت التليجرام أو مباشرة في KV بمفتاح 'version'
    if (path === '/version') {
      const raw = await env.SHOPSYS_KV.get('version')
      return new Response(raw ?? JSON.stringify({
        latestVersion: '1.0.0',
        downloadUrl: '',
        releaseNotesAr: '',
        sha256: '',
        mandatory: false,
        publishedAt: new Date().toISOString(),
      }), { headers: JSON_HEADERS })
    }

    // GET /subscription/:deviceId — حالة اشتراك للعرض في التطبيق
    const m = path.match(/^\/subscription\/([A-Z0-9-]+)$/i)
    if (m) {
      const raw = await env.SHOPSYS_KV.get(`sub:${m[1]}`)
      if (!raw) return json(null)
      return new Response(raw, { headers: JSON_HEADERS })
    }

    return json({ error: 'not found' }, 404)
  },
}
