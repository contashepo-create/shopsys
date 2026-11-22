import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyMigrationsTo, ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { MIGRATIONS } from '../desktop/sqlite/schema.ts'
import { DesktopStateStorage } from '../src/data/persistentStorage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'

const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10 }], createdBy: 'م', createdAt: '2026-01-01', reversedByEntryId: null, reversesEntryId: null }
const event = { id: 1, at: '2026-01-01', user: 'م', kind: 'journal', title: 'قيد' }
const payload = JSON.stringify({ state: { journal: [entry], auditLog: [event], items: [{ id: 1 }] } })
const request = { storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payload, idempotencyKey: 'attempt-001', auditEvents: [event], journalEntries: [entry] }

async function setup() {
 const dir = mkdtempSync(join(tmpdir(), 'shopsys-receipt-')), path = join(dir, 'data.sqlite')
 return { dir, path, db: await ShopsysDatabase.open(path) }
}

describe('إيصال حفظ لقطة SQLite المنفردة', () => {
 it('يحفظ الإيصال مع اللقطة والقيد والتدقيق، ويعيد نفس النتيجة بعد إعادة فتح القاعدة', async () => {
  const { dir, path, db } = await setup(); let current = db
  try {
   const first = current.saveSnapshot(request)
   expect(current.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_save_receipts').get()).toEqual({ n: 1 })
   current.close(); current = await ShopsysDatabase.open(path)
   expect(current.saveSnapshot(request)).toEqual({ ...first, replayed: true })
   expect(current.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
   expect(current.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 })
  } finally { current.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('يرفض إعادة محاولة بأدلة مختلفة ولو تطابقت الحمولة والمراجعة، ويرفض إعادة استخدام المفتاح لمراجعة جديدة', async () => {
  const { dir, db } = await setup()
  try {
   db.saveSnapshot(request)
   for (const altered of [{ ...request, journalEntries: [] }, { ...request, auditEvents: [] }, { ...request, auditEvents: [{ ...event, title: 'تغيير' }] }]) expect(() => db.saveSnapshot(altered)).toThrow(/أدلة إعادة محاولة/)
   expect(() => db.saveSnapshot({ ...request, expectedRevision: 1 })).toThrow(/لا يطابق الحمولة أو المراجعة/)
   expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: payload })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('فشل تسجيل الإيصال يتراجع عن اللقطة والجداول والقيد والتدقيق', async () => {
  const { dir, db } = await setup()
  try {
   db.raw.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON snapshot_save_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
   expect(() => db.saveSnapshot(request)).toThrow(/receipt failure/)
   expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 0, payloadJson: null })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 0 })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 })
   expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='c_items'").get()).toBeUndefined()
   db.raw.exec('DROP TRIGGER fail_receipt')
   expect(db.saveSnapshot(request).revision).toBe(1)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('يحفظ آخر إيصال فقط لكل متجر ولا يؤكد طلباً قديماً بعد كتابة أحدث', async () => {
  const { dir, db } = await setup()
  try {
   db.saveSnapshot(request)
   db.saveSnapshot({ ...request, expectedRevision: 1, idempotencyKey: 'attempt-002', auditEvents: [], journalEntries: [] })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_save_receipts').get()).toEqual({ n: 1 })
   expect(() => db.saveSnapshot(request)).toThrow(/تعارض كتابة/)
   db.deleteSnapshot({ storeName: 'shopsys-data', expectedRevision: 2 })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_save_receipts').get()).toEqual({ n: 0 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('ترقية قاعدة قديمة تنشئ نسخة احتياطية ولا تفترض أدلة إعادة محاولة بلا إيصال', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-receipt-upgrade-')), path = join(dir, 'data.sqlite'), backups = join(dir, 'backups')
  const old = new Database(path)
  await applyMigrationsTo(old, backups, [MIGRATIONS[0]])
  old.prepare('INSERT INTO snapshots (store_name, revision, payload_json, idempotency_key, origin_device, origin_branch, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(request.storeName, 1, payload, request.idempotencyKey, 'old', '', '2026-01-01')
  old.close()
  const db = await ShopsysDatabase.open(path, { backupsDir: backups })
  try {
   const backupName = readdirSync(backups).find(name => name.startsWith('pre-migration-2-'))
   expect(backupName).toBeDefined()
   const backup = new Database(join(backups, backupName!), { readonly: true })
   try {
    expect(backup.prepare('SELECT revision, payload_json FROM snapshots WHERE store_name = ?').get(request.storeName)).toEqual({ revision: 1, payload_json: payload })
    expect(backup.prepare('SELECT id FROM migrations ORDER BY id').all()).toEqual([{ id: 1 }])
   } finally { backup.close() }
   expect(() => db.saveSnapshot(request)).toThrow(/لا يمكن تأكيد أدلة إعادة محاولة/)
   expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: payload })
   expect(db.saveSnapshot({ ...request, expectedRevision: 1, idempotencyKey: 'new-attempt', auditEvents: [], journalEntries: [] }).revision).toBe(2)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
})

it('تصريف مخزن سطح المكتب يعيد الطلب بعد ضياع الرد دون تكرار القيد', async () => {
 const { dir, db } = await setup()
 let loseReply = true
 const bridge: DesktopDatabaseBridge = {
  getSnapshot: async name => db.getSnapshot(name),
  saveSnapshot: async input => { const saved = db.saveSnapshot(input); if (loseReply) { loseReply = false; throw new Error('ضياع الرد بعد الحفظ') }; return saved },
  deleteSnapshot: async input => db.deleteSnapshot(input),
  enqueueOutbox: async () => ({ created: true }), claimOutbox: async () => [], completeOutbox: async () => ({ updated: true }), integrityCheck: async () => ({ ok: true, message: 'ok' }), schemaVersion: async () => 2,
 }
 try {
  const storage = new DesktopStateStorage(bridge, null)
  await expect(storage.setItem('shopsys-data', payload)).rejects.toThrow(/ضياع الرد/)
  expect(db.getSnapshot('shopsys-data').revision).toBe(1)
  await expect(storage.setItem('shopsys-data', payload)).resolves.toBeUndefined()
  expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: payload })
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 })
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('تعارض اتصالين وتراجع تحديث الإيصال لا يغيران اللقطة أو الإيصال السابق', async () => {
 const { dir, path, db } = await setup(); const other = await ShopsysDatabase.open(path)
 try {
  db.saveSnapshot(request)
  expect(other.saveSnapshot(request).replayed).toBe(true)
  db.raw.exec("CREATE TRIGGER fail_receipt_update BEFORE UPDATE ON snapshot_save_receipts BEGIN SELECT RAISE(ABORT, 'receipt update failure'); END")
  const newer = { ...request, expectedRevision: 1, idempotencyKey: 'attempt-002', payloadJson: JSON.stringify({ state: { journal: [entry], auditLog: [event], items: [{ id: 1, name: 'جديد' }] } }), auditEvents: [], journalEntries: [] }
  expect(() => other.saveSnapshot(newer)).toThrow(/receipt update failure/)
  expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: payload })
  expect(db.saveSnapshot(request).replayed).toBe(true)
  db.raw.exec('DROP TRIGGER fail_receipt_update')
  expect(other.saveSnapshot(newer).revision).toBe(2)
  expect(() => db.saveSnapshot(request)).toThrow(/تعارض كتابة/)
 } finally { other.close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('فشل حذف إيصال لقطة يُبقي الإبطال والكتابة بلا مفتاح خارج القاعدة', async () => {
 const { dir, db } = await setup()
 try {
  db.saveSnapshot(request)
  db.raw.exec("CREATE TRIGGER fail_receipt_delete BEFORE DELETE ON snapshot_save_receipts BEGIN SELECT RAISE(ABORT, 'receipt delete failure'); END")
  expect(() => db.deleteSnapshot({ storeName: 'shopsys-data', expectedRevision: 1 })).toThrow(/receipt delete failure/)
  expect(() => db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: JSON.stringify({ state: { items: [] } }) })).toThrow(/receipt delete failure/)
  expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: payload })
  expect(db.saveSnapshot(request).replayed).toBe(true)
  db.raw.exec('DROP TRIGGER fail_receipt_delete')
  expect(db.deleteSnapshot({ storeName: 'shopsys-data', expectedRevision: 1 }).revision).toBe(2)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_save_receipts').get()).toEqual({ n: 0 })
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
