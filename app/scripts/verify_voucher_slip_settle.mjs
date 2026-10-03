/* بوابة سداد قسائم الرواتب من سند الصرف (طلب المالك ㉘): تحديد القسائم المستهدفة بلا خلط موظفين */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants, expectReject } from './auditKit.mjs'
import { readFileSync } from 'node:fs'

const R = reporter('سند الصرف ⇄ قسائم الرواتب — سداد مستهدف')
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
const vouchersPage = readFileSync(new URL('../src/ui/pages/VouchersPage.tsx', import.meta.url), 'utf8')

/* ① الرحلة الكاملة على متجر نظيف: استحقاق قسيمة ثم سندها بسند صرف على 2104 */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addEmployee({ nameAr: 'أحمد المصري', phone: '', jobTitle: 'بائع', hireDate: '2026-01-01', baseSalaryMinor: 800000, allowancesMinor: 50000, active: true, notes: '' })
  const emp = g().employees[0]
  g().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: emp.id, grossMinor: 850000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
  const slip = g().payrollSlips.find((x) => x.employeeId === emp.id)
  assert.ok(slip && slip.status === 'accrued', 'القسيمة لم تُستحق')
  const slipNet = slip.netMinor

  /* سند صرف على 2104 لنفس الموظف يستهدف القسيمة */
  const voucher = g().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: slipNet,
    description: 'صرف راتب سبتمبر', partyKind: 'employee', partyId: emp.id, settleSlipIds: [slip.id],
  })
  const paid = g().payrollSlips.find((x) => x.id === slip.id)
  assert.equal(paid.status, 'paid', 'القسيمة لم تُوسم مصروفة')
  assert.ok((paid.paidFrom ?? '').includes(voucher.voucherNumber), 'وسم القسيمة لا يذكر رقم سند الصرف')
  assert.ok((paid.paidFrom ?? '').startsWith('سند صرف'), 'وسم paidFrom ليس بصيغة «سند صرف <رقم>»')
  /* القيد: 2104 مدين وخزينة دائنة */
  const entry = g().journal.find((e) => e.id === paid.paidEntryId)
  assert.ok(entry, 'لا قيد مرتبط بصرف القسيمة')
  assert.ok(entry.lines.some((l) => l.accountCode === '2104' && l.debit === slipNet), 'قيد السند لا يُسقط الذمة من 2104')
  assert.ok(entry.lines.some((l) => l.accountCode === '1101' && l.credit === slipNet), 'قيد السند لا يخرج من الخزينة')
  assertInvariants('بعد سداد قسيمة بسند صرف', c)

  /* ② رفض السداد المزدوج: القسيمة المصروفة لا تُسدَّد مرتين */
  await expectReject(
    'سداد قسيمة مصروفة مرتين', c,
    () => g().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: slipNet,
      description: 'مكرر', partyKind: 'employee', partyId: emp.id, settleSlipIds: [slip.id],
    }),
    /مصروفة بالفعل/,
  )

  /* ③ رفض قسيمة موظف آخر: لا خلط ذمم */
  g().addEmployee({ nameAr: 'سعيد فؤاد', phone: '', jobTitle: 'عامل', hireDate: '2026-01-01', baseSalaryMinor: 600000, allowancesMinor: 0, active: true, notes: '' })
  const other = g().employees.find((e) => e.id !== emp.id)
  g().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: other.id, grossMinor: 600000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] })
  const otherSlip = g().payrollSlips.find((x) => x.employeeId === other.id)
  await expectReject(
    'سداد قسيمة موظف من سند موظف آخر', c,
    () => g().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: otherSlip.netMinor,
      description: 'خلط', partyKind: 'employee', partyId: emp.id, settleSlipIds: [otherSlip.id],
    }),
    /ليست لهذا الموظف/,
  )

  /* ④ رفض تجاوز مبلغ السند: مجموع القسائم ≤ مبلغ السند */
  await expectReject(
    'مجموع القسائم أكبر من مبلغ السند', c,
    () => g().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 100,
      description: 'ناقص', partyKind: 'employee', partyId: other.id, settleSlipIds: [otherSlip.id],
    }),
    /أكبر من مبلغ السند/,
  )

  /* ⑤ السداد الجزئي مسموح: مبلغ أكبر من القسيمة ⇒ تُسدد القسيمة ويبقى الباقي رصيداً عاماً */
  const over = g().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: otherSlip.netMinor + 50000,
    description: 'راتب + سلفة', partyKind: 'employee', partyId: other.id, settleSlipIds: [otherSlip.id],
  })
  assert.equal(g().payrollSlips.find((x) => x.id === otherSlip.id).status, 'paid', 'السداد الأكبر من القسيمة يجب أن يسدد القسيمة')
  const overEntry = g().journal.find((e) => e.id === over.journalEntryId)
  assert.ok(overEntry && overEntry.lines.some((l) => l.accountCode === '2104' && l.debit === otherSlip.netMinor + 50000), 'قيد السند لا يحمل المبلغ كاملاً على 2104')
  assertInvariants('بعد سداد قسيمة بمبلغ أكبر', c)
  R.ok('الرحلة: استحقاق ← سند صرف موسوم ← رفض مزدوج/خلط/تجاوز ← سداد جزئي سليم')
}

/* ⑥ حراس النص والواجهة: لوحة تسديد القسائم داخل شاشة السندات */
{
  assert.ok(/settleSlipIds\?: number\[\]/.test(repo), 'خانة settleSlipIds مفقودة من توقيع postVoucher')
  assert.ok(/ليست لهذا الموظف/.test(repo), 'حارس خلط موظفين مفقود')
  assert.ok(/مصروفة بالفعل/.test(repo), 'حارس السداد المزدوج مفقود')
  assert.ok(/أكبر من مبلغ السند/.test(repo), 'حارس تجاوز المبلغ مفقود')
  assert.ok(/سند صرف \$\{voucherNumber\}/.test(repo), 'وسم paidFrom بلا رقم السند')
  assert.ok(/settleSlipIds|قسائم/.test(vouchersPage), 'شاشة السندات بلا لوحة تسديد قسائم')
  R.ok('الحراس النصية ولوحة القسائم في شاشة السندات')
}

R.done()
