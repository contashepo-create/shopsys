/** هوية ثابتة؛ حفظ مجلد التشغيل الحالي فقط، بلا بحث/ترحيل جماعي لمجلدات عملاء. */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, rmdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyDatabaseSafely } from './databaseSafety.ts'

export const DESKTOP_APP_NAME = 'Tahakom'
function hasData(dir: string): boolean {
  return ['device.key.enc', 'device.key', 'shopsys.db', 'db-location.json', 'last-run.json'].some(file => existsSync(join(dir, file)))
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
