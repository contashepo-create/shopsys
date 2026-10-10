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
  sanitizeRegistration, saveRegistration, listRegistrations, formatRegistrationsAr, deleteRegistration, regKey,
  consumeRegistrationAlert, REG_TG_DAILY_CAP, regAlertKey, registrationButtons,
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

/* الحقول المعلنة فقط (الاتفاقية القسم 5) */
const CUSTOMER = {
  deviceId: 'SHOP-AAA1-1111-1111',
  shopName: 'بقالة النور', ownerName: 'أحمد محمد', phone: '+20 100 123 4567',
  email: 'ahmed@example.com', city: 'المنزلة', street: 'شارع البحر',
  activityNameAr: 'بقالة وسوبر ماركت',
}

console.log('بوابة بند 2 — إبلاغ المطوّر بكل تسجيل جديد:')

ok('يجمع كل بيانات المعالج كما هي', () => {
  const report = buildRegistrationReport(CUSTOMER)
  for (const [key, value] of Object.entries(CUSTOMER)) {
    assert.equal(report[key], value, key)
  }
  assert.ok(report.registeredAt)
  // لا يحمل البلاغ أي حقل خارج القائمة المعلنة، حتى لو مرّره المستدعي
  const leaky = buildRegistrationReport({ ...CUSTOMER, plan: 'pro', countryCode: 'EG', activityId: 'g', accountingMode: 'full', doctorSpecialty: 'أسنان', appVersion: '1.0.22', platform: 'web', fiscalYearName: '2026' })
  assert.deepEqual(Object.keys(leaky).sort(), ['activityNameAr', 'city', 'deviceId', 'email', 'ownerName', 'phone', 'registeredAt', 'shopName', 'street'])
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
    email: 'javascript:alert(1)', phone: 'اتصل بي',
  })
  assert.ok(!report.shopName.includes('<'))
  assert.ok(report.shopName.length <= 120)
  assert.equal(report.email, '')
  assert.equal(report.phone, '')
  // الخادم يعقّم independently (دفاع مزدوج)
  assert.equal(sanitizeRegistration({ deviceId: 'SHOP-AAA1-1111-1111', email: 'ليس بريداً', phone: 'كلام' }).email, '')
})

ok('مرة واحدة لكل جهاز، وبعد اكتمال الإعداد (الإلزام بقبول الاتفاقية — بلا خانة موافقة)', () => {
  const base = { deviceId: CUSTOMER.deviceId, reportedAt: null }
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: false }), false)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true }), true)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, reportedAt: '2026-10-08T09:00:00Z' }), false)
  assert.equal(shouldReportRegistration({ ...base, setupCompleted: true, deviceId: 'تالف' }), false)
  // v1.0.22: لا consentAt — قبول الاتفاقية الإلزامي (مع إفصاح صريح) هو الموافقة
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
  // M1 (مراجعة 2026-10-09): الاسم المعتمد لا يُستبدل ببلاغ غير موثّق، والمختلف يُعرض للمالك
  assert.equal(second.record.shopName, CUSTOMER.shopName)
  assert.equal(second.record.pendingChanges?.shopName, 'اسم محدّث')
  assert.equal(second.record.firstSeenAt, first.record.firstSeenAt)
  assert.ok(await kv.get(regKey(CUSTOMER.deviceId)))
})

await okAsync('القائمة ترتّب بالأحدث وتتجاوز السجل التالف', async () => {
  const kv = new MemoryKv()
  await kv.put(regKey('SHOP-AAA1-1111-1111'), JSON.stringify({ ...CUSTOMER, lastSeenAt: '2026-10-01T00:00:00Z' }))
  await kv.put(regKey('SHOP-BBB2-2222-2222'), JSON.stringify({ ...CUSTOMER, deviceId: 'SHOP-BBB2-2222-2222', shopName: 'الأحدث', lastSeenAt: '2026-10-08T00:00:00Z' }))
  await kv.put('reg:SHOP-TAMPERED-X', 'json تالف')
  const { records, skipped } = await listRegistrations({ kv })
  assert.equal(records.length, 2)
  assert.equal(records[0].shopName, 'الأحدث')
  assert.equal(skipped, 0)
  assert.match(formatRegistrationsAr(records), /الأحدث/)
  assert.match(formatRegistrationsAr([]), /لا تسجيلات/)
})

