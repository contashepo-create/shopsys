/**
 * تخزين مشفر لقاعدة البيانات (القرار 28):
 * كل ما يكتبه zustand persist لقاعدة بيانات المتجر يمر عبر AES-256-GCM.
 * - أول تشغيل يولّد سراً عشوائياً 256-بت يُشتق منه مفتاح PBKDF2.
 * - بيانات قديمة غير مشفرة تُقرأ كما هي وتُشفَّر عند أول حفظ (ترحيل صامت).
 * - في نسخة Electron ينتقل السر إلى مخزن مفاتيح النظام (safeStorage)
 *   فيصبح ملف القاعدة المسروق بلا فائدة على أي جهاز آخر.
 */
import type { StateStorage } from 'zustand/middleware'
import { deriveKey, encryptText, decryptText, isEncrypted } from '../core/security.ts'

const SECRET_KEY = 'shopsys-k'

function getOrCreateSecret(): string {
  let s = localStorage.getItem(SECRET_KEY)
  if (!s) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(SECRET_KEY, s)
  }
  return s
}

let keyPromise: Promise<CryptoKey> | null = null
function key(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = deriveKey(getOrCreateSecret())
  return keyPromise
}

export const secureStorage: StateStorage = {
  getItem: async (name) => {
    const raw = localStorage.getItem(name)
    if (raw == null) return null
    if (!isEncrypted(raw)) return raw // ترحيل: بيانات قبل التشفير تُقبل ثم تشفَّر عند أول حفظ
    try {
      return await decryptText(raw, await key())
    } catch {
      // مفتاح خطأ (قاعدة منسوخة من جهاز آخر) أو شفرة تالفة — لا بيانات
      return null
    }
  },
  setItem: async (name, value) => {
    localStorage.setItem(name, await encryptText(value, await key()))
  },
  removeItem: async (name) => {
    localStorage.removeItem(name)
  },
}

/** تشفير نص عابر (لقطات النسخ الاحتياطي بالساعة) بنفس مفتاح الجهاز */
export async function encryptForDevice(plain: string): Promise<string> {
  return encryptText(plain, await key())
}
export async function decryptForDevice(stored: string): Promise<string | null> {
  if (!isEncrypted(stored)) return stored
  try {
    return await decryptText(stored, await key())
  } catch {
    return null
  }
}
