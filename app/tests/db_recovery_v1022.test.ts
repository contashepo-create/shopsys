/**
 * v1.0.22 — استرداد مكان القاعدة وتقوية Electron (ملفات وقاعدة SQLite حقيقية):
 *   1) مجلد جديد تماماً (بلا دليل تشغيل سابق) ⇒ لا حوار استرداد.
 *   2) مؤشر مفقود + دليل تشغيل سابق + لا قاعدة ⇒ يُطلب من العميل اختيار الملف.
 *   3) الملف المختار السليم ⇒ يُعتمد بمساره المطلق ويُفتح بالبيانات كما هي.
 *   4) الملف المختار غير الصالح (نص، قاعدة غير تَحَكَّم، غير موجود) ⇒ يُرفض.
 *   5) المسار النسبي مرفوض عند الكتابة وعند القراءة (ويندوز و POSIX).
 *   6) سياسة التنقل: التطبيق نفسه فقط، والروابط الخارجية بمخططات محددة.
 *   7) سياسة المحتوى (CSP) في index.html: لا سكربت خارجي ولا unsafe-eval.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')
const {
  writeDbLocationAt, readDbLocationAt, setCustomDbPathAt, hasPreviousUseEvidenceAt,
  shouldAskForExistingDatabase, probeShopsysDatabase, isAbsoluteDbPath, resolveDbPathAt, dbLocationFileAt,
} = await import('../desktop/dbLocation.ts')
const { isInAppNavigation, isExternalOpenable } = await import('../desktop/navigationPolicy.ts')

const APP_STATE = JSON.stringify({ state: { setup: { completed: true, shopName: 'بقالة النور' } }, version: 0 })

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'shopsys-recover-'))
  const ud = join(root, 'AppData', 'Tahakom')
  mkdirSync(ud, { recursive: true })
  return { root, ud }
}

/** يكتب قاعدة تَحَكَّم حقيقية بالبيانات في مكان مختار، ثم يُغلقها */
async function writeRealDatabase(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dirname(dbPath), 'backups') })
  db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: APP_STATE })
  db.close()
}

