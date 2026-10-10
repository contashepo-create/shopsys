/**
 * v1.0.22 — محاكاة التحديث على ملف SQLite حقيقي (لا ذاكرة):
 * أول تشغيل يحفظ حالة الإعداد والبيانات، ثم يُغلق البرنامج (كأنه تحديث)، ثم
 * يُفتح الملف نفسه من جديد. المطلوب: لا معالج إعداد من جديد (setup.completed
 * باقٍ)، ولا فقدان بيانات، ونفس معرّف الجهاز، وإصدارات اللقطات كما هي.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')

const APP_STATE = JSON.stringify({
  state: {
    setup: { completed: true, shopName: 'بقالة النور', ownerName: 'أحمد محمد', activityId: 'retail' },
    legal: { version: '2026-10-11', acceptedAt: '2026-10-10T08:00:00.000Z' },
    deviceId: 'SHOP-AAAA-BBBB-CCCC',
  },
  version: 0,
})
const INVENTORY = JSON.stringify({ state: { items: [{ id: 1, nameAr: 'أرز', qty: 12 }, { id: 2, nameAr: 'سكر', qty: 5 }] }, version: 0 })

describe('التحديث يفتح القاعدة الموجودة كما هي (ملف SQLite حقيقي)', () => {
  it('الإعداد والبيانات وإصدارات اللقطات تبقى بعد إغلاق الملف وإعادة فتحه', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shopsys-upgrade-'))
    const dbPath = join(dir, 'shopsys.db')
    try {
      // أول تشغيل: الإعداد يكتمل ويُحفظ
      // نفس استدعاء المُصيّر الفعلي: بلا deviceId صريح — الهوية تُنشأ مرة وتُحفظ في meta
      const first = await ShopsysDatabase.open(dbPath, { backupsDir: join(dir, 'backups') })
      const origin = first.origin.device
      first.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: APP_STATE })
      first.saveSnapshot({ storeName: 'inventory', expectedRevision: 0, payloadJson: INVENTORY })
      first.close()

      // التحديث: الإغلاق ثم إعادة الفتح من المسار نفسه بلا أي خيارات
      expect(existsSync(dbPath)).toBe(true)
      const reopened = await ShopsysDatabase.open(dbPath)
      const app = reopened.getSnapshot('shopsys-app')
      expect(app.revision).toBe(1)
      expect(app.payloadJson).toBe(APP_STATE)
      expect(JSON.parse(app.payloadJson as string).state.setup.completed).toBe(true)
      expect(reopened.getSnapshot('inventory').payloadJson).toBe(INVENTORY)
      expect(reopened.origin.device).toBe(origin) // هوية الجهاز ثابتة

      // الحفظ بعد التحديث يكمل من الإصدار نفسه (لا كتابة فوق نسخة أحدث)
      const next = reopened.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 1, payloadJson: APP_STATE.replace('بقالة النور', 'بقالة النور الجديدة') })
      expect(next.revision).toBe(2)
      reopened.close()

      // إعادة فتح ثالثة (تشغيل عادي بعد التحديث) — الترحيلات لا تكرر ولا تعطب
      const third = await ShopsysDatabase.open(dbPath)
      expect(third.getSnapshot('shopsys-app').revision).toBe(2)
      expect(third.getSnapshot('shopsys-app').payloadJson).toContain('بقالة النور الجديدة')
      expect(third.getSnapshot('inventory').revision).toBe(1)
      third.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('فتح ملف قاعدة موجود لا يُنشئ قاعدة فارغة فوقه (الحفظ بإصدار 0 على لقطة موجودة يُرفض)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shopsys-upgrade-'))
    const dbPath = join(dir, 'shopsys.db')
    try {
      const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dir, 'backups') })
      db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: APP_STATE })
      expect(() => db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: '{}' })).toThrow()
      expect(db.getSnapshot('shopsys-app').payloadJson).toBe(APP_STATE)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
