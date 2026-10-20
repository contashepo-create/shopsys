import type { StateStorage } from 'zustand/middleware'
import { desktopBridge, type DesktopAuditEvent, type DesktopDatabaseBridge, type DesktopJournalEntry } from './desktopBridge.ts'
import { secureStorage } from './secureStorage.ts'

type CachedSnapshot = {
  revision: number
  payloadJson: string | null
}

/* لقطة سطح المكتب تُخزَّن الآن كنص JSON محلي داخل SQLite، لتجنّب ربط فتح
   البيانات بمفتاح جهاز يتعطل أو يتغير عند التحديث. التوافق مع اللقطات القديمة
   `enc:v1` باقٍ: تُفك بالمفتاح القديم عند نجاحه ثم تُحوّل إلى نص عادي مرة واحدة.
   لا تُشفّر كلمات المرور وبيانات الاعتماد هنا؛ لها secureStorage مستقل. */
const ENC_PREFIX = 'enc:v1:'

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, ['decrypt'])
}

export async function decryptSnapshotForDevice(stored: string, keyBytes: Uint8Array): Promise<string> {
  const parts = stored.split(':')
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}:` !== ENC_PREFIX) throw new Error('صيغة لقطة مشفرة غير معروفة')
  const iv = b64uToBytes(parts[2])
  const ct = b64uToBytes(parts[3])
  const key = await importAesKey(keyBytes)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, ct as unknown as ArrayBuffer)
  return new TextDecoder().decode(plain)
}

export function isEncryptedSnapshot(stored: string): boolean {
  return stored.startsWith('enc:')
}

/* v1.0.19: متاجر فشلت قراءتها من SQLite. عند الفشل لا يُعرض معالج «عميل جديد»
   ولا تُكتب الحالة الافتراضية فوق بيانات موجودة — الكتابة تُمنع حتى إعادة التشغيل. */
const failedStores = new Map<string, string>()

/** أخطاء قراءة المتاجر التي لم تُحمَّل (أو null) — تقرؤها الواجهة لعرض شاشة الاسترداد */
export function desktopStorageFailure(): string | null {
  if (failedStores.size === 0) return null
  return [...failedStores].map(([name, message]) => `${name}: ${message}`).join(' | ')
}

/** مفتاح ثابت لإعادة محاولة IPC بعد انقطاع الرد دون تكرار الحفظ. */
export async function snapshotIdempotencyKey(storeName: string, expectedRevision: number, payloadJson: string): Promise<string> {
  const data = new TextEncoder().encode(`${storeName}\u0000${expectedRevision}\u0000${payloadJson}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `snapshot:${storeName}:${expectedRevision}:${hex}`
}

function persistedState(payloadJson: string | null): Record<string, unknown> | null {
  if (!payloadJson) return null
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!parsed || typeof parsed !== 'object') return null
    const state = 'state' in parsed && parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed
    return state as Record<string, unknown>
  } catch {
    return null
  }
}

/** الأحداث الجديدة فقط؛ تُحفظ في جدول التدقيق داخل نفس معاملة اللقطة. */
export function newAuditEvents(nextPayloadJson: string, previousPayloadJson: string | null): DesktopAuditEvent[] {
  const next = persistedState(nextPayloadJson)
  if (!next || !Array.isArray(next.auditLog)) return []
  const previous = persistedState(previousPayloadJson)
  const known = new Set(
    previous && Array.isArray(previous.auditLog)
      ? previous.auditLog.map((event) => (event && typeof event === 'object' ? (event as { id?: unknown }).id : null)).filter((id): id is number => typeof id === 'number')
      : [],
  )
  return next.auditLog
    .filter((event): event is Record<string, unknown> => !!event && typeof event === 'object' && Number.isInteger(event.id) && !known.has(event.id))
    .map((event) => ({
      id: event.id as number,
      at: typeof event.at === 'string' ? event.at : '',
      user: typeof event.user === 'string' ? event.user : '',
      kind: typeof event.kind === 'string' ? event.kind : '',
      title: typeof event.title === 'string' ? event.title : '',
      ...(typeof event.refKey === 'string' ? { refKey: event.refKey } : {}),
    }))
}

