#!/usr/bin/env node
/**
 * verify_returns_shifts — فحص مرتجعات المبيعات + ورديات الكاشير
 * node --experimental-strip-types scripts/verify_returns_shifts.mjs
 */
import { strict as assert } from 'node:assert'
import { computeTotals } from '../src/core/pos.ts'
import {
  remainingReturnable, buildReturnLines, buildReturnEntry, deriveTaxConfig,
} from '../src/core/returns.ts'
import { summarizeShift, validateOpenShift, currentOpenShift } from '../src/core/shifts.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 مرتجعات المبيعات — مربوطة بالفاتورة الأصلية دائماً')

const saleLines = [
  { itemId: 1, nameAr: 'لبن', qty: 3, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false },
  { itemId: 2, nameAr: 'جبنة', qty: 0.75, unitPriceMinor: 13000, unitCostMinor: 9000, discountPercent: 10, soldByWeight: true },
]

ok('المتبقي القابل للإرجاع = المباع قبل أي مرتجع', () => {
  const r = remainingReturnable(saleLines, [])
  assert.equal(r.get(1), 3)
  assert.equal(r.get(2), 0.75)
})

ok('المتبقي يتناقص تراكمياً بعد مرتجع سابق', () => {
  const prior = [{ ...saleLines[0], qty: 2 }]
  const r = remainingReturnable(saleLines, prior)
  assert.equal(r.get(1), 1)
})

ok('بناء سطور مرتجع بنفس سعر وخصم الأصل', () => {
  const lines = buildReturnLines(saleLines, [], new Map([[2, 0.5]]))
  assert.equal(lines.length, 1)
  assert.equal(lines[0].qty, 0.5)
  assert.equal(lines[0].unitPriceMinor, 13000)
  assert.equal(lines[0].discountPercent, 10) // خصم الأصل محفوظ
})

ok('رفض إرجاع أكثر من المباع', () => {
  assert.throws(() => buildReturnLines(saleLines, [], new Map([[1, 4]])), /المتبقي/)
})

ok('رفض إرجاع أكثر من المتبقي بعد مرتجعات سابقة', () => {
  const prior = [{ ...saleLines[0], qty: 2 }]
  assert.throws(() => buildReturnLines(saleLines, prior, new Map([[1, 2]])), /المتبقي/)
})

ok('رفض مرتجع بلا كميات', () => {
  assert.throws(() => buildReturnLines(saleLines, [], new Map()), /لا كميات/)
})

ok('deriveTaxConfig يستنتج 14٪ شاملة من إجماليات الأصل', () => {
  const totals = computeTotals(saleLines, 0, 14, true)
  const cfg = deriveTaxConfig(totals)
  assert.equal(cfg.taxPercent, 14)
  assert.equal(cfg.taxInclusive, true)
})

ok('deriveTaxConfig: ضريبة مضافة تُستنتج مضافة', () => {
  const totals = computeTotals(saleLines, 0, 15, false)
  const cfg = deriveTaxConfig(totals)
  assert.equal(cfg.taxPercent, 15)
  assert.equal(cfg.taxInclusive, false)
})

ok('deriveTaxConfig: بلا ضريبة', () => {
  const totals = computeTotals(saleLines, 0, 0, true)
  assert.equal(deriveTaxConfig(totals).taxPercent, 0)
})

ok('القيد العاكس متوازن (نقدي + ضريبة + تكلفة)', () => {
  const lines = buildReturnLines(saleLines, [], new Map([[1, 2]]))
  const totals = computeTotals(lines, 0, 14, true)
  const entry = buildReturnEntry(totals, 'cash')
  const d = entry.reduce((a, l) => a + l.debit, 0)
  const c = entry.reduce((a, l) => a + l.credit, 0)
  assert.equal(d, c) // التوازن البنيوي
  assert.ok(entry.some((l) => l.accountCode === '4102' && l.debit > 0)) // مرتجعات مبيعات مدينة
  assert.ok(entry.some((l) => l.accountCode === '1101' && l.credit > 0)) // الخزينة دائنة
  assert.ok(entry.some((l) => l.accountCode === '2102' && l.debit > 0)) // تخفيض ض.ق.م
  assert.ok(entry.some((l) => l.accountCode === '1103' && l.debit > 0)) // المخزون يعود
})

ok('القيد العاكس الآجل يخفض ذمم العملاء (1104)', () => {
  const lines = buildReturnLines(saleLines, [], new Map([[1, 1]]))
  const totals = computeTotals(lines, 0, 0, true)
  const entry = buildReturnEntry(totals, 'credit')
  assert.ok(entry.some((l) => l.accountCode === '1104' && l.credit > 0))
})

console.log('🔍 ورديات الكاشير — الدرج لا يضيع منه قرش')

const shift = { id: 1, openedAt: '2026-09-14T08:00:00Z', openedBy: 'كاشير', openingCashMinor: 50000, closedAt: null, countedCashMinor: null, status: 'open' }

ok('لا ورديتين مفتوحتين معاً', () => {
  assert.ok(validateOpenShift(0, [shift]).some((e) => e.includes('مفتوحة بالفعل')))
})

ok('رفض رصيد افتتاحي سالب', () => {
  assert.ok(validateOpenShift(-1, []).length > 0)
})

ok('currentOpenShift يجد المفتوحة فقط', () => {
  assert.equal(currentOpenShift([{ ...shift, status: 'closed' }]), null)
  assert.equal(currentOpenShift([shift])?.id, 1)
})

const sales = [
  { shiftId: 1, payment: 'cash', totalMinor: 30000 },
  { shiftId: 1, payment: 'cash', totalMinor: 20000 },
  { shiftId: 1, payment: 'credit', totalMinor: 15000 },
  { shiftId: 2, payment: 'cash', totalMinor: 99999 }, // وردية أخرى — لا تُحسب
  { shiftId: null, payment: 'cash', totalMinor: 7777 }, // خارج وردية — لا تُحسب
]
const returns = [{ shiftId: 1, payment: 'cash', totalMinor: 5000 }]

ok('الملخص: المتوقع = الافتتاحي + كاش − مرتجعات كاش', () => {
  const s = summarizeShift(shift, sales, returns)
  assert.equal(s.invoiceCount, 3)
  assert.equal(s.cashSalesMinor, 50000)
  assert.equal(s.creditSalesMinor, 15000)
  assert.equal(s.cashRefundsMinor, 5000)
  assert.equal(s.expectedCashMinor, 50000 + 50000 - 5000) // 95000
})

ok('الآجل لا يدخل درج النقدية', () => {
  const s = summarizeShift(shift, sales, returns)
  assert.ok(!(`${s.expectedCashMinor}`.includes('15000')))
  assert.equal(s.expectedCashMinor, 95000)
})

ok('العجز يظهر سالباً عند العد الناقص', () => {
  const closed = { ...shift, status: 'closed', countedCashMinor: 90000 }
  const s = summarizeShift(closed, sales, returns)
  assert.equal(s.varianceMinor, -5000) // عجز 50 جنيهاً
})

ok('الزيادة تظهر موجبة والدرج المضبوط صفراً', () => {
  const over = summarizeShift({ ...shift, status: 'closed', countedCashMinor: 96000 }, sales, returns)
  assert.equal(over.varianceMinor, 1000)
  const exact = summarizeShift({ ...shift, status: 'closed', countedCashMinor: 95000 }, sales, returns)
  assert.equal(exact.varianceMinor, 0)
})

ok('قبل العد varianceMinor = null (لا حكم مسبق)', () => {
  assert.equal(summarizeShift(shift, sales, returns).varianceMinor, null)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
