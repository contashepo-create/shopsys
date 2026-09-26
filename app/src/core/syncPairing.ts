import { decryptText, deriveKey, encryptText, isEncrypted } from './security.ts'

export const SYNC_PAIRING_PREFIX = 'TAHAKAM-SYNC1.'
export const PAIRING_PASSWORD_MIN = 12
export const SYNC_SECRET_RE = /^[A-Za-z0-9_-]{43}$/

export interface SyncPairingConfig {
  url: string
  anonKey: string
  storeId: string
  secret: string
  accessToken: string
}

interface PairingPayload extends SyncPairingConfig {
  version: 1
  exportedAt: string
}

function assertPassword(password: string): void {
  if (password.length < PAIRING_PASSWORD_MIN) throw new Error(`كلمة حماية ملف الربط يجب ألا تقل عن ${PAIRING_PASSWORD_MIN} خانة`)
}

export function validatePairingConfig(c: SyncPairingConfig): void {
  if (!/^https:\/\//.test(c.url)) throw new Error('ملف الربط: رابط Supabase غير صالح')
  if (c.anonKey.length < 20) throw new Error('ملف الربط: مفتاح anon غير صالح')
  if (!c.storeId.trim()) throw new Error('ملف الربط: معرف المتجر مفقود')
  if (!SYNC_SECRET_RE.test(c.secret)) throw new Error('ملف الربط: سر التشفير يجب أن يكون مفتاحاً مولداً 256-bit')
  if (!SYNC_SECRET_RE.test(c.accessToken)) throw new Error('ملف الربط: اعتماد العزل غير صالح')
}

/** حزمة ربط مشفرة لنقل إعداد المزامنة إلى جهاز آخر دون ملف أسرار صريح. */
export async function exportSyncPairing(config: SyncPairingConfig, password: string, now = new Date().toISOString()): Promise<string> {
  assertPassword(password)
  validatePairingConfig(config)
  const payload: PairingPayload = { version: 1, exportedAt: now, ...config }
  const key = await deriveKey(`sync-pairing:${password}`)
  return SYNC_PAIRING_PREFIX + await encryptText(JSON.stringify(payload), key)
}

export async function importSyncPairing(fileText: string, password: string): Promise<SyncPairingConfig> {
  assertPassword(password)
  const trimmed = fileText.trim()
  if (!trimmed.startsWith(SYNC_PAIRING_PREFIX)) throw new Error('هذا ليس ملف ربط تَحَكَّم')
  const encrypted = trimmed.slice(SYNC_PAIRING_PREFIX.length)
  if (!isEncrypted(encrypted)) throw new Error('ملف الربط غير مشفر أو تالف')
  try {
    const key = await deriveKey(`sync-pairing:${password}`)
    const parsed = JSON.parse(await decryptText(encrypted, key)) as Partial<PairingPayload>
    if (parsed.version !== 1) throw new Error('إصدار ملف الربط غير مدعوم')
    const config: SyncPairingConfig = {
      url: String(parsed.url ?? ''), anonKey: String(parsed.anonKey ?? ''), storeId: String(parsed.storeId ?? ''),
      secret: String(parsed.secret ?? ''), accessToken: String(parsed.accessToken ?? ''),
    }
    validatePairingConfig(config)
    return config
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ملف الربط:')) throw error
    throw new Error('تعذر فتح ملف الربط — كلمة الحماية خاطئة أو الملف تالف')
  }
}
