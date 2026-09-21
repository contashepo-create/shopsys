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

/* ─── إصدار المفاتيح من البوت (ترقية بوت المطوّر — سد فجوة التدقيق) ───
 * نفس صيغة license_tool.mjs حرفياً: canonicalPayload → Ed25519 → SHOPSYS1.<b64u>.<b64u>
 * يتطلب: wrangler secret put SHOPSYS_PRIVATE_KEY (pkcs8 بترميز base64url)
 * بدون هذا السر أمرا «اصدار» يرد برسالة إرشادية — وباقي البوت يعمل كالمعتاد. */

const PLANS = ['basic', 'pro', 'lifetime']
const KEY_FEATURES = ['einvoice_eg', 'einvoice_sa', 'multi_branch', 'telegram_bot', 'cloud_sync', 'multi_user_lan']

function b64uEncode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** مطابق حرفياً لـcanonicalPayload في core/license.ts — أي اختلاف يكسر التوقيع */
function canonicalPayload(p) {
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

/** بصمة المفتاح — مطابقة لـkeyFingerprint في core/license.ts (DJB2 على جزء التوقيع) */
function keyFingerprint(key) {
  const sigPart = key.trim().split('.')[2] ?? key
  let h = 5381
  for (let i = 0; i < sigPart.length; i++) h = ((h << 5) + h + sigPart.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

async function signLicense(env, payload) {
  const priv = await crypto.subtle.importKey('pkcs8', b64uDecode(env.SHOPSYS_PRIVATE_KEY), 'Ed25519', false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode(canonicalPayload(payload))))
  return `SHOPSYS1.${b64uEncode(new TextEncoder().encode(canonicalPayload(payload)))}.${b64uEncode(sig)}`
}

async function readRevoked(env) {
  try {
    const arr = JSON.parse((await env.SHOPSYS_KV.get('revoked')) ?? '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

/** فحص الاشتراكات المنتهية/الموشكة (تذكير المطوّر) — يعمل من الأمر «تذكير» ومن الـcron اليومي */
async function subscriptionDigest(env) {
  const now = Date.now()
  const soon = []
  const expired = []
  let total = 0
  let cursor
  do {
    const page = await env.SHOPSYS_KV.list({ prefix: 'sub:', cursor })
    for (const k of page.keys) {
      total++
      try {
        const sub = JSON.parse((await env.SHOPSYS_KV.get(k.name)) ?? 'null')
        if (!sub?.expiresAt) continue // دائم — لا تذكير
        const device = k.name.slice(4)
        const days = Math.ceil((new Date(sub.expiresAt).getTime() - now) / 86_400_000)
        if (days < 0) expired.push(`⛔ ${device} (${sub.plan ?? '؟'}) انتهى منذ ${-days} يوم — ${sub.expiresAt}`)
        else if (days <= 7) soon.push(`⏳ ${device} (${sub.plan ?? '؟'}) يتبقى ${days} يوم — ${sub.expiresAt}`)
      } catch { /* سجل تالف — نتجاهله */ }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return { total, soon, expired }
}

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

      /* ─── أوامر المطوّر (البند 5 — مفاتيح الميزات عن بُعد) — من محادثة المطوّر فقط ───
         عطل DEV-XXXX cloud_sync [ملاحظة عربية]   → إطفاء ميزة ممنوحة مؤقتاً
         فعل DEV-XXXX cloud_sync                  → إعادة تفعيلها
         أعلام DEV-XXXX                            → عرض أعلام الجهاز
         نشر_تحديث 1.2.0 <رابط> <sha256> [إجباري] → تحديث نقطة /version            */
      if (!replyTo && text && fromDevChat) {
        const FEATURES = KEY_FEATURES
        const parts = text.trim().split(/\s+/)
        const cmd = parts[0]

        /* ─── ترقية البوت (سد فجوة التدقيق): إصدار مفاتيح + حرق + إحصاءات + تذكير ─── */
        if (cmd === 'مساعدة' || cmd === '/start' || cmd === 'اوامر' || cmd === 'أوامر') {
          await tgSend(env, [
            '🤖 أوامر بوت المطوّر:',
            '',
            '🔑 اصدار <device> <خطة> [أيام] [ميزات,] — مفتاح تفعيل موقّع',
            '   مثال: اصدار SHOP-AAAA-BBBB-CCCC pro 365 cloud_sync,telegram_bot',
            '   إضافات: نشاط=pharmacy مستخدمين=3 فروع=2 وحدات=logistics عميل=بقالة_النور',
            `   الخطط: ${PLANS.join(' | ')} — بلا أيام = مدى الحياة`,
            '🔥 حرق <بصمة أو مفتاح كامل> — إبطال نهائي (قائمة /revoked)',
            '📋 محروق — عرض قائمة البصمات المحروقة',
            '💼 اشتراك <device> <خطة> <YYYY-MM-DD أو دائم> [رسالة] — بطاقة الاشتراك في التطبيق',
            '📊 احصائيات — عدد الاشتراكات والأعلام والمحروق',
            '⏰ تذكير — الاشتراكات المنتهية والموشكة (٧ أيام)',
            '🚩 أعلام <device> — أعلام الجهاز',
            '🔴 عطل <device> <ميزة> [سبب] / 🟢 فعل <device> <ميزة>',
            '📦 نشر_تحديث <نسخة> <رابط> <sha256> [إجباري]',
            '',
            `الميزات: ${FEATURES.join('، ')}`,
          ].join('\n'))
        } else if (cmd === 'اصدار' || cmd === 'إصدار') {
          if (!env.SHOPSYS_PRIVATE_KEY) {
            await tgSend(env, '❌ سر التوقيع غير مضبوط — نفّذ: wrangler secret put SHOPSYS_PRIVATE_KEY\n(المفتاح الخاص pkcs8 بترميز base64url من license_tool.mjs genkeys)')
          } else if (!parts[1] || !DEVICE_RE.test(parts[1])) {
            await tgSend(env, '❌ معرف الجهاز مطلوب: اصدار SHOP-XXXX-XXXX-XXXX pro 365')
          } else if (!PLANS.includes(parts[2] ?? '')) {
            await tgSend(env, `❌ الخطة مطلوبة: ${PLANS.join(' | ')}`)
          } else {
            const deviceId = parts[1]
            const plan = parts[2]
            // الوسائط المرنة: أيام (رقم صرف) وميزات (قائمة بفواصل) وأزواج مفتاح=قيمة
            let days = null
            let features = []
            let activityId = null, extraUsers = 0, extraBranches = 0, extraModules = [], customer = ''
            for (const tok of parts.slice(3)) {
              if (/^\d+$/.test(tok)) days = Number(tok)
              else if (tok.startsWith('نشاط=')) activityId = clean(tok.slice(5), 40)
              else if (tok.startsWith('مستخدمين=')) extraUsers = Number(tok.slice(9)) || 0
              else if (tok.startsWith('فروع=')) extraBranches = Number(tok.slice(5)) || 0
              else if (tok.startsWith('وحدات=')) extraModules = tok.slice(6).split(',').filter(Boolean)
              else if (tok.startsWith('عميل=')) customer = clean(tok.slice(5).replace(/_/g, ' '), 80)
              else features = features.concat(tok.split(',').filter((f) => FEATURES.includes(f)))
            }
            const today = new Date().toISOString().slice(0, 10)
            const expiresAt = days ? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) : null
            const payload = { v: 1, deviceId, customer, plan, features, issuedAt: today, expiresAt }
            if (extraUsers > 0) payload.extraUsers = extraUsers
            if (extraBranches > 0) payload.extraBranches = extraBranches
            if (activityId) payload.activityId = activityId
            if (extraModules.length > 0) payload.extraModules = extraModules
            try {
              const key = await signLicense(env, payload)
              // بطاقة الاشتراك تُسجل تلقائياً لتذكير الانتهاء وعرضها في التطبيق
              await env.SHOPSYS_KV.put(`sub:${deviceId}`, JSON.stringify({ plan, expiresAt, message: '', customer, issuedAt: today }))
              await tgSend(env, `🔑 مفتاح ${plan}${expiresAt ? ` حتى ${expiresAt}` : ' (مدى الحياة)'} للجهاز ${deviceId}\nالبصمة (للحرق لاحقاً): ${keyFingerprint(key)}\n\nأرسل السطر التالي كاملاً للعميل:`)
              await tgSend(env, key)
            } catch (e) {
              await tgSend(env, `❌ فشل التوقيع: ${String(e?.message ?? e).slice(0, 200)}\nتأكد أن SHOPSYS_PRIVATE_KEY هو pkcs8 بترميز base64url`)
            }
          }
        } else if (cmd === 'حرق') {
          const target = clean(parts[1] ?? '', 4000)
          if (!target) {
            await tgSend(env, '❌ أرسل: حرق <بصمة 8 خانات أو المفتاح كاملاً>')
          } else {
            const fp = target.includes('.') ? keyFingerprint(target) : target.toLowerCase()
            if (!/^[0-9a-f]{8}$/.test(fp)) {
              await tgSend(env, '❌ البصمة يجب أن تكون 8 خانات سداسية عشرية — أو أرسل المفتاح كاملاً وسأحسبها')
            } else {
              const revoked = await readRevoked(env)
              if (!revoked.includes(fp)) revoked.push(fp)
              await env.SHOPSYS_KV.put('revoked', JSON.stringify(revoked))
              await tgSend(env, `🔥 حُرقت البصمة ${fp} نهائياً — التطبيقات ستجلبها مع دورة /revoked (كل ٦ ساعات)\nالمحروق الآن: ${revoked.length}`)
            }
          }
        } else if (cmd === 'محروق') {
          const revoked = await readRevoked(env)
          await tgSend(env, revoked.length ? `📋 البصمات المحروقة (${revoked.length}):\n${revoked.join('\n')}` : 'لا مفاتيح محروقة')
        } else if (cmd === 'اشتراك' && parts[1] && DEVICE_RE.test(parts[1])) {
          const plan = PLANS.includes(parts[2] ?? '') ? parts[2] : null
          const expiryTok = parts[3] ?? ''
          const expiresAt = expiryTok === 'دائم' ? null : /^\d{4}-\d{2}-\d{2}$/.test(expiryTok) ? expiryTok : undefined
          if (!plan || expiresAt === undefined) {
            await tgSend(env, '❌ الصيغة: اشتراك <device> <basic|pro|lifetime> <YYYY-MM-DD أو دائم> [رسالة للعميل]')
          } else {
            const message = clean(parts.slice(4).join(' '), 300)
            await env.SHOPSYS_KV.put(`sub:${parts[1]}`, JSON.stringify({ plan, expiresAt, message }))
            await tgSend(env, `💼 سُجل اشتراك ${parts[1]}: ${plan}${expiresAt ? ` حتى ${expiresAt}` : ' (دائم)'}${message ? `\nرسالة العميل: ${message}` : ''}`)
          }
        } else if (cmd === 'احصائيات' || cmd === 'إحصائيات') {
          const digest = await subscriptionDigest(env)
          const revoked = await readRevoked(env)
          let flagged = 0
          let cursor
          do {
            const page = await env.SHOPSYS_KV.list({ prefix: 'flags:', cursor })
            flagged += page.keys.length
            cursor = page.list_complete ? undefined : page.cursor
          } while (cursor)
          await tgSend(env, [
            '📊 إحصائيات المنظومة:',
            `💼 اشتراكات مسجلة: ${digest.total}`,
            `⏳ تنتهي خلال ٧ أيام: ${digest.soon.length}`,
            `⛔ منتهية: ${digest.expired.length}`,
            `🚩 أجهزة عليها أعلام إطفاء: ${flagged}`,
            `🔥 مفاتيح محروقة: ${revoked.length}`,
          ].join('\n'))
        } else if (cmd === 'تذكير') {
          const digest = await subscriptionDigest(env)
          const lines = [...digest.expired, ...digest.soon]
          await tgSend(env, lines.length
            ? `⏰ تذكير الاشتراكات:\n${lines.join('\n')}`
            : '✅ لا اشتراكات منتهية ولا موشكة على الانتهاء (٧ أيام)')
        } else

        if ((cmd === 'عطل' || cmd === 'فعل') && parts[1] && DEVICE_RE.test(parts[1]) && FEATURES.includes(parts[2] ?? '')) {
          const dev = parts[1], feat = parts[2]
          const key = `flags:${dev}`
          const cur = JSON.parse((await env.SHOPSYS_KV.get(key)) ?? '{"disabledFeatures":[],"noteAr":""}')
          const set = new Set(cur.disabledFeatures ?? [])
          if (cmd === 'عطل') {
            set.add(feat)
            cur.noteAr = clean(parts.slice(3).join(' '), 300) || cur.noteAr || ''
          } else {
            set.delete(feat)
            if (set.size === 0) cur.noteAr = ''
          }
          cur.disabledFeatures = [...set]
          cur.updatedAt = new Date().toISOString()
          await env.SHOPSYS_KV.put(key, JSON.stringify(cur))
          await tgSend(env, `${cmd === 'عطل' ? '🔴 عُطلت' : '🟢 فُعّلت'} ميزة ${feat} للجهاز ${dev}\nالمطفأ حالياً: ${cur.disabledFeatures.join('، ') || 'لا شيء'}`)
        } else if (cmd === 'أعلام' && parts[1] && DEVICE_RE.test(parts[1])) {
          const raw = await env.SHOPSYS_KV.get(`flags:${parts[1]}`)
          await tgSend(env, raw ? `🚩 أعلام ${parts[1]}:\n${raw}` : `لا أعلام للجهاز ${parts[1]} — كل ميزاته الممنوحة تعمل`)
        } else if (cmd === 'نشر_تحديث' && /^\d+\.\d+\.\d+$/.test(parts[1] ?? '')) {
          const info = {
            latestVersion: parts[1],
            downloadUrl: parts[2] ?? '',
            sha256: parts[3] ?? '',
            mandatory: parts[4] === 'إجباري',
            releaseNotesAr: '',
            publishedAt: new Date().toISOString(),
          }
          await env.SHOPSYS_KV.put('version', JSON.stringify(info))
          await tgSend(env, `📦 نُشر الإصدار v${info.latestVersion}${info.mandatory ? ' (إجباري)' : ''} — نقطة /version محدثة`)
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

    // GET /flags/:deviceId — مفتاح الإطفاء السحابي (البند 5):
    // المنح دائماً بمفتاح موقَّع؛ السحابة تعطّل مؤقتاً فقط (متأخر سداد مثلاً).
    // المطوّر يضبطه من البوت: «عطل <device> <feature>» / «فعل <device> <feature>»
    const fm = path.match(/^\/flags\/([A-Z0-9-]+)$/i)
    if (fm) {
      const raw = await env.SHOPSYS_KV.get(`flags:${fm[1]}`)
      return new Response(raw ?? JSON.stringify({ disabledFeatures: [], noteAr: '', updatedAt: '' }), { headers: JSON_HEADERS })
    }

    return json({ error: 'not found' }, 404)
  },

  /**
   * تذكير تلقائي يومي (ترقية البوت): الاشتراكات المنتهية والموشكة (٧ أيام)
   * تصل المطوّر على التليجرام بلا أمر — يتفعل بإضافة crons في wrangler.toml.
   * لا شيء = لا رسالة (بلا إزعاج يومي فارغ).
   */
  async scheduled(_event, env) {
    const digest = await subscriptionDigest(env)
    const lines = [...digest.expired, ...digest.soon]
    if (lines.length) await tgSend(env, `⏰ تذكير الاشتراكات اليومي:\n${lines.join('\n')}`)
  },
}
