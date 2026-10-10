/**
 * مخزن مفتاح تشفير الجهاز — ث2 من تدقيق 2026-10-08 (ثغرة حرجة).
 * ─────────────────────────────────────────────────────────────────
 * ما كان: `ensureDeviceEncryptionKey()` في main.ts يكتب 32 بايت **نصاً صريحاً**
 * في `userData/device.key`. أي برنامج على الجهاز (أو أي شخص ينسخ المجلد) يقرأ
 * المفتاح فيفكّ كل لقطات القاعدة المشفّرة بـAES-GCM — أي أن «التشفير بمفتاح
 * الجهاز» كان حماية شكلية. والأسوأ: سياسة الخصوصية واختبار
 * `legal_and_storage_v108` يجزمان بأن الحماية عبر safeStorage منذ v1.0.7،
 * بينما `app/desktop` لا يستدعي safeStorage إطلاقاً (المصادفة أن الغلاف القديم
 * `desktop/main.cjs` غير المُعبّأ هو الذي كان يستخدمه).
 *
 * ما صار: المفتاح يُخزَّن مشفّراً بمفتاح نظام التشغيل (DPAPI على ويندوز،
 * Keychain على ماك، libsecret على لينكس) في `device.key.enc`، ولا يبقى الملف
 * الصريح إلا حين يكون safeStorage غير متاح فعلاً (لينكس بلا سلسلة مفاتيح) —
 * وحينها يُسجَّل تحذير صريح في main.log.
 *
 * قواعد الترحيل (لا تُكسر):
 *   ① لا يُحذف الملف الصريح **قبل** فكّ النسخة المشفّرة والتحقق منها بايت‑ببايت.
 *      لو فشل التحقق يبقى الصريح ويُمسح المشفّر التالف — لا فقدان بيانات.
 *   ② لو تعذّر فكّ المشفّر ولا ملف صريح ⇒ توليد مفتاح جديد مع تحذير عالٍ
 *      (اللقطات القديمة تصير غير قابلة للفك — وهذا هو السلوك الوحيد الممكن).
 *   ③ الملف الصريح القديم بطول غير 32 ⇒ يُعامل كغير موجود (كما كان).
 *
 * الوحدة **خالصة**: كل الـIO محقون، فتُختبر في vitest بلا Electron وبلا لمس قرص.
 */

export const DEVICE_KEY_FILE = 'device.key'
export const DEVICE_KEY_ENC_FILE = 'device.key.enc'
/**
 * بادئة تميّز الملف المشفّر عن أي بقايا قديمة — بلاها قد يُفكّ ملف خاطئ.
 * ما بعد البادئة هو **base64** للنص المشفّر (لا utf8): `safeStorage.encryptString`
 * يعيد بايتات ثنائية (DPAPI/Keychain/libsecret)، وتحويلها إلى نص utf8 **يُتلفها** —
 * أي بايت غير صالح يصير U+FFFD فلا يعود المفتاح قابلاً للفكّ (ضياع بيانات العميل).
 */
const ENC_MAGIC = 'shopsys-safekey:v1:'
const KEY_LENGTH = 32

/** الجزء من Electron safeStorage الذي نستخدمه (يُحقن في الاختبار) */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface DeviceKeyIo {
  /** يعيد المحتوى أو null إن لم يوجد الملف */
  readFile: (name: string) => Buffer | null
  writeFile: (name: string, data: Buffer) => void
  deleteFile: (name: string) => void
  /** 32 بايت عشوائية آمنة */
  generate: () => Buffer
  safeStorage: SafeStorageLike | null
  log: (tag: string, message: string) => void
}

export type DeviceKeyStorage = 'safeStorage' | 'plaintext-fallback'

export interface DeviceKeyOutcome {
  key: Buffer
  /** أين استقر المفتاح بعد هذه العملية */
  storage: DeviceKeyStorage
  /** هل رُحّل ملف صريح قديم إلى التخزين المشفّر؟ */
  migrated: boolean
  /** هل وُلّد مفتاح جديد (أول تشغيل، أو مفتاح تالف/ضائع)؟ */
  regenerated: boolean
  /** تحذيرات تُكتب في main.log — الدعم الفني يقرأها من جهاز العميل */
  warnings: string[]
}

