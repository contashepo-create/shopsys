#!/usr/bin/env node
/**
 * verify_about_contact_fields — بوابة بند 9 (تدقيق 2026-10-08):
 * بيانات التواصل في صفحة «حول» + حقول يملؤها المطوّر من لوحته.
 *
 * الفجوة التي تُقفل: `/حول` وزر «تعديل حول» كانا يكتبان **نصاً خاماً** في `body`،
 * والعامل يعيد `{...fallback, body: raw}` ⇒ حقول الهاتف/واتساب/تليجرام/البريد/
 * الموقع تبقى فارغة للأبد، وعميلٌ انتهى اشتراكه ولا إنترنت عنده لا يجد أي وسيلة
 * تواصل على شاشة القفل.
 *
 * ما تُثبته البوابة:
 *   • نموذج كامل الحقول + حقول حرة + قنوات إضافية.
 *   • تعقيم صارم: الروابط http/https/mailto/tel فقط (المحتوى يُعرض في href عند
 *     كل العملاء ⇒ javascript:/data: يعني تنفيذ كود عندهم)، و**رفض لا تنظيف**.
 *   • اللوحة تملأ حقلاً حقلاً، و`/حول` يدمج ولا يمحو بيانات التواصل.
 *   • التوافق الرجعي: قيمة `about` القديمة النص خام تُقرأ كـbody.
 *
 * node --experimental-strip-types scripts/verify_about_contact_fields.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  parseAbout, FALLBACK_ABOUT, hasAboutContact, whatsappLink,
  sanitizeAboutUrl, sanitizeAboutPhone, sanitizeAboutWhatsapp, sanitizeAboutTelegram,
  sanitizeAboutEmail, sanitizeAboutText,
} from '../src/core/cloud.ts'
import {
  ABOUT_FIELDS, DEFAULT_ABOUT, readAbout, setAboutField,
  addAboutExtraField, removeAboutExtraField, addAboutSocialLink, removeAboutSocialLink,
  previewAboutAr, sanitizeAboutValue,
} from '../../tools/devbot/src/aboutContent.js'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const workerSrc = src('../../tools/devbot/src/worker.js')
const panelSrc = src('../../tools/devbot/src/adminPanel.js')
const aboutPageSrc = src('../src/ui/pages/AboutPage.tsx')
const lockSrc = src('../src/ui/LockScreen.tsx')

class MemoryKv {
  constructor() { this.values = new Map(); this.metas = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value, opts) {
    this.values.set(key, String(value))
    /* metadata المفاتيح كما في KV الحقيقي — يُعاد من list() بلا get إضافي */
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })), list_complete: true }
  }
}

console.log('بوابة بند 9 — بيانات التواصل في «حول» من اللوحة:')

ok('النموذج كامل: هاتف/واتساب/تليجرام/بريد/موقع/عنوان/مواعيد + قوائم', () => {
  for (const field of ['supportPhone', 'supportWhatsapp', 'supportTelegram', 'supportEmail', 'website', 'address', 'workHours', 'socialLinks', 'extraFields']) {
    assert.ok(field in FALLBACK_ABOUT, `الحقل ${field} ناقص في FALLBACK_ABOUT`)
    assert.ok(field in DEFAULT_ABOUT, `الحقل ${field} ناقص في DEFAULT_ABOUT`)
  }
  assert.equal(ABOUT_FIELDS.length, 9)
})

ok('الروابط: رفض javascript:/data: والاقتباسات — لا تنظيف يمرّر المشوّه', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'https://a.app/" onclick="alert(1)', 'https://a.app/<b>', 'ftp://a.app']) {
    assert.equal(sanitizeAboutUrl(bad), '', bad)
    assert.equal(sanitizeAboutValue('url', bad), '', `الخادم يجب أن يرفض: ${bad}`)
  }
  for (const good of ['https://tahakam.app/x?a=1', 'http://a.app', 'mailto:s@tahakam.app', 'tel:+201001234567']) {
    assert.equal(sanitizeAboutUrl(good), good)
    assert.equal(sanitizeAboutValue('url', good), good)
  }
})

