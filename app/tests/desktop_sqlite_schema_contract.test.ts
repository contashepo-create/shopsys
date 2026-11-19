import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLLECTION_TABLE_SQL, DOC_NUMBER_FIELDS, MIGRATIONS, SCHEMA_VERSION } from '../desktop/sqlite/schema.ts'

/**
 * عقد المخطط التنفيذي لقاعدة سطح المكتب (desktop/sqlite/schema.ts).
 *
 * سبب وجود هذا الملف: كان المشروع يحمل مخططَي SQLite — أحدهما `src/data/sqliteSchema.ts`
 * (نسخة 2) تغطيه اختبارات كاملة ولا يستورده تشغيل، والآخر هو هذا (نسخة 1) وهو الذي
 * يُنشئ قاعدة المستخدم فعلاً. فكان الاختبار يمر على مخطط غير مُشغَّل. هذه الاختبارات
 * تثبّت عقد المخطط الحقيقي: نسخة متسلسلة، جداول فريدة، اليومية مسطّحة append-only،
 * وأعمدة النسب الإلزامية لكل جدول مجموعة.
 */
const tablesOf = (sql: string): string[] => [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([\w]+)"?/g)].map((m) => m[1])
const allSql = MIGRATIONS.map((migration) => migration.sql).join('\n')

describe('عقد مخطط SQLite التنفيذي (سطح المكتب)', () => {
  it('نسخة المخطط تساوي أعلى ترحيل، والترحيلات متسلسلة بلا فجوة أو تكرار', () => {
    const ids = MIGRATIONS.map((migration) => migration.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ids.map((_, index) => index + 1))
    expect(SCHEMA_VERSION).toBe(Math.max(...ids))
    for (const migration of MIGRATIONS) {
      expect(migration.name.trim().length).toBeGreaterThan(3)
      expect(migration.sql.trim().length).toBeGreaterThan(50)
    }
  })

  it('اليومية جدول مسطّح append-only بأعمدة حقيقية لا حمولة JSON', () => {
    const journal = /CREATE TABLE journal \(([\s\S]*?)\);/.exec(allSql)?.[1] ?? ''
    expect(journal).not.toBe('')
    for (const column of ['entry_number', 'date', 'source_type', 'source_id', 'lines_json', 'created_by', 'reversed_by_entry_id', 'reverses_entry_id', 'origin_device', 'updated_at']) {
      expect(journal).toContain(column)
    }
    expect(journal).not.toContain('payload_json')
    expect(journal).toContain('entry_number INTEGER NOT NULL')
    expect(journal).toContain('date TEXT NOT NULL')
  })

  it('لا جدول مكرر عبر الترحيلات، ولكل جدول أساسي فهرس حيث يلزم', () => {
    const tables = tablesOf(allSql)
    expect(new Set(tables).size).toBe(tables.length)
    expect(tables).toEqual(expect.arrayContaining(['meta', 'migrations', 'snapshots', 'journal', 'audit_log', 'doc_numbers', 'sync_outbox']))
    expect(allSql).toContain('CREATE INDEX idx_journal_date')
    expect(allSql).toContain('CREATE INDEX idx_journal_source')
    expect(allSql).toContain('CREATE INDEX idx_outbox_status')
  })

  it('كل جدول مجموعة يلتزم عقد النسب الإلزامي (§3.4)', () => {
    const sql = COLLECTION_TABLE_SQL('c_sample')
    expect(tablesOf(sql)).toEqual(['c_sample'])
    for (const column of ['snowflake_id INTEGER PRIMARY KEY', 'payload_json TEXT NOT NULL', 'origin_device TEXT NOT NULL', 'origin_branch TEXT NOT NULL', 'updated_at TEXT NOT NULL', 'seq INTEGER NOT NULL', 'deleted_at TEXT']) {
      expect(sql).toContain(column)
    }
  })

  it('حقول أرقام المستندات فريدة وغير فارغة (تُبنى منها فهارس الترقيم)', () => {
    expect(DOC_NUMBER_FIELDS.length).toBeGreaterThan(8)
    expect(new Set(DOC_NUMBER_FIELDS).size).toBe(DOC_NUMBER_FIELDS.length)
    for (const field of DOC_NUMBER_FIELDS) expect(field).toBe(field.trim())
  })

  it('طبقة التخزين التنفيذية هي التي تستورد هذا المخطط (لا مخطط موازٍ)', () => {
    const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8')
    const storage = read('desktop/sqlite/storage.ts')
    expect(storage).toContain("from './schema.ts'")
    expect(storage).toContain('MIGRATIONS')
    const schema = read('src/data/sqliteSchema.ts')
    expect(schema).toContain('SQLITE_SCHEMA_VERSION = 2')
    // المخطط الموازي لا يُستورد من أي ملف تشغيلي — وجوده توثيقي/اختباري فقط
    for (const runtimeFile of ['desktop/sqlite/storage.ts', 'src/data/persistentStorage.ts']) {
      expect(read(runtimeFile)).not.toContain('sqliteSchema.ts')
    }
  })
})
