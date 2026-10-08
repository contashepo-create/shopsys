/**
 * ملخص الاشتراكات — تنبيهات الانتهاء وقرب الانتهاء للمطوّر
 * (بند 3+4 من تدقيق 2026-10-08).
 *
 * كان هذا المنطق موجوداً في `cloud/worker.js` فقط، وهو **عامل آخر** بمساحة KV
 * أخرى يقرأ مفاتيح `sub:*` — بينما مركز التحكم الفعلي (هذا المجلد) يكتب
 * `dev:*`. النتيجة: لا تذكير يعمل. هذا الملف يقرأ المصدر الحقيقي `dev:*`.
 *
 * يُستدعى من ثلاثة أماكن:
 *   ① `scheduled()` اليومي (cron في wrangler.toml) — بلا أمر من المطوّر.
 *   ② أمر `/تذكير` — عند الطلب.
 *   ③ زر «⏳ الاشتراكات» في لوحة الأزرار.
 *
 * قاعدة الإزعاج: لا شيء منتهٍ ولا موشك ⇒ **لا رسالة إطلاقاً** (لا إشعار يومي فارغ).
 */

/** نافذة «قرب الانتهاء» بالأيام — طلب المالك: 10 أيام */
export const SOON_DAYS = 10

/** مفتاح منع التكرار اليومي للـcron (KV ليس ذرياً، لكنه كافٍ لمنظومة أحادية المطوّر) */
export const digestMarkerKey = (dayIso) => `digest-sent:${dayIso}`

/** نافذة «قرب الانتهاء» التي ضبطها المطوّر من اللوحة (وإلا الافتراضي 10 أيام) */
export const DIGEST_SETTINGS_KEY = 'settings:digest'

/** قراءة النافذة المضبوطة — أي قيمة تالفة/خارج المدى ترجع للافتراضي */
export async function readSoonDays(cfg, fallback = SOON_DAYS) {
  try {
    const raw = await cfg.kv.get(DIGEST_SETTINGS_KEY)
    if (!raw) return fallback
    const value = Number(JSON.parse(raw)?.soonDays)
    return Number.isInteger(value) && value >= 1 && value <= 90 ? value : fallback
  } catch { return fallback }
}

export async function writeSoonDays(cfg, soonDays) {
  const value = Number.isInteger(soonDays) && soonDays >= 1 && soonDays <= 90 ? soonDays : SOON_DAYS
  await cfg.kv.put(DIGEST_SETTINGS_KEY, JSON.stringify({ soonDays: value }))
  return value
}

/**
 * مسح كل أجهزة المركز وتصنيفها: منتهية · موشكة (≤ soonDays) · مدى الحياة.
 * `expiresAt` بصيغة YYYY-MM-DD كما يكتبها `expiresAfterDays` في licenseLib.
 */
