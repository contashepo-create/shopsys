/**
 * ملخص الاشتراكات — تنبيهات المطوّر عن الاشتراكات القريبة من الانتهاء
 * (بند 3+4 من تدقيق 2026-10-08، ومراجعة المرحلة ③).
 *
 * كان هذا المنطق موجوداً في `cloud/worker.js` فقط، وهو **عامل آخر** بمساحة KV
 * أخرى يقرأ مفاتيح `sub:*` — بينما مركز التحكم الفعلي (هذا المجلد) يكتب `dev:*`.
 * النتيجة: لا تذكير يعمل. هذا الملف يقرأ المصدر الحقيقي `dev:*`.
 *
 * يُستدعى من ثلاثة أماكن:
 *   ① `scheduled()` اليومي (cron في wrangler.toml) — بلا أمر من المطوّر.
 *   ② أمر `/تذكير` — عند الطلب.
 *   ③ زر «⏳ الاشتراكات» في لوحة الأزرار — عند الطلب.
 *
 * ما الذي يُنبَّه عنه؟ **القريبة من الانتهاء فقط**: من اليوم (0) حتى SOON_DAYS
 * (افتراضياً 6 = «أقل من أسبوع»). المنتهية **لا تدخل التذكير**: كانت تُرسل كل يوم
 * عن عميل انتهى منذ أيام، وهذا إزعاج بلا فعل؛ عددها يظهر في «📊 الإحصائيات».
 *
 * قاعدة الإزعاج: لا قريبة ⇒ **لا رسالة تلقائية إطلاقاً** (لا إشعار يومي فارغ).
 * قاعدة التكرار: علامة `digest-sent:<اليوم>` ⇒ رسالة تلقائية واحدة في اليوم، وفيها
 * سطر واحد لكل جهاز ⇒ لا يُذكر العميل أكثر من مرة في اليوم.
 */
import { tgEscape } from './tgHtml.js'

/** نافذة «قرب الانتهاء» بالأيام: 0..6 = «أقل من أسبوع» (طلب المالك) */
export const SOON_DAYS = 6

/** مفتاح منع التكرار اليومي للـcron (KV ليس ذرياً، لكنه كافٍ لمنظومة أحادية المطوّر) */
export const digestMarkerKey = (dayIso) => `digest-sent:${dayIso}`

/** نافذة «قرب الانتهاء» التي ضبطها المطوّر من اللوحة (وإلا الافتراضي) */
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

/* ── فهرس الاشتراكات في metadata المفاتيح ───────────────────────────────────
 * الـcron يمسح **كل** الأجهزة: `kv.list` نداء واحد لكل 1000 مفتاح، لكن قراءة كل
 * سجل `kv.get` نداء مستقل — وخطط Cloudflare المجانية تحدّ النداءات الفرعية بـ50
 * في الطلب الواحد، أي أن التذكير اليومي كان ينهار بصمت (`catch {}` في scheduled)
 * عند نحو 48 جهازاً. الحل: نكتب ملخص الاشتراك في metadata المفتاح عند كل إصدار
 * أو تجديد، فيُصنَّف المسح من `list` وحده. السجلات القديمة (بلا فهرس) تُقرأ
 * بعدد محدود ثم **تُفهرس** أثناء المسح فتختفي الكلفة من أول دورة. */
export const DEVICE_META_VERSION = 1
/** أقصى قراءات `get` في المسح الواحد — يبقى تحت حدّ النداءات الفرعية */
export const DIGEST_MAX_READS = 40

export function deviceMetadata(record) {
  const str = (v, max) => String(v ?? '').slice(0, max)
  return {
    v: DEVICE_META_VERSION,
    expiresAt: record && record.expiresAt ? str(record.expiresAt, 20) : null,
    customer: str(record && record.customer, 120),
    plan: str(record && record.plan, 20),
    email: str(record && record.email, 128),
  }
}

/**
 * مسح كل أجهزة المركز وتصنيفها: منتهية · قريبة (≤ soonDays) · مدى الحياة.
 * `expiresAt` بصيغة YYYY-MM-DD كما يكتبها `expiresAfterDays` في licenseLib.
 * يعيد أيضاً `skipped` (ما لم يُفحص لتجاوز حدّ القراءات) و`viaMetadata`
 * (ما صُنّف من الفهرس بلا قراءة) — يظهر تحذير صريح للمطوّر لو تُرِك شيء.
 */
