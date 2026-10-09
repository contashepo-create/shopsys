#!/usr/bin/env node
/**
 * verify_registration_delivery — بوابة مراجعة المرحلة ③ (التسليم · التسجيلات · قرب الانتهاء).
 *
 * ما تُثبته البوابة (سلوك + تركيب معاً):
 *   • التسليم: `sendTelegram` يفحص النتيجة ويعيد المحاولة بحدود ويرمي عند الفشل النهائي؛
 *     `scheduled()` لا يكتب علامة اليوم إلا بعد نجاح الإرسال؛ ردّ الـwebhook يعود 200 دائماً.
 *   • البلاغ: قاعدة الهاتف والبريد واحدة في التطبيق والخادم (تطابق بالتنفيذ وبالنص)،
 *     وزر «إصدار مفتاح» بديل تعليمة `/اصدر` المعلّقة على مسافة.
 *   • اللوحة: كل كتابة لسجل `dev:` تحمل metadata (وإلا تقرأ القائمة كل سجل)،
 *     وكل اسم عميل داخل رسالة HTML مهرّب (وإلا فشلت الرسالة كلها بصمت).
 *   • التذكير: النافذة 6 أيام («أقل من أسبوع»)، والرسالة اليومية عن القريبة وحدها.
 *
 * node --experimental-strip-types scripts/verify_registration_delivery.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { sendTelegram, splitForTelegram, htmlToPlain, TG_MAX_CHARS } from '../../tools/devbot/src/tgSend.js'
import {
  normalizePhone as serverPhone, sanitizeRegistration, registrationButtons, formatRegistrationDetailAr,
} from '../../tools/devbot/src/registrations.js'
import { SOON_DAYS, hasDigestNews } from '../../tools/devbot/src/subscriptions.js'
import { normalizePhone as appPhone, buildRegistrationReport } from '../src/core/registration.ts'

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
/* إزالة التعليقات قبل فحص النص: التعليق الذي يذكر الاسم لا يُحسب تركيباً */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const workerCode = code(src('../../tools/devbot/src/worker.js'))
const tgSendCode = code(src('../../tools/devbot/src/tgSend.js'))
const adminCode = code(src('../../tools/devbot/src/adminPanel.js'))
const regCode = code(src('../../tools/devbot/src/registrations.js'))
const subsCode = code(src('../../tools/devbot/src/subscriptions.js'))
const appRegCode = code(src('../src/core/registration.ts'))
const wizardCode = code(src('../src/ui/setup/FirstRunWizard.tsx'))

console.log('بوابة مراجعة المرحلة ③ — التسليم والتسجيلات وقرب الانتهاء:')

/* ── ① التسليم ─────────────────────────────────────────────────────────────── */
await okAsync('sendTelegram يفحص النتيجة: ينجح بلا استثناء، ويرمي عند الفشل النهائي', async () => {
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 })
    let threw = false
    try { await sendTelegram({ token: 't' }, '1', 'نص') } catch (e) { threw = /chat not found/.test(e.message) }
    assert.ok(threw, 'فشل 400 يجب أن يُرمى لا أن يُبتلع')
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    await sendTelegram({ token: 't' }, '1', 'نص')
  } finally { globalThis.fetch = realFetch }
})

ok('الحدود: الرسالة الواحدة ≤ الحد، و3800 أقل من حد تليجرام 4096 بهامش', () => {
  assert.ok(TG_MAX_CHARS > 3000 && TG_MAX_CHARS < 4096, `الحد ${TG_MAX_CHARS}`)
  const rows = Array.from({ length: 200 }, (_, i) => `<b>صف ${i}</b> &amp; تفاصيل ${'x'.repeat(40)}`).join('\n')
  const parts = splitForTelegram(rows)
  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= TG_MAX_CHARS)
  assert.equal(parts.join('\n'), rows)
})

ok('htmlToPlain يفكّ &amp; آخراً (لا يحوّل &amp;lt; إلى <)', () => {
  assert.equal(htmlToPlain('<b>A &amp;lt; B</b> &lt;x&gt;'), 'A &lt; B <x>')
})

