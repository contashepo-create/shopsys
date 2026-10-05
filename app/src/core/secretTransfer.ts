/**
 * نقل سر التشفير بين الأجهزة (v1.0.15 — المرحلة ⑤ من قائمة المالك):
 * قاعدة البيانات مشفرة بسر هذا الجهاز (AES-256-GCM بمفتاح PBKDF2 من السر) —
 * نسخ ملف shopsys.db إلى جهاز آخر يعطي شفرة لا تُقرأ. هذه النواة تغلّف السر
 * نفسه بكلمة سر يختارها المالك (PBKDF2/SHA-256 بـ250 ألف دورة + AES-256-GCM
 * بملح عشوائي لكل ملف) في ملف صغير يُنقل مع القاعدة ويُستورد على الجهاز
 * الجديد فتصبح القاعدة مقروءة.
 *
 * الصدق الأمني: كلمة السر لا تُحفظ ولا تُرسل لأي جهة — من يملك الملف بلا
 * كلمة السر لا يملك شيئاً (GCM يرفض الفتح)، ومن يملك كلمة السر بلا الملف
 * كذلك. الملف بذاته يكشف فقط اسم المتجر وتاريخ الإنشاء.
 */
import { encryptText, decryptText, isEncrypted } from './security.ts'

export const KEY_FILE_FORMAT = 'tahakom-key'
export const KEY_FILE_VERSION = 1
/** دورات PBKDF2 لتغليف السر — أعلى من تشفير الجهاز (100k) لأن الملف يُنقل خارجياً */
const KDF_ITERATIONS = 250_000

function te(s: string): Uint8Array { return new TextEncoder().encode(s) }

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export interface SecretKeyFile {
  format: typeof KEY_FILE_FORMAT
  version: number
  createdAt: string
  shopName: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string }
  /** السر مغلفاً AES-256-GCM بمفتاح مشتق من كلمة السر والملح أعلاه (SSENC1.iv.ct) */
  payload: string
}

async function deriveKeyFromPassword(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** يبني ملف السر المغلف — يُستدعى بعد تأكيد كلمة السر في الواجهة */
export async function wrapSecretWithPassword(args: { secret: string; password: string; shopName: string; now?: string }): Promise<SecretKeyFile> {
  if (!args.password) throw new Error('كلمة السر مطلوبة')
  if (args.password.length < 6) throw new Error('كلمة السر قصيرة جداً — 6 أحرف على الأقل')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKeyFromPassword(args.password, salt, KDF_ITERATIONS)
  const payload = await encryptText(`tahakom-secret-v1:${args.secret}`, key)
  return {
    format: KEY_FILE_FORMAT,
    version: KEY_FILE_VERSION,
    createdAt: args.now ?? new Date().toISOString(),
    shopName: args.shopName.trim() || 'المتجر',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, saltB64: b64(salt) },
    payload,
  }
}

/** يفك ملف السر بكلمة سره — يرمي خطأ عربياً واضحاً عند كلمة السر الخاطئة أو الملف التالف */
export async function unwrapSecretWithPassword(file: SecretKeyFile, password: string): Promise<string> {
  if (file?.format !== KEY_FILE_FORMAT) throw new Error('هذا ليس ملف نسخة سر تَحَكَّم (.tkey)')
  if (file.version !== KEY_FILE_VERSION) throw new Error(`إصدار ملف السر غير مدعوم (${file.version})`)
  if (!isEncrypted(file.payload)) throw new Error('ملف السر تالف — الحمولة غير مشفرة')
  const salt = unb64(file.kdf.saltB64)
  const key = await deriveKeyFromPassword(password, salt, file.kdf.iterations || KDF_ITERATIONS)
  let plain: string
  try {
    plain = await decryptText(file.payload, key)
  } catch {
    throw new Error('كلمة السر غير صحيحة أو الملف تالف')
  }
  const prefix = 'tahakom-secret-v1:'
  if (!plain.startsWith(prefix)) throw new Error('ملف السر تالف — البادئة مفقودة')
  const secret = plain.slice(prefix.length)
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('ملف السر تالف — السر ليس بصيغة 256-بت')
  return secret
}

/** اسم ملف واضح: tahakom-key-بقالة-النور-2026-10-05.tkey.json */
export function keyFileName(shopName: string, nowIso: string): string {
  const safe = shopName.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || 'shopsys'
  return `tahakom-key-${safe}-${nowIso.slice(0, 10)}.tkey.json`
}

/** قراءة ملف السر من نص مع تحقق الصيغة قبل أي فك */
export function parseKeyFile(text: string): SecretKeyFile {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('الملف ليس JSON سليماً') }
  const f = parsed as Partial<SecretKeyFile>
  if (f?.format !== KEY_FILE_FORMAT || typeof f.payload !== 'string' || !f.kdf || typeof f.kdf.saltB64 !== 'string') {
    throw new Error('ملف السر لا يطابق صيغة تَحَكَّم (.tkey)')
  }
  return parsed as SecretKeyFile
}
