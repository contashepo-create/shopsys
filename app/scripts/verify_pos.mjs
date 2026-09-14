#!/usr/bin/env node
/**
 * verify_pos — فحص نواة الكاشير:
 * الإجماليات، الخصومات، الضريبة شامل/مضاف، فحص المخزون، والقيد المتولد
 * node --experimental-strip-types scripts/verify_pos.mjs
 */
import { strict as assert } from 'node:assert'
import { computeTotals, buildSaleEntry, checkStock, lineTotal } from '../src/core/pos.ts'
import { assertBalanced } from '../src/core/ledger.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const line = (over = {}) => ({
  itemId: 1, nameAr: 'صنف', qty: 2, unitPriceMinor: 5000, unitCostMinor: 3000,
  discountPercent: 0, soldByWeight: false, ...over,
})

console.log('🔍 فحص إجماليات السلة')

ok('سلة بسيطة بلا خصم ولا ضريبة', () => {
  const t = computeTotals([line()], 0, 0, true)
  assert.equal(t.totalMinor, 10000)
  assert.equal(t.cogsMinor, 6000)
})

ok('خصم سطر 10٪', () => {
  const t = computeTotals([line({ discountPercent: 10 })], 0, 0, true)
  assert.equal(t.totalMinor, 9000)
  assert.equal(t.discountMinor, 1000)
})

ok('خصم فاتورة فوق خصم السطر (متتاليان لا متجمعان)', () => {
  // 100.00 → خصم سطر 10% → 90.00 → خصم فاتورة 10% → 81.00
  const t = computeTotals([line({ discountPercent: 10 })], 10, 0, true)
  assert.equal(t.totalMinor, 8100)
})

ok('ضريبة شاملة 14٪: العميل يدفع نفس الصافي والأساس+الضريبة=الصافي', () => {
  const t = computeTotals([line({ unitPriceMinor: 5700, qty: 2 })], 0, 14, true)
  assert.equal(t.totalMinor, 11400) // ما يدفعه العميل لم يتغير
  assert.equal(t.taxBaseMinor + t.taxMinor, 11400)
  assert.equal(t.taxBaseMinor, 10000)
  assert.equal(t.taxMinor, 1400)
})

ok('ضريبة مضافة 15٪: تضاف فوق الصافي', () => {
  const t = computeTotals([line({ unitPriceMinor: 5000, qty: 2 })], 0, 15, false)
  assert.equal(t.taxBaseMinor, 10000)
  assert.equal(t.taxMinor, 1500)
  assert.equal(t.totalMinor, 11500)
})

ok('بيع بالوزن: 0.750 كجم × 180.00', () => {
  const t = computeTotals([line({ qty: 0.75, unitPriceMinor: 18000, unitCostMinor: 12000, soldByWeight: true })], 0, 0, true)
  assert.equal(t.totalMinor, 13500)
  assert.equal(t.cogsMinor, 9000)
})

ok('رفض كمية صفرية أو سالبة', () => {
  assert.throws(() => computeTotals([line({ qty: 0 })], 0, 0, true))
  assert.throws(() => computeTotals([line({ qty: -1 })], 0, 0, true))
})

ok('رفض خصم خارج النطاق', () => {
  assert.throws(() => computeTotals([line({ discountPercent: 150 })], 0, 0, true))
  assert.throws(() => computeTotals([line()], -5, 0, true))
})

ok('lineTotal يتفق مع computeTotals', () => {
  const l = line({ discountPercent: 25 })
  assert.equal(lineTotal(l), 7500)
})

console.log('🔍 فحص المخزون قبل البيع')

ok('كشف النقص: مطلوب 5 ومتاح 3', () => {
  const shortages = checkStock([line({ qty: 5 })], () => 3)
  assert.equal(shortages.length, 1)
  assert.equal(shortages[0].available, 3)
})

ok('تجميع سطور نفس الصنف قبل الفحص', () => {
  // سطران لنفس الصنف 2+2=4 ومتاح 3 → نقص
  const shortages = checkStock([line({ qty: 2 }), line({ qty: 2 })], () => 3)
  assert.equal(shortages.length, 1)
})

ok('لا نقص عند توافر المخزون', () => {
  assert.equal(checkStock([line({ qty: 2 })], () => 10).length, 0)
})

console.log('🔍 فحص القيد المتولد من الفاتورة (القرار 9)')

ok('قيد بيع كاش بضريبة شاملة: متوازن و5 أطراف', () => {
  const t = computeTotals([line({ unitPriceMinor: 5700, qty: 2 })], 0, 14, true)
  const entry = buildSaleEntry(t, 'cash')
  assertBalanced(entry) // يرمي لو اختل
  assert.equal(entry.length, 5)
  assert.equal(entry[0].accountCode, '1101') // الخزينة
  assert.equal(entry[0].debit, 11400)
  const sales = entry.find((l) => l.accountCode === '4101')
  assert.equal(sales.credit, 10000)
  const vat = entry.find((l) => l.accountCode === '2102')
  assert.equal(vat.credit, 1400)
})

ok('قيد بيع آجل: المدين حساب العملاء لا الخزينة', () => {
  const t = computeTotals([line()], 0, 0, true)
  const entry = buildSaleEntry(t, 'credit')
  assert.equal(entry[0].accountCode, '1104')
})

ok('COGS يظهر مديناً والمخزون دائناً بنفس التكلفة', () => {
  const t = computeTotals([line()], 0, 0, true)
  const entry = buildSaleEntry(t, 'cash')
  const cogs = entry.find((l) => l.accountCode === '5101')
  const inv = entry.find((l) => l.accountCode === '1103')
  assert.equal(cogs.debit, 6000)
  assert.equal(inv.credit, 6000)
})

ok('بلا ضريبة: لا سطر ض.ق.م في القيد', () => {
  const t = computeTotals([line()], 0, 0, true)
  const entry = buildSaleEntry(t, 'cash')
  assert.ok(!entry.find((l) => l.accountCode === '2102'))
})

ok('سيناريو متكامل: خصومات + ضريبة + وزن — القيد يتزن دائماً', () => {
  const cart = [
    line({ qty: 3, unitPriceMinor: 4500, unitCostMinor: 3100, discountPercent: 5 }),
    line({ itemId: 2, qty: 0.65, unitPriceMinor: 22000, unitCostMinor: 15000, soldByWeight: true }),
    line({ itemId: 3, qty: 7, unitPriceMinor: 1250, unitCostMinor: 800, discountPercent: 12 }),
  ]
  for (const [pct, inclusive] of [[14, true], [15, false], [0, true], [16, true], [5, false]]) {
    const t = computeTotals(cart, 3, pct, inclusive)
    const entry = buildSaleEntry(t, 'cash')
    assertBalanced(entry)
    // الأساس + الضريبة = الإجمالي دائماً
    assert.equal(t.taxBaseMinor + t.taxMinor, t.totalMinor)
  }
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
