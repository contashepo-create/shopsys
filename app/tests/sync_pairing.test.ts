import { describe, expect, it } from 'vitest'
import { exportSyncPairing, importSyncPairing, SYNC_PAIRING_PREFIX } from '../src/core/syncPairing.ts'

const config = {
  url: 'https://demo.supabase.co', anonKey: 'a'.repeat(40), storeId: 'shop-cairo-1',
  secret: 'S'.repeat(43), accessToken: 'A'.repeat(43),
}

describe('ملف ربط المزامنة المشفر', () => {
  it('ينقل الإعداد كاملاً دون ظهور الأسرار في الملف', async () => {
    const file = await exportSyncPairing(config, 'Strong-Pairing-2026', '2026-09-22T00:00:00Z')
    expect(file.startsWith(SYNC_PAIRING_PREFIX)).toBe(true)
    expect(file).not.toContain(config.secret)
    expect(file).not.toContain(config.accessToken)
    expect(await importSyncPairing(file, 'Strong-Pairing-2026')).toEqual(config)
  })

  it('يرفض كلمة خاطئة وملفاً غير مشفر', async () => {
    const file = await exportSyncPairing(config, 'Strong-Pairing-2026')
    await expect(importSyncPairing(file, 'Wrong-Password-2026')).rejects.toThrow('خاطئة')
    await expect(importSyncPairing('plain json secrets', 'Strong-Pairing-2026')).rejects.toThrow('ليس ملف')
  })

  it('يرفض كلمة حماية قصيرة', async () => {
    await expect(exportSyncPairing(config, 'short')).rejects.toThrow('12')
  })
})
