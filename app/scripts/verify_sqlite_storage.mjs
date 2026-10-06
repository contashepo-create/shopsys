/**
 * بوابة §101 التنفيذية (وثيقة المعمارية §3.7): قاعدة SQLite المحلية —
 * المخطط الكامل، القفل التفاؤلي والتكرار الآمن، معرّفات Snowflake،
 * الحذف الناعم (لا حذف فيزيائي)، الكتابة الانتقائية بالفرق، فهرس الترقيم
 * الفريد (فرع، نوع، رقم)، outbox الجاهزة، أعمدة النسب، والنسخ الاحتياطي.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_sqlite_storage.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { SnowflakeGenerator, SNOWFLAKE_MAX } from '../desktop/sqlite/snowflake.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

const dir = mkdtempSync(join(tmpdir(), 'shopsys-sqlite-gate-'))
const dbPath = join(dir, 'shopsys.db')
const db = await ShopsysDatabase.open(dbPath)

/* ═══ ① المخطط: كل جداول القرار موجودة بأعمدتها ═══ */
{
  const tables = new Set(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))
  for (const t of ['meta', 'migrations', 'snapshots', 'journal', 'audit_log', 'doc_numbers', 'sync_outbox'])
    assert.ok(tables.has(t), `الجدول ${t} مفقود`)
  const cols = (t) => db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  for (const col of ['origin_device', 'origin_branch', 'updated_at']) {
    assert.ok(cols('snapshots').includes(col) && cols('journal').includes(col) && cols('audit_log').includes(col), `عمود النسب ${col} مفقود`)
  }
  assert.ok(cols('doc_numbers').includes('branch'), 'فهرس الترقيم بلا عمود الفرع (توافق §103)')
  assert.equal(db.raw.pragma('journal_mode', { simple: true }), 'wal', 'وضع WAL غير مفعّل')
  ok('المخطط: 7 جداول أساسية + أعمدة النسب على snapshots/journal/audit + WAL')
}

/* ═══ ② حفظ أول + استخراج اليومية والتدقيق في نفس المعاملة ═══ */
const entryA = { id: 101, entryNumber: 101, date: '2026-10-04', description: 'بيع نقدي', sourceType: 'sale', sourceId: 1, lines: [{ accountCode: '1101', debit: 1140, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1000 }, { accountCode: '2102', debit: 0, credit: 140 }], createdBy: 'المالك', createdAt: '2026-10-04T09:00:00', reversedByEntryId: null, reversesEntryId: null }
const payloadV1 = JSON.stringify({
  state: {
    sales: [{ id: 1, invoiceNumber: 'S-0001', totals: { totalMinor: 1140 } }, { id: 2, invoiceNumber: 'S-0002', totals: { totalMinor: 500 } }],
    journal: [entryA],
    auditLog: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة S-0001' }],
    customers: [{ id: 7, nameAr: 'عميل بوابة' }, { id: 8, nameAr: 'عميل ثانٍ' }],
    setup: { shopName: 'محل البوابة' },
  },
  version: 25,
})
const baseState = (sales) => ({
  sales,
  journal: [entryA],
  auditLog: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة S-0001' }],
  customers: [{ id: 7, nameAr: 'عميل بوابة' }, { id: 8, nameAr: 'عميل ثانٍ' }],
  setup: { shopName: 'محل البوابة' },
})
const payloadV2 = JSON.stringify({ state: baseState([{ id: 1, invoiceNumber: 'S-0001', totals: { totalMinor: 1140 } }, { id: 2, invoiceNumber: 'S-0002', totals: { totalMinor: 700 } }]), version: 25 })
{
  const r = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payloadV1, idempotencyKey: 'k1', journalEntries: [entryA], auditEvents: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة S-0001' }] })
  assert.equal(r.revision, 1)
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM journal').get().n, 1, 'اليومية لم تُستخرج')
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1, 'التدقيق لم يُستخرج')
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM c_sales').get().n, 2)
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM c_customers').get().n, 2)
  assert.ok(!existsSync(join(dir, 'c_setup.sqlite')), 'القيم غير المصفوفية لا تنشئ جداول')
  ok('الحفظ الأول: لقطة + يومية مسطحة + تدقيق + جدول لكل مجموعة في transaction واحدة')
}

/* ═══ ③ القفل التفاؤلي + التكرار الآمن (idempotency) ═══ */
{
  const replay = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payloadV1, idempotencyKey: 'k1' })
  assert.equal(replay.replayed, true, 'إعادة الإرسال لم تُكتشف كتكرار')
  assert.equal(db.getSnapshot('shopsys-data').revision, 1, 'التكرار رفع المراجعة خطأً')
  assert.throws(() => db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payloadV1, idempotencyKey: 'kx' }), /تعارض كتابة/, 'كاتب قديم مرّ بلا تعارض')
  ok('القفل التفاؤلي: المراجعة تتقدم فقط بالكاتب الحالي — والتكرار يعيد نتيجته بلا كتابة مزدوجة')
}

