#!/usr/bin/env node
/**
 * أداة المطوّر لإصدار مفاتيح التفعيل — لا تُوزَّع مع التطبيق أبداً
 * ──────────────────────────────────────────────────────────────
 * 1) توليد زوج مفاتيح (مرة واحدة):
 *    node scripts/license_tool.mjs genkeys
 *    → يطبع المفتاح العام (يوضع في core/license.ts) والخاص (يُحفظ سراً)
 *
 * 2) إصدار مفتاح تفعيل:
 *    SHOPSYS_PRIVATE_KEY=<b64u> node scripts/license_tool.mjs issue \
 *      --device SHOP-XXXX-XXXX-XXXX --customer "بقالة النور" \
 *      --plan pro --days 365 --features einvoice_sa,telegram_bot
 */
import {
  canonicalPayload, encodeLicenseKey, b64uEncode, b64uDecode,
} from '../src/core/license.ts'

const args = process.argv.slice(2)
const cmd = args[0]

function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (cmd === 'genkeys') {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  console.log('── مفاتيح جديدة (احفظ الخاص سراً — لا يُستعاد إن ضاع) ──')
  console.log(`PUBLIC  (يوضع في core/license.ts): ${b64uEncode(pub)}`)
  console.log(`PRIVATE (سري عند المطوّر فقط):     ${b64uEncode(priv)}`)
  process.exit(0)
}

if (cmd === 'issue') {
  const privB64u = process.env.SHOPSYS_PRIVATE_KEY
  if (!privB64u) { console.error('❌ ضع المفتاح الخاص في SHOPSYS_PRIVATE_KEY'); process.exit(1) }
  const deviceId = arg('device')
  const customer = arg('customer', '')
  const plan = arg('plan', 'basic')
  const days = arg('days') // null = مدى الحياة
  const features = (arg('features', '') || '').split(',').filter(Boolean)
  if (!deviceId) { console.error('❌ --device مطلوب'); process.exit(1) }
  if (!['basic', 'pro', 'lifetime'].includes(plan)) { console.error('❌ الخطة: basic | pro | lifetime'); process.exit(1) }

  const today = new Date().toISOString().slice(0, 10)
  const expiresAt = days
    ? new Date(Date.now() + Number(days) * 86_400_000).toISOString().slice(0, 10)
    : null

  // زيادات فوق حد الباقة (تُباع من بوت المطوّر): --extra-users N --extra-branches N
  const extraUsers = Number(arg('extra-users', '0')) || 0
  const extraBranches = Number(arg('extra-branches', '0')) || 0
  const payload = { v: 1, deviceId, customer, plan, features, issuedAt: today, expiresAt }
  if (extraUsers > 0) payload.extraUsers = extraUsers
  if (extraBranches > 0) payload.extraBranches = extraBranches
  const priv = await crypto.subtle.importKey('pkcs8', b64uDecode(privB64u), 'Ed25519', false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode(canonicalPayload(payload))))
  console.log('── مفتاح التفعيل (أرسله للعميل) ──')
  console.log(encodeLicenseKey(payload, sig))
  process.exit(0)
}

console.log('الاستخدام: genkeys | issue --device ... --customer ... --plan basic|pro|lifetime [--days N] [--features a,b] [--extra-users N] [--extra-branches N]')
