#!/usr/bin/env node
/**
 * verify_costing — فحص محرك التكلفة:
 * توزيع مصاريف الشراء (بالقيمة/بالكمية) بلا فقدان قرش + المتوسط المرجح المتحرك
 * node --experimental-strip-types scripts/verify_costing.mjs
 */
import { strict as assert } from 'node:assert'
import { allocateExpense, computeLandedCosts, weightedAverage } from '../src/core/costing.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 فحص محرك التكلفة (costing.ts)')

// سيناريو المالك: مصروف نقل يوزع على البضاعة
const lines = [
  { itemId: 1, qty: 10, unitPriceMinor: 10000 }, // صنف أ: 10 × 100.00 = 1000.00
  { itemId: 2, qty: 30, unitPriceMinor: 2000 },  // صنف ب: 30 × 20.00 = 600.00
]

ok('توزيع بالكمية: نولون 400.00 على 40 وحدة = 10.00 للوحدة', () => {
  const alloc = allocateExpense(lines, { nameAr: 'نولون', amountMinor: 40000, method: 'qty' })
  assert.deepEqual(alloc, [10000, 30000]) // 10 وحدات تأخذ 100.00، و30 تأخذ 300.00
})

ok('توزيع بالقيمة: جمارك 320.00 حسب قيمة كل صنف', () => {
  const alloc = allocateExpense(lines, { nameAr: 'جمارك', amountMinor: 32000, method: 'value' })
  // القيم: 1000 و600 → النسب 62.5% و37.5% → 200.00 و120.00
  assert.deepEqual(alloc, [20000, 12000])
})

ok('قاعدة عدم فقدان القرش: مجموع الأنصبة = المصروف تماماً (مبالغ عسرة)', () => {
  const awkward = [
    { itemId: 1, qty: 3, unitPriceMinor: 3333 },
    { itemId: 2, qty: 7, unitPriceMinor: 1111 },
    { itemId: 3, qty: 11, unitPriceMinor: 777 },
  ]
  for (const amount of [1, 10, 99, 1001, 33333, 99999]) {
    for (const method of ['qty', 'value']) {
      const alloc = allocateExpense(awkward, { nameAr: 'x', amountMinor: amount, method })
      const sum = alloc.reduce((a, b) => a + b, 0)
      assert.equal(sum, amount, `فقدان عند ${amount}/${method}: مجموع ${sum}`)
    }
  }
})

ok('رفض مصروف سالب', () => {
  assert.throws(() => allocateExpense(lines, { nameAr: 'x', amountMinor: -5, method: 'qty' }))
})

ok('التكلفة الهابطة: سعر + نصيب المصاريف = تكلفة نهائية للوحدة', () => {
  const landed = computeLandedCosts(lines, [
    { nameAr: 'نولون', amountMinor: 40000, method: 'qty' },
  ])
  // صنف أ: (10×100.00 + 100.00) / 10 = 110.00 للوحدة
  assert.equal(landed[0].landedUnitCostMinor, 11000)
  // صنف ب: (600.00 + 300.00) / 30 = 30.00 للوحدة
  assert.equal(landed[1].landedUnitCostMinor, 3000)
})

ok('مصروفان بطريقتين مختلفتين معاً (اختيار المالك: لكل مصروف طريقته)', () => {
  const landed = computeLandedCosts(lines, [
    { nameAr: 'نولون', amountMinor: 40000, method: 'qty' },   // بالكمية
    { nameAr: 'جمارك', amountMinor: 32000, method: 'value' }, // بالقيمة
  ])
  const totalShares = landed.reduce((a, l) => a + l.expenseShareMinor, 0)
  assert.equal(totalShares, 72000) // لا قرش ضائع
  assert.equal(landed[0].expenseShareMinor, 30000) // 100+200
  assert.equal(landed[1].expenseShareMinor, 42000) // 300+120
})

console.log('🔍 فحص المتوسط المرجح المتحرك')

ok('أول شراء: التكلفة = التكلفة الهابطة', () => {
  // رصيد 0 → شراء 10 بتكلفة إجمالية 1100.00 → متوسط 110.00
  assert.equal(weightedAverage(0, 0, 10, 110000), 11000)
})

ok('شراء ثانٍ بسعر مختلف: متوسط مرجح صحيح', () => {
  // رصيد 10 بتكلفة 110.00 + وارد 20 بإجمالي 1600.00 (80.00/وحدة)
  // = (1100 + 1600) / 30 = 90.00
  assert.equal(weightedAverage(10, 11000, 20, 160000), 9000)
})

ok('البيع لا يغير المتوسط (كمية واردة 0)', () => {
  assert.equal(weightedAverage(5, 9000, 0, 0), 9000)
})

ok('سيناريو المالك الكامل: بضاعة + نولون موزع + متوسط متحرك', () => {
  // شراء 1: 100 قطعة × 50.00 + نولون 500.00 بالكمية → تكلفة 55.00
  const l1 = computeLandedCosts(
    [{ itemId: 1, qty: 100, unitPriceMinor: 5000 }],
    [{ nameAr: 'نولون', amountMinor: 50000, method: 'qty' }],
  )[0]
  assert.equal(l1.landedUnitCostMinor, 5500)
  const cost1 = weightedAverage(0, 0, 100, l1.landedTotalMinor)
  assert.equal(cost1, 5500)
  // شراء 2: 50 قطعة × 60.00 بلا مصاريف → متوسط جديد
  const l2 = computeLandedCosts([{ itemId: 1, qty: 50, unitPriceMinor: 6000 }], [])[0]
  const cost2 = weightedAverage(100, cost1, 50, l2.landedTotalMinor)
  // (100×55 + 50×60) / 150 = (5500+3000)/150 = 56.67 → 5667
  assert.equal(cost2, 5667)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
