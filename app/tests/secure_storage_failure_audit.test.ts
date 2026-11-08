import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../src/core/security.ts', () => ({
 deriveKey: vi.fn(async () => ({} as CryptoKey)),
 encryptText: vi.fn(async (plain: string) => `SSENC1.${plain}`),
 decryptText: vi.fn(async (value: string) => value),
 isEncrypted: (value: string) => value.startsWith('SSENC1.'),
}))
vi.mock('../src/data/desktopBridge.ts', () => ({ desktopBridge: () => null }))
import { secureStorage, flushSecureStorageWrites } from '../src/data/secureStorage.ts'
import { withInvoiceCommitLock } from '../src/data/invoiceCommitLock.ts'

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'locks'); localStorage.clear() })

it('لا يؤكد القفل نجاح الحفظ إذا فشلت الكتابة وانتهت قبل فحص التصريف', async () => {
 localStorage.setItem('shopsys-k', 'a'.repeat(64))
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: () => unknown) => callback() } })
 const write = vi.spyOn(Storage.prototype, 'setItem')
 write.mockImplementation((key, _value) => { if (key === 'shopsys-data') throw new Error('المساحة ممتلئة') })
 const commit = vi.fn(async () => {
  // صفة الكتابة المعلقة زالت قبل أن يصل قفل الترحيل إلى flush.
  await Promise.resolve(secureStorage.setItem('shopsys-data', 'document')).catch(() => undefined)
  return 'document'
 })
 await expect(withInvoiceCommitLock(async () => {}, commit)).rejects.toThrow('المساحة ممتلئة')
 expect(commit).toHaveBeenCalledOnce()
 expect(localStorage.getItem('shopsys-data')).toBeNull()
 write.mockRestore()
 await Promise.resolve(secureStorage.setItem('shopsys-data', 'recovered'))
 await expect(flushSecureStorageWrites('shopsys-data')).resolves.toBeUndefined()
})

it('استمرار فشل مخزن الإعدادات لا يمنع تصريف مخزن البيانات', async () => {
 localStorage.setItem('shopsys-k', 'a'.repeat(64))
 const original = Storage.prototype.setItem
 const write = vi.spyOn(Storage.prototype, 'setItem')
 write.mockImplementation(function (this: Storage, key, value) { if (key === 'shopsys-app') throw new Error('تعذر حفظ الإعدادات'); return original.call(this, key, value) })
 await expect(Promise.resolve(secureStorage.setItem('shopsys-app', 'settings'))).rejects.toThrow('تعذر حفظ الإعدادات')
 await expect(flushSecureStorageWrites('shopsys-app')).rejects.toThrow('تعذر حفظ الإعدادات')
 await Promise.resolve(secureStorage.setItem('shopsys-data', 'ledger'))
 await expect(flushSecureStorageWrites('shopsys-data')).resolves.toBeUndefined()
 expect(localStorage.getItem('shopsys-data')).toBe('SSENC1.ledger')
 write.mockRestore()
 await Promise.resolve(secureStorage.setItem('shopsys-app', 'recovered-settings'))
 await expect(flushSecureStorageWrites()).resolves.toBeUndefined()
})

it('يمنع بدء عملية جديدة عند فشل قديم غير مصحح، ثم يسمح بعد حفظ لقطة أحدث', async () => {
 localStorage.setItem('shopsys-k', 'a'.repeat(64))
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: () => unknown) => callback() } })
 const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('فشل سابق') })
 await expect(Promise.resolve(secureStorage.setItem('shopsys-data', 'lost'))).rejects.toThrow('فشل سابق')
 const commit = vi.fn(() => 'next')
 await expect(withInvoiceCommitLock(async () => {}, commit)).rejects.toThrow('فشل سابق')
 expect(commit).not.toHaveBeenCalled()
 write.mockRestore()
 await Promise.resolve(secureStorage.setItem('shopsys-data', 'corrected'))
 await expect(withInvoiceCommitLock(async () => {}, commit)).resolves.toBe('next')
 expect(localStorage.getItem('shopsys-data')).toBe('SSENC1.corrected')
})

it('ينتظر الكتابات المتتابعة ويحذف الفشل عند نجاح اللقطة الأحدث فقط', async () => {
 localStorage.setItem('shopsys-k', 'a'.repeat(64))
 const original = Storage.prototype.setItem
 const write = vi.spyOn(Storage.prototype, 'setItem')
 write.mockImplementation(function (this: Storage, key, value) { if (key === 'shopsys-data' && value === 'SSENC1.old') throw new Error('فشل القديم'); return original.call(this, key, value) })
 const older = Promise.resolve(secureStorage.setItem('shopsys-data', 'old'))
 const newer = Promise.resolve(secureStorage.setItem('shopsys-data', 'new'))
 const flushed = flushSecureStorageWrites('shopsys-data')
 await expect(older).rejects.toThrow('فشل القديم')
 await newer
 await expect(flushed).resolves.toBeUndefined()
 expect(localStorage.getItem('shopsys-data')).toBe('SSENC1.new')
})
