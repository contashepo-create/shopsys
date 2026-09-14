#!/usr/bin/env node
/**
 * verify_reports — فحص نواة مركز التقارير
 * node --experimental-strip-types scripts/verify_reports.mjs
 */
import { strict as assert } from 'node:assert'
import {
  inPeriod, salesSummary, topItems, dailySales,
  customerBalances, supplierBalances, stockAlerts, inventoryValue, periodPresets,
} from '../src/core/reports.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

/* بيانات تجريبية: فاتورتان داخل الفترة وواحدة خارجها + مرتجع */
const totals = (total, tax, cogs, gross = total, discount = 0) =>
  ({ grossMinor: gross, discountMinor: discount, netMinor: total - tax, taxBaseMinor: total - tax, taxMinor: tax, totalMinor: total, cogsMinor: cogs })

const line = (itemId, nameAr, qty, price, cost, disc = 0) =>
  ({ itemId, nameAr, qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: disc, soldByWeight: false })

const SALES = [
  { id: 1, invoiceNumber: 'S-0001', date: '2026-09-10T10:00:00Z', customerId: null, payment: 'cash',
    lines: [line(1, 'لبن', 2, 3500, 2800)], totals: totals(7000, 860, 5600) },
  { id: 2, invoiceNumber: 'S-0002', date: '2026-09-12T10:00:00Z', customerId: 5, payment: 'credit',
    lines: [line(2, 'جبنة', 1, 26000, 21000)], totals: totals(26000, 3193, 21000) },
  { id: 3, invoiceNumber: 'S-0003', date: '2026-08-01T10:00:00Z', customerId: null, payment: 'cash',
    lines: [line(1, 'لبن', 5, 3500, 2800)], totals: totals(17500, 2149, 14000) },
]
const RETURNS = [
  { id: 1, date: '2026-09-13T10:00:00Z', saleId: 1, refund: 'cash',
    lines: [line(1, 'لبن', 1, 3500, 2800)], totals: totals(3500, 430, 2800) },
]
const P = { from: '2026-09-01', to: '2026-09-30' }

console.log('🔍 الفترات والملخص')

ok('inPeriod شاملة الطرفين وتتجاهل الوقت', () => {
  assert.ok(inPeriod('2026-09-01T00:00:00Z', P))
  assert.ok(inPeriod('2026-09-30T23:59:00Z', P))
  assert.ok(!inPeriod('2026-08-31T10:00:00Z', P))
  assert.ok(!inPeriod('2026-10-01T00:00:00Z', P))
})

ok('ملخص المبيعات: فاتورتا سبتمبر فقط، نقدي/آجل صحيحان', () => {
  const s = salesSummary(SALES, RETURNS, P)
  assert.equal(s.invoiceCount, 2)
  assert.equal(s.totalMinor, 33000)
  assert.equal(s.cashMinor, 7000)
  assert.equal(s.creditMinor, 26000)
  assert.equal(s.cogsMinor, 26600)
})

ok('الربح = الإجمالي − الضريبة − التكلفة، وصافي الربح بعد المرتجعات', () => {
  const s = salesSummary(SALES, RETURNS, P)
  assert.equal(s.profitMinor, 33000 - 4053 - 26600) // 2347
  // أثر المرتجع: 3500 − 430 − 2800 = 270 ربحاً مفقوداً
  assert.equal(s.netProfitMinor, s.profitMinor - 270)
})

ok('مرتجع خارج الفترة لا يؤثر', () => {
  const s = salesSummary(SALES, RETURNS, { from: '2026-09-01', to: '2026-09-12' })
  assert.equal(s.returnsMinor, 0)
  assert.equal(s.netProfitMinor, s.profitMinor)
})

console.log('🔍 أفضل الأصناف والمبيعات اليومية')

ok('topItems يطرح المرتجعات ويرتب بالإيراد', () => {
  const rows = topItems(SALES, RETURNS, P)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].nameAr, 'جبنة')
  assert.equal(rows[0].revenueMinor, 26000)
  const milk = rows[1]
  assert.equal(milk.qty, 1) // 2 − 1 مرتجع
  assert.equal(milk.revenueMinor, 3500)
  assert.equal(milk.profitMinor, 3500 - 2800)
})

