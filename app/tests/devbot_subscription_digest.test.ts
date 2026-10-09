/**
 * بند 3+4 (تدقيق 2026-10-08) — تنبيهات انتهاء الاشتراك للمطوّر:
 *
 * كانت التذكيرات موجودة في `cloud/worker.js` فقط، وهو **عامل آخر** بمساحة KV أخرى
 * يقرأ `sub:*` بينما مركز التحكم الفعلي (`tools/devbot`) يكتب `dev:*` — والـcron
 * هناك معطّل بالتعليق. النتيجة العملية: لا تذكير يعمل إطلاقاً.
 *
 * يثبت هذا الاختبار أن المركز الفعلي:
 *   ① يصنّف الأجهزة: منتهية · قريبة (0..6 أيام = «أقل من أسبوع») · مدى الحياة · لم تستحق بعد.
 *   ② ينبّه المطوّر يومياً بلا أمر (`scheduled`) عن القريبة وحدها — لا منتهية (تُعدّ في الإحصائيات)
 *      ولا رسالة فارغة.
 *   ③ لا يكرر التذكير في اليوم نفسه (علامة `digest-sent:<اليوم>`).
 *   ④ يوفّر الأمر `/تذكير [أيام]` وزر «⏳ الاشتراكات» في اللوحة.
 *   ⑤ نافذة الأيام قابلة للضبط وتُحترم (1–90، وأي قيمة تالفة ⇒ الافتراضي).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton, handlePanelText } = await import('../../tools/devbot/src/adminPanel.js')
const {
  subscriptionDigest, formatDigestAr, formatStatsAr, hasDigestNews,
  readSoonDays, writeSoonDays, digestMarkerKey, SOON_DAYS, deviceMetadata,
} = await import('../../tools/devbot/src/subscriptions.js')

const DAY = 86_400_000
const NOW = Date.parse('2026-10-08T00:00:00Z')
const dayIso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10)
/* لوحة المطوّر تحسب الأيام المتبقية من الساعة الحقيقية (لا من NOW المثبّت) — فمشهد زر
   «الاشتراكات» يُشتق من الساعة نفسها، وإلا صار الاختبار قنبلة زمنية (نجح في 08 وفشل في 09). */
const realDayIso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)

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
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

const env_ = (kv: MemoryKv) => ({
  SHOPSYS_CONTROL: kv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: 'unused-here',
})

const seed = async (kv: MemoryKv, rows: { id: string; customer: string; plan: string; expiresAt: string | null; email?: string }[]) => {
  for (const r of rows) {
    await kv.put(`dev:${r.id}`, JSON.stringify({ customer: r.customer, plan: r.plan, expiresAt: r.expiresAt, email: r.email ?? '', fingerprint: 'abcdef01' }))
  }
}

