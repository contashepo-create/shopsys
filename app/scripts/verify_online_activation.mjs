/**
 * بوابة التفعيل عبر الإنترنت + إصلاح CORS لنقاط الكتابة في مركز الترخيص (v1.0.22).
 * تعمل على كود الـWorker الحقيقي بتخزين KV وهمي — بلا شبكة.
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import worker from '../../tools/devbot/src/worker.js'
import { issueLicenseKey, keyFingerprint } from '../../tools/devbot/src/licenseLib.js'

const BASE = 'https://shopsys-control.mobileshop2026.workers.dev'
const DEVICE = 'SHOP-ABCD-1234-EF56'
const OTHER = 'SHOP-ZZZZ-9999-QQQQ'
const origin = 'file://'
let failures = 0
const ok = (name) => console.log(`✓ ${name}`)
const fail = (name, err) => { failures++; console.log(`❌ ${name}: ${err.message}`) }
async function check(name, fn) { try { await fn(); ok(name) } catch (err) { fail(name, err) } }

const kvStore = new Map()
const kv = {
  get: async (k) => kvStore.get(k) ?? null,
  put: async (k, v) => { kvStore.set(k, v) },
  list: async () => ({ keys: [] }),
  delete: async (k) => { kvStore.delete(k) },
}
const env = { SHOPSYS_CONTROL: kv }

const { privateKey } = generateKeyPairSync('ed25519')
const privB64u = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')

const today = new Date().toISOString().slice(0, 10)
const payload = (over = {}) => ({
  v: 1, deviceId: DEVICE, customer: 'عميل تجريبي', plan: 'pro',
  features: ['pos'], issuedAt: today, expiresAt: '2099-12-31', ...over,
})
async function issue(over) {
  const p = payload(over)
  const key = await issueLicenseKey(p, privB64u)
  kvStore.set(`lic:${keyFingerprint(key)}`, JSON.stringify({ payload: p, key, issuedAt: p.issuedAt, revoked: false }))
  return key
}
const activate = (body, raw) => worker.fetch(new Request(`${BASE}/activate`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin },
  body: raw ?? JSON.stringify(body),
}), env)

await check('preflight POST /activate يسمح بـ content-type وبـ POST', async () => {
  const res = await worker.fetch(new Request(`${BASE}/activate`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  }), env)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /content-type/i)
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/)
})

await check('preflight POST /register يسمح بـ content-type (إصلاح الخلل الأصلي)', async () => {
  const res = await worker.fetch(new Request(`${BASE}/register`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  }), env)
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /content-type/i)
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/)
})

await check('مفتاح صحيح لجهازه ⇒ 200 مع الخطة وتاريخ الانتهاء', async () => {
  const key = await issue()
  const res = await activate({ deviceId: DEVICE, key })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.plan, 'pro')
  assert.equal(body.expiresAt, '2099-12-31')
  assert.equal(body.customer, undefined, 'لا تُعاد بيانات العميل')
})

await check('مفتاح مُصدَر لجهاز آخر ⇒ 403 device_mismatch', async () => {
  const key = await issue({ deviceId: OTHER })
  const res = await activate({ deviceId: DEVICE, key })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'device_mismatch')
})

await check('مفتاح مُبطَل بقائمة revoked ⇒ 403 revoked', async () => {
  const key = await issue({ expiresAt: '2099-01-01', issuedAt: '2026-01-02' })
  kvStore.set('revoked', JSON.stringify([keyFingerprint(key)]))
  const res = await activate({ deviceId: DEVICE, key })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'revoked')
  kvStore.delete('revoked')
})

await check('مفتاح مُبطَل بعلم السجل ⇒ 403 revoked', async () => {
  const key = await issue({ issuedAt: '2026-01-03' })
  const fp = keyFingerprint(key)
  const rec = JSON.parse(kvStore.get(`lic:${fp}`))
  kvStore.set(`lic:${fp}`, JSON.stringify({ ...rec, revoked: true }))
  const res = await activate({ deviceId: DEVICE, key })
  assert.equal((await res.json()).code, 'revoked')
})

await check('مفتاح منتهٍ ⇒ 403 expired', async () => {
  const key = await issue({ expiresAt: '2020-01-01', issuedAt: '2019-12-01' })
  const res = await activate({ deviceId: DEVICE, key })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'expired')
})

await check('مفتاح لم يُصدَر من المطوّر (تزوير/تعديل) ⇒ 404 unknown_key', async () => {
  const key = await issue({ issuedAt: '2026-01-04' })
  const tampered = key.slice(0, -4) + 'AAAA'
  const res = await activate({ deviceId: DEVICE, key: tampered })
  assert.equal(res.status, 404)
  assert.equal((await res.json()).code, 'unknown_key')
})

await check('معرّف جهاز بصيغة خاطئة ⇒ 400', async () => {
  const res = await activate({ deviceId: 'تالف', key: 'SHOPSYS1.a.b' })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'bad_device')
})

await check('صيغة مفتاح خاطئة ⇒ 400 bad_key', async () => {
  const res = await activate({ deviceId: DEVICE, key: 'NOPE' })
  assert.equal((await res.json()).code, 'bad_key')
})

await check('JSON تالف ⇒ 400 ومتطلب حجم ⇒ 413', async () => {
  const bad = await activate(null, '{not json')
  assert.equal(bad.status, 400)
  const big = await activate(null, JSON.stringify({ deviceId: DEVICE, key: 'x'.repeat(5000) }))
  assert.equal(big.status, 413)
})

await check('GET /activate غير مسموح ⇒ 405', async () => {
  const res = await worker.fetch(new Request(`${BASE}/activate`, { method: 'GET', headers: { origin } }), env)
  assert.equal(res.status, 405)
})

/* ═══ حماية بلاغ 2026-10-11 ═══════════════════════════════════════════════
 * العميل رأى «التفعيل يتطلب الاتصال بالإنترنت» وهو متصل. السبب: العامل المنشور
 * كان أقدم من نقطة /activate، فردّ على أي مسار غير معروف بـ200 ونص
 * «shopsys-control»، فسقط فحص العميل إلى فرع offline. الحالات التالية تمنع
 * تكرار الالتباس: العامل يرد 404 JSON صريحاً، والعميل يميّز «رد بلا عقد» عن
 * «لا رد إطلاقاً». */