ok('خصم السطر يدخل في إيراد الصنف', () => {
  const s = [{ id: 9, invoiceNumber: 'S-9', date: '2026-09-15T10:00:00Z', customerId: null, payment: 'cash',
    lines: [line(3, 'زيت', 2, 10000, 7000, 10)], totals: totals(18000, 0, 14000) }]
  const rows = topItems(s, [], P)
  assert.equal(rows[0].revenueMinor, 18000) // 20000 × 0.9
})

ok('dailySales يجمع باليوم مرتباً', () => {
  const d = dailySales(SALES, P)
  assert.equal(d.length, 2)
  assert.equal(d[0].date, '2026-09-10')
  assert.equal(d[0].totalMinor, 7000)
  assert.equal(d[1].invoiceCount, 1)
})

console.log('🔍 الذمم والمخزون')

ok('مديونية عميل: فواتير آجلة − تحصيلات − مرتجعات ذمة', () => {
  const rows = customerBalances(SALES, RETURNS, [{ customerId: 5, amountMinor: 6000 }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].customerId, 5)
  assert.equal(rows[0].balanceMinor, 26000 - 6000)
})

ok('مرتجع بتخفيض الذمة يخصم من مديونية صاحب الفاتورة', () => {
  const ret = [{ id: 2, date: '2026-09-14T10:00:00Z', saleId: 2, refund: 'credit',
    lines: [line(2, 'جبنة', 1, 26000, 21000)], totals: totals(26000, 3193, 21000) }]
  const rows = customerBalances(SALES, ret, [])
  assert.equal(rows[0].balanceMinor, 0)
})

ok('مستحقات الموردين: الفواتير − المدفوع − سندات لاحقة', () => {
  const purchases = [
    { id: 1, date: '2026-09-01', supplierId: 1, grandTotalMinor: 100000, paidMinor: 40000 },
    { id: 2, date: '2026-09-05', supplierId: 1, grandTotalMinor: 50000, paidMinor: 50000 },
  ]
  const rows = supplierBalances(purchases, [{ supplierId: 1, amountMinor: 20000 }])
  assert.equal(rows[0].balanceMinor, 40000)
})

ok('تنبيهات المخزون: نافد قبل منخفض، وفوق الحد لا يظهر', () => {
  const rows = stockAlerts([
    { id: 1, nameAr: 'أ', stockQty: 0, minQty: 5 },
    { id: 2, nameAr: 'ب', stockQty: 3, minQty: 5 },
    { id: 3, nameAr: 'ج', stockQty: 50, minQty: 5 },
    { id: 4, nameAr: 'د', stockQty: 2, minQty: 0 }, // بلا حد طلب — لا تنبيه
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'out')
  assert.equal(rows[1].kind, 'low')
})

ok('قيمة المخزون = Σ التكلفة × الكمية (يتجاهل الصفري)', () => {
  const { rows, totalMinor } = inventoryValue([
    { id: 1, nameAr: 'أ', stockQty: 10, costMinor: 2800 },
    { id: 2, nameAr: 'ب', stockQty: 0, costMinor: 999 },
    { id: 3, nameAr: 'ج', stockQty: 1.5, costMinor: 21000 },
  ])
  assert.equal(rows.length, 2)
  assert.equal(totalMinor, 28000 + 31500)
})

ok('الفترات الجاهزة: اليوم وهذا الشهر والشهر الماضي صحيحة', () => {
  const ps = periodPresets('2026-09-14T12:00:00Z')
  const today = ps.find((p) => p.id === 'today').period
  assert.deepEqual(today, { from: '2026-09-14', to: '2026-09-14' })
  const month = ps.find((p) => p.id === 'month').period
  assert.deepEqual(month, { from: '2026-09-01', to: '2026-09-14' })
  const prev = ps.find((p) => p.id === 'prev_month').period
  assert.deepEqual(prev, { from: '2026-08-01', to: '2026-08-31' })
  const week = ps.find((p) => p.id === 'week').period
  assert.equal(week.from, '2026-09-08')
})

ok('الشهر الماضي عبر السنة: يناير → ديسمبر السابق', () => {
  const ps = periodPresets('2026-01-10T12:00:00Z')
  const prev = ps.find((p) => p.id === 'prev_month').period
  assert.deepEqual(prev, { from: '2025-12-01', to: '2025-12-31' })
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
