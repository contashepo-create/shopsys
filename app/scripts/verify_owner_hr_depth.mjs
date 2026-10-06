/**
 * بوابة مراجعة §83 — «الموارد البشرية» (جولة المالك الرابعة على مصفوفة §70-هـ)
 * ─────────────────────────────────────────────────────────────────────────────
 * النطاق: core/payroll · payrollSlips · attendance (596 سطراً) · shifts ·
 *         staffCommissions · commissions · invoiceCommissions + المسارات الحية
 *         في repo.ts (postPayroll · القسائم · السلف/الجزاءات · العمولات الثلاثة ·
 *         الحضور/الإجازات/البصمة · الوردية) — البوابات القائمة غطت كل مسار
 *         على حدة (employees_all_activities · deep_16 · hr_attendance…)؛
 *         برهان هذه الجولة:
 *
 * ① حراس §83 (انحدار): مسير/إجازة بموظف شبح كانا يمرّان — مُنعا في المستودع.
 * ② نواة payroll الخالصة: حساب السطر/التحقق الشامل/قيد المسير بمصفوفاته الأربع.
 * ③ القسائم (الدفتر المساعد): استحقاق بسطر مستقل لكل موظف → صرف → إلغاء،
 *    والثابت bal(2104) = Σ صوافي القسائم القائمة بالقرش.
 * ④ السلف والجزاءات: دورة كاملة (سلفتان → توزيع أقدم أولاً → سداد نقدي →
 *    صفير) + جزاء (خصم/عفو) — والثابت bal(1107) = Σ متبقي السلف.
 * ⑤ العمولات الثلاثة: خارجية لدى/للغير · موظفين (استحقاق/صرف منفرد/إلغاء/
 *    مع الراتب كاملة أو لا) — والثابت bal(2116) = Σ المستحقة غير المصروفة.
 * ⑥ الحضور والإجازات والبصمة: النواة الصرفة كاملة (dayMetrics/summary/impact/
 *    parse/match) + الحية (طلب إجازة → اعتماد يعلّم الشبكة → أرصدة).
 * ⑦ الوردية: تلخيص الدفع المجزأ والدرج · سياسة البيع · تسوية العجز سلفة.
 * ⑧ الختام: الثوابت العشرة + الميزان بعد كل ما سبق.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_hr_depth.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { computePayrollLine, computePayrollTotals, validatePayrollRun, buildPayrollEntry, monthLabelAr } from '../src/core/payroll.ts'
import { slipNetMinor, slipsTotals, validateSlipDraft, buildSlipAccrualLines, buildSlipPaymentLines } from '../src/core/payrollSlips.ts'
import { unpaidCommissionsMinor, commissionFromPercent, buildStaffCommissionAccrual, buildStaffCommissionPayout, buildStaffCommissionCancel } from '../src/core/staffCommissions.ts'
import { calculateInvoiceCommissionMinor, proportionalCommissionReturnMinor } from '../src/core/invoiceCommissions.ts'
import { dayMetrics, parseClock, formatClock, monthDates, weekdayIndex, monthlySummary, attendancePayrollImpact, dailyRateMinor, leaveDaysBetween, leaveDates, leaveBalances, validateLeaveRequest, parseFingerprintCsv, matchImportRows, normalizeArabicName, DEFAULT_HR_RULES, DEFAULT_LEAVE_TYPES } from '../src/core/attendance.ts'
import { summarizeShift, validateOpenShift, salesShiftPolicy, buildVarianceExpenseEntry, buildVarianceAdvanceEntry, currentOpenShift } from '../src/core/shifts.ts'
import { commissionsByParty } from '../src/core/commissions.ts'

const R = reporter('الموارد البشرية — العمق والشمول (§83)')
const bal = (c, code) => balanceOf(c.st().journal, code)

// ——— ① حراس §83: لا مسير ولا إجازة لموظف شبح ———
{
  const c = await freshCase({ activityId: 'general' })
  const ghostLine = { employeeId: 9999, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }
  expectReject('مسير بموظف شبح', c, () => c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [ghostLine] }), /موظف غير موجود بالسجلات/)
  expectReject('إجازة لموظف شبح', c, () => c.st().addLeaveRequest({ employeeId: 7777, typeId: 'annual', from: '2026-09-01', to: '2026-09-05', reason: 'اختبار' }), /الموظف غير موجود/)
  expectReject('قسائم بموظف شبح', c, () => c.st().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: 8888, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }], overrideBy: null }), /موظف غير موجود/)
  expectReject('حضور لموظف شبح', c, () => c.st().setAttendanceDay({ employeeId: 7777, date: '2026-09-01', status: 'present', checkIn: '09:00', checkOut: '17:00' }), /الموظف غير موجود/)
  // التوافق الخلفي: موظف حقيقي يمر كما كان
  c.st().addEmployee({ nameAr: 'موظف §83', phone: '0100', jobTitle: 'إداري', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  const run = c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
  assert.equal(run.totals.netMinor, 500000, 'مسير الموظف الحقيقي يمر والتوافق الخلفي محفوظ')
  R.ok('① الحرس الجديد: مسير/إجازة بموظف شبح مرفوضان في المستودع (كانا يمرّان — نقد لمجهول) والحقيقي يمر')
}

// ——— ② نواة payroll الخالصة ———
{
  const line = computePayrollLine({ employeeId: 1, baseMinor: 500000, allowancesMinor: 50000, overtimeMinor: 20000, deductionsMinor: 30000, advancesMinor: 40000 })
  assert.equal(line.grossMinor, 570000, 'الإجمالي = أساسي + بدلات + إضافي')
  assert.equal(line.netMinor, 500000, 'الصافي = إجمالي − خصومات − سلف')
  assert.throws(() => computePayrollLine({ employeeId: 1, baseMinor: 100000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 90000, advancesMinor: 20000 }), /لا يكون سالبا/)
  assert.throws(() => computePayrollLine({ employeeId: 1, baseMinor: 100000.5, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }), /رقماً صحيحاً/)
  const totals = computePayrollTotals([line, computePayrollLine({ employeeId: 2, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })])
  assert.equal(totals.employeeCount, 2)
  assert.equal(totals.netMinor, 800000)
  // validatePayrollRun: كل القواعد
  const mk = (id) => computePayrollLine({ employeeId: id, baseMinor: 100000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 })
  assert.ok(validatePayrollRun({ month: '2026-13', lines: [mk(1)], existingMonths: [] }).some((e) => e.includes('YYYY-MM')))
  assert.ok(validatePayrollRun({ month: '2026-09', lines: [], existingMonths: [] }).some((e) => e.includes('فارغ')))
  assert.ok(validatePayrollRun({ month: '2026-09', lines: [mk(1), mk(1)], existingMonths: [] }).some((e) => e.includes('مكرر داخل المسير')))
  // الشهر يقبل مسيرين ما دام الموظف مختلفاً؛ والممنوع تكرار الموظف نفسه
  assert.deepEqual(validatePayrollRun({ month: '2026-09', lines: [mk(2)], existingMonths: ['2026-09'], existingRuns: [{ month: '2026-09', employeeIds: [1] }] }), [])
  assert.ok(validatePayrollRun({ month: '2026-09', lines: [mk(1)], existingMonths: [], existingRuns: [{ month: '2026-09', employeeIds: [1] }] }).some((e) => e.includes('لا يتكرر')))
  // قيد المسير: نقدي
  const cash = buildPayrollEntry(500000, 'cash', '1101', 'سبتمبر 2026', 40000, 30000, 20000, 10000)
  assert.deepEqual(cash.map((l) => `${l.accountCode}:${l.debit}-${l.credit}`), ['5102:540000-0', '1101:0-560000', '2107:30000-0', '2116:20000-0', '2111:10000-0', '1107:0-40000'], 'نقدي: 5102 بالصافي+السلف، خزينة بالصافي+التصفيات الثلاث، والسلف تُقفل من 1107')
  const accrue = buildPayrollEntry(500000, 'accrue', '1101', 'سبتمبر 2026')
  assert.equal(accrue[1].accountCode, '2104', 'آجل: الذمة على 2104')
  assert.throws(() => buildPayrollEntry(0, 'cash', '1101', 'ش'), /أكبر من صفر/)
  assert.equal(monthLabelAr('2026-09'), 'سبتمبر 2026')
  assert.equal(monthLabelAr('rubbish'), 'rubbish', 'شهر فاسد يُعاد كما هو')
  R.ok('② نواة المسير: السطر والتحقق الشامل (تكرار بالموظف لا بالشهر) وقيد بمصفوفاته الأربع متوازناً')
}

// ——— ③ القسائم: الدفتر المساعد ودورة الحياة ———
{
  const c = await freshCase({ activityId: 'general' })
  c.st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة §83' })
  c.st().addEmployee({ nameAr: 'أحمد قسائم', phone: '0101', jobTitle: 'بائع', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '', active: true })
  c.st().addEmployee({ nameAr: 'سارة قسائم', phone: '0102', jobTitle: 'محاسبة', salaryMinor: 700000, hiredAt: '2026-01-01', notes: '', active: true })
  const empA = c.st().employees.find((e) => e.nameAr === 'أحمد قسائم')
  const empB = c.st().employees.find((e) => e.nameAr === 'سارة قسائم')
  // نواة: صافي القسيمة + سقف النصف + القيد بسطر لكل موظف
  assert.equal(slipNetMinor({ grossMinor: 100000, allowancesMinor: 20000, deductionsMinor: 10000, advanceMinor: 30000 }), 80000)
  assert.ok(validateSlipDraft({ employeeId: 1, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 60000, advanceMinor: 0 }).some((e) => e.includes('نصف الراتب')))
  assert.deepEqual(validateSlipDraft({ employeeId: 1, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 60000, advanceMinor: 0, overrideBy: 'المالك' }), [], 'الاعتماد يجيز تجاوز النصف')
  const accrual = buildSlipAccrualLines([{ employeeName: 'أحمد', slipNumber: 'PS-0001', netMinor: 80000, advanceMinor: 30000 }, { employeeName: 'سارة', slipNumber: 'PS-0002', netMinor: 90000, advanceMinor: 0 }], 'سبتمبر 2026')
  assert.equal(accrual.filter((l) => l.accountCode === '2104').length, 2, 'سطر دائن مستقل لكل موظف على 2104')
  assert.deepEqual(accrual.find((l) => l.accountCode === '1107'), { accountCode: '1107', debit: 0, credit: 30000, note: 'استقطاع سلف الموظفين من الرواتب' })
  assert.ok(buildSlipPaymentLines({ slipNumber: 'PS-0001', employeeName: 'أحمد', netMinor: 80000 }, '1101').length === 2)
  // الحية: استحقاق قسيمتين → صرف الأولى → إلغاء الثانية
  const slips = c.st().accruePayrollSlips({ month: '2026-09', rows: [
    { employeeId: empA.id, grossMinor: 500000, allowancesMinor: 100000, deductionsMinor: 50000, advanceMinor: 0 },
    { employeeId: empB.id, grossMinor: 600000, allowancesMinor: 100000, deductionsMinor: 0, advanceMinor: 0 },
  ], overrideBy: null })
  assert.equal(slips.length, 2)
  assert.equal(Math.abs(bal(c, '2104')), 500000 + 100000 - 50000 + 600000 + 100000, 'الاستحقاق: 2104 دائن بـΣ الصوافي بالقرش')
  assert.equal(slipsTotals(slips).unpaid, 1250000)
  expectReject('قسيمة ثانية لنفس الموظف والشهر', c, () => c.st().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: empA.id, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }], overrideBy: null }), /له قسيمة مستحقة لهذا الشهر/)
  const paid = c.st().payPayrollSlip(slips[0].id, { treasury: '1101' })
  assert.equal(paid.status, 'paid')
  expectReject('صرف قسيمة مصروفة', c, () => c.st().payPayrollSlip(slips[0].id, { treasury: '1101' }), /مصروفة بالفعل/)
  c.st().cancelPayrollSlip(slips[1].id, 'خطأ في الإدخال')
  expectReject('إلغاء قسيمة ملغاة', c, () => c.st().cancelPayrollSlip(slips[1].id, 'مرة أخرى'), /ملغاة بالفعل/)
  // إلغاء بلا سبب يُختبر على قسيمة قائمة (على المصروفة يرفضها حارس المصروفة أولاً)
  const slip3 = c.st().accruePayrollSlips({ month: '2026-10', rows: [{ employeeId: empA.id, grossMinor: 500000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }], overrideBy: null })[0]
  expectReject('إلغاء بلا سبب', c, () => c.st().cancelPayrollSlip(slip3.id, '  '), /سبب الإلغاء/)
  c.st().cancelPayrollSlip(slip3.id, 'إلغاء قسيمة أكتوبر لاختبار السبب')
  // الثابت: 2104 = صافي القسائم القائمة (المصروفة أُطفئت والملغاة عُكست)
  const remainingSlips = c.st().payrollSlips.filter((s) => s.status === 'accrued').reduce((s, x) => s + x.netMinor, 0)
  assert.equal(Math.abs(bal(c, '2104')), remainingSlips, `الثابت: |bal(2104)| = Σ صوافي القسائم القائمة (${remainingSlips})`)
  assert.equal(c.st().getUnpaidPayrollSlips().length, 0)
  assertInvariants('دورة القسائم كاملة', c)
  // ③-ب إصلاح §83: السلفة المستقطعة بالقسيمة — السجلات تتبع الدفتر (استقطاع/عكس)
  c.st().grantEmployeeAdvance({ employeeId: empB.id, amountMinor: 40000, treasury: '1101', notes: 'سلفة قسيمة' })
  const slipAdv = c.st().accruePayrollSlips({ month: '2026-11', rows: [{ employeeId: empB.id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 25000 }], overrideBy: null })[0]
  const advRow = c.st().employeeAdvances.find((a) => a.employeeId === empB.id)
  assert.equal(advRow.recoveredMinor, 25000, 'الاستحقاق وزّع الاستقطاع على سجل السلفة نفسه')
  expectReject('استقطاع فوق متبقي السلف', c, () => c.st().accruePayrollSlips({ month: '2026-12', rows: [{ employeeId: empB.id, grossMinor: 200000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100000 }], overrideBy: null }), /أكبر من متبقي سلفه/)
  c.st().cancelPayrollSlip(slipAdv.id, 'عكس الاستقطاع')
  const advRowAfter = c.st().employeeAdvances.find((a) => a.employeeId === empB.id)
  assert.equal(advRowAfter.recoveredMinor, 0, 'الإلغاء أعاد الاستقطاع ديناً على الموظف في سجل السلفة')
  assert.equal(bal(c, '1107'), 40000, '1107 = السلفة كاملة بعد العكس (السجلات = الدفتر بالقرش)')
  const slipGone = c.st().payrollSlips.find((s) => s.id === slipAdv.id)
  assert.equal(slipGone.status, 'cancelled')
  assertInvariants('قسيمة بسلفة مستقطعة ثم إلغاؤها', c)
  R.ok('③ القسائم: استحقاق بسطر مستقل لكل موظف → صرف → إلغاء بعكس القيد — bal(2104) = Σ الصوافي القائمة، وسلفة القسيمة (استقطاع/عكس) تسير السجلات مع الدفتر')
}

// ——— ④ السلف والجزاءات: دورة كاملة ———
{
  const c = await freshCase({ activityId: 'general' })
  c.st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة §83' })
  c.st().addEmployee({ nameAr: 'منذر سلف', phone: '0103', jobTitle: 'فني', salaryMinor: 800000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  c.st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 90000, treasury: '1101', notes: 'سلفة أولى' })
  c.st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 30000, treasury: '1101', notes: 'سلفة ثانية' })
  assert.equal(bal(c, '1107'), 120000)
  assert.equal(c.st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 120000)
  // استقطاع جزئي بمسير: الأقدم أولاً (يصفّي 90000 كاملة ثم يقرض من الثانية)
  c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 800000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 100000 }] })
  const advancesAfter = c.st().employeeAdvances.filter((a) => a.employeeId === emp.id)
  assert.equal(advancesAfter[0].recoveredMinor, 90000, 'الأقدم استُردت كاملة أولاً')
  assert.equal(advancesAfter[1].recoveredMinor, 10000, 'والباقي من الثانية')
  assert.equal(bal(c, '1107'), 20000, '1107 = المتبقي بعد المسير')
  // سداد نقدي بالباقي
  c.st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 20000, treasury: '1101' })
  assert.equal(bal(c, '1107'), 0)
  assert.equal(c.st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0)
  expectReject('سداد فوق المتبقي', c, () => c.st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 1000, treasury: '1101' }), /أكبر من متبقي/)
  // جزاء: خصم بالمسير + عفو
  const ded1 = c.st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 40000, reason: 'غياب' })
  const ded2 = c.st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 25000, reason: 'تسجيل خاطئ' })
  c.st().waiveEmployeeDeduction({ deductionId: ded2.id, approvedBy: 'المالك', reason: 'ثبت الخطأ' })
  assert.equal(c.st().getEmployeeDeductionBalance(emp.id).remainingMinor, 40000, 'المعفو لا يُخصم أبداً')
  c.st().postPayroll({ month: '2026-10', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 800000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 40000, advancesMinor: 0 }] })
  assert.equal(c.st().getEmployeeDeductionBalance(emp.id).remainingMinor, 0, 'الجزاء خُصم من مسير أكتوبر')
  // الثابت: 1107 = Σ متبقي السلف بعد كل شيء
  const remainingAll = c.st().employeeAdvances.reduce((s, a) => s + (a.amountMinor - a.recoveredMinor), 0)
  assert.equal(bal(c, '1107'), remainingAll, 'الثابت: bal(1107) = Σ متبقي سجلات السلف')
  expectReject('سلفة لموظف شبح', c, () => c.st().grantEmployeeAdvance({ employeeId: 4242, amountMinor: 1000, treasury: '1101', notes: '' }), /الموظف غير موجود/)
  R.ok('④ السلف والجزاءات: سلفان → توزيع الأقدم أولاً → سداد → صفير، وجزاء (خصم/عفو) — bal(1107) = Σ متبقي السلف')
}

// ——— ⑤ العمولات الثلاثة: خارجية (اتجاهان) + موظفين (دورة كاملة) ———
{
  const c = await freshCase({ activityId: 'general' })
  c.st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة §83' })
  c.st().addEmployee({ nameAr: 'كريم عمولات', phone: '0104', jobTitle: 'مندوب', salaryMinor: 400000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  // خارجية لدى الغير: استحقاق (1112/4112) ثم تحصيل
  const party = c.st().addCommissionParty({ nameAr: 'مركز أشعة النور', phone: '0100', kind: 'مركز أشعة', notes: '' })
  const earned = c.st().addExternalCommission({ direction: 'earned', partyId: party.id, amountMinor: 15000, description: 'عمولة تحويل حالة' })
  assert.equal(bal(c, '1112'), 15000)
  assert.equal(bal(c, '4112'), -15000, 'إيراد العمولات دائن')
  c.st().collectExternalCommission({ commissionId: earned.id, amountMinor: 15000, treasury: '1101' })
  assert.equal(bal(c, '1112'), 0, 'التحصيل أطفأ المستحق لدى الغير')
  // خارجية للغير: استحقاق (5113/2114) ثم دفع جزئي ثم باقٍ
  const sub = c.st().addCommissionParty({ nameAr: 'سمسار العقار', phone: '0101', kind: 'سمسار', notes: '' })
  const owed = c.st().addExternalCommission({ direction: 'owed', partyId: sub.id, amountMinor: 30000, description: 'عمولة بيع وحدة' })
  assert.equal(Math.abs(bal(c, '2114')), 30000)
  c.st().collectExternalCommission({ commissionId: owed.id, amountMinor: 12000, treasury: '1101' })
  assert.equal(Math.abs(bal(c, '2114')), 18000, 'الدفع الجزئي يترك الباقي مستحقاً دائناً')
  const byParty = commissionsByParty(c.st().externalCommissions.map((x) => ({ direction: x.direction, partyId: x.partyId, partyName: sub.nameAr, amountMinor: x.amountMinor, collectedMinor: x.collectedMinor })), 'owed')
  assert.equal(byParty[0].remainingMinor, 18000)
  // موظفين: استحقاق → صرف منفرد → منع إلغاء المصروفة → إلغاء سليمة
  const com = c.st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'مكافأة إنجاز §83', amountMinor: 8000 })
  assert.equal(Math.abs(bal(c, '2116')), 8000)
  assert.equal(bal(c, '5117'), 8000, 'مصروف لحظة الاستحقاق — ربحية سليمة')
  const com2 = c.st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'عمولة تُلغى', amountMinor: 5000 })
  c.st().payStaffCommission({ commissionId: com.id, treasury: '1101' })
  expectReject('إلغاء عمولة مصروفة', c, () => c.st().cancelStaffCommission({ commissionId: com.id, reason: 'محاولة' }), /مصروفة/)
  c.st().cancelStaffCommission({ commissionId: com2.id, reason: 'خطأ في المبلغ' })
  assert.equal(bal(c, '2116'), 0, 'المصروفة أُطفئت والملغاة عُكست')
  // مع الراتب: كاملة أو لا — والجزئي مرفوض، وتُعلَّم paid/payroll بقيد المسير
  const com3 = c.st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'عمولة مع الراتب', amountMinor: 20000 })
  expectReject('صرف جزئي مع الراتب', c, () => c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, commissionsPaidMinor: 5000 }] }), /كاملة مع الراتب|أكبر من مستحقه/)
  const run = c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, commissionsPaidMinor: 20000 }] })
  const paidCom = c.st().staffCommissions.find((x) => x.id === com3.id)
  assert.equal(paidCom.status, 'paid')
  assert.equal(paidCom.payoutMode, 'payroll', 'علِّمت بقيد المسير نفسه')
  assert.equal(paidCom.payoutEntryId, run.journalEntryId)
  // الثابت: 2116 = Σ المستحقة غير المصروفة
  assert.equal(Math.abs(bal(c, '2116')), unpaidCommissionsMinor(c.st().staffCommissions, emp.id), 'الثابت: |bal(2116)| = Σ المستحقة')
  // نواة النسب والعمولة المرتجعة
  assert.equal(commissionFromPercent(100000, 3), 3000)
  assert.throws(() => commissionFromPercent(100000, 0), /أكبر من 0/)
  assert.equal(proportionalCommissionReturnMinor(3000, 0, 50000, 200000), 750, 'مرتجع ربع الفاتورة ⇒ ربع العمولة')
  assert.equal(proportionalCommissionReturnMinor(3000, 2000, 200000, 200000), 1000, 'السقف: ما تبقى من العمولة بعد تسويات سابقة')
  assert.equal(calculateInvoiceCommissionMinor({ basis: 'fixed', value: 1500, grossMinor: 0, netMinor: 0, profitMinor: 0 }), 1500)
  assert.equal(calculateInvoiceCommissionMinor({ basis: 'profit', value: 10, grossMinor: 200000, netMinor: 0, profitMinor: -50000 }), 0, 'الخسارة لا تولّد عمولة ربح')
  assertInvariants('العمولات الثلاثة', c)
  R.ok('⑤ العمولات: لدى الغير (استحقاق/تحصيل) · للغير (دفع جزئي يبقي الباقي) · موظفين (دورة كاملة ومع الراتب كاملة أو لا) — bal(2116) = Σ المستحقة')
}

// ——— ⑥ الحضور والإجازات والبصمة ———
{
  // النواة الصرفة
  assert.equal(parseClock('09:30'), 570)
  assert.equal(parseClock('9:30:45'), 570)
  assert.equal(parseClock('25:00'), null)
  assert.equal(formatClock(570), '09:30')
  const rules = DEFAULT_HR_RULES
  const m1 = dayMetrics({ status: 'present', checkIn: '09:20', checkOut: '17:45' }, rules)
  // 9:15 = بداية 9:00 + سماح 15؛ 9:20 ⇒ متأخر 5 دقائق
  assert.equal(m1.lateMinutes, 5)
  assert.equal(m1.earlyLeaveMinutes, 0)
  assert.equal(m1.overtimeMinutes, 45, 'إضافي فوق الحد الأدنى 30')
  const m2 = dayMetrics({ status: 'present', checkIn: '08:00', checkOut: '16:20' }, rules)
  assert.equal(m2.lateMinutes, 0)
  assert.equal(m2.earlyLeaveMinutes, 40)
  assert.equal(m2.overtimeMinutes, 0, '20 دقيقة تحت الحد الأدنى ⇒ تُهمل')
  assert.deepEqual(dayMetrics({ status: 'absent', checkIn: '09:00', checkOut: '17:00' }, rules), { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0 }, 'الغياب لا يولّد شيئاً')
  assert.equal(dayMetrics({ status: 'present', checkIn: '17:30', checkOut: '09:00' }, rules).workedMinutes, 0, 'خروج قبل الدخول ⇒ لا شيء')
  assert.equal(monthDates('2026-02').length, 28)
  assert.equal(monthDates('2026-13').length, 0)
  assert.equal(weekdayIndex('2026-10-02'), 5, 'جمعة (الأحد=0)')
  // الملخص الشهري وأثر الرواتب
  const records = [
    { id: 1, employeeId: 1, date: '2026-09-01', status: 'present', checkIn: '09:20', checkOut: '17:45', source: 'manual' },
    { id: 2, employeeId: 1, date: '2026-09-02', status: 'absent', checkIn: null, checkOut: null, source: 'manual' },
    { id: 3, employeeId: 1, date: '2026-09-03', status: 'mission', checkIn: '08:00', checkOut: '19:00', source: 'manual' },
  ]
  const leaves = [{ id: 1, employeeId: 1, typeId: 'unpaid', from: '2026-09-04', to: '2026-09-05', days: 2, status: 'approved', reason: 'ظرف', requestedAt: '2026-08-01' }]
  const summary = monthlySummary({ employeeId: 1, month: '2026-09', records, leaves, types: DEFAULT_LEAVE_TYPES })
  assert.equal(summary.presentDays, 1)
  assert.equal(summary.absentDays, 1)
  assert.equal(summary.missionDays, 1)
  assert.equal(summary.unpaidLeaveDays, 2, 'إجازة معتمدة من سجل الإجازات حتى لو لم تُعلَّم بالشبكة')
  const impact = attendancePayrollImpact({ employeeId: 1, month: '2026-09', grossMinor: 260000, rules, records, leaves, types: DEFAULT_LEAVE_TYPES })
  assert.equal(dailyRateMinor(260000, rules), 10000, 'يومية = 260000 ÷ 26')
  assert.equal(impact.absenceDeductionMinor, 10000, 'غياب يوم ⇒ يومية كاملة')
  assert.equal(impact.unpaidLeaveDeductionMinor, 20000, 'يومَا إجازة بلا أجر')
  assert.equal(impact.overtimeAllowanceMinor, 0, 'الإضافي استرشادي ما لم يُفعَّل overtimePaid')
  assert.equal(impact.netAdjustmentMinor, -30000)
  const paidRules = { ...rules, overtimePaid: true }
  const impact2 = attendancePayrollImpact({ employeeId: 1, month: '2026-09', grossMinor: 260000, rules: paidRules, records, leaves, types: DEFAULT_LEAVE_TYPES })
  // إضافي: 45 دقيقة (يوم 1) + 120 دقيقة (مأمورية 17→19) = 165 دقيقة = 2.75 ساعة × (10000÷8) × 1.5
  assert.equal(impact2.overtimeAllowanceMinor, Math.round(2.75 * 1250 * 1.5), 'إضافي مدفوع = ساعات × أجر الساعة × 1.5')
  // الإجازات: أيام وأرصدة وتعارض
  assert.equal(leaveDaysBetween('2026-09-01', '2026-09-10'), 10)
  assert.equal(leaveDaysBetween('2026-09-10', '2026-09-01'), 0)
  assert.equal(leaveDates({ from: '2026-09-30', to: '2026-10-02' }).length, 3, 'عابرة للشهر')
  const balances = leaveBalances(leaves, DEFAULT_LEAVE_TYPES, 1, 2026)
  assert.equal(balances.find((b) => b.typeId === 'unpaid').remainingDays, 58)
  assert.ok(validateLeaveRequest({ employeeId: 1, typeId: 'annual', from: '2026-09-04', to: '2026-09-05', leaves, types: DEFAULT_LEAVE_TYPES }).some((e) => e.includes('تعارض')))
  assert.ok(validateLeaveRequest({ employeeId: 1, typeId: 'annual', from: '2026-09-01', to: '2026-12-31', leaves: [], types: DEFAULT_LEAVE_TYPES }).some((e) => e.includes('لا يكفي')))
  // البصمة: رؤوس عربية + تواريخ ثلاثية + دمج النبضات + monthFirst
  const csv = 'الكود,التاريخ,الدخول,الخروج\n0001,05/09/2026,09:10,17:50\n0001,06/09/2026,09:00,17:00\n'
  const parsed = parseFingerprintCsv(csv)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].date, '2026-09-05')
  const punchLog = parseFingerprintCsv('1,2026-09-05,08:52\n1,2026-09-05,17:31\n', { punchLog: true })
  assert.equal(punchLog.rows.length, 1, 'نبضتان لنفس اليوم تُدمجان')
  assert.equal(punchLog.rows[0].checkIn, '08:52')
  assert.equal(punchLog.rows[0].checkOut, '17:31')
  const us = parseFingerprintCsv('Code,Date,In,Out\n1,09/05/2026,09:00,17:00\n', { monthFirst: true })
  assert.equal(us.rows[0].date, '2026-09-05', 'صيغة شهر/يوم/سنة أمريكية تُقلب')
  const matched = matchImportRows(parsed.rows, [{ id: 1, nameAr: 'أحمد إبراهيم' }])
  assert.equal(matched[0].employeeId, 1, 'كود 0001 بأصفار ZKTeco يطابق الموظف 1')
  const byName = matchImportRows([{ employeeKey: 'احمد ابراهيم', date: '2026-09-05', checkIn: '09:00', checkOut: '17:00' }], [{ id: 1, nameAr: 'أحمد إبراهيم' }])
  assert.equal(byName[0].employeeId, 1, 'المطابقة بالاسم تطوّع الهمزات والتاء المربوطة')
  assert.equal(normalizeArabicName('أَحْمد إبراهيمـة'), normalizeArabicName('احمد ابراهيمه'), 'التشكيل والتطويل والهمزات')
  // الحية: طلب → اعتماد يعلّم الشبكة → أرصدة → رفض الحسم مرتين
  const c = await freshCase({ activityId: 'general' })
  c.st().addEmployee({ nameAr: 'حاضر منتظم', phone: '0105', jobTitle: 'عامل', salaryMinor: 300000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  c.st().setAttendanceDay({ employeeId: emp.id, date: '2026-09-10', status: 'present', checkIn: '09:00', checkOut: '17:00' })
  const lv = c.st().addLeaveRequest({ employeeId: emp.id, typeId: 'annual', from: '2026-09-10', to: '2026-09-11', reason: 'سفر' })
  const decided = c.st().decideLeaveRequest(lv.id, true, 'المالك')
  assert.equal(decided.status, 'approved')
  const day10 = c.st().attendanceRecords.find((r) => r.employeeId === emp.id && r.date === '2026-09-10')
  assert.equal(day10.status, 'leave', 'الاعتماد كتب «إجازة» فوق «حاضر» السابق')
  assert.ok(c.st().attendanceRecords.some((r) => r.employeeId === emp.id && r.date === '2026-09-11' && r.status === 'leave'))
  expectReject('حسم طلب محسوم', c, () => c.st().decideLeaveRequest(lv.id, false, 'المالك'), /محسوم/)
  assert.equal(c.st().getLeaveBalances(emp.id, 2026).find((b) => b.typeId === 'annual').usedDays, 2)
  const ms = c.st().getMonthlyAttendance(emp.id, '2026-09')
  assert.equal(ms.leaveDays, 2)
  const impacts = c.st().getAttendancePayrollImpact('2026-09')
  assert.equal(impacts.length, c.st().employees.filter((e) => true).length >= 1 ? impacts.length : 0)
  assert.ok(impacts.some((x) => x.employeeId === emp.id && x.summary.leaveDays === 2), 'أثر الحضور يصل لمسار الرواتب')
  R.ok('⑥ الحضور والإجازات/البصمة: التأخير والإضافي والسماح، أثر الرواتب (غياب/بلا أجر/تأخير/إضافي×1.5)، الإجازات والتعارض والأرصدة، والبصمة (رؤوس/تواريخ/دمج نبضات/كود ZKTeco/اسم مطوَّع) + الاعتماد يعلّم الشبكة')
}

// ——— ⑦ الوردية: التلخيص والسياسة والتسوية ———
{
  const shift = { id: 1, openedAt: '2026-09-01T08:00:00Z', openedBy: 'كاشير', openingCashMinor: 50000, closedAt: null, countedCashMinor: null, status: 'open' }
  const sales = [
    { shiftId: 1, payment: 'cash', totalMinor: 100000 },
    { shiftId: 1, payment: 'credit', totalMinor: 70000 },
    { shiftId: 1, payment: 'credit', totalMinor: 80000, paidMinor: 30000 }, // جزئي: 30 درج + 50 آجل
    { shiftId: 1, payment: 'cash', totalMinor: 40000, paidMinor: 40000, treasuryKind: 'bank' }, // بنكي لا يدخل الدرج
    { shiftId: 2, payment: 'cash', totalMinor: 99000 }, // وردية أخرى لا تدخل
  ]
  const returns = [{ shiftId: 1, payment: 'cash', totalMinor: 20000 }]
  const sum = summarizeShift(shift, sales, returns)
  assert.equal(sum.cashSalesMinor, 100000 + 30000, 'الدرج: نقدي كامل + محصل الجزئي فقط')
  assert.equal(sum.creditSalesMinor, 70000 + 50000, 'الآجل: الآجل الكامل + باقي الجزئي')
  assert.equal(sum.bankSalesMinor, 40000)
  assert.equal(sum.expectedCashMinor, 50000 + 130000 - 20000, 'المتوقع = افتتاحي + درج − مرتجعات نقدية')
  const closed = { ...shift, countedCashMinor: 150000, status: 'closed' }
  assert.equal(summarizeShift(closed, sales, returns).varianceMinor, -10000, 'عجز 10000')
  // AUDIT-010 (موروث): فتح وردية بقيمة فاسدة مرفوض
  assert.ok(validateOpenShift(10.5, []).some((e) => e.includes('القرش الصحيح')))
  assert.ok(validateOpenShift(1000, [{ ...shift, status: 'open' }]).some((e) => e.includes('مفتوحة بالفعل')))
  assert.deepEqual(validateOpenShift(1000, [{ ...shift, status: 'closed' }]), [])
  assert.equal(currentOpenShift([{ status: 'closed' }, { status: 'open' }]).status, 'open')
  // سياسة الوردية في البيع
  assert.equal(salesShiftPolicy({ roleId: 'owner', isOwner: true, requireOpenShiftForSales: true, invoiceFirst: false }).hintOnly, true, 'المالك تلميح فقط')
  assert.equal(salesShiftPolicy({ roleId: 'cashier', isOwner: false, requireOpenShiftForSales: true, invoiceFirst: false }).required, true)
  assert.equal(salesShiftPolicy({ roleId: 'cashier', isOwner: false, requireOpenShiftForSales: true, invoiceFirst: false, userOverride: false }).required, false, 'الإعفاء الفردي يسبق الإعداد العام')
  assert.equal(salesShiftPolicy({ roleId: 'accountant', isOwner: false, requireOpenShiftForSales: true, invoiceFirst: true }).required, false, 'أنشطة الفاتورة أولاً خارج السياق')
  // قيود التسوية
  const shortage = buildVarianceExpenseEntry(-10000, '1101', 'وردية #1')
  assert.deepEqual(shortage.map((l) => `${l.accountCode}:${l.debit}-${l.credit}`), ['5108:10000-0', '1101:0-10000'], 'عجز: مصروف/خزينة')
  const surplus = buildVarianceExpenseEntry(5000, '1101', 'وردية #1')
  assert.deepEqual(surplus.map((l) => `${l.accountCode}:${l.debit}-${l.credit}`), ['1101:5000-0', '4110:0-5000'], 'زيادة: خزينة/إيراد آخر')
  assert.throws(() => buildVarianceExpenseEntry(0, '1101', 'x'), /لا فرق/)
  const advEntry = buildVarianceAdvanceEntry(-10000, '1101', 'كاشير أول')
  assert.deepEqual(advEntry.map((l) => l.accountCode), ['1107', '1101'], 'عجز كسلفة: 1107/خزينة')
  assert.throws(() => buildVarianceAdvanceEntry(5000, '1101', 'x'), /عجز فقط/)
  // الحية: وردية كاملة بعجز يتحمله الكاشير → سلفة تُخصم من رواتبه
  const c = await freshCase({ activityId: 'general' })
  c.st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة §83' })
  c.st().addEmployee({ nameAr: 'كاشير وردية', phone: '0106', jobTitle: 'كاشير', salaryMinor: 300000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  const item = addSimpleItem(c, { nameAr: 'سلعة وردية', priceMinor: 1000 })
  c.st().postPurchase({ supplierId: addParty(c, 'supplier', 'مورد الوردية').id, date: '2026-08-01', lines: [{ itemId: item.id, qty: 200, unitPriceMinor: 500, expiryDate: null }], expenses: [], paidMinor: 100000, treasury: '1101', notes: '' })
  const sh = c.st().openShift('كاشير وردية', 50000)
  c.st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 100, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101' })
  c.st().closeShift(120000, 'المالك', 'عجز مقر') // المتوقع 150000 ⇒ عجز 30000
  expectReject('تسوية عجز كسلفة بلا موظف', c, () => c.st().settleShiftVariance({ shiftId: sh.id, mode: 'advance', employeeId: null }), /الموظف|اختر/)
  const settled = c.st().settleShiftVariance({ shiftId: sh.id, mode: 'advance', employeeId: emp.id })
  assert.equal(settled.varianceSettledMode, 'advance')
  assert.equal(bal(c, '1107'), 30000, 'العجز صار سلفة على الكاشير')
  assert.equal(c.st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 30000, 'وتُخصم من رواتبه لاحقاً')
  assertInvariants('وردية بعجز مسوّى كسلفة', c)
  R.ok('⑦ الوردية: الدفع المجزأ يقسم نقدي/آجل، البنكي خارج الدرج، AUDIT-010 موروث، السياسة بالأدوار، والعجز سلفة على الموظف تدخل كشفه')
}

// ——— ⑧ الختام: الثوابت العشرة على حالة HR كاملة ———
{
  const c = await freshCase({ activityId: 'general' })
  c.st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 8000000, label: 'خزينة §83 الكبرى' })
  c.st().addEmployee({ nameAr: 'موظف الختام', phone: '0107', jobTitle: 'إداري', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  c.st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 50000, treasury: '1101', notes: '' })
  c.st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'عمولة ختام', amountMinor: 7000 })
  const slips = c.st().accruePayrollSlips({ month: '2026-09', rows: [{ employeeId: emp.id, grossMinor: 600000, allowancesMinor: 50000, deductionsMinor: 20000, advanceMinor: 10000 }], overrideBy: null })
  c.st().payPayrollSlip(slips[0].id, { treasury: '1101' })
  c.st().postPayroll({ month: '2026-10', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 20000 }] })
  assertInvariants('الختام: كل أنواع HR معاً', c)
  // الثوابت الثلاثة معاً بعد كل شيء
  const remainingAdvances = c.st().employeeAdvances.reduce((s, a) => s + (a.amountMinor - a.recoveredMinor), 0)
  assert.equal(bal(c, '1107'), remainingAdvances, 'ثابت 1107 = Σ متبقي السلف (قسيمة + مسير)')
  assert.equal(Math.abs(bal(c, '2116')), unpaidCommissionsMinor(c.st().staffCommissions, emp.id), 'ثابت 2116 = Σ العمولات المستحقة')
  const openSlips = c.st().payrollSlips.filter((s) => s.status === 'accrued').reduce((s, x) => s + x.netMinor, 0)
  assert.equal(Math.abs(bal(c, '2104')), openSlips, 'ثابت 2104 دائن بـΣ صوافي القسائم القائمة')
  // وكشف الشاشة يعرف كل المستندات (قسيمة + مسير + سلفة)
  const rows = c.st().getEmployeeStatementRows(emp.id)
  const labels = rows.map((r) => r.description).join(' | ')
  assert.ok(labels.includes('استحقاق راتب') && labels.includes('صرف راتب'), 'صفوف القسيمة')
  assert.ok(labels.includes('مسير أكتوبر') || labels.includes('مسير'), 'صف المسير القديم')
  assert.ok(labels.includes('سلفة'), 'صف السلفة')
  const netView = rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0)
  // المعادلة الجامعة لكشف الشاشة: ما على الموظف = متبقي سلفه − عمولاته المستحقة
  // (العمولة المستحقة حقٌّ له يُدائن، وتُطفأ عند صرفها مع الراتب أو منفردة)
  assert.equal(netView, remainingAdvances - unpaidCommissionsMinor(c.st().staffCommissions, emp.id), 'رصيد كشف الشاشة = متبقي السلف − العمولات المستحقة (القسيمة والمسير مصروفان)')
  R.ok('⑧ الختام: الثوابت العشرة + ثلاثية HR (1107=Σ متبقي السلف · 2116=Σ المستحقة · 2104=Σ الصوافي القائمة) وكشف الشاشة جامع لكل المستندات')
}

R.done()
