/**
 * اختبار التوافق الذهبي — بوت المطوّر ↔ عميل التطبيق (جولة v1.0.3).
 *
 * مولد المفاتيح في مركز التحكم (tools/devbot/src/licenseLib.js — Cloudflare Worker)
 * مستنسخ حرفياً من app/src/core/license.ts: هذا الاختبار يثبت التطابق فعلياً:
 *   ① مفتاح أصدره البوت يمر بالتحقق الكامل عند العميل (verifyLicenseKey).
 *   ② canonicalPayload بنفس البايتات حرفياً (أي فرق ترتيب/ترميز يكسر التوقيع).
 *   ③ بصمة الحرق (keyFingerprint) متطابقة على الطرفين — 8 خانات hex صغيرة.
 *   ④ الحقول الاختيارية (extraUsers/extraBranches/activityId/extraModules)
 *      تدخل الصيغة بنفس الشروط والترتيب.
 *   ⑤ تاريخ الانتهاء: أيام صحيحة، و0/حذفها = مدى الحياة (null).
 * زوج المفاتيح مؤقت يولَّد داخل الاختبار — لا يعتمد على أسرار النشر.
 */
import { describe, it, expect } from 'vitest'
import { webcrypto } from 'node:crypto'
import devbotWorker from '../../tools/devbot/src/worker.js'
import { getNotificationsForDevice, handlePanelButton, handlePanelText } from '../../tools/devbot/src/adminPanel.js'
import { parseCloudNotices } from '../src/core/cloud.ts'
import {
  issueLicenseKey, canonicalPayload as botCanonical, keyFingerprint as botFingerprint,
  decodeLicenseKey as botDecode, expiresAfterDays, issueActivityChangeKey,
} from '../../tools/devbot/src/licenseLib.js'
import {
  canonicalPayload, keyFingerprint, verifyLicenseKey, b64uEncode, verifyActivityChangeKey,
  type LicensePayload,
} from '../src/core/license.ts'

const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const privPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))
const pubSpki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey))
// raw public = آخر 32 بايت من SPKI — الصيغة التي يستوردها العميل
const PUB_B64U = b64uEncode(pubSpki.slice(pubSpki.length - 32))
const PRIV_B64U = Buffer.from(privPkcs8).toString('base64url')

const basePayload: LicensePayload = {
  v: 1, deviceId: 'SHOP-TEST-DEV1-KEY1', customer: 'محل الاختبار', plan: 'basic',
  features: ['telegram_bot', 'multi_branch'], issuedAt: '2026-10-05', expiresAt: '2027-10-05',
}

class MemoryKv {
  private values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string) { this.values.set(key, String(value)) }
  async delete(key: string) { this.values.delete(key) }
  async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((name) => ({ name })),
      list_complete: true,
    }
  }
}

