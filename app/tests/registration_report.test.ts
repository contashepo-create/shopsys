/**
 * بند 2 (تدقيق 2026-10-08) — إبلاغ المطوّر بكل تسجيل جديد.
 *
 * ما كان: معالج أول التشغيل يجمع (الاسم، الهاتف، البريد، اسم المنشأة، النشاط،
 * المدينة، الشارع) ثم **لا يصل المطوّر شيء** — لا طلب POST في الكود كله، ولا سجل
 * على الخادم، ولا إشعار. المطوّر لا يعرف بالعميل الجديد إلا إن راسله العميل.
 *
 * يثبت هذا الاختبار:
 *   ① البلاغ يُبنى من بيانات المعالج ويُعقَّم، ويرفض ما بلا معرف جهاز صالح.
 *   ② يصل العامل عبر POST /register فيُسجَّل في `reg:<deviceId>` ويُبلَّغ المطوّر.
 *   ③ مرة واحدة لكل جهاز — البلاغ الثاني تحديث صامت **بلا** رسالة تليجرام ثانية.
 *   ④ لا يعطّل العميل: أوفلاين ⇒ 'failed' ولا تُحفظ العلامة ⇒ محاولة في الإقلاع
 *      التالي (بند 6: لا إجبار على الإنترنت).
 *   ⑤ تحصين النقطة العامة: 400 لمعرّف تالف، 413 لحجم زائد، 405 لغير POST،
 *      ولا تسريب لأي بيانات في الرد.
 *   ⑥ المطوّر يستعرض التسجيلات من اللوحة ومن الأمر /تسجيلات.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton } = await import('../../tools/devbot/src/adminPanel.js')
const {
  buildRegistrationReport, shouldReportRegistration, sendRegistrationReport,
  formatRegistrationAr, REGISTRATION_MAX_BYTES,
} = await import('../src/core/registration.ts')
const {
  sanitizeRegistration, saveRegistration, listRegistrations, formatRegistrationsAr, deleteRegistration, regKey,
  REG_TG_DAILY_CAP, regAlertKey,
  formatRegistrationAr: formatRegistrationArServer,
} = await import('../../tools/devbot/src/registrations.js')

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

/** يلتقط رسائل التليجرام ويسمح بنجاح الطلبات */
const captureTelegram = () => {
  const calls: { chat_id: string; text: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { chat_id?: string; text?: string }
    if (body?.text) calls.push({ chat_id: String(body.chat_id), text: body.text })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
  }))
  return calls
}

const CUSTOMER = {
  deviceId: 'SHOP-AAA1-1111-1111',
  appVersion: '1.0.19',
  platform: 'desktop',
  shopName: 'بقالة النور',
  ownerName: 'أحمد محمد',
  phone: '+20 100 123 4567',
  email: 'ahmed@example.com',
  city: 'المنزلة',
  street: 'شارع البحر',
  countryCode: 'EG',
  activityId: 'grocery',
  activityNameAr: 'بقالة وسوبر ماركت',
  accountingMode: 'simple',
  plan: 'trial',
}

