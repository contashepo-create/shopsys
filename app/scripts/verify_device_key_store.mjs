#!/usr/bin/env node
/**
 * verify_device_key_store — بوابة ث2 (تدقيق 2026-10-08) — ثغرة حرجة:
 * مفتاح تشفير الجهاز كان نصاً صريحاً في `userData/device.key`.
 *
 * أي عملية على جهاز العميل تقرأ ذلك الملف فتفكّ كل لقطات القاعدة المشفّرة
 * بـAES-GCM ⇒ «القاعدة تُقرأ على هذا الجهاز فقط» كانت حماية شكلية. وسياسة
 * الخصوصية (التي يجزم اختبار legal_and_storage_v108 بصدقها) تدّعي safeStorage
 * منذ v1.0.7 بينما `app/desktop` لم يستدعه إطلاقاً.
 *
 * ما تُثبته البوابة:
 *   • أول تشغيل ⇒ مفتاح مشفّر عبر safeStorage ولا ملف صريح على القرص.
 *   • البايت الخام للمفتاح لا يظهر داخل الملف المشفّر.
 *   • ترحيل الملف الصريح: يُشفَّر **ثم** يُحذف، والمفتاح نفسه (لا فقدان بيانات).
 *   • لا حذف قبل التحقق: فشل فكّ النسخة المشفّرة ⇒ الصريح يبقى والمشفّر يُمسح.
 *   • بلا safeStorage ⇒ ملاذ صريح + تحذير مسجّل (لا صمت).
 *   • ملف تالف/سلسلة مفاتيح مفقودة ⇒ توليد جديد مع تحذير عالٍ.
 *   • العملية الرئيسية موصولة فعلاً (safeStorage + resolveDeviceKey + 0o600).
 *
 * node --experimental-strip-types scripts/verify_device_key_store.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  resolveDeviceKey, describeDeviceKeyOutcome, DEVICE_KEY_FILE, DEVICE_KEY_ENC_FILE,
} from '../desktop/deviceKeyStore.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const moduleSrc = src('../desktop/deviceKeyStore.ts')
const mainSrc = src('../desktop/main.ts')

class FakeDisk {
  constructor() { this.files = new Map(); this.ops = [] }
  read(name) { this.ops.push(`read:${name}`); return this.files.get(name) ?? null }
  write(name, data) { this.ops.push(`write:${name}`); this.files.set(name, Buffer.from(data)) }
  remove(name) { this.ops.push(`delete:${name}`); this.files.delete(name) }
}

const safeStorageStub = (opts = {}) => ({
  isEncryptionAvailable: () => {
    if (opts.throwOnQuery) throw new Error('not ready')
    return opts.available ?? true
  },
  encryptString: (plain) => Buffer.from(`ENC<${Buffer.from(plain, 'utf8').toString('hex')}>`, 'utf8'),
  decryptString: (encrypted) => {
    if (opts.corruptOnDecrypt) return Buffer.from('ffff'.repeat(16), 'hex').toString('base64')
    const text = encrypted.toString('utf8')
    if (!text.startsWith('ENC<') || !text.endsWith('>')) throw new Error('صيغة غير مفهومة')
    return Buffer.from(text.slice(4, -1), 'hex').toString('utf8')
  },
})

const KEY = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0', 'hex')

const io = (disk, safeStorage, logs = []) => ({
  readFile: (name) => disk.read(name),
  writeFile: (name, data) => disk.write(name, data),
  deleteFile: (name) => disk.remove(name),
  generate: () => Buffer.from(KEY),
  safeStorage,
  log: (_tag, message) => logs.push(message),
})

console.log('بوابة ث2 — مفتاح تشفير الجهاز (safeStorage بدل النص الصريح):')

ok('أول تشغيل ⇒ مشفّر فقط، ولا أثر صريح على القرص', () => {
  const disk = new FakeDisk()
  const outcome = resolveDeviceKey(io(disk, safeStorageStub()))
  assert.equal(outcome.key.equals(KEY), true)
  assert.equal(outcome.storage, 'safeStorage')
  assert.equal(outcome.regenerated, true)
  assert.equal(disk.files.has(DEVICE_KEY_ENC_FILE), true)
  assert.equal(disk.files.has(DEVICE_KEY_FILE), false, 'جوهر ث2: لا ملف مفتاح صريح')
  assert.equal(outcome.warnings.length, 0)
})

ok('البايت الخام للمفتاح لا يظهر داخل الملف المشفّر', () => {
  const disk = new FakeDisk()
  resolveDeviceKey(io(disk, safeStorageStub()))
  const stored = disk.files.get(DEVICE_KEY_ENC_FILE)
  assert.equal(stored.includes(KEY), false)
  assert.equal(stored.includes(Buffer.from(KEY.toString('base64'), 'utf8')), false)
  assert.equal(stored.toString('utf8').startsWith('shopsys-safekey:v1:'), true)
})

ok('إقلاع ثانٍ ⇒ قراءة فقط، بلا كتابة ولا توليد', () => {
  const disk = new FakeDisk()
  resolveDeviceKey(io(disk, safeStorageStub()))
  disk.ops = []
  const second = resolveDeviceKey(io(disk, safeStorageStub()))
  assert.equal(second.regenerated, false)
  assert.equal(second.migrated, false)
  assert.equal(second.storage, 'safeStorage')
  assert.equal(disk.ops.some((op) => op.startsWith('write:')), false)
})

ok('ترحيل الصريح: كتابة المشفّر **قبل** حذف الصريح، والمفتاح نفسه', () => {
  const disk = new FakeDisk()
  disk.write(DEVICE_KEY_FILE, KEY)
  const outcome = resolveDeviceKey(io(disk, safeStorageStub()))
  assert.equal(outcome.migrated, true)
  assert.equal(outcome.storage, 'safeStorage')
  assert.equal(outcome.key.equals(KEY), true)
  assert.equal(disk.files.has(DEVICE_KEY_FILE), false)
  assert.equal(disk.files.has(DEVICE_KEY_ENC_FILE), true)
  assert.ok(
    disk.ops.indexOf(`write:${DEVICE_KEY_ENC_FILE}`) < disk.ops.indexOf(`delete:${DEVICE_KEY_FILE}`),
    'لا نافذة زمنية يفقد فيها المفتاح',
  )
})

ok('لا حذف قبل التحقق: فشل الفكّ ⇒ الصريح يبقى والمشفّر التالف يُمسح', () => {
  const disk = new FakeDisk()
  disk.write(DEVICE_KEY_FILE, KEY)
  const outcome = resolveDeviceKey(io(disk, safeStorageStub({ corruptOnDecrypt: true })))
  assert.equal(outcome.migrated, false)
  assert.equal(outcome.storage, 'plaintext-fallback')
  assert.equal(outcome.key.equals(KEY), true, 'المفتاح ما زال قابلاً للاستخدام — لا فقدان بيانات')
  assert.equal(disk.files.get(DEVICE_KEY_FILE).equals(KEY), true, 'لم يُحذف')
  assert.equal(disk.files.has(DEVICE_KEY_ENC_FILE), false, 'المشفّر التالف مُسح')
  assert.equal(disk.ops.includes(`delete:${DEVICE_KEY_FILE}`), false)
  assert.match(outcome.warnings.join(' '), /بقي المفتاح في ملف صريح/)
})

ok('بلا safeStorage ⇒ ملاذ صريح + تحذير (وmain.ts يسجّله في main.log)', () => {
  for (const unavailable of [null, safeStorageStub({ available: false }), safeStorageStub({ throwOnQuery: true })]) {
    const disk = new FakeDisk()
    disk.write(DEVICE_KEY_FILE, KEY)
    const outcome = resolveDeviceKey(io(disk, unavailable))
    assert.equal(outcome.storage, 'plaintext-fallback')
    assert.equal(outcome.key.equals(KEY), true)
    assert.equal(disk.files.get(DEVICE_KEY_FILE).equals(KEY), true)
    assert.equal(disk.files.has(DEVICE_KEY_ENC_FILE), false)
    assert.match(outcome.warnings.join(' '), /safeStorage|غير متاح/)
  }
  /* التحذير يعود للمنادي — والعملية الرئيسية تكتبه في السجل (لا صمت) */
  assert.match(mainSrc, /for \(const warning of outcome\.warnings\) logLine\('device-key', `تحذير: \$\{warning\}`\)/)
})

