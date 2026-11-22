import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { DesktopStateStorage } from '../src/data/persistentStorage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'

const snapshot = (state: object) => JSON.stringify({ state })
const entry = { id: 1, entryNumber: 1, date: '2026-11-15', description: 'إذن مواد', sourceType: 'material_issue', sourceId: 1, lines: [{ accountCode: '5110', debit: 30, credit: 0 }, { accountCode: '1103', debit: 0, credit: 30 }], createdBy: 'م', createdAt: '2026-11-15', reversedByEntryId: null, reversesEntryId: null }
const base = { items: [{ id: 5, stockQty: 3, costMinor: 30 }], materialRequisitions: [], projectCosts: [], stockMoves: [], journal: [] }
const issue = { ...base, items: [{ id: 5, stockQty: 2, costMinor: 30 }], materialRequisitions: [{ id: 1, projectId: 1, journalEntryId: 1 }], projectCosts: [{ id: 1, projectId: 1, journalEntryId: 1, amountMinor: 30 }], stockMoves: [{ id: 1, docType: 'material_issue', docId: 1 }], journal: [entry] }
function bridge(db: ShopsysDatabase): DesktopDatabaseBridge {
 return { getSnapshot: async name => db.getSnapshot(name), saveSnapshot: async input => db.saveSnapshot(input), deleteSnapshot: async input => db.deleteSnapshot(input), enqueueOutbox: async () => ({ created: true }), claimOutbox: async () => [], completeOutbox: async () => ({ updated: true }), integrityCheck: async () => ({ ok: true, message: 'ok' }), schemaVersion: async () => 1 }
}
it('كاتب ثانٍ لا يدمج تكلفة مخزون متزامنة مع إذن صرف؛ اللقطة والقيد يبقيان بعد إعادة فتح SQLite', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'shopsys-material-conflict-')), path = join(dir, 'db.sqlite')
 let db = await ShopsysDatabase.open(path)
 try {
  const first = new DesktopStateStorage(bridge(db), null), second = new DesktopStateStorage(bridge(db), null)
  await first.setItem('shopsys-data', snapshot(base)); await second.getItem('shopsys-data')
  await first.setItem('shopsys-data', snapshot(issue))
  await expect(second.setItem('shopsys-data', snapshot({ ...base, items: [{ id: 5, stockQty: 3, costMinor: 50 }] }))).rejects.toThrow(/تعارض.*صرف المواد/)
  expect(db.getSnapshot('shopsys-data').revision).toBe(2)
  expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(issue)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
  await second.getItem('shopsys-data'); db.close(); db = await ShopsysDatabase.open(path)
  expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(issue)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('فشل إدراج إذن المواد يتراجع عن تغيير اللقطة والمخزون والقيد داخل SQLite', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'shopsys-material-rollback-')), db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
 try {
  const storage = new DesktopStateStorage(bridge(db), null)
  await storage.setItem('shopsys-data', snapshot(base))
  db.raw.exec('CREATE TRIGGER fail_material BEFORE INSERT ON c_materialRequisitions BEGIN SELECT RAISE(ABORT, "material failure"); END')
  await expect(storage.setItem('shopsys-data', snapshot(issue))).rejects.toThrow(/material failure/)
  expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(base) })
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 0 })
  const row = db.raw.prepare('SELECT payload_json FROM c_items WHERE payload_id = 5').get() as { payload_json: string }
  expect(JSON.parse(row.payload_json)).toEqual(base.items[0])
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