ok('الصياغة العربية تحمل كل البيانات، والخطوة التالية زر لا تعليمة معلّقة', () => {
  const client = formatRegistrationAr(buildRegistrationReport(CUSTOMER))
  for (const needle of ['بقالة النور', 'أحمد محمد', '+20 100 123 4567', 'ahmed@example.com', 'SHOP-AAA1-1111-1111']) {
    assert.match(client, new RegExp(needle.replace(/[+.*?(){}[\]\\]/g, '\\$&')), needle)
  }
  /* تعليمة /اصدر المعلّقة على مسافة (اسم متعدد الكلمات يفشل التحليل) حلّها زر داخل الرسالة */
  assert.doesNotMatch(formatServerAr(sanitizeRegistration(CUSTOMER)), /\/اصدر/)
  const issueButton = registrationButtons(CUSTOMER.deviceId).reply_markup.inline_keyboard[0][0]
  assert.equal(issueButton.callback_data, `panel:issuereg:${CUSTOMER.deviceId}`)
})

ok('العامل: مسار /register بحدَّي حجم ورفض ما بلا معرف صالح', () => {
  assert.match(workerSrc, /url\.pathname === '\/register'/)
  assert.match(workerSrc, /REG_MAX_BYTES/)
  assert.match(workerSrc, /new TextEncoder\(\)\.encode\(rawText\)\.byteLength > REG_MAX_BYTES/) // الحد بالبايت لا بالمحارف (العربي بايتان)
  assert.doesNotMatch(workerSrc, /rawText\.length > REG_MAX_BYTES/)
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
  // الحقول المعلنة فقط: لا إصدار ولا منصة ولا خطة ولا سنة مالية في البلاغ (الاتفاقية القسم 5)
  assert.doesNotMatch(appSrc, /appVersion: APP_VERSION/)
  assert.doesNotMatch(appSrc, /plan: app\.activatedPayload/)
  assert.doesNotMatch(appSrc, /fiscalYearName: fy/)
})

