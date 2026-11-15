// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readSupportMainLog } from '../desktop/supportDiagnostic.ts'
import { combineSupportLogs, sanitizeMainLog, sanitizeRendererLog } from '../src/core/supportDiagnostic.ts'
const dirs: string[] = []
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'support-log-test-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('مقتطف main.log الآمن للدعم', () => {
 it('يقرأ أخطاء main والـstack ويمنع رؤوس cookie والرموز والروابط ومسارات الجهاز', () => {
  const dir = directory()
  writeFileSync(join(dir, 'main.log'), [
   '[2026-11-05T10:00:00.000Z] [updater] ERR_NAME_NOT_RESOLVED',
   '    at crash (C:\\Users\\alice\\folder-name\\file.js:12:4)',
   '[2026-11-05T10:00:01.000Z] [updater] HTTP 504 set-cookie: sensitive-value; Path=/',
   '  "continuation-cookie-value-supersecret",',
   '[2026-11-05T10:00:02.000Z] [support] https://host/path?access_token=abc',
   '[2026-11-05T10:00:03.000Z] [boot] C:\\Users\\alice\\AppData\\shopsys',
  ].join('\n'))
  const result = readSupportMainLog(dir)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('لم يقرأ الملف')
  expect(result.text).toContain('ERR_NAME_NOT_RESOLVED'); expect(result.text).toContain('HTTP 504'); expect(result.text).toContain('at crash')
  for (const secret of ['sensitive-value', 'continuation-cookie-value-supersecret', 'access_token=abc', 'alice', 'folder-name']) expect(result.text).not.toContain(secret)
 })
 it('يقص قراءة الملف ويستبعد جزء السطر الأقدم والسطور غير الموثقة', () => {
  const dir = directory(); writeFileSync(join(dir, 'main.log'), 'x'.repeat(300_000) + '\n[2026-11-05T10:00:00Z] [fatal] ERR_DISK_FULL\n')
  const result = readSupportMainLog(dir)
  expect(result).toMatchObject({ ok: true, truncated: true })
  if (result.ok) { expect(result.text).toContain('ERR_DISK_FULL'); expect(result.text).not.toContain('xxxx') }
 })
 it('يرفض الرابط الرمزي وعدم وجود الملف دون قراءة مسار آخر', () => {
  const dir = directory(); expect(readSupportMainLog(dir)).toEqual({ ok: false, reason: 'unavailable' })
  const other = join(dir, 'other.txt'); writeFileSync(other, 'secret')
  if (process.platform !== 'win32') {
   symlinkSync(other, join(dir, 'main.log')); expect(readSupportMainLog(dir)).toEqual({ ok: false, reason: 'unavailable' })
  }
 })
 it('يضع السجلين في المرفق ويحجب أسرار سجل الواجهة حتى مع البيانات القديمة', () => {
  const renderer = '[2026-11-05 12:00:00] ERROR: ERR_FAILED\n[2026-11-05 12:00:01] ERROR: Cookie: abc'
  const main = '[2026-11-05T10:00:00Z] [fatal] ERR_MAIN'
  const combined = combineSupportLogs(main, renderer)
  expect(combined).toContain('ERR_MAIN'); expect(combined).toContain('ERR_FAILED'); expect(combined).not.toContain('Cookie: abc')
  expect(sanitizeRendererLog(renderer)).not.toContain('Cookie: abc')
  expect(sanitizeMainLog('[2026-11-05T10:00:00Z] [x] Authorization: Bearer abc')).not.toContain('abc')
  expect(combined.length).toBeLessThan(60_000)
 })
})
