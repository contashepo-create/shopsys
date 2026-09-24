/**
 * مخطط SQLite الانتقالي لنسخة سطح المكتب.
 *
 * المرحلة الأولى لا تنقل Zustand دفعة واحدة؛ تحفظ لقطة المتجر داخل SQLite
 * مع outbox/idempotency/audit جاهزة للترحيل التدريجي إلى جداول الأعمال.
 * لا يحتوي هذا الملف على Electron أو Node حتى يبقى قابلاً للاختبار في المتصفح.
 */

export const SQLITE_SCHEMA_VERSION = 1

export interface SqliteMigration {
  version: number
  statements: readonly string[]
}

export const SQLITE_PRAGMAS = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
] as const

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS store_state (
        store_name TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY NOT NULL,
        operation TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, next_attempt_at, created_at)`,
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        aggregate_type TEXT,
        aggregate_id TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at)`,
    ],
  },
]

export function sqliteMigrationStatements(targetVersion = SQLITE_SCHEMA_VERSION): string[] {
  if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > SQLITE_SCHEMA_VERSION) {
    throw new Error(`إصدار SQLite غير مدعوم: ${targetVersion}`)
  }
  return SQLITE_MIGRATIONS
    .filter((migration) => migration.version <= targetVersion)
    .flatMap((migration) => [...migration.statements])
}

export function sqliteSchemaSummary() {
  return {
    version: SQLITE_SCHEMA_VERSION,
    tables: ['schema_meta', 'store_state', 'idempotency_keys', 'outbox_events', 'audit_events'] as const,
    guarantees: ['ACID transaction boundary', 'WAL recovery', 'foreign keys', 'idempotency key uniqueness'] as const,
  }
}
