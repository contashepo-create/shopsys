import { afterEach, expect, it, vi } from 'vitest'
import { withInvoiceCommitLock } from '../src/data/invoiceCommitLock.ts'
import { setDeviceSecret, unsealStorageAfterReload } from '../src/data/secureStorage.ts'

afterEach(() => { unsealStorageAfterReload(); localStorage.clear(); Reflect.deleteProperty(navigator, 'locks') })
it('قفل الويب الفعلي يرفض العمل عندما يُختم التخزين بعد نقل السر', async () => {
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } })
 setDeviceSecret('a'.repeat(64))
 const commit = vi.fn()
 await expect(withInvoiceCommitLock(async () => {}, commit)).rejects.toThrow(/مختوم/)
 expect(commit).not.toHaveBeenCalled()
})
it('يكتشف تغير المفتاح أثناء العملية حتى لو أعيد فتح الختم', async () => {
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } })
 const commit = vi.fn(() => { setDeviceSecret('b'.repeat(64)); unsealStorageAfterReload(); return 1 })
 await expect(withInvoiceCommitLock(async () => {}, commit)).rejects.toThrow(/تغير مفتاحه/)
 expect(commit).toHaveBeenCalledOnce()
})
