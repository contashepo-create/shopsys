import { issueLicenseKey, keyFingerprint, expiresAfterDays } from './licenseLib.js'

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
  [button('👥 العملاء', 'panel:clients'), button('➕ إضافة عميل', 'panel:new')],
  [button('⚙️ الإعداد العام', 'panel:global'), button('🔔 تنبيه للجميع', 'panel:notice:all')],
  [button('📝 تعديل «حول»', 'panel:about')],
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

async function listDevices(cfg) {
  const rows = []
  let cursor
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await cfg.kv.list({ prefix: 'dev:', limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const key of page.keys ?? []) {
      const raw = await cfg.kv.get(key.name)
      if (!raw) continue
      const value = parseObject(raw)
      const deviceId = key.name.slice(4)
      rows.push({ deviceId, customer: cleanText(value.customer || 'عميل غير مسمى', 100), ...value })
    }
    if (page.list_complete || !page.cursor) break
    cursor = page.cursor
  }
  return rows
}

async function customerGroups(cfg) {
  const groups = new Map()
  for (const device of await listDevices(cfg)) {
    const normalized = normalizedName(device.customer)
    if (!normalized) continue
    const group = groups.get(normalized) ?? { name: device.customer, devices: [] }
    group.devices.push(device)
    groups.set(normalized, group)
  }
  const out = []
  for (const group of groups.values()) out.push({ ...group, hash: await hashCustomerName(group.name) })
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ar'))
}

async function findCustomer(cfg, hash) {
  return (await customerGroups(cfg)).find((group) => group.hash === hash) ?? null
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

export async function getNotificationsForDevice(cfg, deviceId) {
  const deviceKey = `notices:${deviceId}`
  const all = [...parseList(await cfg.kv.get('notices:global')), ...parseList(await cfg.kv.get(deviceKey))]
  const now = Date.now()
  return all
    .filter((notice) => notice && typeof notice.id === 'string' && typeof notice.body === 'string'
      && (!notice.expiresAt || Date.parse(notice.expiresAt) > now))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-50)
}

async function appendNotice(cfg, key, body) {
  const now = new Date()
  const notice = {
    id: crypto.randomUUID(),
    title: 'رسالة من المطوّر',
    body,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }
  const previous = parseList(await cfg.kv.get(key)).filter((n) => n?.expiresAt && Date.parse(n.expiresAt) > now.getTime())
  previous.push(notice)
  await cfg.kv.put(key, JSON.stringify(previous.slice(-50)))
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
  return menuReply(chatId, `إعدادات ${device.customer}\nالتغييرات تحفظ كاستثناء للعميل ولا تغيّر الرخصة الحالية حتى تصدر مفتاحاً جديداً.`, rows)
}

async function clientReply(cfg, chatId, deviceId) {
  const device = await getDevice(cfg, deviceId)
  if (!device) return panelHome(chatId, 'لم أجد هذا العميل.')
  const license = await currentLicense(cfg, device)
  const rows = [
    [button('🔑 إصدار أو تجديد الرخصة', `issue:${deviceId}`)],
    [button('⚙️ إعدادات خاصة لهذا العميل', `csettings:${deviceId}`)],
    [button('🔔 إرسال تنبيه لهذا العميل', `notice:${deviceId}`)],
    [button('🔥 إبطال الرخصة', `revoke:${deviceId}`), button('➕ إضافة جهاز للعميل', `adddevice:${hash}`)],
    [button('⬅️ رجوع لقائمة العملاء', 'panel:clients')],
  ]
  const status = device.fingerprint && parseList(await cfg.kv.get('revoked')).includes(device.fingerprint) ? 'مبطلة' : 'سارية'
  const text = [
    `👤 ${device.customer}`,
    `الجهاز: ${deviceId}`,
    `الخطة: ${PLAN_LABELS[license?.plan] ?? device.plan ?? 'غير مسجلة'}`,
    `الانتهاء: ${license?.expiresAt ?? device.expiresAt ?? '—'}`,
    `حالة المفتاح: ${status}`,
  ].join('\n')
  return menuReply(chatId, text, rows)
}

