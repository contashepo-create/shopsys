#!/usr/bin/env node
/**
 * verify_license_bypass_review3 — بوابة مراجعة ③ (2026-10-09): منع التحايل على مدة الاشتراك
 * والإبطال. كل فحص هنا يقابل ثغرة مؤكدة بالتجربة قبل الإصلاح:
 *
 *   ح1  البصمة تُحسب على البايتات المعيارية للتوقيع (إضافة `=` أو تبديل `+/` كانت تُنجي المفتاح
 *       المحروق)، والتطبيق وdevbot يتطابقان سلوكياً، وعامل السحابة يحمل التطبيع نفسه.
 *   ح2  فشل مغلق على التواريخ التالفة (تجربة لا تنتهي بنص فارغ)، والمرساة التالفة ليست «انتهى اشتراكك».
 *   ح3  touchLastSeen لا يمحو مرساة تالفة بالوقت الحالي.
 *   ح4  مخطط الإعداد القديم يُرقَّى (بصمات تحويل النشاط).
 *   ح5  مرساة سطح المكتب: قيم تالفة لا تُقبل، ونص «آخر ظهور» يُحفظ في العملية الرئيسية.
 *   ح6  القرار الموحّد للقفل يستعمله الواجهة والمهام الخلفية (تليجرام، سحابة، شبكة المحل).
 *   ح7  شبكة المحل: المضيف يتطلب multi_user_lan ولا يعمل خلف القفل.
 *   ح8  مفتاح تحويل النشاط يُطبَّق مرة واحدة (فحص السلوك في tests/license_bypass_review3.test.ts).
 *   ح9  نافذة الروابط الخارجية: مخططات محددة فقط.
 *   ح10 مسار الاشتراك: لا بيانات عميل في استجابته (كان العامل السحابي يعيد السجل الخام باسم العميل)،
 *       والكود الميت في التطبيق (fetchSubscription) محذوف.
 *
 * node --experimental-strip-types scripts/verify_license_bypass_review3.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  keyFingerprint, evaluateLicense, oldestValidDay, newestValidDay, isValidIsoDay, b64uEncode,
} from '../src/core/license.ts'
import { currentLockReason, lockReasonFor, LOCK_REASON_LABELS } from '../src/core/security.ts'
import { mergeTrialAnchor } from '../desktop/trialAnchor.ts'
import { keyFingerprint as devbotKeyFingerprint } from '../../tools/devbot/src/licenseLib.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const appLicense = read('../src/core/license.ts')
const appSecurity = read('../src/core/security.ts')
const appStore = read('../src/stores/app.store.ts')
const appTsx = read('../src/App.tsx')
const appCloud = read('../src/core/cloud.ts')
const appLanSettings = read('../src/ui/pages/LanSettingsPage.tsx')
const appPreload = read('../desktop/preload.ts')
const appMain = read('../desktop/main.ts')
const cloudWorker = read('../../cloud/worker.js')
const devbotLib = read('../../tools/devbot/src/licenseLib.js')
const devbotWorker = read('../../tools/devbot/src/worker.js')

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('مراجعة ③ — منع التحايل على مدة الاشتراك والإبطال')

/* ح1 — البصمة: تطبيع البايتات + تكافؤ سلوكي بين التطبيق وdevbot + تطبيع عامل السحابة */
const CANON_SIG = (() => {
  // توقيع بحجم Ed25519 (64 بايت) يحوي `-` أو `_` كي يكون استبدال الترميز فعّالاً
  for (let k = 1; k < 256; k++) {
    const s = b64uEncode(Uint8Array.from({ length: 64 }, (_, i) => (i * k + 7) & 255))
    if (/[-_]/.test(s)) return s
  }
  throw new Error('تعذّر توليد توقيع اختباري يحوي - أو _')
})()
ok('ح1 — الصور المكافئة للتوقيع لها البصمة نفسها في التطبيق وdevbot', () => {
  const key = `SHOPSYS1.body.${CANON_SIG}`
  const variants = [`SHOPSYS1.body.${CANON_SIG}=`, `SHOPSYS1.body.${CANON_SIG.replace(/-/g, '+').replace(/_/g, '/')}`]
  const fp = keyFingerprint(key)
  for (const v of variants) {
    assert.equal(keyFingerprint(v), fp, 'بصمة التطبيق تتغير مع صورة التوقيع')
    assert.equal(devbotKeyFingerprint(v), devbotKeyFingerprint(key), 'بصمة devbot تتغير مع صورة التوقيع')
  }
  assert.equal(fp, devbotKeyFingerprint(key), 'بصمة التطبيق ≠ devbot للمفتاح المعياري')
})
ok('ح1 — عامل السحابة يحمل التطبيع نفسه (بصمة من ثلاث صور)', () => {
  assert.match(cloudWorker, /function keyFingerprint\(key\) \{[\s\S]*?sigPart = b64uEncode\(b64uDecode\(raw\)\)/)
  assert.match(devbotLib, /export function keyFingerprint\(key\) \{[\s\S]*?sigPart = b64uEncode\(b64uDecode\(raw\)\)/)
  assert.match(appLicense, /sigPart = b64uEncode\(b64uDecode\(raw\)\)/)
})

/* ح2 — فشل مغلق على القيم الزمنية التالفة */
ok('ح2 — بداية تجربة فارغة لا تعطي تجربة بلا نهاية', () => {
  assert.equal(evaluateLicense({ activatedPayload: null, trialStartedAt: '', lastSeenAt: '2026-10-09T10:00:00.000Z', today: '2026-10-09T10:00:00.000Z' }).status, 'invalid')
})
ok('ح2 — تاريخ انتهاء تالف في مفتاح موقّع لا يعطي اشتراكاً بلا نهاية', () => {
  const p = { v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'x', plan: 'pro', features: [], issuedAt: '2026-10-01', expiresAt: '' }
  assert.equal(evaluateLicense({ activatedPayload: p, trialStartedAt: '2026-10-01T00:00:00.000Z', lastSeenAt: '2026-10-09T10:00:00.000Z', today: '2026-10-09T10:00:00.000Z' }).status, 'invalid')
})
ok('ح2 — حالة invalid تُقفل بـ license_invalid (لا «انتهى اشتراكك»)', () => {
  assert.equal(lockReasonFor({ status: 'invalid', reason: 'x' }), 'license_invalid')
  assert.ok(LOCK_REASON_LABELS.license_invalid?.title)
})
ok('ح2 — oldestValidDay/newestValidDay تتجاهلان القيم التالفة', () => {
  assert.equal(oldestValidDay('', 'junk', '2026-10-05T00:00:00.000Z', '2026-10-01T00:00:00.000Z'), '2026-10-01T00:00:00.000Z')
  assert.equal(newestValidDay('', '2026-10-05T00:00:00.000Z', '2026-10-01T00:00:00.000Z'), '2026-10-05T00:00:00.000Z')
  assert.equal(isValidIsoDay(''), false)
})
ok('ح2 — المتجر يستبدل التالف بالأقدم الصالح عند الترطيب (لا سطر يسمح بـ "" أو نص)', () => {
  assert.match(appStore, /state\.trialStartedAt = oldestValidDay\(state\.trialStartedAt, BOOT\.firstTrialAt\)/)
  assert.doesNotMatch(appStore, /state\.trialStartedAt > BOOT\.firstTrialAt/)
})

/* ح3 — لا محو لمرساة تالفة */
ok('ح3 — touchLastSeen يتجاوز القيمة التالفة قبل الكتابة بالوقت الحالي', () => {
  assert.match(appStore, /if \(!isValidIsoDay\(s\.lastSeenAt\)\) return \{\}/)
})

/* ح4 — ترقية مخطط الإعداد القديم */
ok('ح4 — بصمات تحويل النشاط: حقل في الإعداد ومُرقّى عند الترطيب', () => {
  assert.match(appStore, /activityKeyFingerprints: string\[\]/)
  assert.match(appStore, /!Array\.isArray\(state\.setup\.activityKeyFingerprints\)/)
  assert.equal((appStore.match(/activityKeyFingerprints: \[\],/g) ?? []).length, 2, 'الافتراضيات (الابتدائي + إعادة الضبط)')
})
ok('ح8 — applyActivityChangeKey يرفض المفتاح المطبَّق سابقاً قبل أي تغيير', () => {
  const start = appStore.indexOf('applyActivityChangeKey: async')
  const body = appStore.slice(start, appStore.indexOf('touchLastSeen: () =>', start))
  const replayAt = body.indexOf('استُخدم من قبل')
  const setAt = body.indexOf('set((s) => ({')
  assert.ok(replayAt > 0 && setAt > replayAt, 'فحص إعادة الاستخدام يجب أن يسبق التطبيق')
})

/* ح5 — مرساة سطح المكتب */
ok('ح5 — العملية الرئيسية تدمج المرساة عبر الدالة الخالصة (لا كتابة مباشرة للمرسلة)', () => {
  assert.match(appMain, /const merged = mergeTrialAnchor\(saved, args\)/)
  assert.match(appMain, /if \(merged\.changed\) writeFileSync\(anchorPath/)
})
ok('ح5 — الدالة الخالصة ترفض القيم التالفة ولا تكتب دون تغيّر', () => {
  const saved = { firstTrialAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-10-05T10:00:00.000Z' }
  const r = mergeTrialAnchor(saved, { firstTrialAt: '', lastSeenAt: 'junk' })
  assert.equal(r.anchor.firstTrialAt, saved.firstTrialAt)
  assert.equal(r.anchor.lastSeenAt, saved.lastSeenAt)
  assert.equal(r.changed, false)
})
ok('ح5 — preload يمرّر الوسائط كما هي، والواجهة تستدعي مطابقة المرساة بعقدها الجديد', () => {
  assert.match(appPreload, /shopsysTrialAnchor', \(args: \{ firstTrialAt\?: string; lastSeenAt\?: string \}\) => ipcRenderer\.invoke\('trial:anchor', args \?\? \{\}\)/)
  assert.match(appTsx, /window\.shopsysTrialAnchor\(\{ firstTrialAt: before\.trialStartedAt, lastSeenAt: before\.lastSeenAt \}\)/)
})

/* ح6 — القرار الموحّد للقفل */
ok('ح6 — القرار الموحّد موجود ويشمل الإبطال وعدم تطابق النشاط', () => {
  assert.match(appSecurity, /export function currentLockReason\(state: LicenseState, store: LockStoreSlice\)/)
  assert.match(appSecurity, /revoked: activatedKey != null && isRevoked\(activatedKey, revokedKeys\)/)
  assert.match(appSecurity, /activityMismatch: activatedPayload != null && setup\.completed/)
})
ok('ح6 — الواجهة والمهام الخلفية (تليجرام، سحابة) تستعمل القرار الموحّد', () => {
  assert.match(appTsx, /if \(currentLockReason\(lic, app\) !== null \|\| !hasFeature\(lic, 'telegram_bot'\)\) return/)
  assert.match(appTsx, /if \(currentLockReason\(lic, app\) !== null \|\| !hasFeature\(lic, 'cloud_sync'\)\) return/)
  // شبكة المحل تقرأ lockReason المحسوب بالدالة نفسها (لا تستدعيها مباشرة)
  assert.ok((appTsx.match(/currentLockReason\(/g) ?? []).length >= 3, 'المعتمد + تليجرام + سحابة')
})

/* ح7 — شبكة المحل */
ok('ح7 — المضيف يتطلب multi_user_lan وفتح القفل، ويتوقف خلف القفل', () => {
  assert.match(appTsx, /if \(!unlocked \|\| !hasFeature\(licenseState, 'multi_user_lan'\)\) \{[\s\S]*?stopHostSession\(\)/)
  assert.match(appTsx, /disconnectRemoteSession\(\)/)
  assert.doesNotMatch(appTsx, /useEffect\(\(\) => \{\s*const \{ lanHost, lanClient \} = useAppStore\.getState\(\)\s*if \(lanHost\.enabled && lanHost\.pairingCode\) \{\s*void startHostSession/)
})
ok('ح7 — زر بدء المضيف في الإعدادات يتحقق من الترخيص والقفل', () => {
  assert.match(appLanSettings, /!hasFeature\(lic, 'multi_user_lan'\)/)
  assert.match(appLanSettings, /currentLockReason\(lic, app\) !== null/)
})

/* ح9 — نافذة الروابط */
ok('ح9 — الروابط الخارجية: مخططات محددة فقط (لا file: ولا مخططات أخرى)', () => {
  assert.match(appMain, /if \(\/\^\(\?:https\?:\\\/\\\/\|mailto:\|tel:\)\/i\.test\(url\)\) void shell\.openExternal\(url\)/)
})

/* ح10 — لا مسارات عامة للاشتراك ولا كود ميت */
ok('ح10 — مسار الاشتراك في devbot بعقده (v1.0.3) وبلا اسم العميل', () => {
  const di = devbotWorker.indexOf('url.pathname.match(/^\\/subscription')
  assert.ok(di > 0, 'مسار devbot مفقود')
  assert.doesNotMatch(devbotWorker.slice(di, di + 400), /customer/)
})
ok('ح10 — العامل السحابي يعيد الحقول الثلاثة فقط (لا السجل الخام)', () => {
  const ci = cloudWorker.indexOf("path.match(/^\\/subscription")
  assert.ok(ci > 0, 'مسار العامل السحابي مفقود')
  const block = cloudWorker.slice(ci, ci + 800)
  assert.ok(block.includes("plan: String(o.plan ?? ''), expiresAt: o.expiresAt ?? null, message: String(o.message ?? '')"), 'الإسقاط إلى الحقول الثلاثة')
  assert.doesNotMatch(block, /new Response\(raw/)
  assert.doesNotMatch(block, /customer/)
})
ok('ح10 — لا fetchSubscription/parseSubscription/CloudSubscription في التطبيق', () => {
  assert.doesNotMatch(appCloud, /fetchSubscription|parseSubscription|CloudSubscription/)
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
