/** توافق رجعي لبيانات سطح المكتب المشفرة في الإصدارات القديمة.
 * اللقطات الجديدة تحفظ كنص عادي؛ هذه الاختبارات تثبت فقط فك صيغة enc:v1 القديمة
 * حتى ينجح ترحيلها الصامت إلى SQLite النصي في DesktopStateStorage.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { decryptSnapshotForDevice, isEncryptedSnapshot } = await import('../src/data/persistentStorage.ts')
const { encryptLegacySnapshotForTest } = await import('./legacy_snapshot_fixture.ts')

describe('توافق قراءة اللقطات القديمة المشفرة', () => {
  it('دورة كاملة: تشفير → نص غير مقروء → فك بالمفتاح نفسه فقط', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const payload = JSON.stringify({ state: { items: [{ id: 1, nameAr: 'أرز مصري 5كجم', priceMinor: 8500 }], journal: [] }, version: 7 })
    const stored = await encryptLegacySnapshotForTest(payload, key)
    // المخزون: بصيغة enc:v1 ولا يحوي أي أثر للنص الصريح
    expect(stored.startsWith('enc:v1:')).toBe(true)
    expect(stored.includes('أرز')).toBe(false)
    expect(stored.includes('8500')).toBe(false)
    expect(isEncryptedSnapshot(stored)).toBe(true)
    // الفك بالمفتاح الصحيح يعيد النص حرفياً
    expect(await decryptSnapshotForDevice(stored, key)).toBe(payload)
    // مفتاح جهاز آخر (جهاز منسوخ إليه الملف) لا يفتح القاعدة
    const otherDevice = crypto.getRandomValues(new Uint8Array(32))
    await expect(decryptSnapshotForDevice(stored, otherDevice)).rejects.toThrow()
  })

  it('نفس اللقطة تعطي نصاً مخزناً مختلفاً كل مرة (IV عشوائي)', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const a = await encryptLegacySnapshotForTest('{"x":1}', key)
    const b = await encryptLegacySnapshotForTest('{"x":1}', key)
    expect(a).not.toBe(b)
  })

  it('الصيغة التالفة ترفض بوضوح، والنص القديم يُعرف كغير مشفر', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    await expect(decryptSnapshotForDevice('enc:v9:xx:yy', key)).rejects.toThrow('صيغة لقطة') // إصدار صيغة مجهول
    expect(isEncryptedSnapshot('enc:v9:xx:yy')).toBe(true) // تنسيق مشفّر مجهول لا يُعامل كنص
    expect(isEncryptedSnapshot('{"state":{}}')).toBe(false) // لقطة نصية قديمة — تُقرأ كما هي
  })
})
