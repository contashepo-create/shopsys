/**
 * shopsys-control — Cloudflare Worker لمركز تحكم المطوّر (بوت تليجرام + سحابة العملاء).
 *
 * الوظائف:
 *   ① بوت تليجرام خاص بالمطوّر: إصدار/تجديد مفاتيح التفعيل الموقّعة (Ed25519)،
 *      حرق المفاتيح، البحث، رسائل للعملاء، محتوى «حول» — كلها محصورة بمعرّف المطوّر.
 *   ② نقاط REST التي تقرؤها نسخة العميل (متوافقة حرفياً مع app/src/core/cloud.ts):
 *      GET /about                  → محتوى صفحة «حول» بصيغة JSON
 *      GET /revoked                → مصفوفة بصمات المفاتيح المحروقة (8-hex)
 *      GET /subscription/:deviceId → { plan, expiresAt, message }
 *      GET /notifications/:deviceId → التنبيهات العامة والخاصة بالجهاز
 *
 *   التخزين: KV واحد (SHOPSYS_CONTROL) — المفاتيح:
 *   about               → نص «حول»
 *   revoked             → JSON: ["1a2b3c4d", ...]
 *   lic:{fingerprint}   → سجل مفتاح: { payload, key, issuedAt, revoked, note }
 *   dev:{deviceId}      → حالة جهاز: { plan, expiresAt, customer, message }
 *   settings:global     → إعدادات افتراضية للرخص الجديدة
 *   settings:customer:* → استثناءات محفوظة لكل عميل
 *   notices:global      → تنبيهات عامة، و notices:{deviceId} → تنبيهات خاصة
 *
 * الأسرار (wrangler secret put): TELEGRAM_BOT_TOKEN · DEV_PRIVATE_KEY_B64U ·
 *                                TELEGRAM_ADMIN_ID · WEBHOOK_SECRET
 * لا سجلات حساسة: المفاتيح تُرسل للمطوّر فقط في محادثة تليجرام الخاصة.
 */
import { issueLicenseKey, keyFingerprint, decodeLicenseKey, expiresAfterDays, canonicalPayload, issueActivityChangeKey } from './licenseLib.js'
import { acknowledgePanelCallback, getNotificationsForDevice, handlePanelButton, handlePanelText, panelHome, recordNoticeAck, noticeListReply } from './adminPanel.js'
import { subscriptionDigest, formatDigestAr, formatStatsAr, hasDigestNews, digestMarkerKey, readSoonDays, deviceMetadata } from './subscriptions.js'
import { readAbout, setAboutField } from './aboutContent.js'
import {
  REG_MAX_BYTES, sanitizeRegistration, saveRegistration, formatRegistrationAr,
  listRegistrations, formatRegistrationsAr, deleteRegistration,
} from './registrations.js'
import { supportBridge } from './supportBridge.js'

/* ═══════════ إعدادات البيئة (secrets + vars) ═══════════ */
const env_ = env => ({
  token: env.TELEGRAM_BOT_TOKEN,
  adminId: String(env.TELEGRAM_ADMIN_ID ?? ''),
  priv: env.DEV_PRIVATE_KEY_B64U,
  webhookSecret: env.WEBHOOK_SECRET,
  kv: env.SHOPSYS_CONTROL,
  /* بند 1 (تدقيق 2026-10-08): جسر قناة الدعم — المحادثات مخزّنة في عامل
     `cloud/worker.js` (HMAC v2 + TOFU)، واللوحة هنا. بلا هذين المتغيرين تبقى
     أوامر الدعم معطّلة برسالة إرشادية ولا ينهار شيء آخر. */
  supportBridgeUrl: String(env.SUPPORT_BRIDGE_URL ?? '').replace(/\/$/, ''),
  supportBridgeSecret: String(env.SUPPORT_BRIDGE_SECRET ?? ''),
})

