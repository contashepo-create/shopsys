/**
 * بند 1 (تدقيق 2026-10-08) — توحيد قناة الدعم مع لوحة المطوّر.
 *
 * ما كان: المحادثة حقيقية (HMAC v2 + TOFU + تحديد المعدل) لكنها تعيش في عامل
 * `cloud/worker.js`، بينما لوحة المطوّر والبوت في `tools/devbot`. وبوت تليجرام
 * واحد له **ويبهوك واحد** ⇒ كان رد المطوّر (Reply على بلاغ دعم) يصل للعامل الذي
 * يملك الويبهوك فقط: إن كانت اللوحة تملكه عومل الرد «أمراً غير معروف» ولم يصل
 * العميل أبداً. أي أن المحادثة كانت في اتجاه واحد عملياً.
 *
 * الحل المُختبَر هنا: جسر مصادَق عليه بسرّ مشترك — بلا نقل تخزين وبلا أي تغيير
 * في تطبيق العميل. الاختبار **تكامل حقيقي**: عميل الجسر في اللوحة ينادي عامل
 * الدعم الحقيقي (fetch مُوجَّه إليه) لا بديلاً مزيفاً.
 *
 * يثبت:
 *   ① بلا سرّ صحيح ⇒ 403 (وبلا سرّ مضبوط أصلاً ⇒ الجسر مغلق كلياً).
 *   ② رد المطوّر على تليجرام (Reply) ⇒ يصل محادثة العميل داخل التطبيق.
 *   ③ الصندوق والمحادثة والرد من اللوحة ومن الأوامر /دعم و/رد.
 *   ④ المعرّفات التالفة والأفعال المجهولة تُرفض بلا كتابة.
 *   ⑤ فشل الجسر ⇒ رسالة إرشادية عربية، ولا استثناء يوقف البوت.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cloudWorker = (await import('../../cloud/worker.js')).default
const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton, handlePanelText } = await import('../../tools/devbot/src/adminPanel.js')
const { supportBridge, BRIDGE_SECRET_MIN } = await import('../../tools/devbot/src/supportBridge.js')

const SECRET = 'bridge-secret-0123456789abcdef'

class MemoryKv {
  private values = new Map<string, string>()
  /* metadata المفاتيح كما في KV الحقيقي: يُعاد من list() بلا نداء get إضافي */
  private metas = new Map<string, Record<string, unknown>>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
    this.values.set(key, String(value))
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key: string) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })), list_complete: true }
  }
}

let supportKv: MemoryKv   // مساحة عامل الدعم (المحادثات)
let panelKv: MemoryKv     // مساحة لوحة المطوّر (العملاء والتراخيص)

const supportEnv = (secret: string | null = SECRET) => ({
  SHOPSYS_KV: supportKv,
  DEV_BOT_TOKEN: 'bot-token',
  DEV_CHAT_ID: '777',
  TG_WEBHOOK_SECRET: 'tg-secret',
  SUPPORT_ALLOWED_ORIGINS: '',
  ...(secret === null ? {} : { SUPPORT_BRIDGE_SECRET: secret }),
})

const panelEnv = () => ({
  SHOPSYS_CONTROL: panelKv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: 'unused-here',
  SUPPORT_BRIDGE_URL: 'https://support-worker.dev',
  SUPPORT_BRIDGE_SECRET: SECRET,
})

const panelCfg = () => ({ kv: panelKv, supportBridgeUrl: 'https://support-worker.dev', supportBridgeSecret: SECRET } as never)

/** يوجّه نداءات الجسر إلى عامل الدعم الحقيقي، ويلتقط رسائل التليجرام */
const wireBridge = () => {
  const telegram: { text: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const target = String(url)
    if (target.includes('/support-bridge')) {
      return await cloudWorker.fetch(new Request(target, init), supportEnv()) as Response
    }
    const body = JSON.parse(String(init.body ?? '{}')) as { text?: string }
    if (body?.text) telegram.push({ text: body.text })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 })
  }))
  return telegram
}

