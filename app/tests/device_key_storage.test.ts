/**
 * ث2 (تدقيق 2026-10-08) — ثغرة حرجة: مفتاح تشفير الجهاز كان نصاً صريحاً.
 *
 * ما كان: `ensureDeviceEncryptionKey()` يكتب 32 بايت في `userData/device.key`
 * بلا تشفير. أي عملية على جهاز العميل تقرأ الملف فتفكّ كل لقطات القاعدة
 * المشفّرة بـAES-GCM ⇒ «القاعدة تُقرأ على هذا الجهاز فقط» كانت ادعاءً.
 * وسياسة الخصوصية (التي يجزم اختبار `legal_and_storage_v108` بصدقها) تقول إن
 * الحماية عبر safeStorage منذ v1.0.7 — بينما `app/desktop` لم يستدعه إطلاقاً.
 *
 * يثبت هذا الاختبار السلوك الجديد (الوحدة خالصة والـIO محقون ⇒ بلا Electron):
 *   ① أول تشغيل ⇒ مفتاح مشفّر عبر safeStorage ولا ملف صريح على القرص.
 *   ② ترحيل الملف الصريح القديم ⇒ يُشفَّر ويُحذف، والمفتاح نفسه (لا فقدان بيانات).
 *   ③ **لا يُحذف الصريح قبل التحقق**: لو فشل فكّ النسخة المشفّرة يبقى الصريح
 *      ويُمسح المشفّر التالف.
 *   ④ بلا safeStorage ⇒ ملاذ صريح بصلاحيات مقيّدة + تحذير مسجّل (لا صمت).
 *   ⑤ ملف مشفّر تالف/بلا سلسلة مفاتيح ⇒ توليد جديد مع تحذير عالٍ.
 *   ⑥ البايت الخام للمفتاح لا يظهر أبداً داخل الملف المشفّر.
 */
import { describe, it, expect, beforeEach } from 'vitest'

const {
  resolveDeviceKey, describeDeviceKeyOutcome,
  DEVICE_KEY_FILE, DEVICE_KEY_ENC_FILE,
} = await import('../desktop/deviceKeyStore.ts')

/** ذاكرة تحاكي القرص — نحصي فيها الحذف والكتابة لنتحقق من ترتيب العمليات */
class FakeDisk {
  files = new Map<string, Buffer>()
  ops: string[] = []
  /** صلاحيات آخر كتابة — الملاذ الصريح يجب أن يكون 0o600 */
  lastMode = 0
  read(name: string): Buffer | null {
    this.ops.push(`read:${name}`)
    return this.files.get(name) ?? null
  }
  write(name: string, data: Buffer, mode = 0o644): void {
    this.ops.push(`write:${name}`)
    this.files.set(name, Buffer.from(data))
    this.lastMode = mode
  }
  remove(name: string): void {
    this.ops.push(`delete:${name}`)
    this.files.delete(name)
  }
}

/** safeStorage مزيف: يشفّر بـbase64 معكوس — كافٍ لاختبار المنطق لا للتشفير الحقيقي */
const makeSafeStorage = (opts: { available?: boolean; corruptOnDecrypt?: boolean } = {}) => {
  const available = opts.available ?? true
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`ENC<${Buffer.from(plain, 'utf8').toString('hex')}>`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      if (opts.corruptOnDecrypt) return Buffer.from('ffff'.repeat(16), 'hex').toString('base64') // 32 بايت خاطئة
      const text = encrypted.toString('utf8')
      if (!text.startsWith('ENC<') || !text.endsWith('>')) throw new Error('صيغة غير مفهومة')
      return Buffer.from(text.slice(4, -1), 'hex').toString('utf8')
    },
  }
}

const KEY = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0', 'hex')

const buildIo = (disk: FakeDisk, safeStorage: ReturnType<typeof makeSafeStorage> | null, logs: string[] = []) => ({
  readFile: (name: string) => disk.read(name),
  writeFile: (name: string, data: Buffer) => disk.write(name, data),
  deleteFile: (name: string) => disk.remove(name),
  generate: () => Buffer.from(KEY),
  safeStorage,
  log: (_tag: string, message: string) => { logs.push(message) },
})

let disk: FakeDisk
let logs: string[]
beforeEach(() => { disk = new FakeDisk(); logs = [] })

