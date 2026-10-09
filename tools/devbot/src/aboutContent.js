/**
 * محتوى صفحة «حول» — نموذج منظّم يملؤه المطوّر من لوحته (بند 9، تدقيق 2026-10-08).
 * ────────────────────────────────────────────────────────────────────────────────
 * المشكلة التي تُسدّ: كان `/حول <نص>` وزر «تعديل حول» يكتبان **نصاً خاماً** في
 * مفتاح `about`، والعامل يعيده `{...fallback, body: raw}` ⇒ الحقول
 * (الهاتف/واتساب/تليجرام/البريد/الموقع) تبقى فارغة للأبد، والعميل — خصوصاً
 * المقفول أوفلاين — لا يجد أي وسيلة تواصل.
 *
 * الحل: مستند JSON واحد بمفاتيح صريحة، وتعقيم خادمي مطابق لتعقيم العميل
 * (دفاع مزدوج: العميل يعقّم عند العرض أيضاً). الروابط http/https/mailto/tel
 * فقط — المحتوى يُعرض في `href` عند كل العملاء فلا مجال لـjavascript:/data:.
 *
 * التوافق الرجعي: قيمة `about` القديمة نص خام ⇒ تُقرأ كـ`body` ولا يُفقد شيء.
 */

export const ABOUT_KEY = 'about'

export const ABOUT_FIELDS = [
  { key: 'title', labelAr: 'العنوان', max: 120 },
  { key: 'body', labelAr: 'النص التعريفي', max: 4000 },
  { key: 'supportPhone', labelAr: 'هاتف الدعم', max: 24, kind: 'phone' },
  { key: 'supportWhatsapp', labelAr: 'واتساب (رقم دولي بلا +)', max: 15, kind: 'whatsapp' },
  { key: 'supportTelegram', labelAr: 'تليجرام (بلا @)', max: 40, kind: 'telegram' },
  { key: 'supportEmail', labelAr: 'البريد الإلكتروني', max: 128, kind: 'email' },
  { key: 'website', labelAr: 'الموقع', max: 300, kind: 'url' },
  { key: 'address', labelAr: 'العنوان', max: 200 },
  { key: 'workHours', labelAr: 'مواعيد العمل', max: 120 },
]

export const DEFAULT_ABOUT = {
  title: 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
  body: 'نظام عربي متكامل للمبيعات والمخازن والحسابات العامة — يدعم أنشطة متعددة ويعمل بلا إنترنت.',
  supportPhone: '', supportWhatsapp: '', supportTelegram: '', supportEmail: '',
  website: '', address: '', workHours: '',
  socialLinks: [], extraFields: [], updatedAt: '',
}

