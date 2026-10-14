// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync, utimesSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { readDbLocationAt, writeDbLocationAt, resolveDbPathAt, EMPTY_DB_LOCATION } from '../desktop/dbLocation.ts'
import { changedDrivePaths, copyDatabaseSafely, isInsideInstallation, protectDatabaseAt, recoverMissingDatabaseAt, rememberDatabaseIdentity } from '../desktop/databaseSafety.ts'
import { preserveCurrentUserData } from '../desktop/runtimeData.ts'
import { installSilentUpdate } from '../desktop/updateLifecycle.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'shopsys-update-safety-'))
  roots.push(root)
  const userData = join(root, 'Roaming', 'Tahakom')
  const installDir = join(root, 'D', 'accounting', 'Tahakam', 'Tahakom')
  const documentsBackupDir = join(root, 'Documents', 'Tahakom-Backups')
  mkdirSync(userData, { recursive: true })
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'Tahakom.exe'), 'simulated installed binary')
  return { root, userData, installDir, documentsBackupDir }
}
function point(ud: string, path: string) {
  writeDbLocationAt(ud, { ...EMPTY_DB_LOCATION, customDbPath: path, customDbOpenedAt: '2026-10-14T00:00:00Z' })
}
function encrypted(key: Buffer, text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()])
  return `enc:v1:${iv.toString('base64url')}:${ct.toString('base64url')}`
}
async function create(file: string, device = 'same-device', payload = '{"state":{"balance":12345}}') {
  mkdirSync(dirname(file), { recursive: true })
  const db = await ShopsysDatabase.open(file, { deviceId: device })
  db.setMeta('device_id', device)
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payload })
  return db
}
async function payload(file: string) {
  const db = await ShopsysDatabase.open(file)
  try { return db.getSnapshot('shopsys-data').payloadJson } finally { db.close() }
}

describe('فصل القاعدة عن ملفات التثبيت — SQLite وملفات حقيقية', () => {
  it('سيناريو المالك: WAL حي ← حماية ← حذف مجلد النسخة القديمة ← إعادة الفتح بنفس أحدث بيانات مشفرة', async () => {
    const s = scenario()
    const original = join(s.installDir, 'shopsys.db')
    const text = encrypted(randomBytes(32), '{"state":{"balance":98765}}')
    const db = await create(original)
    try {
      db.raw.pragma('wal_autocheckpoint = 0')
      db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: text })
      expect(existsSync(original + '-wal')).toBe(true)
      point(s.userData, original)
      const safe = await protectDatabaseAt(s.userData, s.installDir)
      expect(isInsideInstallation(safe, s.installDir)).toBe(false)
      expect(existsSync(original)).toBe(true) // الأصل لم يُحذف بواسطة الحماية
      expect(await payload(safe)).toBe(text)
    } finally { db.close() }
    rmSync(s.installDir, { recursive: true, force: true }) // أثر إزالة النسخة القديمة
    const safe = resolveDbPathAt(s.userData).dbPath
    expect(await payload(safe)).toBe(text)
    expect(await protectDatabaseAt(s.userData, s.installDir)).toBe(safe)
  })

  it('المكان المستقل يبقى نفسه عبر التحديث، بلا نقل أو تغيير مؤشر', async () => {
    const s = scenario()
    const original = join(s.root, 'data', 'shopsys.db')
    ;(await create(original)).close()
    point(s.userData, original)
    const before = readFileSync(join(s.userData, 'db-location.json'), 'utf8')
    expect(await protectDatabaseAt(s.userData, s.installDir)).toBe(original)
    expect(readFileSync(join(s.userData, 'db-location.json'), 'utf8')).toBe(before)
  })

  it('نسخة الحماية لا تستبدل ملفاً موجوداً', async () => {
    const s = scenario()
    const a = join(s.root, 'a.db'), b = join(s.root, 'b.db')
    ;(await create(a)).close()
    writeFileSync(b, 'do not overwrite')
    await expect(copyDatabaseSafely(a, b)).rejects.toThrow('لن تُستبدل')
    expect(readFileSync(b, 'utf8')).toBe('do not overwrite')
  })

  it('فشل حماية ملف تالف لا يغيّر المؤشر ولا يحذف الأصل', async () => {
    const s = scenario(), file = join(s.installDir, 'shopsys.db')
    writeFileSync(file, 'broken')
    point(s.userData, file)
    await expect(protectDatabaseAt(s.userData, s.installDir)).rejects.toThrow()
    expect(resolveDbPathAt(s.userData).dbPath).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('broken')
  })

  it('ملف قديم مفقود داخل التثبيت لا يُعامل كقاعدة جديدة', async () => {
    const s = scenario(), file = join(s.installDir, 'shopsys.db')
    point(s.userData, file)
    await expect(protectDatabaseAt(s.userData, s.installDir)).rejects.toThrow('مفقودة')
    expect(resolveDbPathAt(s.userData).dbPath).toBe(file)
  })

  it('يرفض userData داخل مجلد التثبيت بدلاً من الحماية الوهمية', async () => {
    const s = scenario(), ud = join(s.installDir, 'state')
    mkdirSync(ud)
    ;(await create(join(ud, 'shopsys.db'))).close()
    await expect(protectDatabaseAt(ud, s.installDir)).rejects.toThrow('داخل مجلد التثبيت')
  })
})

