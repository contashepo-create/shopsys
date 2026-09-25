import type { StateStorage } from 'zustand/middleware'
import { desktopBridge, type DesktopAuditEvent, type DesktopDatabaseBridge, type DesktopJournalEntry } from './desktopBridge.ts'
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
          auditEvents: newAuditEvents(legacyPayload, null),
          journalEntries: newJournalEntries(legacyPayload, null),
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
        auditEvents: newAuditEvents(value, current.payloadJson),
        journalEntries: newJournalEntries(value, current.payloadJson),
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
