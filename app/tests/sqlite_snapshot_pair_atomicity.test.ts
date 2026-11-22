import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ShopsysDatabase, type SaveSnapshotInput } from '../desktop/sqlite/storage.ts'

const wrap = (state: object) => JSON.stringify({ state })
const app0 = wrap({ fiscalYears: [{ id: 1, status: 'open' }] })
const data0 = wrap({ items: [{ id: 1, stockQty: 3 }], journal: [] })
const app1 = wrap({ fiscalYears: [{ id: 1, status: 'closed' }] })
const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10 }], createdBy: 'م', createdAt: '2026-01-01', reversedByEntryId: null, reversesEntryId: null }
const data1 = wrap({ items: [{ id: 1, stockQty: 2 }], journal: [entry] })
const pair = (appRevision = 1, dataRevision = 1) => ({ idempotencyKey: 'pair-test-001', snapshots: [
 { storeName: 'shopsys-app', expectedRevision: appRevision, payloadJson: app1 },
 { storeName: 'shopsys-data', expectedRevision: dataRevision, payloadJson: data1, journalEntries: [entry] },
] as SaveSnapshotInput[] })
async function setup() {
 const dir = mkdtempSync(join(tmpdir(), 'shopsys-pair-')), path = join(dir, 'data.sqlite')
 const db = await ShopsysDatabase.open(path)
 db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: app0 })
 db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: data0 })
 return { dir, path, db }
}
describe('نواة اختبار معاملة لقطتي SQLite — غير موصولة بمسار الاستعادة', () => {
 it('يحفظ الإعدادات والبيانات والقيد مرة واحدة ويعيد الإيصال بعد فتح القاعدة', async () => {
  const { dir, path, db } = await setup(); let current = db
  try {
   expect(current.getSnapshotPair().map(x => [x.storeName, x.revision, x.payloadJson])).toEqual([['shopsys-app', 1, app0], ['shopsys-data', 1, data0]])
   const result = current.saveSnapshotPair(pair()); expect(result.replayed).toBe(false); expect(result.results.map(x => [x.storeName, x.revision])).toEqual([['shopsys-app', 2], ['shopsys-data', 2]])
   expect(current.getSnapshotPair().map(x => [x.storeName, x.revision, x.payloadJson])).toEqual([['shopsys-app', 2, app1], ['shopsys-data', 2, data1]])
   expect(current.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
   current.close(); current = await ShopsysDatabase.open(path)
   expect(current.saveSnapshotPair(pair())).toEqual({ results: result.results, replayed: true })
   expect(current.getSnapshot('shopsys-data').revision).toBe(2); expect(current.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
   expect(() => current.saveSnapshotPair({ ...pair(), snapshots: [{ ...pair().snapshots[0], payloadJson: app0 }, pair().snapshots[1]] })).toThrow(/لا يطابق الطلب/)
  } finally { current.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('فشل تسجيل القيد في اللقطة الثانية يتراجع عن الإعدادات والبيانات والجداول والإيصال', async () => {
  const { dir, db } = await setup()
  try {
   db.raw.exec("CREATE TRIGGER fail_pair_entry BEFORE INSERT ON journal BEGIN SELECT RAISE(ABORT, 'journal failure'); END")
   expect(() => db.saveSnapshotPair(pair())).toThrow(/journal failure/)
   expect(db.getSnapshot('shopsys-app')).toMatchObject({ revision: 1, payloadJson: app0 }); expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: data0 })
   expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 0 })
   const year = db.raw.prepare('SELECT payload_json FROM c_fiscalYears WHERE payload_id = 1').get() as { payload_json: string }
   expect(JSON.parse(year.payload_json).status).toBe('open')
   db.raw.exec('DROP TRIGGER fail_pair_entry')
   expect(db.saveSnapshotPair(pair()).replayed).toBe(false)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('تعارض مراجعة البيانات بعد كتابة الإعدادات المؤقتة يعيد الطرفين', async () => {
  const { dir, db } = await setup()
  try {
   db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: wrap({ items: [{ id: 1, stockQty: 4 }], journal: [] }) })
   expect(() => db.saveSnapshotPair(pair())).toThrow(/تعارض كتابة/)
   expect(db.getSnapshot('shopsys-app')).toMatchObject({ revision: 1, payloadJson: app0 }); expect(db.getSnapshot('shopsys-data').revision).toBe(2)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('يرفض أسماء مكررة وحمولة تالفة ومفتاح إعادة خاصاً بلقطة أو دليلاً على الإعدادات', async () => {
  const { dir, db } = await setup()
  try {
   const p = pair()
   for (const snapshots of [[p.snapshots[0], p.snapshots[0]], [{ ...p.snapshots[0], payloadJson: '[]' }, p.snapshots[1]], [{ ...p.snapshots[0], idempotencyKey: 'single' }, p.snapshots[1]], [{ ...p.snapshots[0], journalEntries: [entry] }, p.snapshots[1]]]) expect(() => db.saveSnapshotPair({ ...p, snapshots })).toThrow()
   expect(db.getSnapshot('shopsys-app').revision).toBe(1); expect(db.getSnapshot('shopsys-data').revision).toBe(1)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('يرفض مجموعات مشتركة بين اللقطتين حتى إن اختفت من اللقطة القديمة لأحد الطرفين', async () => {
  const { dir, db } = await setup()
  try {
   const p = pair(); p.snapshots[1] = { ...p.snapshots[1], payloadJson: wrap({ fiscalYears: [], items: [], journal: [] }) }
   expect(() => db.saveSnapshotPair(p)).toThrow(/متداخلة/)
   expect(db.getSnapshot('shopsys-app').payloadJson).toBe(app0); expect(db.getSnapshot('shopsys-data').payloadJson).toBe(data0)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
 it('يتحقق من المراجعات أمام اتصال SQLite مستقل ولا يكتب فوقه', async () => {
  const { dir, path, db } = await setup(); const other = await ShopsysDatabase.open(path)
  try {
   other.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 1, payloadJson: wrap({ fiscalYears: [{ id: 1, status: 'open', nameAr: 'تغيير' }] }) })
   expect(() => db.saveSnapshotPair(pair())).toThrow(/تعارض كتابة/)
   expect(db.getSnapshot('shopsys-app').revision).toBe(2); expect(db.getSnapshot('shopsys-data').payloadJson).toBe(data0)
  } finally { other.close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
 })
})
it('فشل حفظ إيصال المعاملة بعد كتابة اللقطتين يتراجع عن اللقطات والقيد', async () => {
 const { dir, db } = await setup()
 try {
  db.raw.exec("CREATE TABLE snapshot_pair_receipts (idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result_json TEXT NOT NULL); CREATE TRIGGER fail_pair_receipt BEFORE INSERT ON snapshot_pair_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
  expect(() => db.saveSnapshotPair(pair())).toThrow(/receipt failure/)
  expect(db.getSnapshot('shopsys-app')).toMatchObject({ revision: 1, payloadJson: app0 }); expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: data0 })
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 0 }); expect(db.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_pair_receipts').get()).toEqual({ n: 0 })
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('يرفض تداخل مجموعة قديمة حتى بعد إزالتها من اللقطة الجديدة', async () => {
 const { dir, db } = await setup()
 try {
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: wrap({ fiscalYears: [{ id: 9 }], items: [], journal: [] }) })
  expect(() => db.saveSnapshotPair(pair(1, 2))).toThrow(/متداخلة/)
  expect(db.getSnapshot('shopsys-app').payloadJson).toBe(app0); expect(db.getSnapshot('shopsys-data').revision).toBe(2)
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('يرفض اللقطة المحلية القديمة التي تحمل غلاف حالة تالفاً قبل إجراء أي كتابة', async () => {
 const { dir, db } = await setup()
 try {
  db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 1, payloadJson: '{"state":null}' })
  expect(() => db.saveSnapshotPair(pair(2, 1))).toThrow(/اللقطة المحلية القديمة/)
  expect(db.getSnapshot('shopsys-app').payloadJson).toBe('{"state":null}'); expect(db.getSnapshot('shopsys-data').payloadJson).toBe(data0)
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
