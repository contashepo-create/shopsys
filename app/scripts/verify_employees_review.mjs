/**
 * مراجعة الموظفين والرواتب الشاملة — بتركيز خاص على قسم الخصومات (طلب المالك):
 * «الخصومات لا تظهر في النقدية لأنها ليست سحباً نقدياً لكن يجب أن يكون هناك قسم خصومات»
 *
 * المقارنة العالمية المعتمدة:
 * - Netchex/QuickBooks Payroll: deductions management = سجل مستقل + تتبع تراكمي + تطبيق بالمسير
 * - نظام العمل السعودي م91/92: سقف الخصم الشهري 50% من الأجر إلا بموافقة خاصة؛
 *   نظيره المصري م76: سقف 25% للأقساط. اعتمدنا 50% مع override موثق بالاسم.
 *
 * E1) الفجوات المسدودة: حذف موظف عليه سلف/جزاءات/عهدة كان يمر ويترك 1107 يتيماً
 * E2) الفجوة المسدودة: خصم 80% من الراتب كان يمر — سقف 50% مع اعتماد موثق
 * E3) الفجوة المسدودة: لا عفو عن جزاء خاطئ — waiveEmployeeDeduction مع معتمد وسبب
 * E4) الفجوات المسدودة: اسم موظف فارغ/مكرر كان يمر
 * E5) دورة الخصومات الكاملة: تسجيل DED → خصم جزئي بمسير → متبقٍ → خصم الباقي بمسير تالٍ
 * E6) الخصم المباشر (غياب لحظي بلا سجل) لا يمس سجل الجزاءات
 * E7) قيد المسير: 5102 بالإجمالي الصافي+السلف، الخصومات تخفض الصافي لا تلمس النقدية
 * E8) السلف: منح بقيد 1107، استقطاع FIFO عبر مسيرين، سداد نقدي خارج المسير
 * E9) كشف الموظف: سلف مدينة، استقطاعات دائنة، صفوف الجزاءات التوثيقية
 * E10) استحقاق ثم سداد لاحق (2104) + لا مسير مكرر لنفس الشهر
 * E11) الثوابت: قيود متوازنة، 1107 = Σ متبقي السلف
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { employeeStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة' })

console.log('\n— E1) حذف موظف عليه التزامات (الفجوة المسدودة) —')
{
  st().addEmployee({ nameAr: 'موظف مدين', phone: '', jobTitle: 'بائع', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 100000, treasury: '1101', notes: '' })
  assert.throws(() => st().removeEmployee(emp.id), /سلف غير مستردة/)
  ok('E1: موظف عليه سلفة 1000 لا يُحذف (كان يُحذف ويترك 1107 يتيماً!)')
  st().addEmployee({ nameAr: 'موظف مجازى', phone: '', jobTitle: 'بائع', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const emp2 = st().employees.at(-1)
  st().addEmployeeDeduction({ employeeId: emp2.id, amountMinor: 20000, reason: 'غياب' })
  assert.throws(() => st().removeEmployee(emp2.id), /جزاءات غير مخصومة/)
  ok('E1: موظف له جزاء غير مخصوم لا يُحذف')
  st().waiveEmployeeDeduction({ deductionId: st().employeeDeductions.at(-1).id, approvedBy: 'المالك', reason: 'تسجيل تجريبي' })
  st().removeEmployee(emp2.id)
  ok('E1: بعد العفو عن الجزاء صار حذفه ممكناً — الحارس دقيق لا متعنت')
}

console.log('\n— E2) سقف الخصم 50% (المقارنة العالمية) —')
{
  st().addEmployee({ nameAr: 'كثير الجزاءات', phone: '', jobTitle: 'بائع', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  assert.throws(
    () => st().postPayroll({ month: '2026-01', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 400000, advancesMinor: 0 }] }),
    /50%/,
  )
  ok('E2: خصم 4000 من راتب 5000 (80%) مرفوض — م91/92 السعودي والمصري (كان يمر!)')
  const run = st().postPayroll({ month: '2026-01', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', deductionOverrideBy: 'المالك — موافقة خطية', lines: [{ employeeId: emp.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 400000, advancesMinor: 0 }] })
  assert.equal(run.deductionOverrideBy, 'المالك — موافقة خطية')
  ok('E2: التجاوز باعتماد موثق بالاسم على المسير يمر — نمط الموافقة الخطية القانوني')
  // خصم 50% بالضبط يمر بلا اعتماد (الحد شامل)
  st().addEmployee({ nameAr: 'نصف الراتب', phone: '', jobTitle: 'بائع', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const emp5 = st().employees.at(-1)
  st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp5.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 250000, advancesMinor: 0 }] })
  ok('E2: خصم 50% بالضبط يمر بلا اعتماد — الحد قانوني لا أقل منه')
}

console.log('\n— E3) العفو عن جزاء (الفجوة المسدودة) —')
{
  st().addEmployee({ nameAr: 'معفو عنه', phone: '', jobTitle: 'بائع', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  const ded = st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 30000, reason: 'تأخير' })
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 30000)
  assert.throws(() => st().waiveEmployeeDeduction({ deductionId: ded.id, approvedBy: '', reason: 'x' }), /معتمد العفو مطلوب/)
  assert.throws(() => st().waiveEmployeeDeduction({ deductionId: ded.id, approvedBy: 'المالك', reason: ' ' }), /سبب العفو مطلوب/)
  ok('E3: العفو بلا معتمد أو سبب يُرفض — توثيق إجباري')
  const waived = st().waiveEmployeeDeduction({ deductionId: ded.id, approvedBy: 'المالك', reason: 'ثبت عذره' })
  assert.equal(waived.waivedMinor, 30000)
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 0)
  ok('E3: العفو صفّر المتبقي مع اسم المعتمد والسبب والتاريخ (كان مستحيلاً!)')
  assert.throws(() => st().waiveEmployeeDeduction({ deductionId: ded.id, approvedBy: 'المالك', reason: 'مرة ثانية' }), /لا متبقي/)
  ok('E3: لا عفو مزدوج')
  assert.equal(st().journal.filter((e) => e.description?.includes('عفو')).length, 0)
  ok('E3: العفو بلا قيد — الجزاء لم يولد قيداً أصلاً فلا شيء يُعكس (سلامة دفترية)')
}

console.log('\n— E4) اسم الموظف (الفجوة المسدودة) —')
{
  assert.throws(() => st().addEmployee({ nameAr: '  ', phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '', notes: '' }), /مطلوب/)
  ok('E4: اسم فارغ يُرفض (كان يمر!)')
  assert.throws(() => st().addEmployee({ nameAr: 'موظف مدين', phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '', notes: '' }), /بنفس الاسم/)
  ok('E4: اسم مكرر يُرفض')
}

console.log('\n— E5) دورة الخصومات الكاملة عبر مسيرين —')
{
  st().addEmployee({ nameAr: 'صاحب الجزاءات', phone: '', jobTitle: 'كاشير', salaryMinor: 800000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  const d1 = st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 50000, reason: 'تلفيات' })
  const d2 = st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 30000, reason: 'غياب يومين' })
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 80000)
  ok('E5: جزءان مسجلان DED بمستندين مرقمين — المتبقي 800 (قسم الخصومات المستقل)')
  assert.equal(st().journal.filter((e) => e.sourceType === 'deduction').length, 0)
  ok('E5: التسجيل بلا قيد فوري — الخصم ليس حركة نقدية (تشخيص المالك الصحيح)')
  // مسير مارس: خصم 600 من الـ800 (جزئي)
  st().postPayroll({ month: '2026-03', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 800000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 60000, advancesMinor: 0 }] })
  const after1 = st().getEmployeeDeductionBalance(emp.id)
  assert.equal(after1.remainingMinor, 20000)
  // FIFO: الأقدم (تلفيات 500) استُهلك كاملاً ثم 100 من الغياب
  assert.equal(st().employeeDeductions.find((d) => d.id === d1.id).recoveredMinor, 50000)
  assert.equal(st().employeeDeductions.find((d) => d.id === d2.id).recoveredMinor, 10000)
  ok('E5: مسير مارس خصم 600 — FIFO أكل الأقدم كاملاً و100 من التالي، المتبقي 200')
  // مسير أبريل: الباقي
  st().postPayroll({ month: '2026-04', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 800000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 20000, advancesMinor: 0 }] })
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 0)
  ok('E5: مسير أبريل أقفل الباقي — الجزاء تتبع كامل عبر الشهور (نمط Netchex)')
}

console.log('\n— E6) الخصم المباشر بلا سجل —')
{
  st().addEmployee({ nameAr: 'متأخر اليوم', phone: '', jobTitle: 'عامل', salaryMinor: 400000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  st().postPayroll({ month: '2026-05', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 15000, advancesMinor: 0 }] })
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 0)
  assert.equal(st().employeeDeductions.filter((d) => d.employeeId === emp.id).length, 0)
  ok('E6: خصم مباشر 150 (غياب لحظي) بالمسير بلا سجل DED — مسموح ولا يلوث السجل')
}

console.log('\n— E7) قيد المسير والخصومات لا تلمس النقدية —')
{
  st().addEmployee({ nameAr: 'قيد نظيف', phone: '', jobTitle: 'محاسب', salaryMinor: 1000000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  const cashBefore = bal('1101')
  const run = st().postPayroll({ month: '2026-06', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 1000000, allowancesMinor: 100000, overtimeMinor: 50000, deductionsMinor: 150000, advancesMinor: 0 }] })
  // الإجمالي 1150 − خصومات 150 = صافي 1000
  assert.equal(run.totals.netMinor, 1000000)
  assert.equal(bal('1101'), cashBefore - 1000000)
  ok('E7: الخزينة نقصت الصافي 1000 فقط — الخصومات 150 لم تلمس النقدية (تشخيص المالك)')
  const entry = st().journal.find((e) => e.id === run.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '5102' && l.debit === 1000000))
  ok('E7: مصروف الرواتب 5102 = الصافي (طريقة صافي التكلفة) — الخصم يخفض المصروف لا إيراداً وهمياً')
}

console.log('\n— E8) السلف: منح واستقطاع FIFO وسداد نقدي —')
{
  st().addEmployee({ nameAr: 'صاحب السلف', phone: '', jobTitle: 'سائق', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  const a1 = st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 80000, treasury: '1101', notes: '' })
  st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 40000, treasury: '1101', notes: '' })
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 120000)
  ok('E8: سلفتان 800+400 بقيدي 1107/خزينة — المتبقي 1200')
  st().postPayroll({ month: '2026-07', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 90000 }] })
  assert.equal(st().employeeAdvances.find((a) => a.id === a1.id).recoveredMinor, 80000)
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 30000)
  ok('E8: استقطاع 900 بالمسير FIFO — الأقدم أُقفل والمتبقي 300')
  st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 30000, treasury: '1101' })
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0)
  ok('E8: سداد نقدي خارج المسير صفّر السلفة بقيد خزينة/1107')
  assert.throws(() => st().postPayroll({ month: '2026-08', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 10000 }] }), /متبقي سلفه/)
  ok('E8: استقطاع أكبر من متبقي السلفة (صفر) يُرفض')
}

console.log('\n— E9) كشف الموظف مع صفوف الجزاءات —')
{
  const emp = st().employees.find((e) => e.nameAr === 'صاحب الجزاءات')
  const rows = employeeStatement({ employeeId: emp.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.ok(rows.some((r) => r.docLabel.includes('جزاء DED-') && r.docLabel.includes('خُصم بالكامل')))
  ok('E9: كشف الموظف يعرض الجزاءات بحالتها (قسم الخصومات مرئي في الكشف — الفجوة المسدودة)')
  const dedRows = rows.filter((r) => r.docLabel.includes('جزاء'))
  assert.ok(dedRows.every((r) => r.debitMinor === 0 && r.creditMinor === 0))
  ok('E9: صفوف الجزاءات توثيقية بصفر مالي — لا تلوث رصيد السلف النقدي')
  const empAdv = st().employees.find((e) => e.nameAr === 'صاحب السلف')
  const rows2 = employeeStatement({ employeeId: empAdv.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.equal(statementBalance(rows2), 0)
  ok('E9: كشف صاحب السلف ينتهي صفراً بعد الاستقطاع والسداد النقدي')
}

console.log('\n— E10) الاستحقاق والتكرار —')
{
  st().addEmployee({ nameAr: 'مستحق لاحقاً', phone: '', jobTitle: 'حارس', salaryMinor: 300000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  st().postPayroll({ month: '2026-09', payMode: 'accrue', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
  assert.equal(-bal('2104'), 300000)
  ok('E10: مسير استحقاق ⇒ 2104 دائن 3000 بلا مساس بالخزينة')
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 300000, description: 'سداد رواتب سبتمبر' })
  assert.equal(bal('2104'), 0)
  ok('E10: سند صرف على 2104 صفّر المستحق')
  assert.throws(() => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] }), /مرحّل بالفعل/)
  ok('E10: لا مسير مكرر لنفس الشهر')
}

console.log('\n— E11) الثوابت —')
{
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`E11: كل القيود (${st().journal.length}) متوازنة`)
  const totalRemaining = st().employees.reduce((s, e) => s + st().getEmployeeAdvanceBalance(e.id).remainingMinor, 0)
  assert.equal(bal('1107'), totalRemaining)
  ok('E11: 1107 بالدفتر = Σ متبقي سلف كل الموظفين بالقرش')
  const empPage = readFileSync(join(root, 'src/ui/pages/EmployeesPage.tsx'), 'utf8')
  assert.ok(empPage.includes('waiveEmployeeDeduction') && empPage.includes('waiveApproval.request'))
  assert.ok(empPage.includes('dedOverrideApproval'))
  ok('E11: زر العفو وتجاوز سقف الـ50% خلف اعتماد المشرف بالرقم السري في الشاشة')
}

console.log(`\n✅ verify_employees_review: ${pass} تحققاً — الموظفون والخصومات بمواكبة عالمية (Netchex/م91-92)`)