await check('مسار غير معروف ⇒ JSON 404 برمز وسبب (لا 200 بنصّ يُلبِس على العميل)', async () => {
  const res = await worker.fetch(new Request(`${BASE}/activate-v2`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }), env)
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type') ?? '', /application\/json/)
  const body = await res.json()
  assert.equal(body.code, 'not_found')
  assert.ok(typeof body.reason === 'string' && body.reason.length > 0, 'لا بد من سبب عربي يشرح للمطوّر أن العامل لم يُنشر')
})

await check('المسار الجذري ما زال نبضة حياة نصية 200', async () => {
  const res = await worker.fetch(new Request(`${BASE}/`, { headers: { origin } }), env)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'shopsys-control')
})

await check('العميل: رد 200 بنص قديم ⇒ unavailable (لا يُقال للعميل «تحقق من الاتصال»)', async () => {
  const { checkActivationOnline } = await import('../src/core/activation.ts')
  const legacyWorker = async () => new Response('shopsys-control', { status: 200, headers: { 'content-type': 'text/plain' } })
  const result = await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: legacyWorker })
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.status, 200)
})

await check('العميل: انقطاع الشبكة فعلاً ⇒ offline (الرسالة الأصلية باقية)', async () => {
  const { checkActivationOnline } = await import('../src/core/activation.ts')
  const dead = async () => { throw new TypeError('fetch failed') }
  const result = await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: dead })
  assert.equal(result.kind, 'offline')
})

await check('العميل: رسالة «الخدمة لم تُجب» تحمل رمز HTTP وتنفي مسؤولية اتصال العميل', async () => {
  const { activationUnavailableAr } = await import('../src/core/activation.ts')
  const message = activationUnavailableAr(404)
  assert.match(message, /رمز 404/)
  assert.match(message, /الإنترنت عندك سليم/)
})

if (failures > 0) {
  console.log(`\n❌ فشلت ${failures} حالة`)
  process.exit(1)
}
console.log('\n✅ بوابة التفعيل عبر الإنترنت ونقاط CORS تعمل')
