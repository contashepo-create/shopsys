/**
 * v1.0.22 — مفتاح الاسترداد: تغليف المفتاح بكلمة مرور، والاستيراد الآمن.
 * الغرض: فقدان مفتاح الجهاز لا يعني فقدان البيانات، ولا يُكتب فوق المفتاح الحالي أبداً.
 */
import { describe, it, expect } from 'vitest'

const {
  wrapDeviceKey, unwrapDeviceKey, validateRecoveryPassphrase, keyRecoveryFileName,
  KEY_RECOVERY_FORMAT, KEY_RECOVERY_ITERATIONS, KEY_RECOVERY_MIN_ITERATIONS,
} = await import('../desktop/keyRecovery.ts')
const {
  storeRecoveredDeviceKey, resolveDeviceKey, DEVICE_KEY_ENC_FILE, DEVICE_KEY_FILE,
} = await import('../desktop/deviceKeyStore.ts')

const KEY = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0', 'hex')
const OTHER_KEY = Buffer.from('a'.repeat(64), 'hex')
const PASS = 'كلمة-مرور-طويلة-2026'
/* تكرارات منخفضة لسرعة الاختبار فقط — الإنتاج يستخدم KEY_RECOVERY_ITERATIONS */
const FAST = { iterations: KEY_RECOVERY_MIN_ITERATIONS, now: new Date('2026-10-10T09:00:00Z') }