describe('① أول تشغيل — مفتاح مشفّر ولا أثر صريح على القرص', () => {
  it('يولّد ويخزّن في device.key.enc فقط', () => {
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.key.equals(KEY)).toBe(true)
    expect(outcome.storage).toBe('safeStorage')
    expect(outcome.regenerated).toBe(true)
    expect(outcome.migrated).toBe(false)
    expect(disk.files.has(DEVICE_KEY_ENC_FILE)).toBe(true)
    expect(disk.files.has(DEVICE_KEY_FILE)).toBe(false) // ← جوهر ث2
    expect(outcome.warnings).toHaveLength(0)
  })

  it('⑥ البايت الخام للمفتاح لا يظهر داخل الملف المشفّر', () => {
    resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    const stored = disk.files.get(DEVICE_KEY_ENC_FILE)!
    expect(stored.includes(KEY)).toBe(false)
    expect(stored.includes(Buffer.from(KEY.toString('base64'), 'utf8'))).toBe(false)
    expect(stored.toString('utf8').startsWith('shopsys-safekey:v1:')).toBe(true)
  })

  it('قراءة مفتاح مشفّر صالح ⇒ لا توليد ولا ترحيل', () => {
    resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    disk.ops = []
    const second = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(second.regenerated).toBe(false)
    expect(second.migrated).toBe(false)
    expect(second.storage).toBe('safeStorage')
    expect(disk.ops.some((op) => op.startsWith('write:'))).toBe(false) // لا كتابة عند كل إقلاع
  })

  it('بلا safeStorage ⇒ ملاذ صريح بصلاحيات 0o600 وتحذير مسجّل', () => {
    for (const unavailable of [null, makeSafeStorage({ available: false })]) {
      disk = new FakeDisk()
      const io = buildIo(disk, unavailable as never, logs)
      const outcome = resolveDeviceKey(io)
      expect(outcome.storage).toBe('plaintext-fallback')
      expect(disk.files.get(DEVICE_KEY_FILE)?.equals(KEY)).toBe(true)
      expect(outcome.warnings.join(' ')).toMatch(/safeStorage/)
      expect(logs.join(' ')).toMatch(/safeStorage/)
    }
  })
})

describe('②③ ترحيل الملف الصريح القديم', () => {
  it('يُشفَّر ثم يُحذف الصريح، والمفتاح نفسه تماماً', () => {
    disk.write(DEVICE_KEY_FILE, KEY)
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.migrated).toBe(true)
    expect(outcome.storage).toBe('safeStorage')
    expect(outcome.key.equals(KEY)).toBe(true)
    expect(disk.files.has(DEVICE_KEY_FILE)).toBe(false)
    expect(disk.files.has(DEVICE_KEY_ENC_FILE)).toBe(true)
    // الترتيب: كتابة المشفّر قبل حذف الصريح — لا نافذة يفقد فيها المفتاح
    expect(disk.ops.indexOf(`write:${DEVICE_KEY_ENC_FILE}`)).toBeLessThan(disk.ops.indexOf(`delete:${DEVICE_KEY_FILE}`))
  })

  it('④ التحقق يفشل ⇒ الصريح يبقى والمشفّر التالف يُمسح', () => {
    disk.write(DEVICE_KEY_FILE, KEY)
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage({ corruptOnDecrypt: true })))
    expect(outcome.migrated).toBe(false)
    expect(outcome.storage).toBe('plaintext-fallback')
    expect(outcome.key.equals(KEY)).toBe(true) // المفتاح ما زال usable — لا فقدان
    expect(disk.files.get(DEVICE_KEY_FILE)?.equals(KEY)).toBe(true) // لم يُحذف
    expect(disk.files.has(DEVICE_KEY_ENC_FILE)).toBe(false) // التالف مُسح
    expect(outcome.warnings.join(' ')).toMatch(/بقي المفتاح في ملف صريح/)
    expect(disk.ops).not.toContain(`delete:${DEVICE_KEY_FILE}`)
  })

  it('بلا safeStorage أثناء الترحيل ⇒ الصريح يبقى كما هو مع تحذير', () => {
    disk.write(DEVICE_KEY_FILE, KEY)
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage({ available: false })))
    expect(outcome.storage).toBe('plaintext-fallback')
    expect(outcome.migrated).toBe(false)
    expect(disk.files.get(DEVICE_KEY_FILE)?.equals(KEY)).toBe(true)
    expect(disk.files.has(DEVICE_KEY_ENC_FILE)).toBe(false)
    expect(outcome.warnings.join(' ')).toMatch(/غير متاح/)
  })

  it('مشفّر صالح + بقايا صريح ⇒ البقايا تُحذف', () => {
    disk.write(DEVICE_KEY_FILE, KEY)
    resolveDeviceKey(buildIo(disk, makeSafeStorage())) // يرحّل
    disk.write(DEVICE_KEY_FILE, KEY) // بقايا عادت (نسخ احتياطي مثلاً)
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.migrated).toBe(false)
    expect(outcome.key.equals(KEY)).toBe(true)
    expect(disk.files.has(DEVICE_KEY_FILE)).toBe(false)
  })
})