async function clientsReply(cfg, chatId) {
  const groups = await customerGroups(cfg)
  if (!groups.length) {
    return menuReply(chatId, 'لا يوجد عملاء مسجلون بعد. أضف أول عميل، وبعدها سيظهر اسمه هنا للاختيار.', [
      [button('➕ إضافة أول عميل وإصدار رخصة', 'panel:new')],
      [button('⬅️ القائمة الرئيسية', 'panel:home')],
    ])
  }
  const rows = groups.slice(0, 80).map((group) => [button(`👤 ${group.name} (${group.devices.length} جهاز)`, `group:${group.hash}`)])
  rows.push([button('➕ إضافة عميل جديد', 'panel:new')], [button('⬅️ القائمة الرئيسية', 'panel:home')])
  return menuReply(chatId, `اختر اسم العميل (${groups.length}):`, rows)
}

async function groupReply(cfg, chatId, hash) {
  const group = await findCustomer(cfg, hash)
  if (!group) return clientsReply(cfg, chatId)
  const rows = group.devices.map((device) => [button(`${device.deviceId.slice(-4)} — ${device.plan ?? 'رخصة'}`, `client:${device.deviceId}`)])
  rows.push([button('🔔 إرسال تنبيه لكل أجهزة العميل', `notice-group:${hash}`)])
  rows.push([button('➕ إضافة جهاز لهذا العميل', `adddevice:${hash}`)])
  rows.push([button('⬅️ رجوع للعملاء', 'panel:clients')])
  return menuReply(chatId, `أجهزة العميل: ${group.name}`, rows)
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
  await cfg.kv.put(`dev:${deviceId}`, JSON.stringify({
    ...(device ?? {}), customer: customerName, plan: payload.plan, expiresAt: payload.expiresAt,
    fingerprint, message: device?.message ?? '',
  }))
  return { payload, key, fingerprint }
}

