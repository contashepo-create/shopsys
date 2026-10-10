/**
 * درع الإقلاع (v1.0.22) — منطق ملفات خالص بلا Electron ليُختبر على ملفات حقيقية.
 * main.ts يمرّر قائمة النسخ الاحتياطية، ويكتب إشعار الاسترداد عند النجاح.
 *
 * القاعدة: لا ينقل الملف التالف ولا يستبدله إلا بعد التأكد من وجود نسخة سليمة.
 * بلا نسخة سليمة ⇒ الملف يبقى في مكانه كما هو، ويُوقَف الإقلاع بحوار (لا قاعدة فارغة صامتة).
 */
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import Database from 'better-sqlite3'

export type DbFileProbe = 'ok' | 'corrupt' | 'unreadable'

/** فحص سلامة عام (quick_check). التلف المؤكد فقط يُسمّى corrupt؛ القفل/الصلاحيات unreadable */
export function probeDbFile(dbPath: string): DbFileProbe {
  let probe: Database.Database
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unreadable'
  }
  try {
    return probe.pragma('quick_check', { simple: true }) === 'ok' ? 'ok' : 'corrupt'
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unreadable'
  } finally {
    try { probe.close() } catch { /* لا شيء */ }
  }
}

export type ShieldOutcome = 'ok' | 'skipped' | 'restored' | 'corrupt-no-backup'

export interface ShieldResult {
  outcome: ShieldOutcome
  restoredFrom: string | null
  quarantine: string | null
}

export function shieldDatabaseAt(
  dbPath: string,
  getCandidates: () => string[],
  options: { stamp?: string; log?: (message: string) => void } = {},
): ShieldResult {
  const log = options.log ?? (() => undefined)
  const none = { restoredFrom: null, quarantine: null }
  if (!existsSync(dbPath)) return { outcome: 'ok', ...none }
  const probe = probeDbFile(dbPath)
  if (probe === 'ok') return { outcome: 'ok', ...none }
  if (probe === 'unreadable') {
    // ليست تلفاً مؤكداً (قفل/صلاحيات) — لا عزل ولا استبدال؛ الفتح العادي يتولى الأمر
    log('تعذّر فحص القاعدة دون دليل تلف (قفل أو صلاحيات) — تُفتح كما هي بلا عزل')
    return { outcome: 'skipped', ...none }
  }
  const candidates = getCandidates()
  if (!candidates.some((candidate) => probeDbFile(candidate) === 'ok')) {
    log(`القاعدة تالفة ولا توجد نسخة سليمة — لم يُنقل أي ملف ولن تُنشأ قاعدة فارغة: ${dbPath}`)
    return { outcome: 'corrupt-no-backup', ...none }
  }
  log('فحص الإقلاع: القاعدة تالفة — بدء الاسترداد التلقائي')
  const stamp = options.stamp ?? new Date().toISOString().replace(/[:.]/g, '-')
  const quarantine = `${dbPath}.corrupt-${stamp}`
  try { renameSync(dbPath, quarantine) } catch { return { outcome: 'corrupt-no-backup', ...none } }
  // ملفات WAL/SHM التابعة للتالف تُعزل معه (بقاءها قد يفسد النسخة المستردة)
  const movedSides: string[] = []
  for (const ext of ['-wal', '-shm']) {
    const side = dbPath + ext
    if (existsSync(side)) {
      try { renameSync(side, `${quarantine}${ext}`); movedSides.push(ext) } catch { try { unlinkSync(side) } catch { /* استمر */ } }
    }
  }
  let restoredFrom: string | null = null
  for (const candidate of candidates) {
    try {
      if (probeDbFile(candidate) !== 'ok') continue
      copyFileSync(candidate, dbPath)
      restoredFrom = candidate
      break
    } catch { /* النسخة التالية */ }
  }
  if (!restoredFrom) {
    // فشل النسخ رغم وجود نسخة سليمة: نُعيد التالف إلى مكانه بدل أن نترك المسار فارغاً
    // (ننزع أي نسخة جزئية أولاً، لأن الإعادة فوقها تفشل على ويندوز)
    try { if (existsSync(dbPath)) unlinkSync(dbPath) } catch { /* لا شيء */ }
    try { renameSync(quarantine, dbPath) } catch { /* لا شيء */ }
    for (const ext of movedSides) { try { renameSync(`${quarantine}${ext}`, dbPath + ext) } catch { /* لا شيء */ } }
    log('تعذّر استرداد أي نسخة — أُعيد الملف التالف إلى مكانه، ولن تُنشأ قاعدة فارغة')
    return { outcome: 'corrupt-no-backup', ...none }
  }
  log(`استُردت القاعدة تلقائياً من: ${restoredFrom} (التالف محفوظ: ${quarantine})`)
  return { outcome: 'restored', restoredFrom, quarantine }
}
