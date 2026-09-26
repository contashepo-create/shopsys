/**
 * بوابة أمن قناة الدعم v2: CORS allowlist + HMAC timestamp/nonce + منع replay.
 * التشغيل: node --experimental-strip-types scripts/verify_support_security.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import worker from '../../cloud/worker.js'

globalThis.crypto ??= webcrypto

class MemoryKv {
  constructor() { this.map = new Map() }
  async get(key) { return this.map.get(key) ?? null }
  async put(key, value) { this.map.set(key, String(value)) }
  async list() { return { keys: [], list_complete: true } }
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function hex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }

async function signature(token, method, path, timestamp, requestNonce, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const canonical = `${method}\n${path}\n${timestamp}\n${requestNonce}\n${body}`
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))))
}

const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
const deviceId = 'DEV-123'
const path = `/support/${deviceId}`
const env = { SHOPSYS_KV: new MemoryKv(), SUPPORT_ALLOWED_ORIGINS: 'https://app.example.com' }
const source = readFileSync(new URL('../../cloud/worker.js', import.meta.url), 'utf8')
assert.ok(!source.includes("'access-control-allow-origin': '*'"), 'لا يوجد CORS wildcard')
assert.ok(source.includes("const SUPPORT_PROTOCOL = '2'"), 'بروتوكول الدعم v2 مفعل')

let response = await worker.fetch(new Request('https://worker.test/', {
  method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
}), env)
assert.equal(response.status, 403, 'origin غير المسموح مرفوض')

response = await worker.fetch(new Request('https://worker.test/', {
  method: 'OPTIONS', headers: { Origin: 'https://app.example.com' },
}), env)
assert.equal(response.status, 204, 'origin المسموح يمر في preflight')
assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com', 'CORS يعيد origin الصريح')

const timestamp = String(Math.floor(Date.now() / 1000))
const requestNonce = base64Url(crypto.getRandomValues(new Uint8Array(18)))
const sig = await signature(token, 'GET', path, timestamp, requestNonce, '')
const headers = {
  Origin: 'https://app.example.com',
  Authorization: `Support ${token}`,
  'X-Support-Protocol': '2',
  'X-Support-Timestamp': timestamp,
  'X-Support-Nonce': requestNonce,
  'X-Support-Signature': sig,
}
const forbiddenOrigin = await worker.fetch(new Request(`https://worker.test${path}`, { headers: { ...headers, Origin: 'https://evil.example' } }), env)
assert.equal(forbiddenOrigin.status, 403, 'الطلب الفعلي من origin غير المسموح مرفوض')
response = await worker.fetch(new Request(`https://worker.test${path}`, { headers }), env)
assert.equal(response.status, 200, 'طلب HMAC صالح يمر')
assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com', 'طلب الدعم يعيد CORS الصريح')

const replay = await worker.fetch(new Request(`https://worker.test${path}`, { headers }), env)
assert.equal(replay.status, 401, 'إعادة استخدام nonce مرفوضة')

const oldTimestamp = String(Math.floor(Date.now() / 1000) - 301)
const oldNonce = base64Url(crypto.getRandomValues(new Uint8Array(18)))
const oldSig = await signature(token, 'GET', path, oldTimestamp, oldNonce, '')
const expired = await worker.fetch(new Request(`https://worker.test${path}`, {
  headers: { ...headers, 'X-Support-Timestamp': oldTimestamp, 'X-Support-Nonce': oldNonce, 'X-Support-Signature': oldSig },
}), env)
assert.equal(expired.status, 401, 'التوقيع القديم مرفوض')

console.log('PASS: support security v2 (CORS allowlist, HMAC, timestamp, nonce, replay protection)')
