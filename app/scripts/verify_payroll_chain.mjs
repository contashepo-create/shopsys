/**
 * بوابة §93 — سلسلة الرواتب كاملة من المسير إلى التصفية بسند الصرف:
 * جزاء مسجل + سلفة قائمة ← مسير بقسائم مستقلة ← الخصم والسلفة يُستردان من
 * سجلاتهما (لا يبقى الجزاء «قائماً» للأبد) ← السداد بسند صرف ← كشف حساب
 * الموظف برصيد صحيح بلا ازدواج (السند المحصِّل للقسائم لا يُعدّ مرتين) ←
 * الإلغاء يعكس الاستردادين ← الرصيد المتبقي يطابق الحقيقة.
 *
 * + فحوص واجهة: شارات المتبقي بالمسير · زر تحميل السلف والجزاءات ·
 *   صرف القسيمة بنافذة سند صرف رسمي لا قيد مجهّل من 1101.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_payroll_chain.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshCase, assertInvariants, expectReject, reporter } from './auditKit.mjs'

const R = reporter('سلسلة الرواتب: مسير ← جزاءات وسلف ← سند صرف ← كشف صحيح')
const employeesPage = readFileSync(new URL('../src/ui/pages/EmployeesPage.tsx', import.meta.url), 'utf8')
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')

/* ═══ ① الرحلة الكاملة على متجر نظيف ═══ */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addEmployee({ nameAr: 'أحمد المصري', phone: '', jobTitle: 'بائع', hireDate: '2026-01-01', baseSalaryMinor: 800000, allowancesMinor: 0, active: true, notes: '' })
  const emp = g().employees[0]

  /* جزاء مسجل وسلفة قائمة — كما يسجلهما المالك من تبويباتهما */
  g().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 30000, reason: 'تأخير متكرر', notes: '' })
  g().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة ضرورية' })
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 30000, 'الجزاء لم يُسجل قائماً')
  assert.equal(g().getEmployeeAdvanceBalance(emp.id).remainingMinor, 100000, 'السلفة لم تُسجل قائمة')

  /* مسير بقسيمة واحدة: خصم 300 (الجزاء) وسلفة 100 — صافي 670 */
  const slips = g().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: emp.id, grossMinor: 800000, allowancesMinor: 0, deductionsMinor: 30000, advanceMinor: 100000 }] })
  assert.equal(slips[0].netMinor, 670000, 'صافي القسيمة خاطئ')
  assert.equal(slips.length, 1)

  /* §93: الخصم المسجل يُسترد من سجله — لا يبقى «قائماً» بعد خصمه فعلياً */
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 0, 'الجزاء ما زال قائماً بعد المسير — الفجوة القديمة')
  assert.ok(Array.isArray(slips[0].recoveredDeductions) && slips[0].recoveredDeductions[0].minor === 30000, 'استرداد الجزاء غير موثق على القسيمة')
  assert.equal(g().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0, 'السلفة لم تُسترد')
  R.ok('المسير يسترد السلفة والجزاء من سجلاتهما بالأقدم أولاً ويوثقهما على القسيمة')

  /* خصم يزيد عن المسجل: الفائض خصم لحظي (غياب/تأخير) — لا حراسة تمنعه */
  g().addEmployee({ nameAr: 'سعيد فؤاد', phone: '', jobTitle: 'عامل', hireDate: '2026-01-01', baseSalaryMinor: 600000, allowancesMinor: 0, active: true, notes: '' })
  const other = g().employees.find((e) => e.id !== emp.id)
  g().addEmployeeDeduction({ employeeId: other.id, amountMinor: 20000, reason: 'مخالفة', notes: '' })
  const slips2 = g().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: other.id, grossMinor: 600000, allowancesMinor: 0, deductionsMinor: 50000, advanceMinor: 0 }] })
  assert.equal(slips2[0].netMinor, 550000, 'صافي خصم الجزئي خاطئ')
  assert.equal(g().getEmployeeDeductionBalance(other.id).remainingMinor, 0, 'الجزاء الجزئي لم يُسترد')
  R.ok('خصم أكبر من المسجل: المسجل يُسترد والفائض خصم لحظي بلا سجل — كما المسير المجمّع')

  /* ═══ ② السداد بسند صرف وكشف الحساب الصحيح ═══ */
  const slip = slips[0]
  const voucher = g().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: slip.netMinor,
    description: 'صرف راتب سبتمبر', partyKind: 'employee', partyId: emp.id, settleSlipIds: [slip.id],
  })
  const paid = g().payrollSlips.find((x) => x.id === slip.id)
  assert.equal(paid.status, 'paid', 'القسيمة لم تُوسم مصروفة')
  assert.ok((paid.paidFrom ?? '').includes(voucher.voucherNumber), 'وسم القسيمة لا يذكر السند')

  /* §93 (الإصلاح المركزي): رصيد الموظف = 0 (استحقاق 670 دائن + استرداد سلفة 100 دائن
     + سلفة 100 مدين + صرف 670 مدين) — كان -670 بازدواج السند مع سطر القسيمة */
  const balance = g().getEmployeeBalance(emp.id)
  assert.equal(balance, 0, `رصيد الموظف بعد السداد بسند صرف يجب أن يكون 0 — الفعلي ${balance} (الازدواج القديم)`)
  const rows = g().getEmployeeStatementRows(emp.id)
  const voucherRows = rows.filter((r) => r.ref === voucher.voucherNumber)
  assert.equal(voucherRows.length, 0, 'السند المسدد للقسيمة ما زال يظهر سطراً مستقلاً — الازدواج عاد')
  /* سند صرف بزيادة عن القسائم: الزيادة فقط تظهر على السند */
  const v2 = g().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: slips2[0].netMinor + 25000,
    description: 'صرف راتب + مكافأة', partyKind: 'employee', partyId: other.id, settleSlipIds: [slips2[0].id],
  })
  /* زيادة السند عن مجموع القسائم = دفعنا له أكثر من مستحقه ⇒ مدين علينا (سالب بالإشارة الدائنة للكشف) */
  const otherBalance = g().getEmployeeBalance(other.id)
  assert.equal(otherBalance, -25000, `زيادة السند عن القسيمة يجب أن تظهر مدينة على الموظف — الفعلي ${otherBalance}`)
  const v2Rows = g().getEmployeeStatementRows(other.id).filter((r) => r.ref === v2.voucherNumber)
  assert.equal(v2Rows.length === 1 && v2Rows[0].debitMinor === 25000, true, 'سطر زيادة السند غير صحيح')
  assertInvariants('سلسلة الرواتب بعد السداد بالسندات', c)
  R.ok('السداد بسند صرف: القسيمة تسدد باسمه والكشف بلا ازدواج — والزيادة عن القسيمة تظهر وحدها')

  /* ═══ ③ الإلغاء يعكس الاستردادين ═══ */
  const slip3 = g().accruePayrollSlips({ month: '2026-10', rows: [{ employeeId: emp.id, grossMinor: 800000, allowancesMinor: 0, deductionsMinor: 30000, advanceMinor: 0 }] })
  g().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 30000, reason: 'جزاء أكتوبر', notes: '' })
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 30000, 'جزاء أكتوبر لم يُسجل')
  g().cancelPayrollSlip(slip3[0].id, 'خطأ في البيانات')
  /* إلغاء قسيمة لم تسترد جزاءً (الاسترداد صفر لأن الجزاء سُجل بعدها) — لكن استرداد سلفة سبتمبر معكوس؟ لا: إلغاء سبتمبر لم يحدث */
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 30000, 'الإلغاء عبث برصيد الجزاءات')
  /* قسيمة تسترد جزاءً ثم تُلغى: الجزاء يعود قائماً */
  const slip4 = g().accruePayrollSlips({ month: '2026-11', rows: [{ employeeId: emp.id, grossMinor: 800000, allowancesMinor: 0, deductionsMinor: 15000, advanceMinor: 0 }] })
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 15000, 'استرداد جزئي خاطئ')
  g().cancelPayrollSlip(slip4[0].id, 'إلغاء تجريبي')
  assert.equal(g().getEmployeeDeductionBalance(emp.id).remainingMinor, 30000, 'إلغاء القسيمة لم يعد الجزاء قائماً')
  assertInvariants('بعد إلغاء قسيمة مستردة للجزاء', c)
  R.ok('إلغاء القسيمة يعكس استرداد الجزاء — يعود «قائماً» كما قبل المسير')

  /* ═══ ④ سلفة أكبر من المتاح تُرفض (حارس §83 سليم) ═══ */
  await expectReject('سلفة مستقطعة أكبر من متبقي السلف', c,
    () => g().accruePayrollSlips({ month: '2026-12', rows: [{ employeeId: emp.id, grossMinor: 800000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 50000 }] }),
    /أكبر من متبقي سلفه/,
  )
}