/** القيود الجديدة فقط؛ جداول SQLite تحفظ القيد وسطوره بصورة append-only. */
export function newJournalEntries(nextPayloadJson: string, previousPayloadJson: string | null): DesktopJournalEntry[] {
  const next = persistedState(nextPayloadJson)
  if (!next || !Array.isArray(next.journal)) return []
  const previous = persistedState(previousPayloadJson)
  const known = new Set(
    previous && Array.isArray(previous.journal)
      ? previous.journal.map((entry) => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null)).filter((id): id is number => typeof id === 'number')
      : [],
  )
  return next.journal
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && Number.isInteger(entry.id) && !known.has(entry.id))
    .map((entry) => ({
      id: entry.id as number,
      entryNumber: typeof entry.entryNumber === 'number' ? entry.entryNumber : entry.id as number,
      date: typeof entry.date === 'string' ? entry.date : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      sourceType: typeof entry.sourceType === 'string' ? entry.sourceType : '',
      sourceId: typeof entry.sourceId === 'number' ? entry.sourceId : null,
      lines: Array.isArray(entry.lines) ? entry.lines.map((line) => {
        const row = line && typeof line === 'object' ? line as Record<string, unknown> : {}
        return {
          accountCode: typeof row.accountCode === 'string' ? row.accountCode : '',
          debit: typeof row.debit === 'number' ? row.debit : 0,
          credit: typeof row.credit === 'number' ? row.credit : 0,
          ...(typeof row.note === 'string' ? { note: row.note } : {}),
          ...(typeof row.costCenterId === 'number' || row.costCenterId === null ? { costCenterId: row.costCenterId } : {}),
        }
      }) : [],
      createdBy: typeof entry.createdBy === 'string' ? entry.createdBy : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      reversedByEntryId: typeof entry.reversedByEntryId === 'number' ? entry.reversedByEntryId : null,
      reversesEntryId: typeof entry.reversesEntryId === 'number' ? entry.reversesEntryId : null,
    }))
}

/**
 * تخزين Zustand المتوافق مع نسخة الويب ونسخة Electron.
 *
 * في المتصفح يبقى secureStorage هو المسار الحالي المشفر بمفتاحه المحلي.
 * داخل Electron تنتقل اللقطة نفسها إلى SQLite كنص عبر IPC، مع رقم إصدار
 * متفائل يمنع كاتباً قديماً من الكتابة فوق لقطة أحدث؛ enc:v1 للتوافق الرجعي فقط.
 */
export class DesktopStateStorage implements StateStorage {
  private readonly snapshots = new Map<string, CachedSnapshot>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly queueFailures = new Map<string, string>()
  private paused = false

  async flush(): Promise<void> {
    this.paused = true
    await Promise.all(this.queues.values())
    if (failedStores.size) throw new Error(desktopStorageFailure() ?? 'تعذّر تحميل البيانات')
    if (this.queueFailures.size) throw new Error([...this.queueFailures.values()].join(' | '))
  }

  resume(): void { this.paused = false }
  private readonly database: DesktopDatabaseBridge
  private readonly legacyStorage: StateStorage | null
  /* مفتاح توافق لقطات enc:v1 القديمة — يُجلب مرة عند الحاجة، لا للكتابات الجديدة. */
  private encryptionKey: Uint8Array | null = null
  private encryptionKeyLoaded = false
  private readonly keyLoader: () => Promise<Uint8Array | null>

  constructor(database: DesktopDatabaseBridge, legacyStorage: StateStorage | null = secureStorage, keyLoader?: () => Promise<Uint8Array | null>) {
    this.database = database
    this.legacyStorage = legacyStorage
    this.keyLoader = keyLoader ?? (async () => (database.getEncryptionKey ? await database.getEncryptionKey() : null))
  }

  /** مفتاح اللقطات القديمة أو null؛ لا حاجة إليه للقطات النصية الجديدة. */
  private async deviceKey(): Promise<Uint8Array | null> {
    if (!this.encryptionKeyLoaded) {
      this.encryptionKeyLoaded = true
      try { this.encryptionKey = await this.keyLoader() } catch { this.encryptionKey = null }
    }
    return this.encryptionKey
  }

