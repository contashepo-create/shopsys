/**
 * بوابة جولة المالك — جسور الحضور السبعة (البند ② من أمر «اكمل ونفذ» 2026-10-01،
 * بموافقة المالك على القائمة المعروضة):
 * ① وردية الموظف الفردية تُحترم في مسار الرواتب (getAttendancePayrollImpact)
 *    كما تحترمها شاشة HR — كان التناقض: مسائي يُحتسب تأخيره على وردية المنشأة.
 * ② بطاقة «حضور اليوم» في لوحة التحكم (حاضر/متأخر/إجازة/غياب/بلا تسجيل).
 * ③ مركز التنبيهات الموحد يستقبل: طلبات إجازة معلقة + غياب اليوم بلا إجازة.
 * ④ ملخص حضور الشهر وأثره المالي داخل كشف حساب الموظف الموحد.
 * ⑤ حارس المسير: تحذير صريح بالأسماء قبل ترحيل مسير شهرٍ بلا سجلات حضور.
 * ⑥+⑦ كشف الحضور الشهري: عمود «صافي الأثر» في الجدول والطباعة والتصدير
 *    (التقرير المالي والطباعة كانا موجودين من دفعة ㉘ — أُكمل عمود الصافي).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_hr_bridges.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshCase } from './auditKit.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

const repo = read('data/repo.ts')
const alertsCore = read('core/alerts.ts')
const dashboard = read('ui/pages/Dashboard.tsx')
const employees = read('ui/pages/EmployeesPage.tsx')
const hr = read('ui/pages/HrPage.tsx')

console.log('① وردية الموظف الفردية في مسار الرواتب (المصدر)')
{
  assert.ok(/rules: \{ \.\.\.state\.hrRules, shift: state\.employeeShifts\.find\(\(s\) => s\.employeeId === employee\.id\) \?\? state\.hrRules\.shift \}/.test(repo),
    'getAttendancePayrollImpact ما زال يحتسب على وردية المنشأة للجميع — تناقض شاشة HR مع الرواتب')
  ok('المخزن يحل وردية كل موظف قبل حساب التأخير/الإضافي')
}

console.log('②③ بطاقة حضور اليوم + جسر التنبيهات (المصدر)')
{
  assert.ok(dashboard.includes('data-attendance-today'), 'بطاقة «حضور اليوم» مفقودة من لوحة التحكم')
  assert.ok(/dayMetrics\(record, \{ \.\.\.hrRules, shift \}\)/.test(dashboard), 'بطاقة اليوم لا تحترم وردية كل موظف')
  assert.ok(/leaveDates\(l\)\.includes\(today\)/.test(dashboard), 'بطاقة اليوم لا تستثني أصحاب الإجازات المعتمدة من الغياب')
  assert.ok(/pendingLeaveRequests: pendingLeaveCount/.test(dashboard) && /absentToday: attendanceToday\.absentNames/.test(dashboard),
    'لوحة التحكم لا تمرر إجازات/غياب اليوم لمركز التنبيهات')
  assert.ok(/'leave_pending' \| 'absence_today'/.test(alertsCore), 'نوعا تنبيه الحضور غير معرّفين في النواة')
  assert.ok(alertsCore.includes("kind: 'leave_pending'") && alertsCore.includes("kind: 'absence_today'"), 'تنبيها الحضور لا يُبنَيان')
  assert.ok(alertsCore.includes("route: '/hr/leaves'") && alertsCore.includes("route: '/hr'"), 'تنبيها الحضور بلا وجهة نقر')
  ok('البطاقة تحسب بوردية كل موظف والإجازات، والتنبيهان لهما وجهة ومصدر')
}

console.log('④⑤ كشف الموظف وحارس المسير (المصدر)')
{
  assert.ok(employees.includes('data-employee-attendance'), 'كشف الموظف الموحد بلا ملخص حضور الشهر')
  assert.ok(employees.includes('getAttendancePayrollImpact(monthNow, [statementFor])'), 'كشف الموظف لا يعرض أثر الحضور المالي')
  assert.ok(employees.includes('data-slip-attendance-warning') && employees.includes('data-slip-force'), 'تحذير مسير بلا حضور مفقود')
  assert.ok(/const missing = chosen\.filter\(\(row\) => !withRecords\.has\(row\.employeeId\)\)/.test(employees),
    'حارس المسير لا يفحص من ليس له سجلات في شهر المسير')
  assert.ok(/slipNoAttendance == null\)/.test(employees), 'الحارس يُتجاوز بلا موافقة ثانية صريحة')
  ok('الكشف يعرض أيام الشهر وأثره، والحارس يحذر بالأسماء قبل أي ترحيل أعمى')
}

console.log('⑥⑦ صافي الأثر في كشف الحضور (المصدر)')
{
  assert.ok(/<th className="p-1\.5">صافي الأثر<\/th>/.test(hr), 'عمود صافي الأثر مفقود من جدول تقرير الحضور')
  assert.ok(/fmt\(impact\?\.netAdjustmentMinor \?\? 0\)/.test(hr), 'خلايا صافي الأثر مفقودة من الجدول/الطباعة')
  assert.ok(hr.includes('`صافي الأثر (${cur.code})`'), 'عمود صافي الأثر مفقود من تصدير CSV')
  assert.ok(hr.includes('<th>صافي الأثر</th>'), 'عمود صافي الأثر مفقود من الطباعة')
  ok('صافي الأثر = بدل الإضافي − الخصومات الثلاثة، في الجدول والطباعة والتصدير')
}

console.log('⑧ فحص حي: الوردية الفردية تغير أثر الرواتب فعلاً')
{
  const c = await freshCase({ activityId: 'grocery' })
  const st = () => c.store.getState()
  const emp = (name) => st().employees.find((e) => e.nameAr === name)
  st().addEmployee({ nameAr: 'سائد المسائي', phone: '', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 2600000, allowancesMinor: 0, active: true, notes: '' })
  st().addEmployee({ nameAr: 'منى الصباحية', phone: '', jobTitle: 'بائعة', hireDate: '2026-01-01', baseSalaryMinor: 2600000, allowancesMinor: 0, active: true, notes: '' })
  const saed = emp('سائد المسائي'), mona = emp('منى الصباحية')
  assert.ok(saed && mona, 'الموظفان لم يُنشآ')

  /* قاعدة احتساب صريحة: تأخير كل 60 دقيقة ⇒ خصم 1000، وإضافي مدفوع ×1.5 */
  st().updateHrRules({ lateAmountMinor: 1000, latePerMinutes: 60, overtimePaid: true, overtimeMultiplier: 1.5, overtimeMinMinutes: 30 })

  /* سائد وردية مسائية 11:00-19:00؛ بصمة 11:20 ⇒ 19:20 (تأخير 5 دقائق فقط، لا إضافي ≥30) */
  st().setEmployeeShift(saed.id, { startMin: 11 * 60, endMin: 19 * 60, graceMinutes: 15 })
  st().setAttendanceDay({ employeeId: saed.id, date: '2026-09-15', status: 'present', checkIn: '11:20', checkOut: '19:20' })
  /* منى وردية المنشأة 9:00-17:00؛ بصمة 10:40 ⇒ 18:00 (تأخير 85 دقيقة ⇒ خصم، وإضافي 60 دقيقة ⇒ بدل) */
  st().setAttendanceDay({ employeeId: mona.id, date: '2026-09-15', status: 'present', checkIn: '10:40', checkOut: '18:00' })

  const impacts = new Map(st().getAttendancePayrollImpact('2026-09').map((row) => [row.employeeId, row]))
  const saedImpact = impacts.get(saed.id)
  const monaImpact = impacts.get(mona.id)

  assert.equal(saedImpact.lateDeductionMinor, 0, `سائد بورديته المسائية يجب ألا يُخصم شيئاً (وُجد ${saedImpact.lateDeductionMinor}) — الجسر ① مكسور`)
  assert.equal(saedImpact.overtimeAllowanceMinor, 0, `انصراف سائد 19:20 ليس إضافياً في ورديته (وُجد ${saedImpact.overtimeAllowanceMinor})`)
  assert.ok(saedImpact.notes.join(' ').includes('تأخير 5 دقيقة'), `تأخير سائد المسائي يجب أن يظهر 5 دقائق لا دقائق وردية المنشأة: ${saedImpact.notes.join(' · ')}`)

  assert.equal(monaImpact.lateDeductionMinor, 1000, `تأخير منى 85 دقيقة = خصم واحد 1000 (وُجد ${monaImpact.lateDeductionMinor})`)
  assert.ok(monaImpact.overtimeAllowanceMinor > 0, 'إضافي منى 60 دقيقة يجب أن يُحتسب بدلاً مدفوعاً')
  assert.equal(monaImpact.netAdjustmentMinor, monaImpact.overtimeAllowanceMinor - 1000, 'صافي أثر منى = البدل − الخصم')

  /* قبل الجسر: لو حُسب سائد على وردية المنشأة لكان خصمه 2000 وإضافيه محسوباً — البوابة تثبت الفرق */
  assert.notEqual(saedImpact.lateDeductionMinor, 2000, 'سائد ما زال يُحتسب على وردية المنشأة!')
  ok('حياً: سائد المسائي (خصم 0) ومنى الصباحية (خصم 1000 + بدل إضافي) — كلٌّ بورديته')
}