const postRegister = async (kv: MemoryKv, body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) => {
  const request = new Request('https://shopsys-control/register', {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return await devbotWorker.fetch(request, env_(kv)) as Response
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('① بناء البلاغ وتعقيمه', () => {
  it('يجمع كل بيانات المعالج كما هي', () => {
    const report = buildRegistrationReport(CUSTOMER)!
    expect(report).toMatchObject({
      deviceId: 'SHOP-AAA1-1111-1111',
      shopName: 'بقالة النور',
      ownerName: 'أحمد محمد',
      phone: '+20 100 123 4567',
      email: 'ahmed@example.com',
      city: 'المنزلة',
      street: 'شارع البحر',
      countryCode: 'EG',
      activityId: 'grocery',
      activityNameAr: 'بقالة وسوبر ماركت',
      plan: 'trial',
    })
    expect(report.registeredAt).toBeTruthy()
    expect(report.doctorSpecialty).toBeUndefined() // لا يُضاف إلا لنشاط طبي
  })

  it('يرفض ما بلا معرف جهاز صالح ⇒ لا بلاغ مجهول الهوية', () => {
    for (const bad of ['', 'abc', 'SHOP-AAA1-1111', 'javascript:alert(1)', 'SHOP-AAAA-BBBB-CCCC-DDDD']) {
      expect(buildRegistrationReport({ ...CUSTOMER, deviceId: bad })).toBeNull()
    }
  })

  it('يعقّم الوسوم ومحارف التحكم ويقصّ الأطوال', () => {
    const report = buildRegistrationReport({
      ...CUSTOMER,
      shopName: `<b>محل</b>\u0000${'ط'.repeat(400)}`,
      email: 'javascript:alert(1)',
      phone: 'اتصل بي',
      platform: 'weird',
      accountingMode: 'weird',
    })!
    expect(report.shopName).not.toContain('<')
    expect(report.shopName.length).toBeLessThanOrEqual(120)
    expect(report.email).toBe('') // بريد تالف ⇒ يُحذف لا يُمرَّر
    expect(report.phone).toBe('')
    expect(report.platform).toBe('desktop') // أي قيمة غير web ⇒ desktop
    expect(report.accountingMode).toBe('simple')
  })

  it('التخصص الطبي يُرسل فقط عند وجوده', () => {
    expect(buildRegistrationReport({ ...CUSTOMER, doctorSpecialty: 'أسنان' })!.doctorSpecialty).toBe('أسنان')
    expect(buildRegistrationReport({ ...CUSTOMER, doctorSpecialty: '  ' })!.doctorSpecialty).toBeUndefined()
  })

  it('④ لا يُرسل إلا بعد اكتمال الإعداد ومرة واحدة لكل جهاز', () => {
    const base = { deviceId: CUSTOMER.deviceId, reportedAt: null, consentAt: '2026-10-08T09:00:00Z' }
    expect(shouldReportRegistration({ ...base, setupCompleted: false })).toBe(false)
    expect(shouldReportRegistration({ ...base, setupCompleted: true })).toBe(true)
    expect(shouldReportRegistration({ ...base, setupCompleted: true, reportedAt: '2026-10-08T09:00:00Z' })).toBe(false)
    expect(shouldReportRegistration({ ...base, setupCompleted: true, deviceId: 'تالف' })).toBe(false)
  })

  /* سياسة الخصوصية المنشورة تقول إن البيانات محلية ولا تُرفع ⇒ إرسال بيانات
     المنشأة والتواصل بلا موافقة صريحة مخالفة لوثيقتنا نفسها. */
  it('بلا موافقة صريحة ⇒ لا إرسال إطلاقاً (شرط قانوني لا تحسين)', () => {
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: CUSTOMER.deviceId, reportedAt: null, consentAt: null })).toBe(false)
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: CUSTOMER.deviceId, reportedAt: null, consentAt: '' })).toBe(false)
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: CUSTOMER.deviceId, reportedAt: null, consentAt: '2026-10-08T09:00:00Z' })).toBe(true)
  })

  it('الإفصاح مكتوب في سياسة الخصوصية المعروضة على العميل', async () => {
    const { PRIVACY, LEGAL_VERSION } = await import('../src/core/legal.ts')
    const text = JSON.stringify(PRIVACY)
    expect(text).toContain('بلاغ التسجيل')
    expect(text).toContain('موافقة صريحة')
    expect(text).toContain('reg:') // مكان الحفظ معلن
    expect(text).toMatch(/لا أصناف ولا فواتير|ما لا يُرسل أبداً/)
    expect(LEGAL_VERSION).toBe('2026-10-08') // تغيير جوهري ⇒ تُطلب الموافقة مجدداً
  })
})

