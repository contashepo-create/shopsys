/** حماية قاعدة البيانات من مجلد التثبيت واسترداد ملف مفقود — بلا Electron. */
import { existsSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, renameSync, unlinkSync, linkSync, statSync, rmSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute, win32 } from 'node:path'
import { createDecipheriv, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { probeShopsysDatabase, readDbLocationAt, resolveDbPathAt, writeDbLocationAt } from './dbLocation.ts'

/** يحل الروابط/junctions حتى لو كان الملف النهائي لم يُنشأ بعد. */
function physicalPath(p: string): string {
  let parent = resolve(p)
  const suffix: string[] = []
  while (!existsSync(parent) && dirname(parent) !== parent) {
    suffix.unshift(parent.slice(dirname(parent).length + 1))
    parent = dirname(parent)
  }
  try { return join(realpathSync(parent), ...suffix) } catch { return resolve(p) }
}

export function isInsideInstallation(file: string, installDir: string): boolean {
  // قواعد ويندوز حتى عند اختبارها على لينكس (case-insensitive + حدود المجلد).
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(file) && /^(?:[a-z]:[\\/]|\\\\)/i.test(installDir) && process.platform !== 'win32') {
    const rel = win32.relative(win32.resolve(installDir).toLowerCase(), win32.resolve(file).toLowerCase())
    return rel === '' || (!rel.startsWith('..\\') && rel !== '..' && !win32.isAbsolute(rel))
  }
  const contained = (base: string, target: string): boolean => {
    const rel = relative(base, target)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
  }
  // مسار داخل التثبيت يظل ممنوعاً حتى لو عبر junction إلى قرص خارجي؛ الرابط نفسه سيُحذف.
  return contained(resolve(installDir), resolve(file)) || contained(physicalPath(installDir), physicalPath(file))
}