const PLANS = new Set(['trial', 'basic', 'pro', 'lifetime'])
const FEATURES = new Set([
  'einvoice_eg',
  'einvoice_sa',
  'multi_branch',
  'telegram_bot',
  'cloud_sync',
  'multi_user_lan',
])
/* v1.0.10: الوحدات الـ17 القابلة للمنح بمفتاح موقّع (extraModules — عقد إضافة قسم خارج النشاط) */
const MODULES = new Set(['pos', 'inventory', 'purchases', 'installments', 'recipes', 'processing', 'jewelry', 'maintenance', 'laundry', 'booking', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars', 'wallet_services', 'realestate'])
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/* ═══════════ المدخل ═══════════ */
export default {
  async fetch(request, env) {
    const cfg = env_(env)
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    /* نقاط العملاء — عامة القراءة فقط: محتوى «حول» والإبطال وحالة الاشتراك. */
    if (url.pathname === '/about') {
      /* بند 9 (تدقيق 2026-10-08): مستند «حول» المنظّم — هاتف/واتساب/تليجرام/بريد/
         موقع/عنوان/مواعيد + حقول حرة، يملؤها المطوّر من اللوحة. القيمة القديمة
         النص خام تُقرأ كـbody فلا يُفقد شيء، والتعقيم يتم عند القراءة أيضاً. */
      return json(await readAbout(cfg), CORS)
    }
    if (url.pathname === '/revoked') {
      const raw = await cfg.kv.get('revoked')
      if (!raw) return json([], CORS)
      try {
        const parsed = JSON.parse(raw)
        return json(Array.isArray(parsed) ? parsed : [], CORS)
      } catch { return json([], CORS) }
    }
    const notifications = url.pathname.match(/^\/notifications\/([^/]+)$/)
    if (notifications) {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS })
      const deviceId = decodeURIComponent(notifications[1])
      return json(await getNotificationsForDevice(cfg, deviceId), CORS)
    }
    /* بند 10 (تدقيق 2026-10-08): إيصال قراءة تنبيه المطوّر.
       كتابة عامة محدودة الأثر: تُقبل فقط لمعرّف جهاز بصيغة SHOP-… ومعرّف تنبيه
       موجود فعلاً، ومرة واحدة لكل جهاز (قائمة لا مخزن، سقفها 1000). */
    const ackRoute = url.pathname.match(/^\/notifications\/([^/]+)\/ack$/)
    if (ackRoute) {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })
      let payload
      try { payload = JSON.parse(await request.text()) } catch { return json({ ok: false }, CORS, 400) }
      const deviceId = typeof payload?.deviceId === 'string' ? payload.deviceId : ''
      const result = await recordNoticeAck(cfg, decodeURIComponent(ackRoute[1]), deviceId)
      return json({ ok: result.ok, ...(result.count !== undefined ? { count: result.count } : {}) }, CORS, result.ok ? 200 : 400)
    }

    const sub = url.pathname.match(/^\/subscription\/([^/]+)$/)
    if (sub) {
      const state = await cfg.kv.get(`dev:${decodeURIComponent(sub[1])}`)
      if (!state) return json({ plan: '', expiresAt: null, message: '' }, CORS)
      const o = JSON.parse(state)
      return json({ plan: o.plan ?? '', expiresAt: o.expiresAt ?? null, message: o.message ?? '' }, CORS)
    }

    /* بند 2 (تدقيق 2026-10-08): بلاغ تسجيل عميل جديد — نقطة كتابة عامة محدودة
       الأثر (بلاغ واحد لكل جهاز، حد حجم، تعقيم كامل، ولا تكشف أي بيانات).
       الفشل لا يهم العميل: التطبيق يرسل fire-and-forget ويعيد المحاولة لاحقاً. */
    if (url.pathname === '/register') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })
      /* حدّ الحجم على خطوتين: ترويسة content-length إن وُجدت (رفض رخيص)، ثم
         طول النص الخام نفسه — فلا نعتمد على ترويسة قد لا يرسلها العميل، ولا
         نُحلّل JSON ضخماً (استهلاك CPU) قبل التأكد من الحجم. */
      if (Number(request.headers.get('content-length') ?? 0) > REG_MAX_BYTES) {
        return json({ ok: false, error: 'payload too large' }, CORS, 413)
      }
      const rawText = await request.text()
      if (rawText.length > REG_MAX_BYTES) return json({ ok: false, error: 'payload too large' }, CORS, 413)
      let raw
      try { raw = JSON.parse(rawText) } catch { return json({ ok: false, error: 'bad json' }, CORS, 400) }
      const report = sanitizeRegistration(raw)
      if (!report) return json({ ok: false, error: 'bad device id' }, CORS, 400)
      const { isNew, record } = await saveRegistration(cfg, report)
      /* التبليغ للمطوّر عند أول بلاغ للجهاز فقط — لا إزعاج متكرر */
      if (isNew && cfg.token && cfg.adminId) {
        try { await sendTelegram(cfg, cfg.adminId, formatRegistrationAr(record)) } catch { /* التبليغ تحسين */ }
      }
      return json({ ok: true, isNew }, CORS)
    }

    /* webhook تليجرام — محمي بالتوكن السري في المسار + رأس X-Telegram-Bot-Api-Secret-Token */
    const hook = url.pathname.match(/^\/telegram\/([A-Za-z0-9_-]+)$/)
    if (hook) {
      if (!cfg.webhookSecret || hook[1] !== cfg.webhookSecret) return new Response('not found', { status: 404 })
      if (request.headers.get('x-telegram-bot-api-secret-token') !== cfg.webhookSecret) return new Response('forbidden', { status: 403 })
      const update = await request.json()
      const reply = await handleUpdate(update, cfg)
      if (reply) await sendTelegram(cfg, reply.chatId, reply.text, reply.opts)
      return new Response('ok')
    }

    return new Response('shopsys-control', { status: 200, headers: CORS })
  },

  /**
   * التذكير اليومي بالاشتراكات (بند 3+4 من تدقيق 2026-10-08):
   * يصل المطوّر على التليجرام بلا أمر — يُفعَّل بـ[triggers] crons في wrangler.toml.
   *
   * قاعدتان ضد الإزعاج والتكرار:
   *   • لا منتهية ولا موشكة ⇒ لا رسالة إطلاقاً (لا إشعار يومي فارغ).
   *   • علامة `digest-sent:<اليوم>` في KV ⇒ لا تكرار لو أُطلق الـcron أكثر من مرة.
   */
  async scheduled(_event, env) {
    const cfg = env_(env)
    if (!cfg.token || !cfg.adminId) return // بلا أسرار ⇒ لا محاولة إرسال
    const day = new Date().toISOString().slice(0, 10)
    try {
      if (await cfg.kv.get(digestMarkerKey(day))) return
      const digest = await subscriptionDigest(cfg, { soonDays: await readSoonDays(cfg) })
      if (!hasDigestNews(digest)) return
      await sendTelegram(cfg, cfg.adminId, formatDigestAr(digest, { daily: true }))
      // 25 ساعة: تغطي فرق المنطقة الزمنية بين تشغيلين ولا تمنع تذكير الغد
      await cfg.kv.put(digestMarkerKey(day), new Date().toISOString(), { expirationTtl: 90_000 })
    } catch (err) {
      /* لا فشل صامت: التذكير اليومي هو غاية بندي 3 و4، فلو انهار (حدّ النداءات
         الفرعية في الخطة المجانية، عطل KV…) يجب أن يعرف المطوّر في يومه. */
      try {
        await sendTelegram(cfg, cfg.adminId, `⚠️ فشل تذكير الاشتراكات اليومي (${day}): ${(err && err.message) || err}`)
      } catch { /* حتى الإبلاغ عن الفشل تحسين — لا يعطّل العامل */ }
    }
  },
}

