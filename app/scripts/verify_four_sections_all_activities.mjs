/**
 * الدورة الرباعية (شراء ← بيع ← مرتجع بيع ← مرتجع شراء) على كل الأنشطة الـ16
 * (طلب المالك: «هل فحصت عمل الأقسام الأربعة على كل الأنشطة؟»)
 *
 * لكل نشاط على حدة — متجر جديد نظيف بإعدادات النشاط نفسه:
 * 1) شراء بمصاريف شحن موزعة ⇒ متوسط محمل صحيح
 * 2) بيع نقدي بالتكلفة المحملة ⇒ 5101 صحيح
 * 3) مرتجع بيع سليم ⇒ يعود للمخزون بالمتوسط ويعكس التكلفة
 * 4) مرتجع شراء debt بموافقة مشرف ⇒ G4 (سعر المورد لا المحمل) وسقف المخزون
 * 5) 1103 الدفتري = Σ كمية×متوسط + كل القيود متوازنة + 2101 يطابق كشف المورد
 *
 * إعادة تهيئة المتجر بين الأنشطة عبر cache-busting query على import.
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

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 29, `المتوقع 29 نشاطاً — الموجود ${ACTIVITIES.length}`)

let pass = 0
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  // متجر نظيف لكل نشاط
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?activity=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  // تجهيز
  st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  st().addCustomer({ nameAr: `عميل ${nameAr}`, phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  st().addItem({ nameAr: `صنف ${nameAr}`, barcode: '', categoryId: null, unit: 'قطعة', costMinor: 0, priceMinor: 15000, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)

  // 1) شراء 10 ×100 + شحن 50 ⇒ محمل 105
  const purchase = st().postPurchase({
    supplierId: sup.id, date: '2026-09-17',
    lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 10000 }],
    expenses: [{ nameAr: 'شحن', amountMinor: 5000, method: 'value', paidBy: 'supplier' }],
    paidMinor: 0, notes: '',
  })
  assert.equal(st().items.find((i) => i.id === item.id).costMinor, 10500, `${activityId}: متوسط محمل`)
  assert.equal(purchase.supplierDueMinor, 105000, `${activityId}: مستحق المورد`)

  // 2) بيع 4 نقداً
  const sale = st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 4, unitPriceMinor: 15000, unitCostMinor: 10500, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
  })
  assert.equal(bal('5101'), 42000, `${activityId}: تكلفة المبيعات المحملة`)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 6, `${activityId}: مخزون بعد البيع`)

  // 3) مرتجع بيع 1 سليمة نقداً (بموافقة)
  st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'cash', reason: 'تغيير رأي', reasonCode: 'other', approvedBy: 'المشرف',
  })
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 7, `${activityId}: مخزون بعد مرتجع البيع`)
  assert.equal(bal('5101'), 31500, `${activityId}: عكس تكلفة القطعة المعادة`)

  // 4) مرتجع شراء: 8 يُرفض (بالمخزون 7)، ثم 2 debt بموافقة — G4
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 8]]), refund: 'debt', reason: 'x' }),
    /المخزون الحالي|القابل للإرجاع/, `${activityId}: سقف المخزون`,
  )
  const ret = st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 2]]), refund: 'debt', reason: 'فائض', approvedBy: 'المشرف' })
  assert.equal(ret.supplierValueMinor, 20000, `${activityId}: G4 سعر المورد`)
  assert.equal(ret.totalMinor, 21000, `${activityId}: القيمة الدفترية المحملة`)
  assert.equal(ret.approvedBy, 'المشرف', `${activityId}: موافقة المشرف على المستند`)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 5, `${activityId}: مخزون نهائي`)

  // 5) الثوابت المحاسبية
  const book1103 = bal('1103')
  const calc1103 = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  assert.ok(Math.abs(book1103 - calc1103) <= 100, `${activityId}: 1103=${book1103} vs Σ=${calc1103}`)
  for (const e of st().journal) assertBalanced(e.lines)
  const ss = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(ss), -bal('2101'), `${activityId}: كشف المورد = 2101`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): شراء→بيع→مرتجع بيع→مرتجع شراء — 1103 مطابق، ${st().journal.length} قيود متوازنة، كشف المورد = 2101`)
}

assert.equal(pass, 29)
console.log(`\n✅ verify_four_sections_all_activities: الدورة الرباعية سليمة على الأنشطة الـ${pass} كلها`)
