/**
 * مراجعة المرحلة ③ — المسار الكامل لعميل جديد، من شاشته إلى المطوّر:
 *
 *   buildRegistrationReport (التطبيق)
 *     → sendRegistrationReport (fetch)
 *       → worker.fetch «/register» (مركز التحكم)
 *         → KV reg:<الجهاز> + metadata
 *           → رسالة التليجرام + زر «إصدار مفتاح»
 *             → اللوحة: القائمة، البطاقة الكاملة، الإصدار، العملاء، الحذف
 *               → المفتاح الصادر يتحقق منه **التطبيق نفسه** (verifyLicenseKey).
 *
 * كل نداء شبكة يُوجَّه داخلياً إلى العامل الحقيقي، فلا شبكة ولا أسرار نشر.
 * هذا الاختبار هو ما كان ينقص: كل حلقة كان لها اختبار منفرد، لكن لا شيء يثبت
 * أن البيانات التي يدخلها العميل تصل المطوّر كاملةً وتُصدر لها رخصة صالحة.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton } = await import('../../tools/devbot/src/adminPanel.js')
const { sanitizeRegistration, normalizePhone: normalizePhoneServer } = await import('../../tools/devbot/src/registrations.js')
const { buildRegistrationReport, sendRegistrationReport, normalizePhone } = await import('../src/core/registration.ts')
const { verifyLicenseKey, b64uEncode } = await import('../src/core/license.ts')

/* زوج مفاتيح مؤقت — يطابق الإعداد الحقيقي: الخاص عند المركز، والعام في التطبيق */
const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const PRIV_B64U = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))).toString('base64url')
const pubSpki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey))
const PUB_B64U = b64uEncode(pubSpki.slice(pubSpki.length - 32))

const CONTROL = 'https://control.example'
const DEVICE = 'SHOP-A1B2-C3D4-E5F6'

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
  metaOf(key: string) { return this.metas.get(key) }
}

type Button = { text: string; callback_data?: string }
type SentMessage = { chat_id: string; text: string; parse_mode?: string; reply_markup?: { inline_keyboard: Button[][] } }

let kv: MemoryKv
let telegram: Array<{ method: string; body: Record<string, unknown> }>

const env = () => ({
  SHOPSYS_CONTROL: kv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: PRIV_B64U,
})

/** توجيه كل الشبكة: مركز التحكم ⇒ العامل الحقيقي، تليجرام ⇒ تسجيل */
function installNetwork() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith(CONTROL)) {
      /* الإشارة (AbortSignal) من بيئة jsdom لا يقبلها Request الخاص بـundici — والمهلة
         ليست موضوع هذا الاختبار، فتُحذف من الطلب الداخلي فقط */
      const { signal: _signal, ...rest } = init ?? {}
      return devbotWorker.fetch(new Request(u, rest as RequestInit), env() as never)
    }
    if (u.startsWith('https://api.telegram.org/')) {
      const method = u.split('/').pop() ?? ''
      telegram.push({ method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.length } }), { status: 200 })
    }
    throw new Error(`اتصال غير متوقع: ${u}`)
  }))
}

const sentMessages = (): SentMessage[] => telegram
  .filter((c) => c.method === 'sendMessage')
  .map((c) => c.body as unknown as SentMessage)
const buttonsOf = (keyboard?: { inline_keyboard: Button[][] }) => (keyboard?.inline_keyboard ?? []).flat()

/** نداء زر من المطوّر عبر الـwebhook الحقيقي */
const pressAsAdmin = (data: string, fromId = 777) => devbotWorker.fetch(
  new Request(`${CONTROL}/telegram/hook-secret`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' },
    body: JSON.stringify({
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: { id: `cb-${data}`, from: { id: fromId }, data, message: { message_id: 1, chat: { id: 777 }, from: { id: 777 } } },
    }),
  }),
  env() as never,
)

/** سياق قراءة اللوحة (المطوّر) — كما يمرّره الـwebhook */
const panelCfg = () => ({ kv, priv: PRIV_B64U, token: 'bot-token', adminId: '777' }) as never

