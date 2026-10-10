/**
 * v1.0.22 — عامل /register بتنفيذ حقيقي (معالج fetch نفسه) مع KV داخل الذاكرة
 * وTelegram مزيّف: الحد بالبايت، إعادة الإرسال بلا تكرار تنبيه، التنبيه لمحادثة
 * المطوّر فقط، ورفض الطلبات الفاسدة.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const worker = (await import('../../tools/devbot/src/worker.js')).default

const DEVICE = 'SHOP-AAAA-BBBB-CCCC'
const URL_ = 'https://control.example.test/register'
const base = {
  deviceId: DEVICE, shopName: 'بقالة النور', ownerName: 'أحمد محمد', phone: '+20 100 123 4567',
  email: 'ahmed@example.com', city: 'المنصورة', street: 'شارع الجمهورية', activityNameAr: 'بقالة',
  registeredAt: '2026-10-10T10:00:00.000Z',
}

describe('عامل /register (تنفيذ حقيقي)', () => {
  const store = new Map<string, string>()
  const tgCalls: { url: string; body: string }[] = []
  const realFetch = globalThis.fetch
  const kv = {
    get: async (k: string) => (store.has(k) ? store.get(k)! : null),
    put: async (k: string, v: string) => { store.set(k, String(v)) },
    delete: async (k: string) => { store.delete(k) },
    list: async ({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })),
    }),
  }
  const env = { SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: '123:TEST', TELEGRAM_ADMIN_ID: '999', TELEGRAM_WEBHOOK_SECRET: 'sec' }
  const post = (body: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), env)

  beforeAll(() => {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.telegram.org')) {
        tgCalls.push({ url: String(url), body: String(init?.body ?? '') })
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error('شبكة غير مسموحة في الاختبار: ' + String(url))
    }) as typeof fetch
  })
  afterAll(() => { globalThis.fetch = realFetch })

  it('تسجيل جديد: يُحفظ ويُقبل، وينبّه المطوّر عبر بوته مرة واحدة فقط', async () => {
    const r = await post(JSON.stringify(base))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, isNew: true })
    expect(store.get('reg:' + DEVICE)).toBeTruthy()
    expect(tgCalls).toHaveLength(1)
    expect(tgCalls[0].url).toBe('https://api.telegram.org/bot123:TEST/sendMessage')
    expect(tgCalls[0].body).toContain('"chat_id":"999"')
    expect(tgCalls[0].body).toContain('بقالة النور')
  })

  it('إعادة الإرسال: isNew=false ولا تنبيه ثانٍ', async () => {
    const r = await post(JSON.stringify(base))
    expect(await r.json()).toEqual({ ok: true, isNew: false })
    expect(tgCalls).toHaveLength(1)
  })

  it('حمولة عربية أكبر من 8192 بايت (وأقل من 8192 محرف) تُرفض 413', async () => {
    const payload = JSON.stringify({ ...base, deviceId: 'SHOP-CCCC-DDDD-EEEE', shopName: 'ع'.repeat(4500) })
    expect(payload.length).toBeLessThan(8192)
    expect(new TextEncoder().encode(payload).byteLength).toBeGreaterThan(8192)
    expect((await post(payload)).status).toBe(413)
  })

  it('حمولة ASCII كبيرة تُرفض 413، وcontent-length كبير يُرفض قبل القراءة', async () => {
    expect((await post(JSON.stringify({ ...base, shopName: 'a'.repeat(9000) }))).status).toBe(413)
    expect((await post(JSON.stringify(base), { 'content-length': '999999' })).status).toBe(413)
  })

  it('معرّف جهاز فاسد 400، وJSON تالف 400، وGET 405', async () => {
    expect((await post(JSON.stringify({ ...base, deviceId: 'NOPE' }))).status).toBe(400)
    expect((await post('{not json')).status).toBe(400)
    expect((await worker.fetch(new Request(URL_, { method: 'GET' }), env)).status).toBe(405)
  })

  it('CORS: الاستجابة تسمح بالطلب من file:// (ACAO=*)', async () => {
    const r = await worker.fetch(new Request(URL_, { method: 'OPTIONS' }), env)
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('عميل ثانٍ بعربي ضمن الحد يُقبل', async () => {
    const r = await post(JSON.stringify({ ...base, deviceId: 'SHOP-EEEE-FFFF-GGGG', shopName: 'مَحَل الأمانة للتجارة العامة' }))
    expect(await r.json()).toEqual({ ok: true, isNew: true })
  })
})
