/**
 * جولة v1.0.7 — موافقة المالك على تشفير قاعدة البيانات بمفتاح الجهاز:
 * لقطات المتاجر تُشفَّر AES-256-GCM قبل تخزينها في SQLite (نسخة سطح المكتب)،
 * فلا تُقرأ القاعدة المنسوخة على جهاز آخر. اللقطات النصية القديمة تُقرأ
 * كما هي (توافق رجعي) وتُكتب مشفرة عند أول حفظ (ترحيل تدريجي).
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { encryptSnapshotForDevice, decryptSnapshotForDevice, isEncryptedSnapshot } = await import('../src/data/persistentStorage.ts')

describe('تشفير قاعدة البيانات بمفتاح الجهاز (v1.0.7)', () => {
  it('دورة كاملة: تشفير → نص غير مقروء → فك بالمفتاح نفسه فقط', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const payload = JSON.stringify({ state: { items: [{ id: 1, nameAr: 'أرز مصري 5كجم', priceMinor: 8500 }], journal: [] }, version: 7 })
    const stored = await encryptSnapshotForDevice(payload, key)
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
    const a = await encryptSnapshotForDevice('{"x":1}', key)
    const b = await encryptSnapshotForDevice('{"x":1}', key)
    expect(a).not.toBe(b)
  })

  it('الصيغة التالفة ترفض بوضوح، والنص القديم يُعرف كغير مشفر', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    await expect(decryptSnapshotForDevice('enc:v9:xx:yy', key)).rejects.toThrow('صيغة لقطة') // إصدار صيغة مجهول
    expect(isEncryptedSnapshot('{"state":{}}')).toBe(false) // لقطة نصية قديمة — تُقرأ كما هي
  })
})
