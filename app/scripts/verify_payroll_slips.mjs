/* بوابة قسائم الرواتب: ذمة مستقلة لكل موظف + صرف متفرّق سليم محاسبياً */
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'
import { buildSlipAccrualLines, buildSlipPaymentLines, slipNetMinor, validateSlipDraft, slipsTotals } from '../src/core/payrollSlips.ts'
import { readFileSync } from 'node:fs'

const R = reporter('قسائم الرواتب — ذمة مستقلة لكل موظف')
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/ui/pages/EmployeesPage.tsx', import.meta.url), 'utf8')

{
  const slips = [
    { employeeName: 'أحمد', slipNumber: 'PS-0001', netMinor: 830000, advanceMinor: 50000 },
    { employeeName: 'سعيد', slipNumber: 'PS-0002', netMinor: 630000, advanceMinor: 0 },
  ]
  const lines = buildSlipAccrualLines(slips, 'سبتمبر 2026')
  const debit = lines.reduce((sum, l) => sum + l.debit, 0)
  const credit = lines.reduce((sum, l) => sum + l.credit, 0)
  assert.equal(debit, credit, 'قيد الاستحقاق غير متزن')
  const perEmployee = lines.filter((l) => l.accountCode === '2104' && l.credit > 0)
  assert.equal(perEmployee.length, 2, 'يجب سطر دائن مستقل لكل موظف على 2104')
  assert.ok(perEmployee.every((l) => /PS-\d{4} — /.test(l.note ?? '')), 'سطر الموظف بلا رقم قسيمة واسم')
  assert.equal(lines.find((l) => l.accountCode === '5102')?.debit, 830000 + 630000 + 50000, 'المصروف يجب أن يشمل السلف المستردة')
  assert.equal(lines.find((l) => l.accountCode === '1107')?.credit, 50000, 'السلف المستقطعة لا تُقيَّد على 1107')
  R.ok('الاستحقاق: مدين 5102 · دائن 2104 بسطر لكل موظف · دائن 1107 بالسلف — متزن')
}
{
  const lines = buildSlipPaymentLines({ slipNumber: 'PS-0001', employeeName: 'أحمد', netMinor: 830000 }, '1101')
  assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0), 'قيد الصرف غير متزن')
  assert.equal(lines.find((l) => l.accountCode === '2104')?.debit, 830000, 'الصرف يجب أن يُسقط ذمة الموظف من 2104')
  assert.equal(lines.find((l) => l.accountCode === '1101')?.credit, 830000, 'الصرف لا يخرج من الخزينة')
  R.ok('الصرف: قيد مستقل لكل قسيمة — مدين 2104 ← دائن الخزينة')
}
{
  assert.equal(slipNetMinor({ grossMinor: 800000, allowancesMinor: 50000, deductionsMinor: 20000, advanceMinor: 0 }), 830000, 'حساب الصافي خاطئ')
  const errors = validateSlipDraft({ employeeId: 1, grossMinor: 500000, allowancesMinor: 0, deductionsMinor: 400000, advanceMinor: 0 })
  assert.ok(errors.some((e) => e.includes('نصف الراتب')), 'سقف الخصم 50٪ غير محمي')
  const totals = slipsTotals([
    { netMinor: 830000, grossMinor: 800000, allowancesMinor: 50000, deductionsMinor: 20000, advanceMinor: 0, status: 'accrued' },
    { netMinor: 630000, grossMinor: 600000, allowancesMinor: 50000, deductionsMinor: 20000, advanceMinor: 0, status: 'paid' },
  ])
  assert.equal(totals.unpaid, 830000, 'غير المصروف يُحسب خطأ')
  R.ok('الصافي وسقف الخصم وإجماليات المصروف/غير المصروف')
}
{
  assert.ok(/payrollSlips: PayrollSlip\[\]/.test(repo) && /accruePayrollSlips: \(/.test(repo) && /payPayrollSlip: \(/.test(repo),
    'مخزن القسائم ناقص')
  assert.ok(/له قسيمة مستحقة لهذا الشهر بالفعل/.test(repo), 'لا منع لتكرار استحقاق نفس الموظف لنفس الشهر')
  assert.ok(/لا تُلغى قسيمة مصروفة/.test(repo), 'يمكن إلغاء قسيمة مصروفة — خلل محاسبي')
  assert.ok(/getUnpaidPayrollSlips: \(employeeId\)/.test(repo), 'لا وسيلة لعرض القسائم غير المصروفة لكل موظف')
  assert.ok(/data-payroll-slips/.test(page) && /data-pay-slip=/.test(page), 'شاشة الرواتب بلا قسائم أو بلا زر صرف')
  R.ok('المخزن يمنع التكرار وإلغاء المصروف، والشاشة تعرض القسائم وتصرفها فردياً')
}
R.done()
