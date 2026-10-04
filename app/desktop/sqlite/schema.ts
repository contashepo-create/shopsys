/**
 * مخطط قاعدة §101 التنفيذية (وثيقة المعمارية §3.2 و§3.4) — نسخة المخطط 1:
 *   • snapshots: لقطة المتجر الحالية بعقد الجسر القائم (revision تفاؤلي)
 *   • journal: اليومية مسطّحة بأعمدة حقيقية — append-only (الوثيقة: الجداول
 *     الساخنة تُسطَّح حيث يفيد؛ اليومية هي الجدول الساخن للتدقيق)
 *   • audit_log: سجل التدقيق append-only
 *   • c_<مجموعة>: جدول لكل مجموعة بحمولة JSON + أعمدة النسب
 *     (origin_device/origin_branch/updated_at) + Snowflake كهوية صف — كتابة
 *     انتقائية بالفرق (المجموعة المتغيرة فقط)
 *   • doc_numbers: فهرس الترقيم الفريد (فرع، نوع، رقم) — جاهز مسبقاً لـ§103
 *   • sync_outbox: تُنشأ فارغة الآن وتُشغَّل في §103 (لا ترحيل لاحقاً)
 * أي ترحيل قادم يضاف لقائمة MIGRATIONS — وقبل كل ترحيل نسخة احتياطية إلزامية.
 */

export interface SchemaMigration {
  id: number
  name: string
  sql: string
}

export const SCHEMA_VERSION = 1

export const MIGRATIONS: readonly SchemaMigration[] = [
  {
    id: 1,
    name: 'أساس §101: snapshots واليومية المسطحة والتدقيق والمجموعات والترقيم وoutbox',
    sql: `
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, at TEXT NOT NULL);

      CREATE TABLE snapshots (
        store_name TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        payload_json TEXT,
        idempotency_key TEXT,
        origin_device TEXT NOT NULL,
        origin_branch TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        entry_number INTEGER NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id INTEGER,
        lines_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reversed_by_entry_id INTEGER,
        reverses_entry_id INTEGER,
        origin_device TEXT NOT NULL,
        origin_branch TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_journal_date ON journal(date);
      CREATE INDEX idx_journal_source ON journal(source_type, source_id);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        user TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        ref_key TEXT,
        origin_device TEXT NOT NULL,
        origin_branch TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE doc_numbers (
        branch TEXT NOT NULL DEFAULT '',
        doc_type TEXT NOT NULL,
        number TEXT NOT NULL,
        origin_device TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (branch, doc_type, number)
      );

      CREATE TABLE sync_outbox (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX idx_outbox_status ON sync_outbox(status, next_attempt_at);
    `,
  },
]

/** أعمدة النسب الإلزامية لكل جدول مجموعة — عقد لا يُخالف لاحقاً (§3.4) */
export const COLLECTION_TABLE_SQL = (table: string): string => `
  CREATE TABLE IF NOT EXISTS "${table}" (
    snowflake_id INTEGER PRIMARY KEY,
    payload_id INTEGER,
    payload_json TEXT NOT NULL,
    origin_device TEXT NOT NULL,
    origin_branch TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    seq INTEGER NOT NULL,
    deleted_at TEXT
  );
`

/** حقول أرقام المستندات المعروفة — تُستخرج لأعمدة doc_numbers الفريدة */
export const DOC_NUMBER_FIELDS: readonly string[] = [
  'invoiceNumber', 'voucherNumber', 'entryNumber', 'extractNumber', 'slipNumber',
  'runNumber', 'fileNumber', 'orderNumber', 'batchNumber', 'advanceNumber',
  'repayNumber', 'chequeNumber', 'receiptNumber', 'transferNumber',
]
