#!/usr/bin/env node
/**
 * verify_purchases_stocktake — فحص قيد الشراء + مرتجعات الشراء + الجرد والتسوية
 * node --experimental-strip-types scripts/verify_purchases_stocktake.mjs
 */
import { strict as assert } from 'node:assert'
import {
  buildPurchaseEntry, remainingPurchasable, buildPurchaseReturnLines,
  purchaseReturnTotal, buildPurchaseReturnEntry,
} from '../src/core/purchases.ts'
import { computeStocktake, buildAdjustmentEntry } from '../src/core/stocktake.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const sumD = (ls) => ls.reduce((a, l) => a + l.debit, 0)
const sumC = (ls) => ls.reduce((a, l) => a + l.credit, 0)

console.log('🔍 قيد فاتورة الشراء')

ok('شراء مدفوع جزئياً: مخزون مدين / خزينة + مورد دائن — متوازن', () => {
  const e = buildPurchaseEntry(100000, 40000)
  assert.equal(sumD(e), sumC(e))
  assert.ok(e.some((l) => l.accountCode === '1103' && l.debit === 100000))
  assert.ok(e.some((l) => l.accountCode === '1101' && l.credit === 40000))
  assert.ok(e.some((l) => l.accountCode === '2101' && l.credit === 60000))
})

ok('شراء كاش بالكامل: لا سطر موردين', () => {
  const e = buildPurchaseEntry(50000, 50000)
  assert.ok(!e.some((l) => l.accountCode === '2101'))
})

ok('شراء آجل بالكامل: لا سطر خزينة', () => {
  const e = buildPurchaseEntry(50000, 0)
  assert.ok(!e.some((l) => l.accountCode === '1101'))
})

ok('رفض مدفوع أكبر من الإجمالي أو سالب', () => {
  assert.throws(() => buildPurchaseEntry(100, 200), /أكبر/)
  assert.throws(() => buildPurchaseEntry(100, -1), /سالب/)
})

console.log('🔍 مرتجعات الشراء — بالتكلفة النهائية (Landed) من الفاتورة الأصلية')

const purchaseLines = [
  { itemId: 1, qty: 10, landedUnitCostMinor: 1200 }, // اشترى 10 بتكلفة نهائية 12 ج
  { itemId: 2, qty: 5, landedUnitCostMinor: 8000 },
]
const info = (id) =>
  id === 1 ? { nameAr: 'لبن', stockQty: 7 } : id === 2 ? { nameAr: 'جبنة', stockQty: 5 } : undefined

ok('المتبقي القابل للإرجاع يتناقص تراكمياً', () => {
  const r = remainingPurchasable(purchaseLines, [{ itemId: 1, qty: 4 }])
  assert.equal(r.get(1), 6)
  assert.equal(r.get(2), 5)
})

ok('بناء سطور مرتجع بتكلفة الوحدة النهائية', () => {
  const lines = buildPurchaseReturnLines(purchaseLines, [], new Map([[1, 3]]), info)
  assert.equal(lines[0].landedUnitCostMinor, 1200)
  assert.equal(purchaseReturnTotal(lines), 3600)
})

ok('رفض إرجاع أكثر من المشترى (تراكمياً)', () => {
  assert.throws(
    () => buildPurchaseReturnLines(purchaseLines, [{ itemId: 1, qty: 8 }], new Map([[1, 3]]), info),
    /المتبقي/,
  )
})

ok('رفض إرجاع أكثر من المخزون الحالي (بضاعة بيعت بالفعل)', () => {
  // اشترى 10 لكن المخزون 7 فقط (باع 3) — لا يرجع 8
  assert.throws(() => buildPurchaseReturnLines(purchaseLines, [], new Map([[1, 8]]), info), /بيعت/)
})

ok('رفض صنف ليس في الفاتورة الأصلية', () => {
  const badInfo = (id) => (id === 99 ? { nameAr: 'غريب', stockQty: 100 } : info(id))
  assert.throws(() => buildPurchaseReturnLines(purchaseLines, [], new Map([[99, 1]]), badInfo), /ليس في/)
})

ok('قيد المرتجع النقدي: خزينة مدين / مخزون دائن — متوازن', () => {
  const e = buildPurchaseReturnEntry(3600, 'cash')
  assert.equal(sumD(e), sumC(e))
  assert.ok(e.some((l) => l.accountCode === '1101' && l.debit === 3600))
  assert.ok(e.some((l) => l.accountCode === '1103' && l.credit === 3600))
})

ok('قيد مرتجع تخفيض الدين: موردون مدين', () => {
  const e = buildPurchaseReturnEntry(3600, 'debt')
  assert.ok(e.some((l) => l.accountCode === '2101' && l.debit === 3600))
})

console.log('🔍 الجرد بالباركود وقيد التسوية')

const counts = [
  { itemId: 1, nameAr: 'لبن', expectedQty: 10, countedQty: 8, unitCostMinor: 1000 }, // عجز 2 = 2000
  { itemId: 2, nameAr: 'جبنة', expectedQty: 5, countedQty: 5, unitCostMinor: 8000 }, // مطابق
  { itemId: 3, nameAr: 'زيت', expectedQty: 3, countedQty: 4, unitCostMinor: 500 }, // زيادة 1 = 500
]

ok('حساب الفوارق: عجز وزيادة ومطابق', () => {
  const r = computeStocktake(counts)
  assert.equal(r.matchedCount, 1)
  assert.equal(r.variances.length, 2)
  assert.equal(r.shortageValueMinor, 2000)
  assert.equal(r.surplusValueMinor, 500)
  assert.equal(r.netValueMinor, -1500)
})

ok('كسور الوزن تُحسب بدقة (0.75 معدود من 1)', () => {
  const r = computeStocktake([{ itemId: 9, nameAr: 'قشطة', expectedQty: 1, countedQty: 0.75, unitCostMinor: 10000 }])
  assert.equal(r.variances[0].diffQty, -0.25)
  assert.equal(r.variances[0].valueMinor, -2500)
})

ok('رفض معدود سالب وصنف مكرر', () => {
  assert.throws(() => computeStocktake([{ itemId: 1, nameAr: 'x', expectedQty: 1, countedQty: -1, unitCostMinor: 1 }]), /سالب/)
  assert.throws(() => computeStocktake([
    { itemId: 1, nameAr: 'x', expectedQty: 1, countedQty: 1, unitCostMinor: 1 },
    { itemId: 1, nameAr: 'x', expectedQty: 1, countedQty: 2, unitCostMinor: 1 },
  ]), /مكرر/)
})

ok('قيد التسوية متوازن ويحمل العجز والزيادة معاً', () => {
  const e = buildAdjustmentEntry(computeStocktake(counts))
  assert.equal(sumD(e), sumC(e))
  assert.ok(e.some((l) => l.accountCode === '5108' && l.debit === 2000)) // عجز مصروف
  assert.ok(e.some((l) => l.accountCode === '1103' && l.debit === 500)) // زيادة للمخزون
})

ok('جرد مطابق تماماً: لا قيد تسوية', () => {
  const r = computeStocktake([{ itemId: 2, nameAr: 'جبنة', expectedQty: 5, countedQty: 5, unitCostMinor: 8000 }])
  assert.equal(r.variances.length, 0)
  assert.throws(() => buildAdjustmentEntry(r), /لا فوارق/)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