ok('أول تشغيل بلا safeStorage ⇒ صريح مع تحذير', () => {
  const disk = new FakeDisk()
  const outcome = resolveDeviceKey(io(disk, safeStorageStub({ available: false })))
  assert.equal(outcome.storage, 'plaintext-fallback')
  assert.equal(outcome.regenerated, true)
  assert.equal(disk.files.get(DEVICE_KEY_FILE).equals(KEY), true)
  assert.equal(disk.files.has(DEVICE_KEY_ENC_FILE), false)
})

ok('مشفّر تالف/بلا بادئة/طول خاطئ ⇒ توليد جديد مع تحذير', () => {
  const badMagic = new FakeDisk()
  badMagic.write(DEVICE_KEY_ENC_FILE, Buffer.from('ملف قديم بلا بادئة', 'utf8'))
  assert.equal(resolveDeviceKey(io(badMagic, safeStorageStub())).regenerated, true)

  const throwing = new FakeDisk()
  throwing.write(DEVICE_KEY_ENC_FILE, Buffer.from('shopsys-safekey:v1:ليس-مشفر-صالح', 'utf8'))
  const out2 = resolveDeviceKey(io(throwing, safeStorageStub()))
  assert.equal(out2.regenerated, true)
  assert.match(out2.warnings.join(' '), /تعذّر فك المفتاح المشفّر/)

  const wrongLen = new FakeDisk()
  const stub = safeStorageStub()
  wrongLen.write(DEVICE_KEY_ENC_FILE, Buffer.from(`shopsys-safekey:v1:${stub.encryptString(Buffer.from('قصير').toString('base64')).toString('base64')}`, 'utf8'))
  const out3 = resolveDeviceKey(io(wrongLen, stub))
  assert.equal(out3.regenerated, true)
  assert.match(out3.warnings.join(' '), /طول غير متوقع/)
})

