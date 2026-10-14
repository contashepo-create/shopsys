import { describe, expect, it } from 'vitest'
import { DesktopStateStorage, newAuditEvents, newJournalEntries, snapshotIdempotencyKey, appStorage, settingsAppStorage } from '../src/data/persistentStorage.ts'
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
    enqueueOutbox: async () => ({ created: true }),
    claimOutbox: async () => [],
    completeOutbox: async () => ({ updated: true }),
    integrityCheck: async () => ({ ok: true, message: 'ok' }),
    schemaVersion: async () => 1,
  }
  return { database, calls }
}

describe('جسر تخزين Zustand إلى SQLite', () => {
  it('ينشئ مفتاح منع تكرار ثابتاً يتغير مع الإصدار أو المحتوى', async () => {
    const first = await snapshotIdempotencyKey('shopsys-data', 0, '{"a":1}')
    expect(first).toBe(await snapshotIdempotencyKey('shopsys-data', 0, '{"a":1}'))
    expect(first).not.toBe(await snapshotIdempotencyKey('shopsys-data', 1, '{"a":1}'))
    expect(first).not.toBe(await snapshotIdempotencyKey('shopsys-data', 0, '{"a":2}'))
  })

  it('يستخرج أحداث التدقيق الجديدة فقط من حمولة Zustand', () => {
    const previous = JSON.stringify({ state: { auditLog: [{ id: 1, at: '2026-09-25T08:00:00.000Z', user: 'المالك', kind: 'auth', title: 'دخول' }] } })
    const next = JSON.stringify({ state: { auditLog: [
      { id: 1, at: '2026-09-25T08:00:00.000Z', user: 'المالك', kind: 'auth', title: 'دخول' },
      { id: 2, at: '2026-09-25T08:01:00.000Z', user: 'محاسب', kind: 'journal', title: 'قيد', refKey: 'entry:9' },
    ] } })
    expect(newAuditEvents(next, previous)).toEqual([{ id: 2, at: '2026-09-25T08:01:00.000Z', user: 'محاسب', kind: 'journal', title: 'قيد', refKey: 'entry:9' }])
  })

  it('يستخرج القيود الجديدة مع مراكز التكلفة من حمولة Zustand', () => {
    const previous = JSON.stringify({ state: { journal: [{ id: 1, lines: [{ accountCode: '5108', debit: 100, credit: 0 }] }] } })
    const next = JSON.stringify({ state: { journal: [
      { id: 1, lines: [{ accountCode: '5108', debit: 100, credit: 0 }] },
      { id: 2, entryNumber: 2, date: '2026-09-25', description: 'مصروف مركز', sourceType: 'manual', sourceId: null, createdBy: 'المالك', createdAt: '2026-09-25T08:00:00.000Z', reversedByEntryId: null, reversesEntryId: null, lines: [
        { accountCode: '5108', debit: 200, credit: 0, costCenterId: 4 },
        { accountCode: '1101', debit: 0, credit: 200 },
      ] },
    ] } })
    expect(newJournalEntries(next, previous)).toMatchObject([{ id: 2, lines: [{ accountCode: '5108', debit: 200, costCenterId: 4 }, { accountCode: '1101', credit: 200 }] }])
  })

  it('يحفظ ويقرأ اللقطة بإصدار متزايد ويحذفها ذرياً', async () => {
    const { database, calls } = fakeDatabase()
    const storage = new DesktopStateStorage(database, null)

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

  it('ينقل التخزين القديم إلى SQLite قبل حذف نسخته', async () => {
    const { database, calls } = fakeDatabase()
    let legacyPayload: string | null = '{"legacy":true}'
    const legacyStorage = {
      getItem: async () => legacyPayload,
      setItem: async (_name: string, value: string) => { legacyPayload = value },
      removeItem: async () => { legacyPayload = null },
    }
    const storage = new DesktopStateStorage(database, legacyStorage)

    expect(await storage.getItem('shopsys-data')).toBe('{"legacy":true}')
    expect(legacyPayload).toBeNull()
    expect(calls).toEqual([{ expectedRevision: 0, payloadJson: '{"legacy":true}' }])
  })

  it('لا يكتب فوق لقطة أحدث من نافذة أخرى', async () => {
    const { database } = fakeDatabase()
    const first = new DesktopStateStorage(database, null)
    const second = new DesktopStateStorage(database, null)

    await second.getItem('shopsys-data')
    await first.setItem('shopsys-data', '{"owner":"first"}')
    await expect(second.setItem('shopsys-data', '{"owner":"stale"}')).rejects.toThrow('تعارض')
    expect(await first.getItem('shopsys-data')).toBe('{"owner":"first"}')
  })
})


describe('تفريغ كتابة الواجهة قبل التحديث', () => {
  it('ينتظر كل الكتابات المتسلسلة ويوقف الكتابات الجديدة حتى استئناف العمل', async () => {
    const { database, calls } = fakeDatabase()
    const storage = new DesktopStateStorage(database, null)
    const a = storage.setItem('shopsys-data', '{"state":{"balance":1}}')
    const b = storage.setItem('shopsys-data', '{"state":{"balance":2}}')
    await storage.flush()
    await Promise.all([a, b])
    expect(calls).toHaveLength(2)
    await expect(storage.setItem('shopsys-data', '{"state":{}}')).rejects.toThrow('إغلاق')
    await expect(storage.removeItem('shopsys-data')).rejects.toThrow('إغلاق')
    storage.resume()
    await storage.setItem('shopsys-data', '{"state":{"balance":3}}')
    expect(calls).toHaveLength(3)
  })

  it('فشل حفظ لقطة لا يُبتلع عند طلب إغلاق/تحديث؛ يمكن إعادة المحاولة', async () => {
    const { database } = fakeDatabase()
    const save = database.saveSnapshot
    database.saveSnapshot = async () => { throw new Error('disk full') }
    const storage = new DesktopStateStorage(database, null)
    await expect(storage.setItem('shopsys-data', '{"state":{}}')).rejects.toThrow('disk full')
    // قراءة لاحقة ناجحة لا يجوز أن تخفي فشل الكتابة السابقة.
    await storage.getItem('shopsys-data')
    await expect(storage.flush()).rejects.toThrow('disk full')
    storage.resume()
    database.saveSnapshot = save
    await storage.setItem('shopsys-data', '{"state":{"balance":3}}')
    await expect(storage.flush()).resolves.toBeUndefined()
  })
})


it('flush يضم مخزن الإعدادات shopsys-app ومخزن الأعمال shopsys-data معاً', async () => {
  const { database, calls } = fakeDatabase()
  let onFlush: () => Promise<void> = async () => { throw new Error('لم يُسجّل الجسر') }
  let onResume: () => void = () => undefined
  const previous = window.shopsysDesktop
  window.shopsysDesktop = { runtime: 'electron', database, persistence: {
    onFlush: listener => { onFlush = listener }, onResume: listener => { onResume = listener },
  } }
  try {
    const settings = settingsAppStorage(), data = appStorage()
    const a = settings.setItem('shopsys-app', '{"state":{"setup":{"completed":true}}}')
    const b = data.setItem('shopsys-data', '{"state":{"balance":54321}}')
    await onFlush()
    await Promise.all([a, b])
    expect(calls).toHaveLength(2)
    await expect(settings.setItem('shopsys-app', '{}')).rejects.toThrow('إغلاق')
    await expect(data.setItem('shopsys-data', '{}')).rejects.toThrow('إغلاق')
    onResume()
    await settings.setItem('shopsys-app', '{"state":{"setup":{"completed":true}}}')
    await data.setItem('shopsys-data', '{"state":{"balance":54322}}')
    expect(calls).toHaveLength(4)
  } finally { window.shopsysDesktop = previous }
})