ok('الهاتف/واتساب/تليجرام/البريد بأنماط صارمة (العميل والخادم سواء)', () => {
  assert.equal(sanitizeAboutPhone('abc'), '')
  assert.equal(sanitizeAboutPhone('+20 100 123 4567'), '+20 100 123 4567')
  assert.equal(sanitizeAboutWhatsapp('+20 100-123-4567'), '201001234567')
  assert.equal(sanitizeAboutWhatsapp('123'), '')
  assert.equal(sanitizeAboutTelegram('@tahakam_support'), 'tahakam_support')
  assert.equal(sanitizeAboutTelegram('t.me/bad name'), '')
  assert.equal(sanitizeAboutEmail('not-an-email'), '')
  assert.equal(sanitizeAboutEmail('support@tahakam.app'), 'support@tahakam.app')
  assert.equal(sanitizeAboutValue('whatsapp', '+20 100 123 4567'), '201001234567')
  assert.equal(sanitizeAboutValue('email', 'not-an-email'), '')
  /* حارس تباعد: المدخلات نفسها تُمرّ على الطرفين — لو اختلف نمط أحدهما قبلت
     اللوحة قيمةً يسقطها العميل عند العرض (يراها المطوّر محفوظة ولا يراها أحد). */
  const phoneCases = ['abc', '+20 100 123 4567', '01001234567', '+201001234567']
  const tgCases = ['@tahakam_support', 't.me/bad name', 'ab', 'tahakam_support']
  const mailCases = ['not-an-email', 'support@tahakam.app', 'a@b']
  for (const v of phoneCases) assert.equal(sanitizeAboutValue('phone', v), sanitizeAboutPhone(v), `هاتف: ${v}`)
  for (const v of tgCases) assert.equal(sanitizeAboutValue('telegram', v), sanitizeAboutTelegram(v), `تليجرام: ${v}`)
  for (const v of mailCases) assert.equal(sanitizeAboutValue('email', v), sanitizeAboutEmail(v), `بريد: ${v}`)
})

ok('parseAbout يُسقِط التالف ويُبقي الافتراضي ويقصّ القوائم', () => {
  const parsed = parseAbout({
    title: '<b>عنوان</b>', body: '', supportEmail: 'javascript:alert(1)', website: 'javascript:alert(1)',
    socialLinks: Array.from({ length: 30 }, (_s, i) => ({ label: `ق${i}`, url: `https://a.app/${i}` })),
    extraFields: Array.from({ length: 30 }, (_s, i) => ({ label: `ح${i}`, value: `ق${i}` })),
  })
  assert.equal(parsed.body, FALLBACK_ABOUT.body)
  assert.equal(parsed.supportEmail, '')
  assert.equal(parsed.website, '')
  assert.ok(!parsed.title.includes('<'))
  assert.equal(parsed.socialLinks.length, 8)
  assert.equal(parsed.extraFields.length, 20)
})

ok('whatsappLink وhasAboutContact', () => {
  assert.equal(whatsappLink('201001234567'), 'https://wa.me/201001234567')
  assert.equal(whatsappLink(''), '')
  assert.equal(hasAboutContact(FALLBACK_ABOUT), false)
  assert.equal(hasAboutContact({ ...FALLBACK_ABOUT, supportEmail: 'a@b.co' }), true)
})

await okAsync('العامل يخدم المستند المنظّم (لا نص خام)', async () => {
  assert.match(workerSrc, /return json\(await readAbout\(cfg\), CORS\)/)
  const kv = new MemoryKv()
  await kv.put('about', 'نص قديم محفوظ قبل التحديث')
  const legacy = await readAbout({ kv })
  assert.equal(legacy.body, 'نص قديم محفوظ قبل التحديث') // ④ التوافق الرجعي
  assert.equal(legacy.title, DEFAULT_ABOUT.title)
})

