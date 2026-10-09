import { issueLicenseKey, keyFingerprint, expiresAfterDays } from './licenseLib.js'
import { subscriptionDigest, formatDigestAr, formatStatsAr, readSoonDays, writeSoonDays, deviceMetadata, DEVICE_META_VERSION, DIGEST_MAX_READS, SOON_DAYS } from './subscriptions.js'
import {
  ABOUT_FIELDS, readAbout, setAboutField, addAboutExtraField, removeAboutExtraField,
  addAboutSocialLink, removeAboutSocialLink, previewAboutAr,
} from './aboutContent.js'
import { listRegistrations, formatRegistrationDetailAr, deleteRegistration, regKey, REG_LIST_SHOWN } from './registrations.js'
import { supportBridge } from './supportBridge.js'
import { tgEscape } from './tgHtml.js'

const PLANS = ['trial', 'basic', 'pro', 'lifetime']
const PLAN_LABELS = { trial: 'تجريبي', basic: 'أساسي', pro: 'احترافي', lifetime: 'مدى الحياة' }
const FEATURE_LABELS = {
  einvoice_eg: 'الفاتورة الإلكترونية المصرية',
  einvoice_sa: 'الفاتورة الإلكترونية السعودية',
  multi_branch: 'تعدد الفروع',
  telegram_bot: 'بوت تليجرام',
  cloud_sync: 'المزامنة السحابية',
  multi_user_lan: 'تعدد المستخدمين على الشبكة',
}
const MODULE_LABELS = {
  pos: 'نقطة البيع', inventory: 'المخزون', purchases: 'المشتريات', installments: 'الأقساط',
  recipes: 'الوصفات', processing: 'التصنيع', jewelry: 'الذهب والمجوهرات', maintenance: 'الصيانة',
  laundry: 'المغسلة', booking: 'الحجوزات', equipment_rental: 'تأجير المعدات', logistics: 'اللوجستيات',
  lab: 'المختبر', contracting: 'المقاولات', clinic: 'العيادة', cars: 'السيارات',
  wallet_services: 'الخدمات المالية', realestate: 'العقارات',
}
const GLOBAL_SETTINGS_KEY = 'settings:global'
const DEVICE_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const DEFAULT_SETTINGS = { plan: 'basic', days: 365, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] }

const button = (text, callback_data) => ({ text, callback_data })
const markup = (rows) => ({ inline_keyboard: rows })
const menuReply = (chatId, text, rows) => ({ chatId, text, opts: { reply_markup: markup(rows) } })
const mainRows = () => [
  [button('🆕 التسجيلات', 'panel:regs'), button('👥 العملاء', 'panel:clients')],
  [button('➕ إضافة عميل', 'panel:new')],
  [button('⏳ الاشتراكات', 'panel:digest'), button('📊 إحصائيات', 'panel:stats')],
  [button('⚙️ الإعداد العام', 'panel:global'), button('🔔 تنبيه للجميع', 'panel:notice:all')],
  [button('📬 التنبيهات المرسلة', 'panel:noticelist'), button('💬 الدعم', 'panel:support')],
  [button('📝 صفحة «حول» والتواصل', 'panel:about')],
]

function parseObject(raw, fallback = {}) {
  try {
    const value = JSON.parse(raw ?? '')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
  } catch { return fallback }
}

function cleanText(value, max = 1500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
}

function normalizedName(name) {
  return cleanText(name, 100).replace(/\s+/g, ' ').toLocaleLowerCase()
}

async function hashCustomerName(name) {
  const bytes = new TextEncoder().encode(normalizedName(name))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

function settingKey(customerHash) {
  return `settings:customer:${customerHash}`
}

function sanitizeSettings(raw, defaults = {}) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const out = { ...defaults }
  if (PLANS.includes(o.plan)) out.plan = o.plan
  if (Number.isInteger(o.days) && o.days >= 0 && o.days <= 3650) out.days = o.days
  if (Array.isArray(o.features)) out.features = [...new Set(o.features.filter((f) => Object.hasOwn(FEATURE_LABELS, f)))]
  if (Array.isArray(o.extraModules)) out.extraModules = [...new Set(o.extraModules.filter((m) => Object.hasOwn(MODULE_LABELS, m)))]
  for (const field of ['extraUsers', 'extraBranches']) {
    if (Number.isInteger(o[field]) && o[field] >= 0 && o[field] <= 99) out[field] = o[field]
  }
  return out
}

async function readGlobalSettings(cfg) {
  return sanitizeSettings(parseObject(await cfg.kv.get(GLOBAL_SETTINGS_KEY)), DEFAULT_SETTINGS)
}

async function writeGlobalSettings(cfg, patch) {
  const current = await readGlobalSettings(cfg)
  const next = sanitizeSettings({ ...current, ...patch }, DEFAULT_SETTINGS)
  await cfg.kv.put(GLOBAL_SETTINGS_KEY, JSON.stringify(next))
  return next
}

async function readCustomerSettings(cfg, name) {
  const hash = await hashCustomerName(name)
  const raw = parseObject(await cfg.kv.get(settingKey(hash)))
  return { hash, settings: sanitizeSettings(raw, {}) }
}

async function writeCustomerSettings(cfg, name, patch) {
  const { hash, settings } = await readCustomerSettings(cfg, name)
  const next = sanitizeSettings({ ...settings, ...patch }, {})
  await cfg.kv.put(settingKey(hash), JSON.stringify(next))
  return { hash, settings: next }
}

/* قائمة الأجهزة المرخّصة لتجميع العملاء. الفهرس (metadata) يكفي للاسم والخطة فلا
 * تُقرأ السجلات كلها: كانت اللوحة تقرأ كل `dev:` بـ`get` فتتجاوز حدّ الـ50 نداءً
 * الفرعي في الخطة المجانية عند نحو 48 جهازاً (الدرس نفسه في subscriptions.js).
 * السجل بلا فهرس يُقرأ بعدد محدود ثم يُفهرس في مكانه. */
async function listDevices(cfg) {
  const rows = []
  let skipped = 0
  let reads = 0
  let cursor
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await cfg.kv.list({ prefix: 'dev:', limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const key of page.keys ?? []) {
      const deviceId = key.name.slice(4)
      const meta = key.metadata
      if (meta && meta.v === DEVICE_META_VERSION && typeof meta.customer === 'string') {
        rows.push({ deviceId, customer: cleanText(meta.customer || 'عميل غير مسمى', 100), plan: meta.plan || null, expiresAt: meta.expiresAt ?? null })
        continue
      }
      if (reads >= DIGEST_MAX_READS) { skipped++; continue }
      reads++
      const raw = await cfg.kv.get(key.name)
      if (!raw) continue
      const value = parseObject(raw)
      rows.push({ ...value, deviceId, customer: cleanText(value.customer || 'عميل غير مسمى', 100) })
      /* فهرسة السجل وهو في مكانه (القيمة نفسها) — الدورة التالية تُقرأ من الفهرس */
      if (Object.keys(value).length > 0) {
        try { await cfg.kv.put(key.name, raw, { metadata: deviceMetadata(value) }) } catch { /* تحسين */ }
      }
    }
    if (page.list_complete || !page.cursor) break
    cursor = page.cursor
  }
  return { rows, skipped }
}

async function customerGroups(cfg) {
  const { rows, skipped } = await listDevices(cfg)
  const groups = new Map()
  for (const device of rows) {
    const normalized = normalizedName(device.customer)
    if (!normalized) continue
    const group = groups.get(normalized) ?? { name: device.customer, devices: [] }
    group.devices.push(device)
    groups.set(normalized, group)
  }
  const out = []
  for (const group of groups.values()) out.push({ ...group, hash: await hashCustomerName(group.name) })
  return { groups: out.sort((a, b) => a.name.localeCompare(b.name, 'ar')), skipped }
}

async function findCustomer(cfg, hash) {
  return (await customerGroups(cfg)).groups.find((group) => group.hash === hash) ?? null
}

async function getDevice(cfg, deviceId) {
  if (!DEVICE_RE.test(deviceId)) return null
  const raw = await cfg.kv.get(`dev:${deviceId}`)
  return raw ? { deviceId, ...parseObject(raw) } : null
}

