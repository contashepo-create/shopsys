/** هوية ثابتة؛ حفظ مجلد التشغيل الحالي فقط، بلا بحث/ترحيل جماعي لمجلدات عملاء. */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, rmdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyDatabaseSafely } from './databaseSafety.ts'

export const DESKTOP_APP_NAME = 'Tahakom'
function hasData(dir: string): boolean {
  return ['device.key.enc', 'device.key', 'shopsys.db', 'db-location.json', 'last-run.json'].some(file => existsSync(join(dir, file)))
}

/** النسخة المنشورة v23 حملت اسم package=app. نعيد استعمال profile الحقيقي
 * إن كان موجوداً ومؤكداً بعلامتي التطبيق، ولا ننقل ملفات أو نفحص أسماء أخرى.
 * profile التشغيل الحالي يتقدم دائماً؛ لا نستبدل بيانات عمل جديدة بتاريخ أقدم. */
export function selectRuntimeUserData(appData: string, current: string): string {
  const canonical = join(appData, DESKTOP_APP_NAME)
  if (hasData(current)) return resolve(current)
  if (hasData(canonical)) return canonical
  const previous = join(appData, 'app')
  try {
    const last = JSON.parse(readFileSync(join(previous, 'last-run.json'), 'utf8')) as { version?: unknown }
    const parts = typeof last.version === 'string' ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(last.version) : null
    const knownVersion = parts && (Number(parts[1]) > 1 || (Number(parts[1]) === 1 && (Number(parts[2]) > 0 || Number(parts[3]) >= 23)))
    const key = readFileSync(join(previous, 'device.key.enc'), 'utf8')
    if (knownVersion && key.startsWith('shopsys-safekey:v1:') && key.length > 'shopsys-safekey:v1:'.length) return previous
  } catch { /* لا profile سابق لهذا التطبيق مثبت بالمفتاح وعلامة التشغيل */ }
  return canonical
}

export async function preserveCurrentUserData(current: string, stable: string): Promise<void> {
  if (resolve(current) === resolve(stable) || !hasData(current)) {
    mkdirSync(stable, { recursive: true })
    return
  }
  // لا دمج لمفتاحين أو قاعدتين مختلفتين، ولا إتلاف لبيانات موجودة.
  if (existsSync(stable) && readdirSync(stable).length > 0) throw new Error('يوجد مجلدا بيانات مختلفان — لم تُدمج أو تُحذف أي بيانات. راجع مسار بيانات المستخدم في السجل')
  mkdirSync(dirname(stable), { recursive: true })
  const temporary = `${stable}.${randomUUID()}.tmp`
  try {
    cpSync(current, temporary, { recursive: true, errorOnExist: true, force: false })
    const source = join(current, 'shopsys.db')
    if (existsSync(source)) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(join(temporary, 'shopsys.db' + suffix), { force: true })
      await copyDatabaseSafely(source, join(temporary, 'shopsys.db'))
    }
    // Electron قد يُنشئ المجلد الثابت فارغاً عند whenReady. لا نزيل مجلداً غير فارغ.
    if (existsSync(stable)) rmdirSync(stable)
    renameSync(temporary, stable)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  // المجلد الأصلي (وخاصة مفتاح الجهاز) يبقى كما هو نسخة أمان.
}
