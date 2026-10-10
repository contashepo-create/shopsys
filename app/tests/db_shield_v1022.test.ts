/**
 * v1.0.22 — درع الإقلاع على ملفات SQLite حقيقية:
 *   1) قاعدة سليمة ⇒ لا شيء يتغيّر.
 *   2) تالفة بلا نسخة سليمة ⇒ الملف يبقى كما هو (بايت بايت)، ولا عزل ولا قاعدة فارغة.
 *   3) تالفة والنسخة الوحيدة تالفة أيضاً ⇒ كما في (2).
 *   4) تالفة مع نسخة سليمة ⇒ استرداد كامل والبيانات كما كانت، والتالف محفوظ جانباً.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')
const { shieldDatabaseAt, probeDbFile } = await import('../desktop/dbShield.ts')

const APP_STATE = JSON.stringify({ state: { setup: { completed: true, shopName: 'مخزن الأمل' } }, version: 0 })

async function realDatabase(path: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = await ShopsysDatabase.open(path, { backupsDir: join(path, '..', 'backups') })
  db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: APP_STATE })
  db.close()
}

/** يُفسد الملف بكتابة بايتات عشوائية فوق كامل محتواه (ترويسة SQLite مفقودة) */
function corrupt(path: string) {
  writeFileSync(path, Buffer.alloc(8192, 0x41))
}

function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'shopsys-shield-'))
  const dir = join(root, 'Tahakom')
  mkdirSync(dir, { recursive: true })
  return { root, dir, dbPath: join(dir, 'shopsys.db') }
}

describe('درع الإقلاع', () => {
  it('1) قاعدة سليمة ⇒ ok ولا تُمسّ', async () => {
    const s = scenario()
    try {
      await realDatabase(s.dbPath)
      const before = readFileSync(s.dbPath)
      const r = shieldDatabaseAt(s.dbPath, () => [])
      expect(r.outcome).toBe('ok')
      expect(readFileSync(s.dbPath).equals(before)).toBe(true)
    } finally { rmSync(s.root, { recursive: true, force: true }) }
  })

  it('2) تالفة بلا أي نسخة ⇒ corrupt-no-backup، الملف كما هو، ولا ملف عزل ولا قاعدة فارغة', () => {
    const s = scenario()
    try {
      corrupt(s.dbPath)
      const before = readFileSync(s.dbPath)
      expect(probeDbFile(s.dbPath)).toBe('corrupt')
      const r = shieldDatabaseAt(s.dbPath, () => [])
      expect(r.outcome).toBe('corrupt-no-backup')
      expect(readFileSync(s.dbPath).equals(before)).toBe(true)
      expect(readdirSync(s.dir).filter((f) => f.includes('.corrupt-'))).toEqual([])
      expect(readdirSync(s.dir)).toEqual(['shopsys.db'])
    } finally { rmSync(s.root, { recursive: true, force: true }) }
  })

  it('3) تالفة والنسخ المتاحة كلها تالفة ⇒ corrupt-no-backup والملف كما هو', () => {
    const s = scenario()
    try {
      corrupt(s.dbPath)
      const badBackup = join(s.dir, 'backups', 'hourly', 'old.db')
      mkdirSync(join(s.dir, 'backups', 'hourly'), { recursive: true })
      corrupt(badBackup)
      const before = readFileSync(s.dbPath)
      const r = shieldDatabaseAt(s.dbPath, () => [badBackup])
      expect(r.outcome).toBe('corrupt-no-backup')
      expect(readFileSync(s.dbPath).equals(before)).toBe(true)
      expect(readdirSync(s.dir).filter((f) => f.includes('.corrupt-'))).toEqual([])
    } finally { rmSync(s.root, { recursive: true, force: true }) }
  })

  it('4) تالفة مع نسخة سليمة ⇒ restored، البيانات كما كانت، والتالف محفوظ جانباً', async () => {
    const s = scenario()
    try {
      await realDatabase(s.dbPath)
      const good = join(s.dir, 'backups', 'hourly', 'good.db')
      mkdirSync(join(s.dir, 'backups', 'hourly'), { recursive: true })
      copyFileSync(s.dbPath, good)
      corrupt(s.dbPath)
      const r = shieldDatabaseAt(s.dbPath, () => [good], { stamp: 'T1' })
      expect(r.outcome).toBe('restored')
      expect(r.restoredFrom).toBe(good)
      expect(existsSync(r.quarantine!)).toBe(true)
      expect(probeDbFile(s.dbPath)).toBe('ok')
      const db = await ShopsysDatabase.open(s.dbPath, { backupsDir: join(s.dir, 'backups') })
      expect(db.getSnapshot('shopsys-app').payloadJson).toBe(APP_STATE)
      db.close()
    } finally { rmSync(s.root, { recursive: true, force: true }) }
  })
})