const bridgePost = async (payload: unknown, secret: string | null = SECRET, method = 'POST') => {
  const request = new Request('https://support-worker.dev/support-bridge', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-bridge-secret': secret }),
    },
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  })
  return await cloudWorker.fetch(request, supportEnv(secret === null ? null : SECRET)) as Response
}

const chat = async (deviceId: string) => JSON.parse((await supportKv.get(`chat:${deviceId}`)) ?? '[]') as { from: string; text: string }[]

beforeEach(() => {
  vi.unstubAllGlobals()
  supportKv = new MemoryKv()
  panelKv = new MemoryKv()
})

describe('① مصادقة الجسر', () => {
  it('بلا ترويسة سرّ ⇒ 403 وبلا أي أثر', async () => {
    const res = await bridgePost({ action: 'reply', deviceId: 'SHOP-AAA1-1111-1111', text: 'تسلّل' }, null)
    expect(res.status).toBe(403)
    expect(await chat('SHOP-AAA1-1111-1111')).toHaveLength(0)
  })

  it('سرّ خاطئ ⇒ 403', async () => {
    expect((await bridgePost({ action: 'inbox' }, 'wrong-secret-value-0123456789')).status).toBe(403)
  })

  it('سرّ مضبوط أقصر من الحد ⇒ الجسر مغلق كلياً (لا وضع تطوير مفتوح)', async () => {
    const res = await cloudWorker.fetch(
      new Request('https://support-worker.dev/support-bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bridge-secret': 'short' },
        body: JSON.stringify({ action: 'inbox' }),
      }),
      supportEnv('short'),
    ) as Response
    expect(res.status).toBe(403)
  })

  it('طلب غير POST ⇒ لا يُعالج كفعل', async () => {
    const res = await bridgePost({ action: 'inbox' }, SECRET, 'GET')
    expect([404, 405]).toContain(res.status)
  })

  it('⑤ العميل: بلا ضبط ⇒ رسالة إرشادية عربية ولا استثناء', async () => {
    const missing = await supportBridge({ kv: panelKv } as never, 'inbox')
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('wrangler secret put SUPPORT_BRIDGE_URL')
    expect(BRIDGE_SECRET_MIN).toBe(16)

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    const down = await supportBridge({ supportBridgeUrl: 'https://x.dev', supportBridgeSecret: SECRET } as never, 'inbox')
    expect(down.ok).toBe(false)
    expect(down.error).toContain('network down')
  })
})

describe('② رد المطوّر على تليجرام يصل العميل', () => {
  it('يحلّ الربط tgmap ويدفع الرسالة كمطوّر', async () => {
    await supportKv.put('tgmap:42', 'SHOP-AAA1-1111-1111')
    const res = await bridgePost({ action: 'telegram-reply', messageId: '42', text: 'أهلاً، حلّلنا المشكلة' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deviceId: 'SHOP-AAA1-1111-1111' })
    const messages = await chat('SHOP-AAA1-1111-1111')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ from: 'developer', text: 'أهلاً، حلّلنا المشكلة' })
  })

  it('معرّف رسالة غير معروف ⇒ 404 وبلا كتابة', async () => {
    const res = await bridgePost({ action: 'telegram-reply', messageId: '999', text: 'رد تائه' })
    expect(res.status).toBe(404)
    expect(await supportKv.list({ prefix: 'chat:' })).toMatchObject({ keys: [] })
  })

  it('ربط يشير لمعرّف جهاز تالف ⇒ مرفوض', async () => {
    await supportKv.put('tgmap:7', 'javascript:alert(1)')
    expect((await bridgePost({ action: 'telegram-reply', messageId: '7', text: 'x' })).status).toBe(404)
  })

  it('من البوت: Reply على بلاغ ⇒ تحويل للجسر وتأكيد للمطوّر', async () => {
    wireBridge()
    await supportKv.put('tgmap:42', 'SHOP-AAA1-1111-1111')
    const hook = new Request('https://shopsys-control/telegram/hook-secret', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      body: JSON.stringify({
        update_id: 9,
        message: {
          message_id: 100, text: 'تم إصلاح الخلل، حدّث التطبيق',
          reply_to_message: { message_id: 42 },
          from: { id: 777 }, chat: { id: 777 },
        },
      }),
    })
    await devbotWorker.fetch(hook, panelEnv())
    const messages = await chat('SHOP-AAA1-1111-1111')
    expect(messages[0]).toMatchObject({ from: 'developer', text: 'تم إصلاح الخلل، حدّث التطبيق' })
  })

  it('من البوت: Reply على رسالة ليست بلاغ دعم ⇒ توضيح بلا خطأ', async () => {
    const telegram = wireBridge()
    const hook = new Request('https://shopsys-control/telegram/hook-secret', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      body: JSON.stringify({
        update_id: 10,
        message: {
          message_id: 101, text: 'رد على رسالة عادية',
          reply_to_message: { message_id: 555 },
          from: { id: 777 }, chat: { id: 777 },
        },
      }),
    })
    await devbotWorker.fetch(hook, panelEnv())
    expect(telegram.at(-1)?.text ?? '').toContain('ليست بلاغ دعم معروف')
  })
})

