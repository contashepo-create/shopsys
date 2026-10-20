import { decryptForDevice, encryptForDevice } from './secureStorage.ts'
import { desktopSupportBridge } from './desktopBridge.ts'

const SUPPORT_TOKEN_KEY = 'tahakam-support-token-v1'
const TOKEN_BYTES = 32
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/**
 * اعتماد خاص بقناة الدعم، عشوائي 256-bit ولا يحتوي PIN أو مفتاح الترخيص.
 * يُنشأ مرة ويُخزن مشفراً بمفتاح الجهاز؛ لا يخرج إلا في Authorization إلى الووركر.
 *
 * بند 5 (طلب المالك): على سطح Desktop يُحفَظ الاعتماد **خارج القاعدة** أيضاً
 * (userData/support-token.json عبر العملية الرئيسية) ⇒ مسح القاعدة أو فقدان
 * التخزين المحلي لا يولّد اعتماداً جديداً؛ والخادم يربط الاعتماد بالجهاز مرة
 * واحدة (TOFU) ⇒ اعتماد جديد يعني رفضاً دائماً (401) بلا طريق عودة.
 */
export async function getOrCreateSupportToken(): Promise<string> {
  const desktop = desktopSupportBridge()

  /* ① نسخة سطح المكتب: المرجع خارج القاعدة — لا يُولَّد اعتماد جديد ما دام موجوداً */
  if (desktop) {
    try {
      const stored = await desktop.getToken()
      if (stored && TOKEN_RE.test(stored)) return stored
    } catch { /* الجسر غير متاح — نكمل بالمسار المحلي */ }
  }

  /* ② النسخة المحلية (ويب، أو أول تشغيل على سطح Desktop) */
  try {
    const stored = localStorage.getItem(SUPPORT_TOKEN_KEY)
    if (stored) {
      const plain = await decryptForDevice(stored)
      if (plain && TOKEN_RE.test(plain)) {
        /* ③ ارفعه إلى مرساة العملية الرئيسية (خارج القاعدة) ليبقى ثابتاً بعدها */
        if (desktop) { try { await desktop.setToken(plain) } catch { /* لا يقطع العمل */ } }
        return plain
      }
    }
  } catch { /* اعتماد تالف أو تخزين غير متاح — نولّد بديلاً */ }

  const token = base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
  try { localStorage.setItem(SUPPORT_TOKEN_KEY, await encryptForDevice(token)) } catch { /* يبقى صالحاً للجلسة الحالية */ }
  if (desktop) { try { await desktop.setToken(token) } catch { /* لا يقطع العمل */ } }
  return token
}

/** للاختبارات/إعادة ربط الجهاز من أداة دعم إدارية مستقبلية فقط. */
export function clearSupportToken(): void {
  try { localStorage.removeItem(SUPPORT_TOKEN_KEY) } catch { /* صامت */ }
}

export function isSupportToken(value: string): boolean { return TOKEN_RE.test(value) }
