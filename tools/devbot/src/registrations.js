/**
 * بلاغات التسجيل الجديدة — بند 2 من تدقيق 2026-10-08 (جهة العامل).
 * ───────────────────────────────────────────────────────────────────
 * المطوّر لم يكن يعرف بوجود عميل جديد إطلاقاً: معالج أول التشغيل يجمع الاسم
 * والهاتف والبريد والمنشأة والنشاط ثم **لا يُرسل شيئاً** — لا POST في الكود.
 *
 * الآن: `POST /register` يستقبل البلاغ، يعقّمه خادمياً (لا نثق بالعميل)، ويحفظه
 * في `reg:<deviceId>`، ويبلّغ المطوّر على التليجرام **مرة واحدة لكل جهاز**.
 *
 * لماذا نقطة عامة بلا سرّ؟
 *   التطبيق يُوزَّع على أجهزة العملاء وحزمة المُصيّر قابلة للقراءة، فأي سرّ
 *   مضمّن هو سرّ مكشوف. البديل الآمن عملياً: نقطة كتابة محدودة الأثر —
 *     • تُقبل فقط لمعرّف جهاز بصيغة SHOP-XXXX-XXXX-XXXX (لا مفاتيح عشوائية)،
 *     • بلاغ واحد لكل جهاز (المرة الأولى تُبلّغ، وما بعدها تحديث صامت)،
 *     • حد حجم وحقول معقّمة ⇒ لا يمكن استخدامها مخزن بيانات ولا ناقل XSS،
 *     • لا تكشف شيئاً: القراءة محصورة بلوحة المطوّر (أوامر /عميل /بحث).
 *   الأسوأ الذي يمكن لمهاجم فعله: تسجيل بلاغات وهمية بأرقام أجهزة مختلقة
 *   (إزعاج لا اختراق) — ويُحدّ منه حدّ الحجم والتعقيم وعدم كشف أي بيانات.
 */

import { tgEscape } from './tgHtml.js'

export const REG_PREFIX = 'reg:'
export const REG_MAX_BYTES = 8_192
const DEVICE_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/* ── تعقيم مطابق لمنطق العميل (دفاع مزدوج) ── */
export function cleanText(value, max = 200) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

const cleanEmail = (v) => {
  const s = cleanText(v, 128)
  return /^[^\s@<>]{3,64}@[^\s@<>]{3,64}$/.test(s) ? s : ''
}
const cleanPhone = (v) => {
  const s = cleanText(v, 24)
  return /^\+?[0-9][0-9\s-]{5,23}$/.test(s) ? s : ''
}

/**
 * تنقية بلاغ وارد — يعيد كائناً صالحاً أو null إن كان معرّف الجهاز غير صالح.
 * لا يُرمى استثناء أبداً: أي مدخل غريب ⇒ رفض نظيف 400.
 */
export function sanitizeRegistration(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const deviceId = cleanText(raw.deviceId, 24).toUpperCase()
  if (!DEVICE_RE.test(deviceId)) return null
  const out = {
    deviceId,
    appVersion: cleanText(raw.appVersion, 20),
    platform: cleanText(raw.platform, 16) === 'web' ? 'web' : 'desktop',
    shopName: cleanText(raw.shopName, 120),
    ownerName: cleanText(raw.ownerName, 120),
    phone: cleanPhone(raw.phone),
    email: cleanEmail(raw.email),
    city: cleanText(raw.city, 80),
    street: cleanText(raw.street, 160),
    countryCode: cleanText(raw.countryCode, 4).toUpperCase(),
    activityId: cleanText(raw.activityId, 40),
    activityNameAr: cleanText(raw.activityNameAr, 60),
    accountingMode: cleanText(raw.accountingMode, 10) === 'full' ? 'full' : 'simple',
    plan: cleanText(raw.plan, 12) || 'trial',
    registeredAt: cleanText(raw.registeredAt, 30) || new Date().toISOString(),
  }
  const specialty = cleanText(raw.doctorSpecialty, 60)
  if (specialty) out.doctorSpecialty = specialty
  return out
}

export const regKey = (deviceId) => `${REG_PREFIX}${deviceId}`

/* ── سقف تنبيهات التسجيل اليومية ─────────────────────────────────────────────
 * `POST /register` نقطة عامة بلا سرّ (أي سرّ مضمّن في التطبيق مكشوف). التخزين
 * آمن بسبب التعقيم والحدود، لكن **التنبيه** لكل جهاز جديد قناة إزعاج: سكربت
 * بأرقام أجهزة مختلقة يرسل آلاف الرسائل في محادثة المطوّر، وتليجرام يحدّ نحو
 * 20 رسالة/دقيقة للمحادثة الواحدة ⇒ 429 يؤخّر البلاغات الحقيقية.
 * السقف يومي (48 ساعة TTL) ويُسقف التنبيه لا التسجيل. */
