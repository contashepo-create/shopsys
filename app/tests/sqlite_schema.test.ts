import { describe, expect, it } from 'vitest'
import { SQLITE_MIGRATIONS, SQLITE_PRAGMAS, SQLITE_SCHEMA_VERSION, sqliteMigrationStatements, sqliteSchemaSummary } from '../src/data/sqliteSchema.ts'

describe('SQLite desktop schema contract', () => {
  it('keeps the initial migration deterministic and versioned', () => {
    expect(SQLITE_SCHEMA_VERSION).toBe(1)
    expect(SQLITE_MIGRATIONS).toHaveLength(1)
    expect(sqliteMigrationStatements()).toEqual(SQLITE_MIGRATIONS[0].statements)
    expect(sqliteMigrationStatements()).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS store_state'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS outbox_events'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_idempotency_created_at'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS audit_events'),
    ]))
  })

  it('declares recovery and concurrency guarantees without exposing native code to the web bundle', () => {
    expect(SQLITE_PRAGMAS).toContain('PRAGMA journal_mode = WAL')
    expect(sqliteSchemaSummary()).toMatchObject({ version: 1, tables: expect.arrayContaining(['store_state', 'idempotency_keys']) })
    expect(() => sqliteMigrationStatements(2)).toThrow('إصدار SQLite غير مدعوم')
  })
})
