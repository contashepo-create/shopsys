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
import {
  issueLicenseKey, canonicalPayload as botCanonical, keyFingerprint as botFingerprint,
  decodeLicenseKey as botDecode, expiresAfterDays,
} from '../../tools/devbot/src/licenseLib.js'
import {
  canonicalPayload, keyFingerprint, verifyLicenseKey, b64uEncode,
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
  features: ['lan_host', 'multi_branch'], issuedAt: '2026-10-05', expiresAt: '2027-10-05',
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

  it('تاريخ الانتهاء: 365 يوماً صحيحاً، وlifetime = null', () => {
    expect(expiresAfterDays(365, '2026-10-05')).toBe('2027-10-05')
    expect(expiresAfterDays(30, '2026-12-15')).toBe('2027-01-14')
    expect(expiresAfterDays(0)).toBeNull()
    expect(expiresAfterDays(null)).toBeNull()
  })
})