/** يلتقط كل ما يُرسل لتليجرام (sendMessage) */
const captureTelegram = () => {
  const calls: { chat_id: string; text: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { chat_id?: string; text?: string }
    if (body?.text) calls.push({ chat_id: String(body.chat_id), text: body.text })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
  }))
  return calls
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('① التصنيف: منتهية · موشكة · مدى الحياة', () => {
  it('يفصل الحالات ويحسب الأيام بدقة ويضع الأخطر أولاً', async () => {
    const kv = new MemoryKv()
    await seed(kv, [
      { id: 'SHOP-AAA1-1111-1111', customer: 'منتهي قديماً', plan: 'basic', expiresAt: dayIso(-30) },
      { id: 'SHOP-AAA2-2222-2222', customer: 'ينتهي اليوم', plan: 'pro', expiresAt: dayIso(0), email: 'a@b.co' },
      { id: 'SHOP-AAA3-3333-3333', customer: 'بعد 5 أيام', plan: 'basic', expiresAt: dayIso(5) },
      { id: 'SHOP-AAA4-4444-4444', customer: 'بعد 11 يوماً', plan: 'pro', expiresAt: dayIso(11) },
      { id: 'SHOP-AAA5-5555-5555', customer: 'دائم', plan: 'lifetime', expiresAt: null },
      { id: 'SHOP-AAA6-6666-6666', customer: 'منتهي أمس', plan: 'basic', expiresAt: dayIso(-1) },
    ])

    const digest = await subscriptionDigest({ kv }, { now: NOW })

    expect(digest.total).toBe(6)
    expect(digest.lifetime).toBe(1)
    expect(digest.expired.map((r) => r.customer)).toEqual(['منتهي قديماً', 'منتهي أمس']) // الأقدم أولاً
    expect(digest.expired[0].days).toBe(-30)
    expect(digest.soon.map((r) => r.customer)).toEqual(['ينتهي اليوم', 'بعد 5 أيام'])
    expect(digest.soon[0].days).toBe(0)
    expect(digest.soon[0].email).toBe('a@b.co') // البريد يظهر للتواصل عند التجديد
    expect(hasDigestNews(digest)).toBe(true)
  })

  it('النافذة الافتراضية 6 أيام («أقل من أسبوع») وقابلة للضبط', async () => {
    expect(SOON_DAYS).toBe(6)
    const kv = new MemoryKv()
    await seed(kv, [
      { id: 'SHOP-BBB1-1111-1111', customer: 'بعد 6 أيام', plan: 'basic', expiresAt: dayIso(6) },
      { id: 'SHOP-BBB2-2222-2222', customer: 'بعد 7 أيام', plan: 'basic', expiresAt: dayIso(7) },
    ])
    /* اليوم السابع خارج النافذة: «أقل من أسبوع» تعني 0..6 لا 7 */
    expect((await subscriptionDigest({ kv }, { now: NOW })).soon.map((r) => r.customer)).toEqual(['بعد 6 أيام'])
    expect((await subscriptionDigest({ kv }, { now: NOW, soonDays: 5 })).soon).toHaveLength(0)
    expect((await subscriptionDigest({ kv }, { now: NOW, soonDays: 30 })).soon).toHaveLength(2)
  })

  it('سجل تالف أو تاريخ غير مقروء ⇒ يُتجاوز بلا انهيار', async () => {
    const kv = new MemoryKv()
    await kv.put('dev:SHOP-CCC1-1111-1111', '{ json فاسد')
    await kv.put('dev:SHOP-CCC2-2222-2222', JSON.stringify({ customer: 'بلا تاريخ', plan: 'basic' }))
    await kv.put('dev:SHOP-CCC3-3333-3333', JSON.stringify({ customer: 'تاريخ غريب', plan: 'basic', expiresAt: 'ليس تاريخاً' }))
    const digest = await subscriptionDigest({ kv }, { now: NOW })
    expect(digest.total).toBe(3)
    expect(digest.malformed).toBe(2)
    expect(digest.lifetime).toBe(1)
    expect(hasDigestNews(digest)).toBe(false)
  })

  it('لا خبر ⇒ رسالة طمأنة بلا قوائم (لا إزعاج فارغ)', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-DDD1-1111-1111', customer: 'بعيد', plan: 'pro', expiresAt: dayIso(200) }])
    const digest = await subscriptionDigest({ kv }, { now: NOW })
    expect(hasDigestNews(digest)).toBe(false)
    const text = formatDigestAr(digest)
    expect(text).toContain('لا اشتراكات تنتهي خلال 6 أيام')
    expect(text).toContain('1 جهاز')
  })

  it('نص التذكير يحمل الاسم والمعرّف والمدة والبريد + صيغة الإحصائيات', async () => {
    const kv = new MemoryKv()
    await seed(kv, [
      { id: 'SHOP-EEE1-1111-1111', customer: 'بقالة النور', plan: 'basic', expiresAt: dayIso(-2), email: 'nour@shop.eg' },
      { id: 'SHOP-EEE2-2222-2222', customer: 'صيدلية الشفاء', plan: 'pro', expiresAt: dayIso(4), email: 'pharmacy@shifa.eg' },
    ])
    const digest = await subscriptionDigest({ kv }, { now: NOW })
    const text = formatDigestAr(digest, { daily: true })
    expect(text).toContain('تذكير الاشتراكات اليومي')
    /* المنتهية لا تدخل التذكير اليومي (تُعدّ في الإحصائيات فقط) */
    expect(text).not.toContain('بقالة النور')
    expect(text).not.toContain('SHOP-EEE1-1111-1111')
    expect(text).not.toContain('انتهى منذ')
    expect(text).toContain('صيدلية الشفاء')
    expect(text).toContain('SHOP-EEE2-2222-2222')
    expect(text).toContain('pharmacy@shifa.eg')
    expect(text).toContain('يتبقى 4 أيام')
    expect(text).toContain('إصدار أو تجديد الرخصة')
    expect(formatStatsAr(digest, { revoked: 3, licenses: 9, notices: 1 })).toContain('مفاتيح محروقة: 3')
  })
})

