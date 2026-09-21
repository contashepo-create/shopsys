#!/usr/bin/env node
/**
 * verify_license — فحص نظام الترخيص Ed25519 كاملاً (دورة توقيع↔تحقق حقيقية)
 * node --experimental-strip-types scripts/verify_license.mjs
 */
import { strict as assert } from 'node:assert'
import {
  b64uEncode, b64uDecode, canonicalPayload, generateDeviceId,
  encodeLicenseKey, decodeLicenseKey, verifyLicenseKey,
  evaluateLicense, hasFeature, isUsable, daysBetween, TRIAL_DAYS,
} from '../src/core/license.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

/* زوج مفاتيح حقيقي للفحص */
const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
const PUB = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
const sign = async (payload) =>
  new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonicalPayload(payload))))

const DEVICE = 'SHOP-AAAA-BBBB-CCCC'
const payload = {
  v: 1, deviceId: DEVICE, customer: 'بقالة النور', plan: 'pro',
  features: ['einvoice_sa', 'telegram_bot'], issuedAt: '2026-09-14', expiresAt: '2027-09-14',
}

console.log('🔍 الترميز والبنية')

ok('base64url ذهاب وإياب مع بايتات عشوائية', () => {
  const bytes = new Uint8Array([0, 1, 250, 255, 62, 63, 128])
  assert.deepEqual([...b64uDecode(b64uEncode(bytes))], [...bytes])
  assert.ok(!b64uEncode(bytes).includes('+') && !b64uEncode(bytes).includes('/') && !b64uEncode(bytes).includes('='))
})

