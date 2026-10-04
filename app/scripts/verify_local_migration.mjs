/**
 * بوابة §101 التنفيذية (وثيقة §3.7): رحلة الهجرة localStorage → SQLite
 * ببيانات محرك حقيقية — تُبنى فواتير وسندات وقسائم بالمحرك نفسه، ثم تُرحَّل
 * حمولة persist كما يفعل الجسر تماماً (newJournalEntries/newAuditEvents من
 * persistentStorage)، ثم يُعاد فتح القاعدة (إقلاع جديد) وتُقارن الحالة
 * طرفاً بطرف: اللقطة كاملة، المجموعات من جداولها، والميزان من اليومية
 * المسطحة في القاعدة مقابل ميزان الحالة في الذاكرة.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_local_migration.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/* بيئة المتصفح المصغّرة — نفس نمط رحلات المستخدم القائمة */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { newJournalEntries, newAuditEvents } = await import(join(root, 'src/data/persistentStorage.ts'))
const { ShopsysDatabase } = await import(join(root, 'desktop/sqlite/storage.ts'))

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }
const st = () => useDataStore.getState()

console.log('\n═══ 1) بناء بيانات حقيقية بالمحرك: مبيعات نقدية وآجلة وسند قبض FIFO ═══')
{
  useDataStore.setState({
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 100_000, isDefault: true }],
    customers: [{ id: 1, nameAr: 'عميل الهجرة', phone: '', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }],
    items: [{ id: 1, nameAr: 'صنف هجرة', barcode: '', categoryId: null, unitAr: 'قطعة', costMinor: 5000, priceMinor: 9000, soldByWeight: false, isActive: true, trackSerials: false, stockQty: 100, minQty: 0 }],
    sales: [], vouchers: [], journal: [], auditLog: [], clientSettlements: [], saleReturns: [], payrollSlips: [], payrollRuns: [],
  })
  const cart = (qty) => [{ itemId: 1, nameAr: 'صنف هجرة', qty, unitPriceMinor: 9000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }]
  const sale1 = st().postSale({ lines: cart(2), payment: 'cash', paidMinor: 18_000, treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  const sale2 = st().postSale({ lines: cart(1), payment: 'credit', paidMinor: 0, treasury: '1101', customerId: 1, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  const voucher = st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 4000, description: 'تحصيل الهجرة', partyKind: 'customer', partyId: 1 })
  assert.ok(sale1.invoiceNumber && sale2.invoiceNumber, 'فواتير لم تُنشأ')
  assert.ok(voucher.allocations?.length, 'توزيع FIFO لم يعمل')
  assert.ok(st().journal.length >= 3, 'اليومية لم تُرحّل')
  ok(`المحرك ولّد: فاتورتين (${sale1.invoiceNumber} + ${sale2.invoiceNumber} آجلة) وسند قبض بتوزيع FIFO — ${st().journal.length} قيود متوازنة`)
}

console.log('\n═══ 2) الترحيل: حمولة persist كما يرسلها الجسر حرفياً → SQLite ═══')
const dir = mkdtempSync(join(tmpdir(), 'shopsys-migration-'))
const dbPath = join(dir, 'shopsys.db')
{
  /* اللقطة بنفس شكل zustand persist {state, version} — الدوال تسقط طبيعياً */
  const state = JSON.parse(JSON.stringify({ ...st() }))
  const payloadJson = JSON.stringify({ state, version: 25 })
  const journalEntries = newJournalEntries(payloadJson, null)
  const auditEvents = newAuditEvents(payloadJson, null)
  assert.ok(journalEntries.length >= 3, 'استخراج اليومية فارغ')
  const db = await ShopsysDatabase.open(dbPath)
  const result = db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson, idempotencyKey: 'migration', journalEntries, auditEvents })
  assert.equal(result.revision, 1)
  db.close()
  ok(`الترحيل في transaction واحدة: ${journalEntries.length} قيوداً مسطحة + ${auditEvents.length} أحداث تدقيق + لقطة كاملة`)
}

