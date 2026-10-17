// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { EMPTY_DB_LOCATION, readDbLocationAt, resolveDbPathAt, writeDbLocationAt } from '../desktop/dbLocation.ts'
import { freshStartCutoffAt, freshStartEligibleFilesAt, isCurrentFreshStartDataAt, readFreshStartMarkerAt, startFreshDatabaseAt, startFreshWithoutDatabaseAt } from '../desktop/freshStart.ts'
import { recoverMissingDatabaseAt, rememberDatabaseIdentity } from '../desktop/databaseSafety.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'shopsys-fresh-start-'))
  roots.push(root)
  const userData = join(root, 'Roaming', 'Tahakom')
  const installDir = join(root, 'Program Files', 'Tahakom')
  const documentsBackupDir = join(root, 'Documents', 'Tahakom-Backups')
  mkdirSync(userData, { recursive: true })
  mkdirSync(installDir, { recursive: true })
  return { root, userData, installDir, documentsBackupDir }
}

async function createDatabase(file: string, payloadJson = '{"state":{"test":true}}') {
  mkdirSync(dirname(file), { recursive: true })
  const database = await ShopsysDatabase.open(file, { deviceId: 'test-device' })
  database.setMeta('device_id', 'test-device')
  database.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson })
  return database
}

async function readPayload(file: string): Promise<string | null> {
  const database = await ShopsysDatabase.open(file)
  try { return database.getSnapshot('shopsys-data').payloadJson } finally { database.close() }
}