describe('تغليف مفتاح الاسترداد بكلمة مرور', () => {
  it('الملف يُفك بكلمة المرور نفسها ويعيد المفتاح ومعرّف الجهاز بالبايت', () => {
    const file = wrapDeviceKey(KEY, PASS, 'dev-123', FAST)
    const out = unwrapDeviceKey(file, PASS)
    expect(out.key.equals(KEY)).toBe(true)
    expect(out.deviceId).toBe('dev-123')
    expect(out.createdAt).toBe('2026-10-10T09:00:00.000Z')
  })

  it('الإعداد الافتراضي 600000 تكرار (توصية OWASP) وصيغة الملف معلنة', () => {
    const parsed = JSON.parse(wrapDeviceKey(KEY, PASS, 'dev-1'))
    expect(parsed.format).toBe(KEY_RECOVERY_FORMAT)
    expect(parsed.kdf.iterations).toBe(KEY_RECOVERY_ITERATIONS)
    expect(KEY_RECOVERY_ITERATIONS).toBe(600_000)
    expect(parsed.kdf.name).toBe('PBKDF2-HMAC-SHA256')
    expect(parsed.cipher.name).toBe('AES-256-GCM')
  })

  it('الملف لا يحوي المفتاح الخام بأي ترميز شائع', () => {
    const text = wrapDeviceKey(KEY, PASS, 'dev-1', FAST)
    expect(text.includes(KEY.toString('hex'))).toBe(false)
    expect(text.includes(KEY.toString('base64'))).toBe(false)
  })

  it('كلمة مرور خاطئة ⇒ رسالة عربية واضحة لا تكشف شيئاً', () => {
    const file = wrapDeviceKey(KEY, PASS, 'dev-1', FAST)
    expect(() => unwrapDeviceKey(file, 'كلمة-خاطئة-تماماً')).toThrow(/كلمة المرور غير صحيحة/)
  })

  it('التطبيع NFKC: الصيغة المركبة والمفككة للحرف نفسه تفتح الملف', () => {
    const composed = 'مرور-é-2026-xx'
    const decomposed = 'مرور-e\u0301-2026-xx'
    const file = wrapDeviceKey(KEY, composed, 'dev-1', FAST)
    expect(unwrapDeviceKey(file, decomposed).key.equals(KEY)).toBe(true)
  })

  it('تعديل ترويسة الملف (معرّف الجهاز) يُكشف — الترويسة مربوطة بالتشفير AAD', () => {
    const parsed = JSON.parse(wrapDeviceKey(KEY, PASS, 'dev-1', FAST))
    parsed.deviceId = 'dev-2'
    expect(() => unwrapDeviceKey(JSON.stringify(parsed), PASS)).toThrow(/معدَّل|تالف|كلمة المرور/)
  })

  it('خفض التكرارات في الملف يُكشف ولا يفتح', () => {
    const parsed = JSON.parse(wrapDeviceKey(KEY, PASS, 'dev-1', FAST))
    parsed.kdf.iterations = KEY_RECOVERY_MIN_ITERATIONS + 1
    expect(() => unwrapDeviceKey(JSON.stringify(parsed), PASS)).toThrow()
  })

  it('تكرارات أقل من الحد الأدنى ⇒ مرفوضة قبل أي فك', () => {
    const parsed = JSON.parse(wrapDeviceKey(KEY, PASS, 'dev-1', FAST))
    parsed.kdf.iterations = 1000
    expect(() => unwrapDeviceKey(JSON.stringify(parsed), PASS)).toThrow(/غير آمنة/)
  })

  it('ملف ليس بصيغة الاسترداد أو إصدار غير مدعوم ⇒ رسالة واضحة', () => {
    expect(() => unwrapDeviceKey('ليس JSON', PASS)).toThrow(/ليس بصيغة صالحة/)
    expect(() => unwrapDeviceKey(JSON.stringify({ format: 'other' }), PASS)).toThrow(/ليس ملف مفتاح استرداد/)
    const parsed = JSON.parse(wrapDeviceKey(KEY, PASS, 'dev-1', FAST))
    parsed.version = 99
    expect(() => unwrapDeviceKey(JSON.stringify(parsed), PASS)).toThrow(/غير مدعوم/)
  })

  it('كلمة مرور قصيرة مرفوضة عند التغليف وتُعاد رسالتها للواجهة', () => {
    expect(validateRecoveryPassphrase('قصير')).toMatch(/10 أحرف/)
    expect(validateRecoveryPassphrase('          ')).toMatch(/10 أحرف/)
    expect(validateRecoveryPassphrase(PASS)).toBeNull()
    expect(() => wrapDeviceKey(KEY, 'قصير', 'dev-1', FAST)).toThrow(/10 أحرف/)
  })

  it('مفتاح بطول غير 32 بايت لا يُغلَّف', () => {
    expect(() => wrapDeviceKey(Buffer.alloc(16), PASS, 'dev-1', FAST)).toThrow(/32 بايت/)
  })

  it('اسم الملف المقترح يحوي التاريخ وامتداد tkey', () => {
    expect(keyRecoveryFileName(new Date('2026-10-10T12:00:00Z'))).toBe('Tahakom-Key-Recovery-2026-10-10.tkey')
  })
})

/* ── الاستيراد: لا كتابة فوق المفتاح الحالي دون نسخة ── */
class FakeDisk {
  files = new Map<string, Buffer>()
  ops: string[] = []
  read(name: string) { this.ops.push(`read:${name}`); return this.files.get(name) ?? null }
  write(name: string, data: Buffer) { this.ops.push(`write:${name}`); this.files.set(name, Buffer.from(data)) }
  remove(name: string) { this.ops.push(`delete:${name}`); this.files.delete(name) }
}

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain: string) => Buffer.from(`ENC<${Buffer.from(plain, 'utf8').toString('hex')}>`, 'utf8'),
  decryptString: (encrypted: Buffer) => {
    const text = encrypted.toString('utf8')
    if (!text.startsWith('ENC<') || !text.endsWith('>')) throw new Error('صيغة غير مفهومة')
    return Buffer.from(text.slice(4, -1), 'hex').toString('utf8')
  },
})

const makeIo = (disk: FakeDisk, safeStorage: ReturnType<typeof fakeSafeStorage> | null, logs: string[] = [], failCopy = false) => ({
  readFile: (name: string) => disk.read(name),
  writeFile: (name: string, data: Buffer) => {
    if (failCopy && name.includes('.replaced-')) throw new Error('القرص ممتلئ')
    disk.write(name, data)
  },
  deleteFile: (name: string) => disk.remove(name),
  generate: () => Buffer.from(OTHER_KEY),
  safeStorage,
  log: (_tag: string, message: string) => { logs.push(message) },
})

