#!/usr/bin/env node
/**
 * verify_subscription_digest — بوابة بندي 3 و4 من تدقيق 2026-10-08:
 *   ③ «هل يوجد تنبيه عند انتهاء اشتراك العميل؟»
 *   ④ «هل يوجد تنبيه قبل أن ينتهي؟»
 *
 * ما تُثبته البوابة (السلوك + التركيب معاً):
 *   • التصنيف: منتهية (الأقدم أولاً) ثم موشكة داخل النافذة، ومدى الحياة لا يُذكَّر.
 *   • النافذة 10 أيام افتراضياً وتُضبط 1–90، وأي قيمة تالفة ⇒ الافتراضي.
 *   • لا إزعاج: يوم بلا منتهية ولا موشكة ⇒ لا رسالة إطلاقاً.
 *   • لا تكرار: علامة `digest-sent:<اليوم>` تمنع رسالة ثانية في اليوم نفسه.
 *   • **لا ينهار مع النمو**: كل كتابة لسجل جهاز تحمل فهرساً في metadata المفتاح،
 *     فالمسح يُصنَّف من `kv.list` وحده. خطط Cloudflare المجانية تحدّ النداءات
 *     الفرعية بـ50 للطلب ⇒ قراءة كل سجل بـ`get` كانت تُسقط cron التذكير بصمت
 *     عند نحو 48 جهازاً، أي أن التنبيه نفسه (غاية البندين) كان سيتوقف.
 *   • ما لا يُفحص يُبلَّغ عنه صراحة (`skipped`) — لا «كل شيء سليم» ناقص.
 *   • فشل الـcron يُرسل للمطوّر بدل ابتلاعه.
 *   • cron واحد فقط مفعّل: مركز التحكم (`tools/devbot`) لا عامل `cloud` القديم —
 *     والاثنان معاً يوصلان ملخّصين مختلفين كل صباح.
 *
 * node --experimental-strip-types scripts/verify_subscription_digest.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  subscriptionDigest, formatDigestAr, formatStatsAr, hasDigestNews,
  readSoonDays, writeSoonDays, digestMarkerKey, deviceMetadata,
  DEVICE_META_VERSION, DIGEST_MAX_READS, SOON_DAYS,
} from '../../tools/devbot/src/subscriptions.js'

const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default

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
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const workerSrc = src('../../tools/devbot/src/worker.js')
const devbotToml = src('../../tools/devbot/wrangler.toml')
const cloudToml = src('../../cloud/wrangler.toml')
const cloudWorkerSrc = src('../../cloud/worker.js')

/** KV في الذاكرة كالحقيقي: metadata يُعاد من list() بلا نداء get إضافي */
class MemoryKv {
  constructor() { this.values = new Map(); this.metas = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value, opts) {
    this.values.set(key, String(value))
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

const DAY = 86_400_000
const NOW = Date.parse('2026-10-08T00:00:00Z')
const dayIso = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10)

const putDevice = async (kv, { id, customer, plan, expiresAt, indexed = true }) => {
  const record = { customer, plan, expiresAt, email: '', fingerprint: 'abcdef01' }
  await kv.put(`dev:${id}`, JSON.stringify(record), indexed ? { metadata: deviceMetadata(record) } : undefined)
}

/** يحصي نداءات get ويعيد ما يُلتقط من رسائل تليجرام */
const instrument = (kv) => {
  const sent = []
  let gets = 0
  globalThis.fetch = async (_url, init) => {
    try {
      const body = JSON.parse(String(init.body))
      if (body && body.text) sent.push(String(body.text))
    } catch { /* ليست رسالة تليجرام */ }
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) }
  }
  return {
    sent,
    gets: () => gets,
    kv: {
      get: async (k) => { gets++; return kv.get(k) },
      put: (k, v, o) => kv.put(k, v, o),
      delete: (k) => kv.delete(k),
      list: (o) => kv.list(o),
    },
  }
}
const envOf = (kv) => ({
  SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
})

console.log('بوابة بندي 3 و4 — تنبيهات انتهاء الاشتراك وقرب الانتهاء:')