ok('المتجر: حقل البلاغ مع حارس فرق (لا set بلا تغيّر)', () => {
  assert.match(storeSrc, /registrationReportedAt: string \| null/)
  assert.match(storeSrc, /markRegistrationReported: \(at\) =>\s*\n?\s*set\(\(s\) => \(\s*\n?\s*s\.registrationReportedAt \? s :/)
})

ok('اللوحة والأمر: /تسجيلات + زر «🆕 التسجيلات»', () => {
  assert.match(workerSrc, /case '\/تسجيلات'/)
  assert.match(workerSrc, /listRegistrations\(cfg\)/)
  assert.match(panelSrc, /panel:regs/)
  assert.match(panelSrc, /registrationsReply/)
  assert.match(serverSrc, /export const REG_PREFIX = 'reg:'/)
})

ok('v1.0.22 الإلزام: لا خانة موافقة في المعالج + التسجيل شرط إكمال الإعداد + إفصاح في الاتفاقية', () => {
  const wizardSrc = src('../src/ui/setup/FirstRunWizard.tsx')
  const legalSrc = src('../src/core/legal.ts')
  assert.doesNotMatch(wizardSrc, /setRegistrationConsent|أوافق على إبلاغ المطوّر بتسجيلي/)
  assert.doesNotMatch(storeSrc, /registrationConsentAt|setRegistrationConsent/)
  assert.doesNotMatch(appSrc, /consentAt/)
  assert.match(wizardSrc, /const result = await sendRegistrationReport\(LICENSE_CLOUD_BASE_URL, report\)/)
  // الحقول المعلنة فقط في استدعاء البلاغ (لا في حفظ الإعداد المحلي)
  const reportCall = wizardSrc.slice(wizardSrc.indexOf('buildRegistrationReport({'), wizardSrc.indexOf('const result = await sendRegistrationReport'))
  assert.doesNotMatch(reportCall, /appVersion|platform:|countryCode|activityId|accountingMode|plan:|doctorSpecialty|fiscalYear/)
  assert.match(wizardSrc, /if \(result === 'failed'\)/) // لا إكمال بلا تسجيل
  assert.match(legalSrc, /تُرسل تلقائياً بقبولك هذه الاتفاقية/)
  assert.doesNotMatch(legalSrc, /وت supremacy|الذود/) // أخطاء الصياغة المصلّحة
  // بوابة الاتفاقية: موافقات منفصلة + مسار رفض يشرح الإلغاء ويغلق البرنامج
  const gateSrc = src('../src/ui/LegalGate.tsx')
  assert.match(gateSrc, /LEGAL_CONSENT_CHECKBOXES\.map/)
  assert.match(gateSrc, /setDeclined\(true\)/)
  assert.match(gateSrc, /window\.close\(\)/)
  assert.match(gateSrc, /ألغِ تثبيته/)
  assert.match(legalSrc, /LEGAL_VERSION = '2026-10-11'/) // تغيير جوهري ⇒ إعادة طلب القبول
  assert.match(appSrc, /legalCurrent\.version === LEGAL_VERSION/)
})

ok('لا بيانات مالية في البلاغ (خصوصية: ما كتبه العميل في المعالج فقط)', () => {
  assert.ok(!/sales|invoices|items|balances|totals|journal/i.test(Object.keys(buildRegistrationReport(CUSTOMER)).join()))
  assert.ok(!/sales|invoices|journal/.test(clientSrc), 'الوحدة يجب ألا تعرف الفواتير أو القيود')
})

/* سياسة الخصوصية تعد العميل بحذف سجله خلال 30 يوماً — الوعد بلا أداة تنفيذ
   وعد فارغ. الأداة: أمر البوت `/احذف` ودالة `deleteRegistration`. */
await okAsync('حق الحذف منفَّذ لا موعود فقط (أمر /احذف + رفض المعرّف التالف)', async () => {
  const regSrc = src('../../tools/devbot/src/registrations.js')
  assert.match(regSrc, /export async function deleteRegistration/)
  assert.match(regSrc, /DEVICE_RE\.test\(device\)/) // لا حذف بمعرّف غير صالح
  assert.match(workerSrc, /case '\/احذف'/)
  assert.match(workerSrc, /deleteRegistration\(cfg, arg\(0\)\)/)
  assert.match(panelSrc, /\/احذف/) // اللوحة تذكر الأداة للمطوّر
  assert.match(src('../src/core/legal.ts'), /يُستجاب خلال 30 يوماً/)

  const kv = new MemoryKv()
  await saveRegistration({ kv }, sanitizeRegistration(CUSTOMER))
  assert.ok(await kv.get(regKey(CUSTOMER.deviceId)))
  const bad = await deleteRegistration({ kv }, 'ليس-معرفاً')
  assert.equal(bad.ok, false)
  assert.ok(await kv.get(regKey(CUSTOMER.deviceId)), 'الرفض يجب ألا يحذف شيئاً')
  const gone = await deleteRegistration({ kv }, CUSTOMER.deviceId)
  assert.deepEqual({ ok: gone.ok, existed: gone.existed }, { ok: true, existed: true })
  assert.equal(await kv.get(regKey(CUSTOMER.deviceId)), null)
  assert.equal((await deleteRegistration({ kv }, CUSTOMER.deviceId)).existed, false)
})

/* خطط Cloudflare المجانية تحدّ النداءات الفرعية بـ50 للطلب الواحد: قائمة
   التسجيلات كانت تقرأ كل سجل بـget ⇒ تنهار عند نحو 48 عميلاً. الفهرس في
   metadata المفتاح يجعل القائمة من `list` وحده. */
await okAsync('قائمة التسجيلات تُبنى من فهرس metadata (بلا get لكل سجل) وتُبلّغ عن المتروك', async () => {
  const regSrc = src('../../tools/devbot/src/registrations.js')
  assert.match(regSrc, /metadata: registrationMetadata\(record\)/)
  assert.match(regSrc, /REG_META_VERSION = 1/)
  assert.match(regSrc, /REG_MAX_READS = 40/)
  assert.match(regSrc, /return \{ records: out, skipped \}/)
  assert.match(workerSrc, /const \{ records, skipped \} = await listRegistrations\(cfg\)/)
  assert.match(panelSrc, /const \{ rows, skipped \} = await registrationRows\(cfg\)/)
  assert.match(panelSrc, /await Promise\.all\(\[listRegistrations\(cfg\), issuedDeviceIds\(cfg\)\]\)/)

  const kv = new MemoryKv()
  await saveRegistration({ kv }, sanitizeRegistration(CUSTOMER))
  await saveRegistration({ kv }, sanitizeRegistration({ ...CUSTOMER, deviceId: 'SHOP-BBB2-2222-2222', shopName: 'الثاني' }))
  let gets = 0
  const spy = {
    get: async (k) => { gets++; return kv.get(k) },
    put: (k, v, o) => kv.put(k, v, o),
    delete: (k) => kv.delete(k),
    list: (o) => kv.list(o),
  }
  const { records, skipped } = await listRegistrations({ kv: spy })
  assert.equal(gets, 0, 'الفهرس يجب أن يكفي — صفر قراءات')
  assert.equal(records.length, 2)
  assert.equal(skipped, 0)
  assert.match(formatRegistrationsAr(records), /بقالة النور/)
})

/* `/register` نقطة عامة بلا سرّ (أي سرّ مضمّن في التطبيق مكشوف). التخزين محدود
   الأثر بالتعقيم والحدود، لكن **التنبيه** لكل جهاز جديد قناة إزعاج: سكربت بأرقام
   أجهزة مختلقة يُغرق محادثة المطوّر، وتليجرام يحدّ ~20 رسالة/دقيقة للمحادثة ⇒
   429 يؤخّر البلاغات الحقيقية. السقف يومي ويُسقف التنبيه لا التسجيل. */
await okAsync('سقف تنبيهات التسجيل اليومي: التنبيه يُسقف والتخزين يستمر', async () => {
  assert.equal(REG_TG_DAILY_CAP, 25)
  assert.equal(regAlertKey('2026-10-08'), 'reg-tg:2026-10-08')
  const kv = new MemoryKv()
  let allowed = 0
  let crossings = 0
  for (let i = 0; i < REG_TG_DAILY_CAP + 5; i++) {
    const r = await consumeRegistrationAlert({ kv }, '2026-10-08')
    if (r.allowed) allowed++
    if (r.justCrossed) crossings++
  }
  assert.equal(allowed, REG_TG_DAILY_CAP, 'السقف لا يُحترم')
  assert.equal(crossings, 1, 'الإبلاغ عن مجاوزة السقف يجب أن يكون مرة واحدة')
  /* اليوم التالي حصة جديدة */
  assert.equal((await consumeRegistrationAlert({ kv }, '2026-10-09')).allowed, true)
  /* والتخزين نفسه لا يمرّ عبر السقف */
  const regSrc = src('../../tools/devbot/src/registrations.js')
  assert.match(regSrc, /expirationTtl: 172_800/)
  assert.match(workerSrc, /const alert = await consumeRegistrationAlert\(cfg\)/)
  assert.match(workerSrc, /if \(alert\.allowed\) await sendTelegram/)
  assert.match(workerSrc, /alert\.justCrossed/)
  const before = await saveRegistration({ kv }, sanitizeRegistration(CUSTOMER))
  assert.equal(before.saved, true)
})

/* المركز يرسل بـparse_mode=HTML: اسم محل فيه `&` غير مُهرَّبة يُفشل الرسالة كلها
   فيبتلعها catch ⇒ لا يصلك بلاغ العميل الجديد (بند 2 يتعطل لعملاء بعينهم). */
ok('بلاغ التسجيل يهرّب كل قيمة كتبها العميل قبل إدراجها في HTML', async () => {
  const regSrc = src('../../tools/devbot/src/registrations.js')
  assert.match(regSrc, /import \{ tgEscape \} from '\.\/tgHtml\.js'/)
  const withAmp = sanitizeRegistration({ ...CUSTOMER, shopName: 'سوبر ماركت A&B', ownerName: 'أحمد &#x27;', city: 'المنصورة <b>' })
  const text = formatServerAr(withAmp)
  assert.ok(text.includes('A&amp;B'), 'الاسم ذو & لم يُهرَّب')
  assert.ok(!text.includes('&#x27;'), 'تسلسل كيان غير مُهرَّب يمرّ كما هو')
  assert.ok(!/<b>/.test(text.replace(/<\/?(b|code)>/g, '')), 'وسوم من مدخل العميل وصلت')
})


console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
