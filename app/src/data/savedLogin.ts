/**
 * بيانات الدخول المحفوظة (طلب المالك: «عرض حفظ بيانات الدخول») —
 * تُخزَّن مشفرة بمفتاح الجهاز عبر secureStorage، لا نص صريح أبداً.
 *
 * مصدر واحد للمفتاح والقراءة والكتابة كي تحدَّث كلمة السر المحفوظة من أي
 * شاشة تغيّرها (الدخول/حسابي/الصلاحيات) — وإلا امتلأت الشاشة تلقائياً برقم
 * قديم فيفشل الدخول ويحترق عدّاد محاولات القفل بلا ذنب.
 */
import { encryptForDevice, decryptForDevice } from './secureStorage.ts'

export const SAVED_LOGIN_KEY = 'tahakam-saved-login'

export type SavedLogin = { identifier?: string; pin?: string }

export async function loadSavedLogin(): Promise<SavedLogin | null> {
  const stored = localStorage.getItem(SAVED_LOGIN_KEY)
  if (!stored) return null
  const plain = await decryptForDevice(stored)
  if (!plain) return null
  try {
    return JSON.parse(plain) as SavedLogin
  } catch {
    return null // بيانات تالفة — تجاهل
  }
}

export async function storeSavedLogin(identifier: string, pin: string): Promise<void> {
  localStorage.setItem(SAVED_LOGIN_KEY, await encryptForDevice(JSON.stringify({ identifier, pin })))
}

export function clearSavedLogin(): void {
  localStorage.removeItem(SAVED_LOGIN_KEY)
}

/**
 * بعد تغيير كلمة السر من أي شاشة: إن كانت المحفوظة على هذا الجهاز تخص نفس
 * صاحب التغيير (يقرره النداء عبر identifierMatches) تُحدَّث بكلمته الجديدة —
 * وإلا تُترك كما هي (قد تخص مستخدماً آخر يشارك الجهاز).
 * لا ترمي أبداً — فشل التحديث لا يجوز أن يعطل تغيير كلمة السر نفسه.
 */
export async function updateSavedLoginPin(
  newPin: string,
  identifierMatches: (identifier: string) => boolean,
): Promise<void> {
  try {
    const saved = await loadSavedLogin()
    if (saved?.identifier && identifierMatches(saved.identifier)) {
      await storeSavedLogin(saved.identifier, newPin)
    }
  } catch { /* صامت — لا يعطل التغيير */ }
}
