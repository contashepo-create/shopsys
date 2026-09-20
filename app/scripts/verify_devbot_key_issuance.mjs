/**
 * 🤖 فحص دائم — ترقية بوت المطوّر (سد فجوة التدقيق):
 * 1) توافق التوقيع بين الووركر والتطبيق: مفتاح مبني بدوال worker.js
 *    (canonicalPayload/b64u/توقيع Ed25519) يجتاز verifyLicenseKey في التطبيق حرفياً
 * 2) بصمة الحرق في الووركر = keyFingerprint في التطبيق (حرق من البوت يعمل)
 * 3) بنية الووركر: أوامر اصدار/حرق/محروق/اشتراك/احصائيات/تذكير/مساعدة + cron
 * 4) الأمان: الأوامر خلف fromDevChat فقط، وأمر الإصدار خلف سر SHOPSYS_PRIVATE_KEY
 *
 * تشغيل: node --experimental-strip-types scripts/verify_devbot_key_issuance.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }

const lic = await import(join(root, 'src/core/license.ts'))

console.log('\n═══ 1) مفتاح موقَّع بمنطق الووركر يجتاز تحقق التطبيق ═══')
{
  // نفس دوال الووركر (منسوخة معنوياً هنا للفحص المتقاطع مع دوال التطبيق الحقيقية)
  const b64uEncode = (bytes) => {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const workerCanonical = (p) => {
    const base = {
      v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
      features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
    }
    if (p.extraUsers != null) base.extraUsers = p.extraUsers
    if (p.extraBranches != null) base.extraBranches = p.extraBranches
    if (p.activityId != null) base.activityId = p.activityId
    if (p.extraModules != null) base.extraModules = [...p.extraModules].sort()
    return JSON.stringify(base)
  }

  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pub = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))

  const payload = {
    v: 1, deviceId: 'SHOP-TEST-BOTX-KEYS', customer: 'بقالة النور', plan: 'pro',
    features: ['cloud_sync', 'telegram_bot'], issuedAt: '2026-09-20', expiresAt: '2027-09-20',
    extraBranches: 2, activityId: 'pharmacy', extraModules: ['logistics'],
  }
  // الصيغة القانونية متطابقة حرفياً بين الووركر والتطبيق
  assert.equal(workerCanonical(payload), lic.canonicalPayload(payload), 'canonicalPayload متطابقة')
  ok('صيغة التوقيع القانونية متطابقة حرفياً بين worker.js وcore/license.ts')

  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(workerCanonical(payload))))
  const key = `SHOPSYS1.${b64uEncode(new TextEncoder().encode(workerCanonical(payload)))}.${b64uEncode(sig)}`
  const verified = await lic.verifyLicenseKey(key, 'SHOP-TEST-BOTX-KEYS', pub)
  assert.equal(verified.plan, 'pro')
  assert.equal(verified.extraBranches, 2)
  assert.equal(verified.activityId, 'pharmacy')
  ok('مفتاح مبني بمنطق البوت يجتاز verifyLicenseKey بكل الحقول (خطة/فروع/نشاط/وحدات)')

  // جهاز مختلف يُرفض — البوت لا يستطيع إصدار مفتاح عابر للأجهزة
  await assert.rejects(() => lic.verifyLicenseKey(key, 'SHOP-XXXX-YYYY-ZZZZ', pub), /جهاز آخر/)
  ok('المفتاح مربوط بالجهاز حتى من البوت')

  console.log('\n═══ 2) بصمة الحرق متطابقة ═══')
  const workerFingerprint = (k) => {
    const sigPart = k.trim().split('.')[2] ?? k
    let h = 5381
    for (let i = 0; i < sigPart.length; i++) h = ((h << 5) + h + sigPart.charCodeAt(i)) >>> 0
    return h.toString(16).padStart(8, '0')
  }
  assert.equal(workerFingerprint(key), lic.keyFingerprint(key))
  assert.ok(lic.isRevoked(key, [workerFingerprint(key)]), 'بصمة البوت تحرق المفتاح في التطبيق')
  ok('حرق من البوت (بالبصمة أو المفتاح كاملاً) يبطل المفتاح في التطبيق')
}

console.log('\n═══ 3) بنية الووركر: الأوامر الجديدة + cron ═══')
{
  const worker = readFileSync(join(root, '../cloud/worker.js'), 'utf8')
  for (const c of ["cmd === 'اصدار'", "cmd === 'حرق'", "cmd === 'محروق'", "cmd === 'اشتراك'", "cmd === 'احصائيات'", "cmd === 'تذكير'", "cmd === 'مساعدة'"]) {
    assert.ok(worker.includes(c), `أمر ${c} موجود`)
  }
  assert.ok(worker.includes('async scheduled('), 'التذكير التلقائي اليومي (cron) موجود')
  assert.ok(worker.includes('subscriptionDigest'), 'ملخص الاشتراكات المنتهية/الموشكة')
  ok('أوامر البوت السبعة الجديدة + التذكير التلقائي اليومي موجودة')

  console.log('\n═══ 4) الأمان ═══')
  // كل الأوامر داخل بلوك fromDevChat — أي محادثة أخرى تُتجاهل
  const cmdBlock = worker.indexOf("if (!replyTo && text && fromDevChat)")
  assert.ok(cmdBlock > 0 && worker.indexOf("cmd === 'اصدار'") > cmdBlock, 'أوامر الإصدار خلف حارس محادثة المطوّر')
  // الإصدار مشروط بوجود السر — بدونه رسالة إرشادية لا كسر
  assert.ok(worker.includes('!env.SHOPSYS_PRIVATE_KEY'), 'أمر الإصدار يتحقق من وجود سر التوقيع أولاً')
  // الويبهوك محمي بسر تليجرام
  assert.ok(worker.includes('x-telegram-bot-api-secret-token'), 'الويبهوك محمي بـsecret_token')
  // المفتاح الخاص لا يظهر في أي استجابة GET عامة
  assert.ok(!worker.includes('SHOPSYS_PRIVATE_KEY)') || !worker.match(/json\([^)]*SHOPSYS_PRIVATE_KEY/), 'المفتاح الخاص لا يُسرّب في الاستجابات')
  const toml = readFileSync(join(root, '../cloud/wrangler.toml'), 'utf8')
  assert.ok(toml.includes('SHOPSYS_PRIVATE_KEY'), 'توثيق سر التوقيع في wrangler.toml')
  ok('الأمان: أوامر خلف محادثة المطوّر + السر في أسرار Cloudflare لا في الكود')
}

console.log(`\n✅ فحص ترقية بوت المطوّر: ${pass} محطات — كلها خضراء\n`)
