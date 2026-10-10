/**
 * بند S1 و S4 (مراجعة التوافق 2026-10-10) على بوت المطوّر:
 *  S1 — «آخر ظهور» يُكتب على `dev:` عند طلب الجهاز حالته (مُخفَّف كل 6 ساعات).
 *  S4 — إعادة الإصدار عبر `/اصدر` تحفظ البريد وبقية الحقول بدل استبدال السجل.
 * الاختبار يشغّل العامل الحقيقي (webhook) مع KV في الذاكرة و fetch مُعترَض.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import devbotWorker from '../../tools/devbot/src/worker.js'
import { touchDeviceLastSeen, LAST_SEEN_THROTTLE_MS } from '../../tools/devbot/src/subscriptions.js'
import { b64uEncode } from '../src/core/license.ts'

const DEV = 'SHOP-AAAA-BBBB-CCCC'
let privB64 = ''

function memKv(seed: Record<string, string> = {}) {
  const store = new Map<string, { value: string; metadata: unknown }>(Object.entries(seed).map(([k, v]) => [k, { value: v, metadata: undefined }]))
  return {
    store,
    get: async (k: string) => store.get(k)?.value ?? null,
    put: async (k: string, v: string, opts?: { metadata?: unknown }) => { store.set(k, { value: v, metadata: opts?.metadata }) },
  }
}

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  privB64 = b64uEncode(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('S1 — آخر ظهور للجهاز', () => {
  it('يكتب lastSeenAt عند طلب /subscription مع تحديث metadata', async () => {
    const kv = memKv({ [`dev:${DEV}`]: JSON.stringify({ plan: 'pro', expiresAt: '2027-01-01', customer: 'محل', email: 'a@b.co', message: '', fingerprint: 'ab12cd34' }) })
    const now = Date.parse('2026-10-10T08:00:00Z')
    await touchDeviceLastSeen({ kv }, DEV, now)
    const saved = JSON.parse(kv.store.get(`dev:${DEV}`)!.value)
    expect(saved.lastSeenAt).toBe('2026-10-10T08:00:00.000Z')
    expect(saved.email).toBe('a@b.co') // لا يفقد الحقول
    expect(kv.store.get(`dev:${DEV}`)!.metadata).toMatchObject({ v: 1, plan: 'pro', email: 'a@b.co', expiresAt: '2027-01-01' })
  })

  it('مُخفَّف: لا كتابة إن كان آخر ظهور أحدث من 6 ساعات', async () => {
    const recent = '2026-10-10T07:00:00.000Z'
    const kv = memKv({ [`dev:${DEV}`]: JSON.stringify({ plan: 'pro', lastSeenAt: recent }) })
    const before = kv.store.get(`dev:${DEV}`)!.value
    await touchDeviceLastSeen({ kv }, DEV, Date.parse(recent) + LAST_SEEN_THROTTLE_MS - 1)
    expect(kv.store.get(`dev:${DEV}`)!.value).toBe(before)
    await touchDeviceLastSeen({ kv }, DEV, Date.parse(recent) + LAST_SEEN_THROTTLE_MS)
    expect(JSON.parse(kv.store.get(`dev:${DEV}`)!.value).lastSeenAt).not.toBe(recent)
  })

  it('لا يكتب شيئاً لجهاز بلا سجل', async () => {
    const kv = memKv()
    await touchDeviceLastSeen({ kv }, DEV)
    expect(kv.store.size).toBe(0)
  })

  it('فشل KV لا يُفسد الرد: /subscription يعيد الحالة عادية', async () => {
    const kv = memKv({ [`dev:${DEV}`]: JSON.stringify({ plan: 'pro', expiresAt: null, message: '' }) })
    kv.put = async () => { throw new Error('KV down') }
    const res = await devbotWorker.fetch(new Request(`https://shopsys-control/subscription/${DEV}`), { SHOPSYS_CONTROL: kv })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan: 'pro', expiresAt: null, message: '' })
  })

  it('المسار /subscription يكتب آخر ظهور فعلياً', async () => {
    const kv = memKv({ [`dev:${DEV}`]: JSON.stringify({ plan: 'basic', expiresAt: null, message: '' }) })
    const res = await devbotWorker.fetch(new Request(`https://shopsys-control/subscription/${DEV}`), { SHOPSYS_CONTROL: kv })
    expect(res.status).toBe(200)
    expect(JSON.parse(kv.store.get(`dev:${DEV}`)!.value).lastSeenAt).toBeTruthy()
  })
})

describe('S4 — إعادة الإصدار عبر /اصدر تحفظ السجل', () => {
  it('يحفظ البريد وlastSeenAt ويحدّث الخطة والانتهاء', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body ?? ''))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }))
    const kv = memKv({ [`dev:${DEV}`]: JSON.stringify({ plan: 'basic', expiresAt: '2026-11-01', customer: 'قديم', email: 'owner@shop.eg', lastSeenAt: '2026-10-09T10:00:00.000Z', message: 'موقوف', disabledAt: '2026-10-08T00:00:00.000Z', fingerprint: 'oldfp000' }) })
    const env = {
      WEBHOOK_SECRET: 'hook', TELEGRAM_ADMIN_ID: '111', TELEGRAM_BOT_TOKEN: 't', DEV_PRIVATE_KEY_B64U: privB64, SHOPSYS_CONTROL: kv,
    }
    const update = { update_id: 1, message: { message_id: 1, from: { id: 111 }, chat: { id: 111 }, text: `/اصدر ${DEV} pro النور 365` } }
    const res = await devbotWorker.fetch(new Request('https://shopsys-control/telegram/hook', {
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'hook', 'content-type': 'application/json' }, body: JSON.stringify(update),
    }), env)
    expect(res.status).toBe(200)
    const saved = JSON.parse(kv.store.get(`dev:${DEV}`)!.value)
    expect(saved.plan).toBe('pro')
    expect(saved.customer).toBe("النور")
    expect(saved.email).toBe('owner@shop.eg')
    expect(saved.lastSeenAt).toBe('2026-10-09T10:00:00.000Z')
    expect(saved.fingerprint).not.toBe('oldfp000')
    // رسالة الإيقاف تخص الحالة السابقة ⇒ تُمسح، وعلامة الإيقاف تُزال لأن الإصدار تنشيط (كما تفعل اللوحة)
    expect(saved.message).toBe('')
    expect(saved).not.toHaveProperty('disabledAt')
    expect(kv.store.get(`dev:${DEV}`)!.metadata).toMatchObject({ plan: 'pro', email: 'owner@shop.eg', customer: "النور" })
  })
})
