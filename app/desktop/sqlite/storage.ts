/**
 * محرك التخزين المحلي لنسخة سطح المكتب (تنفيذ مرحلة القاعدة المحلية من
 * وثيقة §101): better-sqlite3 متزامنة على userData/shopsys.db بوضع WAL،
 * بتنفيذ عقد الجسر القائم في المُصيّر (src/data/desktopBridge.ts) حرفياً:
 *   getSnapshot / saveSnapshot (رقم إصدار تفاؤلي + مفتاح تكرار.idempotency)
 *   deleteSnapshot (إبطال اللقطة لا حذف أثرها) · outbox جاهزة لـ§103
 *   integrityCheck / schemaVersion
 *
 * مبادئ الوثيقة المطبقة هنا:
 *   • محلي أولاً: كل حفظ transaction واحدة — إما كلها أو لا شيء.
 *   • كتابة انتقائية: المجموعات المتغيرة فقط تُكتب في جداولها (فرق الحمولات).
 *   • لا حذف أبداً: حذف صف = وسم deleted_at — الأثر يبقى للتدقيق والدمج.
 *   • أعمدة النسب origin_device/origin_branch/updated_at على كل جدول.
 *   • Snowflake كهوية صف (53-بت آمنة تحت 2⁵³) — وثيقة §3.4.
 *   • ترقيم المستندات: فهرس فريد (فرع، نوع، رقم) يُملأ من الحقول المعروفة.
 *   • نسخة احتياطية إلزامية قبل أي ترحيل مخطط.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { COLLECTION_TABLE_SQL, DOC_NUMBER_FIELDS, MIGRATIONS, SCHEMA_VERSION } from './schema.ts'
import { SnowflakeGenerator } from './snowflake.ts'

/* ── عقد الجسر (مطابق لـ src/data/desktopBridge.ts — المصدر: المُصيّر) ── */
export interface SnapshotDto {
  storeName: string
  revision: number
  payloadJson: string | null
  updatedAt: string | null
}

export interface AuditEventDto {
  id: number
  at: string
  user: string
  kind: string
  title: string
  refKey?: string
}

export interface JournalLineDto {
  accountCode: string
  debit: number
  credit: number
  note?: string
  costCenterId?: number | null
}

export interface JournalEntryDto {
  id: number
  entryNumber: number
  date: string
  description: string
  sourceType: string
  sourceId: number | null
  lines: readonly JournalLineDto[]
  createdBy: string
  createdAt: string
  reversedByEntryId: number | null
  reversesEntryId: number | null
}

export interface SaveSnapshotInput {
  storeName: string
  expectedRevision: number
  payloadJson: string
  idempotencyKey?: string
  auditEvents?: readonly AuditEventDto[]
  journalEntries?: readonly JournalEntryDto[]
}

export interface OutboxEventDto {
  id: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payloadJson: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  attempts: number
  nextAttemptAt: string | null
  createdAt: string
  sentAt: string | null
}

const COLLECTION_PREFIX = 'c_'
const nowIso = () => new Date().toISOString()

function collectionTable(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`اسم مجموعة غير صالح للتخزين: ${name}`)
  return COLLECTION_PREFIX + name
}

/** الحالة من حمولة persist — تتقبل الشكلين {state,version} والحالة المباشرة */
function persistedState(payloadJson: string | null): Record<string, unknown> | null {
  if (!payloadJson) return null
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!parsed || typeof parsed !== 'object') return null
    const wrapped = parsed as { state?: unknown }
    const state = wrapped.state && typeof wrapped.state === 'object' ? wrapped.state : parsed
    return state as Record<string, unknown>
  } catch {
    return null
  }
}

export interface OpenOptions {
  /** جهاز المنشأ — ثابت للجهاز يُخزن في meta ويغذي Snowflake وأعمدة النسب */
  deviceId?: string
  /** رمز الفرع — يبقى فارغاً في هذه المرحلة ويُضبط في §103 */
  branchCode?: string
  /** مجلد النسخ الاحتياطية (نسخة ما قبل الترحيل) — افتراضياً بجوار القاعدة */
  backupsDir?: string
}