await okAsync('تحرير حقل لا يمحو بقية الحقول، والتالف يُرفض بسبب عربي', async () => {
  const kv = new MemoryKv()
  await setAboutField({ kv }, 'supportEmail', 'support@tahakam.app')
  await setAboutField({ kv }, 'supportPhone', '+20 100 123 4567')
  const doc = await readAbout({ kv })
  assert.equal(doc.supportEmail, 'support@tahakam.app')
  assert.equal(doc.supportPhone, '+20 100 123 4567')

  const bad = await setAboutField({ kv }, 'website', 'javascript:alert(1)')
  assert.equal(bad.ok, false)
  assert.match(bad.reasonAr, /https:\/\//)
  assert.equal((await readAbout({ kv })).website, '')

  const unknown = await setAboutField({ kv }, 'notAField', 'x')
  assert.equal(unknown.ok, false)
})

await okAsync('الحقول الحرة والقنوات: إضافة/حذف/حدود', async () => {
  const kv = new MemoryKv()
  assert.equal((await addAboutExtraField({ kv }, { label: '', value: 'x', url: '' })).ok, false)
  assert.equal((await addAboutExtraField({ kv }, { label: 'رابط', value: 'اضغط', url: 'javascript:alert(1)' })).ok, false)
  await addAboutExtraField({ kv }, { label: 'الرقم الضريبي', value: '100-200-300', url: '' })
  await addAboutExtraField({ kv }, { label: 'الفرع', value: 'توريل', url: 'https://maps.app/x' })
  assert.equal((await readAbout({ kv })).extraFields.length, 2)
  assert.equal((await removeAboutExtraField({ kv }, 9)).ok, false)
  assert.equal((await removeAboutExtraField({ kv }, 0)).ok, true)
  assert.equal((await readAbout({ kv })).extraFields.map((f) => f.label).join(), 'الفرع')

  await addAboutSocialLink({ kv }, { label: 'فيسبوك', url: 'https://facebook.com/x' })
  assert.equal((await addAboutSocialLink({ kv }, { label: 'سيئ', url: 'javascript:alert(1)' })).ok, false)
  assert.equal((await removeAboutSocialLink({ kv }, 0)).ok, true)
  for (let i = 0; i < 25; i += 1) await addAboutExtraField({ kv }, { label: `ح${i}`, value: `ق${i}`, url: '' })
  assert.equal((await readAbout({ kv })).extraFields.length, 20)
})

await okAsync('المعاينة تحذّر المطوّر من غياب التواصل (عميل مقفول أوفلاين)', async () => {
  const empty = previewAboutAr(DEFAULT_ABOUT)
  assert.match(empty, /لا بيانات تواصل/)
  const full = previewAboutAr({ ...DEFAULT_ABOUT, supportEmail: 'a@b.co' })
  assert.ok(!full.includes('لا بيانات تواصل'))
})

ok('اللوحة تعرض الحقول كأزرار وتحررها حقلاً حقلاً', () => {
  assert.match(panelSrc, /panel:aboutfield:/)
  assert.match(panelSrc, /ABOUT_FIELDS/)
  assert.match(panelSrc, /panel:aboutextra/)
  assert.match(panelSrc, /panel:aboutsocial/)
  assert.match(panelSrc, /panel:aboutpreview/)
  assert.match(panelSrc, /aboutMenuReply/)
})

ok('«حول» تعرض كل القنوات، وبلاها تلميح لا فراغ صامت', () => {
  assert.match(aboutPageSrc, /whatsappLink\(/)
  assert.match(aboutPageSrc, /mailto:/)
  assert.match(aboutPageSrc, /tel:/)
  assert.match(aboutPageSrc, /socialLinks\.map/)
  assert.match(aboutPageSrc, /extraFields\.map/)
  assert.match(aboutPageSrc, /hasAboutContact/)
  assert.match(aboutPageSrc, /لم يضبط المطوّر بيانات تواصل/)
})

ok('شاشة القفل تعرض واتساب والبريد وتوجّه الأوفلاين لمعرّف الجهاز', () => {
  assert.match(lockSrc, /whatsappLink\(/)
  assert.match(lockSrc, /mailto:/)
  assert.match(lockSrc, /hasAboutContact/)
  assert.match(lockSrc, /معرّف الجهاز/)
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
