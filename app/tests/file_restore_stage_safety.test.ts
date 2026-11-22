import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { discardStagedBackup, replaceWithStagedBackup, stageFileRestore } from '../desktop/fileRestoreStage.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const state = (value: string) => JSON.stringify({ state: { marker: value, journal: [] } })
async function create(path: string, marker: string) {
  const db = await ShopsysDatabase.open(path)
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: state(marker) })
  db.close()
}
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'restore-stage-')); dirs.push(dir)
  const live = join(dir, 'live.db'), target = join(dir, 'backup.db'), before = join(dir, 'before.db')
  await create(live, 'current'); await create(target, 'backup')
  return { dir, live, target, before }
}
async function read(path: string) {
  const db = await ShopsysDatabase.open(path)
  try { return db.getSnapshot('shopsys-data').payloadJson } finally { db.close() }
}

describe('تهيئة استعادة SQLite قبل استبدال الملف', () => {
  it('ينسخ ويفحص نسخة مؤقتة ثم يحتفظ بالقاعدة الحالية ويستبدلها', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    expect(await read(s.live)).toBe(state('current'))
    replaceWithStagedBackup(s.live, staged, s.before)
    expect(existsSync(staged)).toBe(false); expect(await read(s.live)).toBe(state('backup'))
    expect(await read(s.before)).toBe(state('current')); expect(await read(s.target)).toBe(state('backup'))
  })
  it('يرفض ملفاً تالفاً أو SQLite سليمة لا تحتوي مخطط تحكّم قبل لمس الأصل وينظف المؤقت', async () => {
    const s = await setup(); writeFileSync(s.target, 'corrupt database')
    expect(() => stageFileRestore(s.target, s.live)).toThrow('تالفة')
    expect(await read(s.live)).toBe(state('current')); expect(readdirSync(s.dir).filter(name => name.includes('.restore-stage-'))).toEqual([])
    rmSync(s.target); const unrelated = new Database(s.target); unrelated.exec('CREATE TABLE other (id INTEGER)'); unrelated.close()
    expect(() => stageFileRestore(s.target, s.live)).toThrow('ليست قاعدة تحكّم')
    expect(await read(s.live)).toBe(state('current')); expect(readdirSync(s.dir).filter(name => name.includes('.restore-stage-'))).toEqual([])
  })
  it('يرفض نسخة لها WAL حقيقي لم يُدمج في الملف المنفرد', async () => {
    const s = await setup(), targetDb = await ShopsysDatabase.open(s.target)
    try {
      targetDb.raw.pragma('wal_autocheckpoint = 0')
      targetDb.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: state('inside WAL') })
      expect(existsSync(s.target + '-wal')).toBe(true)
      expect(() => stageFileRestore(s.target, s.live)).toThrow('WAL')
      expect(await read(s.live)).toBe(state('current'))
      expect(targetDb.getSnapshot('shopsys-data').payloadJson).toBe(state('inside WAL'))
    } finally { targetDb.close() }
  })
  it('يرفض WAL الحالي دون حذفه أو استبدال القاعدة ولو بقي اتصال آخر', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    const db = await ShopsysDatabase.open(s.live), other = new Database(s.live)
    try {
      db.raw.pragma('wal_autocheckpoint = 0')
      other.exec('BEGIN')
      other.prepare('SELECT count(*) FROM snapshots').get() // قارئ يثبت اللقطة ويمنع دمج WAL كاملاً
      db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: state('pending WAL') })
      db.close()
      expect(existsSync(s.live + '-wal')).toBe(true)
      expect(() => replaceWithStagedBackup(s.live, staged, s.before)).toThrow('WAL')
      expect(existsSync(s.live + '-wal')).toBe(true); expect(existsSync(s.before)).toBe(false)
      other.exec('COMMIT')
      expect((other.prepare("SELECT payload_json AS payload FROM snapshots WHERE store_name='shopsys-data'").get() as { payload: string }).payload).toBe(state('pending WAL'))
    } finally { other.close(); discardStagedBackup(staged) }
    expect(await read(s.live)).toBe(state('pending WAL'))
  })
  it('فشل إنشاء نسخة الأمان الحصرية لا يغير القاعدة أو النسخة السابقة', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    writeFileSync(s.before, 'keep previous')
    expect(() => replaceWithStagedBackup(s.live, staged, s.before)).toThrow()
    expect(readFileSync(s.before, 'utf8')).toBe('keep previous'); expect(await read(s.live)).toBe(state('current'))
    discardStagedBackup(staged)
  })
  it('فشل تبديل الاسم بعد نسخة الأمان لا يقطع الملف الأصلي', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    discardStagedBackup(staged)
    expect(() => replaceWithStagedBackup(s.live, staged, s.before)).toThrow()
    expect(await read(s.live)).toBe(state('current')); expect(await read(s.before)).toBe(state('current'))
  })
  it('يرفض اختيار قاعدة التشغيل نفسها حتى عبر رابط', async () => {
    const s = await setup(), alias = join(s.dir, 'alias.db')
    symlinkSync(s.live, alias)
    expect(() => stageFileRestore(alias, s.live)).toThrow('قاعدة التشغيل نفسها')
    expect(await read(s.live)).toBe(state('current'))
  })
  it('يرفض رابطاً صلباً إلى ملف القاعدة أو رابطاً رمزياً لملف التشغيل', async () => {
    const s = await setup(), hard = join(s.dir, 'hard.db'), liveAlias = join(s.dir, 'live-alias.db')
    linkSync(s.live, hard); symlinkSync(s.live, liveAlias)
    expect(() => stageFileRestore(hard, s.live)).toThrow('قاعدة التشغيل نفسها')
    expect(() => stageFileRestore(s.target, liveAlias)).toThrow('رابط رمزي')
    expect(await read(s.live)).toBe(state('current'))
  })
  it('لا يزيل WAL غير فارغ للمرحلة ولا يستبدل الملف', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    writeFileSync(staged + '-wal', 'unresolved')
    expect(() => replaceWithStagedBackup(s.live, staged, s.before)).toThrow('WAL غير فارغ')
    expect(() => discardStagedBackup(staged)).toThrow('WAL غير فارغ')
    expect(readFileSync(staged + '-wal', 'utf8')).toBe('unresolved')
    expect(await read(s.live)).toBe(state('current')); expect(existsSync(s.before)).toBe(false)
  })
  it('يرفض WAL على المسار الحقيقي عند اختيار نسخة من خلال رابط', async () => {
    const s = await setup(), alias = join(s.dir, 'alias.db')
    symlinkSync(s.target, alias); writeFileSync(s.target + '-wal', 'active')
    expect(() => stageFileRestore(alias, s.live)).toThrow('WAL')
    expect(readFileSync(s.target + '-wal', 'utf8')).toBe('active')
  })
  it('فشل نسخ المصدر إلى المؤقت يترك القاعدة سليمة دون ملف مرحلة', async () => {
    const s = await setup(), directory = join(s.dir, 'directory')
    // copyFile على مجلد يفشل بعد إنشاء ملف المرحلة.
    const { mkdirSync } = await import('node:fs'); mkdirSync(directory)
    expect(() => stageFileRestore(directory, s.live)).toThrow()
    expect(readdirSync(s.dir).filter(name => name.includes('.restore-stage-'))).toEqual([])
    expect(await read(s.live)).toBe(state('current'))
  })
  it('تعديل النسخة الأصلية بعد تجهيزها لا يغير ملف المرحلة', async () => {
    const s = await setup(), staged = stageFileRestore(s.target, s.live)
    copyFileSync(s.live, s.target)
    replaceWithStagedBackup(s.live, staged, s.before)
    expect(await read(s.live)).toBe(state('backup')); expect(await read(s.before)).toBe(state('current'))
  })
})