async function currentLicense(cfg, device) {
  if (!device?.fingerprint) return null
  return parseObject(await cfg.kv.get(`lic:${device.fingerprint}`)).payload ?? null
}

function parseList(raw) {
  try {
    const value = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

export function panelHome(chatId, text = 'لوحة التحكم — اختر ما تريد تنفيذه:') {
  return menuReply(chatId, text, mainRows())
}

/* ─── بند 10: إقرارات القراءة ──────────────────────────────────────────────
 * العميل يضغط «تمّت القراءة» ⇒ POST /notifications/:id/ack ⇒ يُسجَّل معرف جهازه
 * هنا (مرة واحدة لكل جهاز). المطوّر يرى كم جهازاً قرأ التنبيه، فيعرف إن وصل.
 * السقف 1000 جهاز: قائمة لا مخزن — يكفي للإحصاء ولا ينمو للأبد. */
export const ACK_PREFIX = 'notice-acks:'

/** هل التنبيه موجود فعلاً (عام أو لهذا الجهاز)؟ — شرط قبل أي كتابة */
export async function noticeExists(cfg, noticeId, deviceId) {
  const id = cleanText(noticeId, 64)
  const device = cleanText(deviceId, 24).toUpperCase()
  if (!id) return false
  const keys = ['notices:global']
  if (/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device)) keys.push(`notices:${device}`)
  for (const key of keys) {
    const list = parseList(await cfg.kv.get(key))
    if (list.some((n) => n && n.id === id)) return true
  }
  return false
}

export async function recordNoticeAck(cfg, noticeId, deviceId) {
  const id = cleanText(noticeId, 64)
  const device = cleanText(deviceId, 24).toUpperCase()
  if (!id || !/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device)) return { ok: false, isNew: false }
  /* نقطة عامة بلا سرّ ⇒ بلا هذا الفحص تصير كتابةً مفتوحة تُنشئ مفاتيح
     `notice-acks:<معرّف عشوائي>` بلا حد (تلويث المساحة وكلفة كتابة) وتُضخّم
     إحصاء القراءات الذي يبني عليه المطوّر قراره. تكلفته نداءان نادران. */
  if (!(await noticeExists(cfg, id, device))) return { ok: false, isNew: false, reason: 'unknown notice' }
  const key = `${ACK_PREFIX}${id}`
  const seen = parseList(await cfg.kv.get(key)).filter((v) => typeof v === 'string')
  if (seen.includes(device)) return { ok: true, isNew: false, count: seen.length }
  seen.push(device)
  await cfg.kv.put(key, JSON.stringify(seen.slice(-1000)))
  return { ok: true, isNew: true, count: seen.length }
}

export async function ackCountForNotice(cfg, noticeId) {
  return parseList(await cfg.kv.get(`${ACK_PREFIX}${cleanText(noticeId, 64)}`)).filter((v) => typeof v === 'string').length
}

/* H2 (مراجعة 2026-10-09): الحد يُطبَّق **لكل درجة على حدة**. كان الحد 50 على القائمة
   كلها، فيُسقط تنبيه `critical` غير مقروء بمجرد تراكم 50 إعلاناً أحدث منه — ويتعطل وعد
   «إلزامي الإقرار». الآن الإعلانات (info) آخر 50، والمهم/العاجل آخر 100 — لا يُسقطهما
   تراكم الإعلانات. */
export const NOTICE_KEEP_INFO = 50
export const NOTICE_KEEP_URGENT = 100

const isUrgentNotice = (notice) => notice?.level === 'important' || notice?.level === 'critical'

export function capNotices(list) {
  const urgent = list.filter((n) => isUrgentNotice(n)).slice(-NOTICE_KEEP_URGENT)
  const info = list.filter((n) => !isUrgentNotice(n)).slice(-NOTICE_KEEP_INFO)
  return [...urgent, ...info].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function getNotificationsForDevice(cfg, deviceId) {
  const deviceKey = `notices:${deviceId}`
  const all = [...parseList(await cfg.kv.get('notices:global')), ...parseList(await cfg.kv.get(deviceKey))]
  const now = Date.now()
  return capNotices(all.filter((notice) => notice && typeof notice.id === 'string' && typeof notice.body === 'string'
    && (!notice.expiresAt || Date.parse(notice.expiresAt) > now)))
}

/* بند 10 (تدقيق 2026-10-08): درجات الإلزام —
   info ⇒ جرس وتوست فقط · important ⇒ نافذة منبثقة قابلة للتأجيل · critical ⇒
   نافذة بإقرار إلزامي. والافتراضي info ⇒ كل ما أُرسل قبل التحديث يعمل كما كان. */
export const NOTICE_LEVELS = ['info', 'important', 'critical']
const NOTICE_LEVEL_LABELS_AR = { info: '📣 إعلان (بلا مقاطعة)', important: '⚠️ مهم (نافذة منبثقة)', critical: '🚨 عاجل (إقرار إلزامي)' }
const NOTICE_TITLES_AR = { info: 'رسالة من المطوّر', important: 'تنبيه مهم من المطوّر', critical: 'تنبيه عاجل من المطوّر' }

export function normalizeNoticeLevel(value) {
  return NOTICE_LEVELS.includes(value) ? value : 'info'
}

async function appendNotice(cfg, key, body, opts = {}) {
  const now = new Date()
  const level = normalizeNoticeLevel(opts.level)
  const notice = {
    id: crypto.randomUUID(),
    title: cleanText(opts.title, 120) || NOTICE_TITLES_AR[level],
    body,
    level,
    requiresAck: level !== 'info',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }
  const previous = parseList(await cfg.kv.get(key)).filter((n) => n?.expiresAt && Date.parse(n.expiresAt) > now.getTime())
  previous.push(notice)
  // H2: التخزين يحفظ المهم/العاجل حتى لو تراكمت إعلانات بعده (كان slice(-50) يُسقطه من المصدر)
  await cfg.kv.put(key, JSON.stringify(capNotices(previous)))
  return notice
}

async function startFlow(cfg, chatId, flow) {
  await cfg.kv.put(`ui-flow:${chatId}`, JSON.stringify({ ...flow, startedAt: Date.now() }), { expirationTtl: 3600 })
}

async function readFlow(cfg, chatId) {
  const raw = await cfg.kv.get(`ui-flow:${chatId}`)
  if (!raw) return null
  const flow = parseObject(raw)
  if (Date.now() - (flow.startedAt ?? 0) > 60 * 60 * 1000) {
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return null
  }
  return flow.kind ? flow : null
}

function featureRows(features, prefix, extra = []) {
  const rows = []
  const entries = Object.entries(FEATURE_LABELS)
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(entries.slice(i, i + 2).map(([key, label]) => button(`${features.includes(key) ? '✅' : '⬜'} ${label}`, `${prefix}:${key}`)))
  }
  const modules = Object.entries(MODULE_LABELS)
  for (let i = 0; i < modules.length; i += 2) {
    rows.push(modules.slice(i, i + 2).map(([key, label]) => button(`${extra.includes(key) ? '✅' : '⬜'} ${label}`, `${prefix}:module:${key}`)))
  }
  return rows
}

function planRows(settings, prefix) {
  return [
    [
      button(`${settings.plan === 'trial' ? '✅ ' : ''}تجريبي`, `${prefix}:plan:trial`),
      button(`${settings.plan === 'basic' ? '✅ ' : ''}أساسي`, `${prefix}:plan:basic`),
    ],
    [
      button(`${settings.plan === 'pro' ? '✅ ' : ''}احترافي`, `${prefix}:plan:pro`),
      button(`${settings.plan === 'lifetime' ? '✅ ' : ''}مدى الحياة`, `${prefix}:plan:lifetime`),
    ],
  ]
}

function daysRows(settings, prefix) {
  const choices = [[30, 'شهر'], [90, '٣ أشهر'], [180, '٦ أشهر'], [365, 'سنة'], [0, 'مدى الحياة']]
  return [
    choices.slice(0, 3).map(([days, label]) => button(`${settings.days === days ? '✅ ' : ''}${label}`, `${prefix}:days:${days}`)),
    choices.slice(3).map(([days, label]) => button(`${settings.days === days ? '✅ ' : ''}${label}`, `${prefix}:days:${days}`)),
  ]
}

