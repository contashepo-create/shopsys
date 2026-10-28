/**
 * بلاغ المالك (2026-10-27): «قناة الدعم تقول لازم اتصال بالإنترنت رغم أن
 * الإنترنت موجود». السبب: وجهة الدعم كانت نطاق عامل قديم ميتاً، وأي فشل نقل
 * كان يُترجم إلى «تحقّق من اتصال الإنترنت».
 *
 * هذا اختبار تكامل حقيقي: عميل `core/support.ts` يوقّع HMAC v2 ويرسل إلى
 * كود عامل التحكم المحلي (tools/devbot) عبر fetch تجريبي وKV ذاكرة، فيُخزّن البلاغ في
 * KV ويُرسل إشعاراً للمطوّر؛ ثم يردّ المطوّر فيقرأ العميل الرد. كما يُثبت أن
 * التشخيص لا يتهم اتصال العميل حين يكون المسبار ناجحاً.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { runLocalSupportAction } = await import('../../tools/devbot/src/supportChannel.js')
const { supportBridge } = await import('../../tools/devbot/src/supportBridge.js')
const { sendSupportMessage, fetchConversation, supportBaseCandidates, supportFailureReason, supportTransportReason } = await import('../src/core/support.ts')
const { SUPPORT_CLOUD_BASE_URL, SUPPORT_CLOUD_FALLBACK_URLS } = await import('../src/core/cloud.ts')

const DEVICE = 'SHOP-AAAA-BBBB-CCCC'
const TOKEN = 'A'.repeat(43)
const PAYLOAD = { text: 'الفاتورة لا تُغلق بعد الترحيل', customer: 'محل النور', activity: 'مقاولات', appVersion: '1.0.54' }

class MemoryKv {
  private values = new Map<string, string>()
  private metas = new Map<string, Record<string, unknown>>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
    this.values.set(key, String(value))
    if (opts?.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key: string) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

let kv: MemoryKv
let telegram: string[]
let realFetch: typeof fetch
const env = () => ({
  SHOPSYS_CONTROL: kv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: 'unused',
  SUPPORT_LOCAL_CHANNEL: '1',
})

/** يوجّه طلبات الدعم إلى العامل الحقيقي، ويلتقط إشعارات تليجرام والمسبار */
function wireLive() {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const target = String(url)
    if (target.includes('/support/')) {
      return devbotWorker.fetch(new Request(target, init), env()) as Promise<Response>
    }
    if (target.includes('api.telegram.org')) {
      const body = JSON.parse(String(init.body ?? '{}')) as { text?: string }
      if (body?.text) telegram.push(body.text)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 501 } }), { status: 200 })
    }
    /* /about أو مسبار cloudflare ⇒ الإنترنت سليم */
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

beforeEach(() => {
  realFetch = globalThis.fetch
  kv = new MemoryKv()
  telegram = []
  wireLive()
})
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; delete (window as { shopsysSupport?: unknown }).shopsysSupport })

