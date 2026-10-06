#!/usr/bin/env node
/**
 * توليد زوج مفاتيح توقيع Ed25519 لمركز تحكم المطوّر — يُشغَّل مرة واحدة.
 *
 * الخطوات بعد التوليد:
 *   ① المفتاح العام (سطر PUBLIC) ⇒ يُستبدل به الثابت DEVELOPER_PUBLIC_KEY_B64U
 *      في app/src/core/license.ts ثم يُصدَر إصدار جديد — العميل يتحقق به محلياً.
 *   ② المفتاح الخاص (سطر PRIVATE) ⇒ سر في Cloudflare Worker:
 *        cd tools/devbot && npx wrangler secret put DEV_PRIVATE_KEY_B64U
 *      ⚠️ لا يُحفظ في git ولا يُرسل لأحد — من يملكه يصدر مفاتيح باسمك.
 *   ③ لا تولّد زوجاً جديداً بعد نشر أي إصدار يحمل المفتاح العام — يبطل كل مفاتيح العملاء.
 */
import { webcrypto } from 'node:crypto'

const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])

const privPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))
const pubSpki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey))
// آخر 32 بايت من SPKI هي المفتاح الخام — نفس الصيغة التي يستوردها العميل (importKey raw)
if (pubSpki.length !== 44) throw new Error(`صيغة SPKI غير متوقعة (${pubSpki.length} بايت)`)

const b64u = (bytes) => Buffer.from(bytes).toString('base64url')
const pubRaw = pubSpki.slice(pubSpki.length - 32)

console.log('═══ زوج مفاتيح التوقيع (Ed25519) لمركز التحكم ═══')
console.log('')
console.log(`PUBLIC  ( license.ts → DEVELOPER_PUBLIC_KEY_B64U ):`)
console.log(b64u(pubRaw))
console.log('')
console.log(`PRIVATE ( wrangler secret put DEV_PRIVATE_KEY_B64U ):`)
console.log(b64u(privPkcs8))
console.log('')
console.log('⚠️  احفظ المفتاح الخاص في مكان آمن خارج المستودع قبل أي شيء آخر.')
console.log('   اختبار التوافق: npm run test:e2e -- devbot_license_compat (يستعمل زوجاً مؤقتاً لا هذا).')
