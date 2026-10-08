#!/usr/bin/env node
/**
 * verify_support_bridge — بوابة بند 1 (تدقيق 2026-10-08):
 * «هل قناة الدعم داخل التطبيق تدعم محادثة حقيقية بين العميل ولوحة المطوّر؟»
 *
 * ما كان: المحادثة حقيقية تقنياً (HMAC v2 + TOFU + تحديد المعدل) لكنها في عامل
 * `cloud/worker.js`، بينما اللوحة والبوت في `tools/devbot`. وبوت تليجرام واحد له
 * **ويبهوك واحد** ⇒ رد المطوّر (Reply على بلاغ دعم) كان يصل للعامل الذي يملك
 * الويبهوك فقط: إن كانت اللوحة تملكه عومل الرد «أمراً غير معروف» ولم يصل العميل
 * أبداً — أي محادثة في اتجاه واحد عملياً.
 *
 * ما تُثبته البوابة (الجسر مصادَق عليه بسرّ مشترك — بلا نقل تخزين وبلا تغيير في
 * تطبيق العميل):
 *   • بلا سرّ صحيح/مضبوط ⇒ 403 والجسر مغلق كلياً.
 *   • رد المطوّر على تليجرام ⇒ يدخل محادثة العميل.
 *   • inbox/thread/reply تعمل، والمعرّفات التالفة والأفعال المجهولة تُرفض.
 *   • عميل الجسر لا يرمي استثناء أبداً، ويرشد المطوّر عند غياب الضبط.
 *   • الأسلاك موجودة: مسار العامل، تحويل الردود، الأوامر، أزرار اللوحة.
 *
 * node --experimental-strip-types scripts/verify_support_bridge.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { supportBridge, BRIDGE_SECRET_MIN } from '../../tools/devbot/src/supportBridge.js'

const cloudWorker = (await import('../../cloud/worker.js')).default

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
const cloudSrc = src('../../cloud/worker.js')
const bridgeSrc = src('../../tools/devbot/src/supportBridge.js')
const devWorkerSrc = src('../../tools/devbot/src/worker.js')
const panelSrc = src('../../tools/devbot/src/adminPanel.js')
const devWrangler = src('../../tools/devbot/wrangler.toml')
const cloudWrangler = src('../../cloud/wrangler.toml')

class MemoryKv {
  constructor() { this.values = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value) { this.values.set(key, String(value)) }
  async delete(key) { this.values.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true }
  }
}

const SECRET = 'bridge-secret-0123456789abcdef'
const DEVICE = 'SHOP-AAA1-1111-1111'
let kv

const supportEnv = (secret = SECRET) => ({
  SHOPSYS_KV: kv, DEV_BOT_TOKEN: 'tok', DEV_CHAT_ID: '777',
  TG_WEBHOOK_SECRET: 'tg', SUPPORT_ALLOWED_ORIGINS: '',
  ...(secret === null ? {} : { SUPPORT_BRIDGE_SECRET: secret }),
})

/**
 * `secret` هو ما يُقدَّم في الترويسة، و`envSecret` ما هو مضبوط في البيئة —
 * فصلهما هو ما يجعل اختبار «سرّ خاطئ» اختباراً فعلياً (لا مقارنة قيمة بنفسها).
 */
const call = async (payload, secret = SECRET, method = 'POST', envSecret = SECRET) => {
  const request = new Request('https://support-worker.dev/support-bridge', {
    method,
    headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-bridge-secret': secret }) },
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  })
  return await cloudWorker.fetch(request, supportEnv(envSecret))
}

const chat = async () => JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]')

console.log('بوابة بند 1 — توحيد قناة الدعم مع لوحة المطوّر:')

ok('الوحدة مستقلة (بلا استيراد دائري مع العامل)', () => {
  assert.ok(!/from '\.\/worker\.js'/.test(bridgeSrc), 'لا تستورد العامل')
  assert.ok(!/from '\.\/adminPanel\.js'/.test(bridgeSrc), 'لا تستورد اللوحة')
  assert.equal(BRIDGE_SECRET_MIN, 16)
  assert.match(bridgeSrc, /export async function supportBridge/)
})

