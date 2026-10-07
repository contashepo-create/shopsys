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
import { acknowledgePanelCallback, getNotificationsForDevice, handlePanelButton, handlePanelText, panelHome } from './adminPanel.js'

/* ═══════════ إعدادات البيئة (secrets + vars) ═══════════ */
const env_ = env => ({
  token: env.TELEGRAM_BOT_TOKEN,
  adminId: String(env.TELEGRAM_ADMIN_ID ?? ''),
  priv: env.DEV_PRIVATE_KEY_B64U,
  webhookSecret: env.WEBHOOK_SECRET,
  kv: env.SHOPSYS_CONTROL,
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
      const fallback = {
        title: 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
        body: 'نظام عربي متكامل للمبيعات والمخازن والحسابات العامة — يعمل بلا إنترنت.',
        supportPhone: '', supportTelegram: '', website: '', updatedAt: new Date().toISOString(),
      }
      const raw = await cfg.kv.get('about')
      if (!raw) return json(fallback, CORS)
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return json({ ...fallback, ...parsed }, CORS)
        }
      } catch { /* الأمر /حول يحفظ نصاً عادياً، فيُعرض داخل body */ }
      return json({ ...fallback, body: raw }, CORS)
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
    const sub = url.pathname.match(/^\/subscription\/([^/]+)$/)
    if (sub) {
      const state = await cfg.kv.get(`dev:${decodeURIComponent(sub[1])}`)
      if (!state) return json({ plan: '', expiresAt: null, message: '' }, CORS)
      const o = JSON.parse(state)
      return json({ plan: o.plan ?? '', expiresAt: o.expiresAt ?? null, message: o.message ?? '' }, CORS)
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
}

const json = (body, headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }) =>
  new Response(typeof body === 'string' ? JSON.stringify({ text: body }) : JSON.stringify(body), { headers })

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
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(d))
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
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify({
          plan, expiresAt: payload.expiresAt, customer: payload.customer, message: '', fingerprint: fp,
        }))
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
        await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(state))
        return { chatId, text: `📨 سُجّلت رسالة لجهاز <code>${deviceId}</code>: «${text}»` }
      }

      case '/حول': {
        const text = args.join(' ')
        if (!text) return { chatId, text: '⚠️ الصيغة: <code>/حول النص...</code> — يظهر لكل العملاء في «حول» (أرسل «/حول مسح» للتفريغ)' }
        await cfg.kv.put('about', text === 'مسح' ? '' : text)
        return { chatId, text: text === 'مسح' ? '🧹 فُرّغ نص «حول» السحابي' : '📝 حُدّث نص «حول» السحابي ✓' }
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
  '<code>/حول نص</code> — محتوى «حول» لكل العملاء (مسح للتفريغ)',
  '<code>/اشتراكات</code> — كل الأجهزة المسجلة',
].join('\n')