describe('③ الصندوق والمحادثة والرد', () => {
  beforeEach(async () => {
    await supportKv.put('chat:SHOP-AAA1-1111-1111', JSON.stringify([
      { id: 1, from: 'client', text: 'التطبيق لا يفتح', at: '2026-10-08T08:00:00Z' },
    ]))
    await supportKv.put('chat:SHOP-BBB2-2222-2222', JSON.stringify([
      { id: 1, from: 'client', text: 'سؤال عن الفاتورة', at: '2026-10-07T08:00:00Z' },
      { id: 2, from: 'developer', text: 'أجبناك', at: '2026-10-07T09:00:00Z' },
    ]))
  })

  it('inbox: المحادثات المنتظرة رداً أولاً', async () => {
    const res = await bridgePost({ action: 'inbox' })
    const data = await res.json() as { conversations: { deviceId: string; awaitingReply: boolean; lastText: string; messages: number }[] }
    expect(data.ok).toBe(true)
    expect(data.conversations.map((c) => c.deviceId)).toEqual(['SHOP-AAA1-1111-1111', 'SHOP-BBB2-2222-2222'])
    expect(data.conversations[0].awaitingReply).toBe(true)
    expect(data.conversations[1].awaitingReply).toBe(false)
    expect(data.conversations[0].lastText).toBe('التطبيق لا يفتح')
  })

  it('thread: آخر الرسائل بلا تسريب ما بعدها', async () => {
    const res = await bridgePost({ action: 'thread', deviceId: 'SHOP-BBB2-2222-2222' })
    const data = await res.json() as { messages: { from: string; text: string }[] }
    expect(data.messages).toHaveLength(2)
    expect(data.messages[1].from).toBe('developer')
  })

  it('reply: يدفع رسالة مطوّر، ويرفض المعرّف التالف والنص الفارغ', async () => {
    const ok = await bridgePost({ action: 'reply', deviceId: 'SHOP-AAA1-1111-1111', text: 'حلّنا المشكلة' })
    expect(ok.status).toBe(200)
    const messages = await chat('SHOP-AAA1-1111-1111')
    expect(messages.at(-1)).toMatchObject({ from: 'developer', text: 'حلّنا المشكلة' })

    expect((await bridgePost({ action: 'reply', deviceId: 'javascript:alert(1)', text: 'x' })).status).toBe(400)
    expect((await bridgePost({ action: 'reply', deviceId: 'SHOP-AAA1-1111-1111', text: '' })).status).toBe(400)
    expect((await bridgePost({ action: 'مجهول' })).status).toBe(400)
    expect((await bridgePost({ action: 'thread', deviceId: '../etc/passwd' })).status).toBe(400)
  })

  it('الأوامر: /دعم و/دعم <جهاز> و/رد <جهاز> <نص>', async () => {
    const telegram = wireBridge()
    const send = async (text: string, id: number) => {
      telegram.length = 0
      await devbotWorker.fetch(new Request('https://shopsys-control/telegram/hook-secret', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
        body: JSON.stringify({ update_id: id, message: { message_id: id, text, from: { id: 777 }, chat: { id: 777 } } }),
      }), panelEnv())
      return telegram.at(-1)?.text ?? ''
    }

    const inbox = await send('/دعم', 1)
    expect(inbox).toContain('محادثات الدعم')
    expect(inbox).toContain('SHOP-AAA1-1111-1111')
    expect(inbox).toContain('بانتظار ردك')

    const thread = await send('/دعم SHOP-BBB2-2222-2222', 2)
    expect(thread).toContain('سؤال عن الفاتورة')
    expect(thread).toContain('أجبناك')

    const reply = await send('/رد SHOP-AAA1-1111-1111 حدّث التطبيق من القائمة', 3)
    expect(reply).toContain('أُرسل الرد')
    expect((await chat('SHOP-AAA1-1111-1111')).at(-1)?.text).toBe('حدّث التطبيق من القائمة')

    expect(await send('/دعم ../تسلل', 4)).toContain('غير صالح')
    expect(await send('/رد SHOP-AAA1-1111-1111', 5)).toContain('الصيغة')
  })

  it('الجسر معطّل ⇒ الأوامر تُرشد ولا تنهار', async () => {
    const telegram = wireBridge()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/support-bridge')) throw new Error('الجسر unreachable')
      const body = JSON.parse(String(init.body ?? '{}')) as { text?: string }
      if (body?.text) telegram.push({ text: body.text })
      return new Response('{}', { status: 200 })
    }))
    await devbotWorker.fetch(new Request('https://shopsys-control/telegram/hook-secret', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      body: JSON.stringify({ update_id: 20, message: { message_id: 20, text: '/دعم', from: { id: 777 }, chat: { id: 777 } } }),
    }), panelEnv())
    expect(telegram.at(-1)?.text ?? '').toContain('unreachable')
  })
})

