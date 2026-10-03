/* بوابة الحضور والموارد البشرية (طلب المالك ㉘): قواعد الوردية + الأثر على الرواتب + حرس المخزن */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants } from './auditKit.mjs'
import { readFileSync } from 'node:fs'
import {
  attendancePayrollImpact, dayMetrics, DEFAULT_HR_RULES, DEFAULT_LEAVE_TYPES,
  monthlySummary, normalizeHrRules, parseClock, monthDates,
} from '../src/core/attendance.ts'

const R = reporter('الحضور — قواعد الوردية والأثر على الرواتب')
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
const employeesPage = readFileSync(new URL('../src/ui/pages/EmployeesPage.tsx', import.meta.url), 'utf8')
const hrPage = readFileSync(new URL('../src/ui/pages/HrPage.tsx', import.meta.url), 'utf8')

/* ① قواعد الوردية: تأخير/إضافي من check-in/out مقابل ساعات الوردية 09:00–17:00 بسمح 15 دقيقة */
{
  const rules = DEFAULT_HR_RULES
  assert.equal(rules.shift.startMin, 540, 'الوردية الافتراضية تبدأ 09:00')
  assert.equal(parseClock('09:00'), 540, 'parseClock يحوّل 09:00 إلى 540 دقيقة')
  const onTime = dayMetrics({ status: 'present', checkIn: '09:00', checkOut: '17:00' }, rules)
  assert.equal(onTime.lateMinutes, 0, 'حضور بالموعد بلا تأخير')
  assert.equal(onTime.overtimeMinutes, 0, 'انصراف بالموعد بلا إضافي')
  const grace = dayMetrics({ status: 'present', checkIn: '09:10', checkOut: '17:00' }, rules)
  assert.equal(grace.lateMinutes, 0, 'التأخير داخل سماح 15 دقيقة لا يُحسب')
  const late = dayMetrics({ status: 'present', checkIn: '09:40', checkOut: '17:00' }, rules)
  assert.equal(late.lateMinutes, 25, 'التأخير فوق السماح يُحسب صافياً')
  const extra = dayMetrics({ status: 'present', checkIn: '09:00', checkOut: '19:30' }, rules)
  assert.equal(extra.overtimeMinutes, 150, 'الإضافي بعد نهاية الوردية فقط (وبما يزيد عن الحد الأدنى)')
  const tinyExtra = dayMetrics({ status: 'present', checkIn: '09:00', checkOut: '17:20' }, rules)
  assert.equal(tinyExtra.overtimeMinutes, 0, 'إضافي أقل من الحد الأدنى (30 د) يُهمل')
  const absent = dayMetrics({ status: 'absent', checkIn: '09:00', checkOut: '17:00' }, rules)
  assert.equal(absent.lateMinutes + absent.overtimeMinutes, 0, 'الغياب لا يولّد تأخيراً ولا إضافياً')
  R.ok('dayMetrics: سماح 15 دقيقة، إضافي ≥30 دقيقة، والغياب بلا أثر')
}

/* ② الأثر على الرواتب: خصومات = غياب + إجازة بلا أجر + تأخير، وبدل الإضافي يُضاف */
{
  const rules = normalizeHrRules({ ...DEFAULT_HR_RULES, latePerMinutes: 30, lateAmountMinor: 2000, absenceMode: 'daily', overtimePaid: true })
  const records = [
    { id: 1, employeeId: 7, date: '2026-09-01', status: 'absent', checkIn: null, checkOut: null, source: 'manual', importBatch: null, notes: null },
    { id: 2, employeeId: 7, date: '2026-09-02', status: 'present', checkIn: '09:45', checkOut: '17:00', source: 'manual', importBatch: null, notes: null },
    { id: 3, employeeId: 7, date: '2026-09-03', status: 'present', checkIn: '09:00', checkOut: '18:00', source: 'manual', importBatch: null, notes: null },
  ]
  const leaves = [{ id: 1, employeeId: 7, typeId: 'unpaid', from: '2026-09-05', to: '2026-09-05', days: 1, status: 'approved', reason: 'ظرف', requestedAt: '2026-09-01' }]
  const impact = attendancePayrollImpact({ employeeId: 7, month: '2026-09', grossMinor: 900000, rules, records, leaves, types: DEFAULT_LEAVE_TYPES })
  assert.equal(impact.summary.absentDays, 1, 'يوم غياب واحد')
  assert.equal(impact.summary.unpaidLeaveDays, 1, 'يوم إجازة بلا أجر')
  const dayRate = Math.round(900000 / rules.workingDaysPerMonth)
  assert.equal(impact.absenceDeductionMinor, dayRate, 'خصم الغياب باليومية الكاملة')
  assert.equal(impact.unpaidLeaveDeductionMinor, dayRate, 'خصم الإجازة بلا أجر باليومية')
  assert.equal(impact.lateDeductionMinor, 2000, 'خصم التأخير: 30 دقيقة فوق السماح ⇒ حصة واحدة')
  assert.ok(impact.overtimeAllowanceMinor > 0, 'بدل الإضافي يجب أن يُقترح عند تفعيله')
  const deductions = impact.absenceDeductionMinor + impact.unpaidLeaveDeductionMinor + impact.lateDeductionMinor
  assert.equal(impact.netAdjustmentMinor, impact.overtimeAllowanceMinor - deductions, 'الصافي = الإضافي − الخصومات الثلاثة')
  assert.ok(impact.notes.some((n) => n.includes('غياب')), 'ملاحظات الأثر بلا ذكر الغياب')
  R.ok('attendancePayrollImpact: صافي التعديل = بدل إضافي − (غياب + إجازة بلا أجر + تأخير)')
}

