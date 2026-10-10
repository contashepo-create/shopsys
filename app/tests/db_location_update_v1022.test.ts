/**
 * v1.0.22 — مكان قاعدة البيانات المخصص عبر التحديث (ملفات وقاعدة SQLite حقيقية):
 *   1) التحديث العادي: userData لم يُمسّ ⇒ يُفتح الملف في المكان المخصص نفسه.
 *   2) فقدان مؤشر التوجيه مع بقاء مرآته الافتراضية ⇒ استعادة تلقائية للمكان نفسه.
 *   3) فقدان المؤشر ومرآته معاً ⇒ لا استعادة تلقائية (حدّ معروف، موثّق هنا).
 *   4) المجلد أو الملف غائب ⇒ حالة صريحة، ولا قاعدة فارغة تُنشأ صامتاً.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, rmSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')
const {
  writeDbLocationAt, readDbLocationAt, restoreLocationPointerAt, customDbStatusAt, resolveDbPathAt, dbLocationFileAt,
} = await import('../desktop/dbLocation.ts')

const APP_STATE = JSON.stringify({ state: { setup: { completed: true, shopName: 'بقالة النور' }, legal: { version: '2026-10-11' } }, version: 0 })
const STOCK = JSON.stringify({ state: { items: [{ id: 1, nameAr: 'أرز', qty: 12 }] }, version: 0 })

function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'shopsys-loc-'))
  const ud = join(root, 'AppData', 'Tahakom')          // مجلد البيانات الافتراضي (userData)
  const custom = join(root, 'D', 'بيانات المحل')       // مكان يختاره العميل باسم مختلف
  mkdirSync(ud, { recursive: true })
  mkdirSync(custom, { recursive: true })
  return { root, ud, custom, dbPath: join(custom, 'shopsys.db') }
}

/** يحاكي أول تشغيل بعد اختيار المكان: يكتب المؤشر، يفتح القاعدة، يحفظ البيانات، يُغلق */
async function firstRunAtCustom(s: ReturnType<typeof scenario>) {
  writeDbLocationAt(s.ud, { customDbPath: s.dbPath, secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null })
  const db = await ShopsysDatabase.open(s.dbPath, { backupsDir: join(s.custom, 'backups') })
  db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: APP_STATE })
  db.saveSnapshot({ storeName: 'stock', expectedRevision: 0, payloadJson: STOCK })
  db.close()
  writeDbLocationAt(s.ud, { ...readDbLocationAt(s.ud), customDbOpenedAt: new Date().toISOString() })
}

/** يحاكي فتح البرنامج بعد التحديث: المسار من المؤشر ثم الفتح والقراءة */
async function reopenAfterUpdate(s: ReturnType<typeof scenario>) {
  const { dbPath, isCustom } = resolveDbPathAt(s.ud)
  const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dirname(dbPath), 'backups') })
  const out = { dbPath, isCustom, app: db.getSnapshot('shopsys-app'), stock: db.getSnapshot('stock') }
  db.close()
  return out
}

describe('مكان القاعدة المخصص عبر التحديث', () => {
  it('1) التحديث العادي: يُفتح الملف في المكان المخصص نفسه بالبيانات والإعداد كما هي', async () => {
    const s = scenario()
    try {
      await firstRunAtCustom(s)
      // التحديث لا يمسّ مجلد البيانات ولا المكان المخصص — نتحقق من الحالة قبل الفتح
      expect(customDbStatusAt(s.ud).status).toBe('ok')
      const r = await reopenAfterUpdate(s)
      expect(r.isCustom).toBe(true)
      expect(r.dbPath).toBe(s.dbPath)
      expect(JSON.parse(r.app.payloadJson as string).state.setup.completed).toBe(true)
      expect(r.app.payloadJson).toBe(APP_STATE)
      expect(r.stock.payloadJson).toBe(STOCK)
      expect(existsSync(join(s.ud, 'shopsys.db'))).toBe(false) // لا قاعدة افتراضية تُنشأ فوق
      // المرآة بجوار القاعدة المخصصة موجودة
      expect(existsSync(join(s.custom, 'backups', 'db-location.json'))).toBe(true)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  it('2) فقدان ملف المؤشر مع بقاء مرآته الافتراضية: استعادة تلقائية للمكان نفسه', async () => {
    const s = scenario()
    try {
      await firstRunAtCustom(s)
      unlinkSync(dbLocationFileAt(s.ud))
      const restored = restoreLocationPointerAt(s.ud)
      expect(restored).toBe(s.dbPath)
      const r = await reopenAfterUpdate(s)
      expect(r.dbPath).toBe(s.dbPath)
      expect(r.app.payloadJson).toBe(APP_STATE)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  it('3) فقدان المؤشر ومرآته الافتراضية معاً: لا استعادة تلقائية — يُعاد المكان الافتراضي (حدّ موثّق)', async () => {
    const s = scenario()
    try {
      await firstRunAtCustom(s)
      unlinkSync(dbLocationFileAt(s.ud))
      unlinkSync(join(s.ud, 'backups', 'db-location.json'))
      expect(restoreLocationPointerAt(s.ud)).toBeNull()
      // القاعدة المخصصة سليمة على القرص، لكن البرنامج لا يعرف مكانها بلا مؤشر
      expect(existsSync(s.dbPath)).toBe(true)
      expect(resolveDbPathAt(s.ud).isCustom).toBe(false)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  it('4a) المجلد المخصص غير موصول: حالة folder-missing ولا ملف يُنشأ', async () => {
    const s = scenario()
    try {
      await firstRunAtCustom(s)
      rmSync(s.custom, { recursive: true, force: true })
      expect(customDbStatusAt(s.ud).status).toBe('folder-missing')
      expect(existsSync(s.custom)).toBe(false) // فحص الحالة لا ينشئ شيئاً
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  it('4b) الملف اختفى بعد أن فُتح مرة: حالة file-missing ولا قاعدة فارغة تُنشأ', async () => {
    const s = scenario()
    try {
      await firstRunAtCustom(s)
      unlinkSync(s.dbPath)
      expect(customDbStatusAt(s.ud).status).toBe('file-missing')
      expect(existsSync(s.dbPath)).toBe(false)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  it('5) مؤشر بلا مكان مخصص: الافتراضي، وحالة none', () => {
    const s = scenario()
    try {
      writeDbLocationAt(s.ud, { customDbPath: null, secondaryBackupDir: null, lastFileBackupAt: null, customDbOpenedAt: null })
      expect(customDbStatusAt(s.ud).status).toBe('none')
      expect(resolveDbPathAt(s.ud)).toEqual({ dbPath: join(s.ud, 'shopsys.db'), isCustom: false })
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })
})