export const REG_TG_DAILY_CAP = 25
export const regAlertKey = (dayIso) => `reg-tg:${dayIso}`

/**
 * يستهلك حصة تنبيه واحدة لليوم. يعيد:
 *   allowed      ⇒ هل يُرسل التنبيه الآن
 *   count        ⇒ عدد التنبيهات المرسلة اليوم (بعد هذه)
 *   justCrossed  ⇒ هل هذا آخر تنبيه مسموح اليوم (لإبلاغ المطوّر مرة واحدة)
 * KV ليس ذرّياً: تجاوز طفيف عند التزامن ممكن ومقبول (منظومة أحادية المطوّر).
 */
export async function consumeRegistrationAlert(cfg, dayIso = new Date().toISOString().slice(0, 10)) {
  const key = regAlertKey(dayIso)
  let count = 0
  try { count = Number(await cfg.kv.get(key)) || 0 } catch { count = 0 }
  if (count >= REG_TG_DAILY_CAP) return { allowed: false, count, justCrossed: false }
  try { await cfg.kv.put(key, String(count + 1), { expirationTtl: 172_800 }) } catch { /* السقف تحسين */ }
  /* `justCrossed` مع **آخر تنبيه مسموح** لا بعده: لو أُعيدت مع كل نداء مرفوض
     لأرسلنا تحذير المجاوزة في كل مرة — وهو نفسه إزعاج. */
  return { allowed: true, count: count + 1, justCrossed: count + 1 === REG_TG_DAILY_CAP }
}

/* ── فهرس القائمة في metadata المفتاح ────────────────────────────────────────
 * `kv.list` يعيد metadata كل مفتاح **بلا نداء إضافي**، بينما قراءة كل سجل
 * `kv.get` على حدة. خطط Cloudflare المجانية تحدّ النداءات الفرعية بـ50 للطلب
 * الواحد ⇒ قائمة من 60 تسجيلاً كانت تفشل كلها برسالة خطأ لا تفسير لها.
 * الحل: نكتب ملخص السجل في metadata عند الحفظ، فتُبنى القائمة من `list` وحده.
 * الحد 1024 بايت لكل مفتاح — والملخص أدناه أقصر من ذلك بكثير. */
export const REG_META_VERSION = 1
/** أقصى عدد قراءات `get` في الطلب الواحد (يبقى تحت حدّ الخطة المجانية) */
export const REG_MAX_READS = 40

export function registrationMetadata(record) {
  const str = (v, max) => String(v ?? '').slice(0, max)
  return {
    v: REG_META_VERSION,
    deviceId: str(record.deviceId, 24),
    shopName: str(record.shopName, 120),
    ownerName: str(record.ownerName, 120),
    phone: str(record.phone, 24),
    email: str(record.email, 128),
    activityNameAr: str(record.activityNameAr, 60),
    plan: str(record.plan, 12),
    lastSeenAt: str(record.lastSeenAt, 30),
  }
}

/** هل هذا metadata صالح وكافٍ لعرض القائمة بلا قراءة السجل؟ */
const usableMeta = (meta) => Boolean(meta && meta.v === REG_META_VERSION && typeof meta.deviceId === 'string' && meta.deviceId)

/**
 * حفظ البلاغ — يعيد {saved, isNew, record}.
 * `isNew` هي ما يقرّر التبليغ على التليجرام: أول بلاغ للجهاز ⇒ إبلاغ،
 * وما بعده تحديث صامت (لا إزعاج متكرر عند كل إقلاع/إعادة تثبيت).
 */
export async function saveRegistration(cfg, report) {
  const existingRaw = await cfg.kv.get(regKey(report.deviceId))
  let existing = null
  try {
    const parsed = JSON.parse(existingRaw ?? 'null')
    if (parsed && typeof parsed === 'object') existing = parsed
  } catch { existing = null }
  const now = new Date().toISOString()
  const record = {
    ...report,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    reports: (existing?.reports ?? 0) + 1,
  }
  await cfg.kv.put(regKey(report.deviceId), JSON.stringify(record), { metadata: registrationMetadata(record) })
  return { saved: true, isNew: !existing, record }

/* حذف سجل تسجيل (حق الاعتراض/الحذف في سياسة الخصوصية): يُستجاب للطلب خلال
   30 يوماً، وهذا هو الأداة التي تنفّذه — أمر `/احذف SHOP-…` في البوت. */
}

/** صياغة عربية للتليجرام — كل بيانات العميل في رسالة واحدة قابلة للنسخ.
 *  كل قيمة كتبها العميل تُهرَّب (tgEscape): الرسالة تُرسل بـparse_mode=HTML،
 *  و`&` غير مُهرَّبة تُفشل الرسالة كلها بصمت فلا يصلك البلاغ (انظر tgHtml.js). */
