/**
 * فحص مفتاح لقطات SQLite قبل أي ترحيل أو حماية أو كتابة.
 *
 * يفيد خصوصاً بعد تحديث التطبيق: إذا كان الملف سليماً بنيوياً لكن مفتاح الجهاز
 * الحالي لا يفك لقطاته، نتوقف قبل فتحه بمسار الكتابة. لا نبدّل المفتاح ولا ننشئ
 * قاعدة بديلة؛ يمكن للمستخدم استيراد ملف الاسترداد ثم إعادة المحاولة.
 */
import { createDecipheriv } from 'node:crypto'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'

export type SnapshotKeyProbeResult =
  | { status: 'missing' | 'no-encrypted-snapshots' | 'verified' | 'unreadable'; stores: string[] }
  | { status: 'mismatch'; stores: string[] }

function decryptSnapshot(stored: string, key: Buffer): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}:` !== 'enc:v1:') throw new Error('صيغة تشفير غير مدعومة')
  const iv = Buffer.from(parts[2], 'base64url')
  const ciphertextAndTag = Buffer.from(parts[3], 'base64url')
  if (key.length !== 32 || iv.length !== 12 || ciphertextAndTag.length < 16) throw new Error('حقول التشفير غير صالحة')
  const ciphertext = ciphertextAndTag.subarray(0, -16)
  const tag = ciphertextAndTag.subarray(-16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  JSON.parse(plaintext)
  return plaintext
}

/**
 * يفحص اللقطات المشفرة في قاعدة موجودة بوضع القراءة فقط.
 * أخطاء فتح SQLite ليست حكماً على المفتاح (قد يكون الملف مقفلاً/تالفاً)، لذلك
 * تعاد `unreadable` ويُترك فحص سلامة SQLite ومسار الاسترداد المعتاد للتعامل معها.
 */
export function probeSnapshotKey(dbPath: string, key: Buffer): SnapshotKeyProbeResult {
  if (!existsSync(dbPath)) return { status: 'missing', stores: [] }

  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return { status: 'unreadable', stores: [] }
  }

  try {
    const hasSnapshots = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'snapshots'").get()
    if (!hasSnapshots) return { status: 'no-encrypted-snapshots', stores: [] }

    const rows = db.prepare('SELECT store_name AS storeName, payload_json AS payloadJson FROM snapshots WHERE payload_json IS NOT NULL').all() as {
      storeName: string
      payloadJson: string
    }[]
    const encryptedStores = new Set<string>()
    const mismatchedStores = new Set<string>()
    for (const row of rows) {
      const stored = String(row.payloadJson ?? '')
      if (!stored.startsWith('enc:')) continue
      encryptedStores.add(String(row.storeName))
      try {
        decryptSnapshot(stored, key)
      } catch {
        mismatchedStores.add(String(row.storeName))
      }
    }

    if (mismatchedStores.size) return { status: 'mismatch', stores: [...mismatchedStores].sort() }
    if (!encryptedStores.size) return { status: 'no-encrypted-snapshots', stores: [] }
    return { status: 'verified', stores: [...encryptedStores].sort() }
  } catch {
    return { status: 'unreadable', stores: [] }
  } finally {
    try { db.close() } catch { /* لا شيء */ }
  }
}