describe('②③ التذكير اليومي التلقائي (scheduled)', () => {
  it('ينبّه المطوّر بلا أمر عند وجود قريبة من الانتهاء', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-FFF1-1111-1111', customer: 'عميل قريب', plan: 'basic', expiresAt: dayIso(2) }])
    const sent = captureTelegram()

    await devbotWorker.scheduled!({} as never, env_(kv) as never)

    expect(sent).toHaveLength(1)
    expect(sent[0].chat_id).toBe('777')
    expect(sent[0].text).toContain('عميل قريب')
    expect(await kv.get(digestMarkerKey(new Date().toISOString().slice(0, 10)))).toBeTruthy()
  })

  it('المنتهية وحدها لا تُرسل يومياً ولا تُعلَّم اليوم (لا تكرار عن عميل انتهى)', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-FFF2-2222-2222', customer: 'عميل منتهي', plan: 'basic', expiresAt: dayIso(-1) }])
    const sent = captureTelegram()

    await devbotWorker.scheduled!({} as never, env_(kv) as never)

    expect(sent).toHaveLength(0)
    expect(await kv.get(digestMarkerKey(new Date().toISOString().slice(0, 10)))).toBeNull()
  })

  it('لا يرسل شيئاً في يوم بلا قريبة من الانتهاء', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-GGG1-1111-1111', customer: 'بعيد', plan: 'pro', expiresAt: dayIso(300) }])
    const sent = captureTelegram()

    await devbotWorker.scheduled!({} as never, env_(kv) as never)

    expect(sent).toHaveLength(0)
    expect(await kv.get(digestMarkerKey(new Date().toISOString().slice(0, 10)))).toBeNull()
  })

  it('لا يكرر التذكير في اليوم نفسه', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-HHH1-1111-1111', customer: 'موشك', plan: 'basic', expiresAt: dayIso(3) }])
    const sent = captureTelegram()

    await devbotWorker.scheduled!({} as never, env_(kv) as never)
    await devbotWorker.scheduled!({} as never, env_(kv) as never)
    await devbotWorker.scheduled!({} as never, env_(kv) as never)

    expect(sent).toHaveLength(1)
  })

  it('بلا أسرار تليجرام ⇒ لا محاولة إرسال ولا انهيار', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-III1-1111-1111', customer: 'موشك', plan: 'basic', expiresAt: dayIso(3) }])
    const sent = captureTelegram()
    await devbotWorker.scheduled!({} as never, { SHOPSYS_CONTROL: kv } as never)
    expect(sent).toHaveLength(0)
  })
})

