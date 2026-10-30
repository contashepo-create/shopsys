#!/usr/bin/env node
/**
 * verify_support_live_endpoint — بوابة بلاغ المالك 2026-10-27:
 * «عند إرسال رسالة للدعم يقول لي لازم اتصال بالإنترنت رغم أنه موجود».
 *
 * تُثبت أن:
 *  ① قناة الدعم في العميل مربوطة بالعامل الحيّ، والقديم بديل فقط.
 *  ② العامل الحيّ يخدم `/support/:deviceId` ببروتوكول HMAC v2 + TOFU
 *     ومنع replay وتحديد معدل، ويُرسل البلاغ للمطوّر عبر بوت تليجرام.
 *  ③ ردّ المطوّر/اللوحة يُقرأ من نفس KV (جسر محلي) لا من عامل ميت.
 *  ④ فشل النقل لا يُترجم إلى «لا يوجد إنترنت» إذا كان المسبار ناجحاً.
 *  ⑤ العملية الرئيسية في سطح المكتب تعيد محاولة عبر شبكة Chromium.
 *
 * node --experimental-strip-types scripts/verify_support_live_endpoint.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

globalThis.crypto ??= webcrypto
const appRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name) }
  catch (e) { fails.push(name); console.error('  ❌ ' + name + ': ' + e.message) }
}
const okAsync = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓ ' + name) }
  catch (e) { fails.push(name); console.error('  ❌ ' + name + ': ' + e.message) }
}

const devbotWorker = (await import(pathToFileURL(join(appRoot, '../tools/devbot/src/worker.js')).href)).default
const { runLocalSupportAction } = await import(pathToFileURL(join(appRoot, '../tools/devbot/src/supportChannel.js')).href)
const { supportBridge } = await import(pathToFileURL(join(appRoot, '../tools/devbot/src/supportBridge.js')).href)
const { SUPPORT_CLOUD_BASE_URL, SUPPORT_CLOUD_FALLBACK_URLS, SUPPORT_PROBE_URLS } = await import(pathToFileURL(join(appRoot, 'src/core/cloud.ts')).href)
const { sendSupportMessage, supportBaseCandidates, supportTransportReason } = await import(pathToFileURL(join(appRoot, 'src/core/support.ts')).href)

class MemoryKv {
  constructor() { this.values = new Map(); this.metas = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value, opts) {
    this.values.set(key, String(value))
    if (opts?.metadata !== undefined) this.metas.set(key, opts.metadata)
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

const TOKEN = 'C'.repeat(43)
const DEVICE = 'DEV-123'
const BODY = JSON.stringify({ text: 'مشكلة في الفاتورة', customer: 'محل', activity: 'مقاولات', appVersion: '1.0.54' })
let kv
let telegram
const realFetch = globalThis.fetch
const env = () => ({
  SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook', DEV_PRIVATE_KEY_B64U: 'unused', SUPPORT_LOCAL_CHANNEL: '1',
})

async function signedRequest(method, body = '', nonce = null) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestNonce = nonce ?? Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')
  const path = `/support/${DEVICE}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const canonical = `${method}\n${path}\n${timestamp}\n${requestNonce}\n${body}`
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)))).map((b) => b.toString(16).padStart(2, '0')).join('')
  const headers = {
    authorization: `Support ${TOKEN}`,
    'x-support-protocol': '2',
    'x-support-timestamp': timestamp,
    'x-support-nonce': requestNonce,
    'x-support-signature': sig,
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
  }
  return { request: new Request(`https://worker.test${path}`, { method, headers, ...(method === 'POST' ? { body } : {}) }), requestNonce }
}

/* ─── ① الأسلاك: وجهة حيّة + بديل + مسبار + تشخيص صادق ─────────────────── */
ok('وجهة الدعم = عامل التحكم الحيّ', () => {
  assert.match(SUPPORT_CLOUD_BASE_URL, /mobileshop2026\.workers\.dev/)
  assert.ok(SUPPORT_CLOUD_FALLBACK_URLS.join(',').includes('contashepo.workers.dev'))
  assert.ok(SUPPORT_PROBE_URLS.length >= 1)
})
ok('الواجهة تستخدم الوجهة الجديدة لا القديمة', () => {
  const page = read('src/ui/pages/SupportPage.tsx')
  assert.match(page, /sendSupportMessage\(SUPPORT_CLOUD_BASE_URL/)
  assert.match(page, /fetchConversation\(SUPPORT_CLOUD_BASE_URL/)
  assert.ok(!/sendSupportMessage\(APP_SERVICES_CLOUD_BASE_URL/.test(page))
})
ok('النواة: بدائل، مسبار، سبب صادق، لا ترجمة عمياء لـ status 0', () => {
  const core = read('src/core/support.ts')
  assert.match(core, /export function supportBaseCandidates/)
  assert.match(core, /export async function probeSupportConnectivity/)
  assert.match(core, /export function supportTransportReason/)
  assert.match(core, /res\.status !== 404/)
  assert.match(core, /rendererFetch\(url, method, headers, body, timeoutMs\)/)
})
ok('سبب الفشل لا يتهم الاتصال والمسبار ناجح', () => {
  const reason = supportTransportReason({ online: true, detail: 'ENOTFOUND', errorCode: 'network', attempts: 2 })
  assert.match(reason, /وصل مسبار اتصال/)
  assert.ok(!reason.includes('تحقّق من اتصال الإنترنت'))
})
ok('قائمة البدائل بلا تكرار', () => {
  const list = supportBaseCandidates(SUPPORT_CLOUD_BASE_URL)
  assert.equal(list[0], SUPPORT_CLOUD_BASE_URL)
  assert.equal(new Set(list).size, list.length)
})
ok('العملية الرئيسية: شبكة Chromium بناقل واحد' , () => {
  const main = read('desktop/main.ts')
  assert.match(main, /chromiumFetch/)
  assert.ok(/errorCode/.test(main) && /'network'/.test(main), 'رمز سبب تقني يُعاد للمُصيّر')
  assert.match(main, /SUPPORT_ALLOWED_HOSTS/)
})

/* ─── ② الأسلاك على العامل واللوحة ─────────────────────────────────────── */
ok('العامل: مسار /support + CORS لترويسات HMAC + الوضع المحلي', () => {
  const worker = read('../tools/devbot/src/worker.js')
  assert.match(worker, /handleSupportClientRequest/)
  assert.match(worker, /x-support-signature/)
  assert.match(worker, /supportLocal/)
  const wrangler = read('../tools/devbot/wrangler.toml')
  assert.match(wrangler, /\[vars\]/)
  assert.match(wrangler, /SUPPORT_LOCAL_CHANNEL = "1"/)
})
ok('وحدة القناة: HMAC v2 + TOFU + nonce + تحديد معدل', () => {
  const src = read('../tools/devbot/src/supportChannel.js')
  assert.match(src, /const SUPPORT_PROTOCOL = '2'/)
  assert.match(src, /support-auth:/)
  assert.match(src, /support-nonce:/)
  assert.match(src, /const RATE_LIMIT = 10/)
  assert.match(src, /runLocalSupportAction/)
})
ok('عميل الجسر يدعم الوضع المحلي مع بقاء المسار القديم', () => {
  const src = read('../tools/devbot/src/supportBridge.js')
  assert.match(src, /cfg\?\.supportLocal === true/)
  assert.match(src, /RUN_LOCAL|runLocalSupportAction/)
  assert.match(src, /supportBridgeUrl/) // التوافق باقٍ
})

/* ─── ③④ تنفيذ حقيقي: إرسال ⇒ تخزين ⇒ إشعار ⇒ رد ────────────────────── */
beforeRuntime()
function beforeRuntime() {
  kv = new MemoryKv()
  telegram = []
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('api.telegram.org')) {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (body?.text) telegram.push(body.text)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 88 } }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
}

await okAsync('POST موقّع ⇒ 200 + بلاغ في KV + إشعار تليجرام + ربط tgmap', async () => {
  const { request } = await signedRequest('POST', BODY)
  const res = await devbotWorker.fetch(request, env())
  assert.equal(res.status, 200)
  const chat = JSON.parse(await kv.get(`chat:${DEVICE}`))
  assert.equal(chat.length, 1)
  assert.equal(chat[0].text, 'مشكلة في الفاتورة')
  assert.ok(telegram.join('\n').includes('مشكلة في الفاتورة'))
  assert.equal(await kv.get('tgmap:88'), DEVICE)
})

await okAsync('GET موقّع ⇒ المحادثة، وإعادة nonce ⇒ 401', async () => {
  const { request, requestNonce } = await signedRequest('GET')
  const first = await devbotWorker.fetch(request, env())
  assert.equal(first.status, 200)
  assert.equal((await first.json()).length, 1)
  const replay = await devbotWorker.fetch((await signedRequest('GET', '', requestNonce)).request, env())
  assert.equal(replay.status, 401)
})

await okAsync('ردّ المطوّر وصندوق اللوحة يعملان محلياً بلا جسر', async () => {
  const local = { kv, supportLocal: true }
  const bridged = await supportBridge(local, 'telegram-reply', { messageId: '88', text: 'تم الإصلاح' })
  assert.equal(bridged.ok, true)
  const inbox = await runLocalSupportAction(local, 'inbox')
  assert.equal(inbox.ok, true)
  assert.equal(inbox.conversations[0].awaitingReply, false)
  const chat = JSON.parse(await kv.get(`chat:${DEVICE}`))
  assert.equal(chat.at(-1).from, 'developer')
})

await okAsync('عميل التطبيق يرسل ويقرأ الرد من العامل المحلي المحاكى', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('/support/')) return devbotWorker.fetch(new Request(target, init), env())
    if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 89 } }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  try {
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, JSON.parse(BODY))
    assert.equal(result.ok, true)
    assert.equal(result.attempts, 1)
  } finally { globalThis.fetch = saved }
})

await okAsync('فشل النقل مع وصول المسبار ⇒ لا اتهام قاطع بانقطاع الاتصال', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('/support/')) throw new Error('ENOTFOUND')
    return new Response('{}', { status: 200 })
  }
  try {
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, JSON.parse(BODY))
    assert.equal(result.ok, false)
    assert.equal(result.offline, false)
    assert.match(result.reason, /وصل مسبار اتصال/)
    assert.ok(!result.reason.includes('تحقّق من اتصال الإنترنت'))
  } finally { globalThis.fetch = saved }
})

globalThis.fetch = realFetch
console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
