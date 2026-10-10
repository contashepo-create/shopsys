/**
 * مكان قاعدة البيانات (v1.0.22) — منطق خالص بلا Electron: كل دالة تستقبل مجلد
 * البيانات (userData) صراحةً، فيُختبر على ملفات حقيقية. main.ts يغلّفها بنفس
 * الأسماء القديمة ويمرّر app.getPath('userData') — لا تغيير في السلوك.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

export function readDbLocationAt(ud: string): DbLocationConfig {
  try {
    const parsed = JSON.parse(readFileSync(dbLocationFileAt(ud), 'utf8')) as Partial<DbLocationConfig>
    return {
      customDbPath: typeof parsed.customDbPath === 'string' && parsed.customDbPath.trim() ? parsed.customDbPath : null,
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