/* status اختياري (بند 2: رفض 400/413 لنقطة /register) — الافتراضي 200 كما كان */
const json = (body, headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, status = 200) =>
  new Response(typeof body === 'string' ? JSON.stringify({ text: body }) : JSON.stringify(body), { headers, status })

/* ═══════════ بوت تليجرام ═══════════ */

async function sendTelegram(cfg, chatId, text, opts = {}) {
  await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...opts }),
  })
}

/* v1.0.8 (طلب المالك): سجل لكل جهاز — التفعيل/التجديد/تغيير النشاط — append بحد 200 حدث */
async function appendDeviceLog(cfg, deviceId, text) {
  if (!deviceId) return
  const key = `log:${deviceId}`
  let log = []
  try { log = JSON.parse((await cfg.kv.get(key)) ?? '[]') } catch { log = [] }
  log.push({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), text })
  await cfg.kv.put(key, JSON.stringify(log.slice(-200)))
}

/* ═══════════ بند 1: جسر قناة الدعم ═══════════
 * كل ما يخص محادثات الدعم (التخزين، HMAC، تحديد المعدل) باقٍ في عامل
 * `cloud/worker.js` كما هو — لا نقل بيانات ولا تغيير في العميل. هنا فقط:
 * تحويل ردود المطوّر على تليجرام، وقراءة الصندوق/المحادثة، والرد من اللوحة.
 * أي فشل ⇒ رسالة عربية واضحة للمطوّر، ولا استثناء يوقف البوت. */
const SUPPORT_DEVICE_RE = /^[A-Za-z0-9_-]{6,64}$/

function formatSupportInboxAr(conversations, truncated = 0) {
  if (!conversations?.length) return '💬 لا محادثات دعم بعد — يظهر هنا كل عميل راسلك من «الدعم الفني» داخل التطبيق.'
  const lines = ['💬 <b>محادثات الدعم</b>', '']
  for (const c of conversations.slice(0, 15)) {
    const flag = c.awaitingReply ? '🔴 بانتظار ردك' : '⚪ آخر رسالة ردك'
    lines.push(`${flag} · <code>${c.deviceId}</code> · ${String(c.lastAt ?? '').slice(0, 16).replace('T', ' ')}`)
    lines.push(`   ${String(c.lastText ?? '').slice(0, 120)}`)
  }
  if (conversations.length > 15) lines.push(`\n… و${conversations.length - 15} محادثات أخرى`)
  if (Number(truncated) > 0) lines.push(`\n⚠️ ${truncated} محادثة قديمة بلا فهرس لم تُعرض في هذه الدورة (حدّ النداءات) — تُفهرس تلقائياً عند أول رسالة جديدة فيها.`)
  lines.push('')
  lines.push('💡 للرد: <code>/رد SHOP-XXXX-XXXX-XXXX نص الرد</code> — أو Reply على رسالة البلاغ نفسها.')
  return lines.join('\n')
}

function formatSupportThreadAr(deviceId, messages) {
  if (!messages?.length) return `لا رسائل في محادثة <code>${deviceId}</code>.`
  const lines = [`💬 <b>محادثة</b> <code>${deviceId}</code>`, '']
  for (const m of messages.slice(-15)) {
    const who = m.from === 'developer' ? '🧑‍💻 أنت' : '👤 العميل'
    lines.push(`${who} · ${String(m.at ?? '').slice(0, 16).replace('T', ' ')}\n${String(m.text ?? '').slice(0, 600)}`)
    lines.push('')
  }
  lines.push(`↩️ للرد: <code>/رد ${deviceId} نص الرد</code>`)
  return lines.join('\n').trim()
}

