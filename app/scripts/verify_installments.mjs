#!/usr/bin/env node
/**
 * verify_installments — فحص نواة الأقساط والتنبيهات
 * node --experimental-strip-types scripts/verify_installments.mjs
 */
import { strict as assert } from 'node:assert'
import {
  buildSchedule, addMonths, installmentStatus, planProgress,
  applyPayment, collectAlerts,
} from '../src/core/installments.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 توليد الجدول')

ok('توزيع «أكبر البواقي»: المجموع = الممول تماماً ولا يضيع مليم', () => {
  // 10000 − 1000 = 9000 على 7 أقساط → 1286×2 + 1285×5 (البواقي للأوائل)
  const items = buildSchedule({ totalMinor: 10000, downPaymentMinor: 1000, count: 7, intervalMonths: 1, firstDueDate: '2026-10-01' })
  assert.equal(items.length, 7)
  assert.equal(items.reduce((a, i) => a + i.amountMinor, 0), 9000)
  assert.ok(items[0].amountMinor >= items[6].amountMinor)
  assert.ok(items[0].amountMinor - items[6].amountMinor <= 1)
})

ok('قسمة تامة: كل الأقساط متساوية', () => {
  const items = buildSchedule({ totalMinor: 12000, downPaymentMinor: 0, count: 6, intervalMonths: 1, firstDueDate: '2026-10-01' })
  assert.ok(items.every((i) => i.amountMinor === 2000))
})

ok('تواريخ الاستحقاق شهرية متتابعة', () => {
  const items = buildSchedule({ totalMinor: 3000, downPaymentMinor: 0, count: 3, intervalMonths: 1, firstDueDate: '2026-10-15' })
  assert.deepEqual(items.map((i) => i.dueDate), ['2026-10-15', '2026-11-15', '2026-12-15'])
})

ok('نهايات الشهور تُضبط: 31 يناير + شهر = 28 فبراير', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29') // كبيسة
  assert.equal(addMonths('2026-11-30', 2), '2027-01-30') // عبور سنة
})

ok('مدخلات خاطئة مرفوضة: مقدم ≥ الإجمالي، عدد صفري، تاريخ مشوه', () => {
  assert.throws(() => buildSchedule({ totalMinor: 1000, downPaymentMinor: 1000, count: 3, intervalMonths: 1, firstDueDate: '2026-10-01' }))
  assert.throws(() => buildSchedule({ totalMinor: 1000, downPaymentMinor: 0, count: 0, intervalMonths: 1, firstDueDate: '2026-10-01' }))
  assert.throws(() => buildSchedule({ totalMinor: 1000, downPaymentMinor: 0, count: 3, intervalMonths: 1, firstDueDate: '01/10/2026' }))
})

console.log('🔍 الحالات والسداد')

const T = '2026-09-14'
const mk = (dueDate, amountMinor = 1000, paidMinor = 0) => ({ seq: 1, dueDate, amountMinor, paidMinor, paidAt: null })

ok('حالة القسط: مدفوع/جزئي/يستحق اليوم/متأخر/قادم', () => {
  assert.equal(installmentStatus(mk('2026-09-01', 1000, 1000), T), 'paid')
  assert.equal(installmentStatus(mk('2026-10-01', 1000, 300), T), 'partial')
  assert.equal(installmentStatus(mk(T), T), 'due_today')
  assert.equal(installmentStatus(mk('2026-09-01'), T), 'overdue')
  assert.equal(installmentStatus(mk('2026-10-01'), T), 'upcoming')
})

ok('قسط جزئي متأخر يُحسب متأخراً', () => {
  assert.equal(installmentStatus(mk('2026-09-01', 1000, 300), T), 'overdue')
})

ok('السداد يتوزع على الأقدم أولاً', () => {
  const items = buildSchedule({ totalMinor: 3000, downPaymentMinor: 0, count: 3, intervalMonths: 1, firstDueDate: '2026-08-01' })
  const { items: after, excessMinor } = applyPayment(items, 1500, '2026-09-14T10:00:00Z')
  assert.equal(excessMinor, 0)
  assert.equal(after[0].paidMinor, 1000) // الأول اكتمل
  assert.equal(after[1].paidMinor, 500) // الثاني جزئي
  assert.equal(after[2].paidMinor, 0)
})

ok('الفائض يُعاد ولا يُبتلع', () => {
  const items = [mk('2026-09-01', 1000, 900)]
  const { excessMinor } = applyPayment(items, 500, '2026-09-14T10:00:00Z')
  assert.equal(excessMinor, 400)
})

ok('ملخص التقدم: محصَّل/متبقٍ/متأخر/القادم/مكتملة', () => {
  const items = [
    { seq: 1, dueDate: '2026-08-01', amountMinor: 1000, paidMinor: 1000, paidAt: 'x' },
    { seq: 2, dueDate: '2026-09-01', amountMinor: 1000, paidMinor: 400, paidAt: 'x' },
    { seq: 3, dueDate: '2026-10-01', amountMinor: 1000, paidMinor: 0, paidAt: null },
  ]
  const p = planProgress(items, T)
  assert.equal(p.paidCount, 1)
  assert.equal(p.paidMinor, 1400)
  assert.equal(p.remainingMinor, 1600)
  assert.equal(p.overdueMinor, 600) // قسط 2 متأخر بباقيه
  assert.equal(p.nextDue.seq, 2)
  assert.equal(p.finished, false)
  assert.ok(planProgress([items[0]], T).finished)
})

console.log('🔍 التنبيهات')

ok('متأخر + يستحق قريباً، مرتبة بالأشد تأخراً أولاً', () => {
  const plans = [
    { id: 1, items: [mk('2026-09-01'), mk('2026-09-16')] }, // متأخر 13 يوماً + بعد يومين
    { id: 2, items: [mk('2026-09-10'), mk('2026-12-01')] }, // متأخر 4 أيام + بعيد (لا تنبيه)
  ]
  const alerts = collectAlerts(plans, T, 7)
  assert.equal(alerts.length, 3)
  assert.equal(alerts[0].daysDiff, -13)
  assert.equal(alerts[0].kind, 'overdue')
  assert.equal(alerts[2].kind, 'due_soon')
  assert.equal(alerts[2].daysDiff, 2)
})

ok('المدفوع بالكامل لا يظهر في التنبيهات', () => {
  const alerts = collectAlerts([{ id: 1, items: [mk('2026-09-01', 1000, 1000)] }], T, 7)
  assert.equal(alerts.length, 0)
})

ok('اليوم الحالي يستحق اليوم يظهر كـ due_soon بصفر أيام', () => {
  const alerts = collectAlerts([{ id: 1, items: [mk(T)] }], T, 7)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].daysDiff, 0)
  assert.equal(alerts[0].kind, 'due_soon')
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