describe('③ اللوحة: صندوق الدعم بالأزرار', () => {
  const flat = (reply: unknown) => ((reply as { opts: { reply_markup: { inline_keyboard: { callback_data: string; text: string }[][] } } })
    .opts.reply_markup.inline_keyboard.flat())

  it('لا محادثات ⇒ رسالة واضحة', async () => {
    wireBridge()
    const empty = await handlePanelButton('panel:support', '777', panelCfg()) as { text: string }
    expect(empty.text).toContain('لا محادثات دعم بعد')
  })

  it('قائمة ← محادثة ← رد عبر تدفق اللوحة', async () => {
    wireBridge()
    await supportKv.put('chat:SHOP-AAA1-1111-1111', JSON.stringify([
      { id: 1, from: 'client', text: 'لا أستطيع الطباعة', at: '2026-10-08T08:00:00Z' },
    ]))

    const inbox = await handlePanelButton('panel:support', '777', panelCfg()) as { text: string }
    expect(inbox.text).toContain('بانتظار ردك: 1')
    const buttons = flat(inbox)
    expect(buttons.map((b) => b.callback_data)).toContain('support-thread:SHOP-AAA1-1111-1111')

    const thread = await handlePanelButton('support-thread:SHOP-AAA1-1111-1111', '777', panelCfg()) as { text: string }
    expect(thread.text).toContain('لا أستطيع الطباعة')
    expect(flat(thread).map((b) => b.callback_data)).toContain('support-reply:SHOP-AAA1-1111-1111')

    await handlePanelButton('support-reply:SHOP-AAA1-1111-1111', '777', panelCfg())
    const saved = await handlePanelText('تحقّق من تعريف الطابعة ثم أعد المحاولة', '777', panelCfg()) as { text: string }
    expect(saved.text).toContain('أُرسل الرد')
    expect((await chat('SHOP-AAA1-1111-1111')).at(-1)).toMatchObject({ from: 'developer', text: 'تحقّق من تعريف الطابعة ثم أعد المحاولة' })
  })

  it('فشل الجسر في اللوحة ⇒ إرشاد لا انهيار', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))))
    const reply = await handlePanelButton('panel:support', '777', panelCfg()) as { text: string }
    expect(reply.text).toContain('down')
    expect(flat(reply).map((b) => b.callback_data)).toContain('panel:home')
  })
})