/** بيانات عميل كما تُدخلها شاشة المعالج — بأرقام هندية في الهاتف وعلامة & في الاسم */
const CUSTOMER = {
  deviceId: DEVICE,
  appVersion: '1.0.22',
  platform: 'desktop',
  shopName: 'صيدلية النور & الشفاء',
  ownerName: 'أحمد محمد',
  phone: '٠١٠ ١٢٣٤ ٥٦٧٨',
  email: 'ahmed@noor-pharmacy.eg',
  city: 'المنصورة',
  street: 'شارع الجلاء',
  countryCode: 'eg',
  activityId: 'pharmacy',
  activityNameAr: 'صيدلية',
  accountingMode: 'full',
  plan: 'trial',
  doctorSpecialty: 'صيدلة إكلينيكية',
  registeredAt: '2026-10-09T10:00:00.000Z',
}

beforeEach(() => {
  kv = new MemoryKv()
  telegram = []
  installNetwork()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('① البلاغ يصل المطوّر كاملاً ويُحفظ', () => {
  it('أرقام الهاتف الهندية تُحوَّل لاتينية في البلاغ، والبريد والمنشأة كما كُتبا', () => {
    const report = buildRegistrationReport(CUSTOMER)!
    expect(report.phone).toBe('010 1234 5678')
    expect(report.email).toBe('ahmed@noor-pharmacy.eg')
    expect(report.shopName).toBe('صيدلية النور & الشفاء') // التهريب يتم عند التليجرام لا هنا
  })

  it('إرسال البلاغ ⇒ «sent»، ثم سجل KV يحمل كل الحقول مع metadata للقائمة', async () => {
    expect(await sendRegistrationReport(CONTROL, buildRegistrationReport(CUSTOMER)!)).toBe('sent')

    const stored = JSON.parse((await kv.get(`reg:${DEVICE}`)) ?? 'null')
    expect(stored).toMatchObject({
      deviceId: DEVICE, appVersion: '1.0.22', platform: 'desktop',
      shopName: 'صيدلية النور & الشفاء', ownerName: 'أحمد محمد', phone: '010 1234 5678',
      email: 'ahmed@noor-pharmacy.eg', city: 'المنصورة', street: 'شارع الجلاء', countryCode: 'EG',
      activityId: 'pharmacy', activityNameAr: 'صيدلية', accountingMode: 'full', plan: 'trial',
      doctorSpecialty: 'صيدلة إكلينيكية', registeredAt: '2026-10-09T10:00:00.000Z', reports: 1,
    })
    expect(kv.metaOf(`reg:${DEVICE}`)).toMatchObject({ v: 1, deviceId: DEVICE, shopName: 'صيدلية النور & الشفاء', phone: '010 1234 5678' })
  })

  it('تنبيه التليجرام يحمل كل بيانات العميل مهرّبة، وزر الإصدار (لا تعليمة /اصدر)', async () => {
    await sendRegistrationReport(CONTROL, buildRegistrationReport(CUSTOMER)!)

    const alerts = sentMessages()
    expect(alerts).toHaveLength(1)
    const alert = alerts[0]
    expect(alert.chat_id).toBe('777')
    expect(alert.parse_mode).toBe('HTML')
    for (const value of [
      'صيدلية النور &amp; الشفاء', 'أحمد محمد', '010 1234 5678', 'ahmed@noor-pharmacy.eg',
      'المنصورة', 'شارع الجلاء', 'صيدلية', 'صيدلة إكلينيكية', DEVICE, '1.0.22', 'تطبيق سطح المكتب',
    ]) {
      expect(alert.text, value).toContain(value)
    }
    expect(alert.text).not.toContain('/اصدر')
    expect(buttonsOf(alert.reply_markup).map((b) => b.callback_data)).toEqual([
      `panel:issuereg:${DEVICE}`, `panel:reg:${DEVICE}`,
    ])
  })

  it('إعادة البلاغ من الجهاز نفسه ⇒ «duplicate»، بلا تنبيه ثانٍ، والعدّاد يزيد', async () => {
    await sendRegistrationReport(CONTROL, buildRegistrationReport(CUSTOMER)!)
    expect(await sendRegistrationReport(CONTROL, buildRegistrationReport(CUSTOMER)!)).toBe('duplicate')
    expect(sentMessages()).toHaveLength(1)
    expect(JSON.parse((await kv.get(`reg:${DEVICE}`)) ?? '{}').reports).toBe(2)
  })

  it('تطابق الهاتف والبريد بين التطبيق والخادم: كل قيمة يقبلها أحدهما يقبلها الآخر', () => {
    const phones = [
      '+20 100 123 4567', '٠١٠ ١٢٣٤ ٥٦٧٨', '(010) 1234-5678', '010.1234.5678', '0101234567',
      '۰۱۰۱۲۳۴۵۶۷۸', 'اتصل بي', '012', '1234567890123456', '+', '0101-2345678 ext', '',
    ]
    for (const phone of phones) {
      expect(normalizePhoneServer(phone), phone).toBe(normalizePhone(phone))
    }
    expect(normalizePhone('(010) 1234-5678')).toBe('(010) 1234-5678')
    expect(normalizePhone('اتصل بي')).toBe('')
    for (const email of ['a@b.c', 'ahmed@noor.eg', 'x@y', 'ليس بريداً', 'a@b@c.de']) {
      const app = buildRegistrationReport({ ...CUSTOMER, email })!.email
      const server = sanitizeRegistration({ ...CUSTOMER, email })!.email
      expect(server, email).toBe(app)
    }
  })

  it('الرقم الذي يقبله المعالج يصل المطوّر دائماً (لا سقوط صامت للهاتف)', () => {
    for (const phone of ['(010) 1234-5678', '٠١٠ ١٢٣٤ ٥٦٧٨', '+20 10 1234 5678', '01012345678']) {
      expect(normalizePhone(phone), phone).not.toBe('')
      expect(sanitizeRegistration({ ...CUSTOMER, phone })!.phone, phone).toBe(normalizePhone(phone))
    }
  })
})

describe('② اللوحة: القائمة والبطاقة الكاملة والإصدار والحذف', () => {
  beforeEach(async () => {
    await sendRegistrationReport(CONTROL, buildRegistrationReport(CUSTOMER)!)
    telegram = []
  })

  it('«🆕 التسجيلات»: البيانات في نص الرسالة، والأزرار تفتح البطاقة، وبلا رخصة تُعلَّم 🆕', async () => {
    const res = await handlePanelButton('panel:regs', '777', panelCfg()) as { text: string; opts: { reply_markup: { inline_keyboard: Button[][] } } }
    expect(res.text).toContain('صيدلية النور &amp; الشفاء')
    expect(res.text).toContain('010 1234 5678')
    expect(res.text).toContain('ahmed@noor-pharmacy.eg')
    expect(res.text).toContain('بلا رخصة: 1')
    expect(buttonsOf(res.opts.reply_markup).map((b) => b.callback_data)).toContain(`panel:reg:${DEVICE}`)
  })

  it('«🆕 مسجّلون بلا رخصة» يعرض الجهاز قبل أن يُرخَّص', async () => {
    const res = await handlePanelButton('panel:regsnew', '777', panelCfg()) as { text: string; opts: { reply_markup: { inline_keyboard: Button[][] } } }
    expect(res.text).toContain('مسجّلون بلا رخصة (1)')
    expect(res.text).toContain(DEVICE)
  })

  it('البطاقة الكاملة تعرض كل حقل احتفظ به البلاغ مع حالة الترخيص', async () => {
    const res = await handlePanelButton(`panel:reg:${DEVICE}`, '777', panelCfg()) as { text: string; opts: { reply_markup: { inline_keyboard: Button[][] } } }
    for (const value of [
      'صيدلية النور &amp; الشفاء', 'أحمد محمد', '010 1234 5678', 'ahmed@noor-pharmacy.eg',
      'المنصورة', 'شارع الجلاء', 'EG', 'صيدلية', '(pharmacy)', 'صيدلة إكلينيكية',
      'trial', 'متقدمة', DEVICE, 'تطبيق سطح المكتب', '1.0.22', '2026-10-09T10:00:00.000Z',
    ]) {
      expect(res.text, value).toContain(value)
    }
    expect(res.text).toContain('بلا رخصة بعد')
    const callbacks = buttonsOf(res.opts.reply_markup).map((b) => b.callback_data)
    expect(callbacks).toEqual([`panel:issuereg:${DEVICE}`, `panel:regdel:${DEVICE}`, 'panel:regs', 'panel:home'])
  })

  it('الإصدار من الزر عبر الـwebhook ⇒ رخصة يقبلها التطبيق للجهاز نفسه، والعميل يظهر في قائمة العملاء', async () => {
    const res = await pressAsAdmin(`panel:issuereg:${DEVICE}`)
    expect(res.status).toBe(200)

    const issued = sentMessages().find((m) => m.text.includes('SHOPSYS1.'))
    expect(issued, 'رسالة المفتاح').toBeDefined()
    expect(issued!.text).toContain('أُصدرت رخصة لـ صيدلية النور &amp; الشفاء')
    const key = issued!.text.match(/<code>(SHOPSYS1\.[A-Za-z0-9_.-]+)<\/code>/)?.[1] ?? ''
    expect(key).not.toBe('')

    // الحلقة الحاسمة: المفتاح الذي أصدره المطوّر من الزر يقبله التطبيق فعلاً
    const payload = await verifyLicenseKey(key, DEVICE, PUB_B64U)
    expect(payload.deviceId).toBe(DEVICE)

    const dev = JSON.parse((await kv.get(`dev:${DEVICE}`)) ?? 'null')
    expect(dev.customer).toBe('صيدلية النور & الشفاء')
    expect(kv.metaOf(`dev:${DEVICE}`)).toMatchObject({ v: 1, customer: 'صيدلية النور & الشفاء' })

    const clients = await handlePanelButton('panel:clients', '777', panelCfg()) as { text: string; opts: { reply_markup: { inline_keyboard: Button[][] } } }
    const labels = buttonsOf(clients.opts.reply_markup).map((b) => b.text)
    expect(labels.some((t) => t.includes('صيدلية النور & الشفاء') && t.includes('1 جهاز'))).toBe(true)
    expect(buttonsOf(clients.opts.reply_markup).map((b) => b.callback_data)).not.toContain('panel:regsnew')
  })

  it('المرخّص لا يُصدَر له مرة ثانية من الزر (لا مفتاح مكرر بالخطأ)', async () => {
    await pressAsAdmin(`panel:issuereg:${DEVICE}`)
    telegram = []
    await pressAsAdmin(`panel:issuereg:${DEVICE}`)
    const reply = sentMessages()[0]
    expect(reply.text).toContain('مرخّص بالفعل')
    expect(reply.text).not.toContain('SHOPSYS1.')
  })

  it('غير المطوّر لا يستطيع الحذف ولا الإصدار (الحصر بالمعرّف)', async () => {
    await pressAsAdmin(`panel:regdelok:${DEVICE}`, 999)
    await pressAsAdmin(`panel:issuereg:${DEVICE}`, 999)
    expect(await kv.get(`reg:${DEVICE}`)).not.toBeNull()
    expect(await kv.get(`dev:${DEVICE}`)).toBeNull()
    expect(sentMessages().filter((m) => m.text.includes('SHOPSYS1.'))).toHaveLength(0)
  })

  it('الحذف على خطوتين: التأكيد أولاً، ثم يُحذف السجل ولا تُلغى الرخصة', async () => {
    await pressAsAdmin(`panel:issuereg:${DEVICE}`)
    telegram = []

    await pressAsAdmin(`panel:regdel:${DEVICE}`)
    expect(sentMessages()[0].text).toContain('سيُحذف سجل التسجيل')
    expect(await kv.get(`reg:${DEVICE}`)).not.toBeNull()

    telegram = []
    await pressAsAdmin(`panel:regdelok:${DEVICE}`)
    expect(sentMessages()[0].text).toContain('حُذف سجل التسجيل')
    expect(await kv.get(`reg:${DEVICE}`)).toBeNull()
    expect(await kv.get(`dev:${DEVICE}`)).not.toBeNull() // الرخصة باقية
  })
})
