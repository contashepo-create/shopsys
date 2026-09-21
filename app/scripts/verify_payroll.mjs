#!/usr/bin/env node
/**
 * verify_payroll — فحص نواة الموظفين والرواتب
 * node --experimental-strip-types scripts/verify_payroll.mjs
 */
import { strict as assert } from 'node:assert'
import {
  computePayrollLine, computePayrollTotals, validatePayrollRun,
  buildPayrollEntry, monthLabelAr,
} from '../src/core/payroll.ts'
import { assertBalanced } from '../src/core/ledger.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 حساب سطر الراتب')

ok('الصافي = أساسي + بدلات + إضافي − خصومات − سلف', () => {
  const l = computePayrollLine({ employeeId: 1, baseMinor: 500000, allowancesMinor: 50000, overtimeMinor: 20000, deductionsMinor: 10000, advancesMinor: 30000 })
  assert.equal(l.grossMinor, 570000)
  assert.equal(l.netMinor, 530000)
})

ok('سطر بلا إضافات ولا خصومات: الصافي = الأساسي + البدلات', () => {
  const l = computePayrollLine({ employeeId: 2, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })
  assert.equal(l.netMinor, 300000)
})

ok('صافي سالب مرفوض (خصومات أكبر من الراتب)', () => {
  assert.throws(() => computePayrollLine({ employeeId: 1, baseMinor: 10000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 5000, advancesMinor: 6000 }))
})

ok('قيم غير صحيحة مرفوضة: سالبة أو كسرية', () => {
  assert.throws(() => computePayrollLine({ employeeId: 1, baseMinor: -100, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }))
  assert.throws(() => computePayrollLine({ employeeId: 1, baseMinor: 100.5, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }))
})

console.log('🔍 إجماليات المسير والتحقق')

const L1 = computePayrollLine({ employeeId: 1, baseMinor: 500000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 20000, advancesMinor: 0 })
const L2 = computePayrollLine({ employeeId: 2, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 15000, deductionsMinor: 0, advancesMinor: 50000 })

ok('إجماليات المسير تتجمع صحيحاً', () => {
  const t = computePayrollTotals([L1, L2])
  assert.equal(t.employeeCount, 2)
  assert.equal(t.grossMinor, 865000)
  assert.equal(t.deductionsMinor, 70000)
  assert.equal(t.netMinor, 795000)
})

ok('صيغة شهر خاطئة مرفوضة، وYYYY-MM صحيحة مقبولة', () => {
  assert.ok(validatePayrollRun({ month: '2026/09', lines: [L1], existingMonths: [] }).length > 0)
  assert.ok(validatePayrollRun({ month: '2026-13', lines: [L1], existingMonths: [] }).length > 0)
  assert.equal(validatePayrollRun({ month: '2026-09', lines: [L1], existingMonths: [] }).length, 0)
})

ok('مسير مكرر لنفس الشهر مرفوض', () => {
  const errs = validatePayrollRun({ month: '2026-09', lines: [L1], existingMonths: ['2026-08', '2026-09'] })
  assert.ok(errs.some((e) => e.includes('2026-09')))
})

ok('مسير فارغ مرفوض', () => {
  assert.ok(validatePayrollRun({ month: '2026-09', lines: [], existingMonths: [] }).length > 0)
})

console.log('🔍 قيد المسير المتوازن')

ok('نقدي: من ح/ 5102 إلى ح/ الخزينة 1101 — متوازن', () => {
  const lines = buildPayrollEntry(795000, 'cash', '1101', 'سبتمبر 2026')
  assertBalanced(lines)
  assert.equal(lines[0].accountCode, '5102')
  assert.equal(lines[0].debit, 795000)
  assert.equal(lines[1].accountCode, '1101')
  assert.equal(lines[1].credit, 795000)
})

ok('نقدي من البنك: الدائن 1102', () => {
  const lines = buildPayrollEntry(100000, 'cash', '1102', 'سبتمبر 2026')
  assert.equal(lines[1].accountCode, '1102')
})

ok('استحقاق: الدائن رواتب مستحقة 2104', () => {
  const lines = buildPayrollEntry(100000, 'accrue', '1101', 'سبتمبر 2026')
  assertBalanced(lines)
  assert.equal(lines[1].accountCode, '2104')
})

ok('مبلغ صفري أو سالب مرفوض', () => {
  assert.throws(() => buildPayrollEntry(0, 'cash', '1101', 'x'))
  assert.throws(() => buildPayrollEntry(-5, 'cash', '1101', 'x'))
})

ok('تسمية الشهر بالعربية', () => {
  assert.equal(monthLabelAr('2026-09'), 'سبتمبر 2026')
  assert.equal(monthLabelAr('2025-01'), 'يناير 2025')
  assert.equal(monthLabelAr('غير-صالح'), 'غير-صالح')
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
