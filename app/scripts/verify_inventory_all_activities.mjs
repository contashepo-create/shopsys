/**
 * إعادة فحص المخزون في كل الأنشطة الـ16 + تكامله مع الأقسام الأربعة المراجعة
 * (طلب المالك: «أعد فحص المخزون في كل الأنشطة ثم مع كل الأقسام التي روجعت من قبل»)
 *
 * لكل نشاط متجر نظيف تُشغَّل عليه الدورة المتشابكة — عمليات المخزون تتخلل
 * عمليات البيع والشراء لا قبلها ولا بعدها فقط:
 *  1) شراء 20 بمصاريف ⇒ متوسط محمل 110
 *  2) تحويل 5 لفرع ⇒ لا قيد و1103 ثابت وأرصدة المخازن متسقة
 *  3) بيع 6 ⇒ 5101 بالمحمل، ثم مرتجع بيع 1 سليمة ⇒ ترجع بالمتوسط
 *  4) جرد بعد كل ذلك (متوقع 15) بعجز 2 ⇒ قيد 5108 وضبط 13
 *  5) إتلاف 1 ⇒ قيد 5111
 *  6) صرف داخلي 1 ⇒ قيد مصروف/1103
 *  7) مرتجع شراء 2 ⇒ G4 وسقف المخزون المتبقي
 *  8) حذف الصنف مرفوض (له حركة) — الفجوة المسدودة تسري في كل نشاط
 *  9) الثوابت: 1103 = Σ كمية×متوسط، كل القيود متوازنة، كشف المورد = 2101
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

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

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { supplierStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { computeWarehouseStock, buildWarehouseDocs } = await import(join(root, 'src/core/transfers.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 18)

let pass = 0
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?invactivity=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
  const check1103 = (label) => {
    const book = bal('1103')
    const calc = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
    assert.ok(Math.abs(book - calc) <= 100, `${activityId} ${label}: 1103=${book} vs Σ=${calc}`)
  }

  st().seed([])
  st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  st().addItem({ nameAr: `صنف ${nameAr}`, sku: 'INV-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 20000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)

  // 1) شراء 20 ×100 + شحن 200 ⇒ محمل 110
  const purchase = st().postPurchase({
    supplierId: sup.id, date: '2026-09-17',
    lines: [{ itemId: item.id, qty: 20, unitPriceMinor: 10000 }],
    expenses: [{ nameAr: 'شحن', amountMinor: 20000, method: 'qty', paidBy: 'supplier' }],
    paidMinor: 0, notes: '',
  })
  assert.equal(st().items.find((i) => i.id === item.id).costMinor, 11000, `${activityId}: محمل`)
  check1103('بعد الشراء')

  // 2) تحويل 5 لفرع — لا قيد و1103 ثابت
  st().addWarehouse(`فرع ${nameAr}`)
  const branch = st().warehouses.at(-1)
  const main = st().warehouses.find((w) => w.isMain)
  const journalBeforeTrf = st().journal.length
  st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: branch.id, lines: [{ itemId: item.id, qty: 5 }], notes: '' })
  assert.equal(st().journal.length, journalBeforeTrf, `${activityId}: تحويل بلا قيد`)
  check1103('بعد التحويل')
  const whStock = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  assert.equal(whStock.get(branch.id).get(item.id), 5)
  assert.equal(whStock.get(main.id).get(item.id), 15)

  // 3) بيع 6 ⇒ مرتجع 1 سليمة
  const sale = st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 6, unitPriceMinor: 20000, unitCostMinor: 11000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
  })
  assert.equal(bal('5101'), 66000, `${activityId}: تكلفة بيع محملة`)
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'تغيير رأي', reasonCode: 'other', approvedBy: 'المشرف' })
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 15, `${activityId}: رصيد بعد بيع ومرتجع`)
  check1103('بعد المرتجع')

  // 4) جرد بعجز 2 (متوقع 15 معدود 13)
  const stk = st().postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: 15, countedQty: 13, unitCostMinor: 11000 }], 'جرد النشاط')
  const stkEntry = st().journal.find((e) => e.id === stk.journalEntryId)
  assert.ok(stkEntry.lines.some((l) => l.accountCode === '5108' && l.debit === 22000), `${activityId}: قيد عجز`)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 13)
  check1103('بعد الجرد')

  // 5) إتلاف 1
  const w = st().postWastage({ reason: 'تلف', lines: [{ itemId: item.id, qty: 1 }], notes: '' })
  assert.equal(w.totalCostMinor, 11000)
  assert.equal(bal('5111') >= 11000, true, `${activityId}: قيد إتلاف`)
  check1103('بعد الإتلاف')

  // 6) صرف داخلي 1
  const c = st().postConsumption({ purpose: 'استخدام داخلي', lines: [{ itemId: item.id, qty: 1 }], notes: '' })
  assert.equal(c.totalCostMinor, 11000)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 11)
  check1103('بعد الصرف')

  // 7) مرتجع شراء 2 — G4: المورد بسعره 100 لا المحمل 110
  const ret = st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 2]]), refund: 'debt', reason: 'فائض', approvedBy: 'المشرف' })
  assert.equal(ret.supplierValueMinor, 20000, `${activityId}: G4`)
  assert.equal(ret.totalMinor, 22000)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 9)
  check1103('بعد مرتجع الشراء')

  // 8) حذف الصنف مرفوض — الفجوة المسدودة تسري في كل نشاط
  assert.throws(() => st().removeItem(item.id), /فواتير شراء/, `${activityId}: منع الحذف`)

  // 9) الثوابت الختامية
  for (const e of st().journal) assertBalanced(e.lines)
  const ss = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(ss), -bal('2101'), `${activityId}: كشف المورد = 2101`)
  // أرصدة المخازن ما زالت متسقة بعد كل العمليات (مجموعها = الرصيد الكلي)
  const whFinal = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  let sum = 0
  for (const [, m] of whFinal) sum += m.get(item.id) ?? 0
  assert.equal(sum, 9, `${activityId}: مجموع أرصدة المخازن = الرصيد الكلي`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): شراء→تحويل→بيع→مرتجع→جرد→إتلاف→صرف→مرتجع شراء — ${st().journal.length} قيود متوازنة و1103 مطابق في كل خطوة`)
}

assert.equal(pass, 18)
console.log(`\n✅ verify_inventory_all_activities: دورة المخزون المتشابكة مع الأقسام الأربعة سليمة على الأنشطة الـ${pass}`)