/* ③ monthlySummary لا يسرّب سجلات موظف آخر ولا أياماً خارج الشهر */
{
  const records = [
    { id: 1, employeeId: 1, date: '2026-09-10', status: 'present', checkIn: '09:00', checkOut: '17:00', source: 'manual', importBatch: null, notes: null },
    { id: 2, employeeId: 2, date: '2026-09-10', status: 'absent', checkIn: null, checkOut: null, source: 'manual', importBatch: null, notes: null },
    { id: 3, employeeId: 1, date: '2026-08-10', status: 'absent', checkIn: null, checkOut: null, source: 'manual', importBatch: null, notes: null },
  ]
  const summary = monthlySummary({ employeeId: 1, month: '2026-09', records, leaves: [], types: DEFAULT_LEAVE_TYPES })
  assert.equal(summary.absentDays, 0, 'غياب موظف آخر أو شهر آخر لا يُحتسب')
  assert.equal(summary.recordedDays, 1, 'يوم واحد فقط داخل الشهر للموظف')
  assert.ok(monthDates('2026-09').length >= 28, 'شهر سبتمبر كامل الأيام')
  R.ok('monthlySummary: عزل الموظف والشهر')
}

/* ④ المخزن: بصم يدوي بمصدر manual يستبدل نفس اليوم، وإجازات، وزر احتساب في الشاشة */
{
  assert.ok(/attendanceRecords: \[\]/.test(repo), 'لا جدول بصمات في المخزن')
  assert.ok(/setAttendanceDay: \(args\)/.test(repo) && /source: 'manual' as const/.test(repo), 'البصم اليدوي ناقص أو بلا مصدر manual')
  assert.ok(/clearAttendanceDay: \(employeeId, date\)/.test(repo), 'مسح بصمة اليوم ناقص')
  assert.ok(/addLeaveRequest/.test(repo) && /deleteLeaveRequest/.test(repo), 'طلبات الإجازات ناقصة في المخزن')
  assert.ok(/data-apply-attendance/.test(employeesPage), 'زر «احتساب من الحضور» مفقود من مودال القسيمة')
  assert.ok(/getAttendancePayrollImpact/.test(repo) && /getAttendancePayrollImpact/.test(employeesPage), 'الشاشة لا تستخدم محرك أثر الحضور')
  assert.ok(/absenceDeductionMinor \+ impact\.unpaidLeaveDeductionMinor \+ impact\.lateDeductionMinor/.test(employeesPage), 'الخصومات لا تجمع غياب+إجازة+تأخير')
  assert.ok(/impact\.overtimeAllowanceMinor/.test(employeesPage), 'بدل الإضافي لا يُضاف إلى البدلات')
  assert.ok(/attendanceRecords/.test(hrPage), 'شاشة الحضور غير مربوطة بسجل البصمات')
  R.ok('المخزن: setAttendanceDay/clearAttendanceDay + إجازات + زر احتساب داخل مسودة القسيمة')
}

/* ⑤ رحلة متكاملة على متجر نظيف: بصم يدوي ثم مسحه بلا كسر ثوابت */
{
  const c = await freshCase({ activityId: 'grocery' })
  c.store.getState().addEmployee({ nameAr: 'عامل الحضور', phone: '', jobTitle: 'بائع', hireDate: '2026-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true, notes: '' })
  const employeeId = c.store.getState().employees[0]?.id ?? 1
  c.store.getState().setAttendanceDay({ employeeId, date: '2026-09-10', status: 'present', checkIn: '09:00', checkOut: '17:30' })
  assert.ok(c.store.getState().attendanceRecords.some((r) => r.employeeId === employeeId && r.date === '2026-09-10'), 'البصمة لم تُخزَّن')
  /* نفس اليوم مرة أخرى ⇒ استبدال لا تكرار */
  c.store.getState().setAttendanceDay({ employeeId, date: '2026-09-10', status: 'absent' })
  const same = c.store.getState().attendanceRecords.filter((r) => r.employeeId === employeeId && r.date === '2026-09-10')
  assert.equal(same.length, 1, 'بصمة اليوم نفسه تُكرَّر بدل أن تُستبدل')
  assert.equal(same[0].status, 'absent', 'الاستبدال لم يعتمد الحالة الأحدث')
  c.store.getState().clearAttendanceDay(employeeId, '2026-09-10')
  assert.ok(!c.store.getState().attendanceRecords.some((r) => r.date === '2026-09-10'), 'مسح بصمة اليوم لا يعمل')
  assertInvariants('بعد بصم ومسح حضور', c)
  R.ok('رحلة المتجر النظيف: بصم ← استبدال ← مسح، والثوابت العشرة سليمة')
}

R.done()
