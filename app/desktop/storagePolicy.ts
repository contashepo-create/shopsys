/**
 * سياسة التخزين والنسخ الاحتياطي (v1.0.22) — منطق خالص بلا Electron.
 * ─────────────────────────────────────────────────────────────────────
 * الهدف: بعد أي تحديث أو إعادة تشغيل يجد العميل بياناته كما كانت، سواء كانت القاعدة
 * في المكان الافتراضي (%APPDATA%\Tahakom) أو في مكان اختاره.
 *
 *   • المكان الافتراضي يحتفظ دائماً بنسخ ساعية (`backups/hourly`) حتى لو كانت
 *     القاعدة الحية في مكان مخصص — آخر 24 نسخة فقط (يوم واحد).
 *   • قبل تثبيت أي تحديث تُؤخذ نسخة مستقلة (`backups/pre-update`) وتُحفظ 5 نسخ.
 *   • مؤشر المكان المخصص (`db-location.json`) يُرآة في المكان الافتراضي
 *     (`backups/db-location.json`) وفي مجلد القاعدة نفسه، فيُستعاد تلقائياً لو فُقد.
 *   • قاعدة مخصصة مؤشَّر إليها و**مفتوحة من قبل** لكن ملفها غاب ⇒ حالة «مفقودة»
 *     (لا إنشاء قاعدة فارغة صامتاً). قاعدة لم تُفتح بعد (معالج جديد) ⇒ طبيعية.
 */

export const ROTATION = {
  hourly: { keep: 24, ms: 60 * 60 * 1000 },
  daily: { keep: 30, ms: 24 * 60 * 60 * 1000 },
  weekly: { keep: 12, ms: 7 * 24 * 60 * 60 * 1000 },
} as const

export type RotationKind = keyof typeof ROTATION

/** نسخة قبل التحديث: الاحتفاظ بآخر 5 فقط (تكفي للتراجع اليدوي عن أي تحديث أخير) */
export const PRE_UPDATE_KEEP = 5

/** لقطة ملف لأغراض الترتيب — mtime بالمللي ثانية */
export interface FileStamp {
  path: string
  mtimeMs: number
}

/** الأحدث أولاً */
export function newestFirst<T extends FileStamp>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** ما يبقى بعد التقليم: أحدث `keep` ملفاً، والباقي يُحذف */
export function filesToPrune<T extends FileStamp>(files: readonly T[], keep: number): T[] {
  const sorted = newestFirst(files)
  return sorted.slice(Math.max(0, keep))
}

/* ── مؤشر المكان المخصص ── */

export interface DbLocationState {
  customDbPath: string | null
  /** متى فُتحت القاعدة المخصصة للمرة الأولى — علامة أن ملفها «كان موجوداً» */
  customDbOpenedAt: string | null
}

export type CustomLocationStatus =
  /** لا مكان مخصص — الافتراضي */
  | 'none'
  /** المكان المخصص جاهز */
  | 'ok'
  /** المجلد نفسه غير موصول (قرص مفصول / تغيّر الدرايف) */
  | 'folder-missing'
  /** المجلد موجود والملف كان مفتوحاً من قبل لكنه غاب الآن — لا إنشاء صامت */
  | 'file-missing'

export function customLocationStatus(
  cfg: DbLocationState,
  probe: { folderExists: boolean; fileExists: boolean },
): CustomLocationStatus {
  if (!cfg.customDbPath) return 'none'
  if (!probe.folderExists) return 'folder-missing'
  if (!probe.fileExists && cfg.customDbOpenedAt) return 'file-missing'
  return 'ok'
}

/** صيغة المؤشر المرآة — تُكتب كما هي في كل مكان، وتُقرأ بالتحقق نفسه */
export function encodeLocationPointer(cfg: DbLocationState & Record<string, unknown>): string {
  return JSON.stringify(cfg, null, 2)
}

export function decodeLocationPointer(raw: string | null | undefined): DbLocationState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DbLocationState>
    const customDbPath = typeof parsed.customDbPath === 'string' && parsed.customDbPath.trim() ? parsed.customDbPath : null
    const customDbOpenedAt = typeof parsed.customDbOpenedAt === 'string' ? parsed.customDbOpenedAt : null
    return { customDbPath, customDbOpenedAt }
  } catch {
    return null
  }
}

/* ── اكتشاف البيانات السابقة عند أول تشغيل بلا مؤشر ── */

export interface ExistingDataCandidate extends FileStamp {
  /** live = ملف قاعدة حيّ يُفتح في مكانه · backup = نسخة تُنسخ إلى المكان الافتراضي */
  kind: 'live' | 'backup'
  /** وصف عربي للمكان يُعرض للمستخدم */
  whereAr: string
}

/**
 * نختار أفضل مرشح: الحيّ أولاً (هو الأحدث بالتعريف إن وُجد)، ثم أحدث نسخة.
 * الحيّ يتقدّم على النسخة مهما كان تاريخها لأن النسخة قد تكون أقدم من الحيّ.
 */
export function bestExistingCandidate(list: readonly ExistingDataCandidate[]): ExistingDataCandidate | null {
  if (!list.length) return null
  const live = newestFirst(list.filter((c) => c.kind === 'live'))
  if (live.length) return live[0]
  return newestFirst(list)[0]
}

/**
 * أحدث نسخة من مجموعة (لاستعادة «آخر نسخة» عند فقدان القاعدة الحية).
 */
export function latestBackup<T extends FileStamp>(list: readonly T[]): T | null {
  return newestFirst(list)[0] ?? null
}