async function handleUpdate(update, cfg) {
  const callback = update.callback_query
  const msg = update.message ?? callback?.message
  if (!msg) return null
  const chatId = msg.chat?.id
  if (!chatId) return null
  // حصر كل أدوات الإدارة بمعرّف المطوّر وحده — أي معرّف آخر يُتجاهل صمتاً.
  const actorId = callback?.from?.id ?? update.message?.from?.id ?? msg.from?.id
  if (!cfg.adminId || String(actorId) !== cfg.adminId) {
    if (callback) await acknowledgePanelCallback(cfg.token, callback.id)
    return null
  }
  if (callback) {
    await acknowledgePanelCallback(cfg.token, callback.id)
    try { return await handlePanelButton(callback.data, chatId, cfg) }
    catch (error) { return { chatId, text: `تعذّر تنفيذ الاختيار: ${error.message}` } }
  }
  if (typeof msg.text !== 'string') return null
  const text = msg.text.trim()
  if (['/start', '/بدء', '/مساعدة'].includes(text)) return panelHome(chatId)
  try {
    const flowReply = await handlePanelText(text, chatId, cfg)
    if (flowReply) return flowReply
  } catch (error) {
    return { chatId, text: `تعذّر إكمال الخطوة: ${error.message}` }
  }

  const [cmd, ...args] = text.split(/\s+/)
  const arg = (i) => (args[i] ?? '').trim()

  /* بند 1: رسالة Reply على بلاغ دعم ⇒ تحويلها للجسر لتصل العميل داخل التطبيق.
     ويبهوك البوت واحد فقط، وهو هنا على مركز التحكم — فبدون هذا التحويل كان رد
     المطوّر يُعامل أمراً مجهولاً ولا يصل العميل إطلاقاً. */
  const replyToId = msg.reply_to_message?.message_id
  if (replyToId && !text.startsWith('/')) {
    const bridged = await supportBridge(cfg, 'telegram-reply', { messageId: String(replyToId), text })
    if (bridged.ok) return { chatId, text: `✅ وصل ردك للعميل <code>${bridged.deviceId}</code> داخل التطبيق.` }
    if (String(bridged.error) === 'unknown message') {
      return { chatId, text: 'ℹ️ هذه الرسالة ليست بلاغ دعم معروف — الرد عليها لا يصل لأي عميل.\n(بلاغات الدعم تحتفظ بربطها 30 يوماً)' }
    }
    return { chatId, text: `⚠️ تعذّر إيصال الرد: ${bridged.error}` }
  }

  try {
    switch (cmd) {
      case '/start': case '/بدء': case '/مساعدة': return { chatId, text: HELP }

      /* v1.0.8: لوحة متطورة — العملاء، ربط بريد بفحص تكرار، سجل جهاز */
      case '/عملاء': case '/customers': {
        const list = await cfg.kv.list({ prefix: 'dev:' })
        if (!list.keys.length) return { chatId, text: 'لا عملاء مسجلين بعد' }
        const lines = []
        for (const k of list.keys.slice(0, 100)) {
          const raw = await cfg.kv.get(k.name)
          if (!raw) continue
          const d = JSON.parse(raw)
          lines.push(`• <code>${k.name.slice(4)}</code> — ${d.customer ?? '؟'} · ${d.plan ?? '؟'} · حتى ${d.expiresAt ?? 'الحياة'}${d.email ? ` · ${d.email}` : ''}`)
        }
        return { chatId, text: `👥 <b>العملاء (${lines.length})</b>\n${lines.join('\n')}` }
      }

      case '/عميل': case '/customer': {
        // /عميل <deviceId> <بريد> — ربط البريد بالجهاز مع منع تكرار البريد بين الأجهزة
        const [deviceId, email] = args
        if (!deviceId || !email || !/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId)) {
          return { chatId, text: '⚠️ الصيغة: <code>/عميل SHOP-XXXX-XXXX-XXXX email@example.com</code>' }
        }
        const mail = email.toLowerCase().trim()
        const existing = await cfg.kv.get(`email:${mail}`)
        if (existing && existing !== deviceId) {
          return { chatId, text: `⚠️ البريد <code>${mail}</code> مسجل بالفعل للجهاز <code>${existing}</code> — لا تكرار: عميل واحد ببريد واحد` }
        }
        const raw = await cfg.kv.get(`dev:${deviceId}`)
        if (!raw) return { chatId, text: `⚠️ الجهاز <code>${deviceId}</code> غير مشترك — أصدر له مفتاحاً أولاً` }
        const d = JSON.parse(raw)
        d.email = mail
        /* metadata = فهرس التذكير اليومي (انظر subscriptions.js) — تُكتب مع كل
           تعديل على سجل الجهاز فلا يحتاج الـcron قراءة السجل كاملاً */
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(d), { metadata: deviceMetadata(d) })
        await cfg.kv.put(`email:${mail}`, deviceId)
        await appendDeviceLog(cfg, deviceId, `ربط البريد ${mail}`)
        return { chatId, text: `✅ رُبط <code>${deviceId}</code> (${d.customer ?? '؟'}) بالبريد ${mail}` }
      }

      case '/سجل': case '/log': {
        const deviceId = arg(0)
        if (!deviceId || !/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId)) {
          return { chatId, text: '⚠️ الصيغة: <code>/سجل SHOP-XXXX-XXXX-XXXX</code>' }
        }
        const raw = await cfg.kv.get(`log:${deviceId}`)
        if (!raw) return { chatId, text: 'لا سجل لهذا الجهاز بعد' }
        const log = JSON.parse(raw)
        return { chatId, text: `📋 <b>سجل ${deviceId}</b>\n${log.map((e) => `${e.at} — ${e.text}`).join('\n')}` }
      }

      /* v1.0.7 (موافقة المالك): مفتاح تغيير نشاط لعميل محدد — التغيير في
         التطبيق يتم بهذا المفتاح الموقّع فقط، والمستخدم لا يغيّر نشاطه بنفسه.
         /مفتاح_نشاط <deviceId> <من النشاط> <إلى النشاط> */
      case '/مفتاح_نشاط': case '/change_activity': {
        const [deviceId, fromId, toId] = args
        if (!deviceId || !fromId || !toId) return { chatId, text: '⚠️ الصيغة: <code>/مفتاح_نشاط SHOP-XXXX-XXXX-XXXX من_النشاط إلى_النشاط</code>\nمعرّفات الأنشطة مثل: <code>grocery · clinic · contracting · laundry …</code>' }
        if (!/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId)) return { chatId, text: `⚠️ معرّف الجهاز غير صحيح: <code>${deviceId}</code>` }
        if (fromId === toId) return { chatId, text: '⚠️ النشاطان متطابقان — لا حاجة لمفتاح' }
        const sub = await cfg.kv.get(`dev:${deviceId}`)
        if (!sub) return { chatId, text: `⚠️ الجهاز <code>${deviceId}</code> غير مشترك — لا تسجيل له في المركز` }
        const payload = { v: 1, deviceId, fromActivityId: fromId, toActivityId: toId, issuedAt: new Date().toISOString().slice(0, 10) }
        const key = await issueActivityChangeKey(payload, cfg.priv)
        const fp = keyFingerprint(key)
        await cfg.kv.put(`actkey:${fp}`, JSON.stringify({ payload, issuedAt: payload.issuedAt }))
        await appendDeviceLog(cfg, deviceId, `تغيير النشاط: ${fromId} ← ${toId}`)
        return {
          chatId,
          text: [
            `✅ <b>مفتاح تغيير النشاط</b> — ${deviceId}`,
            `من <code>${fromId}</code> إلى <code>${toId}</code>`,
            '',
            `<code>${key}</code>`,
            '',
            'أرسله للعميل ليلصقه في: الإعدادات العامة ← النشاط ← «تغيير النشاط بمفتاح الدعم».',
            'التطبيق يتحقق: التوقيع + الجهاز + النشاط الحالي، ويطبق التغيير مرة كل 30 يوماً.',
          ].join('\n'),
        }
      }

      case '/اصدر': {
        // /اصدر <deviceId> <خطة> <اسم العميل> [أيام] [نشاط] [+مستخدمون] [+فروع] [+ميزات] [وحدات=...]
        const [deviceId, plan, customer, daysRaw, activityId, extraUsersRaw, extraBranchesRaw, featuresRaw, modulesRaw] = args
        if (!deviceId || !plan || !customer) return { chatId, text: '⚠️ الصيغة: <code>/اصدر SHOP-XXXX-XXXX-XXXX basic «اسم المحل» 365 [نشاط] [+مستخدمون] [+فروع] [+ميزات] [وحدات=قائمة بفواصل]</code>' }
        if (!/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId)) return { chatId, text: `⚠️ معرّف الجهاز غير صحيح: <code>${deviceId}</code> — يظهر للعميل في شاشة التفعيل` }
        if (!PLANS.has(plan)) return { chatId, text: `⚠️ الخطة من: ${[...PLANS].join(' / ')}` }
        const days = plan === 'lifetime' ? 0 : Math.max(1, Number(daysRaw) || 365)
        const extraUsers = Number(extraUsersRaw?.replace('+', '')) > 0 ? Number(extraUsersRaw.replace('+', '')) : undefined
        const extraBranches = Number(extraBranchesRaw?.replace('+', '')) > 0 ? Number(extraBranchesRaw.replace('+', '')) : undefined
        const features = (featuresRaw ?? '').split(',').map((f) => f.trim()).filter((f) => f && FEATURES.has(f))
        // v1.0.10: منح أقسام إضافية خارج النشاط (extraModules موقّعة — القناة الوحيدة المعتمدة بالعقد)
        const modulesArg = modulesRaw?.startsWith('وحدات=') ? modulesRaw.slice(5) : modulesRaw
        const extraModules = (modulesArg ?? '').split(',').map((m) => m.trim()).filter((m) => m && MODULES.has(m))
        const invalidModules = (modulesArg ?? '').split(',').map((m) => m.trim()).filter((m) => m && !MODULES.has(m))
        if (invalidModules.length) return { chatId, text: `⚠️ وحدات غير معروفة: <code>${invalidModules.join(', ')}</code> — المتاح: <code>${[...MODULES].join(', ')}</code>` }
        const payload = {
          v: 1, deviceId, customer: customer.replace(/[«»]/g, ''), plan,
          features, issuedAt: new Date().toISOString().slice(0, 10),
          expiresAt: expiresAfterDays(days),
          ...(extraUsers != null ? { extraUsers } : {}), ...(extraBranches != null ? { extraBranches } : {}),
          ...(activityId ? { activityId } : {}),
          ...(extraModules.length ? { extraModules } : {}),
        }
        const key = await issueLicenseKey(payload, cfg.priv)
        const fp = keyFingerprint(key)
        await cfg.kv.put(`lic:${fp}`, JSON.stringify({ payload, key, issuedAt: payload.issuedAt, revoked: false }))
        const deviceRecord = {
          plan, expiresAt: payload.expiresAt, customer: payload.customer, message: '', fingerprint: fp,
        }
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(deviceRecord), { metadata: deviceMetadata(deviceRecord) })
        await appendDeviceLog(cfg, deviceId, `تفعيل ${plan} حتى ${payload.expiresAt ?? 'الحياة'} — ${payload.customer}${extraModules.length ? ` +وحدات ${extraModules.join(',')}` : ''}`)
        return {
          chatId,
          text: [
            `✅ <b>مفتاح تفعيل ${plan === 'lifetime' ? 'مدى الحياة' : `صالح ${days} يوماً`}</b> — ${payload.customer}`,
            `🎬 النشاط: ${activityId || 'أي نشاط'}`,
            '',
            `<code>${key}</code>`,
            '',
            `🔑 البصمة: <code>${fp}</code> (للحرق لاحقاً)`,
            `⏱️ الانتهاء: ${payload.expiresAt ?? 'مدى الحياة'}`,
            extraUsers ? `👥 مستخدمون إضافيون: ${extraUsers}` : '', extraBranches ? `🏬 فروع إضافية: ${extraBranches}` : '',
            extraModules.length ? `🧩 أقسام ممنوحة خارج النشاط: ${extraModules.join('، ')}` : '',
          ].filter(Boolean).join('\n'),
        }
      }

      case '/حرق': {
        const target = arg(0)
        if (!target) return { chatId, text: '⚠️ الصيغة: <code>/حرق SHOP-...</code> أو <code>/حرق بصمة</code>' }
        let fp = /^[0-9a-f]{8}$/.test(target) ? target : null
        if (!fp) { try { fp = keyFingerprint(target) } catch { /* ليست بصمة ولا مفتاحاً */ } }
        if (!fp) return { chatId, text: '⚠️ أدخل مفتاحاً كاملاً أو بصمة 8 خانات' }
        const list = JSON.parse((await cfg.kv.get('revoked')) ?? '[]')
        if (list.includes(fp)) return { chatId, text: `ℹ️ البصمة <code>${fp}</code> محروقة سابقاً` }
        list.push(fp)
        await cfg.kv.put('revoked', JSON.stringify(list))
        const rec = await cfg.kv.get(`lic:${fp}`)
        if (rec) { const o = JSON.parse(rec); o.revoked = true; await cfg.kv.put(`lic:${fp}`, JSON.stringify(o)) }
        return { chatId, text: `🔥 حُرق المفتاح <code>${fp}</code> وأُضيف لقائمة الإبطال — لن يعمل عند أي عميل بعد أول مزامنة` }
      }

      case '/بحث': {
        const target = arg(0)
        if (!target) return { chatId, text: '⚠️ الصيغة: <code>/بحث SHOP-...</code> أو <code>/بحث بصمة</code>' }
        const fp = /^[0-9a-f]{8}$/.test(target) ? target : keyFingerprint(target)
        const rec = await cfg.kv.get(`lic:${fp}`)
        if (!rec) return { chatId, text: `ℹ️ لا سجل للبصمة <code>${fp}</code>` }
        const o = JSON.parse(rec)
        const revoked = JSON.parse((await cfg.kv.get('revoked')) ?? '[]').includes(fp)
        return {
          chatId,
          text: [
            `🔍 <b>${o.payload.customer}</b> — ${o.payload.plan}`,
            `🎬 الجهاز: <code>${o.payload.deviceId}</code>${o.payload.activityId ? ` · النشاط: ${o.payload.activityId}` : ''}`,
            `📅 صدر ${o.payload.issuedAt} · ينتهي ${o.payload.expiresAt ?? 'مدى الحياة'}`,
            o.revoked || revoked ? '🔥 <b>محروق</b>' : '✅ سليم',
            o.payload.extraUsers ? `👥 +${o.payload.extraUsers} مستخدمين` : '', o.payload.extraBranches ? `🏬 +${o.payload.extraBranches} فروع` : '',
            '', `<code>${o.key}</code>`,
          ].filter(Boolean).join('\n'),
        }
      }

      case '/رسالة': {
        // /رسالة <deviceId> <نص...>
        const deviceId = arg(0)
        const text = args.slice(1).join(' ')
        if (!deviceId || !text) return { chatId, text: '⚠️ الصيغة: <code>/رسالة SHOP-... نص الرسالة</code> — تظهر للعميل في شاشة «حول»' }
        const state = JSON.parse((await cfg.kv.get(`dev:${deviceId}`)) ?? '{}')
        state.message = text
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(state), { metadata: deviceMetadata(state) })
        return { chatId, text: `📨 سُجّلت رسالة لجهاز <code>${deviceId}</code>: «${text}»` }
      }

      case '/حول': {
        const text = args.join(' ')
        if (!text) {
          return { chatId, text: '⚠️ الصيغة: <code>/حول النص...</code> — النص التعريفي لكل العملاء («/حول مسح» يعيده للافتراضي).\nبيانات التواصل (هاتف/واتساب/تليجرام/بريد/موقع/عنوان) والحقول الحرة تُضبط من اللوحة: زر «📝 صفحة «حول» والتواصل».' }
        }
        /* بند 9: يُدمج في المستند المنظّم — كان الكتابة الخام هنا تمسح كل حقول
           التواصل التي ضبطها المطوّر من اللوحة. */
        const res = await setAboutField(cfg, 'body', text === 'مسح' ? '' : text)
        if (!res.ok) return { chatId, text: `⚠️ ${res.reasonAr}` }
        return { chatId, text: text === 'مسح' ? '🧹 أُعيد نص «حول» إلى الافتراضي ✓' : '📝 حُدّث نص «حول» ✓ (حقول التواصل لم تُمسّ)' }
      }

      /* بند 3+4 (تدقيق 2026-10-08): تنبيهات الانتهاء وقرب الانتهاء —
         تقرأ `dev:*` (المصدر الحقيقي لهذا المركز)، بخلاف العامل الآخر. */
      case '/تذكير': case '/reminder': {
        const asked = Number(arg(0))
        const soonDays = Number.isInteger(asked) && asked >= 1 && asked <= 90 ? asked : await readSoonDays(cfg)
        const digest = await subscriptionDigest(cfg, { soonDays })
        return { chatId, text: formatDigestAr(digest) }
      }

      case '/احصائيات': case '/إحصائيات': case '/stats': {
        const [digest, revokedRaw, licList, globalNotices] = await Promise.all([
          subscriptionDigest(cfg, { soonDays: await readSoonDays(cfg) }),
          cfg.kv.get('revoked'),
          cfg.kv.list({ prefix: 'lic:', limit: 1000 }),
          cfg.kv.get('notices:global'),
        ])
        let revoked = 0
        try { const parsed = JSON.parse(revokedRaw ?? '[]'); revoked = Array.isArray(parsed) ? parsed.length : 0 } catch { revoked = 0 }
        let notices = 0
        try {
          const parsed = JSON.parse(globalNotices ?? '[]')
          const now = Date.now()
          notices = Array.isArray(parsed) ? parsed.filter((n) => n?.body && (!n.expiresAt || Date.parse(n.expiresAt) > now)).length : 0
        } catch { notices = 0 }
        return {
          chatId,
          text: formatStatsAr(digest, { revoked, licenses: licList.keys?.length ?? 0, notices }),
        }
      }

      case '/اشتراكات': {
        const list = await cfg.kv.list({ prefix: 'dev:' })
        if (list.keys.length === 0) return { chatId, text: 'ℹ️ لا أجهزة مسجلة بعد' }
        const rows = []
        for (const k of list.keys.slice(0, 50)) {
          const o = JSON.parse((await cfg.kv.get(k.name)) ?? '{}')
          rows.push(`• ${o.customer ?? ''} — ${o.plan ?? ''} · ${o.expiresAt ?? 'مدى الحياة'}${o.message ? ' 📨' : ''}`)
        }
        return { chatId, text: `📋 <b>الأجهزة (${list.keys.length})</b>\n${rows.join('\n')}` }
      }

      /* بند 10: التنبيهات المرسلة وعدد من أقرّ بقراءتها */
      case '/تنبيهات': case '/notices':
        return noticeListReply(cfg, chatId)

      /* بند 2: كل بلاغات التسجيل الجديد (العملاء الذين أكملوا معالج أول التشغيل) */
      case '/تسجيلات': case '/registrations': {
        const { records, skipped } = await listRegistrations(cfg)
        return { chatId, text: formatRegistrationsAr(records, { skipped }) }
      }

      /* حق الحذف في سياسة الخصوصية (وعد بالاستجابة خلال 30 يوماً) — هذه أداته:
         تحذف سجل بلاغ التسجيل `reg:<deviceId>` من المركز نهائياً. */
      case '/احذف': case '/حذف': case '/delete': {
        const result = await deleteRegistration(cfg, arg(0))
        if (!result.ok) return { chatId, text: `⚠️ ${result.reasonAr}` }
        return {
          chatId,
          text: result.existed
            ? `🗑️ حُذف سجل التسجيل للجهاز <code>${result.deviceId}</code> من المركز.\n(سجل الترخيص <code>dev:</code> لم يُمسّ — لحذفه استخدم <code>/حرق</code>.)`
            : `ℹ️ لا سجل تسجيل للجهاز <code>${result.deviceId}</code> — لا شيء لحذفه.`,
        }
      }

      /* بند 1: صندوق الدعم والمحادثة والرد — عبر الجسر إلى عامل قناة الدعم */
      case '/دعم': case '/support': {
        const target = arg(0)
        if (target) {
          if (!SUPPORT_DEVICE_RE.test(target)) return { chatId, text: '⚠️ معرّف الجهاز غير صالح. الصيغة: <code>/دعم SHOP-XXXX-XXXX-XXXX</code>' }
          const thread = await supportBridge(cfg, 'thread', { deviceId: target })
          if (!thread.ok) return { chatId, text: `⚠️ ${thread.error}` }
          return { chatId, text: formatSupportThreadAr(target, thread.messages) }
        }
        const inbox = await supportBridge(cfg, 'inbox')
        if (!inbox.ok) return { chatId, text: `⚠️ ${inbox.error}` }
        return { chatId, text: formatSupportInboxAr(inbox.conversations, inbox.truncated) }
      }

      case '/رد': case '/reply': {
        const deviceId = arg(0)
        const replyText = args.slice(1).join(' ')
        if (!deviceId || !replyText) return { chatId, text: '⚠️ الصيغة: <code>/رد SHOP-XXXX-XXXX-XXXX نص الرد</code>' }
        if (!SUPPORT_DEVICE_RE.test(deviceId)) return { chatId, text: '⚠️ معرّف الجهاز غير صالح.' }
        const result = await supportBridge(cfg, 'reply', { deviceId, text: replyText })
        if (!result.ok) return { chatId, text: `⚠️ تعذّر إرسال الرد: ${result.error}` }
        return { chatId, text: `✅ أُرسل الرد إلى <code>${deviceId}</code> — يظهر للعميل في «الدعم الفني» خلال 30 ثانية.` }
      }

      default:
        return { chatId, text: `أمر غير معروف — أرسل /مساعدة لعرض الأوامر` }
    }
  } catch (e) {
    return { chatId, text: `❌ خطأ: ${e.message}` }
  }
}