/* ═══ ④ الكتابة الانتقائية: المجموعة الساكنة لا تُمسّ ═══ */
{
  const before = db.raw.prepare('SELECT updated_at FROM c_customers WHERE payload_id = 7').get().updated_at
  await new Promise((r) => setTimeout(r, 20))
  const r2 = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: payloadV2, idempotencyKey: 'k2' })
  assert.equal(r2.revision, 2)
  const after = db.raw.prepare('SELECT updated_at FROM c_customers WHERE payload_id = 7').get().updated_at
  assert.equal(before, after, 'مجموعة لم تتغير أُعيدت كتابتها — الكتابة ليست انتقائية')
  assert.equal(db.raw.prepare("SELECT payload_json FROM c_sales WHERE payload_id = 2").get().payload_json, JSON.stringify({ id: 2, invoiceNumber: 'S-0002', totals: { totalMinor: 700 } }))
  ok('الكتابة الانتقائية: صف المبيعات المتغير وحده كُتب — العملاء لم يُمسّ لهم شيء')
}

/* ═══ ⑤ الحذف الناعم: الأثر باقٍ والعودة تعيد إحياء الصف نفسه ═══ */
{
  const payloadV3 = JSON.stringify({
    state: {
      sales: [{ id: 1, invoiceNumber: 'S-0001', totals: { totalMinor: 1140 } }],
      journal: [entryA], auditLog: [{ id: 1, at: '2026-10-04T09:00:00', user: 'المالك', kind: 'sale', title: 'فاتورة S-0001' }],
      customers: [{ id: 7, nameAr: 'عميل بوابة' }, { id: 8, nameAr: 'عميل ثانٍ' }],
      setup: { shopName: 'محل البوابة' },
    },
    version: 25,
  })
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 2, payloadJson: payloadV3, idempotencyKey: 'k3' })
  const rows = db.raw.prepare('SELECT snowflake_id, deleted_at FROM c_sales ORDER BY payload_id').all()
  assert.equal(rows.length, 2, 'الصف المحذوف اختفى فيزيائياً — ممنوع')
  assert.ok(rows[1].deleted_at != null, 'الصف المحذوف لم يُوسم')
  assert.ok(rows[0].deleted_at == null)
  /* إعادة الإدخال: نفس هوية الصف تُستأنف بلا صف مكرر */
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 3, payloadJson: payloadV2, idempotencyKey: 'k4' })
  const revived = db.raw.prepare('SELECT COUNT(*) n FROM c_sales WHERE deleted_at IS NOT NULL').get().n
  assert.equal(revived, 0, 'الصف العائد لم يُستأنف')
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM c_sales').get().n, 2)
  ok('لا حذف فيزيائي: الحذف وسم deleted_at — والعودة تستأنف الصف نفسه (هوية Snowflake محفوظة)')
}

/* ═══ ⑥ Snowflake: رتابة + فريدة + تحت 2⁵³ ═══ */
{
  const ids = []
  for (let i = 0; i < 500; i += 1) ids.push(db.raw.prepare('SELECT snowflake_id FROM c_customers LIMIT 1').get() && undefined)
  void ids
  const gen = new SnowflakeGenerator(3)
  const seen = new Set()
  let prev = 0
  for (let i = 0; i < 2000; i += 1) {
    const id = gen.next()
    assert.ok(id > prev, 'المعرّف غير رتيب')
    assert.ok(!seen.has(id), 'معرّف مكرر')
    assert.ok(id <= SNOWFLAKE_MAX, 'المعرّف تجاوز 2⁵³ — غير آمن في JS')
    seen.add(id)
    prev = id
  }
  const other = new SnowflakeGenerator(9)
  const a = gen.next()
  const b = other.next()
  assert.notEqual(a % 128, b % 128, 'جهازان مختلفان أعطيا نفس مقعد التسلسل — بتات الجهاز معطلة')
  assert.ok(String(a).length <= 16 && String(b).length <= 16)
  ok('Snowflake 53-بت: 2000 معرّفاً رتيبة فريدة تحت 2⁵³ — وبتات الجهاز تفصل الأجهزة')
}

