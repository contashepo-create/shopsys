/**
 * مراجعة المرحلة ③ — دورة حياة الترخيص: الحدود الزمنية بالأيام الدقيقة.
 *
 * يثبت:
 *   ① التجربة: اليوم 13 فعّال بيوم متبقٍ، واليوم 14 ينتهي (TRIAL_DAYS = 14).
 *   ② المفتاح المفعّل: ينتهي اليوم ⇒ فعّال (صفر أيام)، وانتهى أمس ⇒ مقفل.
 *      مدى الحياة لا ينتهي، وتاريخ تالف ⇒ مغلق (فشل مغلق).
 *   ③ التجديد يستبدل المفتاح: الجديد يتحقق للجهاز نفسه، وحرق القديم لا يحرق الجديد.
 *      المفتاح المُبطَل مقفل حتى لو كان سارياً زمنياً. المفتاح لا يُنقل لجهاز آخر.
 *   ④ تكافؤ الحساب: حساب الأيام في التطبيق (daysBetween) وفي المركز
 *      (Math.ceil في subscriptions.js) متطابقان لكل لحظة من سنة كاملة، والتصنيف
 *      (منتهٍ / قريب / بعيد) متطابق عند الطرفين.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'

const { issueLicenseKey } = await import('../../tools/devbot/src/licenseLib.js')
const { subscriptionDigest, SOON_DAYS } = await import('../../tools/devbot/src/subscriptions.js')
const {
  evaluateLicense, daysBetween, isRevoked, keyFingerprint, verifyLicenseKey, b64uEncode, TRIAL_DAYS,
} = await import('../src/core/license.ts')
import type { LicensePayload } from '../src/core/license.ts'
const { lockReasonFor } = await import('../src/core/security.ts')

const DAY = 86_400_000
const DEVICE = 'SHOP-LIFE-1111-2222'
let PRIV_B64U = ''
let PUB_B64U = ''

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  PRIV_B64U = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))).toString('base64url')
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey))
  PUB_B64U = b64uEncode(spki.slice(spki.length - 32))
})

const payloadExpiring = (expiresAt: string | null): LicensePayload => ({
  v: 1, deviceId: DEVICE, customer: 'محل الدورة', plan: 'basic', features: [], issuedAt: '2026-10-01', expiresAt,
})

/** مخزن KV بسيط بـmetadata — لتشغيل `subscriptionDigest` الحقيقي على جهاز واحد */
class MemoryKv {
  private values = new Map<string, string>()
  private metas = new Map<string, Record<string, unknown>>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
    this.values.set(key, String(value))
    if (opts?.metadata !== undefined) this.metas.set(key, opts.metadata)
  }
  async delete(key: string) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '' }: { prefix?: string } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }
  }
}

describe('① التجربة: 14 يوماً من أول تشغيل', () => {
  const START = '2026-10-01'

  it('TRIAL_DAYS = 14 (ثابت العقد مع المركز وشاشة التجربة)', () => {
    expect(TRIAL_DAYS).toBe(14)
  })

  it('اليوم 13 (آخر يوم) فعّال بيوم متبقٍ، واليوم 14 ينتهي وتُقفل الشاشة بسبب trial_expired', () => {
    const day13 = evaluateLicense({ activatedPayload: null, trialStartedAt: START, lastSeenAt: START, today: '2026-10-14' })
    expect(day13).toEqual({ status: 'trial', daysLeft: 1 })
    expect(lockReasonFor(day13)).toBeNull()

    const day14 = evaluateLicense({ activatedPayload: null, trialStartedAt: START, lastSeenAt: '2026-10-14', today: '2026-10-15' })
    expect(day14.status).toBe('trial_expired')
    expect(lockReasonFor(day14)).toBe('trial_expired')
  })

  it('ساعة الجهاز رجعت للوراء ⇒ clock_tampered (لا تجربة جديدة بإرجاع التاريخ)', () => {
    const state = evaluateLicense({ activatedPayload: null, trialStartedAt: START, lastSeenAt: '2026-10-10', today: '2026-10-09' })
    expect(state.status).toBe('clock_tampered')
    expect(lockReasonFor(state)).toBe('clock_tampered')
  })
})