await okAsync('التصنيف: منتهية (الأقدم أولاً) ثم موشكة، ومدى الحياة لا يُذكَّر', async () => {
  const kv = new MemoryKv()
  await putDevice(kv, { id: 'SHOP-AAA1-1111-1111', customer: 'منتهي قديماً', plan: 'basic', expiresAt: dayIso(-30) })
  await putDevice(kv, { id: 'SHOP-AAA2-2222-2222', customer: 'ينتهي اليوم', plan: 'pro', expiresAt: dayIso(0) })
  await putDevice(kv, { id: 'SHOP-AAA3-3333-3333', customer: 'بعد 9 أيام', plan: 'basic', expiresAt: dayIso(9) })
  await putDevice(kv, { id: 'SHOP-AAA4-4444-4444', customer: 'بعد 11 يوماً', plan: 'pro', expiresAt: dayIso(11) })
  await putDevice(kv, { id: 'SHOP-AAA5-5555-5555', customer: 'دائم', plan: 'lifetime', expiresAt: null })
  const d = await subscriptionDigest({ kv }, { now: NOW })
  assert.equal(d.total, 5)
  assert.equal(d.lifetime, 1)
  assert.deepEqual(d.expired.map((r) => r.customer), ['منتهي قديماً'])
  assert.deepEqual(d.soon.map((r) => r.customer), ['ينتهي اليوم', 'بعد 9 أيام'])
  assert.equal(d.soon[0].days, 0)
  assert.equal(hasDigestNews(d), true)
  assert.match(formatDigestAr(d), /منتهية \(1\)/)
  assert.match(formatStatsAr(d), /منتهية: 1/)
})

await okAsync('النافذة 10 أيام افتراضياً، تُضبط 1–90، والتالف ⇒ الافتراضي', async () => {
  assert.equal(SOON_DAYS, 10)
  const kv = new MemoryKv()
  await putDevice(kv, { id: 'SHOP-AAA1-1111-1111', customer: 'بعد 20 يوماً', plan: 'basic', expiresAt: dayIso(20) })
  assert.equal((await subscriptionDigest({ kv }, { now: NOW })).soon.length, 0)
  assert.equal((await subscriptionDigest({ kv }, { now: NOW, soonDays: 30 })).soon.length, 1)
  assert.equal(await readSoonDays({ kv }), SOON_DAYS)
  await kv.put('settings:digest', '{ تالف')
  assert.equal(await readSoonDays({ kv }), SOON_DAYS)
  assert.equal(await writeSoonDays({ kv }, 999), SOON_DAYS)
  assert.equal(await writeSoonDays({ kv }, 45), 45)
  assert.equal(await readSoonDays({ kv }), 45)
})

await okAsync('لا إزعاج بلا خبر، ولا تكرار في اليوم نفسه (digest-sent)', async () => {
  const kv = new MemoryKv()
  await putDevice(kv, { id: 'SHOP-AAA1-1111-1111', customer: 'بعيد', plan: 'basic', expiresAt: dayIso(300) })
  const quiet = instrument(kv)
  await devbotWorker.scheduled({}, envOf(quiet.kv))
  assert.equal(quiet.sent.length, 0, 'يوم بلا منتهية ولا موشكة يجب ألا يرسل شيئاً')

  await putDevice(kv, { id: 'SHOP-AAA2-2222-2222', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-1) })
  const first = instrument(kv)
  await devbotWorker.scheduled({}, envOf(first.kv))
  assert.equal(first.sent.length, 1)
  assert.match(first.sent[0], /تذكير الاشتراكات اليومي/)
  assert.ok(await kv.get(digestMarkerKey(new Date().toISOString().slice(0, 10))), 'علامة اليوم تُحفظ')

  const again = instrument(kv)
  await devbotWorker.scheduled({}, envOf(again.kv))
  assert.equal(again.sent.length, 0, 'التشغيل الثاني في اليوم نفسه يجب ألا يكرر الرسالة')
})

ok('كل كتابة لسجل جهاز تحمل فهرس metadata (وإلا عاد المسح يقرأ كل سجل)', () => {
  const workerCode = code(workerSrc)
  const sites = workerCode.split('kv.put(`dev:').length - 1
  assert.ok(sites >= 3, `يُتوقع 3 مواضع كتابة لسجل الجهاز على الأقل — وُجد ${sites}`)
  let cursor = 0
  for (let i = 0; i < sites; i++) {
    cursor = workerCode.indexOf('kv.put(`dev:', cursor) + 1
    const statement = workerCode.slice(cursor, cursor + 420)
    assert.ok(statement.includes('metadata: deviceMetadata('), `موضع الكتابة ${i + 1} بلا فهرس metadata`)
  }
  assert.match(workerSrc, /deviceMetadata/)
  assert.equal(DEVICE_META_VERSION, 1)
})