describe('قرار طلب قاعدة موجودة', () => {
  it('المجلد الجديد تماماً (بلا دليل) لا يُظهر الحوار حتى لو غابت القاعدة', () => {
    const { root, ud } = tempRoot()
    try {
      expect(hasPreviousUseEvidenceAt(ud)).toBe(false)
      expect(shouldAskForExistingDatabase({ resolvedDbExists: false, previousUse: false })).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('مفتاح الجهاز وحده (يُكتب قبل فتح القاعدة في كل تشغيل) لا يُعد دليل تشغيل سابق', () => {
    const { root, ud } = tempRoot()
    try {
      writeFileSync(join(ud, 'device.key'), 'x')
      expect(hasPreviousUseEvidenceAt(ud)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('مجلد النسخ الموجود ⇒ دليل تشغيل سابق ⇒ الحوار يُطلب عند غياب القاعدة', () => {
    const { root, ud } = tempRoot()
    try {
      mkdirSync(join(ud, 'backups'), { recursive: true })
      expect(hasPreviousUseEvidenceAt(ud)).toBe(true)
      expect(shouldAskForExistingDatabase({ resolvedDbExists: false, previousUse: true })).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('علامة آخر تشغيل (last-run.json) ⇒ دليل تشغيل سابق', () => {
    const { root, ud } = tempRoot()
    try {
      writeFileSync(join(ud, 'last-run.json'), JSON.stringify({ version: '1.0.21' }))
      expect(hasPreviousUseEvidenceAt(ud)).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('مؤشر مكان موجود (اختيار سابق) ⇒ دليل تشغيل سابق حتى بلا نسخ ولا علامة', () => {
    const { root, ud } = tempRoot()
    try {
      writeDbLocationAt(ud, { customDbPath: join(root, 'D', 'shopsys.db'), secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null })
      expect(hasPreviousUseEvidenceAt(ud)).toBe(true)
      expect(shouldAskForExistingDatabase({ resolvedDbExists: false, previousUse: true })).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('القاعدة موجودة ⇒ لا حوار أبداً', () => {
    expect(shouldAskForExistingDatabase({ resolvedDbExists: true, previousUse: true })).toBe(false)
  })
})

describe('المسار المطلق', () => {
  it('يقبل المسارات المطلقة لويندوز ولينكس، ويرفض النسبية والفارغة', () => {
    expect(isAbsoluteDbPath('D:\\بيانات المحل\\shopsys.db')).toBe(true)
    expect(isAbsoluteDbPath('C:/Users/Owner/shopsys.db')).toBe(true)
    expect(isAbsoluteDbPath('/home/owner/shopsys.db')).toBe(true)
    expect(isAbsoluteDbPath('shopsys.db')).toBe(false)
    expect(isAbsoluteDbPath('..\\..\\shopsys.db')).toBe(false)
    expect(isAbsoluteDbPath('   ')).toBe(false)
  })

  it('الكتابة بمسار نسبي مرفوضة، والمسار المطلق يُحفظ', () => {
    const { root, ud } = tempRoot()
    try {
      expect(() => setCustomDbPathAt(ud, 'shopsys.db')).toThrow(/مطلقاً/)
      expect(existsSync(dbLocationFileAt(ud))).toBe(false)
      const abs = join(root, 'D', 'shopsys.db')
      setCustomDbPathAt(ud, abs)
      expect(readDbLocationAt(ud).customDbPath).toBe(abs)
      expect(resolveDbPathAt(ud)).toEqual({ dbPath: abs, isCustom: true })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('مؤشر تالف يحوي مساراً نسبياً يُقرأ كغير موجود (فيُطلب الملف بدل فتح قاعدة فارغة)', () => {
    const { root, ud } = tempRoot()
    try {
      writeFileSync(dbLocationFileAt(ud), JSON.stringify({ customDbPath: 'shopsys.db', secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null }))
      expect(readDbLocationAt(ud).customDbPath).toBeNull()
      expect(resolveDbPathAt(ud).isCustom).toBe(false)
      expect(() => writeDbLocationAt(ud, { customDbPath: '..\\x.db', secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null })).toThrow(/مطلقاً/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('الملف الذي يختاره المستخدم', () => {
  it('ملف قاعدة تَحَكَّم سليم ⇒ يُعتمد، ويُفتح بالبيانات كما هي بعد إغلاق البرنامج وإعادة فتحه', async () => {
    const { root, ud } = tempRoot()
    try {
      // مكان العميل القديم (ليس في userData) وفيه بياناته؛ المؤشر فُقد تماماً
      const oldDb = join(root, 'D', 'بيانات المحل', 'shopsys.db')
      await writeRealDatabase(oldDb)
      expect(probeShopsysDatabase(oldDb)).toBe('ok')
      // الحالة قبل الاختيار: لا قاعدة في المكان الافتراضي + دليل تشغيل سابق ⇒ حوار
      mkdirSync(join(ud, 'backups'), { recursive: true })
      expect(shouldAskForExistingDatabase({ resolvedDbExists: existsSync(join(ud, 'shopsys.db')), previousUse: hasPreviousUseEvidenceAt(ud) })).toBe(true)
      // العميل يختار الملف
      setCustomDbPathAt(ud, oldDb)
      expect(shouldAskForExistingDatabase({ resolvedDbExists: existsSync(resolveDbPathAt(ud).dbPath), previousUse: true })).toBe(false)
      // إعادة فتح (كما في تشغيل لاحق)
      const { dbPath, isCustom } = resolveDbPathAt(ud)
      const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dirname(dbPath), 'backups') })
      expect(isCustom).toBe(true)
      expect(db.getSnapshot('shopsys-app').payloadJson).toBe(APP_STATE)
      db.close()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('نص عادي باسم shopsys.db ⇒ مرفوض ولا يُكتب المؤشر', () => {
    const { root, ud } = tempRoot()
    try {
      const fake = join(root, 'shopsys.db')
      writeFileSync(fake, 'هذا ليس قاعدة بيانات')
      expect(probeShopsysDatabase(fake)).toBe('corrupt')
      expect(existsSync(dbLocationFileAt(ud))).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('قاعدة SQLite سليمة لكن ليست لتَحَكَّم (لا جدول snapshots) ⇒ مرفوضة', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { root } = tempRoot()
    try {
      const other = join(root, 'other.db')
      const db = new Database(other)
      db.exec('CREATE TABLE invoices (id INTEGER PRIMARY KEY)')
      db.close()
      expect(probeShopsysDatabase(other)).toBe('not-shopsys')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('ملف غير موجود ⇒ مرفوض', () => {
    expect(probeShopsysDatabase(join(tmpdir(), 'no-such-dir-shopsys', 'shopsys.db'))).toBe('unreadable')
  })
})

describe('سياسة التنقل داخل النافذة', () => {
  const INDEX = 'file:///C:/Program%20Files/Tahakom/resources/app/dist/index.html'

  it('صفحة التطبيق نفسها (مع تجزئة أو استعلام) مسموحة', () => {
    expect(isInAppNavigation(INDEX, INDEX, null)).toBe(true)
    expect(isInAppNavigation(`${INDEX}#/invoices`, INDEX, null)).toBe(true)
  })

  it('ملف محلي آخر أو صفحة خارجية أو javascript: أو about: ممنوعة', () => {
    expect(isInAppNavigation('file:///C:/Users/Owner/secret.html', INDEX, null)).toBe(false)
    expect(isInAppNavigation('https://evil.example/phish', INDEX, null)).toBe(false)
    expect(isInAppNavigation('javascript:alert(1)', INDEX, null)).toBe(false)
    expect(isInAppNavigation('about:blank', INDEX, null)).toBe(false)
    expect(isInAppNavigation('not a url', INDEX, null)).toBe(false)
  })

  it('وضع التطوير: أصل خادم Vite فقط', () => {
    const dev = 'http://localhost:5173'
    expect(isInAppNavigation('http://localhost:5173/#/x', INDEX, dev)).toBe(true)
    expect(isInAppNavigation('http://localhost:9999/', INDEX, dev)).toBe(false)
    expect(isInAppNavigation('https://evil.example/', INDEX, dev)).toBe(false)
  })

  it('الفتح الخارجي: http/https/mailto/tel فقط', () => {
    expect(isExternalOpenable('https://wa.me/201000000000')).toBe(true)
    expect(isExternalOpenable('http://example.com')).toBe(true)
    expect(isExternalOpenable('mailto:a@b.co')).toBe(true)
    expect(isExternalOpenable('tel:+20100')).toBe(true)
    expect(isExternalOpenable('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isExternalOpenable('javascript:alert(1)')).toBe(false)
    expect(isExternalOpenable('ms-settings:network')).toBe(false)
  })
})

describe('سياسة المحتوى (CSP) في index.html', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)
  const directives = new Map((match?.[1] ?? '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...rest] = d.split(/\s+/)
    return [name, rest] as const
  }))

  it('الوسم موجود ويفرض default-src على الأصل المحلي', () => {
    expect(match).not.toBeNull()
    expect(directives.get('default-src')).toEqual(["'self'"])
  })

  it('script-src بلا unsafe-inline ولا unsafe-eval ولا مصادر خارجية', () => {
    const script = directives.get('script-src') ?? []
    expect(script).toEqual(["'self'"])
  })

  it('object-src و base-uri و form-action مقفلة', () => {
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('form-action')).toEqual(["'none'"])
  })

  it('connect-src يسمح بالـ https الذي تستعمله المزامنة/الخدمات، وبالـ ws/wss الذي تستعمله شبكة المحل', () => {
    const connect = directives.get('connect-src') ?? []
    expect(connect).toEqual(expect.arrayContaining(["'self'", 'https:', 'ws:', 'wss:']))
  })

  it('الخطوط (Google Fonts) مسموحة وحدها، ولا iframe إلا من الأصل والبيانات المحلية', () => {
    expect(directives.get('style-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']))
    expect(directives.get('font-src')).toEqual(expect.arrayContaining(['https://fonts.gstatic.com']))
    expect(directives.get('frame-src')).toEqual(["'self'", 'data:', 'blob:'])
  })
})
