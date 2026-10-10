/**
 * v1.0.22 — سياسة التخزين والنسخ: الاحتفاظ بالنسخ الساعية يوماً، ومنطق المكان المخصص
 * المفقود (بلا إنشاء قاعدة فارغة صامتاً)، واختيار البيانات السابقة عند أول تشغيل.
 */
import { describe, it, expect } from 'vitest'
import {
  ROTATION, PRE_UPDATE_KEEP, filesToPrune, newestFirst, customLocationStatus,
  encodeLocationPointer, decodeLocationPointer, bestExistingCandidate, latestBackup,
  type ExistingDataCandidate,
} from '../desktop/storagePolicy.ts'

const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-10T00:00:00Z')

describe('الاحتفاظ بالنسخ الساعية: يوم واحد (24 نسخة) بالضبط', () => {
  it('سياسة الساعي = 24 نسخة كل ساعة', () => {
    expect(ROTATION.hourly.keep).toBe(24)
    expect(ROTATION.hourly.ms).toBe(HOUR)
  })

  it('عند 25 نسخة يُحذف الأقدم فقط ويبقى الأحدث 24', () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ path: `h${i}.db`, mtimeMs: T0 + i * HOUR }))
    const doomed = filesToPrune(files, ROTATION.hourly.keep)
    expect(doomed.map((f) => f.path)).toEqual(['h0.db'])
    const kept = files.filter((f) => !doomed.includes(f))
    expect(kept).toHaveLength(24)
    expect(kept.some((f) => f.path === 'h24.db')).toBe(true)
  })

  it('بلا تجاوز للحد لا يُحذف شيء', () => {
    const files = Array.from({ length: 24 }, (_, i) => ({ path: `h${i}.db`, mtimeMs: T0 + i * HOUR }))
    expect(filesToPrune(files, 24)).toEqual([])
  })

  it('الترتيب بالوقت لا بالاسم: نسخة أحدث بالوقت لا تُحذف حتى لو اسمها أصغر أبجدياً', () => {
    const files = [
      { path: 'manual-2026.db', mtimeMs: T0 + 5 * HOUR },
      { path: 'hourly-2099.db', mtimeMs: T0 },
    ]
    expect(newestFirst(files)[0].path).toBe('manual-2026.db')
    expect(filesToPrune(files, 1).map((f) => f.path)).toEqual(['hourly-2099.db'])
  })
})

describe('النسخة قبل التحديث', () => {
  it('تحتفظ بآخر 5 نسخ', () => {
    expect(PRE_UPDATE_KEEP).toBe(5)
    const files = Array.from({ length: 7 }, (_, i) => ({ path: `p${i}.db`, mtimeMs: T0 + i }))
    expect(filesToPrune(files, PRE_UPDATE_KEEP)).toHaveLength(2)
  })
})

describe('حالة المكان المخصص', () => {
  const custom = { customDbPath: 'E:\\Tahakom\\shopsys.db', customDbOpenedAt: null }

  it('بلا مكان مخصص ⇒ الافتراضي', () => {
    expect(customLocationStatus({ customDbPath: null, customDbOpenedAt: null }, { folderExists: false, fileExists: false })).toBe('none')
  })

  it('المجلد غير موصول ⇒ folder-missing (لا إنشاء)', () => {
    expect(customLocationStatus(custom, { folderExists: false, fileExists: false })).toBe('folder-missing')
  })

  it('مكان جديد لم يُفتح بعد (المعالج) والملف غير موجود ⇒ ok وليس مفقوداً', () => {
    expect(customLocationStatus(custom, { folderExists: true, fileExists: false })).toBe('ok')
  })

  it('ملف فُتح من قبل ثم اختفى ⇒ file-missing (لا قاعدة فارغة صامتة)', () => {
    const opened = { ...custom, customDbOpenedAt: '2026-10-09T10:00:00Z' }
    expect(customLocationStatus(opened, { folderExists: true, fileExists: false })).toBe('file-missing')
  })

  it('الملف موجود ⇒ ok', () => {
    const opened = { ...custom, customDbOpenedAt: '2026-10-09T10:00:00Z' }
    expect(customLocationStatus(opened, { folderExists: true, fileExists: true })).toBe('ok')
  })
})

describe('مؤشر المكان: الترميز والفك', () => {
  it('يذهب ويعود بلا فقد للمسار وتاريخ الفتح', () => {
    const text = encodeLocationPointer({ customDbPath: 'D:\\x\\shopsys.db', customDbOpenedAt: '2026-10-09T00:00:00Z', secondaryBackupDir: null, lastFileBackupAt: null })
    expect(decodeLocationPointer(text)).toEqual({ customDbPath: 'D:\\x\\shopsys.db', customDbOpenedAt: '2026-10-09T00:00:00Z' })
  })

  it('ملف تالف أو فارغ المسار ⇒ null', () => {
    expect(decodeLocationPointer('{not json')).toBeNull()
    expect(decodeLocationPointer(null)).toBeNull()
    expect(decodeLocationPointer(JSON.stringify({ customDbPath: '   ' }))?.customDbPath).toBeNull()
  })
})

describe('اكتشاف البيانات السابقة عند أول تشغيل', () => {
  const backup = (path: string, mtimeMs: number): ExistingDataCandidate => ({ path, mtimeMs, kind: 'backup', whereAr: path })
  const live = (path: string, mtimeMs: number): ExistingDataCandidate => ({ path, mtimeMs, kind: 'live', whereAr: path })

  it('القاعدة الحيّة تتقدّم على أي نسخة حتى لو كانت النسخة أحدث بالوقت', () => {
    const best = bestExistingCandidate([backup('b.db', T0 + 9 * HOUR), live('D:\\Tahakom\\shopsys.db', T0)])
    expect(best?.kind).toBe('live')
    expect(best?.path).toBe('D:\\Tahakom\\shopsys.db')
  })

  it('بلا حيّة ⇒ أحدث نسخة', () => {
    const best = bestExistingCandidate([backup('old.db', T0), backup('new.db', T0 + HOUR)])
    expect(best?.path).toBe('new.db')
  })

  it('لا مرشّحين ⇒ null (تشغيل جديد حقيقي بلا معالج مزعج)', () => {
    expect(bestExistingCandidate([])).toBeNull()
  })

  it('أحدث نسخة للاستعادة إلى مكان جديد', () => {
    expect(latestBackup([{ path: 'a', mtimeMs: 1 }, { path: 'b', mtimeMs: 3 }])?.path).toBe('b')
    expect(latestBackup([])).toBeNull()
  })
})