describe('استيراد مفتاح الاسترداد (storeRecoveredDeviceKey)', () => {
  it('مفتاح حالي مختلف ⇒ نسخة مميزة بالبايتات الأصلية ثم المسترد مشفّراً', () => {
    const disk = new FakeDisk()
    const oldEnc = Buffer.from('ENC-OLD-PAYLOAD', 'utf8')
    disk.files.set(DEVICE_KEY_ENC_FILE, oldEnc)
    const logs: string[] = []
    const result = storeRecoveredDeviceKey(makeIo(disk, fakeSafeStorage(), logs), KEY)
    expect(result.ok).toBe(true)
    expect(result.keptCopy).toMatch(/^device\.key\.enc\.replaced-/)
    expect(disk.files.get(result.keptCopy!)!.equals(oldEnc)).toBe(true)
    // الاستيراد يكتب النسخة قبل الكتابة فوق الملف الأصلي
    expect(disk.ops.indexOf(`write:${result.keptCopy}`)).toBeLessThan(disk.ops.indexOf(`write:${DEVICE_KEY_ENC_FILE}`))
    expect(logs.join(' ')).toContain('استُرد مفتاح الجهاز')
  })

  it('المفتاح الحالي هو نفسه ⇒ لا كتابة ولا نسخة', () => {
    const disk = new FakeDisk()
    const io = makeIo(disk, fakeSafeStorage())
    storeRecoveredDeviceKey(io, KEY)
    disk.ops = []
    const result = storeRecoveredDeviceKey(io, KEY)
    expect(result).toEqual({ ok: true, reason: 'المفتاح الحالي مطابق', keptCopy: null })
    expect(disk.ops.some((op) => op.startsWith('write:'))).toBe(false)
  })

  it('لا safeStorage ⇒ رفض صريح ولا يُكتب شيء (لا تخزين صريح لمفتاح الاسترداد)', () => {
    const disk = new FakeDisk()
    const result = storeRecoveredDeviceKey(makeIo(disk, null), KEY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/safeStorage/)
    expect(disk.ops.some((op) => op.startsWith('write:'))).toBe(false)
    expect(disk.files.has(DEVICE_KEY_FILE)).toBe(false)
  })

  it('تعذّر حفظ النسخة الحالية ⇒ لا استبدال', () => {
    const disk = new FakeDisk()
    const oldEnc = Buffer.from('ENC-OLD-PAYLOAD', 'utf8')
    disk.files.set(DEVICE_KEY_ENC_FILE, oldEnc)
    const result = storeRecoveredDeviceKey(makeIo(disk, fakeSafeStorage(), [], true), KEY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/لم يُستبدل/)
    expect(disk.files.get(DEVICE_KEY_ENC_FILE)!.equals(oldEnc)).toBe(true)
  })

  it('مفتاح مسترد بطول خاطئ ⇒ مرفوض', () => {
    const disk = new FakeDisk()
    expect(storeRecoveredDeviceKey(makeIo(disk, fakeSafeStorage()), Buffer.alloc(8)).ok).toBe(false)
  })

  it('رحلة كاملة: تغليف ⇒ فك ⇒ استيراد على جهاز جديد ⇒ الإقلاع يقرأ المفتاح نفسه', () => {
    const file = wrapDeviceKey(KEY, PASS, 'dev-original', FAST)
    const recovered = unwrapDeviceKey(file, PASS)
    const disk = new FakeDisk() // جهاز جديد: لا مفتاح قديم
    const io = makeIo(disk, fakeSafeStorage())
    expect(storeRecoveredDeviceKey(io, recovered.key).ok).toBe(true)
    const boot = resolveDeviceKey(io)
    expect(boot.key.equals(KEY)).toBe(true)
    expect(boot.regenerated).toBe(false)
    expect(boot.storage).toBe('safeStorage')
  })
})
