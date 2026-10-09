/**
 * مراجعة المرحلة ③ — تسليم رسائل المطوّر: لا رسالة تضيع بصمت.
 *
 * الخلل الأصلي: `sendTelegram` لا يفحص `res.ok`، فرفض تليجرام (400 لوسوم مكسورة
 * أو رسالة أطول من 4096 حرفاً، و429 لتجاوز الحد) يمرّ بلا أثر، ثم `scheduled()`
 * يكتب علامة `digest-sent:<اليوم>` كأن التذكير وصل فيضيع في يومه.
 *
 * يثبت هذا الملف:
 *   ① الفشل النهائي **يُرمى**، والتذكير اليومي لا يكتب علامته عندئذ.
 *   ② 429 ينتظر `retry_after` ثم يعيد مرة واحدة، ولا حلقة لا نهائية.
 *   ③ 5xx يعيد مرة واحدة. 400 بسبب تحليل الوسوم يعيد نصاً عادياً فتصل الرسالة.
 *   ④ الرسالة الطويلة تُقسَّم عند حدود السطر، ولا ينكسر وسم ولا كيان HTML،
 *      ولوحة الأزرار تُلصق بالجزء الأخير.
 *   ⑤ ردّ الـwebhook يعود 200 دائماً (تليجرام يعيد التحديث عند غيره فيتكرر الأمر).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendTelegram, splitForTelegram, htmlToPlain, TG_MAX_CHARS } = await import('../../tools/devbot/src/tgSend.js')
const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { subscriptionDigest, digestMarkerKey } = await import('../../tools/devbot/src/subscriptions.js')

type Call = { url: string; body: Record<string, unknown> }
const cfg = { token: 'bot-token' }

/** يردّ بقائمة نتائج متتالية (آخرها يتكرر)، ويسجّل كل نداء */
function scriptedTelegram(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> })
    const response = responses[Math.min(index, responses.length - 1)]
    index++
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
const OK = { status: 200, body: { ok: true, result: { message_id: 1 } } }
const FAIL = (status: number, description: string, parameters?: Record<string, unknown>) => ({
  status,
  body: { ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) },
})

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

const DAY = 86_400_000
const dayIso = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { vi.unstubAllGlobals() })

describe('① الفشل النهائي يُرمى ولا يُبتلع', () => {
  it('نجاح ⇒ نداء واحد بتنسيق HTML', async () => {
    const calls = scriptedTelegram([OK])
    await sendTelegram(cfg, '777', '<b>مرحباً</b>')
    expect(calls).toHaveLength(1)
    expect(calls[0].body.parse_mode).toBe('HTML')
    expect(calls[0].body.chat_id).toBe('777')
  })

  it('400 غير متعلق بالوسوم (المحادثة غير موجودة) ⇒ يُرمى الخطأ بوصف تليجرام، بلا إعادة', async () => {
    const calls = scriptedTelegram([FAIL(400, 'Bad Request: chat not found')])
    await expect(sendTelegram(cfg, '777', 'نص')).rejects.toThrow(/chat not found/)
    expect(calls).toHaveLength(1)
  })

  it('429 يتكرر بعد الانتظار ثم يفشل ⇒ يُرمى الخطأ (لا حلقة لا نهائية)', async () => {
    const calls = scriptedTelegram([FAIL(429, 'Too Many Requests: retry after 0', { retry_after: 0 })])
    await expect(sendTelegram(cfg, '777', 'نص')).rejects.toThrow(/429/)
    expect(calls).toHaveLength(2)
  })

  it('المذنب الأصلي: التذكير اليومي لا يكتب علامة اليوم حين يفشل الإرسال', async () => {
    const kv = new MemoryKv()
    await kv.put(`dev:SHOP-ZZZ1-1111-1111`, JSON.stringify({ customer: 'قريب', plan: 'basic', expiresAt: dayIso(2) }))
    scriptedTelegram([FAIL(400, 'Bad Request: chat not found')])
    const env = { SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_ADMIN_ID: '777' }

    await expect(devbotWorker.scheduled!({} as never, env as never)).resolves.toBeUndefined()

    expect(await kv.get(digestMarkerKey(new Date().toISOString().slice(0, 10)))).toBeNull()
  })
})

describe('② إعادة المحاولة المحدودة', () => {
  it('429 ينتظر retry_after ثم ينجح في الإعادة', async () => {
    const calls = scriptedTelegram([FAIL(429, 'Too Many Requests', { retry_after: 0 }), OK])
    await sendTelegram(cfg, '777', 'نص')
    expect(calls).toHaveLength(2)
    expect(calls[1].body.text).toBe('نص')
  })

  it('5xx يعيد مرة واحدة ثم ينجح', async () => {
    const calls = scriptedTelegram([FAIL(502, 'Bad Gateway'), OK])
    await sendTelegram(cfg, '777', 'نص')
    expect(calls).toHaveLength(2)
  })
})