const b64 = (buf: Buffer): string => buf.toString('base64')

function safeAvailable(io: DeviceKeyIo): boolean {
  try {
    return Boolean(io.safeStorage?.isEncryptionAvailable())
  } catch {
    return false
  }
}

/**
 * فكّ ملف `device.key.enc` — يعيد المفتاح أو null (تالف/بلا safeStorage).
 * لا يرمي استثناءً أبداً: فشل الفك حالة متوقعة (تغيّر سلسلة مفاتيح النظام).
 */
function readEncryptedKey(io: DeviceKeyIo): { key: Buffer | null; reason: string } {
  const raw = io.readFile(DEVICE_KEY_ENC_FILE)
  if (!raw) return { key: null, reason: 'missing' }
  const text = raw.toString('utf8')
  if (!text.startsWith(ENC_MAGIC)) return { key: null, reason: 'bad-magic' }
  const cipherB64 = text.slice(ENC_MAGIC.length).trim()
  if (!cipherB64) return { key: null, reason: 'ملف المفتاح المشفّر فارغ' }
  if (!safeAvailable(io)) return { key: null, reason: 'safeStorage غير متاح لفك المفتاح المشفّر' }
  try {
    const decrypted = io.safeStorage!.decryptString(Buffer.from(cipherB64, 'base64'))
    const key = Buffer.from(decrypted, 'base64')
    if (key.length !== KEY_LENGTH) return { key: null, reason: `مفتاح مشفّر بطول غير متوقع (${key.length})` }
    return { key, reason: '' }
  } catch (err) {
    return { key: null, reason: `تعذّر فك المفتاح المشفّر: ${(err as Error).message}` }
  }
}

/**
 * تشفير مفتاح وحفظه مع **تحقق من الجولة الكاملة** (قاعدة ①):
 * يُقرأ الملف المكتوب ويُفكّ ويُقارن بالبايت — لا يُعتمد قبل ذلك.
 */
function writeEncryptedKey(io: DeviceKeyIo, key: Buffer): { ok: boolean; reason: string } {
  if (!safeAvailable(io)) return { ok: false, reason: 'safeStorage غير متاح على هذا النظام' }
  try {
    /* base64 لا utf8: النص المشفّر بايتات ثنائية، وutf8 يُتلفها (انظر ENC_MAGIC) */
    const cipher = io.safeStorage!.encryptString(b64(key)).toString('base64')
    if (!cipher) return { ok: false, reason: 'التشفير أعاد نصاً فارغاً' }
    io.writeFile(DEVICE_KEY_ENC_FILE, Buffer.from(ENC_MAGIC + cipher, 'utf8'))
  } catch (err) {
    return { ok: false, reason: `فشل التشفير: ${(err as Error).message}` }
  }
  // التحقق: ما كُتب للتو يُفكّ ويعطي المفتاح نفسه حرفياً
  const verify = readEncryptedKey(io)
  if (!verify.key || !verify.key.equals(key)) {
    try { io.deleteFile(DEVICE_KEY_ENC_FILE) } catch { /* يُترك ليُستبدل لاحقاً */ }
    return { ok: false, reason: verify.reason || 'التحقق من الجولة الكاملة فشل' }
  }
  return { ok: true, reason: '' }
}

/** كتابة المفتاح نصاً صريحاً — الملاذ الأخير فقط (بلا safeStorage) */
function writePlaintextKey(io: DeviceKeyIo, key: Buffer): void {
  io.writeFile(DEVICE_KEY_FILE, key)
}

/**
 * v1.0.22: ملف مشفّر موجود لكنه غير قابل للفك (تغيّر ملف تعريف ويندوز، أو ترحيل
 * جهاز، أو عطب) — **لا يُكتب فوقه أبداً**. كان الكتب فوقه يُتلف المفتاح الوحيد
 * الذي تُفك به البيانات المشفّرة. يُحفظ نسخة مميزة بالوقت بجانبه لاسترجاعه يدوياً،
 * وإن تعذّر حفظ النسخة نفسها يُرمى خطأ فيبقى الملف الأصلي كما هو.
 */