  /** فك لقطة enc:v1 قديمة؛ اللقطات النصية تُعاد كما هي. */
  private async readPayload(stored: string | null, storeName: string): Promise<string | null> {
    if (stored == null) return null
    if (!isEncryptedSnapshot(stored)) return stored
    const key = await this.deviceKey()
    if (!key || key.length !== 32) throw new Error(`اللقطة القديمة «${storeName}» مشفرة، لكن مفتاحها الأصلي غير متاح. احفظ قاعدة البيانات كما هي؛ لا تُنشئ قاعدة بديلة.`)
    try {
      return await decryptSnapshotForDevice(stored, key)
    } catch {
      throw new Error(`تعذّر فك اللقطة القديمة «${storeName}» — المفتاح لا يطابقها أو أن بياناتها تالفة. لم تُكتب فوقها أي بيانات.`)
    }
  }

  private enqueue<T>(storeName: string, work: () => Promise<T>, isWrite = false): Promise<T> {
    const previous = this.queues.get(storeName) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.queues.set(storeName, next.then(
      () => { if (isWrite) this.queueFailures.delete(storeName) },
      (error: unknown) => { if (isWrite) this.queueFailures.set(storeName, error instanceof Error ? error.message : String(error)) },
    ))
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
          auditEvents: newAuditEvents(legacyPayload, null),
          journalEntries: newJournalEntries(legacyPayload, null),
        })
        await this.legacyStorage.removeItem(storeName)
        const loaded: CachedSnapshot = { revision: migrated.revision, payloadJson: legacyPayload }
        this.snapshots.set(storeName, loaded)
        return loaded
      }
    }
    const payloadJson = await this.readPayload(snapshot.payloadJson, storeName)
    let loaded: CachedSnapshot = { revision: snapshot.revision, payloadJson }

    // ترحيل صامت لمرة واحدة: بعد فك لقطة إصدار قديم بالمفتاح الأصلي، نكتب
    // الحمولة نفسها كنص عادي بإصدار متفائل. فشل الترحيل لا يمنع القراءة ولا
    // يستبدل الأصل؛ أول حفظ عادي لاحق سيكتب النص العادي أيضاً.
    if (snapshot.payloadJson != null && isEncryptedSnapshot(snapshot.payloadJson) && payloadJson != null) {
      try {
        const migrated = await this.database.saveSnapshot({
          storeName,
          expectedRevision: snapshot.revision,
          payloadJson,
          idempotencyKey: await snapshotIdempotencyKey(storeName, snapshot.revision, payloadJson),
          auditEvents: [],
          journalEntries: [],
        })
        loaded = { revision: migrated.revision, payloadJson }
      } catch {
        // تعارض متزامن أو قرص غير متاح: لا نعرض إعداداً فارغاً ولا نلمس الأصل.
        try {
          const latest = await this.database.getSnapshot(storeName)
          if (latest.storeName === storeName && latest.payloadJson != null && !isEncryptedSnapshot(latest.payloadJson)) {
            loaded = { revision: latest.revision, payloadJson: await this.readPayload(latest.payloadJson, storeName) }
          }
        } catch { /* تبقى النسخة المفكوكة في الذاكرة؛ سيُعاد الحفظ في أول كتابة */ }
      }
    }
    this.snapshots.set(storeName, loaded)
    return loaded
  }

  getItem(name: string): Promise<string | null> {
    return this.enqueue(name, async () => {
      try {
        const value = await this.readPayload((await this.load(name)).payloadJson, name)
        failedStores.delete(name)
        return value
      } catch (error) {
        failedStores.set(name, (error as Error).message)
        throw error
      }
    })
  }

  setItem(name: string, value: string): Promise<void> {
    if (this.paused) return Promise.reject(new Error('جارٍ حفظ البيانات وإغلاق البرنامج'))
    return this.enqueue(name, async () => {
      if (failedStores.has(name)) {
        throw new Error(`لم تُحمَّل بيانات «${name}» — منع الحفظ حتى لا تُكتب فوقها. ${failedStores.get(name)}`)
      }
      const current = await this.load(name)
      const idempotencyKey = await snapshotIdempotencyKey(name, current.revision, value)
      // تخزين SQLite النصي مقصود: لا تعتمد البيانات الجديدة على مفتاح جهاز
      // أو safeStorage. اللقطات القديمة تُفك وتُرحّل تلقائياً عند أول قراءة.
      const result = await this.database.saveSnapshot({
        storeName: name,
        expectedRevision: current.revision,
        payloadJson: value,
        idempotencyKey,
        auditEvents: newAuditEvents(value, current.payloadJson),
        journalEntries: newJournalEntries(value, current.payloadJson),
      })
      this.snapshots.set(name, { revision: result.revision, payloadJson: value })
    }, true)
  }

  removeItem(name: string): Promise<void> {
    if (this.paused) return Promise.reject(new Error('جارٍ حفظ البيانات وإغلاق البرنامج'))
    return this.enqueue(name, async () => {
      if (failedStores.has(name)) throw new Error(`لم تُحمَّل بيانات «${name}» — منع الحذف`)
      const current = await this.load(name)
      if (this.database.deleteSnapshot) {
        const result = await this.database.deleteSnapshot({ storeName: name, expectedRevision: current.revision })
        if (this.legacyStorage) await this.legacyStorage.removeItem(name)
        this.snapshots.set(name, { revision: result.revision, payloadJson: null })
        return
      }
      // توافق مؤقت مع preload قديم: لا نرسل لقطة فارغة غير قابلة للفك، بل نرفض بوضوح.
      throw new Error('نسخة جسر SQLite لا تدعم حذف اللقطة — حدّث نسخة سطح المكتب')
    }, true)
  }
}