/* النص المشفّر من safeStorage بايتات ثنائية (DPAPI/Keychain/libsecret). حفظها
   كنص utf8 يُتلف كل بايت غير صالح (U+FFFD) فلا يعود المفتاح قابلاً للفكّ ⇒
   خسارة قاعدة بيانات العميل كلها. base64 هو الترميز الوحيد الآمن هنا. */
ok('النص المشفّر يُخزَّن base64 لا utf8 — وبايتات ثنائية تنجو ذهاباً وإياباً', () => {
  assert.match(moduleSrc, /encryptString\(b64\(key\)\)\.toString\('base64'\)/, 'التشفير لا يُخزَّن base64')
  assert.match(moduleSrc, /decryptString\(Buffer\.from\(cipherB64, 'base64'\)\)/, 'الفكّ لا يقرأ base64')
  assert.equal(/encryptString\(b64\(key\)\)\.toString\('utf8'\)/.test(moduleSrc), false, 'عاد الترميز الفاقد utf8')

  const BINARY = Buffer.concat([Buffer.from('v10', 'utf8'), Buffer.from([0xff, 0xfe, 0x80, 0xc3, 0x28, 0xa0, 0x00, 0xed])])
  let seen = null
  const binarySafe = {
    isEncryptionAvailable: () => true,
    encryptString: () => BINARY,
    decryptString: (encrypted) => {
      seen = Buffer.from(encrypted)
      if (!encrypted.equals(BINARY)) throw new Error('البايتات لا تطابق النص المشفّر الأصلي')
      return KEY.toString('base64')
    },
  }
  const disk = new FakeDisk()
  const first = resolveDeviceKey(io(disk, binarySafe))
  assert.equal(first.storage, 'safeStorage')
  const second = resolveDeviceKey(io(disk, binarySafe))
  assert.equal(second.regenerated, false, 'الإقلاع الثاني لم يفكّ المفتاح — الترميز فقد بايتات')
  assert.equal(second.storage, 'safeStorage')
  assert.equal(second.key.equals(KEY), true)
  assert.deepEqual(second.warnings, [])
  assert.equal(seen.equals(BINARY), true)
})