export function formatRegistrationAr(record, { isNew = true } = {}) {
  const head = isNew ? '🆕 <b>تسجيل عميل جديد</b>' : '🔁 <b>تحديث بيانات عميل مسجّل</b>'
  const lines = [
    head,
    '',
    `🏪 المنشأة: ${tgEscape(record.shopName) || '—'}`,
    `👤 المالك: ${tgEscape(record.ownerName) || '—'}`,
    record.phone ? `📞 الهاتف: <code>${tgEscape(record.phone)}</code>` : '',
    record.email ? `📧 البريد: <code>${tgEscape(record.email)}</code>` : '',
    record.city || record.street ? `📍 العنوان: ${[record.city, record.street].filter(Boolean).map(tgEscape).join(' — ')}` : '',
    `🧭 النشاط: ${tgEscape(record.activityNameAr) || tgEscape(record.activityId) || '—'}${record.countryCode ? ` (${tgEscape(record.countryCode)})` : ''}`,
    record.doctorSpecialty ? `🩺 التخصص: ${tgEscape(record.doctorSpecialty)}` : '',
    `📦 الخطة: ${tgEscape(record.plan)} · المحاسبة: ${record.accountingMode === 'full' ? 'متقدمة' : 'بسيطة'}`,
    `🖥️ الجهاز: <code>${tgEscape(record.deviceId)}</code> · ${record.platform === 'web' ? 'المتصفح' : 'تطبيق سطح المكتب'}`,
    `🔖 الإصدار: ${tgEscape(record.appVersion) || '—'}`,
    `🕒 التسجيل: ${tgEscape(record.registeredAt)}`,
    isNew
      ? ''
      : `🔁 عدد البلاغات: ${Number(record.reports) || 0} · أول ظهور: ${tgEscape(record.firstSeenAt)}`,
    '',
    isNew ? '💡 لإصدار مفتاح لهذا الجهاز: <code>/اصدر</code> ثم اختر العميل والجهاز.' : '',
  ]
  return lines.filter((line) => line !== '').join('\n')
}

export async function deleteRegistration(cfg, deviceId) {
  const device = cleanText(deviceId, 24).toUpperCase()
  if (!DEVICE_RE.test(device)) return { ok: false, reasonAr: 'معرّف الجهاز غير صالح. الصيغة: <code>SHOP-XXXX-XXXX-XXXX</code>' }
  const key = regKey(device)
  const existed = (await cfg.kv.get(key)) !== null
  await cfg.kv.delete(key)
  return { ok: true, existed, deviceId: device }
}

/**
 * كل التسجيلات — للوحة (أمر /تسجيلات وزر «🆕 التسجيلات»).
 * تُبنى من metadata المفاتيح بلا قراءة كل سجل (انظر REG_META_VERSION)، وتُرتَّب
 * بالأحدث أولاً. السجلات القديمة بلا metadata تُقرأ بـ`get` بعدد محدود
 * (`REG_MAX_READS`)؛ وما زاد يُبلَّغ عنه في `skipped` بدل فشل الطلب كله.
 */
export async function listRegistrations(cfg, limit = 100) {
  const list = await cfg.kv.list({ prefix: REG_PREFIX, limit })
  const out = []
  let skipped = 0
  let reads = 0
  for (const key of list.keys ?? []) {
    if (usableMeta(key.metadata)) {
      out.push({ ...key.metadata })
      continue
    }
    if (reads >= REG_MAX_READS) { skipped++; continue }
    reads++
    const raw = await cfg.kv.get(key.name)
    try {
      const parsed = JSON.parse(raw ?? 'null')
      if (parsed && typeof parsed === 'object') out.push(parsed)
    } catch { /* سجل تالف — يُتجاوز */ }
  }
  out.sort((a, b) => String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? '')))
  return { records: out, skipped }
}

export function formatRegistrationsAr(records, { skipped = 0 } = {}) {
  if (!records.length) return 'لا تسجيلات جديدة بعد — يظهر هنا كل عميل يكمل معالج أول التشغيل.'
  const lines = ['🆕 <b>آخر التسجيلات</b>', '']
  for (const r of records.slice(0, 20)) {
    const contact = [r.phone, r.email].filter(Boolean).map(tgEscape).join(' · ')
    lines.push(`• ${tgEscape(r.shopName) || 'بلا اسم'} — ${tgEscape(r.ownerName) || '—'}${contact ? `\n   ${contact}` : ''}\n   <code>${tgEscape(r.deviceId)}</code> · ${tgEscape(r.activityNameAr) || tgEscape(r.activityId) || '—'} · ${tgEscape(String(r.lastSeenAt ?? '').slice(0, 10))}`)
  }
  if (records.length > 20) lines.push(`\n… و${records.length - 20} آخرين`)
  if (skipped > 0) {
    lines.push(`\n⚠️ ${skipped} سجلاً قديماً بلا فهرس لم تُقرأ (حدّ النداءات ${REG_MAX_READS}) — تُفهرس تلقائياً عند أول بلاغ جديد لها.`)
  }
  return lines.join('\n')
}
