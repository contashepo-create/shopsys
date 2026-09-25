import type { StateStorage } from 'zustand/middleware'
import { desktopBridge, type DesktopDatabaseBridge } from './desktopBridge.ts'
import { secureStorage } from './secureStorage.ts'

type CachedSnapshot = {
  revision: number
  payloadJson: string | null
}

/** مفتاح ثابت لإعادة محاولة IPC بعد انقطاع الرد دون تكرار الحفظ. */
export async function snapshotIdempotencyKey(storeName: string, expectedRevision: number, payloadJson: string): Promise<string> {
  const data = new TextEncoder().encode(`${storeName}\u0000${expectedRevision}\u0000${payloadJson}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `snapshot:${storeName}:${expectedRevision}:${hex}`
}

/**
 * تخزين Zustand المتوافق مع نسخة الويب ونسخة Electron.
 *
 * في المتصفح يبقى secureStorage هو المسار الحالي المشفر بمفتاح الجهاز.
 * داخل Electron تنتقل اللقطة نفسها إلى SQLite عبر IPC، مع رقم إصدار
 * متفائل يمنع كاتباً قديماً من الكتابة فوق لقطة أحدث.
 */
export class DesktopStateStorage implements StateStorage {
  private readonly snapshots = new Map<string, CachedSnapshot>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly database: DesktopDatabaseBridge
  private readonly legacyStorage: StateStorage | null

  constructor(database: DesktopDatabaseBridge, legacyStorage: StateStorage | null = secureStorage) {
    this.database = database
    this.legacyStorage = legacyStorage
  }

  private enqueue<T>(storeName: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(storeName) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.queues.set(storeName, next.then(() => undefined, () => undefined))
    return next
  }

  private async load(storeName: string): Promise<CachedSnapshot> {
    const cached = this.snapshots.get(storeName)
    if (cached) return cached
    const snapshot = await this.database.getSnapshot(storeName)
    if (snapshot.storeName !== storeName) throw new Error('اسم مخزن SQLite غير مطابق')
    if (snapshot.payloadJson == null && this.legacyStorage) {
      // الترحيل لمرة واحدة: نثبت اللقطة في SQLite أولاً ثم نحذف النسخة القديمة.
      // إذا فشل الحفظ تبقى نسخة الويب سليمة ويمكن إعادة المحاولة عند التشغيل التالي.
      const legacyPayload = await this.legacyStorage.getItem(storeName)
      if (legacyPayload != null) {
        const migrated = await this.database.saveSnapshot({
          storeName,
          expectedRevision: snapshot.revision,
          payloadJson: legacyPayload,
          idempotencyKey: await snapshotIdempotencyKey(storeName, snapshot.revision, legacyPayload),
        })
        await this.legacyStorage.removeItem(storeName)
        const loaded: CachedSnapshot = { revision: migrated.revision, payloadJson: legacyPayload }
        this.snapshots.set(storeName, loaded)
        return loaded
      }
    }
    const loaded: CachedSnapshot = { revision: snapshot.revision, payloadJson: snapshot.payloadJson }
    this.snapshots.set(storeName, loaded)
    return loaded
  }

  getItem(name: string): Promise<string | null> {
    return this.enqueue(name, async () => (await this.load(name)).payloadJson)
  }

  setItem(name: string, value: string): Promise<void> {
    return this.enqueue(name, async () => {
      const current = await this.load(name)
      const idempotencyKey = await snapshotIdempotencyKey(name, current.revision, value)
      const result = await this.database.saveSnapshot({
        storeName: name,
        expectedRevision: current.revision,
        payloadJson: value,
        idempotencyKey,
      })
      this.snapshots.set(name, { revision: result.revision, payloadJson: value })
    })
  }

  removeItem(name: string): Promise<void> {
    return this.enqueue(name, async () => {
      const current = await this.load(name)
      if (this.database.deleteSnapshot) {
        const result = await this.database.deleteSnapshot({ storeName: name, expectedRevision: current.revision })
        if (this.legacyStorage) await this.legacyStorage.removeItem(name)
        this.snapshots.set(name, { revision: result.revision, payloadJson: null })
        return
      }
      // توافق مؤقت مع preload قديم: لا نرسل لقطة فارغة غير قابلة للفك، بل نرفض بوضوح.
      throw new Error('نسخة جسر SQLite لا تدعم حذف اللقطة — حدّث نسخة سطح المكتب')
    })
  }
}

/** مصدر persist الوحيد: SQLite في Electron، والتخزين المشفر الحالي في الويب. */
export function appStorage(): StateStorage {
  const bridge = desktopBridge()
  return bridge ? new DesktopStateStorage(bridge.database) : secureStorage
}