export class ShopsysDatabase {
  private readonly snowflake: SnowflakeGenerator
  private readonly deviceId: string
  private readonly branchCode: string
  private readonly backupsDir: string
  private readonly db: Database.Database

  private constructor(db: Database.Database, deviceId: string, branchCode: string, backupsDir: string) {
    this.db = db
    this.deviceId = deviceId
    this.branchCode = branchCode
    this.backupsDir = backupsDir
    this.snowflake = new SnowflakeGenerator(deviceNumber(deviceId))
  }

  get raw(): Database.Database {
    return this.db
  }

  get origin(): { device: string; branch: string } {
    return { device: this.deviceId, branch: this.branchCode }
  }

  /** يفتح القاعدة ويشغّل الترحيلات الناقصة (بنسخة احتياطية قبلية إلزامية) */
  static async open(dbPath: string, options: OpenOptions = {}): Promise<ShopsysDatabase> {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')

    const backupsDir = options.backupsDir ?? join(dirname(dbPath), 'backups')
    mkdirSync(backupsDir, { recursive: true })

    /* الترحيلات أولاً (هي التي تنشئ meta وكل الجداول) ثم هوية الجهاز */
    await applyMigrationsTo(db, backupsDir)
    return new ShopsysDatabase(db, options.deviceId ?? readOrCreateDeviceId(db), options.branchCode ?? readMeta(db, 'branch_code') ?? '', backupsDir)
  }

  /* ── meta ── */
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  getMeta(key: string): string | null {
    return readMeta(this.db, key)
  }

  /* ── عقد الجسر: اللقطات ── */
  getSnapshot(storeName: string): SnapshotDto {
    const row = this.db.prepare('SELECT revision, payload_json, updated_at FROM snapshots WHERE store_name = ?').get(storeName) as
      | { revision: number; payload_json: string | null; updated_at: string }
      | undefined
    if (!row) return { storeName, revision: 0, payloadJson: null, updatedAt: null }
    return { storeName, revision: row.revision, payloadJson: row.payload_json, updatedAt: row.updated_at }
  }

