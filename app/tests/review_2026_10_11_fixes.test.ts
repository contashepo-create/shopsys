/**
 * مراجعة شاملة (2026-10-11) — اختبارات الإصلاحات:
 *  • رابط واتساب: wa.me عبر https فقط.
 *  • مؤشر مكان القاعدة التالف يُستعاد من المرآة (لا فتح صامت للافتراضي).
 *  • ملف الاسترداد: سقف لعدد التكرارات.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isWhatsAppChatLink } from '../desktop/navigationPolicy.ts'
import { restoreLocationPointerAt, dbLocationFileAt } from '../desktop/dbLocation.ts'
import { wrapDeviceKey, unwrapDeviceKey, KEY_RECOVERY_MAX_ITERATIONS } from '../desktop/keyRecovery.ts'

describe('رابط واتساب قبل فتحه خارج التطبيق', () => {
  it('يقبل https://wa.me فقط', () => {
    expect(isWhatsAppChatLink('https://wa.me/201001234567?text=hi')).toBe(true)
    expect(isWhatsAppChatLink('https://wa.me/')).toBe(true)
  })
  it('يرفض أي مخطط أو نطاق آخر', () => {
    expect(isWhatsAppChatLink('file:///C:/Windows/system32/calc.exe')).toBe(false)
    expect(isWhatsAppChatLink('http://wa.me/201001234567')).toBe(false)
    expect(isWhatsAppChatLink('https://wa.me.evil.example/x')).toBe(false)
    expect(isWhatsAppChatLink('https://evil.example/?https://wa.me/')).toBe(false)
    expect(isWhatsAppChatLink('javascript:alert(1)')).toBe(false)
    expect(isWhatsAppChatLink('not a url')).toBe(false)
    expect(isWhatsAppChatLink('')).toBe(false)
  })
})

describe('مؤشر مكان القاعدة التالف', () => {
  const dirs: string[] = []
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'shopsys-ptr-'))
    dirs.push(d)
    return d
  }
  // تنظيف بعد الاختبارات
  it('يُستعاد من المرآة عند تلف المؤشر الأساسي', () => {
    const ud = tmp()
    const custom = join(ud, 'data-custom', 'shopsys.db')
    writeFileSync(dbLocationFileAt(ud), '{ هذا JSON مكسور', 'utf8')
    mkdirSync(join(ud, 'backups'), { recursive: true })
    writeFileSync(join(ud, 'backups', 'db-location.json'), JSON.stringify({ customDbPath: custom, customDbOpenedAt: '2026-10-01T00:00:00.000Z' }), 'utf8')
    expect(restoreLocationPointerAt(ud)).toBe(custom)
    expect(JSON.parse(readFileSync(dbLocationFileAt(ud), 'utf8')).customDbPath).toBe(custom)
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
  it('المؤشر السليم لا يُستبدل', () => {
    const ud = tmp()
    writeFileSync(dbLocationFileAt(ud), JSON.stringify({ customDbPath: '/data/x/shopsys.db' }), 'utf8')
    mkdirSync(join(ud, 'backups'), { recursive: true })
    writeFileSync(join(ud, 'backups', 'db-location.json'), JSON.stringify({ customDbPath: '/other/shopsys.db' }), 'utf8')
    expect(restoreLocationPointerAt(ud)).toBe(null)
    expect(JSON.parse(readFileSync(dbLocationFileAt(ud), 'utf8')).customDbPath).toBe('/data/x/shopsys.db')
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
  it('مرآة بمسار نسبي تُرفض', () => {
    const ud = tmp()
    writeFileSync(dbLocationFileAt(ud), 'تالف{', 'utf8')
    mkdirSync(join(ud, 'backups'), { recursive: true })
    writeFileSync(join(ud, 'backups', 'db-location.json'), JSON.stringify({ customDbPath: 'relative/shopsys.db' }), 'utf8')
    expect(restoreLocationPointerAt(ud)).toBe(null)
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
})

describe('ملف الاسترداد: سقف التكرارات', () => {
  it('يرفض ملفاً بتكرارات أعلى من السقف قبل اشتقاق المفتاح', () => {
    const text = wrapDeviceKey(randomBytes(32), 'كلمة سر طويلة جداً 123', 'device-1', { iterations: 200_000 })
    const parsed = JSON.parse(text)
    parsed.kdf.iterations = KEY_RECOVERY_MAX_ITERATIONS + 1
    expect(() => unwrapDeviceKey(JSON.stringify(parsed), 'كلمة سر طويلة جداً 123')).toThrow(/غير آمنة/)
  })
  it('الملف السليم ما زال يُفك', () => {
    const key = randomBytes(32)
    const text = wrapDeviceKey(key, 'كلمة سر طويلة جداً 123', 'device-1', { iterations: 200_000 })
    const out = unwrapDeviceKey(text, 'كلمة سر طويلة جداً 123')
    expect(Buffer.compare(Buffer.from(out.key), key)).toBe(0)
  })
})