/* ─── التعقيم (مطابق لمنطق العميل في app/src/core/cloud.ts) ─── */

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|tel:)[^\s<>"'`\\]{3,300}$/i
const PHONE_RE = /^\+?[0-9][0-9\s-]{5,23}$/
const TELEGRAM_RE = /^[A-Za-z0-9_]{4,40}$/
const EMAIL_RE = /^[^\s@<>]{3,64}@[^\s@<>]{3,64}$/

export function sanitizeText(value, max = 300) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

export function sanitizeAboutValue(kind, value) {
  switch (kind) {
    case 'url': {
      /* رفض لا تنظيف: مسافة/اقتباس/زاوية/شرطة عكسية ⇒ رفض كامل (مطابق للعميل) */
      const v = String(value ?? '').trim()
      if (v.length < 3 || v.length > 300 || /[\s<>"'`\\]/.test(v)) return ''
      return SAFE_URL_RE.test(v) ? v : ''
    }
    case 'phone': {
      const v = sanitizeText(value, 24)
      return PHONE_RE.test(v) ? v : ''
    }
    case 'whatsapp': {
      const digits = String(value ?? '').replace(/[^\d]/g, '').slice(0, 15)
      return digits.length >= 8 ? digits : ''
    }
    case 'telegram': {
      const v = sanitizeText(value, 40).replace(/^@+/, '')
      return TELEGRAM_RE.test(v) ? v : ''
    }
    case 'email': {
      const v = sanitizeText(value, 128)
      return EMAIL_RE.test(v) ? v : ''
    }
    default:
      return sanitizeText(value, 4000)
  }
}

/** وصف عربي لسبب الرفض — يُعرض للمطوّر في اللوحة بدل صمت مربك */
export function rejectionReasonAr(kind) {
  switch (kind) {
    case 'url': return 'الرابط يجب أن يبدأ بـ https:// أو http:// أو mailto: أو tel:'
    case 'phone': return 'رقم هاتف غير صالح (6–24 خانة: أرقام ومسافات و+ و-)'
    case 'whatsapp': return 'رقم واتساب دولي بالأرقام فقط (8 خانات فأكثر)، مثال 201001234567'
    case 'telegram': return 'معرّف تليجرام غير صالح (حروف لاتينية وأرقام و_ بطول 4–40)'
    case 'email': return 'بريد إلكتروني غير صالح'
    default: return 'قيمة فارغة'
  }
}

/* ─── القراءة والكتابة ─── */

/**
 * قراءة مستند «حول»: قيمة قديمة نص خام ⇒ تُحمل في `body` (لا فقدان).
 * JSON تالف ⇒ الافتراضي (لا انهيار).
 */
export async function readAbout(cfg) {
  const raw = await cfg.kv.get(ABOUT_KEY)
  if (!raw) return { ...DEFAULT_ABOUT }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out = { ...DEFAULT_ABOUT }
      for (const field of ABOUT_FIELDS) {
        if (typeof parsed[field.key] === 'string') {
          const clean = sanitizeAboutValue(field.kind, parsed[field.key])
          out[field.key] = clean || (field.key === 'title' || field.key === 'body' ? out[field.key] : '')
        }
      }
      if (Array.isArray(parsed.socialLinks)) out.socialLinks = sanitizeSocialLinks(parsed.socialLinks)
      if (Array.isArray(parsed.extraFields)) out.extraFields = sanitizeExtraFields(parsed.extraFields)
      if (typeof parsed.updatedAt === 'string') out.updatedAt = parsed.updatedAt.slice(0, 40)
      return out
    }
  } catch { /* قيمة قديمة نص خام — تُعالج أدناه */ }
  return { ...DEFAULT_ABOUT, body: sanitizeText(raw, 4000) || DEFAULT_ABOUT.body }
}

export function sanitizeSocialLinks(list) {
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const url = sanitizeAboutValue('url', entry.url)
    const label = sanitizeText(entry.label, 40)
    return url ? [{ label: label || 'رابط', url }] : []
  }).slice(0, 8)
}

export function sanitizeExtraFields(list) {
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const label = sanitizeText(entry.label, 60)
    const value = sanitizeText(entry.value, 300)
    if (!label || !value) return []
    const url = sanitizeAboutValue('url', entry.url)
    return [{ label, value, ...(url ? { url } : {}) }]
  }).slice(0, 20)
}

/** حفظ المستند كاملاً مع طابع وقت التحديث */
export async function writeAbout(cfg, next) {
  const doc = {
    ...DEFAULT_ABOUT,
    ...next,
    socialLinks: sanitizeSocialLinks(next.socialLinks ?? []),
    extraFields: sanitizeExtraFields(next.extraFields ?? []),
    updatedAt: new Date().toISOString(),
  }
  await cfg.kv.put(ABOUT_KEY, JSON.stringify(doc))
  return doc
}

/** تحديث حقل واحد — يعيد {ok, value} أو {ok:false, reasonAr} عند رفض التعقيم */
export async function setAboutField(cfg, key, rawValue) {
  const field = ABOUT_FIELDS.find((f) => f.key === key)
  if (!field) return { ok: false, reasonAr: 'حقل غير معروف' }
  const value = sanitizeAboutValue(field.kind, rawValue)
  // التفريغ مقصود ومسموح (مسح قناة تواصل) — لكن العنوان والنص لهما افتراضي
  if (!value && String(rawValue ?? '').trim() !== '') return { ok: false, reasonAr: rejectionReasonAr(field.kind) }
  if (!value && (key === 'title' || key === 'body')) return { ok: false, reasonAr: 'لا يمكن تفريغ هذا الحقل — له نص افتراضي' }
  const current = await readAbout(cfg)
  const doc = await writeAbout(cfg, { ...current, [key]: value || (key === 'title' || key === 'body' ? DEFAULT_ABOUT[key] : '') })
  return { ok: true, value: doc[key], doc }
}