describe('البدء النظيف مع أرشفة القاعدة القديمة', () => {
  it('يحفظ نسخة SQLite متسقة ويحوّل قاعدة التشغيل إلى مسار افتراضي جديد', async () => {
    const s = scenario()
    const active = join(s.userData, 'shopsys.db')
    const db = await createDatabase(active, '{"state":{"old":true}}')
    db.raw.pragma('wal_autocheckpoint = 0')
    db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: '{"state":{"old":"latest"}}' })
    expect(existsSync(`${active}-wal`)).toBe(true)
    db.close()
    rememberDatabaseIdentity(s.userData, 'test-device')

    const result = await startFreshDatabaseAt({ userData: s.userData, databasePath: active, installDir: s.installDir })

    expect(existsSync(result.archivePath)).toBe(true)
    expect(await readPayload(result.archivePath)).toBe('{"state":{"old":"latest"}}')
    expect(existsSync(active)).toBe(false)
    expect(existsSync(`${result.archivePath}.source`)).toBe(true)
    expect(existsSync(`${result.archivePath}.source-wal`)).toBe(true)
    expect(resolveDbPathAt(s.userData)).toEqual({ dbPath: active, isCustom: false })
    expect(readDbLocationAt(s.userData)).toMatchObject({ customDbPath: null, customDbOpenedAt: null, lastFileBackupAt: null })
    expect(readFreshStartMarkerAt(s.userData)).toMatchObject({ archivePath: result.archivePath, startedAt: result.startedAt })
    expect(freshStartCutoffAt(s.userData)).not.toBeNull()
  })

  it('لا يمسح قاعدة مكان مخصص؛ يحفظ نسخة ويعيد التوجيه إلى القاعدة الجديدة', async () => {
    const s = scenario()
    const custom = join(s.root, 'ExternalData', 'shopsys.db')
    writeDbLocationAt(s.userData, { ...EMPTY_DB_LOCATION, customDbPath: custom, customDbOpenedAt: new Date().toISOString() })
    const db = await createDatabase(custom, '{"state":{"keep":true}}')
    db.close()

    const result = await startFreshDatabaseAt({ userData: s.userData, databasePath: custom, installDir: s.installDir })

    expect(existsSync(custom)).toBe(true)
    expect(await readPayload(custom)).toBe('{"state":{"keep":true}}')
    expect(await readPayload(result.archivePath)).toBe('{"state":{"keep":true}}')
    expect(resolveDbPathAt(s.userData)).toEqual({ dbPath: join(s.userData, 'shopsys.db'), isCustom: false })
  })

  it('يفشل بأمان على قاعدة SQLite غير سليمة بلا تغيير القاعدة أو كتابة علامة البدء', async () => {
    const s = scenario()
    const active = join(s.userData, 'shopsys.db')
    writeFileSync(active, 'not a database')
    await expect(startFreshDatabaseAt({ userData: s.userData, databasePath: active, installDir: s.installDir })).rejects.toThrow()
    expect(readFileSync(active, 'utf8')).toBe('not a database')
    expect(readFreshStartMarkerAt(s.userData)).toBeNull()
  })

  it('يحفظ اختيار البدء النظيف من شاشة اكتشاف النسخ ولا يعرض النسخة القديمة مجدداً', async () => {
    const s = scenario()
    const oldBackup = join(s.documentsBackupDir, 'auto', 'discovered.db')
    const old = await createDatabase(oldBackup, '{"state":{"candidate":true}}')
    old.close()
    rememberDatabaseIdentity(s.userData, 'test-device')
    writeDbLocationAt(s.userData, { ...EMPTY_DB_LOCATION, customDbPath: join(s.root, 'missing', 'shopsys.db'), customDbOpenedAt: new Date().toISOString() })

    const result = await startFreshWithoutDatabaseAt({
      userData: s.userData, installDir: s.installDir, archiveSource: oldBackup, excludedPaths: [oldBackup],
    })

    expect(result.archivePath).not.toBeNull()
    expect(await readPayload(result.archivePath!)).toBe('{"state":{"candidate":true}}')
    expect(isCurrentFreshStartDataAt(s.userData, oldBackup)).toBe(false)
    expect(await recoverMissingDatabaseAt({
      ...s,
      minimumMtimeMs: freshStartCutoffAt(s.userData),
      isCandidateAllowed: file => isCurrentFreshStartDataAt(s.userData, file),
    })).toBeNull()
    expect(resolveDbPathAt(s.userData)).toEqual({ dbPath: join(s.userData, 'shopsys.db'), isCustom: false })
  })

  it('لا يبدأ إذا اختفت النسخة المختارة قبل أرشفتها', async () => {
    const s = scenario()
    const selected = join(s.root, 'Documents', 'gone.db')
    writeDbLocationAt(s.userData, { ...EMPTY_DB_LOCATION, customDbPath: selected, customDbOpenedAt: new Date().toISOString() })

    await expect(startFreshWithoutDatabaseAt({ userData: s.userData, installDir: s.installDir, archiveSource: selected })).rejects.toThrow('اختفت نسخة البيانات')
    expect(readFreshStartMarkerAt(s.userData)).toBeNull()
    expect(resolveDbPathAt(s.userData)).toEqual({ dbPath: selected, isCustom: true })
  })

  it('يحفظ النسخ السابقة من التقليم ويواصل تطبيق حد الاحتفاظ على النسخ الجديدة', async () => {
    const s = scenario()
    const oldBackup = join(s.userData, 'backups', 'hourly', 'before-reset.db')
    mkdirSync(dirname(oldBackup), { recursive: true })
    writeFileSync(oldBackup, 'old archive')
    await startFreshWithoutDatabaseAt({ userData: s.userData, installDir: s.installDir, excludedPaths: [oldBackup] })

    const newBackup = join(s.userData, 'backups', 'hourly', 'after-reset.db')
    writeFileSync(newBackup, 'new backup')

    expect(freshStartEligibleFilesAt(s.userData, [{ path: oldBackup }, { path: newBackup }])).toEqual([{ path: newBackup }])
    expect(existsSync(oldBackup)).toBe(true)
  })

  it('يسجل بدءاً نظيفاً بلا قاعدة سابقة ويزيل المؤشر المخصص المفقود', async () => {
    const s = scenario()
    writeDbLocationAt(s.userData, { ...EMPTY_DB_LOCATION, customDbPath: join(s.root, 'missing', 'shopsys.db'), customDbOpenedAt: new Date().toISOString() })

    const result = await startFreshWithoutDatabaseAt({ userData: s.userData, installDir: s.installDir })

    expect(result.archivePath).toBeNull()
    expect(readFreshStartMarkerAt(s.userData)?.archivePath).toBeNull()
    expect(resolveDbPathAt(s.userData)).toEqual({ dbPath: join(s.userData, 'shopsys.db'), isCustom: false })
  })

  it('يمنع إعادة اختيار نسخة أقدم تلقائياً بعد البدء النظيف، ويسمح بنسخ جديدة', async () => {
    const s = scenario()
    const now = Date.now()
    const active = join(s.userData, 'shopsys.db')
    const db = await createDatabase(active)
    db.close()
    rememberDatabaseIdentity(s.userData, 'test-device')
    const oldBackup = join(s.documentsBackupDir, 'auto', 'before-reset.db')
    const old = await createDatabase(oldBackup, '{"state":{"oldBackup":true}}')
    old.close()
    utimesSync(oldBackup, (now - 60_000) / 1000, (now - 60_000) / 1000)

    await startFreshDatabaseAt({ userData: s.userData, databasePath: active, installDir: s.installDir, now: new Date(now) })
    const cutoff = freshStartCutoffAt(s.userData)
    expect(cutoff).not.toBeNull()
    expect(isCurrentFreshStartDataAt(s.userData, oldBackup)).toBe(false)
    expect(await recoverMissingDatabaseAt({
      ...s,
      minimumMtimeMs: cutoff,
    })).toBeNull()

    const newBackup = join(s.documentsBackupDir, 'auto', 'after-reset.db')
    const fresh = await createDatabase(newBackup, '{"state":{"freshBackup":true}}')
    fresh.close()
    utimesSync(newBackup, (now + 10_000) / 1000, (now + 10_000) / 1000)
    expect(isCurrentFreshStartDataAt(s.userData, newBackup)).toBe(true)
    expect(await recoverMissingDatabaseAt({
      ...s,
      minimumMtimeMs: cutoff,
    })).toBe(newBackup)
    expect(await readPayload(resolveDbPathAt(s.userData).dbPath)).toBe('{"state":{"freshBackup":true}}')
  })
})