export async function subscriptionDigest(cfg, { soonDays = SOON_DAYS, now = Date.now() } = {}) {
  const expired = []
  const soon = []
  let total = 0
  let lifetime = 0
  let malformed = 0
  let cursor
  for (let page = 0; page < 20; page++) {
    const listed = await cfg.kv.list({ prefix: 'dev:', limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const key of listed.keys ?? []) {
      total++
      let device = null
      try { device = JSON.parse((await cfg.kv.get(key.name)) ?? 'null') } catch { device = null }
      if (!device || typeof device !== 'object') { malformed++; continue }
      const deviceId = key.name.slice(4)
      if (!device.expiresAt) { lifetime++; continue } // دائم — لا تذكير
      const at = Date.parse(String(device.expiresAt).slice(0, 10) + 'T00:00:00Z')
      if (Number.isNaN(at)) { malformed++; continue }
      const days = Math.ceil((at - now) / 86_400_000)
      const row = {
        deviceId,
        customer: String(device.customer ?? 'عميل غير مسمى'),
        plan: String(device.plan ?? ''),
        expiresAt: String(device.expiresAt).slice(0, 10),
        email: typeof device.email === 'string' ? device.email : '',
        days,
      }
      if (days < 0) expired.push(row)
      else if (days <= soonDays) soon.push(row)
    }
    if (listed.list_complete || !listed.cursor) break
    cursor = listed.cursor
  }
  // الأخطر أولاً: الأقدم انتهاءً فوق القائمة
  expired.sort((a, b) => a.days - b.days)
  soon.sort((a, b) => a.days - b.days)
  return { total, lifetime, malformed, expired, soon, soonDays }
}

const PLAN_AR = { trial: 'تجريبي', basic: 'أساسي', pro: 'احترافي', lifetime: 'مدى الحياة' }
const planAr = (plan) => PLAN_AR[plan] ?? plan ?? '؟'

/** صيغة عربية صحيحة للعدد: يوم واحد · يومان/يومين · 3–10 أيام · 11+ يوماً */
const daysWordAr = (n, genitive = false) => {
  if (n === 1) return 'يوم واحد'
  if (n === 2) return genitive ? 'يومين' : 'يومان'
  if (n <= 10) return `${n} أيام`
  return `${n} يوماً`
}

const rowAr = (row, kind) => {
  const when = kind === 'expired'
    ? `انتهى منذ ${daysWordAr(-row.days, true)} (${row.expiresAt})`
    : row.days === 0 ? 'ينتهي اليوم' : `يتبقى ${daysWordAr(row.days)} (${row.expiresAt})`
  return `${kind === 'expired' ? '⛔' : '⏳'} <b>${row.customer}</b> — ${planAr(row.plan)}\n   <code>${row.deviceId}</code> · ${when}${row.email ? ` · ${row.email}` : ''}`
}

/** هل يوجد ما يستحق رسالة؟ (لا إزعاج فارغ) */
export const hasDigestNews = (digest) => digest.expired.length > 0 || digest.soon.length > 0

/** نص رسالة التليجرام — HTML كما في باقي ردود المركز */
export function formatDigestAr(digest, { daily = false } = {}) {
  const head = daily ? '⏰ <b>تذكير الاشتراكات اليومي</b>' : '⏰ <b>تذكير الاشتراكات</b>'
  if (!hasDigestNews(digest)) {
    return `${head}\n✅ لا اشتراكات منتهية ولا موشكة على الانتهاء (≤ ${digest.soonDays} أيام).\n📊 المسجل: ${digest.total} جهاز (منها ${digest.lifetime} مدى الحياة)`
  }
  const lines = [head, '']
  if (digest.expired.length) {
    lines.push(`⛔ <b>منتهية (${digest.expired.length})</b>`)
    lines.push(...digest.expired.slice(0, 40).map((row) => rowAr(row, 'expired')))
    if (digest.expired.length > 40) lines.push(`   … و${digest.expired.length - 40} غيرها`)
    lines.push('')
  }
  if (digest.soon.length) {
    lines.push(`⏳ <b>تنتهي خلال ${digest.soonDays} أيام (${digest.soon.length})</b>`)
    lines.push(...digest.soon.slice(0, 40).map((row) => rowAr(row, 'soon')))
    if (digest.soon.length > 40) lines.push(`   … و${digest.soon.length - 40} غيرها`)
    lines.push('')
  }
  lines.push(`📊 المسجل: ${digest.total} جهاز · مدى الحياة: ${digest.lifetime}`)
  lines.push('💡 التجديد: افتح العميل من «👥 العملاء» ← «🔑 إصدار أو تجديد الرخصة»')
  return lines.join('\n')
}

/** سطر الإحصائيات للوحة (بلا تفاصيل) */
export function formatStatsAr(digest, extra = {}) {
  return [
    '📊 <b>إحصائيات المركز</b>',
    `👥 أجهزة مسجلة: ${digest.total}`,
    `♾️ مدى الحياة: ${digest.lifetime}`,
    `⏳ تنتهي خلال ${digest.soonDays} أيام: ${digest.soon.length}`,
    `⛔ منتهية: ${digest.expired.length}`,
    ...(extra.revoked != null ? [`🔥 مفاتيح محروقة: ${extra.revoked}`] : []),
    ...(extra.licenses != null ? [`🔑 مفاتيح صادرة: ${extra.licenses}`] : []),
    ...(extra.notices != null ? [`🔔 تنبيهات عامة نشطة: ${extra.notices}`] : []),
    ...(digest.malformed ? [`⚠️ سجلات تالفة تُجاوزت: ${digest.malformed}`] : []),
  ].join('\n')
}