export function preserveUnreadableEncryptedKey(io: DeviceKeyIo, reason: string): string | null {
  const raw = io.readFile(DEVICE_KEY_ENC_FILE)
  if (!raw) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${DEVICE_KEY_ENC_FILE}.unreadable-${stamp}`
  try {
    io.writeFile(name, raw)
  } catch (err) {
    throw new Error(`تعذّر حفظ نسخة من المفتاح المشفّر غير القابل للفك (${reason}) — لن يُستبدل: ${(err as Error).message}`)
  }
  io.log('device-key', `مفتاح مشفّر غير قابل للفك (${reason}) — حُفظت نسخة باسم ${name} ولم تُستبدل`)
  return name
}

/**
 * v1.0.22 — استرداد المفتاح من ملف الاسترداد (طلب المالك: لا فقدان للبيانات).
 * يُستدعى بعد فكّ ملف الاسترداد بكلمة المرور وقبل إعادة التشغيل:
 *  • إن كان المفتاح الحالي هو نفسه ⇒ لا شيء يُكتب.
 *  • وإلا تُحفظ نسخة من المشفّر الحالي باسم مميّز (لا حذف) ثم يُكتب المسترد
 *    مشفّراً عبر safeStorage مع التحقق بالجولة الكاملة.
 * لا يُسمح بالتخزين الصريح هنا: مفتاح الاسترداد أهم من أن يُكتب نصاً على القرص.
 */
export function storeRecoveredDeviceKey(io: DeviceKeyIo, key: Buffer): { ok: boolean; reason: string; keptCopy: string | null } {
  if (key.length !== KEY_LENGTH) return { ok: false, reason: `طول المفتاح المسترد غير صالح (${key.length})`, keptCopy: null }
  if (!safeAvailable(io)) return { ok: false, reason: 'هذا النظام لا يوفّر تخزيناً آمناً للمفتاح (safeStorage غير متاح)', keptCopy: null }
  const current = readEncryptedKey(io)
  if (current.key && current.key.equals(key)) return { ok: true, reason: 'المفتاح الحالي مطابق', keptCopy: null }
  let keptCopy: string | null = null
  const raw = io.readFile(DEVICE_KEY_ENC_FILE)
  if (raw) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    keptCopy = `${DEVICE_KEY_ENC_FILE}.replaced-${stamp}`
    try {
      io.writeFile(keptCopy, raw)
    } catch (err) {
      return { ok: false, reason: `تعذّر حفظ نسخة من المفتاح الحالي — لم يُستبدل: ${(err as Error).message}`, keptCopy: null }
    }
  }
  const written = writeEncryptedKey(io, key)
  if (!written.ok) return { ok: false, reason: `تعذّر حفظ المفتاح المسترد: ${written.reason}`, keptCopy }
  io.log('device-key', `استُرد مفتاح الجهاز من ملف الاسترداد${keptCopy ? ` — النسخة السابقة: ${keptCopy}` : ''}`)
  return { ok: true, reason: 'تم', keptCopy }
}

export function resolveDeviceKey(io: DeviceKeyIo): DeviceKeyOutcome {
  const warnings: string[] = []

  /* ① الملف المشفّر أولاً — هو الشكل المعتمد من الآن */
  const enc = readEncryptedKey(io)
  if (enc.key) {
    /* لو وُجد ملف صريح بجانبه فهو بقايا ترحيل سابق ⇒ يُحذف بعد التأكد
       أن المشفّر صالح (وهو كذلك هنا — فُكّ للتو). */
    if (io.readFile(DEVICE_KEY_FILE)) {
      try {
        io.deleteFile(DEVICE_KEY_FILE)
        io.log('device-key', 'حُذف ملف المفتاح الصريح بعد اعتماد النسخة المشفّرة')
      } catch (err) {
        warnings.push(`تعذّر حذف ملف المفتاح الصريح: ${(err as Error).message}`)
      }
    }
    return { key: enc.key, storage: 'safeStorage', migrated: false, regenerated: false, warnings }
  }
  if (enc.reason && enc.reason !== 'missing') {
    warnings.push(enc.reason)
    /* لا كتابة فوق مفتاح مشفّر غير قابل للفك — يُحفظ جانباً أولاً (انظر الدالة).
       إن كان safeStorage نفسه غير متاح فالملف سليم وإنما لم نستطع فكّه الآن ⇒ لا نسخ مكررة. */
    if (safeAvailable(io)) {
      const kept = preserveUnreadableEncryptedKey(io, enc.reason)
      if (kept) warnings.push(`حُفظ المفتاح المشفّر القديم باسم ${kept}`)
    }
  }

  /* ② ملف صريح قديم ⇒ ترحيل إلى المشفّر إن أمكن (بلا حذف قبل التحقق) */
  const plain = io.readFile(DEVICE_KEY_FILE)
  if (plain && plain.length === KEY_LENGTH) {
    if (safeAvailable(io)) {
      const written = writeEncryptedKey(io, plain)
      if (written.ok) {
        /* القاعدة ①: الحذف بعد نجاح الفكّ والتحقق فقط. وفشل الحذف نفسه لا يُسقط
           الإقلاع (صلاحية/قفل ملف) — المفتاح معتمد من النسخة المشفّرة، والبقايا
           الصريحة تُحذف في الإقلاع التالي عبر المسار ①. */
        try {
          io.deleteFile(DEVICE_KEY_FILE)
          io.log('device-key', 'رُحّل مفتاح الجهاز من ملف صريح إلى safeStorage')
        } catch (err) {
          warnings.push(`رُحّل المفتاح لكن تعذّر حذف الملف الصريح: ${(err as Error).message}`)
        }
        return { key: plain, storage: 'safeStorage', migrated: true, regenerated: false, warnings }
      }
      warnings.push(`بقي المفتاح في ملف صريح — ${written.reason}`)
      return { key: plain, storage: 'plaintext-fallback', migrated: false, regenerated: false, warnings }
    }
    warnings.push('safeStorage غير متاح — المفتاح باقٍ نصاً صريحاً (لينكس بلا سلسلة مفاتيح؟)')
    return { key: plain, storage: 'plaintext-fallback', migrated: false, regenerated: false, warnings }
  }
  if (plain) warnings.push(`ملف مفتاح صريح بطول غير متوقع (${plain.length}) — سيُستبدل`)

  /* ③ لا مفتاح صالح ⇒ توليد جديد */
  const key = io.generate()
  if (key.length !== KEY_LENGTH) throw new Error(`مولّد المفاتيح أعاد ${key.length} بايت بدلاً من ${KEY_LENGTH}`)
  const written = writeEncryptedKey(io, key)
  if (written.ok) {
    /* لو كان هناك ملف صريح تالف فهو لم يعد صالحاً لأي بيانات — يُحذف */
    if (plain) {
      try { io.deleteFile(DEVICE_KEY_FILE) } catch { /* غير حرج */ }
    }
    io.log('device-key', 'وُلّد مفتاح تشفير الجهاز وحُفظ مشفّراً عبر safeStorage')
    return { key, storage: 'safeStorage', migrated: false, regenerated: true, warnings }
  }
  writePlaintextKey(io, key)
  warnings.push(`تعذّر التشفير عبر safeStorage — حُفظ المفتاح نصاً صريحاً بصلاحيات مقيّدة (${written.reason})`)
  io.log('device-key', 'وُلّد مفتاح تشفير الجهاز (ملاذ صريح — safeStorage غير متاح)')
  return { key, storage: 'plaintext-fallback', migrated: false, regenerated: true, warnings }
}

/**
 * سلسلة سجل عربية جاهزة للكتابة في main.log — تُبقي الدعم الفني قادراً على
 * تشخيص حالة مفتاح العميل من ملف واحد.
 */
export function describeDeviceKeyOutcome(outcome: DeviceKeyOutcome): string {
  const shape = outcome.storage === 'safeStorage' ? 'مشفّر عبر safeStorage' : 'نص صريح (ملاذ)'
  const how = outcome.migrated ? 'مُرحَّل من ملف صريح' : outcome.regenerated ? 'مُولَّد حديثاً' : 'مقروء من التخزين'
  return `${shape} · ${how}${outcome.warnings.length ? ` · تحذيرات: ${outcome.warnings.join(' | ')}` : ''}`
}
