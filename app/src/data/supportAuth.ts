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
let tokenInFlight: Promise<string> | null = null

async function resolveSupportToken(): Promise<string> {
  const desktop = desktopSupportBridge()
  if (desktop) {
    // تعذر قراءة المرساة ليس دليلاً على عدم وجودها؛ لا نولّد اعتماداً بديلاً بصمت.
    const stored = await desktop.getToken()
    if (stored && TOKEN_RE.test(stored)) return stored
  }

  let localToken: string | null = null
  const stored = localStorage.getItem(SUPPORT_TOKEN_KEY)
  if (stored) {
    localToken = await decryptForDevice(stored)
    if (!localToken || !TOKEN_RE.test(localToken)) throw new Error('تعذّر قراءة اعتماد الدعم المحفوظ — تواصل مع المطوّر قبل إعادة ربط القناة')
  }
  const candidate = localToken ?? base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
  if (desktop) {
    // العملية الرئيسية تكتب حصرياً (wx). إن سبقت نافذة أخرى، نقرأ الفائز.
    const saved = await desktop.setToken(candidate)
    const authoritative = saved ? candidate : await desktop.getToken()
    if (!authoritative || !TOKEN_RE.test(authoritative)) throw new Error('تعذّر حفظ اعتماد الدعم بأمان — تحقق من صلاحيات ملفات التطبيق')
    if (authoritative !== localToken) {
      try { localStorage.setItem(SUPPORT_TOKEN_KEY, await encryptForDevice(authoritative)) } catch { /* مرساة سطح المكتب هي المرجع */ }
    }
    return authoritative
  }

  // لا نربط الخادم باعتماد عابر إذا تعذّر حفظه محلياً.
  if (!localToken) localStorage.setItem(SUPPORT_TOKEN_KEY, await encryptForDevice(candidate))
  return candidate
}

export function getOrCreateSupportToken(): Promise<string> {
  if (tokenInFlight) return tokenInFlight
  // Web Locks ينسّق أول إنشاء بين تبويبات الويب التي تشارك localStorage.
  const operation = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(SUPPORT_TOKEN_KEY, { mode: 'exclusive' }, resolveSupportToken)
    : resolveSupportToken()
  tokenInFlight = operation.finally(() => { tokenInFlight = null })
  return tokenInFlight
}

/** للاختبارات/إعادة ربط الجهاز من أداة دعم إدارية مستقبلية فقط. */
export function clearSupportToken(): void {
  try { localStorage.removeItem(SUPPORT_TOKEN_KEY) } catch { /* صامت */ }
}

export function isSupportToken(value: string): boolean { return TOKEN_RE.test(value) }