describe('②③ العامل: تسجيل + تبليغ مرة واحدة لكل جهاز', () => {
  let kv: MemoryKv
  beforeEach(() => { kv = new MemoryKv() })

  it('أول بلاغ ⇒ حفظ في KV + رسالة تليجرام بكل البيانات', async () => {
    const sent = captureTelegram()
    const res = await postRegister(kv, CUSTOMER)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, isNew: true })

    const stored = JSON.parse((await kv.get(regKey(CUSTOMER.deviceId)))!) as Record<string, unknown>
    expect(stored.shopName).toBe('بقالة النور')
    expect(stored.ownerName).toBe('أحمد محمد')
    expect(stored.phone).toBe('+20 100 123 4567')
    expect(stored.email).toBe('ahmed@example.com')
    expect(stored.reports).toBe(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].chat_id).toBe('777')
    expect(sent[0].text).toContain('تسجيل عميل جديد')
    expect(sent[0].text).toContain('بقالة النور')
    expect(sent[0].text).toContain('ahmed@example.com')
    expect(sent[0].text).toContain('SHOP-AAA1-1111-1111')
  })

  it('③ البلاغ الثاني للجهاز نفسه ⇒ تحديث صامت بلا رسالة أخرى', async () => {
    const sent = captureTelegram()
    await postRegister(kv, CUSTOMER)
    const second = await postRegister(kv, { ...CUSTOMER, shopName: 'اسم محدّث' })
    expect(await second.json()).toEqual({ ok: true, isNew: false })
    expect(sent).toHaveLength(1) // لا إزعاج متكرر
    const stored = JSON.parse((await kv.get(regKey(CUSTOMER.deviceId)))!) as Record<string, unknown>
    expect(stored.shopName).toBe('اسم محدّث')
    expect(stored.reports).toBe(2)
    expect(stored.firstSeenAt).toBeTruthy()
  })

  it('⑤ تحصين النقطة: معرّف تالف 400 · حجم زائد 413 · غير POST 405 · JSON تالف 400', async () => {
    captureTelegram()
    expect((await postRegister(kv, { ...CUSTOMER, deviceId: 'abc' })).status).toBe(400)
    expect((await postRegister(kv, { ...CUSTOMER, deviceId: 'javascript:alert(1)' })).status).toBe(400)
    expect((await postRegister(kv, 'not json')).status).toBe(400)
    /* GET بلا جسم — Request يرفض جسماً مع GET/HEAD */
    const get = await devbotWorker.fetch(new Request('https://shopsys-control/register'), env_(kv)) as Response
    expect(get.status).toBe(405)

    const huge = { ...CUSTOMER, shopName: 'ض'.repeat(REGISTRATION_MAX_BYTES * 2) }
    const big = await postRegister(kv, huge)
    expect([400, 413]).toContain(big.status) // يرفضه الحجم أو التعقيم — كلاهما آمن
    expect(await kv.get(regKey(CUSTOMER.deviceId))).toBeNull()
  })

  it('⑤ الرد لا يكشف بيانات ولا رسائل خطأ داخلية', async () => {
    captureTelegram()
    const res = await postRegister(kv, { deviceId: 'تالف' })
    const text = await res.text()
    expect(text).not.toContain('stack')
    expect(text.length).toBeLessThan(200)
  })

  it('بلا أسرار تليجرام ⇒ يُحفظ البلاغ ولا ينهار العامل', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))))
    const res = await postRegister(kv, CUSTOMER)
    expect(res.status).toBe(200)
    expect(await kv.get(regKey(CUSTOMER.deviceId))).toBeTruthy()
  })

  it('التعقيم الخادمي مستقل عن تعقيم العميل (دفاع مزدوج)', () => {
    expect(sanitizeRegistration(null)).toBeNull()
    expect(sanitizeRegistration([])).toBeNull()
    expect(sanitizeRegistration({ deviceId: 'SHOP-AAA1-1111-1111', email: 'ليس بريداً', phone: 'كلام', shopName: '<b>محل</b>' }))
      .toMatchObject({ email: '', phone: '', shopName: 'bمحل/b' })
  })

  it('saveRegistration يحسب firstSeenAt/reports', async () => {
    const report = sanitizeRegistration(CUSTOMER)!
    const first = await saveRegistration({ kv }, report)
    expect(first.isNew).toBe(true)
    expect(first.record.reports).toBe(1)
    const second = await saveRegistration({ kv }, report)
    expect(second.isNew).toBe(false)
    expect(second.record.reports).toBe(2)
    expect(second.record.firstSeenAt).toBe(first.record.firstSeenAt)
  })
})

