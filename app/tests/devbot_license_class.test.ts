/**
 * بند 2 (طلب المالك 2026-10-17) — صنف «رخصة» في مركز التحكّم:
 * سجل `dev:` قد يكون **رخصة صادرة** أو مجرد **تسجيل بلا مفتاح** (العميل سجَّل
 * جهازه ولم يُرمّخص بعد). الخلط بينهما كان يُظهر عميلاً بلا رخصة كـ«سارية»
 * ويُخفي عنه زر الإصدار.
 *
 * ما يثبته هذا الملف:
 *   ① `hasLicense` = السجل له خطة غير فارغة (و`trial` محجوزة لمفتاح حقيقي).
 *   ② `ensureDeviceRecord` ينشئ سجلاً **بلا رخصة** عند أول تسجيل، ولا يمسّ
 *      حالة الترخيص لسجل قائم، ولا ينشئ سجلاً ثانياً عند إعادة التسجيل.
 *   ③ لوحة تليجرام: الجهاز بلا رخصة يبقى في «مسجّلون بلا رخصة»، وبطاقة العميل
 *      تقول «بلا رخصة» (لا «سارية» ولا خطة فارغة)، وزر الإصدار متاح.
 *   ④ digest: المسجَّل بلا مفتاح يُعدّ منفصلاً (trial) لا «مدى الحياة».
 */
import { describe, it, expect } from 'vitest'

const { saveRegistration, sanitizeRegistration, ensureDeviceRecord, hasLicense } = await import('../../tools/devbot/src/registrations.js')
const { handlePanelButton } = await import('../../tools/devbot/src/adminPanel.js')
const { subscriptionDigest } = await import('../../tools/devbot/src/subscriptions.js')

class MemoryKv {
  values = new Map<string, string>()
  metas = new Map<string, Record<string, unknown>>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
    this.values.set(key, String(value))
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key: string) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

const DEVICE = 'SHOP-7K2M-9PXQ-4RTZ'
const cfg = () => ({ kv: new MemoryKv() })
const report = (deviceId = DEVICE) => sanitizeRegistration({
  deviceId, shopName: 'محل النور', ownerName: 'أحمد', phone: '01000000000',
  email: 'owner@example.com', city: 'المنصورة', street: 'شارع Judiciary', activityNameAr: 'محلات عامة',
})!

describe('② صنف «رخصة» — hasLicense', () => {
  it('السجل بلا خطة = تسجيل بلا مفتاح (ليس رخصة)', () => {
    expect(hasLicense({ plan: '', expiresAt: null, fingerprint: '' })).toBe(false)
    expect(hasLicense({ plan: '   ', expiresAt: null })).toBe(false)
    expect(hasLicense({})).toBe(false)
    expect(hasLicense(null)).toBe(false)
  })

  it('السجل بخطة = رخصة صادرة', () => {
    expect(hasLicense({ plan: 'pro', expiresAt: '2027-01-01' })).toBe(true)
    expect(hasLicense({ plan: 'trial' })).toBe(true)
    expect(hasLicense({ plan: 'lifetime', expiresAt: null })).toBe(true)
  })
})

describe('② صنف «رخصة» — ensureDeviceRecord', () => {
  it('أول تسجيل ⇒ سجل dev: بلا رخصة (خطة فارغة) باسم العميل', async () => {
    const c = cfg()
    const result = await ensureDeviceRecord(c, report())
    expect(result.created).toBe(true)
    const record = JSON.parse((await c.kv.get(`dev:${DEVICE}`)) ?? 'null')
    expect(record.plan).toBe('')
    expect(record.expiresAt).toBeNull()
    expect(record.fingerprint).toBe('')
    expect(record.customer).toBe('محل النور')
  })

  it('إعادة التسجيل ⇒ نفس السجل (لا سجل ثانٍ) بلا تغيير الحالة', async () => {
    const c = cfg()
    await saveRegistration(c, report())
    await saveRegistration(c, report())
    const keys = (await c.kv.list({ prefix: 'dev:' })).keys
    expect(keys.length).toBe(1)
  })

  it('سجل قائم مرخّص: لا يُمسّ plan/expiresAt/fingerprint', async () => {
    const c = cfg()
    await c.kv.put(`dev:${DEVICE}`, JSON.stringify({ plan: 'pro', expiresAt: '2027-01-01', customer: 'قديم', fingerprint: 'abcd1234', message: 'ملاحظة' }))
    const result = await ensureDeviceRecord(c, report())
    expect(result.created).toBe(false)
    const record = JSON.parse((await c.kv.get(`dev:${DEVICE}`)) ?? 'null')
    expect(record.plan).toBe('pro')
    expect(record.expiresAt).toBe('2027-01-01')
    expect(record.fingerprint).toBe('abcd1234')
    expect(record.message).toBe('ملاحظة')
  })

  it('سجل قائم بلا اسم عميل ⇒ يُكمل الاسم فقط', async () => {
    const c = cfg()
    await c.kv.put(`dev:${DEVICE}`, JSON.stringify({ plan: '', expiresAt: null, customer: '', fingerprint: '' }))
    await ensureDeviceRecord(c, report())
    const record = JSON.parse((await c.kv.get(`dev:${DEVICE}`)) ?? 'null')
    expect(record.customer).toBe('محل النور')
  })
})

describe('② صنف «رخصة» — لوحة تليجرام', () => {
  it('الجهاز بلا رخصة يبقى في «مسجّلون بلا رخصة» وبطاقته تقول «بلا رخصة»', async () => {
    const c = cfg()
    await saveRegistration(c, report())
    const unlicensed = await handlePanelButton('panel:regsnew', '777', c) as { text: string }
    expect(unlicensed.text).toContain('مسجّلون بلا رخصة (1)')
    const card = await handlePanelButton(`panel:reg:${DEVICE}`, '777', c) as { text: string; opts: { reply_markup: { inline_keyboard: { callback_data: string }[][] } } }
    expect(card.text).toContain('بلا رخصة بعد')
    const callbacks = card.opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data)
    expect(callbacks).toContain(`panel:issuereg:${DEVICE}`)
  })

  it('بطاقة العميل: «بلا رخصة» لا «سارية» (لا mislead للمطوّر)', async () => {
    const c = cfg()
    await saveRegistration(c, report())
    const card = await handlePanelButton(`client:${DEVICE}`, '777', c) as { text: string }
    expect(card.text).toContain('بلا رخصة')
    expect(card.text).not.toContain('سارية')
  })
})

describe('② صنف «رخصة» — التذكير اليومي', () => {
  it('المسجَّل بلا مفتاح يُعدّ منفصلاً (trial) لا «مدى الحياة»', async () => {
    const c = cfg()
    await saveRegistration(c, report())
    const digest = await subscriptionDigest(c, { now: Date.parse('2026-10-17T00:00:00Z') })
    expect(digest.trial).toBe(1)
    expect(digest.lifetime).toBe(0)
    expect(digest.soon.length).toBe(0)
    expect(digest.expired.length).toBe(0)
  })
})