/* ═══ ⑤ واجهة المسير: شارات وزر تحميل وصرف بسند ═══ */
{
  assert.ok(employeesPage.includes('data-slip-hints'), 'شارات متبقي السلف/الجزاءات مفقودة من جدول المسير')
  assert.ok(employeesPage.includes('سلف متبقية') && employeesPage.includes('جزاءات قائمة'), 'تسميات الشارات مفقودة')
  assert.ok(employeesPage.includes('data-load-outstanding') && employeesPage.includes('تحميل السلف والجزاءات القائمة'), 'زر تحميل المتأخرات من السجلات مفقود')
  assert.ok(/deductions: Math\.max\(0, row\.deductions - \(row\.regDed \?\? 0\)\) \+ dedRemaining/.test(employeesPage), 'زر التحميل لا يستبدل نصيبه فقط (يضاعف بالضغط مرتين)')
  assert.ok(/deductions: Math\.max\(0, row\.deductions - \(row\.attDed \?\? 0\)\) \+ attDed/.test(employeesPage), 'احتساب الحضور لا يستبدل نصيبه فقط (يطمس الجزاءات المحملة)')
  assert.ok(employeesPage.includes('data-slip-voucher') && employeesPage.includes('data-slip-voucher-post'), 'نافذة سند صرف القسيمة مفقودة')
  assert.ok(employeesPage.includes('settleSlipIds: [paySlipFor.id]'), 'صرف القسيمة لا يسددها بسند على 2104')
  assert.ok(!/payPayrollSlip\(slipId, \{ treasury: '1101' \}\)/.test(employeesPage), 'الصرف المجهد من 1101 بلا سند ما زال موجوداً')
  assert.ok(/مسير مجمّع لموظف \(قديم\)/.test(employeesPage) && /مسير مجمّع للجميع \(قديم\)/.test(employeesPage), 'أزرار المسير المجمّع القديم لم تُخفض لثانوية')
  R.ok('الواجهة: شارات المتبقي + زر التحميل من السجلات + صرف القسيمة بسند صرف رسمي + المسير المجمّع ثانوي')
}

/* ═══ ⑥ المستودع: الاسترداد موثق ومعكوس ═══ */
{
  assert.ok(repo.includes('recoveredDeductionsByEmployee'), 'خريطة استرداد الجزاءات مفقودة من المستودع')
  assert.ok(/for \(const rd of slip\.recoveredDeductions \?\? \[\]\)/.test(repo), 'عكس استرداد الجزاءات عند الإلغاء مفقود')
  assert.ok(/const settledByVoucher = voucher\.kind === 'payment'/.test(repo), 'استثناء السند المسدد للقسائم مفقود من الكشف')
}

console.log('\n✅ سلسلة الرواتب §93: كل الفحوص ناجحة')