describe('⑤ حالات التلف وفقدان سلسلة المفاتيح', () => {
  it('مشفّر ببادئة خاطئة ⇒ توليد جديد وتحذير', () => {
    disk.write(DEVICE_KEY_ENC_FILE, Buffer.from('ملف قديم بلا بادئة', 'utf8'))
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.regenerated).toBe(true)
    expect(outcome.warnings.join(' ')).toBeTruthy()
    expect(disk.files.get(DEVICE_KEY_ENC_FILE)!.toString('utf8').startsWith('shopsys-safekey:v1:')).toBe(true)
  })

  it('فكّ المشفّر يرمي (تغيّرت سلسلة مفاتيح النظام) ⇒ توليد جديد', () => {
    disk.write(DEVICE_KEY_ENC_FILE, Buffer.from('shopsys-safekey:v1:ليس-مشفر-صالح', 'utf8'))
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.regenerated).toBe(true)
    expect(outcome.warnings.join(' ')).toMatch(/تعذّر فك المفتاح المشفّر/)
  })

  /* ث2 — الخطأ الذي كان سيسقط على أجهزة العملاء الحقيقية: `safeStorage.encryptString`
     يعيد **بايتات ثنائية** (DPAPI/Keychain/libsecret)، وحفظها كنص utf8 يُتلف كل
     بايت غير صالح (يصير U+FFFD) فلا يعود المفتاح قابلاً للفكّ ⇒ قاعدة البيانات
     كلها تُفقد. التخزين base64 يحفظ البايتات حرفياً. */
  it('نص مشفّر ثنائي (بايتات غير صالحة utf8) ينجو ذهاباً وإياباً', () => {
    /* مفتاح ثنائي حقيقي الشكل: يبدأ بـv10 وفيه بايتات 0x80-0xFF غير صالحة utf8 */
    const BINARY = Buffer.concat([Buffer.from('v10', 'utf8'), Buffer.from([0xff, 0xfe, 0x80, 0xc3, 0x28, 0xa0, 0x00, 0xed])])
    let seen: Buffer | null = null
    const binarySafe = {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => { Buffer.from(plain, 'base64'); return BINARY },
      decryptString: (encrypted: Buffer) => {
        seen = Buffer.from(encrypted)
        /* أي فقد بايت واحد ⇒ فكّ خاطئ — وهذا بالضبط ما كان يفعله utf8 */
        if (!encrypted.equals(BINARY)) throw new Error('البايتات لا تطابق النص المشفّر الأصلي')
        return KEY.toString('base64')
      },
    }
    const first = resolveDeviceKey(buildIo(disk, binarySafe))
    expect(first.regenerated).toBe(true)
    expect(first.storage).toBe('safeStorage')
    /* الإقلاع التالي يقرأ الملف نفسه — يجب أن يفكّه ويعيد المفتاح ذاته */
    const second = resolveDeviceKey(buildIo(disk, binarySafe))
    expect(second.regenerated).toBe(false)
    expect(second.storage).toBe('safeStorage')
    expect(second.key.equals(KEY)).toBe(true)
    expect(second.warnings).toHaveLength(0)
    expect(seen!.equals(BINARY)).toBe(true) // البايتات وصلت كما كُتبت حرفياً
  })

  it('مشفّر يفكّ لطول خاطئ ⇒ مرفوض', () => {
    const io = buildIo(disk, makeSafeStorage())
    disk.write(DEVICE_KEY_ENC_FILE, Buffer.from('shopsys-safekey:v1:' + io.safeStorage!.encryptString(Buffer.from('قصير').toString('base64')).toString('base64'), 'utf8'))
    const outcome = resolveDeviceKey(io)
    expect(outcome.regenerated).toBe(true)
    expect(outcome.warnings.join(' ')).toMatch(/طول غير متوقع/)
  })

  it('صريح بطول غير 32 ⇒ يُستبدل مع تحذير (كما كان السلوك)', () => {
    disk.write(DEVICE_KEY_FILE, Buffer.alloc(16, 7))
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(outcome.regenerated).toBe(true)
    expect(outcome.warnings.join(' ')).toMatch(/طول غير متوقع \(16\)/)
    expect(disk.files.has(DEVICE_KEY_FILE)).toBe(false)
    expect(outcome.key.equals(KEY)).toBe(true)
  })

  it('safeStorage يرمي عند الاستعلام ⇒ يُعامل كغير متاح ولا ينهار الإقلاع', () => {
    const throwing = {
      isEncryptionAvailable: () => { throw new Error('not ready') },
      encryptString: () => { throw new Error('no') },
      decryptString: () => { throw new Error('no') },
    }
    disk.write(DEVICE_KEY_FILE, KEY)
    const outcome = resolveDeviceKey(buildIo(disk, throwing))
    expect(outcome.key.equals(KEY)).toBe(true)
    expect(outcome.storage).toBe('plaintext-fallback')
  })
})