await okAsync('عميل الجسر: بلا ضبط ⇒ إرشاد عربي، وبلا استثناء أبداً', async () => {
  const realFetch = globalThis.fetch
  try {
    const missing = await supportBridge({}, 'inbox')
    assert.equal(missing.ok, false)
    assert.match(missing.error, /wrangler secret put SUPPORT_BRIDGE_URL/)
    assert.equal((await supportBridge({ supportBridgeUrl: 'https://x.dev', supportBridgeSecret: 'قصير' }, 'inbox')).ok, false)

    globalThis.fetch = async () => { throw new Error('network down') }
    const down = await supportBridge({ supportBridgeUrl: 'https://x.dev', supportBridgeSecret: SECRET }, 'inbox')
    assert.equal(down.ok, false)
    assert.match(down.error, /network down/)

    globalThis.fetch = async () => new Response('not json', { status: 502 })
    const bad = await supportBridge({ supportBridgeUrl: 'https://x.dev', supportBridgeSecret: SECRET }, 'inbox')
    assert.equal(bad.ok, false)
    assert.match(bad.error, /HTTP 502/)
  } finally { globalThis.fetch = realFetch }
})

await okAsync('المصادقة: بلا سرّ/سرّ خاطئ/سرّ قصير ⇒ 403 وبلا أثر', async () => {
  kv = new MemoryKv()
  assert.equal((await call({ action: 'reply', deviceId: DEVICE, text: 'تسلّل' }, null)).status, 403)
  assert.equal((await call({ action: 'inbox' }, 'wrong-secret-value-0123456789')).status, 403)
  // سرّ قصير مضبوط في البيئة ⇒ الجسر مغلق حتى لو قدّم المهاجم القيمة نفسها
  assert.equal((await call({ action: 'inbox' }, 'short', 'POST', 'short')).status, 403)
  // بلا سرّ مضبوط في البيئة أصلاً ⇒ مغلق
  assert.equal((await call({ action: 'inbox' }, SECRET, 'POST', null)).status, 403)
  assert.equal((await chat()).length, 0)
  assert.match(cloudSrc, /function bridgeAuthorized\(request, env\)/)
  assert.match(cloudSrc, /constantTimeEqual\(presented, expected\)/)
  assert.match(cloudSrc, /expected\.length < 16/)
})

await okAsync('رد المطوّر على تليجرام يدخل محادثة العميل', async () => {
  kv = new MemoryKv()
  await kv.put('tgmap:42', DEVICE)
  const res = await call({ action: 'telegram-reply', messageId: '42', text: 'حلّلنا المشكلة' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, deviceId: DEVICE })
  assert.deepEqual(await chat(), [{ id: 1, from: 'developer', text: 'حلّلنا المشكلة', at: (await chat())[0].at }])
})

await okAsync('ربط مجهول أو تالف ⇒ 404 وبلا كتابة', async () => {
  kv = new MemoryKv()
  assert.equal((await call({ action: 'telegram-reply', messageId: '999', text: 'رد تائه' })).status, 404)
  await kv.put('tgmap:7', 'javascript:alert(1)')
  assert.equal((await call({ action: 'telegram-reply', messageId: '7', text: 'x' })).status, 404)
  assert.equal((await call({ action: 'telegram-reply', messageId: '', text: 'x' })).status, 400)
  const list = await kv.list({ prefix: 'chat:' })
  assert.equal(list.keys.length, 0)
})

await okAsync('inbox: المنتظرة رداً أولاً + آخر رسالة ووقتها', async () => {
  kv = new MemoryKv()
  await kv.put(`chat:${DEVICE}`, JSON.stringify([{ id: 1, from: 'client', text: 'لا يفتح', at: '2026-10-08T08:00:00Z' }]))
  await kv.put('chat:SHOP-BBB2-2222-2222', JSON.stringify([
    { id: 1, from: 'client', text: 'سؤال', at: '2026-10-07T08:00:00Z' },
    { id: 2, from: 'developer', text: 'أجبناك', at: '2026-10-07T09:00:00Z' },
  ]))
  const data = await (await call({ action: 'inbox' })).json()
  assert.equal(data.ok, true)
  assert.deepEqual(data.conversations.map((c) => c.deviceId), [DEVICE, 'SHOP-BBB2-2222-2222'])
  assert.equal(data.conversations[0].awaitingReply, true)
  assert.equal(data.conversations[1].awaitingReply, false)
  assert.equal(data.conversations[0].lastText, 'لا يفتح')
  assert.equal(data.conversations[0].messages, 1)
})