describe('③ 400 بسبب الوسوم ⇒ نص عادي يصل', () => {
  it('يعيد الإرسال بلا parse_mode وبالنص المفكوك (الكيانات تُفكّ بالترتيب الصحيح)', async () => {
    const calls = scriptedTelegram([FAIL(400, "Bad Request: can't parse entities: Unsupported start tag"), OK])
    await sendTelegram(cfg, '777', '<b>عميل</b> &amp; <code>SHOP-A</code> &lt;جديد&gt;')
    expect(calls).toHaveLength(2)
    expect(calls[1].body.parse_mode).toBeUndefined()
    expect(calls[1].body.text).toBe('عميل & SHOP-A <جديد>')
  })

  it('htmlToPlain: يزيل الوسوم ولا يحوّل &amp;lt; إلى < (فكّ &amp; آخراً)', () => {
    expect(htmlToPlain('<b>A &amp;lt; B</b> &lt;x&gt;')).toBe('A &lt; B <x>')
  })
})

describe('④ التقسيم الآمن للرسائل الطويلة', () => {
  it('الرسالة القصيرة جزء واحد كما هي', () => {
    expect(splitForTelegram('سطر')).toEqual(['سطر'])
  })

  it('300 صف (كل صف سطر مستقل) ⇒ أجزاء ≤ الحد، صفوف كاملة، بلا فقد ولا تكرار', () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      `⏳ <b>محل ${i} &amp; فرع</b> — <code>SHOP-A${String(i).padStart(3, '0')}-1111-1111</code> · يتبقى 3 أيام`)
    const text = rows.join('\n')
    expect(text.length).toBeGreaterThan(TG_MAX_CHARS)
    const parts = splitForTelegram(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(TG_MAX_CHARS)
      expect(part.split('<b>').length).toBe(part.split('</b>').length) // وسوم متوازنة في كل جزء
    }
    expect(parts.join('\n')).toBe(text)
  })

  it('سطر بلا مسافات يُقطع قبل الكيان &amp; لا داخله', () => {
    const line = `${'a'.repeat(3797)}&amp;${'b'.repeat(10)}`
    const parts = splitForTelegram(line)
    expect(parts.length).toBe(2)
    expect(parts[1].startsWith('&amp;')).toBe(true)
    expect(parts[0].endsWith('&am')).toBe(false)
    expect(parts.join('')).toBe(line)
  })

  it('لا ينقسم وسم <b> في منتصفه', () => {
    const line = `${'a'.repeat(3798)}<b>${'c'.repeat(20)}</b>`
    const parts = splitForTelegram(line)
    expect(parts[1].startsWith('<b>')).toBe(true)
    expect(parts.join('')).toBe(line)
  })

  it('لوحة الأزرار تُلصق بآخر جزء فقط', async () => {
    const calls = scriptedTelegram([OK])
    const keyboard = { reply_markup: { inline_keyboard: [[{ text: 'رجوع', callback_data: 'panel:home' }]] } }
    const long = Array.from({ length: 200 }, (_, i) => `سطر ${i} ${'ن'.repeat(30)}`).join('\n')
    await sendTelegram(cfg, '777', long, keyboard)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0].body.reply_markup).toBeUndefined()
    expect(calls[calls.length - 1].body.reply_markup).toEqual(keyboard.reply_markup)
  })
})

describe('⑤ ردّ الـwebhook يعود 200 دائماً', () => {
  const hook = (kv: MemoryKv, body: string) =>
    devbotWorker.fetch(
      new Request('https://shopsys-control/telegram/hook-secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' },
        body,
      }),
      { SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_ADMIN_ID: '777', WEBHOOK_SECRET: 'hook-secret' } as never,
    )
  const adminCommand = (text: string) => JSON.stringify({ update_id: 1, message: { text, chat: { id: 777 }, from: { id: 777 } } })

  it('JSON تالف ⇒ 200 بلا أي إرسال', async () => {
    const calls = scriptedTelegram([OK])
    const res = await hook(new MemoryKv(), '{ليس JSON')
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(0)
  })

  it('فشل إرسال الرد (chat not found) ⇒ ما زال 200 حتى لا يُعاد التحديث', async () => {
    /* الخطأ هنا هو المقصود: يُسجَّل في console.error ولا يُظهَر في نتيجة الاختبار */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const calls = scriptedTelegram([FAIL(400, 'Bad Request: chat not found')])
      const res = await hook(new MemoryKv(), adminCommand('/تذكير'))
      expect(res.status).toBe(200)
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })

  it('استثناء داخل الأمر (KV معطّل) ⇒ 200، والمطوّر يُبلَّغ بالخطأ', async () => {
    const broken = new MemoryKv()
    broken.list = async () => { throw new Error('kv unavailable') }
    const calls = scriptedTelegram([OK])
    const res = await hook(broken, adminCommand('/تذكير'))
    expect(res.status).toBe(200)
    expect(calls.some((c) => JSON.stringify(c.body).includes('kv unavailable') || JSON.stringify(c.body).includes('تعذّر'))).toBe(true)
  })

  it('المسح يعيد الخطأ الحقيقي لمن يستدعيه (لا يُخفى داخل الدالة)', async () => {
    const broken = new MemoryKv()
    broken.list = async () => { throw new Error('kv unavailable') }
    await expect(subscriptionDigest({ kv: broken } as never, { now: Date.now() })).rejects.toThrow('kv unavailable')
  })
})
