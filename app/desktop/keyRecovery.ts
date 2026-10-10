/**
 * استرداد مفتاح الجهاز (v1.0.22) — وحدة خالصة بلا Electron.
 *
 * المشكلة: كل لقطات البيانات مشفّرة بمفتاح الجهاز (AES-256-GCM) والمفتاح نفسه
 * مخزّن عبر safeStorage (DPAPI على Windows) ⇒ فقدانه (إعادة تثبيت Windows،
 * تغيّر ملف المستخدم، جهاز جديد) يجعل كل النسخ الاحتياطية غير قابلة للقراءة.
 *
 * الحل المعتمد (على نهج BitLocker Recovery Key): ملف استرداد يحمل المفتاح نفسه
 * مغلّفاً بكلمة مرور يختارها العميل. الملف آمن للحفظ على USB أو السحابة لأن
 * كلمة المرور لا تُخزَّن معه. المغلّف: PBKDF2-HMAC-SHA256 (600000 تكرار، توصية
 * OWASP) ⇒ مفتاح 256 بت ⇒ AES-256-GCM، مع ترويسة الملف مربوطة كبيانات مصادقة
 * (AAD) فأي تعديل في المعرّف أو التكرارات يُكشف عند الفك.
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

export const KEY_RECOVERY_FORMAT = 'tahakom-device-key-recovery'
export const KEY_RECOVERY_VERSION = 1
export const KEY_RECOVERY_ITERATIONS = 600_000
/** لا يُقبل ملف بتكرارات أقل — منع خفض القوة عبر ملف مُعدّ */
export const KEY_RECOVERY_MIN_ITERATIONS = 200_000
export const KEY_RECOVERY_MIN_PASSPHRASE = 10
const KEY_LENGTH = 32

export interface RecoveredDeviceKey {
  key: Buffer
  deviceId: string
  createdAt: string
}

/** رسالة عربية لكلمة المرور الضعيفة، أو null إن كانت مقبولة */
export function validateRecoveryPassphrase(passphrase: string): string | null {
  const normalized = passphrase.normalize('NFKC')
  if (normalized.trim().length < KEY_RECOVERY_MIN_PASSPHRASE) {
    return `كلمة المرور قصيرة — لا تقل عن ${KEY_RECOVERY_MIN_PASSPHRASE} أحرف`
  }
  return null
}

function deriveWrappingKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(passphrase.normalize('NFKC'), salt, iterations, KEY_LENGTH, 'sha256')
}

/** البيانات المصادَقة: كل ترويسة الملف ما عدا الحمولة نفسها */
function headerAad(header: { format: string; version: number; deviceId: string; createdAt: string; iterations: number }): Buffer {
  return Buffer.from(JSON.stringify([header.format, header.version, header.deviceId, header.createdAt, header.iterations]), 'utf8')
}

/**
 * يغلّف مفتاح الجهاز بكلمة المرور ويعيد نص الملف (JSON).
 * `options` للاختبار فقط (تقليل التكرارات لسرعة الاختبارات).
 */
export function wrapDeviceKey(
  key: Buffer,
  passphrase: string,
  deviceId: string,
  options: { iterations?: number; now?: Date } = {},
): string {
  if (key.length !== KEY_LENGTH) throw new Error(`المفتاح يجب أن يكون ${KEY_LENGTH} بايت لا ${key.length}`)
  const problem = validateRecoveryPassphrase(passphrase)
  if (problem) throw new Error(problem)
  const iterations = options.iterations ?? KEY_RECOVERY_ITERATIONS
  const header = {
    format: KEY_RECOVERY_FORMAT,
    version: KEY_RECOVERY_VERSION,
    deviceId,
    createdAt: (options.now ?? new Date()).toISOString(),
    iterations,
  }
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const wrapping = deriveWrappingKey(passphrase, salt, iterations)
  const cipher = createCipheriv('aes-256-gcm', wrapping, iv)
  cipher.setAAD(headerAad(header))
  const data = Buffer.concat([cipher.update(key), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${JSON.stringify({
    ...header,
    kdf: { name: 'PBKDF2-HMAC-SHA256', iterations, salt: salt.toString('base64') },
    cipher: { name: 'AES-256-GCM', iv: iv.toString('base64'), tag: tag.toString('base64') },
    data: data.toString('base64'),
  }, null, 2)}\n`
}

/**
 * يفكّ ملف الاسترداد. يرمي برسالة عربية واضحة عند: ملف غير صالح، إصدار غير
 * مدعوم، تكرارات مشبوهة، أو كلمة مرور خاطئة/ملف معدّل (تفشل المصادقة).
 */
export function unwrapDeviceKey(text: string, passphrase: string): RecoveredDeviceKey {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('ملف الاسترداد ليس بصيغة صالحة')
  }
  if (!parsed || parsed.format !== KEY_RECOVERY_FORMAT) throw new Error('هذا ليس ملف مفتاح استرداد تَحَكَّم')
  if (parsed.version !== KEY_RECOVERY_VERSION) throw new Error(`إصدار ملف الاسترداد ${parsed.version} غير مدعوم في هذا البرنامج`)
  const iterations = parsed.kdf?.iterations
  if (!Number.isInteger(iterations) || iterations < KEY_RECOVERY_MIN_ITERATIONS) throw new Error('إعدادات تشفير ملف الاسترداد غير آمنة أو تالفة')
  if (typeof parsed.deviceId !== 'string' || typeof parsed.createdAt !== 'string') throw new Error('ترويسة ملف الاسترداد تالفة')
  try {
    const salt = Buffer.from(parsed.kdf.salt, 'base64')
    const iv = Buffer.from(parsed.cipher.iv, 'base64')
    const tag = Buffer.from(parsed.cipher.tag, 'base64')
    const data = Buffer.from(parsed.data, 'base64')
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('حقول التشفير تالفة')
    const decipher = createDecipheriv('aes-256-gcm', deriveWrappingKey(passphrase, salt, iterations), iv)
    decipher.setAAD(headerAad({ format: parsed.format, version: parsed.version, deviceId: parsed.deviceId, createdAt: parsed.createdAt, iterations }))
    decipher.setAuthTag(tag)
    const key = Buffer.concat([decipher.update(data), decipher.final()])
    if (key.length !== KEY_LENGTH) throw new Error('طول المفتاح المستعاد غير صحيح')
    return { key, deviceId: parsed.deviceId, createdAt: parsed.createdAt }
  } catch (error) {
    if ((error as Error).message.includes('تالف') || (error as Error).message.includes('غير صحيح')) throw error
    throw new Error('كلمة المرور غير صحيحة، أو ملف الاسترداد معدَّل/تالف')
  }
}

/** اسم ملف مقترح بالتاريخ المحلي */
export function keyRecoveryFileName(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return `Tahakom-Key-Recovery-${day}.tkey`
}