describe('④⑤ الأمر واللوحة ونافذة الأيام', () => {
  const adminUpdate = (text: string) => ({
    message: { text, chat: { id: 777 }, from: { id: 777 } },
    update_id: 1,
  })
  const webhook = (kv: MemoryKv, text: string) =>
    devbotWorker.fetch(
      new Request('https://shopsys-control/telegram/hook-secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' },
        body: JSON.stringify(adminUpdate(text)),
      }),
      env_(kv) as never,
    )

  it('الأمر /تذكير يصل المطوّر بالملخص', async () => {
    const kv = new MemoryKv()
    await seed(kv, [
      { id: 'SHOP-JJJ1-1111-1111', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-5) },
      { id: 'SHOP-JJJ2-2222-2222', customer: 'موشك', plan: 'pro', expiresAt: dayIso(6) },
    ])
    const sent = captureTelegram()

    const res = await webhook(kv, '/تذكير')
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('موشك')
    /* المنتهية لا تُعرض في التذكير (تُعدّ في /احصائيات) */
    expect(sent[0].text).not.toContain('SHOP-JJJ1-1111-1111')
  })

  it('الأمر /تذكير 30 يوسّع النافذة لهذه الاستعلام', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-KKK1-1111-1111', customer: 'بعد 20 يوماً', plan: 'basic', expiresAt: dayIso(20) }])
    const narrow = captureTelegram()
    await webhook(kv, '/تذكير')
    expect(narrow[0].text).toContain('لا اشتراكات تنتهي خلال 6 أيام')

    const wide = captureTelegram()
    await webhook(kv, '/تذكير 30')
    expect(wide[0].text).toContain('بعد 20 يوماً')
  })

  it('الأمر /احصائيات يعدّ الأجهزة والمنتهية والمحروق', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-LLL1-1111-1111', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-1) }])
    await kv.put('revoked', JSON.stringify(['aaaaaaaa', 'bbbbbbbb']))
    const sent = captureTelegram()

    await webhook(kv, '/احصائيات')
    expect(sent[0].text).toContain('أجهزة مسجلة: 1')
    expect(sent[0].text).toContain('منتهية: 1')
    expect(sent[0].text).toContain('مفاتيح محروقة: 2')
  })

  it('غير المطوّر لا يستفيد من الأوامر (الحصر بالمعرّف)', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-MMM1-1111-1111', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-1) }])
    const sent = captureTelegram()
    await devbotWorker.fetch(
      new Request('https://shopsys-control/telegram/hook-secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' },
        body: JSON.stringify({ message: { text: '/تذكير', chat: { id: 1 }, from: { id: 1 } }, update_id: 2 }),
      }),
      env_(kv) as never,
    )
    expect(sent).toHaveLength(0)
  })

  it('زر «⏳ الاشتراكات» في اللوحة يعرض الملخص نفسه', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-NNN1-1111-1111', customer: 'موشك', plan: 'basic', expiresAt: realDayIso(2) }])
    const reply = await handlePanelButton('panel:digest', 777, { kv } as never)
    expect(reply?.text).toContain('موشك')
    expect(reply?.text).toContain('يتبقى يومان')
    const stats = await handlePanelButton('panel:stats', 777, { kv } as never)
    expect(stats?.text).toContain('إحصائيات المركز')
  })

  it('ضبط النافذة من اللوحة يسري على التذكير اليومي', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-OOO1-1111-1111', customer: 'بعد 20 يوماً', plan: 'basic', expiresAt: dayIso(20) }])

    // الافتراضي 10 ⇒ لا خبر
    const before = captureTelegram()
    await devbotWorker.scheduled!({} as never, env_(kv) as never)
    expect(before).toHaveLength(0)

    // المطوّر يوسّع النافذة إلى 30 من اللوحة
    await handlePanelButton('panel:digwindow', 777, { kv } as never)
    const saved = await handlePanelText('30', 777, { kv } as never)
    expect(saved?.text).toContain('30 يوماً')
    expect(saved?.text).toContain('بعد 20 يوماً')
    expect(await readSoonDays({ kv } as never)).toBe(30)

    // التذكير اليومي صار يراه
    const after = captureTelegram()
    await devbotWorker.scheduled!({} as never, env_(kv) as never)
    expect(after).toHaveLength(1)
    expect(after[0].text).toContain('بعد 20 يوماً')
  })

  it('قيمة نافذة تالفة أو خارج المدى ⇒ الافتراضي 10', async () => {
    const kv = new MemoryKv()
    expect(await readSoonDays({ kv } as never)).toBe(SOON_DAYS)
    await kv.put('settings:digest', '{ فاسد')
    expect(await readSoonDays({ kv } as never)).toBe(SOON_DAYS)
    expect(await writeSoonDays({ kv } as never, 999)).toBe(SOON_DAYS)
    expect(await writeSoonDays({ kv } as never, 0)).toBe(SOON_DAYS)
    expect(await writeSoonDays({ kv } as never, 45)).toBe(45)
    expect(await readSoonDays({ kv } as never)).toBe(45)
  })
})