ok('صريح بطول غير 32 ⇒ يُستبدل مع تحذير (السلوك السابق محفوظ)', () => {
  const disk = new FakeDisk()
  disk.write(DEVICE_KEY_FILE, Buffer.alloc(16, 7))
  const outcome = resolveDeviceKey(io(disk, safeStorageStub()))
  assert.equal(outcome.regenerated, true)
  assert.match(outcome.warnings.join(' '), /طول غير متوقع \(16\)/)
  assert.equal(disk.files.has(DEVICE_KEY_FILE), false)
})

ok('مشفّر صالح + بقايا صريح ⇒ البقايا تُحذف', () => {
  const disk = new FakeDisk()
  disk.write(DEVICE_KEY_FILE, KEY)
  resolveDeviceKey(io(disk, safeStorageStub()))
  disk.write(DEVICE_KEY_FILE, KEY) // عادت (نسخة احتياطية مثلاً)
  const outcome = resolveDeviceKey(io(disk, safeStorageStub()))
  assert.equal(outcome.migrated, false)
  assert.equal(disk.files.has(DEVICE_KEY_FILE), false)
})

ok('مولّد مفاتيح معطوب ⇒ استثناء صريح لا مفتاح قصير صامت', () => {
  const disk = new FakeDisk()
  assert.throws(() => resolveDeviceKey({ ...io(disk, safeStorageStub()), generate: () => Buffer.alloc(8) }), /بدلاً من 32/)
})

ok('السجل التشخيصي يصف الحالة والتحذيرات', () => {
  const disk = new FakeDisk()
  disk.write(DEVICE_KEY_FILE, KEY)
  assert.match(describeDeviceKeyOutcome(resolveDeviceKey(io(disk, safeStorageStub()))), /safeStorage.*مُرحَّل/)
  assert.match(describeDeviceKeyOutcome(resolveDeviceKey(io(new FakeDisk(), safeStorageStub({ available: false })))), /نص صريح.*تحذيرات/)
})

ok('الوحدة خالصة: لا استيراد Electron ولا fs داخلها', () => {
  assert.ok(!/from 'electron'|from 'node:fs'|require\(/.test(moduleSrc), 'كل الـIO محقون — تُختبر بلا Electron')
  assert.match(moduleSrc, /export function resolveDeviceKey/)
})

ok('العملية الرئيسية موصولة: safeStorage + resolveDeviceKey + صلاحيات 0o600', () => {
  assert.match(mainSrc, /import \{ app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell \} from 'electron'/)
  assert.match(mainSrc, /import \{ describeDeviceKeyOutcome, resolveDeviceKey \} from '\.\/deviceKeyStore\.ts'/)
  assert.match(mainSrc, /resolveDeviceKey\(\{/)
  assert.match(mainSrc, /safeStorage,/)
  assert.match(mainSrc, /mode: 0o600/)
  assert.match(mainSrc, /for \(const warning of outcome\.warnings\) logLine\('device-key'/)
  // لم يعد يكتب المفتاح نصاً صريحاً مباشرةً
  assert.ok(!/writeFileSync\(keyPath, key, \{ mode: 0o600 \}\)/.test(mainSrc), 'الكتابة الصريحة المباشرة يجب أن تكون قد زالت')
  assert.match(mainSrc, /deviceEncryptionKey = ensureDeviceEncryptionKey\(\)/)
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