const HELP = [
  '🤖 <b>بوت تحكم المطوّر — تَحَكَّم</b>',
  '',
  '<code>/اصدر SHOP-XXXX-XXXX-XXXX basic اسم_المحل 365 grocery +2 +1 telegram_bot,cloud_sync</code>',
  '— إصدار/تجديد مفتاح: معرّف الجهاز (عند العميل في شاشة التفعيل) · الخطة trial/basic/pro/lifetime · الأيام (0 = مدى الحياة، الافتراضي 365) · معرّف النشاط اختياري (قصر المفتاح عليه) · +مستخدمون · +فروع · ميزات بفواصل',
  '',
  '<code>/حرق مفتاح-أو-بصمة</code> — إبطال نهائي (قائمة الإبطال السحابية)',
  '<code>/بحث مفتاح-أو-بصمة</code> — بيانات المفتاح وحالته',
  '<code>/رسالة SHOP-... نص</code> — رسالة للعميل تظهر في «حول»',
  '<code>/حول نص</code> — النص التعريفي في «حول» (مسح للافتراضي) — بيانات التواصل من اللوحة',
  '<code>/اشتراكات</code> — كل الأجهزة المسجلة',
  '<code>/تسجيلات</code> — العملاء الجدد الذين أكملوا التسجيل (يصلك كل واحد تلقائياً)',
  '<code>/احذف SHOP-…</code> — حذف سجل تسجيل عميل (طلب حذف بياناته)',
  '<code>/تنبيهات</code> — التنبيهات المرسلة وعدد إقرارات القراءة',
  '<code>/دعم</code> — محادثات الدعم (بانتظار ردك أولاً) · <code>/دعم SHOP-…</code> محادثة جهاز',
  '<code>/رد SHOP-… نص</code> — رد يصل العميل داخل التطبيق (أو Reply على بلاغ الدعم)',
  '<code>/تذكير [أيام]</code> — المنتهية والموشكة على الانتهاء (الافتراضي 10 أيام)',
  '<code>/احصائيات</code> — عدد الأجهزة والمنتهية والمحروق والتنبيهات',
  '',
  '⏰ يصلك تذكير يومي تلقائي بلا أمر (cron) — ولا رسالة في يوم بلا منتهية ولا موشكة.',
].join('\n')