console.log('⑨ فحص حي: تنبيها الحضور في النواة الصرفة')
{
  const { collectBusinessAlerts } = await import('../src/core/alerts.ts')
  const base = {
    todayIso: '2026-10-01T10:00:00.000Z',
    items: [], batches: [], installmentAlerts: [], cheques: [], customers: [],
    customerBalances: () => 0,
    fmt: (m) => String(m),
  }
  const none = collectBusinessAlerts(base)
  assert.ok(!none.some((a) => a.kind === 'leave_pending' || a.kind === 'absence_today'), 'تنبيهات حضور بلا مدخلات!')
  const withHr = collectBusinessAlerts({ ...base, pendingLeaveRequests: 3, absentToday: ['سائد', 'منى', 'علي', 'ريم'] })
  const leave = withHr.find((a) => a.kind === 'leave_pending')
  const absent = withHr.find((a) => a.kind === 'absence_today')
  assert.ok(leave && leave.titleAr.includes('3') && leave.route === '/hr/leaves' && leave.severity === 'warn', 'تنبيه الإجازات المعلقة ناقص')
  assert.ok(absent && absent.titleAr.includes('4') && absent.route === '/hr' && absent.severity === 'danger', 'تنبيه غياب اليوم ناقص')
  assert.ok(absent.detailAr.includes('سائد') && absent.detailAr.includes('…'), 'تفصيل الغياب لا يعرض الأسماء واختصار القائمة')
  /* خطر أولاً: الغياب (danger) قبل الإجازات (warn) */
  assert.ok(withHr.indexOf(absent) < withHr.indexOf(leave), 'الغياب (خطر) يجب أن يسبق الإجازات (تحذير)')
  ok('حياً: لا تنبيه بلا بيانات، وبالبيانات يظهران بالأسماء والوجهات وبترتيب الأولوية')
}

