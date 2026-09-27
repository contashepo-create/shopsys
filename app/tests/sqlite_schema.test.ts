import { describe, expect, it } from 'vitest'
import { SQLITE_MIGRATIONS, SQLITE_PRAGMAS, SQLITE_SCHEMA_VERSION, sqliteMigrationStatements, sqliteSchemaSummary } from '../src/data/sqliteSchema.ts'

describe('SQLite desktop schema contract', () => {
  it('keeps the initial migration deterministic and versioned', () => {
    expect(SQLITE_SCHEMA_VERSION).toBe(2)
    expect(SQLITE_MIGRATIONS).toHaveLength(2)
    expect(sqliteMigrationStatements()).toEqual(SQLITE_MIGRATIONS.flatMap((migration) => [...migration.statements]))
    expect(sqliteMigrationStatements(1)).toEqual(SQLITE_MIGRATIONS[0].statements)
    expect(sqliteMigrationStatements()).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS store_state'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS outbox_events'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_idempotency_created_at'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS audit_events'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS journal_entries'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS journal_lines'),
    ]))
  })

  it('declares recovery and concurrency guarantees without exposing native code to the web bundle', () => {
    expect(SQLITE_PRAGMAS).toContain('PRAGMA journal_mode = WAL')
    expect(sqliteSchemaSummary()).toMatchObject({ version: 2, tables: expect.arrayContaining(['store_state', 'idempotency_keys', 'journal_entries']) })
    expect(() => sqliteMigrationStatements(3)).toThrow('إصدار SQLite غير مدعوم')
  })
})