/** إضافة حقل حر يظهر في «حول» (طلب المالك: «حقول يمكن إضافتها») */
export async function addAboutExtraField(cfg, { label, value, url }) {
  const cleanLabel = sanitizeText(label, 60)
  const cleanValue = sanitizeText(value, 300)
  if (!cleanLabel || !cleanValue) return { ok: false, reasonAr: 'الاسم والقيمة مطلوبان' }
  const cleanUrl = url ? sanitizeAboutValue('url', url) : ''
  if (url && !cleanUrl) return { ok: false, reasonAr: rejectionReasonAr('url') }
  const current = await readAbout(cfg)
  if (current.extraFields.length >= 20) return { ok: false, reasonAr: 'بلغت الحد (20 حقلاً) — احذف حقلاً أولاً' }
  const doc = await writeAbout(cfg, {
    ...current,
    extraFields: [...current.extraFields, { label: cleanLabel, value: cleanValue, ...(cleanUrl ? { url: cleanUrl } : {}) }],
  })
  return { ok: true, doc, index: doc.extraFields.length - 1 }
}

export async function removeAboutExtraField(cfg, index) {
  const current = await readAbout(cfg)
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= current.extraFields.length) return { ok: false, reasonAr: 'رقم الحقل غير صحيح' }
  const removed = current.extraFields[i]
  const doc = await writeAbout(cfg, { ...current, extraFields: current.extraFields.filter((_f, idx) => idx !== i) })
  return { ok: true, removed, doc }
}

export async function addAboutSocialLink(cfg, { label, url }) {
  const cleanLabel = sanitizeText(label, 40)
  const cleanUrl = sanitizeAboutValue('url', url)
  if (!cleanLabel) return { ok: false, reasonAr: 'اسم القناة مطلوب' }
  if (!cleanUrl) return { ok: false, reasonAr: rejectionReasonAr('url') }
  const current = await readAbout(cfg)
  if (current.socialLinks.length >= 8) return { ok: false, reasonAr: 'بلغت الحد (8 قنوات)' }
  const doc = await writeAbout(cfg, { ...current, socialLinks: [...current.socialLinks, { label: cleanLabel, url: cleanUrl }] })
  return { ok: true, doc }
}

export async function removeAboutSocialLink(cfg, index) {
  const current = await readAbout(cfg)
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= current.socialLinks.length) return { ok: false, reasonAr: 'رقم القناة غير صحيح' }
  const removed = current.socialLinks[i]
  const doc = await writeAbout(cfg, { ...current, socialLinks: current.socialLinks.filter((_l, idx) => idx !== i) })
  return { ok: true, removed, doc }
}

/** معاينة عربية لما سيظهر للعميل — يراها المطوّر قبل الحفظ */
export function previewAboutAr(doc) {
  const lines = ['👁️ <b>معاينة صفحة «حول» عند العميل</b>', '']
  lines.push(`📌 ${doc.title || '—'}`)
  if (doc.body) lines.push(`📄 ${doc.body.slice(0, 400)}${doc.body.length > 400 ? '…' : ''}`)
  const contacts = [
    doc.supportPhone ? `📞 ${doc.supportPhone}` : '',
    doc.supportWhatsapp ? `💬 واتساب ${doc.supportWhatsapp}` : '',
    doc.supportTelegram ? `✈️ @${doc.supportTelegram}` : '',
    doc.supportEmail ? `📧 ${doc.supportEmail}` : '',
    doc.website ? `🌐 ${doc.website}` : '',
  ].filter(Boolean)
  lines.push('')
  lines.push(contacts.length ? `<b>التواصل:</b>\n${contacts.join('\n')}` : '⚠️ <b>لا بيانات تواصل — العميل المقفول أوفلاين لن يجد طريقة للوصول إليك</b>')
  if (doc.address || doc.workHours) {
    lines.push('')
    if (doc.address) lines.push(`📍 ${doc.address}`)
    if (doc.workHours) lines.push(`🕒 ${doc.workHours}`)
  }
  if (doc.socialLinks?.length) lines.push(`\n🔗 قنوات: ${doc.socialLinks.map((l) => `${l.label}`).join(' · ')}`)
  if (doc.extraFields?.length) {
    lines.push('')
    lines.push('<b>حقول إضافية:</b>')
    lines.push(...doc.extraFields.map((f, i) => `${i + 1}. ${f.label}: ${f.value}`))
  }
  return lines.join('\n')
}