console.log('\n═══ 3) الإقلاع الجديد: قراءة القاعدة ومقارنة الحالة طرفاً بطرف ═══')
let snapshot
{
  const db = await ShopsysDatabase.open(dbPath)
  snapshot = db.getSnapshot('shopsys-data')
  assert.equal(snapshot.revision, 1)
  assert.ok(snapshot.payloadJson, 'اللقطة فارغة')
  const restored = JSON.parse(snapshot.payloadJson)
  const before = JSON.parse(JSON.stringify({ ...st() }))
  /* اللقطة تعيد الحالة كما رُحّلت — بلا فقد حقل واحد */
  for (const key of ['sales', 'vouchers', 'journal', 'customers', 'auditLog', 'treasuries', 'items', 'clientSettlements']) {
    assert.deepEqual(restored.state[key], before[key], `المجموعة ${key} اختلفت بعد الهجرة`)
  }
  ok('اللقطة المرجعة من القاعدة تطابق حالة المحرك حرفياً (8 مجموعات deep-equal)')

  /* المجموعات من جداولها — إعادة بناء الحالة من c_* تحديداً */
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'c_%'").all().map((r) => r.name)
  assert.ok(tables.includes('c_sales') && tables.includes('c_journal') && tables.includes('c_vouchers'), `جداول ناقصة: ${tables.join(',')}`)
  const fromTable = (name) => db.raw.prepare(`SELECT payload_json FROM "${name}" WHERE deleted_at IS NULL ORDER BY seq`).all().map((r) => JSON.parse(r.payload_json))
  for (const key of ['sales', 'vouchers', 'journal', 'customers']) {
    assert.deepEqual(fromTable(`c_${key}`), before[key], `جدول c_${key} لا يطابق الحالة`)
  }
  ok('إعادة بناء الحالة من جداول المجموعات (الكتابة الانتقائية) تطابق الأصل — بلا صف مفقود أو مكرر')
  db.close()
}

console.log('\n═══ 4) الميزان طرفاً بطرف: من جدول journal المسطّح مقابل الذاكرة ═══')
{
  const db = await ShopsysDatabase.open(dbPath)
  const balanceOf = (lines, code) => lines.reduce((sum, l) => (l.accountCode === code ? sum + l.debit - l.credit : sum), 0)
  const memJournal = st().journal
  const dbRows = db.raw.prepare('SELECT lines_json FROM journal ORDER BY id').all()
  assert.equal(dbRows.length, memJournal.length, 'عدد قيود القاعدة لا يطابق')
  const codes = ['1101', '1104', '4101', '5101', '2102']
  for (const code of codes) {
    const fromMemory = balanceOf(memJournal.flatMap((e) => e.lines), code)
    const fromDb = balanceOf(dbRows.flatMap((r) => JSON.parse(r.lines_json)), code)
    assert.equal(fromDb, fromMemory, `رصيد ${code} اختلف بين القاعدة والذاكرة`)
  }
  /* رصيد طرف بعينه: ذمة العميل من الحالة مقابل المشتق من قيود القاعدة */
  const openDocs = st().getOpenClientInvoices(1)
  const restored = JSON.parse(snapshot.payloadJson)
  const memOpen = openDocs.reduce((s, d) => s + (d.dueMinor - d.settledMinor), 0)
  const rebuiltOpen = restored.state.sales.filter((s) => s.customerId === 1 && s.payment === 'credit').reduce((s, s2) => s + s2.totals.totalMinor, 0) - 4000
  assert.equal(memOpen, rebuiltOpen, 'ذمة العميل بعد الهجرة لا تطابق')
  ok('ميزان متطابق لكل حساب (1101/1104/4101/5101/2102) من قاعدة SQLite مقابل الذاكرة — وذمة العميل نفسها')
  db.close()
}

console.log(`\n✅ رحلة الهجرة localStorage → SQLite: ${pass} فحوصاً ناجحة`)