export async function subscriptionDigest(cfg, { soonDays = SOON_DAYS, now = Date.now(), maxReads = DIGEST_MAX_READS } = {}) {
  const expired = []
  const soon = []
  let total = 0
  let lifetime = 0
  let malformed = 0
  let skipped = 0
  let viaMetadata = 0
  let reads = 0
  let cursor
  for (let page = 0; page < 20; page++) {
    const listed = await cfg.kv.list({ prefix: 'dev:', limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const key of listed.keys ?? []) {
      total++
      let device = null
      const meta = key.metadata
      if (meta && meta.v === DEVICE_META_VERSION && typeof meta.customer === 'string') {
        device = meta
        viaMetadata++
      } else if (reads < maxReads) {
        reads++
        let raw = null
        try { raw = await cfg.kv.get(key.name) } catch { raw = null }
        try { device = JSON.parse(raw ?? 'null') } catch { device = null }
        /* فهرسة السجل القديم وهو في مكانه: القيمة نفسها حرفياً + metadata.
           من الدورة التالية يُصنَّف بلا قراءة (فشل الفهرسة لا يوقف المسح). */
        if (raw && device && typeof device === 'object') {
          try { await cfg.kv.put(key.name, raw, { metadata: deviceMetadata(device) }) } catch { /* تحسين */ }
        }
      } else {
        skipped++
        continue
      }
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
  // الأخطر أولاً: الأقرب انتهاءً فوق القائمة (القريبة) والأقدم انتهاءً (المنتهية)
  expired.sort((a, b) => a.days - b.days)
  soon.sort((a, b) => a.days - b.days)
  return { total, lifetime, malformed, expired, soon, soonDays, skipped, viaMetadata }
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

/** سطر جهاز قريب من الانتهاء — اسم العميل قد يحوي & فيُهرَّب (انظر tgHtml.js) */
const rowAr = (row) => {
  const when = row.days === 0 ? 'ينتهي اليوم' : `يتبقى ${daysWordAr(row.days)}`
  return `⏳ <b>${tgEscape(row.customer)}</b> — ${tgEscape(planAr(row.plan))}\n   <code>${tgEscape(row.deviceId)}</code> · ${when} (${row.expiresAt})${row.email ? ` · ${tgEscape(row.email)}` : ''}`
}

/** هل يوجد ما يستحق رسالة؟ — القريبة وحدها (المنتهية لا تُرسل تلقائياً) */
export const hasDigestNews = (digest) => digest.soon.length > 0

/** نص رسالة التليجرام — HTML كما في باقي ردود المركز */
export function formatDigestAr(digest, { daily = false } = {}) {
  const head = daily ? '⏰ <b>تذكير الاشتراكات اليومي</b>' : '⏰ <b>تذكير الاشتراكات</b>'
  const window = daysWordAr(digest.soonDays, true)
  if (!hasDigestNews(digest)) {
    /* لا «كل شيء سليم» صامتاً: لو تُركت أجهزة بلا فحص فالخبر ناقص ويُقال صراحةً.
       والمنتهية تُذكر **عدداً** فقط — لا قائمة، فهي خارج التذكير اليومي. */
    const expiredNote = digest.expired.length
      ? `\n⛔ منتهية حالياً: ${digest.expired.length} — لا يُرسل عنها تنبيه يومي (التفاصيل في «📊 إحصائيات»)`
      : ''
    const tail = digest.skipped ? `\n${scanWarningAr(digest.skipped)}` : ''
    return `${head}\n✅ لا اشتراكات تنتهي خلال ${window}.\n📊 المسجل: ${digest.total} جهاز (منها ${digest.lifetime} مدى الحياة)${expiredNote}${tail}`
  }
  const lines = [head, '', `⏳ <b>تنتهي خلال ${window} (${digest.soon.length})</b>`]
  lines.push(...digest.soon.slice(0, 40).map(rowAr))
  if (digest.soon.length > 40) lines.push(`   … و${digest.soon.length - 40} غيرها`)
  lines.push('')
  lines.push(`📊 المسجل: ${digest.total} جهاز · مدى الحياة: ${digest.lifetime}`)
  if (digest.skipped) lines.push(scanWarningAr(digest.skipped))
  lines.push('💡 التجديد: افتح العميل من «👥 العملاء» ← «🔑 إصدار أو تجديد الرخصة»')
  return lines.join('\n')
}

/** سطر الإحصائيات للوحة — هنا فقط يظهر عدد المنتهية */
export function formatStatsAr(digest, extra = {}) {
  return [
    '📊 <b>إحصائيات المركز</b>',
    `👥 أجهزة مسجلة: ${digest.total}`,
    `♾️ مدى الحياة: ${digest.lifetime}`,
    `⏳ تنتهي خلال ${daysWordAr(digest.soonDays, true)}: ${digest.soon.length}`,
    `⛔ منتهية: ${digest.expired.length}`,
    ...(extra.revoked != null ? [`🔥 مفاتيح محروقة: ${extra.revoked}`] : []),
    ...(extra.licenses != null ? [`🔑 مفاتيح صادرة: ${extra.licenses}`] : []),
    ...(extra.notices != null ? [`🔔 تنبيهات عامة نشطة: ${extra.notices}`] : []),
    ...(digest.malformed ? [`⚠️ سجلات تالفة تُجاوزت: ${digest.malformed}`] : []),
    ...(digest.skipped ? [scanWarningAr(digest.skipped)] : []),
  ].join('\n')
}

/** تحذير صريح للمطوّر: جزء من الأجهزة لم يُفحص في هذه الدورة (لا صمت) */
export function scanWarningAr(skipped) {
  return `⚠️ لم يُفحص ${skipped} جهازاً في هذه الدورة (حدّ ${DIGEST_MAX_READS} قراءة للطلب — قيد الخطة المجانية). تُفهرس السجلات تلقائياً مع كل تجديد، فتنخفض الكلفة كل دورة؛ ولو بقي الرقم مرتفعاً ارفع خطة العامل.`
}