const activeDesktopStores = new Set<DesktopStateStorage>()
const registeredPersistenceBridges = new WeakSet<object>()

type DesktopStorageCache = { database: DesktopDatabaseBridge; storage: DesktopStateStorage }
let appStorageCache: DesktopStorageCache | null = null
let settingsStorageCache: DesktopStorageCache | null = null

function registerDesktopStorage(storage: DesktopStateStorage): DesktopStateStorage {
  const bridge = desktopBridge()
  activeDesktopStores.add(storage)
  const persistence = bridge?.persistence
  if (persistence && !registeredPersistenceBridges.has(persistence)) {
    registeredPersistenceBridges.add(persistence)
    persistence.onFlush(async () => {
      await Promise.all([...activeDesktopStores].map(store => store.flush()))
    })
    persistence.onResume(() => { for (const store of activeDesktopStores) store.resume() })
  }
  return storage
}

function cachedDesktopStorage(
  cache: DesktopStorageCache | null,
  database: DesktopDatabaseBridge,
  legacyStorage: StateStorage | null,
): { cache: DesktopStorageCache; storage: DesktopStateStorage } {
  if (cache?.database === database) {
    return { cache, storage: registerDesktopStorage(cache.storage) }
  }
  if (cache) activeDesktopStores.delete(cache.storage)
  const storage = registerDesktopStorage(new DesktopStateStorage(database, legacyStorage))
  return { cache: { database, storage }, storage }
}

/** مصدر persist الوحيد: SQLite في Electron، والتخزين المشفر الحالي في الويب. */
export function appStorage(): StateStorage {
  const bridge = desktopBridge()
  if (!bridge) return secureStorage
  const cached = cachedDesktopStorage(appStorageCache, bridge.database, null)
  appStorageCache = cached.cache
  return cached.storage
}

/** localStorage الخام كما هو — لمتجر الإعدادات في الويب (سلوك اليوم بلا تغيير). */
const rawLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}

/**
 * §101 التنفيذية: متجر الإعدادات (shopsys-app) — في Electron ينتقل إلى SQLite
 * (مع ترحيل لمرة واحدة من localStorage الخاص بالنسخة المكتبية القديمة)،
 * وفي المتصفح يبقى localStorage الخام **كما هو حرفياً** فلا يفقد مستخدم الويب
 * إعداداته ولا يتبدل تنسيق التخزين لديه.
 */
export function settingsAppStorage(): StateStorage {
  const bridge = desktopBridge()
  if (!bridge) return rawLocalStorage
  const cached = cachedDesktopStorage(settingsStorageCache, bridge.database, rawLocalStorage)
  settingsStorageCache = cached.cache
  return cached.storage
}
