#!/usr/bin/env node
/**
 * verify_registration_report — بوابة بند 2 (تدقيق 2026-10-08):
 * «هل يُبلَّغ المطوّر بكل عميل جديد يسجّل، مع كل بياناته؟»
 *
 * ما كان: معالج أول التشغيل يجمع (الاسم، الهاتف، البريد، اسم المنشأة، النشاط،
 * المدينة، الشارع) ثم **لا يُرسل شيء** — لا POST في الكود كله.
 *
 * ما تُثبته البوابة:
 *   • البلاغ يُبنى من بيانات المعالج، ويُعقَّم، ويُرفض بلا معرف جهاز صالح.
 *   • مرة واحدة لكل جهاز، وبعد اكتمال الإعداد فقط.
 *   • لا يعطّل العميل: أوفلاين ⇒ 'failed' وبلا تعليم ⇒ محاولة في الإقلاع التالي
 *     (بند 6: لا إجبار على الإنترنت).
 *   • تحصين النقطة العامة في العامل: حد حجم، تعقيم، بلا تسريب.
 *   • الأسلاك موجودة: أثر App.tsx + حقل المتجر + مسار العامل + اللوحة.
 *
 * node --experimental-strip-types scripts/verify_registration_report.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  buildRegistrationReport, shouldReportRegistration, sendRegistrationReport,
  formatRegistrationAr, REGISTRATION_MAX_BYTES, REGISTRATION_PATH,
} from '../src/core/registration.ts'
import {
  sanitizeRegistration, saveRegistration, listRegistrations, formatRegistrationsAr, regKey,
  formatRegistrationAr as formatServerAr,
} from '../../tools/devbot/src/registrations.js'

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
const clientSrc = src('../src/core/registration.ts')
const appSrc = src('../src/App.tsx')
const storeSrc = src('../src/stores/app.store.ts')
const workerSrc = src('../../tools/devbot/src/worker.js')
const panelSrc = src('../../tools/devbot/src/adminPanel.js')
const serverSrc = src('../../tools/devbot/src/registrations.js')

class MemoryKv {
  constructor() { this.values = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value) { this.values.set(key, String(value)) }
  async delete(key) { this.values.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true }
  }
}

const CUSTOMER = {
  deviceId: 'SHOP-AAA1-1111-1111', appVersion: '1.0.19', platform: 'desktop',
  shopName: 'بقالة النور', ownerName: 'أحمد محمد', phone: '+20 100 123 4567',
  email: 'ahmed@example.com', city: 'المنزلة', street: 'شارع البحر',
  countryCode: 'EG', activityId: 'grocery', activityNameAr: 'بقالة وسوبر ماركت',
  accountingMode: 'simple', plan: 'trial',
}

console.log('بوابة بند 2 — إبلاغ المطوّر بكل تسجيل جديد:')

ok('يجمع كل بيانات المعالج كما هي', () => {
  const report = buildRegistrationReport(CUSTOMER)
  for (const [key, value] of Object.entries(CUSTOMER)) {
    assert.equal(report[key], value, key)
  }
  assert.ok(report.registeredAt)
  assert.equal(report.doctorSpecialty, undefined)
})

ok('بلا معرف جهاز صالح ⇒ لا بلاغ (لا تسجيل مجهول الهوية)', () => {
  for (const bad of ['', 'abc', 'SHOP-AAA1-1111', 'javascript:alert(1)', 'SHOP-AAAA-BBBB-CCCC-DDDD']) {
    assert.equal(buildRegistrationReport({ ...CUSTOMER, deviceId: bad }), null, bad)
  }
})

ok('التعقيم: وسوم ومحارف تحكم تُنزع، والبريد/الهاتف التالف يُحذف', () => {
  const report = buildRegistrationReport({
    ...CUSTOMER,
    shopName: `<b>محل</b>\u0000${'ط'.repeat(400)}`,
    email: 'javascript:alert(1)', phone: 'اتصل بي', platform: 'weird', accountingMode: 'weird',
  })
  assert.ok(!report.shopName.includes('<'))
  assert.ok(report.shopName.length <= 120)
  assert.equal(report.email, '')
  assert.equal(report.phone, '')
  assert.equal(report.platform, 'desktop')
  assert.equal(report.accountingMode, 'simple')
  // الخادم يعقّم independently (دفاع مزدوج)
  assert.equal(sanitizeRegistration({ deviceId: 'SHOP-AAA1-1111-1111', email: 'ليس بريداً', phone: 'كلام' }).email, '')
})

ok('مرة واحدة لكل جهاز، وبعد اكتمال الإعداد، وبموافقة صريحة', () => {
  const base = { deviceId: CUSTOMER.deviceId, reportedAt: null, consentAt: '2026-10-08T09:00:00Z' }
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: false }), false)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true }), true)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, reportedAt: '2026-10-08T09:00:00Z' }), false)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, deviceId: 'تالف' }), false)
  // شرط قانوني: سياسة الخصوصية تقول إن البيانات محلية ⇒ بلا خانة موافقة لا إرسال
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, consentAt: null }), false)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, consentAt: '' }), false)
})

await okAsync('sendRegistrationReport: sent/duplicate/failed — ولا استثناء أبداً', async () => {
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, isNew: true }), { status: 200 })
    assert.equal(await sendRegistrationReport('https://x.dev/', buildRegistrationReport(CUSTOMER)), 'sent')
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, isNew: false }), { status: 200 })
    assert.equal(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)), 'duplicate')
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.equal(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)), 'failed')
    globalThis.fetch = async () => new Response('خطأ', { status: 500 })
    assert.equal(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)), 'failed')
    globalThis.fetch = () => { throw new Error('sync throw') }
    assert.equal(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)), 'failed')
    assert.equal(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER), ''), 'failed')
  } finally { globalThis.fetch = realFetch }
})

await okAsync('العامل: أول بلاغ يُسجَّل، والثاني تحديث صامت', async () => {
  const kv = new MemoryKv()
  const report = sanitizeRegistration(CUSTOMER)
  const first = await saveRegistration({ kv }, report)
  assert.equal(first.isNew, true)
  assert.equal(first.record.reports, 1)
  const second = await saveRegistration({ kv }, { ...report, shopName: 'اسم محدّث' })
  assert.equal(second.isNew, false) // ⇒ لا رسالة تليجرام ثانية
  assert.equal(second.record.reports, 2)
  assert.equal(second.record.shopName, 'اسم محدّث')
  assert.equal(second.record.firstSeenAt, first.record.firstSeenAt)
  assert.ok(await kv.get(regKey(CUSTOMER.deviceId)))
})

await okAsync('القائمة ترتّب بالأحدث وتتجاوز السجل التالف', async () => {
  const kv = new MemoryKv()
  await kv.put(regKey('SHOP-AAA1-1111-1111'), JSON.stringify({ ...CUSTOMER, lastSeenAt: '2026-10-01T00:00:00Z' }))
  await kv.put(regKey('SHOP-BBB2-2222-2222'), JSON.stringify({ ...CUSTOMER, deviceId: 'SHOP-BBB2-2222-2222', shopName: 'الأحدث', lastSeenAt: '2026-10-08T00:00:00Z' }))
  await kv.put('reg:SHOP-TAMPERED-X', 'json تالف')
  const list = await listRegistrations({ kv })
  assert.equal(list.length, 2)
  assert.equal(list[0].shopName, 'الأحدث')
  assert.match(formatRegistrationsAr(list), /الأحدث/)
  assert.match(formatRegistrationsAr([]), /لا تسجيلات/)
})

ok('الصياغة العربية تحمل كل البيانات + الخطوة التالية للمطوّر', () => {
  const client = formatRegistrationAr(buildRegistrationReport(CUSTOMER))
  for (const needle of ['بقالة النور', 'أحمد محمد', '+20 100 123 4567', 'ahmed@example.com', 'SHOP-AAA1-1111-1111', '1.0.19']) {
    assert.match(client, new RegExp(needle.replace(/[+.*?(){}[\]\\]/g, '\\$&')), needle)
  }
  assert.match(formatServerAr(sanitizeRegistration(CUSTOMER)), /\/اصدر/)
})

ok('العامل: مسار /register بحدَّي حجم ورفض ما بلا معرف صالح', () => {
  assert.match(workerSrc, /url\.pathname === '\/register'/)
  assert.match(workerSrc, /REG_MAX_BYTES/)
  assert.match(workerSrc, /rawText\.length > REG_MAX_BYTES/) // لا اعتماد على content-length وحده
  assert.match(workerSrc, /sanitizeRegistration\(raw\)/)
  assert.match(workerSrc, /413/)
  assert.match(workerSrc, /405/)
  assert.match(workerSrc, /if \(isNew && cfg\.token && cfg\.adminId\)/) // التبليغ لأول بلاغ فقط
  assert.equal(REGISTRATION_PATH, '/register')
  assert.equal(REGISTRATION_MAX_BYTES, 8192)
})

ok('العميل: أثر الإرسال في App.tsx (fire-and-forget + تعليم عند النجاح فقط)', () => {
  assert.match(appSrc, /shouldReportRegistration\(/)
  assert.match(appSrc, /buildRegistrationReport\(/)
  assert.match(appSrc, /sendRegistrationReport\(LICENSE_CLOUD_BASE_URL/)
  assert.match(appSrc, /if \(!cancelled && result !== 'failed'\) app\.markRegistrationReported\(\)/)
  assert.match(appSrc, /ACTIVITY_TEMPLATES\.find/)
  assert.match(appSrc, /isElectronRuntime\(\) \? 'desktop' : 'web'/)
})

ok('المتجر: حقل البلاغ مع حارس فرق (لا set بلا تغيّر)', () => {
  assert.match(storeSrc, /registrationReportedAt: string \| null/)
  assert.match(storeSrc, /markRegistrationReported: \(at\) =>\s*\n?\s*set\(\(s\) => \(\s*\n?\s*s\.registrationReportedAt \? s :/)
})

ok('اللوحة والأمر: /تسجيلات + زر «🆕 التسجيلات»', () => {
  assert.match(workerSrc, /case '\/تسجيلات'/)
  assert.match(workerSrc, /listRegistrations\(cfg\)/)
  assert.match(panelSrc, /panel:regs/)
  assert.match(panelSrc, /formatRegistrationsAr/)
  assert.match(serverSrc, /export const REG_PREFIX = 'reg:'/)
})

ok('الموافقة: خانة في المعالج + إفصاح في سياسة الخصوصية + حقل في المتجر', () => {
  const wizardSrc = src('../src/ui/setup/FirstRunWizard.tsx')
  const legalSrc = src('../src/core/legal.ts')
  assert.match(wizardSrc, /useState\(false\)/) // غير مفعّلة افتراضياً
  assert.match(wizardSrc, /setRegistrationConsent/)
  assert.match(wizardSrc, /if \(sendRegistration\) setRegistrationConsent\(\)/)
  assert.match(wizardSrc, /أوافق على إبلاغ المطوّر بتسجيلي/)
  assert.match(wizardSrc, /اختياري/)
  assert.match(storeSrc, /registrationConsentAt: string \| null/)
  assert.match(storeSrc, /setRegistrationConsent/)
  assert.match(appSrc, /consentAt: app\.registrationConsentAt/)
  assert.match(legalSrc, /بلاغ التسجيل/)
  assert.match(legalSrc, /موافقة صريحة/)
  assert.match(legalSrc, /LEGAL_VERSION = '2026-10-08'/) // تغيير جوهري ⇒ إعادة طلب الموافقة
  assert.match(appSrc, /legalCurrent\.version === LEGAL_VERSION/)
})

ok('لا بيانات مالية في البلاغ (خصوصية: ما كتبه العميل في المعالج فقط)', () => {
  assert.ok(!/sales|invoices|items|balances|totals|journal/i.test(Object.keys(buildRegistrationReport(CUSTOMER)).join()))
  assert.ok(!/sales|invoices|journal/.test(clientSrc), 'الوحدة يجب ألا تعرف الفواتير أو القيود')
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