await okAsync('المسح يُصنَّف من الفهرس بلا قراءات، والسجل القديم يُفهرس في مكانه', async () => {
  const kv = new MemoryKv()
  await putDevice(kv, { id: 'SHOP-AAA1-1111-1111', customer: 'مفهرس', plan: 'basic', expiresAt: dayIso(3) })
  const indexed = instrument(kv)
  const d1 = await subscriptionDigest({ kv: indexed.kv }, { now: NOW })
  assert.equal(indexed.gets(), 0, 'الفهرس يجب أن يكفي — صفر قراءات')
  assert.equal(d1.viaMetadata, 1)
  assert.deepEqual(d1.soon.map((r) => r.customer), ['مفهرس'])

  const legacy = new MemoryKv()
  await putDevice(legacy, { id: 'SHOP-AAA1-1111-1111', customer: 'قديم', plan: 'basic', expiresAt: dayIso(3), indexed: false })
  const firstPass = instrument(legacy)
  const d2 = await subscriptionDigest({ kv: firstPass.kv }, { now: NOW })
  assert.equal(firstPass.gets(), 1)
  assert.equal(d2.viaMetadata, 0)
  assert.deepEqual(d2.soon.map((r) => r.customer), ['قديم'])
  const secondPass = instrument(legacy)
  const d3 = await subscriptionDigest({ kv: secondPass.kv }, { now: NOW })
  assert.equal(secondPass.gets(), 0, 'السجل القديم لم يُفهرس أثناء الدورة الأولى')
  assert.equal(d3.viaMetadata, 1)
})

await okAsync('تجاوز حدّ القراءات ⇒ skipped صريح في الملخّص وفي الإحصائيات', async () => {
  assert.equal(DIGEST_MAX_READS, 40)
  const kv = new MemoryKv()
  for (let i = 0; i < 5; i++) {
    await putDevice(kv, { id: `SHOP-AAA${i + 1}-1111-1111`, customer: `جهاز ${i + 1}`, plan: 'basic', expiresAt: dayIso(3), indexed: false })
  }
  const d = await subscriptionDigest({ kv }, { now: NOW, maxReads: 2 })
  assert.equal(d.total, 5)
  assert.equal(d.skipped, 3)
  assert.match(formatDigestAr(d), /لم يُفحص 3/)
  assert.match(formatStatsAr(d), /لم يُفحص 3/)

  /* ولا «كل شيء سليم» صامتاً في يوم بلا خبر ناقص */
  const kv2 = new MemoryKv()
  await putDevice(kv2, { id: 'SHOP-AAA1-1111-1111', customer: 'بعيد', plan: 'basic', expiresAt: dayIso(300), indexed: false })
  const noNews = await subscriptionDigest({ kv: kv2 }, { now: NOW, maxReads: 0 })
  assert.equal(hasDigestNews(noNews), false)
  assert.equal(noNews.skipped, 1)
  assert.match(formatDigestAr(noNews), /لم يُفحص 1/)
})

await okAsync('فشل الـcron يُبلَّغ للمطوّر ولا يُبتلع بصمت', async () => {
  assert.match(code(workerSrc), /catch \(err\) \{[\s\S]{0,400}فشل تذكير الاشتراكات اليومي/)
  const kv = new MemoryKv()
  const broken = instrument(kv)
  broken.kv.list = async () => { throw new Error('kv unavailable') }
  await devbotWorker.scheduled({}, { ...envOf(kv), SHOPSYS_CONTROL: broken.kv })
  assert.ok(broken.sent.some((t) => t.includes('فشل تذكير الاشتراكات اليومي')), 'لم يصل المطوّر خبر الفشل')
})

ok('cron واحد مفعّل: مركز التحكم لا عامل cloud القديم (ملخّصان مختلفان)', () => {
  /* TOML تعليقه `#` لا `//` — يُنزع قبل الفحص حتى لا يُحسب السطر المعلّق مفعّلاً */
  const toml = (t) => t.replace(/(^|\s)#.*$/gm, '$1')
  assert.match(devbotToml, /^\[triggers\]\s*\n\s*crons = \["0 7 \* \* \*"\]/m, 'cron مركز التحكم غير مفعّل')
  /* العامل القديم يحمل ملخّصه الخاص على مفاتيح sub:* — يبقى للبوابة الأخرى
     (verify_devbot_key_issuance) لكنه يجب أن يبقى **معطلاً** حتى لا يصل
     المطوّر ملخّصان مختلفان كل صباح. */
  assert.ok(cloudWorkerSrc.includes('subscriptionDigest'), 'ملخص العامل القديم اختفى — حدّث هذه البوابة')
  assert.ok(!/^crons\s*=/m.test(toml(cloudToml)), 'cron عامل cloud صار مفعلاً — عطّله (التنبيه في cloud/DEPLOY.md)')
  assert.match(cloudToml, /#\s*crons/, 'التعليق التوضيحي لـcron القديم اختفى من wrangler.toml')
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