describe('التوافق الذهبي: بوت المطوّر ↔ عميل التطبيق', () => {
  it('مفتاح أصدره البوت يمر بتحقق العميل الكامل (توقيع + جهاز)', async () => {
    const key = await issueLicenseKey(basePayload, PRIV_B64U)
    const verified = await verifyLicenseKey(key, basePayload.deviceId, PUB_B64U)
    expect(verified.plan).toBe('basic')
    expect(verified.customer).toBe('محل الاختبار')
    expect(verified.expiresAt).toBe('2027-10-05')
  })

  it('التحقق يرفض المفتاح الصادر لجهاز آخر (قرار 28)', async () => {
    const key = await issueLicenseKey(basePayload, PRIV_B64U)
    await expect(verifyLicenseKey(key, 'SHOP-OTHR-DEV1-KEY1', PUB_B64U)).rejects.toThrow('جهاز آخر')
  })

  it('canonicalPayload متطابقة حرفياً بين البوت والعميل — مع كل الحقول الاختيارية', () => {
    const rich: LicensePayload = {
      ...basePayload, plan: 'pro',
      extraUsers: 3, extraBranches: 2, activityId: 'pharmacy', extraModules: ['b', 'a'],
    }
    expect(botCanonical(rich)).toBe(canonicalPayload(rich))
    // وبلا حقول اختيارية (مفاتيح قديمة) الصيغة أيضاً متطابقة
    expect(botCanonical(basePayload)).toBe(canonicalPayload(basePayload))
  })

  it('المفاتيح الموقعة بالحقول الاختيارية تُقبل أيضاً (شروط دخول الحقول متطابقة)', async () => {
    const rich: LicensePayload = { ...basePayload, extraUsers: 5, activityId: 'pharmacy' }
    const key = await issueLicenseKey(rich, PRIV_B64U)
    const verified = await verifyLicenseKey(key, rich.deviceId, PUB_B64U)
    expect(verified.extraUsers).toBe(5)
    expect(verified.activityId).toBe('pharmacy')
  })

  it('بصمة الحرق متطابقة على الطرفين — 8 خانات hex صغيرة (صيغة قائمة الإبطال)', async () => {
    const key = await issueLicenseKey(basePayload, PRIV_B64U)
    const client = keyFingerprint(key)
    const server = botFingerprint(key)
    expect(server).toBe(client)
    expect(client).toMatch(/^[0-9a-f]{8}$/)
    // وأيضاً على مفتاح ثابت البنية (البصمة دالة نصية خالصة — مطابقة حتمية)
    const fixed = 'SHOPSYS1.eyJ2IjoxLCJkZXZpY2VJZCI6IlNI\nT1AtVEVTVCJ9.ABCdef123'
    expect(botFingerprint(fixed)).toBe(keyFingerprint(fixed))
  })

  it('فك المفتاح في البوت يعيد نفس الحمولة (للبحث/السجل)', async () => {
    const key = await issueLicenseKey(basePayload, PRIV_B64U)
    const { payload } = botDecode(key)
    expect(payload.deviceId).toBe(basePayload.deviceId)
    expect(payload.plan).toBe('basic')
  })

  it('v1.0.7: مفتاح تغيير النشاط الذي يصدره البوت يمر بتحقق العميل (توقيع + جهاز)', async () => {
    const payload = { v: 1 as const, deviceId: basePayload.deviceId, fromActivityId: 'grocery', toActivityId: 'clinic', issuedAt: '2026-10-05' }
    const key = await issueActivityChangeKey(payload, PRIV_B64U)
    expect(key.startsWith('SHOPSYS2.')).toBe(true)
    const verified = await verifyActivityChangeKey(key, payload.deviceId, PUB_B64U)
    expect(verified.fromActivityId).toBe('grocery')
    expect(verified.toActivityId).toBe('clinic')
    // جهاز آخر مرفوض رغم صحة التوقيع
    await expect(verifyActivityChangeKey(key, 'SHOP-OTHE-R000-0001', PUB_B64U)).rejects.toThrow('جهاز آخر')
  })

  it('تاريخ الانتهاء: 365 يوماً صحيحاً، وlifetime = null', () => {
    expect(expiresAfterDays(365, '2026-10-05')).toBe('2027-10-05')
    expect(expiresAfterDays(30, '2026-12-15')).toBe('2027-01-14')
    expect(expiresAfterDays(0)).toBeNull()
    expect(expiresAfterDays(null)).toBeNull()
  })

  it('واجهتا «حول» والإبطال تعيدان JSON يقرأه التطبيق', async () => {
    const values: Record<string, string> = {
      about: 'نص قسم حول من البوت',
      revoked: '["deadbeef"]',
    }
    const env = { SHOPSYS_CONTROL: { get: async (key: string) => values[key] ?? null } }
    const aboutResponse = await devbotWorker.fetch(new Request('https://shopsys-control/about'), env)
    const about = await aboutResponse.json() as { body?: string }
    expect(about.body).toBe('نص قسم حول من البوت')

    const revokedResponse = await devbotWorker.fetch(new Request('https://shopsys-control/revoked'), env)
    expect(await revokedResponse.json()).toEqual(['deadbeef'])
  })

  it('لوحة الأزرار تضيف أول عميل وتحفظ تخصيصاته رغم تحديث الإعداد العام', async () => {
    const kv = new MemoryKv()
    const cfg = { kv, priv: PRIV_B64U }
    const chatId = 12345
    const deviceId = 'SHOP-ABCD-1234-EFGH'

    const empty = await handlePanelButton('panel:clients', chatId, cfg)
    expect(empty.text).toContain('لا يوجد عملاء')
    await handlePanelButton('panel:new', chatId, cfg)
    await handlePanelText('متجر النور', chatId, cfg)
    const added = await handlePanelText(deviceId, chatId, cfg)
    expect(added?.text).toContain('أُضيف متجر النور')

    const customers = await handlePanelButton('panel:clients', chatId, cfg)
    const groupHash = customers.opts.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1]
    const group = await handlePanelButton(`group:${groupHash}`, chatId, cfg)
    expect(group.text).toContain('أجهزة العميل')

    await handlePanelButton('g:plan:pro', chatId, cfg)
    await handlePanelButton('g:feature:telegram_bot', chatId, cfg)
    await handlePanelButton(`c:${deviceId}:plan:basic`, chatId, cfg)
    await handlePanelButton(`c:${deviceId}:feature:telegram_bot`, chatId, cfg)
    await handlePanelButton('g:feature:cloud_sync', chatId, cfg)

    const issued = await handlePanelButton(`issue:${deviceId}`, chatId, cfg)
    const key = issued.text.match(/<code>(SHOPSYS1\.[^<]+)<\/code>/)?.[1]
    expect(key).toBeTruthy()
    const verified = await verifyLicenseKey(key!, deviceId, PUB_B64U)
    expect(verified.plan).toBe('basic')
    expect(verified.features).toEqual([])

    await handlePanelButton('panel:notice:all', chatId, cfg)
    await handlePanelText('تحديث عام للتطبيق', chatId, cfg)
    await handlePanelButton(`notice:${deviceId}`, chatId, cfg)
    await handlePanelText('رسالة خاصة للعميل', chatId, cfg)
    expect((await getNotificationsForDevice(cfg, deviceId)).map((notice) => notice.body)).toEqual([
      'تحديث عام للتطبيق', 'رسالة خاصة للعميل',
    ])

    const response = await devbotWorker.fetch(new Request(`https://shopsys-control/notifications/${deviceId}`), { SHOPSYS_CONTROL: kv })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(parseCloudNotices(await response.json()).map((notice) => notice.body)).toEqual([
      'تحديث عام للتطبيق', 'رسالة خاصة للعميل',
    ])
  })
})
