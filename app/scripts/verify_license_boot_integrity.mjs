#!/usr/bin/env node
/**
 * verify_license_boot_integrity — بوابة ث1 (تدقيق 2026-10-08):
 * «المفتاح الموقّع هو المصدر الوحيد للحمولة» — لا اعتماد على حالة محفوظة.
 *
 * الثغرة التي تُقفل هنا: التطبيق كان يقيّم الترخيص من `activatedPayload` المحفوظة
 * في التخزين ولا يعيد `verifyLicenseKey` إلا عند إدخال مفتاح يدوياً. والتخزين في
 * نسخة الويب نص صريح (localStorage) ⇒ كتابة `{plan:'lifetime',expiresAt:null}`
 * تفتح كل الميزات المدفوعة بلا مفتاح. وكذلك `setup.modules` كانت تفتح أقساماً
 * ممنوحة بمفتاح موقّع فقط.
 *
 * node --experimental-strip-types scripts/verify_license_boot_integrity.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { auditStoredLicense, canonicalPayload, encodeLicenseKey, b64uEncode, verifyLicenseKey } from '../src/core/license.ts'
import { clampModulesToLicense, effectiveModules } from '../src/core/activities.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const storeSrc = src('../src/stores/app.store.ts')
const appSrc = src('../src/App.tsx')

const DEVICE = 'SHOP-AAAA-BBBB-CCCC'
const forged = {
  v: 1, deviceId: DEVICE, customer: 'مزوّر', plan: 'lifetime',
  features: ['einvoice_eg', 'einvoice_sa', 'multi_branch', 'telegram_bot', 'cloud_sync', 'multi_user_lan'],
  issuedAt: '2026-01-01', expiresAt: null, extraModules: ['clinic', 'cars', 'realestate'],
}
const signed = {
  v: 1, deviceId: DEVICE, customer: 'بقالة النور', plan: 'basic',
  features: [], issuedAt: '2026-10-01', expiresAt: '2027-10-01',
}

console.log('🔍 القرار الخالص: auditStoredLicense')

ok('بلا مفتاح ⇒ no_key حتى مع حمولة محفوظة (التزوير الأساسي)', () => {
  const out = auditStoredLicense({ activatedKey: null, storedPayload: forged, verifiedPayload: null })
  assert.equal(out.kind, 'no_key')
  assert.equal(out.hadStoredPayload, true)
})

ok('مفتاح تحقّق ⇒ تعتمد حمولة التوقيع وحدها مع رصد اختلاف المحفوظة', () => {
  const out = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: forged, verifiedPayload: signed })
  assert.equal(out.kind, 'verified')
  assert.equal(out.payload.plan, 'basic')
  assert.equal(out.payload.expiresAt, '2027-10-01')
  assert.equal(out.storedPayloadDiffered, true)
})

ok('مفتاح لم يتحقّق ⇒ tampered بسبب عربي، ولا تُعتمد المحفوظة أبداً', () => {
  const out = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: signed, verifiedPayload: null, verifyError: 'التوقيع غير صحيح' })
  assert.equal(out.kind, 'tampered')
  assert.equal(out.reason, 'التوقيع غير صحيح')
  const noMsg = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: null, verifiedPayload: null })
  assert.equal(noMsg.kind, 'tampered')
  assert.ok(noMsg.reason.length > 3, 'سبب احتياطي عربي عند غياب رسالة الخطأ')
})

console.log('\n🔍 قصّ الوحدات على الممنوح: clampModulesToLicense')

ok('يسقط ما لا سند له من الرخصة ويُبقي الممنوح بمفتاح', () => {
  const stored = [...effectiveModules('grocery', undefined), 'clinic', 'cars']
  const out = clampModulesToLicense({ stored, activityId: 'grocery', licensedExtra: ['clinic'] })
  assert.ok(out.includes('clinic'), 'قسم ممنوح بمفتاح يبقى')
  assert.ok(!out.includes('cars'), 'قسم بلا سند يسقط')
})

ok('لا يعيد قسماً أطفأه المستخدم بنفسه (حق الإخفاء محفوظ)', () => {
  const allowed = effectiveModules('grocery', undefined)
  const stored = allowed.filter((m) => m !== 'installments')
  assert.deepEqual(clampModulesToLicense({ stored, activityId: 'grocery', licensedExtra: undefined }), stored)
})

ok('نشاط غير معروف ⇒ لا قصّ (لا تخمين على حساب أقسام العميل)', () => {
  const stored = ['clinic', 'lab']
  assert.deepEqual(clampModulesToLicense({ stored, activityId: 'نشاط_غير_موجود', licensedExtra: undefined }), stored)
})

console.log('\n🔍 دورة توقيع حقيقية: المفتاح هو المصدر')

await okAsync('مفتاح موقّع صالح يُعتمد، وحمولة lifetime مزوّرة تُستبدل به', async () => {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pub = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonicalPayload(signed))))
  const key = encodeLicenseKey(signed, sig)

  const verified = await verifyLicenseKey(key, DEVICE, pub)
  const out = auditStoredLicense({ activatedKey: key, storedPayload: forged, verifiedPayload: verified })
  assert.equal(out.kind, 'verified')
  assert.equal(out.payload.plan, 'basic', 'لا lifetime')
  assert.deepEqual(out.payload.features, [], 'لا ميزات مدفوعة ممنوحة ذاتياً')
  assert.equal(out.payload.extraModules, undefined, 'لا أقسام إضافية ممنوحة ذاتياً')
})

await okAsync('تعديل بايت واحد في التوقيع ⇒ مرفوض', async () => {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pub = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonicalPayload(signed))))
  const key = encodeLicenseKey(signed, sig)
  const parts = key.split('.')
  const bad = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}${parts[2].slice(-2) === 'AA' ? 'BB' : 'AA'}`
  let threw = false
  try { await verifyLicenseKey(bad, DEVICE, pub) } catch { threw = true }
  assert.ok(threw, 'التوقيع المعدّل يُرفض')
  const out = auditStoredLicense({ activatedKey: bad, storedPayload: signed, verifiedPayload: null, verifyError: 'التوقيع غير صحيح' })
  assert.equal(out.kind, 'tampered')
})

console.log('\n🔍 الأسلاك في المتجر والإقلاع (فحص مصدر)')

ok('المتجر يعيد التحقق من التوقيع في كل إقلاع', () => {
  assert.match(storeSrc, /reverifyActivation:\s*async/, 'إجراء reverifyActivation موجود')
  assert.match(storeSrc, /verifyLicenseKey\(\s*before\.activatedKey,\s*before\.deviceId\s*\)/, 'يعيد التحقق على المفتاح المخزّن ومعرف الجهاز')
  assert.match(storeSrc, /auditStoredLicense\(/, 'يمرّر النتيجة عبر القرار الخالص')
  assert.match(storeSrc, /clampModulesToLicense\(/, 'يقصّ الوحدات على الممنوح')
})

ok('الحمولة وحالة الفحص لا تُكتبان في التخزين (partialize)', () => {
  assert.match(storeSrc, /partialize:\s*\(state\)\s*=>/, 'partialize معرّف')
  assert.match(storeSrc, /activatedPayload:\s*_payload,\s*licenseAudit:\s*_audit,\s*\.\.\.rest/, 'يستثني الحمولة وحالة الفحص ويُبقي الباقي')
})

ok('الترطيب يسقط أي حمولة محفوظة قبل الحكم', () => {
  assert.match(storeSrc, /state\.activatedPayload = null/, 'الحمولة المحفوظة تُسقط عند الترطيب')
  assert.match(storeSrc, /status: 'checking'/, 'تُعلَّم حالة الفحص إن وُجد مفتاح')
})

ok('App يعيد التحقق بعد الترطيب ولا يحكم قبل انتهائه', () => {
  assert.match(appSrc, /reverifyActivation\(\)/, 'يستدعي الفحص عند الإقلاع')
  assert.match(appSrc, /licenseAudit\.status === 'checking'/, 'بوابة تمنع وميض شاشة القفل أثناء الفحص')
  const gateAt = appSrc.indexOf("licenseAudit.status === 'checking'")
  const lockAt = appSrc.indexOf('if (setup.completed && lockReason)')
  assert.ok(gateAt > -1 && lockAt > -1 && gateAt < lockAt, 'بوابة الفحص قبل قرار القفل')
})

ok('المفتاح نفسه يُسقط عند التلاعب — لا يبقى قابلاً لإعادة الاعتماد', () => {
  assert.match(storeSrc, /activatedKey: null,\s*\n\s*activatedPayload: null,\s*\n\s*licenseAudit: \{ status: 'tampered'/, 'يسقط المفتاح والحمولة معاً')
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
