/**
 * الفحص الأدق لقسم الموظفين (الجولة الثالثة — طلب المالك):
 * المسارات المتقاطعة التي تصب كلها في سجلات الموظف من أقسام مختلفة:
 *   عجز العهدة → سلفة | زيادة مصاريف العهدة → 2107 → صرف بالمسير |
 *   عجز الوردية → سلفة | افتتاحي → سجل opening | سلفة نقدية → cash
 * أربعة مصادر سلف مختلفة يجب أن تخضع كلها لنفس الثوابت.
 *
 * د1) عجز عهدة 200 يتحول سلفة تلقائياً ويدخل ثابت 1107 = Σ السجلات
 * د2) زيادة مصاريف عهدة 300 تتراكم على 2107 وgetEmployeeExcessDue يطابقها بالقرش
 * د3) المسير المركب: صافي + استقطاع سلفة + صرف مستحق زيادة = قيد رباعي الأسطر متوازن
 *     (5102 = صافي+سلفة، خزينة = صافي+زيادة، 2107 مدين، 1107 دائن)
 * د4) صرف زيادة أكبر من المستحق يُرفض بالقرش
 * د5) سقف الخصم 50% يُحسب على الإجمالي (أساسي+بدلات+إضافي) لا الأساسي وحده
 * د6) عجز الوردية سلفة: موظف شبح يُرفض، والحقيقي يدخل الثابت
 * د7) الأربعة مصادر معاً لموظف واحد: cash + opening + custody_shortage + shift
 *     — الاستقطاع FIFO يمر عليها بالترتيب الزمني والكشف يطابق
 * د8) سطر صفري (إجازة بلا راتب) داخل مسير جماعي يمر والقيد سليم
 * د9) عفو جزاء يظهر بالكشف بحالته حتى بعد خصومات لاحقة
 * د10) سداد نقدي + استقطاع مسير في نفس الشهر لنفس الموظف — لا تجاوز للمتبقي
 * د11) تدقيق دفتري نهائي: ميزان + ميزانية + 1107 = Σ + 2107 = Σ مستحقات الزيادة
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { trialBalance, balanceSheet } = await import(join(root, 'src/core/financialReports.ts'))
const { employeeStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 16)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href

let pass = 0

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?empdeep=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  let audits = 0
  const audit = (stage) => {
    for (const e of st().journal) assertBalanced(e.lines)
    assert.ok(trialBalance(st().journal, { from: '0000-01-01', to: '9999-12-31' }).balanced, `${activityId}/${stage}: ميزان`)
    assert.ok(balanceSheet(st().journal, '9999-12-31').balanced, `${activityId}/${stage}: ميزانية`)
    const sumAdv = st().employees.reduce((s, e) => s + st().getEmployeeAdvanceBalance(e.id).remainingMinor, 0)
    assert.equal(bal('1107'), sumAdv, `${activityId}/${stage}: 1107 = Σ سجلات السلف`)
    const sumExcess = st().employees.reduce((s, e) => s + st().getEmployeeExcessDue(e.id), 0)
    assert.equal((-bal('2107')) + 0, sumExcess, `${activityId}/${stage}: 2107 = Σ مستحقات الزيادة`) // +0 يطبع الصفر السالب
    audits++
  }

  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 8000000, label: 'خزينة' })
  st().addEmployee({ nameAr: `أمين ${nameAr}`, phone: '', jobTitle: 'مشرف', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)

  // ═══ د1) عجز عهدة → سلفة ═══
  const f1 = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'نثريات', notes: '' })
  st().fundCustodyFile({ fileId: f1.id, amountMinor: 200000, treasury: '1101', description: 'تمويل' })
  st().postCustodyExpense({ fileId: f1.id, amountMinor: 150000, description: 'مشتريات نثرية' })
  st().settleCustodyFile({ fileId: f1.id, returnedMinor: 30000, treasury: '1101' }) // عجز 200
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 20000, `${activityId}: د1 عجز العهدة سلفة`)
  assert.ok(st().employeeAdvances.some((a) => a.employeeId === emp.id && a.source === 'custody_shortage'), `${activityId}: د1 مصدرها custody_shortage`)
  audit('د1')

  // ═══ د2) زيادة مصاريف عهدة → 2107 ═══
  const f2 = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'ثانية', notes: '' })
  st().fundCustodyFile({ fileId: f2.id, amountMinor: 50000, treasury: '1101', description: 'تمويل' })
  st().postCustodyExpense({ fileId: f2.id, amountMinor: 80000, description: 'تجاوز', allowExcess: true })
  assert.equal(st().getEmployeeExcessDue(emp.id), 30000, `${activityId}: د2 المستحق`)
  assert.equal(-bal('2107'), 30000, `${activityId}: د2 = 2107`)
  audit('د2')

  // ═══ د3) المسير المركب رباعي الأسطر ═══
  const cashBefore = bal('1101')
  const run = st().postPayroll({ month: '2026-01', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 20000, excessPaidMinor: 30000 }] })
  assert.equal(run.totals.netMinor, 580000, `${activityId}: د3 الصافي`)
  const entry = st().journal.find((e) => e.id === run.journalEntryId)
  const lm = new Map(entry.lines.map((l) => [l.accountCode, [l.debit, l.credit]]))
  assert.deepEqual(lm.get('5102'), [600000, 0], `${activityId}: د3 المصروف = صافي+سلفة`)
  assert.deepEqual(lm.get('1101'), [0, 610000], `${activityId}: د3 الخزينة = صافي+زيادة`)
  assert.deepEqual(lm.get('2107'), [30000, 0], `${activityId}: د3 تصفية الزيادة`)
  assert.deepEqual(lm.get('1107'), [0, 20000], `${activityId}: د3 استرداد السلفة`)
  assert.equal(bal('1101'), cashBefore - 610000, `${activityId}: د3 النقدية بالقرش`)
  assert.equal(st().getEmployeeExcessDue(emp.id), 0, `${activityId}: د3 المستحق صفر`)
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0, `${activityId}: د3 السلفة صفر`)
  audit('د3')

  // ═══ د4) صرف زيادة فوق المستحق ═══
  assert.throws(() => st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, excessPaidMinor: 1 }] }), /أكبر من رصيده/, `${activityId}: د4`)
  audit('د4')

  // ═══ د5) السقف على الإجمالي ═══
  st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 150000, overtimeMinor: 50000, deductionsMinor: 300000, advancesMinor: 0 }] })
  assert.throws(() => st().postPayroll({ month: '2026-03', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 300000, advancesMinor: 0 }] }), /50%/, `${activityId}: د5 نفس الخصم يُصد لو الإجمالي أقل`)
  audit('د5')

  // ═══ د6) عجز الوردية → سلفة ═══
  st().openShift('كاشير الفحص', 50000)
  const closed = st().closeShift(30000) // عجز 200
  assert.throws(() => st().settleShiftVariance({ shiftId: closed.id, mode: 'advance', employeeId: 9999 }), /اختر الموظف/, `${activityId}: د6 شبح`)
  st().settleShiftVariance({ shiftId: closed.id, mode: 'advance', employeeId: emp.id })
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 20000, `${activityId}: د6 عجز الوردية سلفة`)
  audit('د6')

  // ═══ د7) المصادر الأربعة معاً + FIFO عبرها ═══
  st().setOpeningBalance({ kind: 'employee_advance', refId: emp.id, amountMinor: 10000, label: emp.nameAr })
  st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 15000, treasury: '1101', notes: '' })
  const sources = new Set(st().employeeAdvances.filter((a) => a.employeeId === emp.id).map((a) => a.source))
  assert.ok(sources.has('cash') && sources.has('opening') && sources.has('custody_shortage'), `${activityId}: د7 ثلاثة مصادر على الأقل`)
  const totalRemaining = st().getEmployeeAdvanceBalance(emp.id).remainingMinor
  assert.equal(totalRemaining, 45000, `${activityId}: د7 المجموع 200+100+150`)
  // استقطاع 30 بالمسير — يأكل الأقدم (عجز الوردية د6) ثم من التالي
  st().postPayroll({ month: '2026-03', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 30000 }] })
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 15000, `${activityId}: د7 بعد الاستقطاع`)
  const rows7 = employeeStatement({ employeeId: emp.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.equal(statementBalance(rows7), 15000, `${activityId}: د7 الكشف يطابق`)
  audit('د7')

  // ═══ د8) سطر صفري داخل مسير جماعي ═══
  st().addEmployee({ nameAr: `إجازة ${nameAr}`, phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '2026-01-01', notes: '' })
  const idle = st().employees.at(-1)
  const r8 = st().postPayroll({ month: '2026-04', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [
    { employeeId: idle.id, baseMinor: 0, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 },
    { employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 },
  ] })
  assert.equal(r8.totals.netMinor, 600000, `${activityId}: د8`)
  audit('د8')

  // ═══ د9) عفو يظل ظاهراً بالكشف بعد خصومات لاحقة ═══
  const d9 = st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 12000, reason: 'خطأ إداري' })
  st().waiveEmployeeDeduction({ deductionId: d9.id, approvedBy: 'المالك', reason: 'ثبت عذره' })
  st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 8000, reason: 'تأخير' })
  st().postPayroll({ month: '2026-05', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 8000, advancesMinor: 0 }] })
  const rows9 = employeeStatement({ employeeId: emp.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.ok(rows9.some((r) => r.docLabel.includes('معفو عنه')), `${activityId}: د9 العفو ظاهر`)
  assert.ok(rows9.some((r) => r.docLabel.includes('تأخير') && r.docLabel.includes('خُصم بالكامل')), `${activityId}: د9 اللاحق خُصم`)
  audit('د9')

  // ═══ د10) سداد نقدي + استقطاع بنفس الشهر — الحارس يمنع تجاوز المتبقي ═══
  const remaining10 = st().getEmployeeAdvanceBalance(emp.id).remainingMinor
  assert.equal(remaining10, 15000)
  st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 10000, treasury: '1101' })
  assert.throws(() => st().postPayroll({ month: '2026-06', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 6000 }] }), /متبقي سلفه/, `${activityId}: د10 تجاوز`)
  st().postPayroll({ month: '2026-06', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 5000 }] })
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0, `${activityId}: د10 الإقفال الدقيق`)
  audit('د10')

  // ═══ د11) التدقيق النهائي ═══
  audit('د11-نهائي')
  assert.equal(bal('1107'), 0, `${activityId}: د11 1107 صفر بعد إقفال كل السلف`)
  assert.equal(bal('2107'), 0, `${activityId}: د11 2107 صفر بعد صرف كل المستحقات`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): 11 سيناريو متقاطعاً (عهد+ورديات+مسيرات) × ${audits} تدقيقاً — 1107/2107 صفر ختامياً`)
}

assert.equal(pass, 16)
console.log(`\n✅ verify_employees_deep_16: الفحص الأدق — المسارات المتقاطعة الأربعة سليمة على الأنشطة الـ16`)