/** نسخة SQLite متسقة تشمل WAL. لا استبدال لملف موجود، ولا حذف للأصل. */
export async function copyDatabaseSafely(source: string, destination: string): Promise<void> {
  if (existsSync(destination)) throw new Error('لن تُستبدل قاعدة موجودة أثناء الحماية أو الاسترداد')
  if (probeShopsysDatabase(source) !== 'ok') throw new Error('ملف قاعدة البيانات غير سليم أو غير قابل للقراءة')
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  const db = new Database(source, { readonly: true, fileMustExist: true })
  let operation = 'validate source connection'
  try {
    // الفحص على الاتصال الذي سينسخ نفسه؛ يفتح قارئ WAL قبل backup، لا اتصال منفصل فقط.
    if (db.pragma('quick_check', { simple: true }) !== 'ok' || !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshots'").get()) throw new Error('ملف قاعدة البيانات غير سليم')
    operation = 'exclusive temporary creation'
    // امتلاك ملف الوجهة حصرياً عبر fs قبل فتح SQLite له؛ لا overwrite حتى للمؤقت.
    writeFileSync(temporary, Buffer.alloc(0), { flag: 'wx', mode: 0o600 })
    operation = 'SQLite backup'
    // Windows قد يحتفظ مؤقتاً بقفل WAL/ملف بعد غلق آخر قارئ أو فحصه.
    // مهلة محدودة لأخطاء الفتح/القفل فقط؛ أي فساد/إذن دائم يوقف النسخ.
    for (let attempt = 0; ; attempt++) {
      try { await db.backup(temporary); break } catch (error) {
        const code = String((error as { code?: unknown }).code ?? '')
        if (attempt >= 3 || !/^SQLITE_(CANTOPEN|BUSY|LOCKED)(_|$)/.test(code)) throw error
        await new Promise(resolveDelay => setTimeout(resolveDelay, 200 * (attempt + 1)))
        // Backup API قد يزيل وجهته الفاشلة بنفسه؛ ENOENT هنا ليس فشل إعادة المحاولة.
        rmSync(temporary, { force: true })
        writeFileSync(temporary, Buffer.alloc(0), { flag: 'wx', mode: 0o600 })
      }
    }
    operation = 'checkpoint private snapshot'
    // لا ننشر hardlink لملف يعتمد على WAL باسم المؤقت؛ الوجهة الخاصة فقط قابلة للكتابة.
    const snapshot = new Database(temporary, { fileMustExist: true })
    try {
      const checkpoint = snapshot.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
      if (checkpoint.some(row => row.busy !== 0)) throw new Error('نسخة SQLite المؤقتة ما زالت مقفلة')
      if (snapshot.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('لم تصبح نسخة SQLite ملفاً مستقلاً')
    } finally { snapshot.close() }
    operation = 'verify temporary'
    if (probeShopsysDatabase(temporary) !== 'ok') throw new Error('فشل التحقق من نسخة قاعدة البيانات')
    // نشر ذري دون overwrite؛ الملف المؤقت على نفس القرص.
    operation = 'atomic publish'
    linkSync(temporary, destination)
  } catch (error) {
    throw new Error(`${operation}: ${(error as Error).message}; source=${source}; destination=${destination}; temporary=${temporary}`, { cause: error })
  } finally {
    db.close()
    try { unlinkSync(temporary) } catch { /* قد لم تُنشأ النسخة */ }
  }
}

export async function protectDatabaseAt(ud: string, installDir: string): Promise<string> {
  const { dbPath } = resolveDbPathAt(ud)
  if (!isInsideInstallation(dbPath, installDir)) return dbPath
  const destination = join(ud, 'databases', `shopsys-${randomUUID()}.db`)
  if (isInsideInstallation(destination, installDir)) throw new Error('مجلد بيانات المستخدم نفسه داخل مجلد التثبيت — لا يمكن التحديث بأمان')
  if (existsSync(dbPath)) await copyDatabaseSafely(dbPath, destination)
  else if (readDbLocationAt(ud).customDbOpenedAt) throw new Error('قاعدة البيانات القديمة مفقودة — لم يُغيَّر مسارها')
  const cfg = readDbLocationAt(ud)
  writeDbLocationAt(ud, { ...cfg, customDbPath: destination, customDbOpenedAt: existsSync(destination) ? new Date().toISOString() : null })
  return destination
}

/** لا نبدّل المؤشر تحت اتصال مفتوح؛ عند فشل النسخة يجب أن تبقى الكتابة على القاعدة نفسها. */
export function assertSafeUpdateLocation(ud: string, installDir: string, activePath: string): void {
  if (isInsideInstallation(activePath, installDir)) throw new Error('قاعدة التشغيل داخل مجلد التثبيت — أعد تشغيل النسخة المصلحة لحمايتها قبل التحديث')
  const pointedPath = resolveDbPathAt(ud).dbPath
  if (physicalPath(pointedPath) !== physicalPath(activePath)) throw new Error('تغيّر مؤشر قاعدة البيانات أثناء التشغيل — لم يبدأ التحديث، أعد تشغيل البرنامج')
}

export interface RecoveryOptions {
  userData: string
  installDir: string
  documentsBackupDir: string
  /** تبديل حرف القرص: نفس اللاحقة فقط، لا مسح شامل لمحتويات الأقراص. */
  relocatedPaths?: string[]
  deviceKey?: Buffer
}

export function changedDrivePaths(savedPath: string): string[] {
  if (!/^[a-z]:[\\/]/i.test(savedPath)) return []
  return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter(letter => letter !== savedPath[0].toUpperCase()).map(letter => letter + savedPath.slice(1))
}

export function recoveryBackupDirs(options: RecoveryOptions, expectedPath: string): string[] {
  const cfg = readDbLocationAt(options.userData)
  const bases = [join(dirname(expectedPath), 'backups'), join(options.userData, 'backups'), options.documentsBackupDir]
  if (cfg.secondaryBackupDir) bases.push(cfg.secondaryBackupDir)
  return [...new Set(bases.flatMap(base => [base, ...['manual', 'auto', 'hourly', 'pre-update'].map(kind => join(base, kind))]))]
}

function identityPath(ud: string): string { return join(ud, 'database-identity.json') }
export function rememberDatabaseIdentity(ud: string, deviceId: string): void {
  const file = identityPath(ud)
  const temp = file + '.tmp'
  writeFileSync(temp, JSON.stringify({ deviceId }), 'utf8')
  renameSync(temp, file)
}

function savedIdentity(ud: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(identityPath(ud), 'utf8')) as { deviceId?: unknown }
    return typeof parsed.deviceId === 'string' ? parsed.deviceId : null
  } catch { return null }
}

