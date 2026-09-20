/**
 * 💊 رحلة يوم صيدلية كامل (الفحص الفردي لنشاط الصيدلية):
 * شراء بدفعتي صلاحية → FEFO يصرف الأقرب انتهاءً → بيع بوحدة كبرى (علبة/شريط)
 * → حظر بيع المنتهي إلا بتجاوز مدير → بيع تأميني بنسبة تحمل وتحصيل مطالبات
 * → أرضية سعر على القرص تصطاد بيع الشريط الرخيص → مرتجع دواء → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_pharmacy_day.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'pharmacy', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { ExpiredStockError } = await import(join(root, 'src/core/batches.ts'))
const { PriceFloorError } = await import(join(root, 'src/core/items.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) دواء بصلاحية + وحدة كبرى (علبة = 20 قرصاً) وأرضية سعر للقرص ═══')
{
  st().addItem({
    nameAr: 'باراسيتامول', categoryId: null, unit: 'قرص', priceMinor: 200, barcode: '111', sku: '', isActive: true,
    trackExpiry: true, trackSerial: false, soldByWeight: false, isService: false,
    minSalePriceMinor: 150, costMinor: 0, stockQty: 0,
    extraUnits: [{ nameAr: 'علبة', factor: 20, barcode: '111-B', priceMinor: 3600 }],
  })
  st().addItem({ nameAr: 'فيتامين سي', categoryId: null, unit: 'علبة', priceMinor: 5000, barcode: '222', sku: '', isActive: true, trackExpiry: true, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  ok('صنفان: باراسيتامول (قرص/علبة×20، أرضية 1.5ج للقرص) وفيتامين سي بصلاحية')
}
const [para, vitc] = st().items

console.log('\n═══ 2) شراء بدفعتين: قريبة الانتهاء (2026-10) وبعيدة (2027-06) — FEFO ═══')
{
  st().addSupplier({ nameAr: 'مخازن الدواء', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  const sup = st().suppliers[0]
  st().postPurchase({ supplierId: sup.id, date: '2026-09-01', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: para.id, qty: 100, unitPriceMinor: 100, expiryDate: '2026-10-15' }] })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-10', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: para.id, qty: 200, unitPriceMinor: 100, expiryDate: '2027-06-30' }] })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-10', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: vitc.id, qty: 30, unitPriceMinor: 3000, expiryDate: '2026-08-01' }] }) // منتهية بالفعل!
  assert.equal(st().items.find(i => i.id === para.id).stockQty, 300)
  assert.equal(st().batches.filter(b => b.itemId === para.id).length, 2)
  ok('300 قرص على دفعتين + 30 علبة فيتامين منتهية (فخ اختبار الحظر)')
}

console.log('\n═══ 3) بيع 3 علب (60 قرصاً) بوحدة كبرى — FEFO يستهلك القريبة أولاً ═══')
{
  const sale = st().postSale({
    lines: [{ itemId: para.id, nameAr: 'باراسيتامول (علبة)', qty: 3, unitPriceMinor: 3600, unitCostMinor: 2000, discountPercent: 0, soldByWeight: false, unitFactor: 20, unitLabel: 'علبة' }],
    payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false,
  })
  assert.equal(sale.totals.totalMinor, 10800, '3 علب × 36ج')
  assert.equal(st().items.find(i => i.id === para.id).stockQty, 240, 'خُصم 60 قرصاً بالوحدة الأساسية')
  const nearBatch = st().batches.find(b => b.itemId === para.id && b.expiryDate === '2026-10-15')
  assert.equal(nearBatch.qty, 40, 'FEFO أكل من القريبة أولاً (100−60)')
  const farBatch = st().batches.find(b => b.itemId === para.id && b.expiryDate === '2027-06-30')
  assert.equal(farBatch.qty, 200, 'البعيدة لم تُمس')
  ok('بيع علب بوحدة كبرى: مخزون بالقرص، FEFO التهم القريبة أولاً')
}

console.log('\n═══ 4) المنتهي محظور إلا بتجاوز مدير موثق ═══')
{
  const line = { itemId: vitc.id, nameAr: 'فيتامين سي', qty: 1, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }
  let caught = null
  try { st().postSale({ lines: [line], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false }) }
  catch (e) { caught = e }
  assert.ok(caught instanceof ExpiredStockError, 'ExpiredStockError مرمي')
  st().postSale({ lines: [line], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false, expiryOverrideBy: 'د. مدير الصيدلية' })
  ok('بيع المنتهي: محظور تلقائياً، ويمر فقط بتجاوز مدير موثق بالاسم')
}

console.log('\n═══ 5) أرضية سعر القرص تصطاد الشريط/العلبة الرخيصة ═══')
{
  // علبة 20 قرصاً بـ25ج = 1.25ج/قرص تحت الأرضية 1.5ج
  const cheap = { itemId: para.id, nameAr: 'باراسيتامول (علبة)', qty: 1, unitPriceMinor: 2500, unitCostMinor: 2000, discountPercent: 0, soldByWeight: false, unitFactor: 20, unitLabel: 'علبة' }
  let caught = null
  try { st().postSale({ lines: [cheap], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false }) }
  catch (e) { caught = e }
  assert.ok(caught instanceof PriceFloorError, 'أرضية القرص اصطادت العلبة الرخيصة')
  st().postSale({ lines: [cheap], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false, priceFloorOverrideBy: 'صاحب الصيدلية' })
  ok('أرضية السعر تعمل عبر الوحدات الكبرى وتُتجاوز باعتماد فقط')
}

console.log('\n═══ 6) بيع تأميني: الجهة تتحمل 70% ثم تحصيل المطالبات ═══')
{
  const provider = st().addInsuranceProvider({ nameAr: 'تأمين مصر', coveragePercent: 70 })
  const before1101 = acctBal('1101')
  const r = st().postInsuredSale({
    lines: [{ itemId: para.id, nameAr: 'باراسيتامول (علبة)', qty: 2, unitPriceMinor: 3600, unitCostMinor: 2000, discountPercent: 0, soldByWeight: false, unitFactor: 20, unitLabel: 'علبة' }],
    providerId: provider.id, taxPercent: 0, taxInclusive: true, treasury: '1101',
  })
  assert.equal(r.providerShareMinor, Math.round(7200 * 0.7), 'حصة الجهة 70%')
  assert.equal(r.patientShareMinor, 7200 - r.providerShareMinor, 'حصة المريض 30%')
  assert.equal(acctBal('1101') - before1101, r.patientShareMinor, 'الخزينة استلمت حصة المريض فقط')
  const claims = st().settleInsuranceClaims(provider.id, '1102')
  assert.equal(claims.total, r.providerShareMinor, 'تحصيل مطالبات الجهة للبنك')
  ok(`تأميني: مريض ${r.patientShareMinor / 100}ج نقداً + جهة ${r.providerShareMinor / 100}ج ذمة حُصلت بنكياً`)
}

console.log('\n═══ 7) مرتجع علبة والميزان الختامي ═══')
{
  const sale = st().sales[0] // فاتورة الـ3 علب
  const before = st().items.find(i => i.id === para.id).stockQty
  st().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[para.id, 1]]), reason: 'عبوة تالفة', treasury: '1101', refund: 'cash' })
  assert.equal(st().items.find(i => i.id === para.id).stockQty, before + 20, 'مرتجع علبة = +20 قرصاً بالوحدة الأساسية')
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`مرتجع الوحدة الكبرى يعيد بالقرص، ${st().journal.length} قيداً متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة الصيدلية الكاملة: ${pass} محطات — كلها خضراء\n`)