console.log('⑩ فحص حي: حارس المسير — لا قسائم لشهرٍ بلا حضور إلا بموافقة صريحة')
{
  const c = await freshCase({ activityId: 'grocery' })
  const st = () => c.store.getState()
  st().addEmployee({ nameAr: 'موظف بلا بصمة', phone: '', jobTitle: 'عامل', hireDate: '2026-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true, notes: '' })
  const e = st().employees.at(-1)
  /* نفس منطق حارس الواجهة (accrueSlips): من ليس له سجلات في شهر المسير ⇒ تحذير */
  const month = '2026-09'
  const withRecords = new Set(st().attendanceRecords.filter((r) => r.date.startsWith(month)).map((r) => r.employeeId))
  const missing = [e].filter((emp) => !withRecords.has(emp.id)).map((emp) => emp.nameAr)
  assert.deepEqual(missing, ['موظف بلا بصمة'], 'الحارس لم يكتشف موظفاً بلا أي سجل حضور')
  /* وبعد تسجيل بصمة واحدة يختفي من قائمة التحذير */
  st().setAttendanceDay({ employeeId: e.id, date: '2026-09-20', status: 'present', checkIn: '09:00', checkOut: '17:00' })
  const withRecords2 = new Set(st().attendanceRecords.filter((r) => r.date.startsWith(month)).map((r) => r.employeeId))
  const missing2 = [e].filter((emp) => !withRecords2.has(emp.id)).map((emp) => emp.nameAr)
  assert.deepEqual(missing2, [], 'بصمة واحدة في الشهر تكفي لخروج الموظف من التحذير')
  ok('حياً: منطق الحارس يرصد بلا بصمة ويسقط بعد أول سجل حضور')
}

console.log(`✅ جولة المالك — جسور الحضور السبعة: ${pass} فحوص ناجحة`)