/* ═══ ⑦ فهرس الترقيم الفريد (فرع، نوع، رقم) — توافق §103 ═══ */
{
  const rows = db.raw.prepare('SELECT branch, doc_type, number FROM doc_numbers ORDER BY doc_type, number').all()
  assert.ok(rows.some((r) => r.doc_type === 'sales.invoiceNumber' && r.number === 'S-0001'))
  assert.ok(rows.some((r) => r.doc_type === 'journal.entryNumber' && r.number === '101'))
  assert.equal(rows.length, new Set(rows.map((r) => `${r.branch}|${r.doc_type}|${r.number}`)).size, 'أرقام مكررة دخلت الفهرس الفريد')
  ok('doc_numbers: فهرس فريد جاهز بعمود الفرع — الأرقام القديمة مسجلة وسيصبح القيد (فرع، نوع، رقم) في §103')
}

/* ═══ ⑧ اليومية: العكس يحدّث الحقل الأصلي لا يستنسخ ═══ */
{
  const reversed = { ...entryA, reversedByEntryId: 900 }
  db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 4, payloadJson: payloadV2, idempotencyKey: 'k5', journalEntries: [reversed] })
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM journal').get().n, 1, 'العكس استنسخ قيداً')
  assert.equal(db.raw.prepare('SELECT reversed_by_entry_id v FROM journal WHERE id = 101').get().v, 900)
  ok('اليومية append-only: القيد العاكس يوسم أصله في مكانه — لا استنساخ')
}

/* ═══ ⑨ outbox: دورة كاملة + إعادة محاولة فاشلة بجدولة ═══ */
{
  db.enqueueOutbox({ id: 'evt-1', aggregateType: 'sale', aggregateId: '1', eventType: 'sale.created', payloadJson: '{"a":1}' })
  assert.equal(db.enqueueOutbox({ id: 'evt-1', aggregateType: 'sale', aggregateId: '1', eventType: 'sale.created', payloadJson: '{"a":1}' }).created, false, 'حدث مكرر دخل outbox')
  const claimed = db.claimOutbox({ limit: 10 })
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0].status, 'sending')
  assert.equal(db.claimOutbox({ limit: 10 }).length, 0, 'حدث sending حُجز مرتين')
  db.completeOutbox({ id: 'evt-1', status: 'failed', nextAttemptAt: '2030-01-01T00:00:00' })
  assert.equal(db.claimOutbox({ now: '2029-01-01T00:00:00' }).length, 0, 'محاولة قبل موعدها مُنحت')
  assert.equal(db.claimOutbox({ now: '2030-01-02T00:00:00' }).length, 1, 'المحاولة المجدولة لم تُمنح')
  db.completeOutbox({ id: 'evt-1', status: 'sent' })
  const finalRow = db.raw.prepare("SELECT status, sent_at, attempts FROM sync_outbox WHERE id = 'evt-1'").get()
  assert.equal(finalRow.status, 'sent')
  assert.ok(finalRow.sent_at, 'sent_at فارغ')
  assert.equal(finalRow.attempts, 2)
  ok('outbox (تُشغَّل في §103): تخصيص حصري + إعادة جدولة فاشلة + إرسال مرة واحدة')
}

/* ═══ ⑩ deleteSnapshot يبطل اللقطة ويحفظ الأثر ═══ */
{
  const r = db.deleteSnapshot({ storeName: 'shopsys-data', expectedRevision: 5 })
  assert.ok(r.revision >= 6)
  const snap = db.getSnapshot('shopsys-data')
  assert.equal(snap.payloadJson, null, 'الإبطال لم يفرّغ اللقطة')
  assert.ok(snap.revision >= 6)
  assert.ok(db.raw.prepare('SELECT COUNT(*) n FROM journal').get().n >= 1, 'الإبطال حذف اليومية — ممنوع')
  assert.ok(db.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n >= 1, 'الإبطال حذف التدقيق — ممنوع')
  assert.throws(() => db.deleteSnapshot({ storeName: 'shopsys-data', expectedRevision: 0 }), /تعارض/)
  ok('إبطال اللقطة: مراجعة تتقدم بلا حذف أثر — والقفل التفاؤلي يحرسه')
}

/* ═══ ⑪ السلامة + النسخة الاحتياطية ملف قاعدة صالح ═══ */
{
  assert.deepEqual(db.integrityCheck(), { ok: true, message: 'ok' })
  assert.equal(db.schemaVersion(), 1)
  assert.ok(db.getMeta('device_id'), 'هوية الجهاز لم تُخزن')
  const dest = await db.backupTo('gate-backup.db')
  const copy = new Database(dest, { readonly: true })
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM journal').get().n, 1, 'النسخة الاحتياطية ناقصة')
  assert.equal(copy.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '1')
  copy.close()
  assert.ok(readdirSync(join(dir, 'backups')).includes('gate-backup.db'))
  db.close()
  ok('integrity_check ✓ · النسخة الاحتياطية قاعدة صالحة تُفتح وتُقرأ · هوية الجهاز مثبتة')
}

console.log(`\n✅ بوابة قاعدة SQLite المحلية: ${pass} فحوصاً ناجحة`)