async function globalSettingsReply(cfg, chatId) {
  const settings = await readGlobalSettings(cfg)
  const features = settings.features ?? []
  const modules = settings.extraModules ?? []
  const rows = [
    ...planRows(settings, 'g'),
    ...daysRows(settings, 'g'),
    [button(`👥 مستخدمون إضافيون: ${settings.extraUsers}`, 'g:num:extraUsers'), button(`🏬 فروع إضافية: ${settings.extraBranches}`, 'g:num:extraBranches')],
    ...featureRows(features, 'g:feature', modules),
    [button('🏠 القائمة الرئيسية', 'panel:home')],
  ]
  return menuReply(chatId, 'الإعداد العام — يُستخدم عند إصدار مفتاح جديد. المفتاح الصادر لا يتغير حتى تعيد إصداره؛ واستثناءات كل عميل تبقى محفوظة.', rows)
}

async function clientSettingsReply(cfg, chatId, deviceId) {
  const device = await getDevice(cfg, deviceId)
  if (!device) return panelHome(chatId, 'لم أجد هذا العميل. حدّث قائمة العملاء وحاول ثانية.')
  const [global, stored] = await Promise.all([readGlobalSettings(cfg), readCustomerSettings(cfg, device.customer)])
  const current = await currentLicense(cfg, device)
  const settings = sanitizeSettings({ ...(current ?? {}), ...global, ...stored.settings }, DEFAULT_SETTINGS)
  const rows = [
    ...planRows(settings, `c:${deviceId}`),
    ...daysRows(settings, `c:${deviceId}`),
    [button(`👥 مستخدمون إضافيون: ${settings.extraUsers}`, `cnum:${deviceId}:extraUsers`), button(`🏬 فروع إضافية: ${settings.extraBranches}`, `cnum:${deviceId}:extraBranches`)],
    ...featureRows(settings.features, `c:${deviceId}:feature`, settings.extraModules),
    [button('↩️ إصدار مفتاح بهذه الإعدادات', `issue:${deviceId}`)],
    [button('🔄 إعادة الإعدادات العامة', `creset:${deviceId}`)],
    [button('⬅️ رجوع للعميل', `client:${deviceId}`)],
  ]
  return menuReply(chatId, `إعدادات ${tgEscape(device.customer)}\nالتغييرات تحفظ كاستثناء للعميل ولا تغيّر الرخصة الحالية حتى تصدر مفتاحاً جديداً.`, rows)
}

async function clientReply(cfg, chatId, deviceId) {
  const device = await getDevice(cfg, deviceId)
  if (!device) return panelHome(chatId, 'لم أجد هذا العميل.')
  const license = await currentLicense(cfg, device)
  /* بطاقة العميل تُفتح من قائمة الأجهزة، وزر «إضافة جهاز» يستهدف مجموعة العميل
     (customerHash) لا الجهاز — كان يشير لمتغير `hash` غير معرّف في هذا النطاق
     فينهار فتح بطاقة العميل بالكامل (ReferenceError). */
  const hash = await hashCustomerName(device.customer)
  const rows = [
    [button('🔑 إصدار أو تجديد الرخصة', `issue:${deviceId}`)],
    [button('⚙️ إعدادات خاصة لهذا العميل', `csettings:${deviceId}`)],
    [button('🔔 إرسال تنبيه لهذا العميل', `notice:${deviceId}`)],
    [button('🔥 إبطال الرخصة', `revoke:${deviceId}`), button('➕ إضافة جهاز للعميل', `adddevice:${hash}`)],
    [button('⬅️ رجوع لقائمة العملاء', 'panel:clients')],
  ]
  const status = device.fingerprint && parseList(await cfg.kv.get('revoked')).includes(device.fingerprint) ? 'مبطلة' : 'سارية'
  const text = [
    `👤 ${tgEscape(device.customer)}`,
    `الجهاز: ${deviceId}`,
    `الخطة: ${PLAN_LABELS[license?.plan] ?? device.plan ?? 'غير مسجلة'}`,
    `الانتهاء: ${license?.expiresAt ?? device.expiresAt ?? '—'}`,
    `حالة المفتاح: ${status}`,
  ].join('\n')
  return menuReply(chatId, text, rows)
}

async function clientsReply(cfg, chatId) {
  const [{ groups, skipped }, { rows: regRows }] = await Promise.all([customerGroups(cfg), registrationRows(cfg)])
  const unlicensed = regRows.filter((row) => !row.licensed).length
  /* المسجّلون بلا رخصة لا يظهرون في قائمة العملاء (تُبنى من dev: وحده) ⇒ صف خاص لهم */
  const top = unlicensed ? [[button(`🆕 مسجّلون بلا رخصة (${unlicensed})`, 'panel:regsnew')]] : []
  const warn = skipped ? `\n⚠️ ${skipped} جهازاً بلا فهرس لم تُقرأ في هذه الدورة (حدّ الخطة المجانية).` : ''
  if (!groups.length) {
    return menuReply(chatId, `لا يوجد عملاء مرخّصون بعد. أضف أول عميل، أو أصدر رخصة لأحد المسجّلين.${warn}`, [
      ...top,
      [button('➕ إضافة أول عميل وإصدار رخصة', 'panel:new')],
      [button('⬅️ القائمة الرئيسية', 'panel:home')],
    ])
  }
  const rows = [...top, ...groups.slice(0, 80).map((group) => [button(`👤 ${group.name} (${group.devices.length} جهاز)`, `group:${group.hash}`)])]
  rows.push([button('➕ إضافة عميل جديد', 'panel:new')], [button('⬅️ القائمة الرئيسية', 'panel:home')])
  return menuReply(chatId, `اختر اسم العميل (${groups.length}):${warn}`, rows)
}

async function groupReply(cfg, chatId, hash) {
  const group = await findCustomer(cfg, hash)
  if (!group) return clientsReply(cfg, chatId)
  const rows = group.devices.map((device) => [button(`${device.deviceId.slice(-4)} — ${device.plan ?? 'رخصة'}`, `client:${device.deviceId}`)])
  rows.push([button('🔔 إرسال تنبيه لكل أجهزة العميل', `notice-group:${hash}`)])
  rows.push([button('➕ إضافة جهاز لهذا العميل', `adddevice:${hash}`)])
  rows.push([button('⬅️ رجوع للعملاء', 'panel:clients')])
  return menuReply(chatId, `أجهزة العميل: ${tgEscape(group.name)}`, rows)
}

async function issueForDevice(cfg, deviceId, customerName) {
  const device = await getDevice(cfg, deviceId)
  const priorLicense = device ? await currentLicense(cfg, device) : null
  const [global, customerSettings] = await Promise.all([
    readGlobalSettings(cfg), readCustomerSettings(cfg, customerName),
  ])
  const settings = sanitizeSettings({ ...(priorLicense ?? {}), ...global, ...customerSettings.settings }, DEFAULT_SETTINGS)
  const payload = {
    v: 1,
    deviceId,
    customer: customerName,
    plan: settings.plan,
    features: settings.features,
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: settings.plan === 'lifetime' ? null : expiresAfterDays(settings.days),
    ...(settings.extraUsers > 0 ? { extraUsers: settings.extraUsers } : {}),
    ...(settings.extraBranches > 0 ? { extraBranches: settings.extraBranches } : {}),
    ...(settings.activityId ? { activityId: settings.activityId } : {}),
    ...(settings.extraModules?.length ? { extraModules: settings.extraModules } : {}),
  }
  const key = await issueLicenseKey(payload, cfg.priv)
  const fingerprint = keyFingerprint(key)
  await cfg.kv.put(`lic:${fingerprint}`, JSON.stringify({ payload, key, issuedAt: payload.issuedAt, revoked: false }))
  const deviceRecord = {
    ...(device ?? {}), customer: customerName, plan: payload.plan, expiresAt: payload.expiresAt,
    fingerprint, message: device?.message ?? '',
  }
  /* metadata = الفهرس الذي تبني منه القوائم والتذكيرات بلا قراءة كل سجل */
  await cfg.kv.put(`dev:${deviceId}`, JSON.stringify(deviceRecord), { metadata: deviceMetadata(deviceRecord) })
  return { payload, key, fingerprint }
}

