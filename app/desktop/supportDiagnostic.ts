import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeMainLog } from '../src/core/supportDiagnostic.ts'

/** لا يقبل مساراً من المُصيّر؛ يقرأ نهاية الملف المعروف فقط وبحد ذاكرة ثابت. */
export function readSupportMainLog(userData: string): { ok: true; text: string; truncated: boolean } | { ok: false; reason: 'unavailable' } {
  const path = join(userData, 'main.log')
  let fd: number | undefined
  try {
    const before = lstatSync(path)
    if (!before.isFile() || before.isSymbolicLink()) return { ok: false, reason: 'unavailable' }
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(fd)
    if (!stat.isFile() || (before.ino && stat.ino && before.ino !== stat.ino) || (before.dev && stat.dev && before.dev !== stat.dev)) return { ok: false, reason: 'unavailable' }
    const maxBytes = 256_000, start = Math.max(0, stat.size - maxBytes)
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes))
    const length = readSync(fd, buffer, 0, buffer.length, start)
    let raw = buffer.subarray(0, length).toString('utf8')
    if (start > 0) raw = raw.includes('\n') ? raw.slice(raw.indexOf('\n') + 1) : ''
    const text = sanitizeMainLog(raw)
    return { ok: true, text, truncated: start > 0 || text.length >= 42_000 }
  } catch { return { ok: false, reason: 'unavailable' } }
  finally { if (fd !== undefined) { try { closeSync(fd) } catch { /* لا يعطل الدعم */ } } }
}