describe('حدود المسار وروابط المجلد وتبديل الدرايف', () => {
  it('المجلد نفسه وأبناؤه ممنوعون، والمجلد المشابه اسماً ليس داخله', () => {
    expect(isInsideInstallation('D:\\ACCOUNTING\\Tahakom\\data\\shopsys.db', 'd:\\accounting\\tahakom')).toBe(true)
    expect(isInsideInstallation('D:\\accounting\\Tahakom-data\\shopsys.db', 'D:\\accounting\\Tahakom')).toBe(false)
    expect(isInsideInstallation('D:\\accounting\\Tahakom\\..\\data\\shopsys.db', 'D:\\accounting\\Tahakom')).toBe(false)
  })

  it('لا يمكن الالتفاف بـ symlink أو junction', () => {
    const s = scenario(), alias = join(s.root, 'alias')
    symlinkSync(s.installDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(isInsideInstallation(join(alias, 'new', 'shopsys.db'), s.installDir)).toBe(true)
    const outside = join(s.root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(s.installDir, 'outward'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(isInsideInstallation(join(s.installDir, 'outward', 'shopsys.db'), s.installDir)).toBe(true)
  })

  it('تبديل حرف القرص يحافظ على اسم المجلد المخصص كاملاً، ولا يتطلب مجلد Tahakom ثابتاً', () => {
    const paths = changedDrivePaths('D:\\بيانات المحل\\تجربة\\shopsys.db')
    expect(paths).toContain('E:\\بيانات المحل\\تجربة\\shopsys.db')
    expect(paths).not.toContain('D:\\بيانات المحل\\تجربة\\shopsys.db')
    expect(changedDrivePaths('/home/data/shopsys.db')).toEqual([])
  })
})

describe('الاسترداد الصامت قبل الحوار', () => {
  it('يفحص كل الأماكن ويختار أحدث نسخة سليمة مؤكدة الهوية، لا الساعي وحده', async () => {
    const s = scenario(), missing = join(s.root, 'data', 'shopsys.db'), secondary = join(s.root, 'second-backup')
    point(s.userData, missing)
    writeDbLocationAt(s.userData, { ...readDbLocationAt(s.userData), secondaryBackupDir: secondary })
    rememberDatabaseIdentity(s.userData, 'same-device')
    const files = [join(s.userData, 'backups', 'hourly', 'old.db'), join(dirname(missing), 'backups', 'auto', 'middle.db'), join(s.documentsBackupDir, 'manual', 'new.db'), join(secondary, 'auto', 'newest.db')]
    for (let i = 0; i < files.length; i++) {
      ;(await create(files[i], 'same-device', JSON.stringify({ state: { balance: i + 1 } }))).close()
      utimesSync(files[i], 1000 + i, 1000 + i)
    }
    const corrupt = join(secondary, 'auto', 'broken.db')
    writeFileSync(corrupt, 'SQLite broken')
    utimesSync(corrupt, 9000, 9000)
    expect(await recoverMissingDatabaseAt(s)).toBe(files[3])
    expect(await payload(resolveDbPathAt(s.userData).dbPath)).toBe('{"state":{"balance":4}}')
    expect(existsSync(missing)).toBe(false)
    expect(isInsideInstallation(resolveDbPathAt(s.userData).dbPath, s.installDir)).toBe(false)
  })

  it('يحاكي تغير حرف القرص بانتقال ملف فعلي؛ الحي يتقدم على نسخة قديمة ذات mtime أحدث', async () => {
    const s = scenario(), old = join(s.root, 'D', 'custom-name', 'shopsys.db'), moved = join(s.root, 'E', 'custom-name', 'shopsys.db')
    ;(await create(old, 'same-device', '{"state":{"balance":99}}')).close()
    point(s.userData, old)
    rememberDatabaseIdentity(s.userData, 'same-device')
    mkdirSync(dirname(moved), { recursive: true })
    renameSync(old, moved)
    const backup = join(s.documentsBackupDir, 'auto', 'old.db')
    ;(await create(backup, 'same-device', '{"state":{"balance":1}}')).close()
    utimesSync(backup, 9000000000, 9000000000)
    expect(await recoverMissingDatabaseAt({ ...s, relocatedPaths: [moved] })).toBe(moved)
    expect(await payload(resolveDbPathAt(s.userData).dbPath)).toBe('{"state":{"balance":99}}')
    expect(await payload(moved)).toBe('{"state":{"balance":99}}')
  })

  it('المفقود بلا هوية محفوظة يُسترد إذا أثبت مفتاح الجهاز صلاحية الحمولات المشفرة', async () => {
    const s = scenario(), key = randomBytes(32)
    const backup = join(s.documentsBackupDir, 'auto', 'backup.db')
    ;(await create(backup, 'same-device', encrypted(key, '{"state":{"balance":7}}'))).close()
    expect(await recoverMissingDatabaseAt({ ...s, deviceKey: key })).toBe(backup)
    expect(existsSync(resolveDbPathAt(s.userData).dbPath)).toBe(true)
  })

  it('لا يُسترد ملف مشفر بمفتاح آخر حتى لو كانت الهوية النصية مطابقة', async () => {
    const s = scenario()
    point(s.userData, join(s.root, 'missing.db'))
    rememberDatabaseIdentity(s.userData, 'same-device')
    ;(await create(join(s.documentsBackupDir, 'auto', 'backup.db'), 'same-device', encrypted(randomBytes(32), '{"state":{}}'))).close()
    expect(await recoverMissingDatabaseAt({ ...s, deviceKey: randomBytes(32) })).toBeNull()
  })

  it('لا يستبدل الموجود ولو كان تالفاً؛ درع التلف مستقل عن استرداد المفقود', async () => {
    const s = scenario(), existing = join(s.root, 'existing.db')
    writeFileSync(existing, 'keep broken original')
    point(s.userData, existing)
    rememberDatabaseIdentity(s.userData, 'same-device')
    ;(await create(join(s.documentsBackupDir, 'auto', 'backup.db'))).close()
    expect(await recoverMissingDatabaseAt(s)).toBeNull()
    expect(readFileSync(existing, 'utf8')).toBe('keep broken original')
  })

  it('قاعدة جهاز آخر أحدث لا تتقدم على النسخة الصحيحة', async () => {
    const s = scenario()
    point(s.userData, join(s.root, 'missing.db'))
    rememberDatabaseIdentity(s.userData, 'same-device')
    const good = join(s.documentsBackupDir, 'auto', 'good.db'), foreign = join(s.documentsBackupDir, 'auto', 'foreign.db')
    ;(await create(good)).close()
    ;(await create(foreign, 'other-device')).close()
    utimesSync(foreign, 9000000000, 9000000000)
    expect(await recoverMissingDatabaseAt(s)).toBe(good)
  })

  it('لا بيانات أو نسخة نصية مجهولة الهوية: لا إنشاء ولا تعديل للمؤشر', async () => {
    const s = scenario(), missing = join(s.root, 'missing.db')
    point(s.userData, missing)
    expect(await recoverMissingDatabaseAt(s)).toBeNull()
    ;(await create(join(s.documentsBackupDir, 'auto', 'unknown.db'))).close()
    expect(await recoverMissingDatabaseAt(s)).toBeNull()
    expect(resolveDbPathAt(s.userData).dbPath).toBe(missing)
    expect(existsSync(missing)).toBe(false)
  })
})

describe('تثبيت هوية userData — مجلد التشغيل الفعلي فقط', () => {
  it('يحفظ المفتاح والمؤشر وWAL في الاسم الثابت دون حذف المجلد الأصلي', async () => {
    const s = scenario(), current = join(s.root, 'current'), stable = join(s.root, 'fixed')
    mkdirSync(current)
    writeFileSync(join(current, 'device.key.enc'), 'encrypted key bytes')
    const db = await create(join(current, 'shopsys.db'))
    try {
      db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: '{"state":{"balance":88}}' })
      await preserveCurrentUserData(current, stable)
      expect(readFileSync(join(stable, 'device.key.enc'), 'utf8')).toBe('encrypted key bytes')
      expect(await payload(join(stable, 'shopsys.db'))).toBe('{"state":{"balance":88}}')
      expect(existsSync(join(current, 'shopsys.db'))).toBe(true)
    } finally { db.close() }
  })

  it('لا ترحيل لمجلد غير موجود، ولا دمج فوق مجلد ثابت موجود', async () => {
    const s = scenario(), current = join(s.root, 'absent'), stable = join(s.root, 'fixed')
    await preserveCurrentUserData(current, stable)
    expect(existsSync(stable)).toBe(true)
    expect(existsSync(current)).toBe(false)
    mkdirSync(current)
    writeFileSync(join(stable, 'device.key.enc'), 'existing stable key')
    writeFileSync(join(current, 'device.key.enc'), 'do not merge')
    await expect(preserveCurrentUserData(current, stable)).rejects.toThrow('مجلدا بيانات')
    expect(readFileSync(join(current, 'device.key.enc'), 'utf8')).toBe('do not merge')
  })
})

describe('تسلسل التحديث والإغلاق الحقيقي لقاعدة SQLite', () => {
  it('الحفظ ← الحماية ← نسخة حديثة ← close ← تثبيت ← exit؛ الملف نفسه يُفتح بعده', async () => {
    const s = scenario(), file = join(s.root, 'data', 'shopsys.db')
    const db = await create(file)
    const events: string[] = []
    const backup = join(s.userData, 'backups', 'pre-update', 'final.db')
    await installSilentUpdate({
      flush: async () => { events.push('flush'); db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: '{"state":{"balance":55}}' }) },
      protect: async () => { events.push('protect'); expect(isInsideInstallation(file, s.installDir)).toBe(false) },
      backup: async () => { events.push('backup'); await copyDatabaseSafely(file, backup) },
      close: () => { events.push('close'); db.close() },
      install: () => { events.push('install'); expect(db.raw.open).toBe(false) },
      exit: () => { events.push('exit') },
    })
    expect(events).toEqual(['flush', 'protect', 'backup', 'close', 'install', 'exit'])
    expect(await payload(file)).toBe('{"state":{"balance":55}}')
    const probe = new Database(backup, { readonly: true })
    try { expect(probe.pragma('integrity_check', { simple: true })).toBe('ok') } finally { probe.close() }
  })

  for (const failure of ['flush', 'protect', 'backup'] as const) {
    it(`فشل ${failure} يمنع إغلاق القاعدة وتشغيل المثبّت والخروج`, async () => {
      const events: string[] = []
      const prepare = async (name: string) => { events.push(name); if (name === failure) throw new Error('fail') }
      await expect(installSilentUpdate({
        flush: () => prepare('flush'), protect: () => prepare('protect'), backup: () => prepare('backup'),
        close: () => { events.push('close') }, install: () => { events.push('install') }, exit: () => { events.push('exit') },
      })).rejects.toThrow('fail')
      expect(events).not.toContain('close')
      expect(events).not.toContain('install')
      expect(events).not.toContain('exit')
    })
  }
})