async function saveNoticeForCustomer(cfg, group, body) {
  for (const device of group.devices) await appendNotice(cfg, `notices:${device.deviceId}`, body)
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
      return flowPrompt(chatId, `حُفظ اسم العميل «${flow.customer}». أرسل الآن معرّف الجهاز الظاهر في شاشة التفعيل.`)
    }
    if (flow.step === 'device') {
      const deviceId = value.toUpperCase()
      if (!DEVICE_RE.test(deviceId)) return flowPrompt(chatId, 'معرّف الجهاز غير صحيح. انسخه كما يظهر في شاشة التفعيل ثم أرسله هنا.')
      if (await cfg.kv.get(`dev:${deviceId}`)) return flowPrompt(chatId, 'هذا الجهاز مسجل بالفعل. افتحه من قائمة العملاء بدلاً من إضافته مرة أخرى.')
      await cfg.kv.delete(`ui-flow:${chatId}`)
      const result = await issueForDevice(cfg, deviceId, flow.customer)
      return panelHome(chatId, `✅ أُضيف ${flow.customer}\nأرسل هذا المفتاح للعميل ليدخله في التطبيق:\n<code>${result.key}</code>\n\nالخطة الافتراضية: ${PLAN_LABELS[result.payload.plan]} · الانتهاء: ${result.payload.expiresAt ?? 'مدى الحياة'}`)
    }
  }

  if (flow.kind === 'add_device') {
    const deviceId = value.toUpperCase()
    if (!DEVICE_RE.test(deviceId)) return flowPrompt(chatId, 'معرّف الجهاز غير صحيح. انسخه كما يظهر في شاشة التفعيل ثم أرسله هنا.')
    if (await cfg.kv.get(`dev:${deviceId}`)) return flowPrompt(chatId, 'هذا الجهاز مسجل بالفعل.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    const result = await issueForDevice(cfg, deviceId, flow.customer)
    return panelHome(chatId, `✅ أُضيف جهاز للعميل ${flow.customer}\nأرسل المفتاح الجديد لهذا الجهاز:\n<code>${result.key}</code>`)
  }

  if (flow.kind === 'notice') {
    if (!value) return flowPrompt(chatId, 'اكتب نص التنبيه أولاً.')
    await cfg.kv.delete(`ui-flow:${chatId}`)
    if (flow.scope === 'global') {
      await appendNotice(cfg, 'notices:global', value)
      return panelHome(chatId, '✅ حُفظ التنبيه العام. سيظهر في التطبيق عند اتصاله بكلاودفلير.')
    }
    const group = await findCustomer(cfg, flow.customerHash)
    if (!group) return panelHome(chatId, 'لم أجد العميل؛ لم يُرسل التنبيه.')
    const count = await saveNoticeForCustomer(cfg, group, value)
    return panelHome(chatId, `✅ حُفظ التنبيه للعميل ${group.name} (${count} جهاز).`)
  }

  if (flow.kind === 'about') {
    if (!value) return flowPrompt(chatId, 'اكتب نص صفحة «حول» أو أرسل كلمة «مسح».')
    await cfg.kv.put('about', value === 'مسح' ? '' : value)
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return panelHome(chatId, value === 'مسح' ? '🧹 مُسح نص صفحة «حول».' : '✅ حُدّث نص صفحة «حول».')
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

  return null
}

export async function handlePanelButton(data, chatId, cfg) {
  const parts = String(data ?? '').split(':')
  const action = parts[0]
  if (data === 'panel:home') return panelHome(chatId)
  if (data === 'panel:clients') return clientsReply(cfg, chatId)
  if (data === 'panel:new') {
    await startFlow(cfg, chatId, { kind: 'new_customer', step: 'name' })
    return flowPrompt(chatId, 'أدخل اسم العميل الجديد مرة واحدة. بعد ذلك ستختاره من قائمة العملاء.')
  }
  if (data === 'panel:global') return globalSettingsReply(cfg, chatId)
  if (data === 'panel:notice:all') {
    await startFlow(cfg, chatId, { kind: 'notice', scope: 'global' })
    return flowPrompt(chatId, 'اكتب التنبيه الذي تريد إرساله لجميع العملاء. سيظهر في جرس التطبيق، وتظهر نافذة عند استلامه أثناء تشغيل التطبيق.')
  }
  if (data === 'panel:about') {
    await startFlow(cfg, chatId, { kind: 'about' })
    return flowPrompt(chatId, 'أرسل النص الجديد لقسم «حول». لإفراغه أرسل كلمة «مسح».')
  }
  if (data === 'panel:cancel') {
    await cfg.kv.delete(`ui-flow:${chatId}`)
    return panelHome(chatId, 'أُلغيت العملية.')
  }
  if (action === 'group') return groupReply(cfg, chatId, parts[1])
  if (action === 'notice-group' && /^[0-9a-f]{16}$/.test(parts[1] ?? '')) {
    const group = await findCustomer(cfg, parts[1])
    if (!group) return clientsReply(cfg, chatId)
    await startFlow(cfg, chatId, { kind: 'notice', scope: 'customer', customerHash: group.hash })
    return flowPrompt(chatId, `اكتب نص التنبيه للعميل ${group.name}. سيصل لكل أجهزته المسجلة.`)
  }
  if (action === 'client') return clientReply(cfg, chatId, parts[1])
  if (action === 'adddevice') {
    const group = await findCustomer(cfg, parts[1])
    if (!group) return clientsReply(cfg, chatId)
    await startFlow(cfg, chatId, { kind: 'add_device', customer: group.name })
    return flowPrompt(chatId, `أرسل معرّف الجهاز الجديد للعميل ${group.name}.`)
  }
  if (action === 'notice' && parts[1] === 'all') {
    await startFlow(cfg, chatId, { kind: 'notice', scope: 'global' })
    return flowPrompt(chatId, 'اكتب نص التنبيه لجميع العملاء.')
  }
  if (action === 'notice' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const hash = await hashCustomerName(device.customer)
    await startFlow(cfg, chatId, { kind: 'notice', scope: 'customer', customerHash: hash })
    return flowPrompt(chatId, `اكتب نص التنبيه للعميل ${device.customer}. سيصل لكل أجهزته المسجلة.`)
  }
  if (action === 'renew' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    const result = await issueForDevice(cfg, device.deviceId, device.customer)
    return clientReply(cfg, chatId, device.deviceId).then((reply) => ({
      ...reply,
      text: `✅ صدر مفتاح جديد للعميل ${device.customer}. بعد إدخاله في التطبيق ستُستخدم الإعدادات الجديدة:\n<code>${result.key}</code>`,
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
    return menuReply(chatId, `✅ صدر مفتاح جديد للعميل ${device.customer}. أدخله في التطبيق لتطبيق الإعدادات:\n<code>${result.key}</code>`, [
      [button('⬅️ رجوع للعميل', `client:${device.deviceId}`)],
      [button('🏠 القائمة الرئيسية', 'panel:home')],
    ])
  }
  if (action === 'revoke' && DEVICE_RE.test(parts[1] ?? '')) {
    const device = await getDevice(cfg, parts[1])
    if (!device) return clientsReply(cfg, chatId)
    return menuReply(chatId, `هل تريد إبطال رخصة ${device.customer} للجهاز ${device.deviceId}؟`, [
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
    return flowPrompt(chatId, `أرسل العدد الخاص بالعميل ${device.customer} (0 إلى 99).`)
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