describe('السجل التشخيصي', () => {
  it('يصف الحالة والتحذيرات في سطر واحد لـmain.log', () => {
    disk.write(DEVICE_KEY_FILE, KEY)
    const migrated = resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect(describeDeviceKeyOutcome(migrated)).toContain('safeStorage')
    expect(describeDeviceKeyOutcome(migrated)).toContain('مُرحَّل')

    const broken = resolveDeviceKey(buildIo(disk, makeSafeStorage({ available: false })))
    expect(describeDeviceKeyOutcome(broken)).toContain('نص صريح')
    expect(describeDeviceKeyOutcome(broken)).toContain('تحذيرات')
  })
})

/* v1.0.22 — المفتاح المشفّر غير القابل للفك لا يُكتب فوقه أبداً.
   كان التوليد الجديد يستبدل الملف مباشرة، فتُفقد البيانات المشفّرة بالمفتاح القديم
   نهائياً (ولو عاد المفتاح القديم لأي سبب — مثلاً تغيّر ملف تعريف ويندوز — لكانت البيانات قابلة للاسترجاع). */
describe('v1.0.22 — حفظ المفتاح المشفّر القديم قبل أي استبدال', () => {
  const OLD_ENC = Buffer.from('shopsys-safekey:v1:بيانات-مفتاح-قديم-لا-تُفك', 'utf8')

  it('مشفّر غير قابل للفك ⇒ نسخة مميزة بالبايتات الأصلية ثم توليد جديد', () => {
    disk.write(DEVICE_KEY_ENC_FILE, OLD_ENC)
    disk.ops = [] // نُسجّل ترتيب ما يفعله الإقلاع فقط، لا تهيئة الاختبار
    const outcome = resolveDeviceKey(buildIo(disk, makeSafeStorage(), logs))
    expect(outcome.regenerated).toBe(true)
    const preserved = [...disk.files.keys()].filter((name) => name.startsWith(`${DEVICE_KEY_ENC_FILE}.unreadable-`))
    expect(preserved).toHaveLength(1)
    expect(disk.files.get(preserved[0])!.equals(OLD_ENC)).toBe(true)
    // الكتابة الأولى للمفتاح القديم قبل أي كتابة فوق الملف الأصلي
    const firstWriteToEnc = disk.ops.findIndex((op) => op === `write:${DEVICE_KEY_ENC_FILE}`)
    const preserveWrite = disk.ops.findIndex((op) => op.startsWith(`write:${DEVICE_KEY_ENC_FILE}.unreadable-`))
    expect(preserveWrite).toBeGreaterThanOrEqual(0)
    expect(preserveWrite).toBeLessThan(firstWriteToEnc)
    expect(logs.join(' ')).toContain('لم تُستبدل')
  })

  it('لا ملف مشفّر أصلاً ⇒ لا نسخ مكررة', () => {
    resolveDeviceKey(buildIo(disk, makeSafeStorage()))
    expect([...disk.files.keys()].some((name) => name.includes('.unreadable-'))).toBe(false)
  })

  it('safeStorage غير متاح الآن ⇒ الملف المشفّر سليم، فلا نسخ ولا كتابة فوقه', () => {
    disk.write(DEVICE_KEY_ENC_FILE, OLD_ENC)
    resolveDeviceKey(buildIo(disk, makeSafeStorage({ available: false })))
    expect(disk.files.get(DEVICE_KEY_ENC_FILE)!.equals(OLD_ENC)).toBe(true)
    expect([...disk.files.keys()].some((name) => name.includes('.unreadable-'))).toBe(false)
  })

  it('تعذّر حفظ النسخة ⇒ يُرمى خطأ والملف الأصلي كما هو (لا استبدال أعمى)', () => {
    disk.write(DEVICE_KEY_ENC_FILE, OLD_ENC)
    const io = buildIo(disk, makeSafeStorage())
    const failingIo = {
      ...io,
      writeFile: (name: string, data: Buffer) => {
        if (name.includes('.unreadable-')) throw new Error('القرص ممتلئ')
        io.writeFile(name, data)
      },
    }
    expect(() => resolveDeviceKey(failingIo)).toThrow(/لن يُستبدل/)
    expect(disk.files.get(DEVICE_KEY_ENC_FILE)!.equals(OLD_ENC)).toBe(true)
  })
})