describe('عقد electron-updater الفعلي (مع عزل تشغيل المثبّت عن الاختبار)', () => {
  it('ينشئ /S و --force-run و /D للمجلد السابق قبل process.exit، بلا اعتماد على quit', () => {
    const script = String.raw`
      const { NsisUpdater } = require('electron-updater');
      const calls = [];
      const updater = new NsisUpdater(null, { version: '1.0.24', onQuit: () => calls.push('quit-handler') });
      updater.logger = null;
      updater.autoInstallOnAppQuit = false;
      updater.installDirectory = 'D:\\accounting\\Tahakam\\Tahakom';
      updater.downloadedUpdateHelper = { file: 'C:\\cache\\setup.exe', downloadedFileInfo: { isAdminRightsRequired: false } };
      // المكتبة حقيقية؛ حدود نظام التشغيل فقط معزولة (لا تثبيت على آلة الاختبار).
      updater.spawnLog = (file, args) => { calls.push({ file, args }); return Promise.resolve(true) };
      updater.quitAndInstall(true, true);
      calls.push('exit');
      process.stdout.write(JSON.stringify(calls));
      process.exit(0);
    `
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 })
    expect(child.status, child.stderr).toBe(0)
    const calls = JSON.parse(child.stdout) as [{ file: string; args: string[] }, string]
    expect(calls[0].args).toEqual(['--updated', '/S', '--force-run', '/D=D:\\accounting\\Tahakam\\Tahakom'])
    expect(calls[1]).toBe('exit')
  })
})
