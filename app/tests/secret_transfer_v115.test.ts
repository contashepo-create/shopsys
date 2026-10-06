/**
 * جولة v1.0.15 — المرحلة ⑤: نسخة سر التشفير بكلمة سر (نقل بين الأجهزة).
 * القاعدة مشفرة بسر الجهاز؛ الملف المغلّف ينقل السر بكلمة سر يختارها المالك.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { wrapSecretWithPassword, unwrapSecretWithPassword, parseKeyFile, keyFileName, KEY_FILE_FORMAT } = await import('../src/core/secretTransfer.ts')

const SECRET = 'a'.repeat(64) // سر 256-بت نمط getDeviceSecret

describe('⑤ نقل السر — التغليف بكلمة سر', () => {
  it('يغلّف السر ويفكه بنفس كلمة السر — والملح عشوائي لكل ملف (حملتان لنفس السر تختلفان)', async () => {
    const file = await wrapSecretWithPassword({ secret: SECRET, password: 'pass123456', shopName: 'بقالة النور' })
    expect(file.format).toBe(KEY_FILE_FORMAT)
    expect(file.kdf.iterations).toBe(250_000)
    expect(await unwrapSecretWithPassword(file, 'pass123456')).toBe(SECRET)
    const file2 = await wrapSecretWithPassword({ secret: SECRET, password: 'pass123456', shopName: 'بقالة النور' })
    expect(file2.kdf.saltB64).not.toBe(file.kdf.saltB64)
    expect(file2.payload).not.toBe(file.payload)
  })

  it('كلمة السر الخاطئة تُرفض برسالة عربية واضحة — لا تسريب للسر بأي حال', async () => {
    const file = await wrapSecretWithPassword({ secret: SECRET, password: 'pass123456', shopName: 'X' })
    await expect(unwrapSecretWithPassword(file, 'wrong-pass')).rejects.toThrow('كلمة السر غير صحيحة')
  })

  it('ملف بلبنة غير سر (نص عادي) يُرفض — لا فتح لأي شيء ليس ملف سرنا', async () => {
    const file = await wrapSecretWithPassword({ secret: SECRET, password: 'pass123456', shopName: 'X' })
    await expect(unwrapSecretWithPassword({ ...file, payload: 'SSENC1.' + file.payload.split('.')[1] + '.' + file.payload.split('.')[1] }, 'pass123456')).rejects.toThrow()
  })

  it('parseKeyFile يقبل الصيغة ويرفض ما ليس ملف سر', async () => {
    const file = await wrapSecretWithPassword({ secret: SECRET, password: 'pass123456', shopName: 'متجر' })
    expect(parseKeyFile(JSON.stringify(file)).shopName).toBe('متجر')
    expect(() => parseKeyFile('{"format":"other"}')).toThrow('صيغة تَحَكَّم')
    expect(() => parseKeyFile('ليس json')).toThrow('JSON')
  })

  it('كلمة السر القصيرة مرفوضة عند التصدير (6 أحرف حد أدنى)', async () => {
    await expect(wrapSecretWithPassword({ secret: SECRET, password: '123', shopName: 'X' })).rejects.toThrow('6 أحرف')
    await expect(wrapSecretWithPassword({ secret: SECRET, password: '', shopName: 'X' })).rejects.toThrow('مطلوبة')
  })

  it('اسم الملف لاتيني آمن ومؤرخ', () => {
    expect(keyFileName('بقالة النور', '2026-10-05T19:30:00Z')).toBe('tahakom-key-بقالة-النور-2026-10-05.tkey.json')
  })
})

describe('⑤ ختم التخزين عند استبدال السر', () => {
  it('setDeviceSecret يقبل سراً صالحاً 256-بت ويختم الكتابة حتى إعادة التشغيل', async () => {
    const { setDeviceSecret, isStorageSealed, unsealStorageAfterReload, getDeviceSecret } = await import('../src/data/secureStorage.ts')
    const original = getDeviceSecret()
    try {
      setDeviceSecret('f'.repeat(64))
      expect(isStorageSealed()).toBe(true)
      // الكتابة مختومة: setItem لا يكتب شيئاً بعد استبدال السر
      const before = localStorage.getItem('tahakom-seal-test')
      const storage = (await import('../src/data/secureStorage.ts')).secureStorage
      await storage.setItem('tahakom-seal-test', 'لا يجب أن يُكتب')
      expect(localStorage.getItem('tahakom-seal-test')).toBe(before ?? null)
      unsealStorageAfterReload()
      expect(isStorageSealed()).toBe(false)
    } finally {
      // إعادة الجهاز لسره الأصلي (الاختبار لا يلوث حالة السر)
      setDeviceSecret(original)
      unsealStorageAfterReload()
      localStorage.removeItem('tahakom-seal-test')
    }
  })

  it('setDeviceSecret يرفض سراً ليس 64 رقماً سداسياً', async () => {
    const { setDeviceSecret } = await import('../src/data/secureStorage.ts')
    expect(() => setDeviceSecret('قصير')).toThrow('64 رقماً')
    expect(() => setDeviceSecret('z'.repeat(64))).toThrow('64 رقماً')
  })
})
