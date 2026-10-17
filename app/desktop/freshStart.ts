/** بدء قاعدة أعمال جديدة بإقرار صريح، مع حفظ ملف القاعدة السابق دون حذفه. */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyDatabaseSafely, isUnsafeDatabaseLocation } from './databaseSafety.ts'
import { readDbLocationAt, resolveDbPathAt, writeDbLocationAt } from './dbLocation.ts'

export const FRESH_START_MARKER = 'fresh-start.json'
const FRESH_START_MTIME_TOLERANCE_MS = 5_000

export interface FreshStartMarker {
  format: 1
  startedAt: string
  archivePath: string | null
  excludedPaths: string[]
}

export interface FreshStartOptions {
  userData: string
  databasePath: string
  installDir: string
  /** ملفات القاعدة/النسخ الموجودة قبل الاختيار، لمنع اعتماد mtime حديث عَرَضي. */
  excludedPaths?: string[]
  now?: Date
}

export interface FreshStartWithoutDatabaseOptions {
  userData: string
  installDir: string
  archiveSource?: string | null
  excludedPaths?: string[]
  now?: Date
}

export interface FreshStartResult {
  archivePath: string | null
  startedAt: string
}

export function freshStartMarkerPathAt(userData: string): string {
  return join(userData, FRESH_START_MARKER)
}

export function readFreshStartMarkerAt(userData: string): FreshStartMarker | null {
  try {
    const value = JSON.parse(readFileSync(freshStartMarkerPathAt(userData), 'utf8')) as Partial<FreshStartMarker>
    if (value.format !== 1 || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) return null
    if (value.archivePath !== null && (typeof value.archivePath !== 'string' || !value.archivePath.trim())) return null
    const excludedPaths = Array.isArray(value.excludedPaths) ? value.excludedPaths.filter((path): path is string => typeof path === 'string' && !!path.trim()) : []
    return { format: 1, startedAt: value.startedAt, archivePath: value.archivePath ?? null, excludedPaths }
  } catch {
    return null
  }
}

/** حد زمني يتسامح مع تقريب mtime في بعض أنظمة الملفات، ولا يضم النسخ القديمة عادةً. */
export function freshStartCutoffAt(userData: string): number | null {
  const marker = readFreshStartMarkerAt(userData)
  if (!marker) return null
  return Math.max(0, Date.parse(marker.startedAt) - FRESH_START_MTIME_TOLERANCE_MS)
}

function comparablePath(path: string): string {
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(path)) return win32.normalize(path).toLowerCase()
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** بعد بدء نظيف صريح، لا تدخل النسخ السابقة في الاسترداد أو الاكتشاف التلقائي. */
export function isCurrentFreshStartDataAt(userData: string, file: string): boolean {
  const marker = readFreshStartMarkerAt(userData)
  if (!marker) return true
  const path = comparablePath(file)
  if (marker.excludedPaths.some(excluded => comparablePath(excluded) === path)) return false
  const cutoff = Math.max(0, Date.parse(marker.startedAt) - FRESH_START_MTIME_TOLERANCE_MS)
  try { return statSync(file).mtimeMs >= cutoff } catch { return false }
}

/** ملفات النسخ السابقة لا تُقلمها سياسات الاحتفاظ بعد إقرار البدء النظيف. */
export function freshStartEligibleFilesAt<T extends { path: string }>(userData: string, files: readonly T[]): T[] {
  return files.filter(file => isCurrentFreshStartDataAt(userData, file.path))
}

function writeMarkerAt(userData: string, marker: FreshStartMarker): void {
  const destination = freshStartMarkerPathAt(userData)
  const temporary = `${destination}.${randomUUID()}.tmp`
  mkdirSync(userData, { recursive: true })
  try {
    writeFileSync(temporary, JSON.stringify(marker, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, destination)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* قد لا يكون قد أُنشئ */ }
    throw new Error(`تعذّر تثبيت علامة البدء النظيف: ${(error as Error).message}`)
  }
}