await okAsync('thread وreply: قراءة ودفع، ورفض التالف والفارغ والمجهول', async () => {
  kv = new MemoryKv()
  await kv.put(`chat:${DEVICE}`, JSON.stringify([{ id: 1, from: 'client', text: 'مشكلة', at: '2026-10-08T08:00:00Z' }]))
  const thread = await (await call({ action: 'thread', deviceId: DEVICE })).json()
  assert.equal(thread.messages.length, 1)

  assert.equal((await call({ action: 'reply', deviceId: DEVICE, text: 'حلّناها' })).status, 200)
  const after = await chat()
  assert.deepEqual(after.at(-1).from, 'developer')
  assert.deepEqual(after.at(-1).text, 'حلّناها')

  assert.equal((await call({ action: 'reply', deviceId: 'javascript:alert(1)', text: 'x' })).status, 400)
  assert.equal((await call({ action: 'reply', deviceId: DEVICE, text: '' })).status, 400)
  assert.equal((await call({ action: 'thread', deviceId: '../etc/passwd' })).status, 400)
  assert.equal((await call({ action: 'مجهول' })).status, 400)
  assert.equal(after.length, 2, 'المرفوضات لم تكتب شيئاً')
})

ok('العامل (اللوحة): تحويل ردود Reply + أوامر /دعم و/رد', () => {
  assert.match(devWorkerSrc, /const replyToId = msg\.reply_to_message\?\.message_id/)
  assert.match(devWorkerSrc, /supportBridge\(cfg, 'telegram-reply', \{ messageId: String\(replyToId\), text \}\)/)
  assert.match(devWorkerSrc, /if \(replyToId && !text\.startsWith\('\/'\)\)/)
  assert.match(devWorkerSrc, /case '\/دعم': case '\/support':/)
  assert.match(devWorkerSrc, /case '\/رد': case '\/reply':/)
  assert.match(devWorkerSrc, /unknown message/)
  assert.match(devWorkerSrc, /supportBridgeUrl: String\(env\.SUPPORT_BRIDGE_URL/)
  assert.match(devWorkerSrc, /import \{ supportBridge \} from '\.\/supportBridge\.js'/)
})

ok('اللوحة: صندوق الدعم بالأزرار + تدفق الرد', () => {
  assert.match(panelSrc, /panel:support/)
  assert.match(panelSrc, /supportInboxReply/)
  assert.match(panelSrc, /support-thread:/)
  assert.match(panelSrc, /support-reply:/)
  assert.match(panelSrc, /flow\.kind === 'supportreply'/)
  assert.match(panelSrc, /بانتظار ردك/)
})

ok('الضبط موثّق في العاملين (سرّ مشترك واحد)', () => {
  assert.match(devWrangler, /SUPPORT_BRIDGE_URL/)
  assert.match(devWrangler, /SUPPORT_BRIDGE_SECRET/)
  assert.match(cloudWrangler, /SUPPORT_BRIDGE_SECRET/)
  assert.match(cloudWrangler, /\/support-bridge/)
})

ok('قناة العميل لم تتغيّر: HMAC v2 وتحديد المعدل باقيان كما هما', () => {
  assert.match(cloudSrc, /const SUPPORT_PROTOCOL = '2'/)
  assert.match(cloudSrc, /x-support-signature/)
  assert.match(cloudSrc, /const RATE_LIMIT = 10/)
  assert.match(cloudSrc, /support-nonce:/)
  assert.ok(cloudSrc.includes('path.match(/^\\/support\\/([A-Za-z0-9_-]{6,64})$/)'), 'مسار قناة العميل تغيّر')
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