describe('② المفتاح المفعّل: حدود الانتهاء', () => {
  it('ينتهي اليوم ⇒ فعّال بصفر أيام متبقية (لا يُقفل قبل نهاية اليوم)', () => {
    const state = evaluateLicense({ activatedPayload: payloadExpiring('2026-10-09'), trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-09', today: '2026-10-09' })
    expect(state).toMatchObject({ status: 'active', daysLeft: 0 })
    expect(lockReasonFor(state)).toBeNull()
  })

  it('انتهى أمس ⇒ منتهٍ ومقفل بسبب expired', () => {
    const state = evaluateLicense({ activatedPayload: payloadExpiring('2026-10-09'), trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-10', today: '2026-10-10' })
    expect(state.status).toBe('expired')
    expect(lockReasonFor(state)).toBe('expired')
  })

  it('مدى الحياة (expiresAt = null) فعّال بلا عدّ حتى بعد سنوات', () => {
    const state = evaluateLicense({ activatedPayload: payloadExpiring(null), trialStartedAt: '2026-10-01', lastSeenAt: '2040-01-01', today: '2040-01-01' })
    expect(state).toMatchObject({ status: 'active', daysLeft: null })
    expect(lockReasonFor(state)).toBeNull()
  })

  it('تاريخ انتهاء تالف ⇒ invalid، وهي حالة مغلقة (فشل مغلق لا فعّال)', () => {
    const state = evaluateLicense({ activatedPayload: payloadExpiring('ليس تاريخاً'), trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-09', today: '2026-10-09' })
    expect(state.status).toBe('invalid')
    expect(lockReasonFor(state)).not.toBeNull()
  })
})

describe('③ التجديد والحرق والانتقال', () => {
  it('التجديد يستبدل المفتاح: الجديد يتحقق للجهاز نفسه، وحرق القديم لا يحرق الجديد', async () => {
    const base = { v: 1, deviceId: DEVICE, customer: 'محل الدورة', plan: 'basic', features: [] }
    const k1 = await issueLicenseKey({ ...base, issuedAt: '2026-10-01', expiresAt: '2026-11-01' }, PRIV_B64U)
    const k2 = await issueLicenseKey({ ...base, issuedAt: '2026-10-09', expiresAt: '2027-10-09' }, PRIV_B64U)

    const renewed = await verifyLicenseKey(k2, DEVICE, PUB_B64U)
    expect(renewed.expiresAt).toBe('2027-10-09')
    expect(keyFingerprint(k1)).not.toBe(keyFingerprint(k2))
    expect(isRevoked(k1, [keyFingerprint(k1)])).toBe(true)
    expect(isRevoked(k2, [keyFingerprint(k1)])).toBe(false)
  })

  it('المفتاح المُبطَل مقفل بسبب revoked حتى لو كان سارياً زمنياً', () => {
    const state = evaluateLicense({ activatedPayload: payloadExpiring('2030-01-01'), trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-09', today: '2026-10-09' })
    expect(state.status).toBe('active')
    expect(lockReasonFor(state, { revoked: true })).toBe('revoked')
  })

  it('المفتاح لا يُنقل لجهاز آخر (ربط بمعرّف الجهاز)', async () => {
    const key = await issueLicenseKey({ v: 1, deviceId: DEVICE, customer: 'x', plan: 'basic', features: [], issuedAt: '2026-10-01', expiresAt: '2027-10-01' }, PRIV_B64U)
    await expect(verifyLicenseKey(key, 'SHOP-OTHER-3333-4444', PUB_B64U)).rejects.toThrow(/جهاز آخر/)
  })
})

describe('④ تكافؤ حساب الأيام بين التطبيق والمركز', () => {
  it('daysBetween(اليوم, الانتهاء) = Math.ceil((منتصف الانتهاء − اللحظة) / يوم) لكل لحظة في سنة', () => {
    let checked = 0
    const mismatches: string[] = []
    /* خطوة غير منتظمة (5 ساعات و…) تُغطي كل أوقات اليوم، لا منتصف الليل فقط */
    for (let now = Date.parse('2026-01-01T00:00:00Z'); now < Date.parse('2027-01-01T00:00:00Z'); now += 5 * 3_600_000 + 1_234_567) {
      const today = new Date(now).toISOString().slice(0, 10)
      for (let offset = -3; offset <= 8; offset++) {
        const expiresAt = new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10)
        const app = daysBetween(today, expiresAt)
        const center = Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - now) / DAY)
        checked++
        if (app !== center && mismatches.length < 5) mismatches.push(`${new Date(now).toISOString()} exp=${expiresAt}: app=${app} center=${center}`)
      }
    }
    /* الشبكة: ~1640 لحظة في السنة × 12 إزاحة = 19680 حالة — الحدّ يثبت التغطية لا رقماً سحرياً */
    expect(checked).toBeGreaterThan(19_000)
    expect(mismatches).toEqual([])
  })

  it('التصنيف متطابق: منتهٍ عند التطبيق ⇔ منتهية عند المركز، وقريب (0..SOON_DAYS) ⇔ قريبة', async () => {
    expect(SOON_DAYS).toBe(6)
    const samples = [-2, -1, 0, 1, 5, 6, 7, 30]
    for (let i = 0; i < 40; i++) {
      const now = Date.parse('2026-03-01T00:00:00Z') + i * 9 * 3_600_000 + 777_000
      const today = new Date(now).toISOString().slice(0, 10)
      for (const offset of samples) {
        const expiresAt = new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10)
        const app = evaluateLicense({ activatedPayload: payloadExpiring(expiresAt), trialStartedAt: '2026-01-01', lastSeenAt: today, today })
        const kv = new MemoryKv()
        await kv.put(`dev:${DEVICE}`, JSON.stringify({ customer: 'عينة', plan: 'basic', expiresAt }))
        const digest = await subscriptionDigest({ kv } as never, { now })
        const botExpired = digest.expired.length === 1
        const botSoon = digest.soon.length === 1
        expect(app.status === 'expired', `${expiresAt} vs ${today}`).toBe(botExpired)
        const appSoon = app.status === 'active' && app.daysLeft !== null && app.daysLeft >= 0 && app.daysLeft <= SOON_DAYS
        expect(appSoon, `${expiresAt} vs ${today}`).toBe(botSoon)
      }
    }
  })
})