function restoreMarkerAt(userData: string, previous: string | null): void {
  const destination = freshStartMarkerPathAt(userData)
  if (previous === null) {
    try { unlinkSync(destination) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return
  }
  const temporary = `${destination}.${randomUUID()}.rollback.tmp`
  writeFileSync(temporary, previous, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  renameSync(temporary, destination)
}

function restoreDefaultSource(databasePath: string, archivePath: string): void {
  const moves = [
    { from: `${archivePath}.source`, to: databasePath },
    { from: `${archivePath}.source-shm`, to: `${databasePath}-shm` },
    { from: `${archivePath}.source-wal`, to: `${databasePath}-wal` },
  ]
  for (const move of moves) {
    if (!existsSync(move.from)) continue
    if (existsSync(move.to)) throw new Error(`يتعذّر إرجاع المصدر لأن الملف موجود: ${move.to}`)
    renameSync(move.from, move.to)
  }
}

function clearDatabaseLocationAt(userData: string): void {
  const current = readDbLocationAt(userData)
  writeDbLocationAt(userData, {
    ...current,
    customDbPath: null,
    customDbOpenedAt: null,
    lastFileBackupAt: null,
  })
}

function freshStartArchivePath(userData: string, installDir: string, startedAt: string): string {
  const stamp = startedAt.replace(/[:.]/g, '-')
  const archivePath = join(userData, 'archives', `shopsys-before-fresh-start-${stamp}-${randomUUID()}.db`)
  if (isUnsafeDatabaseLocation(archivePath, installDir, userData)) throw new Error('لا يمكن حفظ الأرشيف بأمان خارج مجلد التثبيت؛ لم تُغيَّر القاعدة')
  return archivePath
}

/**
 * يُبقي نسخة SQLite متسقة في الأرشيف، ثم يفصل قاعدة التشغيل القديمة ويعيد
 * مؤشر المكان إلى الافتراضي. لا يمسح النسخ القديمة؛ علامة الزمن تمنع استعادتها
 * تلقائياً بعد أن يختار المالك البدء من جديد.
 */
export async function startFreshDatabaseAt(options: FreshStartOptions): Promise<FreshStartResult> {
  const { userData, databasePath, installDir } = options
  const selected = resolveDbPathAt(userData).dbPath
  if (resolve(selected) !== resolve(databasePath)) throw new Error('تغيّر مسار قاعدة البيانات — أعد المحاولة قبل بدء قاعدة جديدة')
  if (!existsSync(databasePath)) throw new Error('قاعدة البيانات الحالية غير موجودة؛ لم يُغيَّر أي ملف')

  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('تاريخ بدء القاعدة الجديدة غير صالح')
  const startedAt = now.toISOString()
  const archivePath = freshStartArchivePath(userData, installDir, startedAt)

  // النسخ والتحقق يسبقان أي تغيير للمؤشر أو لاسم القاعدة الحالية.
  await copyDatabaseSafely(databasePath, archivePath)
  const markerPath = freshStartMarkerPathAt(userData)
  const previousMarker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null
  const previousLocation = readDbLocationAt(userData)
  const defaultPath = join(userData, 'shopsys.db')
  const isDefault = resolve(databasePath) === resolve(defaultPath)
  let sourceTouched = false
  try {
    // العلامة تسبق فصل المصدر كي لا يعيد الإقلاع استرداد نسخ قديمة بعد انقطاع مفاجئ.
    writeMarkerAt(userData, {
      format: 1, startedAt, archivePath,
      excludedPaths: [...new Set([databasePath, ...(options.excludedPaths ?? [])])],
    })
    if (isDefault) {
      sourceTouched = true
      preserveDefaultSource(databasePath, archivePath)
    }
    clearDatabaseLocationAt(userData)
    return { archivePath, startedAt }
  } catch (error) {
    const rollbackErrors: string[] = []
    if (sourceTouched) {
      try { restoreDefaultSource(databasePath, archivePath) } catch (rollbackError) { rollbackErrors.push((rollbackError as Error).message) }
    }
    try { writeDbLocationAt(userData, previousLocation) } catch (rollbackError) { rollbackErrors.push((rollbackError as Error).message) }
    try { restoreMarkerAt(userData, previousMarker) } catch (rollbackError) { rollbackErrors.push((rollbackError as Error).message) }
    const original = (error as Error).message
    if (rollbackErrors.length) throw new Error(`تعذّر إكمال البدء النظيف (${original})؛ تعذّر إكمال التراجع: ${rollbackErrors.join('؛ ')}`)
    throw new Error(`تعذّر إكمال البدء النظيف؛ أُعيدت الإعدادات السابقة: ${original}`)
  }
}

/** خيار «بدء جديد» من شاشة اكتشاف البيانات أو عند غياب ملف القاعدة. */
export async function startFreshWithoutDatabaseAt(options: FreshStartWithoutDatabaseOptions): Promise<FreshStartResult> {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('تاريخ بدء القاعدة الجديدة غير صالح')
  const startedAt = now.toISOString()
  let archivePath: string | null = null
  if (options.archiveSource) {
    if (!existsSync(options.archiveSource)) throw new Error('اختفت نسخة البيانات قبل أرشفتها؛ لم تُغيَّر قاعدة البيانات')
    archivePath = freshStartArchivePath(options.userData, options.installDir, startedAt)
    await copyDatabaseSafely(options.archiveSource, archivePath)
  }
  const markerPath = freshStartMarkerPathAt(options.userData)
  const previousMarker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null
  const previousLocation = readDbLocationAt(options.userData)
  try {
    writeMarkerAt(options.userData, {
      format: 1, startedAt, archivePath,
      excludedPaths: [...new Set([...(options.archiveSource ? [options.archiveSource] : []), ...(options.excludedPaths ?? [])])],
    })
    clearDatabaseLocationAt(options.userData)
    return { archivePath, startedAt }
  } catch (error) {
    const rollbackErrors: string[] = []
    try { writeDbLocationAt(options.userData, previousLocation) } catch (rollbackError) { rollbackErrors.push((rollbackError as Error).message) }
    try { restoreMarkerAt(options.userData, previousMarker) } catch (rollbackError) { rollbackErrors.push((rollbackError as Error).message) }
    const original = (error as Error).message
    if (rollbackErrors.length) throw new Error(`تعذّر إكمال البدء النظيف (${original})؛ تعذّر إكمال التراجع: ${rollbackErrors.join('؛ ')}`)
    throw new Error(`تعذّر إكمال البدء النظيف؛ أُعيدت الإعدادات السابقة: ${original}`)
  }
}

/** ينقل الملف الافتراضي وملفات WAL/SHM جانباً فقط بعد نجاح أرشفة SQLite. */
function preserveDefaultSource(databasePath: string, archivePath: string): void {
  const moves = [
    { from: `${databasePath}-wal`, to: `${archivePath}.source-wal` },
    { from: `${databasePath}-shm`, to: `${archivePath}.source-shm` },
    { from: databasePath, to: `${archivePath}.source` },
  ]
  const completed: typeof moves = []
  try {
    for (const move of moves) {
      if (!existsSync(move.from)) continue
      if (existsSync(move.to)) throw new Error(`ملف الأرشيف موجود مسبقاً: ${move.to}`)
      renameSync(move.from, move.to)
      completed.push(move)
    }
  } catch (error) {
    for (const move of completed.reverse()) {
      try { renameSync(move.to, move.from) } catch { /* يبقى الأرشيف السليم، ولا نحذف أي طرف */ }
    }
    throw new Error(`تعذّر فصل قاعدة البيانات القديمة بعد أرشفتها: ${(error as Error).message}`)
  }
}
