#!/usr/bin/env node
/**
 * توليد مفتاح تغيير النشاط (v1.0.7 — موافقة المالك) — أداة محلية للمطوّر،
 * تعمل اليوم بلا نشر مركز التحكم: نفس التوقيع الذي يصدره أمر البوت
 * «/مفتاح_نشاط» بعد نشره.
 *
 * الاستخدام:
 *   DEV_PRIVATE_KEY_B64U=<المفتاح الخاص> node scripts/keygen-activity.mjs \
 *     SHOP-XXXX-XXXX-XXXX <من النشاط> <إلى النشاط>
 *
 *   أو مرّر المفتاح الخاص كوسيط ثالث (لا يُنصح على أجهزة مشتركة):
 *   node scripts/keygen-activity.mjs SHOP-XXXX-XXXX-XXXX grocery clinic <PRIV>
 *
 * المفتاح الخاص: هو نفسه سر Cloudflare (DEV_PRIVATE_KEY_B64U) الذي وُلّد
 * بscripts/keygen.mjs — من يملكه يصدر مفاتيح باسمك.
 *
 * ما يفعله العميل بالمفتاح: الإعدادات العامة ← النشاط ← «تغيير النشاط
 * بمفتاح الدعم» — التطبيق يتحقق من التوقيع والجهاز والنشاط الحالي، ويطبق
 * القوالب والهوية اللونية وقالب الفاتورة مع بقاء كل البيانات، بتقييد
 * تغيير واحد كل 30 يوماً.
 */
import { issueActivityChangeKey } from '../src/licenseLib.js'

const [deviceId, fromId, toId, privArg] = process.argv.slice(2)
const priv = privArg || process.env.DEV_PRIVATE_KEY_B64U

if (!deviceId || !fromId || !toId || !priv) {
  console.log('الصيغة: DEV_PRIVATE_KEY_B64U=<سر> node scripts/keygen-activity.mjs SHOP-XXXX-XXXX-XXXX <من النشاط> <إلى النشاط>')
  console.log('مثال:   DEV_PRIVATE_KEY_B64U=... node scripts/keygen-activity.mjs SHOP-AB12-CD34-EF56 grocery clinic')
  process.exit(1)
}
if (!/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId)) {
  console.error('⚠️ معرّف الجهاز غير صحيح — يظهر للعميل في شاشة التفعيل')
  process.exit(1)
}
if (fromId === toId) {
  console.error('⚠️ النشاطان متطابقان')
  process.exit(1)
}

const payload = {
  v: 1, deviceId,
  fromActivityId: fromId, toActivityId: toId,
  issuedAt: new Date().toISOString().slice(0, 10),
}
const key = await issueActivityChangeKey(payload, priv)
console.log('═══ مفتاح تغيير النشاط ═══')
console.log(`الجهاز: ${deviceId}`)
console.log(`التحويل: ${fromId} ← ${toId}`)
console.log('')
console.log(key)
console.log('')
console.log('أرسله للعميل ليلصقه في: الإعدادات العامة ← النشاط ← «تغيير النشاط بمفتاح الدعم»')