describe('④ العميل: أوفلاين ⇒ فشل صامت وإعادة محاولة', () => {
  it('sendRegistrationReport يعيد sent/duplicate/failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNew: true }), { status: 200 })))
    expect(await sendRegistrationReport('https://x.dev/', buildRegistrationReport(CUSTOMER)!)).toBe('sent')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNew: false }), { status: 200 })))
    expect(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)!)).toBe('duplicate')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)!)).toBe('failed')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('خطأ', { status: 500 })))
    expect(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)!)).toBe('failed')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('ليس JSON', { status: 200 })))
    expect(await sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)!)).toBe('duplicate')
  })

  it('لا يرمي استثناء أبداً (لا يعطّل إقلاع العميل)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('sync throw') }))
    await expect(sendRegistrationReport('https://x.dev', buildRegistrationReport(CUSTOMER)!)).resolves.toBe('failed')
  })
})

describe('⑥ الاستعراض من اللوحة والأمر', () => {
  let kv: MemoryKv
  beforeEach(() => { kv = new MemoryKv() })

  it('listRegistrations يرتّب بالأحدث ويعيد السجلات الصالحة فقط', async () => {
    /* أوقات مختلفة صراحةً — الحفظان المتتاليان قد يقعان في الملّي ثانية نفسها */
    await kv.put(regKey('SHOP-AAA1-1111-1111'), JSON.stringify({ ...CUSTOMER, lastSeenAt: '2026-10-01T00:00:00Z' }))
    await kv.put(regKey('SHOP-BBB2-2222-2222'), JSON.stringify({ ...CUSTOMER, deviceId: 'SHOP-BBB2-2222-2222', shopName: 'الأحدث', lastSeenAt: '2026-10-08T00:00:00Z' }))
    await kv.put('reg:SHOP-TAMPERED-X', 'json تالف')
    const { records, skipped } = await listRegistrations({ kv })
    expect(records).toHaveLength(2) // السجل التالف يُتجاوز ولا يُسقط القائمة
    expect(records[0].shopName).toBe('الأحدث')
    expect(skipped).toBe(0)
  })

  it('القائمة تُبنى من فهرس metadata بلا قراءة كل سجل (حدّ النداءات الفرعية)', async () => {
    /* الخطة المجانية تحدّ النداءات بـ50 للطلب: لو احتاج كل سجل get لانهار
       الأمر/اللوحة عند نحو 48 عميلاً. saveRegistration يكتب الفهرس، فيكفي list. */
    await saveRegistration({ kv } as never, sanitizeRegistration(CUSTOMER)!)
    await saveRegistration({ kv } as never, sanitizeRegistration({ ...CUSTOMER, deviceId: 'SHOP-BBB2-2222-2222', shopName: 'الثاني' })!)
    let gets = 0
    const spyKv = {
      get: async (k: string) => { gets++; return kv.get(k) },
      put: (k: string, v: string, o?: unknown) => kv.put(k, v, o as never),
      delete: (k: string) => kv.delete(k),
      list: (o?: never) => kv.list(o),
    }
    const { records, skipped } = await listRegistrations({ kv: spyKv } as never)
    expect(records).toHaveLength(2)
    expect(gets).toBe(0) // صفر قراءات — الفهرس يكفي
    expect(skipped).toBe(0)
    expect(formatRegistrationsAr(records as never)).toContain('بقالة النور')
  })

  it('deleteRegistration يحذف سجل العميل (حق الحذف في سياسة الخصوصية)', async () => {
    await saveRegistration({ kv } as never, sanitizeRegistration(CUSTOMER)!)
    expect(await kv.get(regKey(CUSTOMER.deviceId))).toBeTruthy()
    const bad = await deleteRegistration({ kv } as never, 'ليس-معرفاً')
    expect(bad.ok).toBe(false)
    expect(await kv.get(regKey(CUSTOMER.deviceId))).toBeTruthy() // رفض ⇒ لا حذف
    const gone = await deleteRegistration({ kv } as never, CUSTOMER.deviceId)
    expect(gone).toMatchObject({ ok: true, existed: true, deviceId: CUSTOMER.deviceId })
    expect(await kv.get(regKey(CUSTOMER.deviceId))).toBeNull()
    const again = await deleteRegistration({ kv } as never, CUSTOMER.deviceId)
    expect(again).toMatchObject({ ok: true, existed: false })
  })

  it('formatRegistrationsAr يعرض الاسم والهاتف والبريد والجهاز', () => {
    const text = formatRegistrationsAr([sanitizeRegistration(CUSTOMER) as never])
    expect(text).toContain('بقالة النور')
    expect(text).toContain('أحمد محمد')
    expect(text).toContain('+20 100 123 4567')
    expect(text).toContain('ahmed@example.com')
    expect(text).toContain('SHOP-AAA1-1111-1111')
    expect(formatRegistrationsAr([])).toContain('لا تسجيلات')
  })

  it('formatRegistrationAr يذكر الإصدار، وصياغة العامل تضيف الخطوة التالية', () => {
    const text = formatRegistrationAr(buildRegistrationReport(CUSTOMER)!)
    expect(text).toContain('تسجيل عميل جديد')
    expect(text).toContain('1.0.19')
    // الصياغة التي تصل التليجرام فعلياً (من العامل) تحمل تلميح الإصدار
    const server = formatRegistrationArServer(sanitizeRegistration(CUSTOMER)!)
    expect(server).toContain('/اصدر')
    expect(server).toContain('بقالة النور')
  })

  it('زر «🆕 التسجيلات» في اللوحة + أمر /تسجيلات', async () => {
    captureTelegram()
    await postRegister(kv, CUSTOMER)
    const panel = await handlePanelButton('panel:regs', '777', { kv } as never) as { text: string }
    expect(panel.text).toContain('بقالة النور')

    const hook = () => new Request('https://shopsys-control/telegram/hook-secret', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      body: JSON.stringify({
        update_id: 2,
        message: { message_id: 2, text: '/تسجيلات', from: { id: 777 }, chat: { id: 777 } },
      }),
    })
    const sent = captureTelegram()
    await devbotWorker.fetch(hook(), env_(kv))
    expect(sent.at(-1)?.text ?? '').toContain('بقالة النور')
    expect(sent.at(-1)?.text ?? '').toContain('آخر التسجيلات')
  })
})