describe('قناة الدعم على العامل المحلي وKV تجريبي', () => {
  it('الوجهة الأساسية هي العامل الحيّ، والقديم مجرد بديل', () => {
    expect(SUPPORT_CLOUD_BASE_URL).toContain('mobileshop2026.workers.dev')
    expect(SUPPORT_CLOUD_FALLBACK_URLS.join(',')).toContain('contashepo.workers.dev')
    const candidates = supportBaseCandidates(SUPPORT_CLOUD_BASE_URL)
    expect(candidates[0]).toBe(SUPPORT_CLOUD_BASE_URL)
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('العميل يُرسل بلاغه (HMAC v2) فيُخزَّن ويُبلَّغ المطوّر، وردّه يعود للعميل', async () => {
    const sent = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(sent.ok).toBe(true)
    expect(sent.attempts).toBe(1)

    const chat = JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]') as { from: string; text: string }[]
    expect(chat).toHaveLength(1)
    expect(chat[0]).toMatchObject({ from: 'client', text: PAYLOAD.text })
    expect(telegram.join('\n')).toContain(PAYLOAD.text)
    expect(await kv.get('tgmap:501')).toBe(DEVICE)

    /* ردّ المطور (Reply على رسالة تليجرام) → محلياً عبر supportBridge */
    const bridged = await supportBridge({ kv, supportLocal: true } as never, 'telegram-reply', { messageId: '501', text: 'أصلحناها — حدّث التطبيق' })
    expect(bridged.ok).toBe(true)

    const conversation = await fetchConversation(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN)
    expect(conversation?.at(-1)).toMatchObject({ from: 'developer', text: 'أصلحناها — حدّث التطبيق' })
  })

  it('أفعال اللوحة (inbox/thread/reply) تعمل على نفس KV بلا جسر شبكة', async () => {
    await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    const local = { kv, supportLocal: true }
    const inbox = await runLocalSupportAction(local as never, 'inbox')
    expect(inbox.ok).toBe(true)
    expect(inbox.conversations[0]).toMatchObject({ deviceId: DEVICE, awaitingReply: true })
    const thread = await runLocalSupportAction(local as never, 'thread', { deviceId: DEVICE })
    expect(thread.messages).toHaveLength(1)
    const reply = await runLocalSupportAction(local as never, 'reply', { deviceId: DEVICE, text: 'تمت المراجعة' })
    expect(reply.ok).toBe(true)
    const chat = JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]') as { from: string }[]
    expect(chat.at(-1)?.from).toBe('developer')
  })

  it('التوقيع المغلوط يُرفض 401 بلا أي كتابة', async () => {
    const other = 'B'.repeat(43)
    /* أولاً نسجّل اعتماد الجهاز الصحيح (TOFU) ثم نحاول بآخر */
    await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    kv.delete(`chat:${DEVICE}`)
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, other, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.reason).toContain('إعادة ربط')
    expect(await kv.get(`chat:${DEVICE}`)).toBeNull()
  })

  it('رفض اعتماد القراءة 401 لا يُخفى بالانتقال تلقائياً إلى خادم آخر', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return new Response('{}', { status: 401 }) }))
    expect(await fetchConversation(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN)).toBeNull()
    expect(calls).toBe(1)
  })

  it('منع إعادة التشغيل: تكرار nonce مرفوض', async () => {
    const { authorizeSupportRequest } = await import('../../tools/devbot/src/supportChannel.js')
    /* نوقّع طلب GET يدوياً ثم نعيده حرفياً */
    const url = `https://worker.test/support/${DEVICE}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const requestNonce = 'N'.repeat(24)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const canonical = `GET\n/support/${DEVICE}\n${timestamp}\n${requestNonce}\n`
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const headers = {
      authorization: `Support ${TOKEN}`,
      'x-support-protocol': '2',
      'x-support-timestamp': timestamp,
      'x-support-nonce': requestNonce,
      'x-support-signature': sig,
    }
    const make = () => new Request(url, { headers })
    expect(await authorizeSupportRequest(make(), { kv } as never, DEVICE, '')).toBe(true)
    expect(await authorizeSupportRequest(make(), { kv } as never, DEVICE, '')).toBe(false)
  })
})

describe('تشخيص الفشل: لا «لا يوجد إنترنت» كاذبة', () => {
  it('خادم الدعم ميت لكن الإنترنت سليم ⇒ سبب الخدمة لا اتصال العميل', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('/support/')) throw new Error('ENOTFOUND support host')
      return new Response('{}', { status: 200 }) /* المسبار ناجح */
    }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.offline).toBe(false)
    expect(result.reason).toContain('وصل مسبار اتصال')
    expect(result.reason).toContain('خادم الدعم')
    expect(result.reason).not.toContain('تحقّق من اتصال الإنترنت')
    expect(result.attempts).toBe(1)
  })

  it('لا يصل أي خادم ⇒ رسالة الاتصال صادقة (بما فيها البروكسي/الجدار)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.offline).toBe(true)
    expect(result.reason).toContain('تحقّق من اتصال الإنترنت')
  })

  it('404 على الأساسي ثم انقطاع رد البديل يبيّن الحالتين دون افتراض عدم الوصول', async () => {
    let supportCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('/support/')) {
        supportCalls += 1
        if (target.includes('mobileshop2026')) {
          return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
        }
        throw new Error('ENOTFOUND old host')
      }
      return new Response('{}', { status: 200 }) /* المسبار */
    }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(supportCalls).toBeGreaterThan(1)
    expect(result.status).toBe(0)
    expect(result.reason).toContain('غير منشور')
    expect(result.reason).toContain('قد تكون')
  })

  it('الترجمة القديمة لرموز الخادم باقية كما هي', () => {
    expect(supportFailureReason(429)).toContain('حدّ الرسائل')
    expect(supportFailureReason(404)).toContain('غير منشور')
    expect(supportTransportReason({ online: true, attempts: 2, detail: 'ENOTFOUND' })).toContain('جُرّب 2')
  })
})


describe('إرسال الدعم عند فقد الرد أو فشل إشعار المطوّر', () => {
  it('فشل قراءة المحادثة لا يستبدل السجل الموجود بمحادثة فارغة', async () => {
    const key = `chat:${DEVICE}`
    await kv.put(key, '[{"id":1,"from":"developer","text":"رسالة محفوظة"}]')
    const originalGet = kv.get.bind(kv)
    let chatWrites = 0
    const originalPut = kv.put.bind(kv)
    vi.spyOn(kv, 'get').mockImplementation(async (name) => {
      if (name === key) throw new Error('KV unavailable')
      return originalGet(name)
    })
    vi.spyOn(kv, 'put').mockImplementation(async (name, value, opts) => {
      if (name === key) chatWrites++
      return originalPut(name, value, opts)
    })
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(chatWrites).toBe(0)
    expect(await originalGet(key)).toContain('رسالة محفوظة')
  })

  it('بيانات محادثة تالفة لا تُستبدل برسالة جديدة بلا تحذير', async () => {
    const key = `chat:${DEVICE}`
    await kv.put(key, '{invalid')
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(await kv.get(key)).toBe('{invalid')
  })

  it('فقد رد POST بعد تخزين الرسالة لا يكرر الإرسال تلقائياً ويعرض نتيجة غير مؤكدة', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const target = String(url)
      if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 501 } }), { status: 200 })
      if (target.includes('/support/')) {
        calls++
        await devbotWorker.fetch(new Request(target, init), env())
        throw new Error('response lost')
      }
      return new Response('{}', { status: 200 })
    }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(calls).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('قد تكون')
    const chat = JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]')
    expect(chat).toHaveLength(1)
  })

  it('فقد رد الناقل الرئيسي لا يكرر POST في المتصفح', async () => {
    let browserPosts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const target = String(url)
      if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 501 } }), { status: 200 })
      if (target.includes('/support/') && init.method === 'POST') browserPosts++
      return new Response('{}', { status: 200 })
    }))
    Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: {
      getToken: async () => null, setToken: async () => true,
      request: async (args: { url: string; method: string; headers: Record<string, string>; body: string }) => {
        await devbotWorker.fetch(new Request(args.url, args), env())
        return { ok: false, status: 0, body: '', error: 'response lost', errorCode: 'network' }
      },
    } })
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(browserPosts).toBe(0)
    expect(result.reason).toContain('قد تكون')
    expect(JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]')).toHaveLength(1)
  })

  it('فشل إرسال السجل لا يختبئ وراء نجاح إشعار الرسالة', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const target = String(url)
      if (target.includes('sendDocument')) return new Response(JSON.stringify({ ok: false }), { status: 500 })
      if (target.includes('sendMessage')) return new Response(JSON.stringify({ ok: true, result: { message_id: 501 } }), { status: 200 })
      if (target.includes('/support/')) return devbotWorker.fetch(new Request(target, init), env())
      return new Response('{}', { status: 200 })
    }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, { ...PAYLOAD, log: 'سجل تشخيص' })
    expect(result.ok).toBe(true)
    expect(result.notified).toBe(true)
    expect(result.logNotified).toBe(false)
    expect(result.reason).toContain('السجل')
  })

  it('عدم وصول إشعار تليجرام لا يُقدّم للمستخدم على أنه وصل للمطوّر', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const target = String(url)
      if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: false }), { status: 500 })
      if (target.includes('/support/')) return devbotWorker.fetch(new Request(target, init), env())
      return new Response('{}', { status: 200 })
    }))
    const result = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, DEVICE, TOKEN, PAYLOAD)
    expect(result.ok).toBe(true)
    expect(result.reason).not.toContain('وصلت رسالتك للمطوّر')
    expect(result.reason).toContain('الإشعار')
    expect(JSON.parse((await kv.get(`chat:${DEVICE}`)) ?? '[]')).toHaveLength(1)
  })
})
