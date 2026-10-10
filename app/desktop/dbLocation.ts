/**
 * مكان قاعدة البيانات (v1.0.22) — منطق خالص بلا Electron: كل دالة تستقبل مجلد
 * البيانات (userData) صراحةً، فيُختبر على ملفات حقيقية. main.ts يغلّفها بنفس
 * الأسماء القديمة ويمرّر app.getPath('userData') — لا تغيير في السلوك.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, win32 } from 'node:path'
import Database from 'better-sqlite3'
import { customLocationStatus, decodeLocationPointer, encodeLocationPointer, type CustomLocationStatus } from './storagePolicy.ts'

export interface DbLocationConfig {
  customDbPath: string | null
  secondaryBackupDir: string | null
  lastFileBackupAt: string | null
  /** v1.0.22: متى فُتحت القاعدة المخصصة أول مرة — لكشف «الملف اختفى» بدل إنشاء فارغة */
  customDbOpenedAt: string | null
}

export const EMPTY_DB_LOCATION: DbLocationConfig = {
  customDbPath: null, secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null,
}

export function dbLocationFileAt(ud: string): string {
  return join(ud, 'db-location.json')
}

/** مرآة المؤشر في المكان الافتراضي دائماً، وبجوار القاعدة المخصصة إن وُجدت */
export function locationPointerMirrorsAt(ud: string, cfg: DbLocationConfig): string[] {
  const out = [join(ud, 'backups', 'db-location.json')]
  if (cfg.customDbPath) out.push(join(dirname(cfg.customDbPath), 'backups', 'db-location.json'))
  return out
}

/**
 * v1.0.22 (طلب المالك): مسار القاعدة المخزّن يجب أن يكون مطلقاً دائماً.
 * نفحص بقواعد ويندوز و POSIX معاً: على لينكس path.isAbsolute لا يعرف «D:\…»،
 * وعلى ويندوز لا يعرف «/home/…» — والمؤشّر قد يُنقل بين البيئتين.
 */
export function isAbsoluteDbPath(p: string): boolean {
  return typeof p === 'string' && p.trim() !== '' && (win32.isAbsolute(p) || posix.isAbsolute(p))
}

export function readDbLocationAt(ud: string): DbLocationConfig {
  try {
    const parsed = JSON.parse(readFileSync(dbLocationFileAt(ud), 'utf8')) as Partial<DbLocationConfig>
    const rawPath = typeof parsed.customDbPath === 'string' && parsed.customDbPath.trim() ? parsed.customDbPath : null
    return {
      // مسار نسبي في المؤشّر ⇒ يُتجاهل (يُعامل كغير موجود)، فيُطلب من المستخدم اختيار الملف بدل فتح قاعدة فارغة
      customDbPath: rawPath && isAbsoluteDbPath(rawPath) ? rawPath : null,
      secondaryBackupDir: typeof parsed.secondaryBackupDir === 'string' && parsed.secondaryBackupDir.trim() ? parsed.secondaryBackupDir : null,
      lastFileBackupAt: typeof parsed.lastFileBackupAt === 'string' ? parsed.lastFileBackupAt : null,
      customDbOpenedAt: typeof parsed.customDbOpenedAt === 'string' ? parsed.customDbOpenedAt : null,
    }
  } catch {
    return { ...EMPTY_DB_LOCATION }
  }
}

/** الكتابة تُرآى في كل مكان للمؤشر. فشل مرآة لا يوقف الكتابة الأساسية. */
export function writeDbLocationAt(ud: string, cfg: DbLocationConfig, onMirrorError?: (message: string) => void): void {
  if (cfg.customDbPath !== null && !isAbsoluteDbPath(cfg.customDbPath)) {
    throw new Error(`مسار قاعدة البيانات يجب أن يكون مطلقاً: ${cfg.customDbPath}`)
  }
  const text = encodeLocationPointer(cfg as DbLocationConfig & Record<string, unknown>)
  writeFileSync(dbLocationFileAt(ud), text, 'utf8')
  for (const mirror of locationPointerMirrorsAt(ud, cfg)) {
    try {
      mkdirSync(dirname(mirror), { recursive: true })
      writeFileSync(mirror, text, 'utf8')
    } catch (error) {
      onMirrorError?.(`تعذّرت مرآة المؤشر في ${mirror}: ${(error as Error).message}`)
    }
  }
}