describe('⑧ نقطة عامة: سقف التنبيهات وتهريب HTML', () => {
  let kv: MemoryKv
  beforeEach(() => { kv = new MemoryKv() })

  /* أربع مجموعات من 4 محارف [A-Z0-9] تماماً — وإلا رفض العامل البلاغ 400 */
  const deviceIdAt = (i: number) => `SHOP-A${i.toString(36).padStart(3, '0').toUpperCase()}-1111-1111`

  it('التخزين يستمر بعد السقف، والتنبيه وحده يُسقف + تحذير واحد', async () => {
    const calls = captureTelegram()
    const total = REG_TG_DAILY_CAP + 2
    for (let i = 0; i < total; i++) {
      const res = await postRegister(kv, { ...CUSTOMER, deviceId: deviceIdAt(i), shopName: `محل ${i}` })
      expect(res.status).toBe(200) // البلاغ مقبول دائماً — السقف على التنبيه فقط
    }
    const { records } = await listRegistrations({ kv } as never)
    expect(records.length).toBe(total) // كل التسجيلات محفوظة
    const customerAlerts = calls.filter((c) => c.text.includes('تسجيل عميل جديد'))
    expect(customerAlerts).toHaveLength(REG_TG_DAILY_CAP)
    const capWarnings = calls.filter((c) => c.text.includes('سقف تنبيهات التسجيل اليومي'))
    expect(capWarnings).toHaveLength(1) // لا تحذير في كل نداء مرفوض
    expect(await kv.get(regAlertKey(new Date().toISOString().slice(0, 10)))).toBe(String(REG_TG_DAILY_CAP))
  })

  it('اسم فيه & يصل مُهرَّباً — لا تفشل رسالة البلاغ بصمت', async () => {
    /* المركز يرسل بـparse_mode=HTML: `&` غير مُهرَّبة ⇒ تليجرام يرفض الرسالة
       كلها («Can't parse entities») والاستثناء مبتلع ⇒ لا يصلك العميل أصلاً. */
    const calls = captureTelegram()
    const res = await postRegister(kv, { ...CUSTOMER, shopName: 'سوبر ماركت A&B', ownerName: 'أحمد &#x27; علي' })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toContain('A&amp;B')
    expect(calls[0].text).toContain('&amp;#x27;')
    expect(calls[0].text).not.toContain('A&B')
  })
})