  saveSnapshot(input: SaveSnapshotInput): { revision: number; updatedAt: string; replayed?: boolean } {
    const updated = nowIso()
    const write = this.db.transaction(() => {
      const row = this.db.prepare('SELECT revision, payload_json, idempotency_key FROM snapshots WHERE store_name = ?').get(input.storeName) as
        | { revision: number; payload_json: string | null; idempotency_key: string | null }
        | undefined

      let nextRevision: number
      if (!row) {
        if (input.expectedRevision !== 0) throw new Error(`تعارض كتابة: المتجر ${input.storeName} غير موجود والتوقع ${input.expectedRevision} ≠ 0`)
        nextRevision = 1
        this.db.prepare(
          'INSERT INTO snapshots (store_name, revision, payload_json, idempotency_key, origin_device, origin_branch, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(input.storeName, nextRevision, input.payloadJson, input.idempotencyKey ?? null, this.deviceId, this.branchCode, updated)
      } else if (row.revision === input.expectedRevision) {
        nextRevision = row.revision + 1
        this.db.prepare(
          'UPDATE snapshots SET revision = ?, payload_json = ?, idempotency_key = ?, origin_device = ?, origin_branch = ?, updated_at = ? WHERE store_name = ?',
        ).run(nextRevision, input.payloadJson, input.idempotencyKey ?? null, this.deviceId, this.branchCode, updated, input.storeName)
      } else if (input.idempotencyKey && row.idempotency_key === input.idempotencyKey) {
        /* إعادة إرسال نفس الحفظ بعد ضياع الرد — أُعيد نتيجته بلا كتابة مزدوجة */
        return { revision: row.revision, updatedAt: updated, replayed: true }
      } else {
        throw new Error(`تعارض كتابة على ${input.storeName}: المتوقع ${input.expectedRevision} والموجود ${row.revision} — أعد الفتح ثم أعد المحاولة`)
      }

      for (const event of input.auditEvents ?? []) {
        this.db.prepare(
          `INSERT INTO audit_log (id, at, user, kind, title, ref_key, origin_device, origin_branch, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET at=excluded.at, user=excluded.user, kind=excluded.kind, title=excluded.title, ref_key=excluded.ref_key, updated_at=excluded.updated_at`,
        ).run(event.id, event.at, event.user, event.kind, event.title, event.refKey ?? null, this.deviceId, this.branchCode, updated)
      }

      for (const entry of input.journalEntries ?? []) {
        this.db.prepare(
          `INSERT INTO journal (id, entry_number, date, description, source_type, source_id, lines_json, created_by, created_at, reversed_by_entry_id, reverses_entry_id, origin_device, origin_branch, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET reversed_by_entry_id=excluded.reversed_by_entry_id, updated_at=excluded.updated_at`,
        ).run(entry.id, entry.entryNumber, entry.date, entry.description, entry.sourceType, entry.sourceId, JSON.stringify(entry.lines), entry.createdBy, entry.createdAt, entry.reversedByEntryId, entry.reversesEntryId, this.deviceId, this.branchCode, updated)
      }

      this.syncCollections(row?.payload_json ?? null, input.payloadJson, updated)
      return { revision: nextRevision, updatedAt: updated }
    })
    const result = write()
    if ('replayed' in result && result.replayed) return result
    return result
  }

  /** إبطال اللقطة (إعادة تعيين المتجر) — الأثر في journal/audit/المجموعات باقٍ */
  deleteSnapshot(input: { storeName: string; expectedRevision: number }): { revision: number; updatedAt: string } {
    const updated = nowIso()
    const result = this.db
      .prepare('UPDATE snapshots SET revision = revision + 1, payload_json = NULL, idempotency_key = NULL, updated_at = ? WHERE store_name = ? AND revision = ?')
      .run(updated, input.storeName, input.expectedRevision)
    if (result.changes === 0) throw new Error(`تعارض حذف على ${input.storeName}: المراجعة ${input.expectedRevision} غير موجودة`)
    const row = this.db.prepare('SELECT revision FROM snapshots WHERE store_name = ?').get(input.storeName) as { revision: number }
    return { revision: row.revision, updatedAt: updated }
  }

  /* ── الكتابة الانتقائية: فرق المجموعات → جدول لكل مجموعة ── */
  private syncCollections(oldPayloadJson: string | null, newPayloadJson: string, updated: string): void {
    const oldState = persistedState(oldPayloadJson)
    const newState = persistedState(newPayloadJson)
    if (!newState) return
    const seen = new Set<string>()
    for (const [name, value] of Object.entries(newState)) {
      if (!Array.isArray(value)) continue
      seen.add(name)
      this.syncCollection(name, value, oldState?.[name] as unknown[] | undefined, updated)
    }
    if (oldState) {
      /* مجموعة اختفت من الحالة كلياً — تُوسم محذوفة كلها (لا حذف فيزيائي) */
      for (const [name, value] of Object.entries(oldState)) {
        if (!Array.isArray(value) || seen.has(name)) continue
        this.db.prepare(`UPDATE "${collectionTable(name)}" SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL`).run(updated, updated)
      }
    }
  }

  private syncCollection(name: string, newArr: readonly unknown[], oldArr: readonly unknown[] | undefined, updated: string): void {
    const table = collectionTable(name)
    this.db.exec(COLLECTION_TABLE_SQL(table))

    /* المفتاح: id العدد إن وُجد، وإلا موضع الصف — والقديم يُقرأ من الجدول نفسه.
     * تُقرأ الصفوف المحذوفة ناعماً أيضاً: إعادة إدخال نفس المفتاح تستأنف صفه
     * الأصلي (هوية Snowflake نفسها) بدل استنساخ صف جديد يراكم القبور. */
    const rowKey = (payloadId: number | null, seq: number) => (payloadId != null ? `id:${payloadId}` : `pos:${seq}`)
    const existing = this.db.prepare(`SELECT snowflake_id, payload_id, payload_json, seq, deleted_at FROM "${table}"`).all() as
      { snowflake_id: number; payload_id: number | null; payload_json: string; seq: number; deleted_at: string | null }[]
    const oldJsonByKey = new Map<string, string>()
    const snowflakeByKey = new Map<string, number>()
    const deadKeys = new Set<string>()
    for (const row of existing) {
      const key = rowKey(row.payload_id, row.seq)
      oldJsonByKey.set(key, row.payload_json)
      snowflakeByKey.set(key, row.snowflake_id)
      if (rowIsDead(row)) deadKeys.add(key)
    }

    const upsert = this.db.prepare(
      `INSERT INTO "${table}" (snowflake_id, payload_id, payload_json, origin_device, origin_branch, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(snowflake_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at, deleted_at=NULL`,
    )
    const tombstone = this.db.prepare(`UPDATE "${table}" SET deleted_at = ?, updated_at = ? WHERE snowflake_id = ? AND deleted_at IS NULL`)
    const docNumber = this.db.prepare('INSERT OR IGNORE INTO doc_numbers (branch, doc_type, number, origin_device, created_at) VALUES (?, ?, ?, ?, ?)')

    const liveKeys = new Set<string>()
    let seq = 0
    for (const item of newArr) {
      const json = JSON.stringify(item) ?? 'null'
      const payloadId = item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'number' ? (item as { id: number }).id : null
      const key = rowKey(payloadId, seq)
      liveKeys.add(key)
      const previous = oldJsonByKey.get(key)
      /* الحمولة نفسها وصف حيّ — لم يتغير شيء؛ لكنه إن كان محذوفاً ناعماً
       * فيُستأنف (إعادة إدخال نفس المفتاح ليست تغييراً بل عودة). */
      if (previous === json && !deadKeys.has(key)) {
        seq += 1
        continue
      }
      const existingId = snowflakeByKey.get(key)
      if (existingId != null) {
        upsert.run(existingId, payloadId, json, this.deviceId, this.branchCode, updated, seq)
      } else {
        /* صف جديد: معرّف Snowflake فريد عالمياً (§3.4) */
        upsert.run(this.snowflake.next(), payloadId, json, this.deviceId, this.branchCode, updated, seq)
      }
      if (item && typeof item === 'object') {
        for (const field of DOC_NUMBER_FIELDS) {
          const num = (item as Record<string, unknown>)[field]
          if (typeof num === 'string' || typeof num === 'number') docNumber.run(this.branchCode, `${name}.${field}`, String(num), this.deviceId, updated)
        }
      }
      seq += 1
    }
    for (const [key, snowflakeId] of snowflakeByKey) {
      if (!liveKeys.has(key)) tombstone.run(updated, updated, snowflakeId)
    }
    void oldArr
  }

  /* ── عقد الجسر: outbox (تُشغَّل في §103 — الآن تنفيذاً للعقد فقط) ── */
  enqueueOutbox(input: { id: string; aggregateType: string; aggregateId: string; eventType: string; payloadJson: string }): { created: boolean } {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO sync_outbox (id, aggregate_type, aggregate_id, event_type, payload_json, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
      .run(input.id, input.aggregateType, input.aggregateId, input.eventType, input.payloadJson, 'pending', nowIso())
    return { created: result.changes > 0 }
  }

  claimOutbox(input?: { now?: string; limit?: number }): OutboxEventDto[] {
    const now = input?.now ?? nowIso()
    const limit = Math.max(1, Math.min(input?.limit ?? 50, 500))
    const rows = this.db
      .prepare(`SELECT id, aggregate_type, aggregate_id, event_type, payload_json, attempts, next_attempt_at, created_at FROM sync_outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`)
      .all(now, limit) as {
      id: string; aggregate_type: string; aggregate_id: string; event_type: string; payload_json: string
      attempts: number; next_attempt_at: string | null; created_at: string
    }[]
    const claim = this.db.prepare("UPDATE sync_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'")
    const out: OutboxEventDto[] = []
    for (const row of rows) {
      if (claim.run(row.id).changes === 0) continue
      out.push({
        id: row.id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, eventType: row.event_type,
        payloadJson: row.payload_json, status: 'sending', attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at, sentAt: null,
      })
    }
    return out
  }

  completeOutbox(input: { id: string; status: 'sent' | 'failed'; nextAttemptAt?: string | null }): { updated: boolean } {
    /* الفاشل يعود pending بجدولة إعادة محاولة (next_attempt_at) — لا يُرمى
     * الحدث أبداً؛ والمرسل يقفل sent بطابعه الزمني. */
    const result = this.db
      .prepare(`UPDATE sync_outbox SET
          status = CASE WHEN ? = 'sent' THEN 'sent' ELSE 'pending' END,
          attempts = attempts + 1,
          sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
          next_attempt_at = CASE WHEN ? = 'sent' THEN NULL ELSE ? END
        WHERE id = ? AND status = 'sending'`)
      .run(input.status, input.status, nowIso(), input.status, input.nextAttemptAt ?? null, input.id)
    return { updated: result.changes > 0 }
  }

  /* ── عقد الجسر: السلامة والمخطط ── */
  integrityCheck(): { ok: boolean; message: string } {
    const result = this.db.pragma('integrity_check', { simple: true }) as unknown
    const message = String(result)
    return { ok: message === 'ok', message }
  }

  schemaVersion(): number {
    const value = readMeta(this.db, 'schema_version')
    const parsed = value ? Number(value) : 0
    return Number.isInteger(parsed) && parsed > 0 ? parsed : SCHEMA_VERSION
  }

  /* ── النسخ الاحتياطي: Backup API الرسمية — نسخة ساخنة متسقة بلا إيقاف ── */
  async backupTo(filename: string): Promise<string> {
    const dest = join(this.backupsDir, filename)
    mkdirSync(this.backupsDir, { recursive: true })
    await this.db.backup(dest)
    return dest
  }

  close(): void {
    this.db.close()
  }
}

/** ترحيلات المخطط — نسخة احتياطية إلزامية قبل كل ترحيل على قاعدة قائمة.
 * قائمة الترحيلات معلمة — رحلة user_journey_exe_update تحاكي وصول تحديث
 * بترحيل v2 جديد على قاعدة v1 قائمة وتفحص الترتيب: نسخة ← ترحيل ← فحص. */
export async function applyMigrationsTo(db: Database.Database, backupsDir: string, migrations: readonly { id: number; name: string; sql: string }[] = MIGRATIONS): Promise<void> {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").get() as { name: string } | undefined
  const applied = hasTable
    ? new Set((db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((row) => row.id))
    : new Set<number>()
  const fresh = !hasTable
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    if (!fresh) {
      /* قاعدة صارمة (§3.3): نسخة احتياطية قبل تنفيذ أي ترحيل — التحديث
         التلقائي قد يصل مع ترحيل: التحديث ← نسخة ← ترحيل ← فحص ← إقلاع */
      const dest = join(backupsDir, `pre-migration-${migration.id}-${stamp()}.db`)
      mkdirSync(backupsDir, { recursive: true })
      await db.backup(dest)
    }
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO migrations (id, name, at) VALUES (?, ?, ?)').run(migration.id, migration.name, nowIso())
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('schema_version', String(migration.id))
    })()
  }
  const integrity = db.pragma('integrity_check', { simple: true }) as unknown
  if (integrity !== 'ok') throw new Error(`فحص سلامة القاعدة فشل بعد الترحيل: ${String(integrity)}`)
}

/** صف محذوف ناعماً؟ (كائن معامَل دفاعياً — deleted_at قد يأتي 0/1 من pragma) */
function rowIsDead(row: { deleted_at: string | null | 0 | 1 }): boolean {
  return row.deleted_at !== null && row.deleted_at !== 0 && row.deleted_at !== undefined
}

function readMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function readOrCreateDeviceId(db: Database.Database): string {
  const existing = (() => {
    try {
      return readMeta(db, 'device_id')
    } catch {
      return null
    }
  })()
  if (existing) return existing
  const id = randomUUID()
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('device_id', id)
  return id
}

/** رقم جهاز ثابت (5 بت — 32 جهازاً) مشتق من UUID الجهاز — يغذي بتات Snowflake */
function deviceNumber(deviceId: string): number {
  let hash = 0
  for (let i = 0; i < deviceId.length; i += 1) hash = (hash * 31 + deviceId.charCodeAt(i)) >>> 0
  return hash % 32
}

function stamp(): string {
  return nowIso().replace(/[:.]/g, '-')
}