/**
 * ملف التوجيه مفقود ⇒ استعادته من المرآة في المكان الافتراضي. يعيد المسار
 * المستعاد أو null. ملاحظة: المرآة الثانية (بجوار القاعدة المخصصة) لا تُقرأ هنا لأن
 * موقعها يتوقف على المسار نفسه — فلا تُستعمل للاستعادة التلقائية.
 */
export function restoreLocationPointerAt(ud: string): string | null {
  if (existsSync(dbLocationFileAt(ud))) return null
  try {
    const cfg = decodeLocationPointer(readFileSync(join(ud, 'backups', 'db-location.json'), 'utf8'))
    if (!cfg || !cfg.customDbPath) return null
    writeDbLocationAt(ud, { ...readDbLocationAt(ud), ...cfg })
    return cfg.customDbPath
  } catch {
    return null
  }
}

export function customDbStatusAt(ud: string): { status: CustomLocationStatus; path: string | null } {
  const cfg = readDbLocationAt(ud)
  if (!cfg.customDbPath) return { status: 'none', path: null }
  const status = customLocationStatus(cfg, {
    folderExists: existsSync(dirname(cfg.customDbPath)),
    fileExists: existsSync(cfg.customDbPath),
  })
  return { status, path: cfg.customDbPath }
}

export function resolveDbPathAt(ud: string): { dbPath: string; isCustom: boolean } {
  const cfg = readDbLocationAt(ud)
  if (cfg.customDbPath) return { dbPath: cfg.customDbPath, isCustom: true }
  return { dbPath: join(ud, 'shopsys.db'), isCustom: false }
}

/** v1.0.22: حفظ مكان مخصص مختار من المستخدم — المسار المطلق فقط */
export function setCustomDbPathAt(ud: string, absolutePath: string, onMirrorError?: (message: string) => void): void {
  if (!isAbsoluteDbPath(absolutePath)) throw new Error(`مسار قاعدة البيانات يجب أن يكون مطلقاً: ${absolutePath}`)
  writeDbLocationAt(ud, { ...readDbLocationAt(ud), customDbPath: absolutePath, customDbOpenedAt: null }, onMirrorError)
}

/**
 * دليل على تشغيل سابق لهذا المجلد: مجلد النسخ (يُنشأ عند أول فتح لأي قاعدة)،
 * أو علامة آخر إصدار مُشغَّل (last-run.json)، أو مؤشر المكان نفسه (كُتب يوماً باختيار صريح).
 * المجلد الجديد تماماً لا يحمل أيّاً منها.
 * ملاحظة: ملفات يكتبها التطبيق قبل فتح القاعدة (مفتاح الجهاز) لا تُحتسب هنا عمداً.
 */
export function hasPreviousUseEvidenceAt(ud: string): boolean {
  return existsSync(join(ud, 'backups')) || existsSync(join(ud, 'last-run.json')) || existsSync(dbLocationFileAt(ud))
}

/**
 * قرار الطلب: لا ينشئ التطبيق قاعدة فارغة صامتاً إذا وُجد دليل تشغيل سابق
 * ولم يُعثر على القاعدة. التثبيت الجديد (بلا دليل) يمر بلا حوار.
 */
export function shouldAskForExistingDatabase(input: { resolvedDbExists: boolean; previousUse: boolean }): boolean {
  return !input.resolvedDbExists && input.previousUse
}

export type ShopsysDbProbe = 'ok' | 'not-shopsys' | 'corrupt' | 'unreadable'

/**
 * فحص ملف يختاره المستخدم قبل اعتماده: سليم وفيه جدول المحفوظات (snapshots) الخاص بتَحَكَّم.
 * يُفتح للقراءة فقط ولا يعدّل الملف.
 */
export function probeShopsysDatabase(dbPath: string): ShopsysDbProbe {
  if (!existsSync(dbPath)) return 'unreadable'
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    if (db.pragma('quick_check', { simple: true }) !== 'ok') return 'corrupt'
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'snapshots'").get()
    return row ? 'ok' : 'not-shopsys'
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unreadable'
  } finally {
    try { db?.close() } catch { /* لا شيء */ }
  }
}