async function saveNoticeForCustomer(cfg, group, body, opts = {}) {
  for (const device of group.devices) await appendNotice(cfg, `notices:${device.deviceId}`, body, opts)
  return group.devices.length
}

async function revokeDevice(cfg, deviceId) {
  const device = await getDevice(cfg, deviceId)
  if (!device?.fingerprint) return false
  const revoked = parseList(await cfg.kv.get('revoked'))
  if (!revoked.includes(device.fingerprint)) {
    revoked.push(device.fingerprint)
    await cfg.kv.put('revoked', JSON.stringify(revoked))
  }
  const raw = await cfg.kv.get(`lic:${device.fingerprint}`)
  if (raw) {
    const record = parseObject(raw)
    record.revoked = true
    await cfg.kv.put(`lic:${device.fingerprint}`, JSON.stringify(record))
  }
  return true
}

function flowPrompt(chatId, text, cancel = true) {
  return menuReply(chatId, text, cancel ? [[button('إلغاء', 'panel:cancel')]] : [])
}

export async function handlePanelText(text, chatId, cfg) {
  const flow = await readFlow(cfg, chatId)
  if (!flow) return null
  const value = cleanText(text, 1500)
  if (['إلغاء', '/cancel', '/إلغاء'].includes(value)) {
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return panelHome(chatId, 'أُلغيت العملية.')
  }
  if (value.startsWith('/')) return null

  if (flow.kind === 'new_customer') {
    if (flow.step === 'name') {
      if (!value || value.length < 2) return flowPrompt(chatId, 'اكتب اسم العميل (حرفان على الأقل).')
      flow.customer = value.slice(0, 100)
      flow.step = 'device'
      await startFlow(cfg, chatId, flow)
      return flowPrompt(chatId, `حُفظ اسم العميل «${tgEscape(flow.customer)}». أرسل الآن معرّف الجهاز الظاهر في شاشة التفعيل.`)
    }
    if (flow.step === 'device') {
      const deviceId = value.toUpperCase()
      if (!DEVICE_RE.test(deviceId)) return flowPrompt(chatId, 'معرّف الجهاز غير صحيح. انسخه كما يظهر في شاشة التفعيل ثم أرسله هنا.')
      if (await cfg.kv.get(`dev:${deviceId}`)) return flowPrompt(chatId, 'هذا الجهاز مسجل بالفعل. افتحه من قائمة العملاء بدلاً من إضافته مرة أخرى.')
      await cfg.kv.delete(`ui-flow:${chatId}`)
      const result = await issueForDevice(cfg, deviceId, flow.customer)
      return panelHome(chatId, `✅ أُضيف ${tgEscape(flow.customer)}\nأرسل هذا المفتاح للعميل ليدخله في التطبيق:\n<code>${result.key}</code>\n\nالخطة الافتراضية: ${PLAN_LABELS[result.payload.plan]} · الانتهاء: ${result.payload.expiresAt ?? 'مدى الحياة'}`)
    }
  }

  if (flow.kind === 'add_device') {
    const deviceId = value.toUpperCase()
    if (!DEVICE_RE.test(deviceId)) return flowPrompt(chatId, 'معرّف الجهاز غير صحيح. انسخه كما يظهر في شاشة التفعيل ثم أرسله هنا.')
    if (await cfg.kv.get(`dev:${deviceId}`)) return flowPrompt(chatId, 'هذا الجهاز مسجل بالفعل.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    const result = await issueForDevice(cfg, deviceId, flow.customer)
    return panelHome(chatId, `✅ أُضيف جهاز للعميل ${tgEscape(flow.customer)}\nأرسل المفتاح الجديد لهذا الجهاز:\n<code>${result.key}</code>`)
  }

  if (flow.kind === 'notice') {
    if (!value) return flowPrompt(chatId, 'اكتب نص التنبيه أولاً.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    const level = normalizeNoticeLevel(flow.level)
    const shapeAr = level === 'critical' ? '🚨 نافذة بإقرار إلزامي' : level === 'important' ? '⚠️ نافذة منبثقة' : '📣 جرس وتوست'
    if (flow.scope === 'global') {
      await appendNotice(cfg, 'notices:global', value, { level })
      return panelHome(chatId, `✅ حُفظ التنبيه العام (${shapeAr}). يصل العملاء عند اتصالهم — الاستطلاع كل 60 ثانية وعند العودة للتطبيق.`)
    }
    const group = await findCustomer(cfg, flow.customerHash)
    if (!group) return panelHome(chatId, 'لم أجد العميل؛ لم يُرسل التنبيه.')
    const count = await saveNoticeForCustomer(cfg, group, value, { level })
    return panelHome(chatId, `✅ حُفظ التنبيه للعميل ${tgEscape(group.name)} (${count} جهاز) — ${shapeAr}.`)
  }

  /* بند 1: رد الدعم — يُرسل عبر الجسر ولا يُحفظ محلياً */
  if (flow.kind === 'supportreply') {
    if (!value) return flowPrompt(chatId, 'اكتب نص الرد أولاً.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    const result = await supportBridge(cfg, 'reply', { deviceId: flow.deviceId, text: value })
    if (!result.ok) return panelHome(chatId, `⚠️ تعذّر إرسال الرد: ${result.error}`)
    return panelHome(chatId, `✅ أُرسل الرد إلى <code>${flow.deviceId}</code>.`)
  }

  /* بند 9: تحرير حقل من مستند «حول» — يُدمج في المستند ولا يمسح بقية الحقول */
  if (flow.kind === 'aboutfield' || flow.kind === 'about') {
    if (!value) return flowPrompt(chatId, 'اكتب القيمة الجديدة، أو أرسل «مسح» للتفريغ، أو «رجوع» للقائمة.')
    if (value === 'رجوع') {
      await cfg.kv.delete(`ui-flow:${chatId}`)
      return aboutMenuReply(cfg, chatId)
    }
    const key = flow.kind === 'aboutfield' ? flow.key : 'body'
    const res = await setAboutField(cfg, key, value === 'مسح' ? '' : value)
    if (!res.ok) return flowPrompt(chatId, `⚠️ ${res.reasonAr}\nأرسل قيمة صالحة أو «رجوع».`)
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return aboutMenuReply(cfg, chatId, `✅ حُدّث الحقل وحُفظ في السحابة — يصل العملاء عند أول مزامنة (تلقائياً كل 6 ساعات أو عند فتح «حول»).`)
  }

  /* حقل حر: اسم ← قيمة ← رابط اختياري */
  if (flow.kind === 'aboutextra') {
    if (!value) return flowPrompt(chatId, 'أرسل القيمة المطلوبة.')
    if (flow.step === 'label') {
      await startFlow(cfg, chatId, { kind: 'aboutextra', step: 'value', label: value })
      return flowPrompt(chatId, `👌 اسم الحقل: <b>${value}</b>\nأرسل الآن <b>القيمة</b> التي تظهر أمامه.`)
    }
    if (flow.step === 'value') {
      await startFlow(cfg, chatId, { kind: 'aboutextra', step: 'url', label: flow.label, value })
      return flowPrompt(chatId, `👌 القيمة: <b>${value}</b>\nأرسل <b>رابطاً</b> يُفتح عند الضغط عليها (https://…) أو «لا» لعرضها كنص.`)
    }
    const res = await addAboutExtraField(cfg, {
      label: flow.label, value: flow.value, url: value === 'لا' ? '' : value,
    })
    if (!res.ok) return flowPrompt(chatId, `⚠️ ${res.reasonAr}\nأرسل رابطاً صحيحاً أو «لا».`)
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return aboutMenuReply(cfg, chatId, `✅ أُضيف الحقل «${flow.label}» وصار ظاهراً في صفحة «حول» للعملاء.`)
  }

  /* قناة تواصل إضافية: اسم ← رابط */
  if (flow.kind === 'aboutsocial') {
    if (!value) return flowPrompt(chatId, 'أرسل القيمة المطلوبة.')
    if (flow.step === 'label') {
      await startFlow(cfg, chatId, { kind: 'aboutsocial', step: 'url', label: value })
      return flowPrompt(chatId, `👌 القناة: <b>${value}</b>\nأرسل الآن <b>الرابط</b> (https://…).`)
    }
    const res = await addAboutSocialLink(cfg, { label: flow.label, url: value })
    if (!res.ok) return flowPrompt(chatId, `⚠️ ${res.reasonAr}\nأرسل رابطاً صحيحاً.`)
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return aboutMenuReply(cfg, chatId, `✅ أُضيفت قناة «${flow.label}» إلى صفحة «حول».`)
  }

  if (flow.kind === 'number') {
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0 || number > 99) return flowPrompt(chatId, 'أرسل رقماً صحيحاً من 0 إلى 99.')
    if (flow.scope === 'global') {
      await writeGlobalSettings(cfg, { [flow.field]: number })
      await cfg.kv.delete(`ui-flow:${chatId}`)
      return globalSettingsReply(cfg, chatId)
    }
    const group = await findCustomer(cfg, flow.customerHash)
    if (!group) return panelHome(chatId, 'لم أجد العميل.')
    await writeCustomerSettings(cfg, group.name, { [flow.field]: number })
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return menuReply(chatId, '✅ حُفظ التخصيص. سيُستخدم عند إصدار مفتاح جديد.', [[button('إصدار مفتاح جديد', `issue:${flow.deviceId}`)], [button('رجوع للإعدادات', `csettings:${flow.deviceId}`)]])
  }

  /* بند 3+4: نافذة «قرب الانتهاء» — يسري ضبطها على التذكير اليومي والأمر واللوحة */
  if (flow.kind === 'digwindow') {
    const days = Number(value)
    if (!Number.isInteger(days) || days < 1 || days > 90) return flowPrompt(chatId, 'أرسل عدداً صحيحاً من 1 إلى 90 يوماً.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    const saved = await writeSoonDays(cfg, days)
    const digest = await subscriptionDigest(cfg, { soonDays: saved })
    return menuReply(chatId, `✅ صارت نافذة «قرب الانتهاء» ${saved} يوماً — تسري على التذكير اليومي والأمر واللوحة.\n\n${formatDigestAr(digest)}`, [
      [button('👥 العملاء', 'panel:clients'), button('🏠 القائمة الرئيسية', 'panel:home')],
    ])
  }

  return null
}

/* ─── بند 9 (تدقيق 2026-10-08): صفحة «حول» وبيانات التواصل من اللوحة ────────
 * كان «تعديل حول» حقلاً نصياً واحداً ⇒ الهاتف/واتساب/تليجرام/البريد/الموقع
 * تبقى فارغة للأبد ولا تظهر في «حول» ولا في شاشة القفل. صارت قائمة حقول
 * صريحة + معاينة لما سيراه العميل + حقول حرة يضيفها المطوّر. */
async function aboutMenuReply(cfg, chatId, note = '') {
  const doc = await readAbout(cfg)
  const rows = []
  for (const field of ABOUT_FIELDS) {
    const current = doc[field.key] || ''
    const shown = current.length > 28 ? `${current.slice(0, 28)}…` : current
    rows.push([button(`${field.labelAr}${shown ? `: ${shown}` : ' —'}`, `panel:aboutfield:${field.key}`)])
  }
  rows.push([button('➕ إضافة حقل حر', 'panel:aboutextra'), button('🔗 قناة تواصل', 'panel:aboutsocial')])
  const extras = doc.extraFields.map((f, i) => [button(`🗑️ ${i + 1}. ${f.label}`, `panel:aboutextradel:${i}`)])
  const socials = doc.socialLinks.map((l, i) => [button(`🗑️ ${l.label}`, `panel:aboutsocialdel:${i}`)])
  rows.push(...extras, ...socials)
  rows.push([button('👁️ معاينة كما يراها العميل', 'panel:aboutpreview'), button('🏠 القائمة الرئيسية', 'panel:home')])
  const missing = ABOUT_FIELDS.filter((f) => f.key.startsWith('support') && !doc[f.key]).map((f) => f.labelAr)
  const warn = missing.length
    ? `\n\n⚠️ <b>ناقص:</b> ${missing.join(' · ')} — العميل المقفول أوفلاين لن يجد طريقة تواصل.`
    : ''
  return menuReply(chatId, `${note ? note + '\n\n' : ''}📝 <b>صفحة «حول» وبيانات التواصل</b>\nاختر حقلاً لتحريره. آخر تحديث: <code>${doc.updatedAt || '—'}</code>${warn}`, rows)
}

/* ─── بند 1: صندوق الدعم في اللوحة ────────────────────────────────────────
 * supportBridge مستورد من العامل (نفس عميل الجسر) — فلا منطق شبكة مكرر. */
async function supportInboxReply(cfg, chatId) {
  const inbox = await supportBridge(cfg, 'inbox')
  if (!inbox.ok) {
    return menuReply(chatId, `⚠️ ${inbox.error}`, [[button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  const conversations = Array.isArray(inbox.conversations) ? inbox.conversations : []
  if (!conversations.length) {
    return menuReply(chatId, '💬 لا محادثات دعم بعد.\nيظهر هنا كل عميل راسلك من «الدعم الفني» داخل التطبيق.', [[button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  const rows = conversations.slice(0, 12).map((c) => [button(
    `${c.awaitingReply ? '🔴' : '⚪'} ${tgEscape(String(c.deviceId).slice(-13))} — ${tgEscape(cleanText(c.lastText, 30)) || '…'}`,
    `support-thread:${c.deviceId}`,
  )])
  rows.push([button('🔄 تحديث', 'panel:support')], [button('🏠 القائمة الرئيسية', 'panel:home')])
  const waiting = conversations.filter((c) => c.awaitingReply).length
  const skippedNote = Number(inbox.truncated) > 0
    ? `\n⚠️ ${inbox.truncated} محادثة قديمة لم تُعرض هذه الدورة (حدّ النداءات) — تُفهرس عند أول رسالة جديدة فيها.`
    : ''
  return menuReply(chatId, `💬 <b>محادثات الدعم</b> (${conversations.length})\n🔴 بانتظار ردك: ${waiting}${skippedNote}\nاختر محادثة لقراءتها والرد عليها:`, rows)
}

async function supportThreadReply(cfg, chatId, deviceId) {
  const thread = await supportBridge(cfg, 'thread', { deviceId })
  if (!thread.ok) return menuReply(chatId, `⚠️ ${thread.error}`, [[button('⬅️ رجوع', 'panel:support')]])
  const messages = Array.isArray(thread.messages) ? thread.messages : []
  const lines = messages.slice(-12).map((m) => `${m.from === 'developer' ? '🧑‍💻' : '👤'} ${tgEscape(String(m.at ?? '').slice(0, 16).replace('T', ' '))}\n${tgEscape(cleanText(m.text, 500))}`)
  const body = lines.length ? lines.join('\n\n') : 'لا رسائل في هذه المحادثة.'
  return menuReply(chatId, `💬 <code>${deviceId}</code>\n\n${body}`, [
    [button('✍️ الرد على العميل', `support-reply:${deviceId}`)],
    [button('⬅️ كل المحادثات', 'panel:support')],
  ])
}

/* بند 10: اختيار درجة التنبيه قبل كتابة النص */
function noticeLevelReply(cfg, chatId, target) {
  const suffix = target.scope === 'customer' ? `:customer:${target.customerHash}` : ':global'
  const who = target.scope === 'customer' ? `للعميل <b>${tgEscape(target.customerName ?? '')}</b>` : '<b>لجميع العملاء</b>'
  return menuReply(chatId, `🔔 تنبيه ${who} — اختر طريقة العرض عند العميل:`, [
    ...NOTICE_LEVELS.map((level) => [button(NOTICE_LEVEL_LABELS_AR[level], `panel:noticelevel:${level}${suffix}`)]),
    [button('📬 التنبيهات المرسلة والقراءات', 'panel:noticelist')],
    [button('إلغاء', 'panel:cancel')],
  ])
}

/* بند 10: ما أُرسل فعلاً + كم جهازاً أقرّ بالقراءة */
export async function noticeListReply(cfg, chatId) {
  const notices = parseList(await cfg.kv.get('notices:global')).filter((n) => n?.id && n?.body)
  if (!notices.length) {
    return menuReply(chatId, '📬 لا تنبيهات عامة محفوظة بعد.\n(التنبيهات المرسلة لعميل واحد تُخزَّن لكل جهاز على حدة.)', [[button('🔔 إرسال تنبيه', 'panel:notice:all')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  const recent = notices.slice(-10).reverse()
  const lines = ['📬 <b>آخر التنبيهات العامة</b>', '']
  for (const notice of recent) {
    const acks = await ackCountForNotice(cfg, notice.id)
    const level = normalizeNoticeLevel(notice.level)
    const label = level === 'critical' ? '🚨 عاجل' : level === 'important' ? '⚠️ مهم' : '📣 إعلان'
    const when = String(notice.createdAt ?? '').slice(0, 16).replace('T', ' ')
    lines.push(`${label} · ${when} · ✅ قرأه ${acks} جهاز\n${cleanText(notice.body, 160)}`)
    lines.push('')
  }
  return menuReply(chatId, lines.join('\n').trim(), [[button('🔔 إرسال تنبيه', 'panel:notice:all')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
}

/* ── بلاغات التسجيل في اللوحة (مراجعة المرحلة ③) ──────────────────────────────
 * كان للتسجيلات عرض مختصر فقط: لا بيانات كاملة، ولا إصدار رخصة من مكانها، والعميل
 * المسجَّل بلا رخصة **لا يظهر** في «👥 العملاء» لأن القائمة تُبنى من مفاتيح dev: وحدها.
 * الآن: كل التسجيلات مع حالة الترخيص، وإصدار المفتاح بضغطة من البطاقة، وصف خاص
 * للمسجّلين بلا رخصة في قائمة العملاء. الأسماء من الـlist بلا قراءة كل سجل. */

/** معرّفات الأجهزة المرخّصة (`dev:`) بالـlist وحده — بلا قراءة سجل */
async function issuedDeviceIds(cfg) {
  const ids = new Set()
  let cursor
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await cfg.kv.list({ prefix: 'dev:', limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const key of page.keys ?? []) ids.add(key.name.slice(4))
    if (page.list_complete || !page.cursor) break
    cursor = page.cursor
  }
  return ids
}

/** كل التسجيلات مع حالة الترخيص لكل منها */
async function registrationRows(cfg) {
  const [{ records, skipped }, issued] = await Promise.all([listRegistrations(cfg), issuedDeviceIds(cfg)])
  return { rows: records.map((record) => ({ record, licensed: issued.has(record.deviceId) })), skipped }
}

async function registrationsReply(cfg, chatId, { onlyUnlicensed = false } = {}) {
  const { rows, skipped } = await registrationRows(cfg)
  const shown = onlyUnlicensed ? rows.filter((row) => !row.licensed) : rows
  const unlicensed = rows.filter((row) => !row.licensed).length
  /* أسماء الأزرار نص عادي (لا HTML) فلا تُهرَّب */
  const menuRows = shown.slice(0, REG_LIST_SHOWN).map(({ record, licensed }) => [
    button(`${licensed ? '✅' : '🆕'} ${(record.shopName || record.ownerName || 'بلا اسم').slice(0, 40)} · ${String(record.deviceId ?? '').slice(-4)}`, `panel:reg:${record.deviceId}`),
  ])
  menuRows.push([onlyUnlicensed ? button('📋 كل التسجيلات', 'panel:regs') : button('🆕 بلا رخصة فقط', 'panel:regsnew')])
  menuRows.push([button('👥 العملاء', 'panel:clients')], [button('🏠 القائمة الرئيسية', 'panel:home')])
  if (!shown.length) {
    const none = onlyUnlicensed ? 'لا يوجد مسجّلون بلا رخصة الآن ✅' : 'لا تسجيلات بعد — يظهر هنا كل عميل يكمل معالج أول التشغيل.'
    return menuReply(chatId, none, menuRows)
  }
  const head = onlyUnlicensed
    ? `🆕 <b>مسجّلون بلا رخصة (${shown.length})</b>`
    : `🆕 <b>التسجيلات (${rows.length})</b> · بلا رخصة: ${unlicensed}`
  /* كل سجل في سطرين من النص (الاسم والمالك، ثم الاتصال والجهاز) — البيانات تُقرأ هنا
     مباشرة، والزر يفتح البطاقة الكاملة. كل قيمة يكتبها العميل تُهرَّب. */
  const lines = [head, '']
  for (const { record, licensed } of shown.slice(0, REG_LIST_SHOWN)) {
    const contact = [record.phone, record.email].filter(Boolean).map(tgEscape).join(' · ')
    lines.push(`${licensed ? '✅' : '🆕'} <b>${tgEscape(record.shopName) || 'بلا اسم'}</b> — ${tgEscape(record.ownerName) || '—'}${contact ? `\n   ${contact}` : ''}\n   <code>${tgEscape(record.deviceId)}</code> · ${tgEscape(record.activityNameAr) || '—'}`)
  }
  if (shown.length > REG_LIST_SHOWN) lines.push(`… و${shown.length - REG_LIST_SHOWN} أقدم غيرها (تُعرض الأحدث ${REG_LIST_SHOWN})`)
  if (skipped) lines.push(`⚠️ ${skipped} سجلاً قديماً بلا فهرس لم تُقرأ في هذه الدورة.`)
  lines.push('', 'اختر تسجيلاً من الأزرار لعرض بياناته كاملة وإصدار رخصته.', '🗑️ الحذف من بطاقة التسجيل نفسها، أو بالأمر <code>/احذف SHOP-XXXX-XXXX-XXXX</code>')
  return menuReply(chatId, lines.join('\n'), menuRows)
}

async function registrationDetailReply(cfg, chatId, deviceId) {
  const id = String(deviceId ?? '').toUpperCase()
  if (!DEVICE_RE.test(id)) return panelHome(chatId, '⚠️ معرّف الجهاز غير صالح.')
  const record = parseObject(await cfg.kv.get(regKey(id)))
  if (!record.deviceId) {
    return menuReply(chatId, 'لا يوجد تسجيل بهذا المعرّف — ربما حُذف.', [[button('🆕 التسجيلات', 'panel:regs')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  const licensed = Boolean(await cfg.kv.get(`dev:${id}`))
  const rows = []
  if (!licensed) rows.push([button('🔑 إصدار مفتاح لهذا الجهاز', `panel:issuereg:${id}`)])
  rows.push([button('🗑️ حذف بيانات هذا التسجيل', `panel:regdel:${id}`)])
  rows.push([button('⬅️ رجوع للتسجيلات', 'panel:regs')], [button('🏠 القائمة الرئيسية', 'panel:home')])
  return menuReply(chatId, formatRegistrationDetailAr(record, { licensed }), rows)
}

async function issueFromRegistrationReply(cfg, chatId, deviceId) {
  const id = String(deviceId ?? '').toUpperCase()
  if (!DEVICE_RE.test(id)) return panelHome(chatId, '⚠️ معرّف الجهاز غير صالح.')
  if (await cfg.kv.get(`dev:${id}`)) {
    return menuReply(chatId, 'هذا الجهاز مرخّص بالفعل — افتح العميل من قائمة العملاء لتجديده أو إصدار مفتاح جديد.', [[button('👥 العملاء', 'panel:clients')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  const record = parseObject(await cfg.kv.get(regKey(id)))
  if (!record.deviceId) return panelHome(chatId, '⚠️ لا يوجد بلاغ تسجيل لهذا الجهاز، فلا اسم عميل يُستخدم.')
  const customer = cleanText(record.shopName || record.ownerName || 'عميل جديد', 100)
  const result = await issueForDevice(cfg, id, customer)
  return panelHome(chatId, `✅ أُصدرت رخصة لـ ${tgEscape(customer)}\nأرسل هذا المفتاح للعميل ليدخله في التطبيق:\n<code>${result.key}</code>\n\nالخطة: ${PLAN_LABELS[result.payload.plan] ?? result.payload.plan} · الانتهاء: ${result.payload.expiresAt ?? 'مدى الحياة'}`)
}

function registrationDeleteConfirmReply(chatId, deviceId) {
  const id = String(deviceId ?? '').toUpperCase()
  if (!DEVICE_RE.test(id)) return panelHome(chatId, '⚠️ معرّف الجهاز غير صالح.')
  return menuReply(chatId, `⚠️ سيُحذف سجل التسجيل لهذا الجهاز <code>${id}</code> (المنشأة والهاتف والبريد وبقية بياناته).\nلا يُلغي هذا الحذف أي رخصة صادرة. هل تؤكد؟`, [
    [button('✅ نعم، احذف السجل', `panel:regdelok:${id}`)],
    [button('↩️ إلغاء', `panel:reg:${id}`)],
  ])
}

async function registrationDeleteReply(cfg, chatId, deviceId) {
  const result = await deleteRegistration(cfg, deviceId)
  if (!result.ok) return menuReply(chatId, result.reasonAr, [[button('🆕 التسجيلات', 'panel:regs')]])
  const text = result.existed
    ? `🗑️ حُذف سجل التسجيل للجهاز <code>${result.deviceId}</code>.`
    : `لا سجل تسجيل بهذا المعرّف (<code>${result.deviceId}</code>).`
  return menuReply(chatId, text, [[button('🆕 التسجيلات', 'panel:regs')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
}

export async function handlePanelButton(data, chatId, cfg) {
  const parts = String(data ?? '').split(':')
  const action = parts[0]
  if (data === 'panel:home') return panelHome(chatId)
  /* بند 2 (تدقيق 2026-10-08): بلاغات العملاء الجدد من اللوحة */
  if (data === 'panel:regs') return registrationsReply(cfg, chatId)
  if (data === 'panel:regsnew') return registrationsReply(cfg, chatId, { onlyUnlicensed: true })
  if (action === 'panel' && parts[1] === 'reg' && parts[2] && !parts[3]) return registrationDetailReply(cfg, chatId, parts[2])
  if (action === 'panel' && parts[1] === 'issuereg' && parts[2]) return issueFromRegistrationReply(cfg, chatId, parts[2])
  if (action === 'panel' && parts[1] === 'regdel' && parts[2]) return registrationDeleteConfirmReply(chatId, parts[2])
  if (action === 'panel' && parts[1] === 'regdelok' && parts[2]) return registrationDeleteReply(cfg, chatId, parts[2])
  if (data === 'panel:clients') return clientsReply(cfg, chatId)
  if (data === 'panel:new') {
    await startFlow(cfg, chatId, { kind: 'new_customer', step: 'name' })
    return flowPrompt(chatId, 'أدخل اسم العميل الجديد مرة واحدة. بعد ذلك ستختاره من قائمة العملاء.')
  }
  if (data === 'panel:global') return globalSettingsReply(cfg, chatId)
  /* بند 3+4 (تدقيق 2026-10-08): منتهية/موشكة من اللوحة — نفس ملخص الـcron */
  if (data === 'panel:digest') {
    const digest = await subscriptionDigest(cfg, { soonDays: await readSoonDays(cfg) })
    return menuReply(chatId, formatDigestAr(digest), [
      [button(`⏳ تغيير النافذة (${SOON_DAYS} أيام افتراضياً)`, 'panel:digwindow'), button('👥 العملاء', 'panel:clients')],
      [button('🏠 القائمة الرئيسية', 'panel:home')],
    ])
  }
  if (data === 'panel:digwindow') {
    await startFlow(cfg, chatId, { kind: 'digwindow' })
    return flowPrompt(chatId, 'أرسل عدد أيام نافذة «قرب الانتهاء» (1 إلى 90).')
  }
  if (data === 'panel:stats') {
    const [digest, revokedRaw] = await Promise.all([subscriptionDigest(cfg, { soonDays: await readSoonDays(cfg) }), cfg.kv.get('revoked')])
    let revoked = 0
    try { const parsed = JSON.parse(revokedRaw ?? '[]'); revoked = Array.isArray(parsed) ? parsed.length : 0 } catch { revoked = 0 }
    return menuReply(chatId, formatStatsAr(digest, { revoked }), [[button('⏳ تفاصيل المنتهية/الموشكة', 'panel:digest')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  if (data === 'panel:notice:all') return noticeLevelReply(cfg, chatId, { scope: 'global' })
  /* بند 10: اختيار درجة الإلزام ثم كتابة النص — الدرجة تحدّد طريقة العرض عند العميل */
  if (action === 'panel' && parts[1] === 'noticelevel' && parts[2] && parts[3]) {
    const level = normalizeNoticeLevel(parts[2])
    const scope = parts[3] === 'customer' ? 'customer' : 'global'
    const customerHash = scope === 'customer' ? parts[4] : ''
    if (scope === 'customer' && !/^[0-9a-f]{16}$/.test(customerHash)) return panelHome(chatId, '⚠️ العميل غير محدد.')
    await startFlow(cfg, chatId, { kind: 'notice', scope, level, customerHash })
    const where = scope === 'global' ? 'لجميع العملاء' : 'لهذا العميل (كل أجهزته)'
    const hint = level === 'critical'
      ? '🚨 ستظهر <b>نافذة منبثقة لا تُغلق</b> إلا بزر «تمّت القراءة»، ويصلك عدد من قرأها.'
      : level === 'important'
        ? '⚠️ ستظهر <b>نافذة منبثقة</b> مع خيار «لاحقاً»، ويصلك عدد من قرأها.'
        : '📣 سيظهر في <b>جرس التنبيهات</b> وتوست عابر — بلا مقاطعة.'
    return flowPrompt(chatId, `اكتب نص التنبيه ${where}.\n${hint}`)
  }
  /* بند 10: التنبيهات المرسلة وعدد إقرارات القراءة */
  if (data === 'panel:noticelist') return noticeListReply(cfg, chatId)
  /* بند 1 (تدقيق 2026-10-08): صندوق الدعم من اللوحة — عبر الجسر إلى عامل
     قناة الدعم (cloud/worker.js) حيث التخزين وHMAC v2. */
  if (data === 'panel:support') return supportInboxReply(cfg, chatId)
  if (action === 'support-thread' && parts[1]) return supportThreadReply(cfg, chatId, parts.slice(1).join(':'))
  if (action === 'support-reply' && parts[1]) {
    const deviceId = parts.slice(1).join(':')
    await startFlow(cfg, chatId, { kind: 'supportreply', deviceId })
    return flowPrompt(chatId, `اكتب ردك للعميل <code>${deviceId}</code> — يصله داخل التطبيق خلال 30 ثانية.`)
  }
  if (data === 'panel:about') return aboutMenuReply(cfg, chatId)
  if (action === 'panel' && parts[1] === 'aboutfield' && parts[2]) {
    const field = ABOUT_FIELDS.find((f) => f.key === parts[2])
    if (!field) return aboutMenuReply(cfg, chatId, '⚠️ حقل غير معروف.')
    await startFlow(cfg, chatId, { kind: 'aboutfield', key: field.key })
    const doc = await readAbout(cfg)
    return flowPrompt(chatId, `✏️ <b>${field.labelAr}</b>\nأرسل القيمة الجديدة${field.kind ? ` (تُعقَّم: ${field.kind})` : ''}.\nالحالي: <code>${doc[field.key] || '—'}</code>\nأرسل «مسح» لتفريغه، أو «رجوع» للقائمة.`)
  }
  if (data === 'panel:aboutextra') {
    await startFlow(cfg, chatId, { kind: 'aboutextra', step: 'label' })
    return flowPrompt(chatId, '➕ حقل حر يظهر في «حول» (مثال: الرقم الضريبي، الفرع الثاني، ساعات الطوارئ).\nأرسل <b>اسم الحقل</b> أولاً.')
  }
  if (data === 'panel:aboutsocial') {
    await startFlow(cfg, chatId, { kind: 'aboutsocial', step: 'label' })
    return flowPrompt(chatId, '🔗 قناة تواصل إضافية (فيسبوك/إنستغرام/يوتيوب…).\nأرسل <b>اسم القناة</b> أولاً.')
  }
  if (action === 'panel' && parts[1] === 'aboutextradel') {
    const res = await removeAboutExtraField(cfg, parts[2])
    return aboutMenuReply(cfg, chatId, res.ok ? `🗑️ حُذف الحقل «${res.removed.label}».` : `⚠️ ${res.reasonAr}`)
  }
  if (action === 'panel' && parts[1] === 'aboutsocialdel') {
    const res = await removeAboutSocialLink(cfg, parts[2])
    return aboutMenuReply(cfg, chatId, res.ok ? `🗑️ حُذفت قناة «${res.removed.label}».` : `⚠️ ${res.reasonAr}`)
  }
  if (data === 'panel:aboutpreview') {
    const doc = await readAbout(cfg)
    return menuReply(chatId, previewAboutAr(doc), [[button('✏️ تحرير الحقول', 'panel:about')], [button('🏠 القائمة الرئيسية', 'panel:home')]])
  }
  if (data === 'panel:cancel') {
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return panelHome(chatId, 'أُلغيت العملية.')
  }
  if (action === 'group') return groupReply(cfg, chatId, parts[1])
  if (action === 'notice-group' && /^[0-9a-f]{16}$/.test(parts[1] ?? '')) {
    const group = await findCustomer(cfg, parts[1])
    if (!group) return clientsReply(cfg, chatId)
    return noticeLevelReply(cfg, chatId, { scope: 'customer', customerHash: group.hash, customerName: group.name })
  }
  if (action === 'client') return clientReply(cfg, chatId, parts[1])
  if (action === 'adddevice') {
    const group = await findCustomer(cfg, parts[1])
    if (!group) return clientsReply(cfg, chatId)
    await startFlow(cfg, chatId, { kind: 'add_device', customer: group.name })
    return flowPrompt(chatId, `أرسل معرّف الجهاز الجديد للعميل ${tgEscape(group.name)}.`)
  }
  /* بند 10: كل مداخل التنبيه تمرّ عبر قائمة الدرجات — فلا تنبيه بلا درجة معلنة */
  if (action === 'notice' && parts[1] === 'all') return noticeLevelReply(cfg, chatId, { scope: 'global' })
  if (action === 'notice' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const hash = await hashCustomerName(device.customer)
    return noticeLevelReply(cfg, chatId, { scope: 'customer', customerHash: hash, customerName: device.customer })
  }
  if (action === 'renew' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const result = await issueForDevice(cfg, device.deviceId, device.customer)
    return clientReply(cfg, chatId, device.deviceId).then((reply) => ({
      ...reply,
      text: `✅ صدر مفتاح جديد للعميل ${tgEscape(device.customer)}. بعد إدخاله في التطبيق ستُستخدم الإعدادات الجديدة:\n<code>${result.key}</code>`,
    }))
  }
  if (action === 'csettings' && DEVICE_RE.test(parts[1] ?? '')) return clientSettingsReply(cfg, chatId, parts[1])
  if (action === 'creset' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const hash = await hashCustomerName(device.customer)
    await cfg.kv.delete(settingKey(hash))
    return clientSettingsReply(cfg, chatId, device.deviceId)
  }
  if (action === 'issue' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const result = await issueForDevice(cfg, device.deviceId, device.customer)
    return menuReply(chatId, `✅ صدر مفتاح جديد للعميل ${tgEscape(device.customer)}. أدخله في التطبيق لتطبيق الإعدادات:\n<code>${result.key}</code>`, [
      [button('⬅️ رجوع للعميل', `client:${device.deviceId}`)],
      [button('🏠 القائمة الرئيسية', 'panel:home')],
    ])
  }
  if (action === 'revoke' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    return menuReply(chatId, `هل تريد إبطال رخصة ${tgEscape(device.customer)} للجهاز ${device.deviceId}؟`, [
      [button('نعم، أبطلها', `revokeconfirm:${device.deviceId}`), button('إلغاء', `client:${device.deviceId}`)],
    ])
  }
  if (action === 'revokeconfirm' && DEVICE_RE.test(parts[1] ?? '')) {
    const ok = await revokeDevice(cfg, parts[1])
    return clientReply(cfg, chatId, parts[1]).then((reply) => ({ ...reply, text: ok ? `🔥 أُبطلت رخصة ${parts[1]}. سيصل الإبطال للتطبيق في المزامنة القادمة.` : 'لا يوجد مفتاح مسجل لإبطاله.' }))
  }

  if (action === 'g' && parts[1] === 'plan' && PLANS.includes(parts[2])) {
    await writeGlobalSettings(cfg, { plan: parts[2], ...(parts[2] === 'lifetime' ? { days: 0 } : {}) })
    return globalSettingsReply(cfg, chatId)
  }
  if (action === 'g' && parts[1] === 'days' && /^\d+$/.test(parts[2] ?? '')) {
    await writeGlobalSettings(cfg, { days: Number(parts[2]) })
    return globalSettingsReply(cfg, chatId)
  }
  if (action === 'g' && parts[1] === 'feature' && parts[2] === 'module' && Object.hasOwn(MODULE_LABELS, parts[3])) {
    const global = await readGlobalSettings(cfg)
    const extraModules = global.extraModules.includes(parts[3]) ? global.extraModules.filter((m) => m !== parts[3]) : [...global.extraModules, parts[3]]
    await writeGlobalSettings(cfg, { extraModules })
    return globalSettingsReply(cfg, chatId)
  }
  if (action === 'g' && parts[1] === 'feature' && Object.hasOwn(FEATURE_LABELS, parts[2])) {
    const global = await readGlobalSettings(cfg)
    const features = global.features.includes(parts[2]) ? global.features.filter((f) => f !== parts[2]) : [...global.features, parts[2]]
    await writeGlobalSettings(cfg, { features })
    return globalSettingsReply(cfg, chatId)
  }
  if (action === 'g' && parts[1] === 'num' && ['extraUsers', 'extraBranches'].includes(parts[2])) {
    await startFlow(cfg, chatId, { kind: 'number', scope: 'global', field: parts[2] })
    return flowPrompt(chatId, `أرسل العدد الجديد لـ${parts[2] === 'extraUsers' ? 'المستخدمين الإضافيين' : 'الفروع الإضافية'} (0 إلى 99).`)
  }

  if (action === 'c' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const [stored, global] = await Promise.all([readCustomerSettings(cfg, device.customer), readGlobalSettings(cfg)])
    const patch = { ...stored.settings }
    if (parts[2] === 'plan' && PLANS.includes(parts[3])) {
      patch.plan = parts[3]
      if (parts[3] === 'lifetime') patch.days = 0
    }
    else if (parts[2] === 'days' && /^\d+$/.test(parts[3] ?? '')) patch.days = Number(parts[3])
    else if (parts[2] === 'feature' && parts[3] === 'module' && Object.hasOwn(MODULE_LABELS, parts[4])) {
      const modules = patch.extraModules ?? global.extraModules
      patch.extraModules = modules.includes(parts[4]) ? modules.filter((m) => m !== parts[4]) : [...modules, parts[4]]
    } else if (parts[2] === 'feature' && Object.hasOwn(FEATURE_LABELS, parts[3])) {
      const features = patch.features ?? global.features
      patch.features = features.includes(parts[3]) ? features.filter((f) => f !== parts[3]) : [...features, parts[3]]
    } else return clientSettingsReply(cfg, chatId, device.deviceId)
    await cfg.kv.put(settingKey(stored.hash), JSON.stringify(sanitizeSettings(patch, {})))
    return clientSettingsReply(cfg, chatId, device.deviceId)
  }
  if (action === 'cnum' && DEVICE_RE.test(parts[1] ?? '') && ['extraUsers', 'extraBranches'].includes(parts[2])) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const hash = await hashCustomerName(device.customer)
    await startFlow(cfg, chatId, { kind: 'number', scope: 'customer', customerHash: hash, customer: device.customer, deviceId: device.deviceId, field: parts[2] })
    return flowPrompt(chatId, `أرسل العدد الخاص بالعميل ${tgEscape(device.customer)} (0 إلى 99).`)
  }
  if (data === 'panel:help') return panelHome(chatId)
  return null
}

export async function acknowledgePanelCallback(token, callbackId) {
  if (!token || !callbackId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId }),
    })
  } catch { /* سيُعاد إرسال التحديث إذا تعذّر الرد */ }
}
