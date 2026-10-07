import { describe, expect, it } from 'vitest'
import { DesktopStateStorage, desktopStorageFailure } from '../src/data/persistentStorage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'

/* v1.0.19 — حارس فقدان البيانات:
   فشل قراءة القاعدة لا يجوز أن يتحول إلى «عميل جديد» ولا أن يُكتب فوق البيانات. */

function bridge(getSnapshot: DesktopDatabaseBridge['getSnapshot'], saveCalls: unknown[]): DesktopDatabaseBridge {
  return {
    getSnapshot,
    saveSnapshot: async (input) => {
      saveCalls.push(input)
      return { revision: 1, updatedAt: new Date().toISOString() }
    },
    enqueueOutbox: async () => ({ created: true }),
    claimOutbox: async () => [],
    completeOutbox: async () => ({ updated: true }),
    integrityCheck: async () => ({ ok: true, message: 'ok' }),
    schemaVersion: async () => 2,
  }
}

describe('حارس فقدان البيانات عند فشل القراءة (v1.0.19)', () => {
  it('فشل القراءة يُسجَّل ولا يُكتب فوق القاعدة بالحالة الافتراضية', async () => {
    const saves: unknown[] = []
    const failing = bridge(async () => { throw new Error('تعذّر فك تشفير اللقطة') }, saves)
    const storage = new DesktopStateStorage(failing, null, async () => null)

    await expect(storage.getItem('guard-store-a')).rejects.toThrow('تعذّر فك تشفير')
    expect(desktopStorageFailure()).toContain('guard-store-a')

    await expect(storage.setItem('guard-store-a', JSON.stringify({ state: { setup: { completed: false } } })))
      .rejects.toThrow('منع الحفظ')
    expect(saves).toHaveLength(0)
  })

  it('القراءة الناجحة لاحقاً تمسح حالة الفشل وتسمح بالحفظ من جديد', async () => {
    const saves: unknown[] = []
    let healthy = false
    const flaky = bridge(async (storeName) => {
      if (!healthy) throw new Error('قاعدة مشغولة')
      return { storeName, revision: 0, payloadJson: null, updatedAt: null }
    }, saves)
    const storage = new DesktopStateStorage(flaky, null, async () => null)

    await expect(storage.getItem('guard-store-b')).rejects.toThrow('قاعدة مشغولة')
    expect(desktopStorageFailure()).toContain('guard-store-b')

    healthy = true
    await expect(storage.getItem('guard-store-b')).resolves.toBeNull()
    expect(desktopStorageFailure()).not.toContain('guard-store-b')

    await storage.setItem('guard-store-b', JSON.stringify({ state: { ok: true } }))
    expect(saves).toHaveLength(1)
  })
})