ok('معرف الجهاز بصيغة SHOP-XXXX-XXXX-XXXX بلا حروف ملتبسة', () => {
  const id = generateDeviceId(new Uint8Array([5, 200, 13, 99, 42, 7, 180, 33, 66, 91, 240, 17]))
  assert.match(id, /^SHOP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.ok(!id.slice(5).match(/[IO01]/))
})

ok('الصيغة القانونية حتمية: ترتيب الميزات لا يغيّرها', () => {
  const a = canonicalPayload({ ...payload, features: ['telegram_bot', 'einvoice_sa'] })
  const b = canonicalPayload({ ...payload, features: ['einvoice_sa', 'telegram_bot'] })
  assert.equal(a, b)
})

ok('فك مفتاح مشوه يُرفض بوضوح', () => {
  assert.throws(() => decodeLicenseKey('غير-صالح'))
  assert.throws(() => decodeLicenseKey('WRONG.abc.def'))
  assert.throws(() => decodeLicenseKey('SHOPSYS1.!!!.???'))
})

console.log('🔍 التوقيع والتحقق (Ed25519 حقيقي)')

await okAsync('دورة كاملة: توقيع ← ترميز ← تحقق ناجح', async () => {
  const key = encodeLicenseKey(payload, await sign(payload))
  const verified = await verifyLicenseKey(key, DEVICE, PUB)
  assert.equal(verified.customer, 'بقالة النور')
  assert.equal(verified.plan, 'pro')
  assert.deepEqual(verified.features.sort(), ['einvoice_sa', 'telegram_bot'])
})

await okAsync('العبث بالحمولة يكسر التوقيع (ترقية خطة مزورة)', async () => {
  const key = encodeLicenseKey(payload, await sign(payload))
  const parts = key.split('.')
  const tampered = { ...payload, plan: 'lifetime', expiresAt: null }
  const fakeBody = b64uEncode(new TextEncoder().encode(canonicalPayload(tampered)))
  await assert.rejects(() => verifyLicenseKey(`${parts[0]}.${fakeBody}.${parts[2]}`, DEVICE, PUB))
})

await okAsync('مفتاح جهاز آخر مرفوض', async () => {
  const key = encodeLicenseKey(payload, await sign(payload))
  await assert.rejects(() => verifyLicenseKey(key, 'SHOP-ZZZZ-ZZZZ-ZZZZ', PUB), /جهاز آخر/)
})

await okAsync('توقيع بمفتاح خاص دخيل مرفوض', async () => {
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const badSig = new Uint8Array(await crypto.subtle.sign('Ed25519', other.privateKey, new TextEncoder().encode(canonicalPayload(payload))))
  const key = encodeLicenseKey(payload, badSig)
  await assert.rejects(() => verifyLicenseKey(key, DEVICE, PUB), /التوقيع غير صحيح/)
})

console.log('🔍 آلة حالات الترخيص')

const base = { trialStartedAt: '2026-09-01T10:00:00Z', lastSeenAt: '2026-09-10T10:00:00Z' }

ok('تجربة سارية: الأيام المتبقية صحيحة', () => {
  const s = evaluateLicense({ ...base, activatedPayload: null, today: '2026-09-10T12:00:00Z' })
  assert.equal(s.status, 'trial')
  assert.equal(s.daysLeft, TRIAL_DAYS - 9)
  assert.ok(isUsable(s))
})

ok('التجربة 14 يوماً كاملة: اليوم 13 سارية واليوم 14 منتهية', () => {
  const s = evaluateLicense({ ...base, lastSeenAt: '2026-09-14T00:00:00Z', activatedPayload: null, today: '2026-09-14T00:00:00Z' })
  assert.equal(s.status, 'trial')
  assert.equal(s.daysLeft, 1) // آخر يوم
  const s2 = evaluateLicense({ ...base, lastSeenAt: '2026-09-15T00:00:00Z', activatedPayload: null, today: '2026-09-15T00:00:00Z' })
  assert.equal(s2.status, 'trial_expired')
  assert.ok(!isUsable(s2))
})

ok('إرجاع الساعة قبل آخر ظهور يُكتشف', () => {
  const s = evaluateLicense({ ...base, activatedPayload: null, today: '2026-09-05T10:00:00Z' })
  assert.equal(s.status, 'clock_tampered')
})

ok('اليوم قبل بداية التجربة = تلاعب', () => {
  const s = evaluateLicense({ trialStartedAt: '2026-09-10T00:00:00Z', lastSeenAt: '2026-08-01T00:00:00Z', activatedPayload: null, today: '2026-08-20T00:00:00Z' })
  assert.equal(s.status, 'clock_tampered')
})

ok('مفتاح سارٍ: أيام متبقية، ومدى الحياة: null', () => {
  const s = evaluateLicense({ ...base, activatedPayload: payload, today: '2026-12-14T00:00:00Z' })
  assert.equal(s.status, 'active')
  assert.equal(s.daysLeft, daysBetween('2026-12-14', '2027-09-14'))
  const life = evaluateLicense({ ...base, activatedPayload: { ...payload, expiresAt: null }, today: '2099-01-01T00:00:00Z' })
  assert.equal(life.status, 'active')
  assert.equal(life.daysLeft, null)
})

ok('مفتاح منتهٍ: expired وغير قابل للاستخدام', () => {
  const s = evaluateLicense({ ...base, lastSeenAt: '2027-09-15T00:00:00Z', activatedPayload: payload, today: '2027-09-15T00:00:00Z' })
  assert.equal(s.status, 'expired')
  assert.ok(!isUsable(s))
})

ok('hasFeature: بمفتاح يحملها فقط (قرار 21)', () => {
  const active = evaluateLicense({ ...base, activatedPayload: payload, today: '2026-10-01T00:00:00Z' })
  assert.ok(hasFeature(active, 'einvoice_sa'))
  assert.ok(!hasFeature(active, 'einvoice_eg'))
  const trial = evaluateLicense({ ...base, activatedPayload: null, today: '2026-09-10T12:00:00Z' })
  assert.ok(!hasFeature(trial, 'einvoice_sa')) // التجربة لا تمنح ميزات خاصة
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