ok('تركيب: sendTelegram مستورد من tgSend.js، ولا نسخة محلية قديمة في worker.js', () => {
  assert.doesNotMatch(workerCode, /async function sendTelegram\s*\(/)
  assert.match(workerCode, /import \{ sendTelegram \} from '\.\/tgSend\.js'/)
  assert.match(tgSendCode, /throw new Error\(/)
  assert.match(tgSendCode, /can't parse entities/)
  assert.match(tgSendCode, /retry_after/)
})

ok('تركيب: ردّ الـwebhook يعود 200 حتى عند الخطأ (تليجرام يعيد التحديث غير 200)', () => {
  const hook = workerCode.slice(workerCode.indexOf("const hook = url.pathname.match"), workerCode.indexOf("return new Response('shopsys-control'"))
  assert.match(hook, /try \{ update = await request\.json\(\) \} catch \{ return new Response\('ok'\) \}/)
  assert.match(hook, /catch \(error\) \{\s*reply = \{ chatId: cfg\.adminId/)
  assert.match(hook, /catch \(error\) \{ console\.error\('telegram reply failed'/)
  assert.equal((hook.match(/return new Response\('ok'\)/g) ?? []).length, 2)
})

ok('تركيب: علامة digest-sent تُكتب **بعد** نجاح الإرسال، لا قبله', () => {
  const send = workerCode.indexOf('await sendTelegram(cfg, cfg.adminId, formatDigestAr(digest, { daily: true }))')
  const mark = workerCode.indexOf('await cfg.kv.put(digestMarkerKey(day)')
  assert.ok(send > 0 && mark > 0, 'موضعا الإرسال والعلامة موجودان')
  assert.ok(send < mark, 'العلامة قبل الإرسال ⇒ يضيع التذكير عند الفشل')
})

/* ── ② البلاغ والتسجيلات ───────────────────────────────────────────────────── */
const PHONE_FIXTURES = [
  ['+20 100 123 4567', '+20 100 123 4567'],
  ['٠١٠ ١٢٣٤ ٥٦٧٨', '010 1234 5678'],
  ['(010) 1234-5678', '(010) 1234-5678'],
  ['۰۱۰۱۲۳۴۵۶۷۸', '01012345678'],
  ['اتصل بي', ''],
  ['012', ''],
  ['1234567890123456', ''],
  ['', ''],
]

ok('الهاتف: القاعدة واحدة في التطبيق والخادم (تطابق بالتنفيذ على كل المدخلات)', () => {
  for (const [input, expected] of PHONE_FIXTURES) {
    assert.equal(appPhone(input), expected, `التطبيق: ${input}`)
    assert.equal(serverPhone(input), expected, `الخادم: ${input}`)
  }
})

ok('الهاتف: الصيغة النصية متطابقة (الأرقام 7–15 والحروف المسموحة) في الملفين', () => {
  const re = '/^\\+?[0-9 ()./-]+$/'
  assert.ok(appRegCode.includes(re), 'التطبيق يحمل الصيغة نفسها')
  assert.ok(regCode.includes(re), 'الخادم يحمل الصيغة نفسها')
  assert.ok(appRegCode.includes('digits >= 7 && digits <= 15') && regCode.includes('digits >= 7 && digits <= 15'))
})

ok('الربط: البلاغ في الطرفين يمرّ بـnormalizePhone فعلاً (لا تعبير قديم بجوارها)', () => {
  assert.match(regCode, /phone: normalizePhone\(raw\.phone\)/, 'sanitizeRegistration في الخادم')
  assert.match(appRegCode, /phone: normalizePhone\(input\.phone\)/, 'buildRegistrationReport في التطبيق')
  assert.doesNotMatch(regCode, /phone: \/\^/, 'تعبير هاتف قديم مضمّن في الخادم')
  assert.doesNotMatch(appRegCode, /phone: \/\^/, 'تعبير هاتف قديم مضمّن في التطبيق')
})

ok('المعالج يستعمل القاعدة نفسها (لا يقبل ما يرفضه الخادم)', () => {
  assert.match(wizardCode, /const isValidPhone = \(v: string\) => normalizePhone\(v\) !== ''/)
  assert.match(wizardCode, /import \{ normalizePhone \} from '\.\.\/\.\.\/core\/registration\.ts'/)
  assert.doesNotMatch(wizardCode, /v\.replace\(\/\\D\/g, ''\)\.length >= 7/, 'القاعدة القديمة تقبل ما يرفضه الخادم')
})

ok('البريد: القاعدة نفسها في المعالج والتطبيق والخادم', () => {
  assert.ok(appRegCode.includes('/^\\S+@\\S+\\.\\S+$/'), 'التطبيق')
  assert.ok(regCode.includes('/^\\S+@\\S+\\.\\S+$/'), 'الخادم')
  assert.ok(wizardCode.includes('/^\\S+@\\S+\\.\\S+$/'), 'المعالج')
  const report = buildRegistrationReport({ deviceId: 'SHOP-A1B2-C3D4-E5F6', email: 'a@b.c', phone: '0101234567' })
  assert.equal(report.email, 'a@b.c', 'بريد قصير لكنه صالح للمعالج يجب أن يصل')
  assert.equal(sanitizeRegistration({ deviceId: 'SHOP-A1B2-C3D4-E5F6', email: 'a@b.c' }).email, 'a@b.c')
})

ok('زر الإصدار يحلّ محل تعليمة /اصدر المعلّقة على مسافة (callback ≤ 64 بايت)', () => {
  const kb = registrationButtons('SHOP-A1B2-C3D4-E5F6').reply_markup.inline_keyboard
  assert.equal(kb[0][0].callback_data, 'panel:issuereg:SHOP-A1B2-C3D4-E5F6')
  assert.ok(new TextEncoder().encode(kb[0][0].callback_data).length <= 64)
  assert.deepEqual(registrationButtons('SHOP-BAD'), {})
  assert.doesNotMatch(regCode, /<code>\/اصدر<\/code>/, 'تعليمة /اصدر المعلّقة يجب أن تُحذف من التنبيه')
})

ok('البطاقة الكاملة تعرض كل حقل محفوظ (لا ملخص)', () => {
  const card = formatRegistrationDetailAr({
    deviceId: 'SHOP-A1B2-C3D4-E5F6', shopName: 'م', ownerName: 'و', phone: '01012345678', email: 'a@b.cd',
    city: 'ك', street: 'ش', countryCode: 'EG', activityId: 'pharmacy', activityNameAr: 'صيدلية', plan: 'trial',
    accountingMode: 'simple', platform: 'web', appVersion: '1.0', registeredAt: 'R', firstSeenAt: 'F', lastSeenAt: 'L', reports: 2,
  })
  for (const v of ['01012345678', 'a@b.cd', 'ك', 'ش', 'EG', 'pharmacy', 'trial', 'المتصفح', '1.0', 'F', 'L']) {
    assert.ok(card.includes(v), `حقل مفقود: ${v}`)
  }
})

/* ── ③ اللوحة: الفهرس وتهريب الأسماء ─────────────────────────────────────── */
ok('كل كتابة لسجل dev: في اللوحة تحمل metadata (وإلا تُقرأ القائمة كلها)', () => {
  const sites = [...adminCode.matchAll(/cfg\.kv\.put\(`dev:/g)]
  assert.ok(sites.length >= 1, 'موضع كتابة واحد على الأقل')
  for (const site of sites) {
    const statement = adminCode.slice(site.index, site.index + 500)
    assert.ok(/metadata:\s*deviceMetadata\(/.test(statement) || /metadata:\s*deviceMetadata\(/.test(adminCode.slice(site.index - 200, site.index + 200)),
      `كتابة dev: بلا metadata عند الموضع ${site.index}`)
  }
})

ok('قائمة العملاء تُبنى من الفهرس، والقراءة محدودة بـDIGEST_MAX_READS', () => {
  assert.match(adminCode, /meta\.v === DEVICE_META_VERSION/)
  assert.match(adminCode, /reads >= DIGEST_MAX_READS/)
  assert.match(adminCode, /return \{ rows, skipped \}/)
})

ok('أسماء العملاء داخل رسائل HTML مهرّبة (الأزرار نص عادي فلا تُهرَّب)', () => {
  const risky = /\$\{(device\.customer|group\.name|flow\.customer|target\.customerName)/
  const offenders = adminCode.split('\n').filter((line) => risky.test(line) && !line.includes('tgEscape(') && !line.includes('button('))
  assert.deepEqual(offenders, [], `أسطر بلا تهريب:\n${offenders.join('\n')}`)
})

ok('اللوحة: مسارات التسجيلات (قائمة، بطاقة، إصدار، حذف على خطوتين) موجودة', () => {
  /* المسارات المُعاملة تُفرز بـparts[1] (panel:<اسم>:<معرّف>)، والقائمة بنص كامل */
  assert.ok(adminCode.includes("'panel:regsnew'"), 'قائمة غير المرخّصين')
  for (const part of ['reg', 'issuereg', 'regdel', 'regdelok']) {
    assert.ok(adminCode.includes(`parts[1] === '${part}'`), `مسار مفقود: panel:${part}:<معرّف>`)
  }
  assert.match(adminCode, /مسجّلون بلا رخصة/)
})

ok('قائمة التسجيلات تقرأ كل الصفحات (لا قطع صامت عند 100 مفتاح)', () => {
  assert.match(regCode, /for \(let pageNo = 0; pageNo < REG_LIST_PAGES; pageNo\+\+\)/)
  assert.match(regCode, /cursor = page\.cursor/)
})

/* ── ④ قرب الانتهاء ─────────────────────────────────────────────────────────── */
ok('النافذة 6 أيام («أقل من أسبوع») وقرابتها مختبرة', () => {
  assert.equal(SOON_DAYS, 6)
  assert.match(subsCode, /export const SOON_DAYS = 6/)
})

ok('الرسالة اليومية عن القريبة وحدها: المنتهية لا تدخل hasDigestNews ولا قائمة الرسالة', () => {
  assert.equal(hasDigestNews({ soon: [], expired: [{ days: -3 }] }), false)
  assert.equal(hasDigestNews({ soon: [{ days: 2 }], expired: [] }), true)
  assert.match(subsCode, /export const hasDigestNews = \(digest\) => digest\.soon\.length > 0/)
  const body = subsCode.slice(subsCode.indexOf('export function formatDigestAr'), subsCode.indexOf('/** سطر الإحصائيات'))
  assert.doesNotMatch(body, /digest\.expired\.(slice|map|length\s*\))/, 'قائمة المنتهية ممنوعة في نص التذكير')
})

ok('تركيب: لا قريبات ⇒ لا رسالة تلقائية (السلوك الفعلي في tests/devbot_subscription_digest.test.ts)', () => {
  assert.match(workerCode, /if \(!hasDigestNews\(digest\)\) return/)
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