describe('⑥ فهرس metadata — لا ينهار التذكير عند حدّ النداءات الفرعية', () => {
  /** خطة Cloudflare المجانية: 50 نداءً فرعياً للطلب. بلا فهرس كان المسح يقرأ كل
   *  سجل بـget ⇒ يفشل cron التذكير بصمت عند نحو 48 جهازاً (والبندان 3 و4 هما
   *  التنبيه بالانتهاء نفسه). */
  const seedIndexed = async (kv: MemoryKv, rows: { id: string; customer: string; plan: string; expiresAt: string | null }[]) => {
    for (const r of rows) {
      const record = { customer: r.customer, plan: r.plan, expiresAt: r.expiresAt, email: '', fingerprint: 'abcdef01' }
      await kv.put(`dev:${r.id}`, JSON.stringify(record), { metadata: deviceMetadata(record) as never })
    }
  }
  const withGetSpy = (kv: MemoryKv) => {
    let gets = 0
    return {
      gets: () => gets,
      kv: {
        get: async (k: string) => { gets++; return kv.get(k) },
        put: (k: string, v: string, o?: never) => kv.put(k, v, o),
        delete: (k: string) => kv.delete(k),
        list: (o?: never) => kv.list(o),
      },
    }
  }

  it('سجلات مفهرسة ⇒ تصنيف صحيح بصفر قراءات get', async () => {
    const kv = new MemoryKv()
    await seedIndexed(kv, [
      { id: 'SHOP-AAA1-1111-1111', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-5) },
      { id: 'SHOP-AAA2-2222-2222', customer: 'موشك', plan: 'pro', expiresAt: dayIso(4) },
      { id: 'SHOP-AAA3-3333-3333', customer: 'دائم', plan: 'lifetime', expiresAt: null },
    ])
    const spy = withGetSpy(kv)
    const digest = await subscriptionDigest({ kv: spy.kv } as never, { now: NOW })
    expect(spy.gets()).toBe(0)
    expect(digest.total).toBe(3)
    expect(digest.viaMetadata).toBe(3)
    expect(digest.skipped).toBe(0)
    expect(digest.expired.map((r) => r.customer)).toEqual(['منتهي'])
    expect(digest.soon.map((r) => r.customer)).toEqual(['موشك'])
    expect(digest.lifetime).toBe(1)
  })

  it('سجلات قديمة بلا فهرس ⇒ تُقرأ وتُفهرس في مكانها، فالدورة التالية صفر قراءات', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-AAA1-1111-1111', customer: 'قديم', plan: 'basic', expiresAt: dayIso(2) }])
    const first = withGetSpy(kv)
    const d1 = await subscriptionDigest({ kv: first.kv } as never, { now: NOW })
    expect(first.gets()).toBe(1)
    expect(d1.viaMetadata).toBe(0)
    expect(d1.soon.map((r) => r.customer)).toEqual(['قديم'])

    const second = withGetSpy(kv)
    const d2 = await subscriptionDigest({ kv: second.kv } as never, { now: NOW })
    expect(second.gets()).toBe(0) // فُهرس أثناء الدورة الأولى
    expect(d2.viaMetadata).toBe(1)
    expect(d2.soon.map((r) => r.customer)).toEqual(['قديم'])
  })

  it('تجاوز حدّ القراءات ⇒ skipped صريح في الملخّص، لا فشل صامت ولا «كل شيء سليم»', async () => {
    const kv = new MemoryKv()
    await seed(kv, Array.from({ length: 5 }, (_, i) => ({
      id: `SHOP-AAA${i + 1}-1111-1111`, customer: `جهاز ${i + 1}`, plan: 'basic', expiresAt: dayIso(3),
    })))
    const digest = await subscriptionDigest({ kv } as never, { now: NOW, maxReads: 2 })
    expect(digest.total).toBe(5)
    expect(digest.skipped).toBe(3)
    expect(formatDigestAr(digest)).toContain('لم يُفحص 3')
    expect(formatStatsAr(digest)).toContain('لم يُفحص 3')

    /* ولا حتى في يوم «لا جديد»: الخبر الناقص يُقال صراحة */
    const quiet = await subscriptionDigest({ kv: new MemoryKv() } as never, { now: NOW, maxReads: 0 })
    expect(hasDigestNews(quiet)).toBe(false)
    const kv2 = new MemoryKv()
    await seed(kv2, [{ id: 'SHOP-AAA1-1111-1111', customer: 'بعيد', plan: 'basic', expiresAt: dayIso(300) }])
    const noNews = await subscriptionDigest({ kv: kv2 } as never, { now: NOW, maxReads: 0 })
    expect(hasDigestNews(noNews)).toBe(false)
    expect(noNews.skipped).toBe(1)
    expect(formatDigestAr(noNews)).toContain('لم يُفحص 1')
  })

  it('فشل cron ⇒ يبلغ المطوّر بدل الصمت', async () => {
    const kv = new MemoryKv()
    await seed(kv, [{ id: 'SHOP-AAA1-1111-1111', customer: 'منتهي', plan: 'basic', expiresAt: dayIso(-2) }])
    const calls = captureTelegram()
    const broken = {
      ...env_(kv),
      SHOPSYS_CONTROL: {
        get: (k: string) => kv.get(k),
        put: (k: string, v: string, o?: never) => kv.put(k, v, o),
        delete: (k: string) => kv.delete(k),
        list: async () => { throw new Error('kv unavailable') },
      },
    }
    await devbotWorker.scheduled!({} as never, broken as never)
    expect(calls.some((c) => c.text.includes('فشل تذكير الاشتراكات اليومي'))).toBe(true)
  })
})
