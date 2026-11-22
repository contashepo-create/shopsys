/** تجهيز استعادة ملفية في مجلد القاعدة قبل أي استبدال. لا يراجع محتوى الدفتر. */
import { constants, copyFileSync, existsSync, lstatSync, openSync, closeSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { probeShopsysDatabase } from './dbLocation.ts'

function removeIfPresent(path: string): void {
  try { unlinkSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function hasPendingJournal(path: string): boolean {
  const real = realpathSync(path)
  return ['-wal', '-journal'].some(ext => existsSync(path + ext) || existsSync(real + ext))
}

/** فحص القراءة فقط قد ينشئ WAL فارغاً للمرحلة الخاصة بنا؛ لا نحذف غير الفارغ. */
export function cleanStagedProbeFiles(staged: string): void {
  const wal = staged + '-wal'
  if (existsSync(wal) && statSync(wal).size !== 0) throw new Error('ملف المرحلة له WAL غير فارغ — يلزم مراجعته')
  if (existsSync(staged + '-journal')) throw new Error('ملف المرحلة له سجل معاملات — يلزم مراجعته')
  removeIfPresent(wal)
  removeIfPresent(staged + '-shm')
}

/**
 * لا يُنسخ ملف SQLite حي بمجرد copyFile: قد تكون أحدث صفحاته في WAL.
 * نرفض النسخ المصحوبة بـWAL بدلاً من تجاهله أو استنتاج اكتمالها.
 */
export function stageFileRestore(target: string, dbPath: string): string {
  const current = statSync(dbPath), selected = statSync(target)
  if (realpathSync(target) === realpathSync(dbPath) || (current.ino !== 0 && current.dev === selected.dev && current.ino === selected.ino)) throw new Error('النسخة المختارة هي قاعدة التشغيل نفسها — لم تُستعد')
  // استبدال رابط الملف نفسه يغيّر الرابط لا الملف المفتوح؛ نرفضه بدل تخمين المقصود.
  if (lstatSync(dbPath).isSymbolicLink()) throw new Error('ملف قاعدة التشغيل رابط رمزي — راجع مكان القاعدة قبل الاستعادة')
  if (hasPendingJournal(target)) throw new Error('ملف النسخة له WAL أو سجل معاملات مرفق — لا يمكن استعادته بنسخ الملف منفرداً')
  const staged = `${dbPath}.restore-stage-${randomBytes(16).toString('hex')}`
  // نملك الملف المؤقت فقط بعد إنشائه حصرياً، فلا نحذف ملفاً موجوداً بالصدفة.
  const fd = openSync(staged, 'wx', 0o600)
  closeSync(fd)
  try {
    copyFileSync(target, staged)
    if (hasPendingJournal(target)) throw new Error('ظهر WAL أو سجل معاملات للنسخة أثناء تجهيزها — لم تُستعد')
    if (probeShopsysDatabase(staged) !== 'ok') throw new Error('نسخة الاستعادة المؤقتة تالفة أو ليست قاعدة تحكّم قابلة للقراءة — لم تُستبدل القاعدة')
    cleanStagedProbeFiles(staged)
    return staged
  } catch (error) {
    try { discardStagedBackup(staged) } catch { /* أبلغ عن الفشل الأصلي واترك الملف المؤقت للمراجعة */ }
    throw error
  }
}

/**
 * بعد إغلاق الاتصال فقط: لا نمس WAL نشطاً، وننشئ نسخة أمان باسم حصري قبل
 * استبدال المسار بتغيير اسم الملف المؤقت. لا يضمن ذلك سلامة نوافذ/عمليات أخرى.
 */
export function replaceWithStagedBackup(dbPath: string, staged: string, beforePath: string): void {
  cleanStagedProbeFiles(staged)
  if (hasPendingJournal(dbPath)) throw new Error('ما زال WAL أو سجل معاملات للقاعدة الحالية موجوداً بعد الإغلاق — لم تُستبدل القاعدة')
  copyFileSync(dbPath, beforePath, constants.COPYFILE_EXCL)
  // SHM بلا WAL ملف فهرس مؤقت؛ إذا تعذر إزالته نتوقف قبل الاستبدال.
  removeIfPresent(dbPath + '-shm')
  if (hasPendingJournal(dbPath)) throw new Error('ظهر WAL أو سجل معاملات للقاعدة الحالية قبل الاستبدال — لم تُستبدل القاعدة')
  renameSync(staged, dbPath)
}

export function discardStagedBackup(staged: string): void {
  cleanStagedProbeFiles(staged)
  removeIfPresent(staged)
}
