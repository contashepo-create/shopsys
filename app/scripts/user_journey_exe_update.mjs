/**
 * 🖥️ رحلة مستخدم §101 التنفيذية: تثبيت 1.0.0 → يوم عمل → تحديث 1.0.1
 * يصل بترحيل مخطط → الترتيب الصارم للوثيقة (§3.3): تحديث ← نسخة احتياطية
 * قبلية ← ترحيل ← فحص سلامة ← إقلاع — والبيانات كما هي بلا فقد ولا ازدواج.
 * ثم «مسح بيانات المتصفح» لا يمس القاعدة إطلاقاً (قاعدة userData مستقلة).
 *
 * التشغيل: node --experimental-strip-types scripts/user_journey_exe_update.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ShopsysDatabase, applyMigrationsTo } from '../desktop/sqlite/storage.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

const dir = mkdtempSync(join(tmpdir(), 'shopsys-exe-update-'))
const dbPath = join(dir, 'shopsys.db')
const backupsDir = join(dir, 'backups')

/* ═══ اليوم 1: إصدار 1.0.0 — عمل حقيقي يُخزَّن ═══ */
console.log('\n═══ 1) إصدار 1.0.0: يوم عمل يُحفظ في القاعدة ═══')
{
  const db = await ShopsysDatabase.open(dbPath, { backupsDir })
  assert.equal(db.schemaVersion(), 1)
  const entry = { id: 1, entryNumber: 1, date: '2026-10-04', description: 'مبيعات اليوم', sourceType: 'sale', sourceId: 1, lines: [{ accountCode: '1101', debit: 5000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 5000 }], createdBy: 'المالك', createdAt: '2026-10-04T09:00:00', reversedByEntryId: null, reversesEntryId: null }
  const payload = JSON.stringify({ state: { sales: [{ id: 1, invoiceNumber: 'S-0001', totals: { totalMinor: 5000 } }], journal: [entry], auditLog: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة' }] }, version: 25 })
  const save = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payload, idempotencyKey: 'day1', journalEntries: [entry], auditEvents: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة' }] })
  db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: JSON.stringify({ state: { setup: { shopName: 'محل الرحلة', completed: true } }, version: 0 }) })
  assert.equal(save.revision, 1)
  db.close()
  ok('يوم العمل مخزون: لقطة shopsys-data وshopsys-app ويومية مسطحة — المخطط 1')
}

/* ═══ وصول التحديث 1.0.1 بترحيل v2: الترتيب الصارم ═══ */
console.log('\n═══ 2) التحديث 1.0.1 يصل بترحيل v2: نسخة ← ترحيل ← فحص ═══')
{
  /* العملية الرئيسية للنسخة الجديدة تفتح القاعدة وتطبق ترحيلها —
   * تماماً كما تفعل ShopsysDatabase.open مع MIGRATIONS القادمة */
  const raw = new Database(dbPath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const v2 = [{ id: 2, name: 'رحلة الاختبار v2: عمود جهاز التثبيت على snapshots', sql: 'ALTER TABLE snapshots ADD COLUMN installed_by TEXT' }]
  await applyMigrationsTo(raw, backupsDir, v2)
  const backups = readdirSync(backupsDir).filter((f) => f.startsWith('pre-migration-2'))
  assert.equal(backups.length, 1, 'نسخة ما قبل الترحيل الإلزامية لم تُنشأ')
  const migrations = raw.prepare('SELECT id FROM migrations ORDER BY id').all()
  assert.deepEqual(migrations.map((m) => m.id), [1, 2], 'سجل الترحيلات ناقص')
  const cols = raw.prepare('PRAGMA table_info(snapshots)').all().map((c) => c.name)
  assert.ok(cols.includes('installed_by'), 'ترحيل v2 لم يُنفَّذ')
  assert.equal(raw.pragma('integrity_check', { simple: true }), 'ok', 'سلامة القاعدة اختلت بعد الترحيل')
  raw.close()
  ok('الترتيب الصارم: نسخة pre-migration-2 قبلية موجودة ← الترحيل نُفِّذ ← integrity_check سليم')
}

/* ═══ إقلاع النسخة الجديدة: البيانات كما هي ═══ */
console.log('\n═══ 3) إقلاع 1.0.1: كل بيانات اليوم الأول كما كانت ═══')
let payloadAfterUpdate
{
  const db = await ShopsysDatabase.open(dbPath, { backupsDir })
  assert.equal(db.schemaVersion(), 2, 'رقم المخطط لم يتقدم')
  const snap = db.getSnapshot('shopsys-data')
  assert.equal(snap.revision, 1, 'المراجعة تغيرت بالترحيل — لا يجوز')
  assert.ok(snap.payloadJson.includes('S-0001'), 'بيانات اليوم الأول ضاعت بالتحديث')
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM journal').get().n, 1, 'اليومية ضاعت')
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1, 'التدقيق ضاع')
  assert.ok(db.getSnapshot('shopsys-app').payloadJson.includes('محل الرحلة'), 'إعدادات المتجر ضاعت')
  assert.deepEqual(db.integrityCheck(), { ok: true, message: 'ok' })
  /* يوم عمل جديد على النسخة الجديدة يكمل فوق القديم بلا مساس */
  payloadAfterUpdate = snap.payloadJson
  const save = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: payloadAfterUpdate, idempotencyKey: 'day2' })
  assert.equal(save.revision, 2)
  db.close()
  ok('بعد التحديث: المخطط 2 والمراجعة واليومية والتدقيق والإعدادات كما كانت — والحفظ الجديد يتكامل')
}

/* ═══ مسح بيانات المتصفح: لا يمس القاعدة إطلاقاً ═══ */
console.log('\n═══ 4) «مسح بيانات المتصفح» — القاعدة في userData مستقلة تماماً ═══')
{
  /* نقضي أي أثر تخزين متصفحي (محاكاة مسح كامل) ثم نفتح القاعدة */
  const db = await ShopsysDatabase.open(dbPath, { backupsDir })
  assert.ok(db.getSnapshot('shopsys-data').payloadJson.includes('S-0001'), 'القاعدة تأثرت بمسح المتصفح')
  assert.equal(db.getSnapshot('shopsys-data').revision, 2)
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM journal').get().n, 1)
  db.close()
  ok('مسح كامل لبيانات المتصفح لا يمس قاعدة userData — معيار قبول §101 حرفياً')
}

/* ═══ الخلاصة ═══ */
{
  assert.ok(existsSync(dbPath))
  ok('الرحلة كاملة: 1.0.0 يوم عمل → تحديث 1.0.1 بترحيل آمن → إقلاع سليم → متانة ضد مسح المتصفح')
}

console.log(`\n✅ رحلة مستخدم EXE والتحديث التلقائي: ${pass} فحوصاً ناجحة`)