/** لا نعتمد نسخة مشفرة بمفتاح آخر؛ ولا قاعدة نصية مجهولة الهوية تلقائياً. */
function candidateIdentity(file: string, expectedId: string | null, key?: Buffer): string | null {
  if (probeShopsysDatabase(file) !== 'ok') return null
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'device_id'").get() as { value: string } | undefined
    if (!row || (expectedId && row.value !== expectedId)) return null
    const snapshots = db.prepare('SELECT payload_json FROM snapshots WHERE payload_json IS NOT NULL').all() as { payload_json: string }[]
    let verified = false
    for (const { payload_json: text } of snapshots) {
      if (!text.startsWith('enc:')) continue
      if (!key || !text.startsWith('enc:v1:')) return null
      const parts = text.split(':')
      if (parts.length !== 4) return null
      const bytes = Buffer.from(parts[3], 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'))
      decipher.setAuthTag(bytes.subarray(-16))
      const plain = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8')
      JSON.parse(plain)
      verified = true
    }
    return expectedId || verified ? row.value : null
  } catch { return null } finally { db.close() }
}

/** مراجعات المتاجر تتقدم على mtime: الملف قد يكتسب وقتاً أحدث عند النسخ/فحص WAL.
 * المقارنة فقط لنفس كاتب/فرع كل متجر؛ لا نستنتج ترتيب نسختين متفرعتين. */
function snapshotVersions(file: string): Map<string, { revision: number; origin: string }> {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare('SELECT store_name, revision, origin_device, origin_branch FROM snapshots').all() as { store_name: string; revision: number; origin_device: string; origin_branch: string }[]
    return new Map(rows.map(row => [row.store_name, { revision: row.revision, origin: JSON.stringify([row.origin_device, row.origin_branch]) }]))
  } finally { db.close() }
}
function newerSnapshots(a: ReturnType<typeof snapshotVersions>, b: ReturnType<typeof snapshotVersions>): boolean {
  let advanced = false
  for (const [store, previous] of b) {
    const current = a.get(store)
    if (!current || current.origin !== previous.origin || current.revision < previous.revision) return false
    if (current.revision > previous.revision) advanced = true
  }
  return advanced || a.size > b.size
}

/** الموجود لا يُمسّ ولو كان مقفلاً/تالفاً؛ الاسترداد للمفقود فقط. */
export async function recoverMissingDatabaseAt(options: RecoveryOptions): Promise<string | null> {
  const { userData: ud, installDir } = options
  const { dbPath } = resolveDbPathAt(ud)
  if (existsSync(dbPath)) return null
  const expectedId = savedIdentity(ud)
  const live = [...new Set(options.relocatedPaths ?? changedDrivePaths(dbPath))]
  const legacy = [join(ud, 'shopsys.db'), join(installDir, 'shopsys.db')]
  if (!readDbLocationAt(ud).customDbPath) {
    try { for (const name of readdirSync(join(ud, 'databases'))) if (name.endsWith('.db')) live.push(join(ud, 'databases', name)) } catch { /* لا مجلد حماية سابق */ }
  }
  const backups: string[] = []
  for (const dir of recoveryBackupDirs(options, dbPath)) {
    try {
      for (const file of readdirSync(dir)) if (file.endsWith('.db')) backups.push(join(dir, file))
    } catch { /* قرص مفصول أو مجلد غير موجود */ }
  }
  const eligible = (files: string[]) => files.flatMap(file => {
    try {
      const id = candidateIdentity(file, expectedId, options.deviceKey)
      return id ? [{ file, id, time: statSync(file).mtimeMs, versions: snapshotVersions(file) }] : []
    } catch { return [] }
  }).sort((a, b) => b.time - a.time)
  // قاعدة حية موثوقة أولاً؛ بعدها أحدث نسخة سليمة من كل الأماكن.
  const liveCandidates = eligible(live)
  const candidates = liveCandidates.length ? liveCandidates : eligible([...new Set([...backups, ...legacy])])
  if (!candidates.length || new Set(candidates.map(candidate => candidate.id)).size > 1) return null
  // لا تختَر نسخة ذات مراجعات أقدم لمجرد أن mtime ملفها أحدث.
  const freshest = candidates.filter(candidate => !candidates.some(other => other !== candidate && newerSnapshots(other.versions, candidate.versions)))
  for (const source of freshest) {
    try {
      const destination = join(ud, 'databases', `recovered-${randomUUID()}.db`)
      if (isInsideInstallation(destination, installDir)) throw new Error('مكان الاسترداد داخل مجلد التثبيت')
      await copyDatabaseSafely(source.file, destination)
      rememberDatabaseIdentity(ud, source.id)
      writeDbLocationAt(ud, { ...readDbLocationAt(ud), customDbPath: destination, customDbOpenedAt: new Date().toISOString() })
      return source.file
    } catch (error) {
      console.warn('[db-recovery] Candidate copy failed:', (error as Error).message)
      /* التالية، دون لمس الأصل أو استبدال ملف */
    }
  }
  return null
}
