import { describe, expect, it } from 'vitest'
import { DesktopStateStorage } from '../src/data/persistentStorage.ts'
import type { DesktopDatabaseBridge, DesktopSnapshot } from '../src/data/desktopBridge.ts'

function fakeDatabase() {
  const rows = new Map<string, { revision: number; payloadJson: string; updatedAt: string }>()
  const calls: Array<{ expectedRevision: number; payloadJson: string }> = []
  const database: DesktopDatabaseBridge = {
    getSnapshot: async (storeName): Promise<DesktopSnapshot> => {
      const row = rows.get(storeName)
      return row
        ? { storeName, revision: row.revision, payloadJson: row.payloadJson, updatedAt: row.updatedAt }
        : { storeName, revision: 0, payloadJson: null, updatedAt: null }
    },
    saveSnapshot: async ({ storeName, expectedRevision, payloadJson }) => {
      const current = rows.get(storeName)
      const revision = current?.revision ?? 0
      if (revision !== expectedRevision) throw new Error('تعارض إصدار قاعدة البيانات')
      const updatedAt = new Date().toISOString()
      rows.set(storeName, { revision: revision + 1, payloadJson, updatedAt })
      calls.push({ expectedRevision, payloadJson })
      return { revision: revision + 1, updatedAt }
    },
    deleteSnapshot: async ({ storeName, expectedRevision }) => {
      const revision = rows.get(storeName)?.revision ?? 0
      if (revision !== expectedRevision) throw new Error('تعارض إصدار قاعدة البيانات')
      rows.delete(storeName)
      return { revision: 0, updatedAt: new Date().toISOString() }
    },
    integrityCheck: async () => ({ ok: true, message: 'ok' }),
    schemaVersion: async () => 1,
  }
  return { database, calls }
}

describe('جسر تخزين Zustand إلى SQLite', () => {
  it('يحفظ ويقرأ اللقطة بإصدار متزايد ويحذفها ذرياً', async () => {
    const { database, calls } = fakeDatabase()
    const storage = new DesktopStateStorage(database)

    expect(await storage.getItem('shopsys-data')).toBeNull()
    await storage.setItem('shopsys-data', '{"version":1}')
    await storage.setItem('shopsys-data', '{"version":2}')

    expect(calls).toEqual([
      { expectedRevision: 0, payloadJson: '{"version":1}' },
      { expectedRevision: 1, payloadJson: '{"version":2}' },
    ])
    expect(await storage.getItem('shopsys-data')).toBe('{"version":2}')
    await storage.removeItem('shopsys-data')
    expect(await storage.getItem('shopsys-data')).toBeNull()
  })

  it('لا يكتب فوق لقطة أحدث من نافذة أخرى', async () => {
    const { database } = fakeDatabase()
    const first = new DesktopStateStorage(database)
    const second = new DesktopStateStorage(database)

    await second.getItem('shopsys-data')
    await first.setItem('shopsys-data', '{"owner":"first"}')
    await expect(second.setItem('shopsys-data', '{"owner":"stale"}')).rejects.toThrow('تعارض')
    expect(await first.getItem('shopsys-data')).toBe('{"owner":"first"}')
  })
})
