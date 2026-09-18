/**
 * إعادة فحص قسم الموظفين الشاملة (طلب المالك):
 * «أعد مراجعة القسم بالكامل ومراجعة القيود ومراجعة جميع السيناريوهات على مستوى كل نشاط»
 *
 * فجوات هذه الجولة (مؤكدة بالتشغيل ثم سُدت):
 *   GAP-R1: افتتاحي سلفة موظف = قيد 1107 بلا سجل سلفة ⇒ لا استقطاع بالمسير وثابت 1107 مكسور
 *   GAP-R7: سلفة بخزينة شبح كانت تمر · GAP-R8: سداد بخزينة شبح · GAP-R9: مسير بخزينة شبح
 *
 * السيناريوهات (س1–س14) تجري كاملة على كل نشاط من الـ16، وبعد كل خطوة تدقيق دفتري:
 * توازن سطري + ميزان مراجعة + ميزانية + 1107 = Σ سجلات السلف + كشف كل موظف = رصيده
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
  const { useDataStore } = await import(`${repoUrl}?emprecheck=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  let audits = 0
  const audit = (stage) => {
    for (const e of st().journal) {
      assertBalanced(e.lines)
      for (const l of e.lines) {
        assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit) && l.debit >= 0 && l.credit >= 0, `${activityId}/${stage}: قيم`)
        assert.ok(!(l.debit > 0 && l.credit > 0), `${activityId}/${stage}: سطر مزدوج`)
      }
    }
    const tb = trialBalance(st().journal, { from: '0000-01-01', to: '9999-12-31' })
    assert.ok(tb.balanced, `${activityId}/${stage}: الميزان`)
    const bs = balanceSheet(st().journal, '9999-12-31')
    assert.ok(bs.balanced, `${activityId}/${stage}: الميزانية`)
    // ثابت القسم: 1107 = Σ متبقي سجلات السلف (كان مكسوراً مع الافتتاحي قبل GAP-R1)
    const totalRemaining = st().employees.reduce((s, e) => s + st().getEmployeeAdvanceBalance(e.id).remainingMinor, 0)
    assert.equal(bal('1107'), totalRemaining, `${activityId}/${stage}: 1107 ≠ Σ سجلات السلف`)
    // كشف كل موظف = متبقي سلفه
    for (const e of st().employees) {
      const rows = employeeStatement({ employeeId: e.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
      assert.equal(statementBalance(rows), st().getEmployeeAdvanceBalance(e.id).remainingMinor, `${activityId}/${stage}: كشف ${e.nameAr}`)
    }
    audits++
  }

  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 5000000, label: 'خزينة' })
  st().setOpeningBalance({ kind: 'treasury', refId: '1102', amountMinor: 2000000, label: 'بنك' })

  // ═══ س1) GAP-R1: افتتاحي سلفة يولد سجلاً قابلاً للاستقطاع ═══
  st().addEmployee({ nameAr: `قديم ${nameAr}`, phone: '', jobTitle: 'بائع', salaryMinor: 500000, hiredAt: '2025-06-01', notes: '' })
  const veteran = st().employees.at(-1)
  st().setOpeningBalance({ kind: 'employee_advance', refId: veteran.id, amountMinor: 70000, label: veteran.nameAr })
  assert.equal(st().getEmployeeAdvanceBalance(veteran.id).remainingMinor, 70000, `${activityId}: س1 سجل الافتتاحي`)
  assert.equal(bal('1107'), 70000, `${activityId}: س1 القيد`)
  audit('س1')

  // ═══ س2) تعديل الافتتاحي بفرق — سجل واحد يُحدَّث لا يتضاعف ═══
  st().setOpeningBalance({ kind: 'employee_advance', refId: veteran.id, amountMinor: 90000, label: veteran.nameAr })
  assert.equal(st().getEmployeeAdvanceBalance(veteran.id).remainingMinor, 90000, `${activityId}: س2`)
  assert.equal(st().employeeAdvances.filter((a) => a.employeeId === veteran.id && a.source === 'opening').length, 1, `${activityId}: س2 سجل واحد`)
  audit('س2')

  // ═══ س3) استقطاع من سلفة الافتتاحي بالمسير (كان مستحيلاً قبل السد) ═══
  st().postPayroll({ month: '2026-01', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: veteran.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40000 }] })
  assert.equal(st().getEmployeeAdvanceBalance(veteran.id).remainingMinor, 50000, `${activityId}: س3`)
  audit('س3')

  // ═══ س4) تخفيض الافتتاحي دون المستقطع يُرفض ═══
  assert.throws(() => st().setOpeningBalance({ kind: 'employee_advance', refId: veteran.id, amountMinor: 30000, label: veteran.nameAr }), /المستقطع/, `${activityId}: س4`)
  audit('س4')

  // ═══ س5) الخزائن الشبح الثلاث (R7/R8/R9) ═══
  assert.throws(() => st().grantEmployeeAdvance({ employeeId: veteran.id, amountMinor: 1000, treasury: '9999', notes: '' }), /غير موجود/, `${activityId}: س5-سلفة`)
  assert.throws(() => st().repayEmployeeAdvance({ employeeId: veteran.id, amountMinor: 1000, treasury: '8888' }), /غير موجود/, `${activityId}: س5-سداد`)
  assert.throws(() => st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '7777', custodyFileId: null, notes: '', lines: [{ employeeId: veteran.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] }), /غير موجودة/, `${activityId}: س5-مسير`)
  audit('س5')

  // ═══ س6) الحارس المركزي: مسير وسلفة يكسران رصيد الخزينة يُرفضان ═══
  assert.throws(() => st().grantEmployeeAdvance({ employeeId: veteran.id, amountMinor: 99000000, treasury: '1101', notes: '' }), /سالباً/, `${activityId}: س6-سلفة`)
  assert.throws(() => st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: veteran.id, baseMinor: 99000000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] }), /سالباً/, `${activityId}: س6-مسير`)
  audit('س6')

  // ═══ س7) مسير من البنك (لا الخزينة) ═══
  st().addEmployee({ nameAr: `بنكي ${nameAr}`, phone: '', jobTitle: 'محاسب', salaryMinor: 700000, hiredAt: '2026-01-01', notes: '' })
  const banker = st().employees.at(-1)
  const bankBefore = bal('1102')
  st().postPayroll({ month: '2026-02', payMode: 'cash', treasury: '1102', custodyFileId: null, notes: '', lines: [{ employeeId: banker.id, baseMinor: 700000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] })
  assert.equal(bal('1102'), bankBefore - 700000, `${activityId}: س7 تحويل بنكي`)
  audit('س7')

  // ═══ س8) الجزاءات: تسجيل → خصم جزئي → فائض مباشر → عفو ═══
  st().addEmployeeDeduction({ employeeId: banker.id, amountMinor: 60000, reason: 'تلفيات' })
  const dWaive = st().addEmployeeDeduction({ employeeId: banker.id, amountMinor: 20000, reason: 'خطأ تسجيل' })
  st().waiveEmployeeDeduction({ deductionId: dWaive.id, approvedBy: 'المالك', reason: 'ثبت الخطأ' })
  assert.equal(st().getEmployeeDeductionBalance(banker.id).remainingMinor, 60000, `${activityId}: س8 بعد العفو`)
  // خصم 80: 60 من السجل + 20 مباشر
  st().postPayroll({ month: '2026-03', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: banker.id, baseMinor: 700000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 80000, advancesMinor: 0 }] })
  assert.equal(st().getEmployeeDeductionBalance(banker.id).remainingMinor, 0, `${activityId}: س8 السجل صفر`)
  audit('س8')

  // ═══ س9) سقف 50%: بالضبط يمر، فوقه يُصد، override موثق يمرره ═══
  st().addEmployee({ nameAr: `حدّي ${nameAr}`, phone: '', jobTitle: 'عامل', salaryMinor: 400000, hiredAt: '2026-01-01', notes: '' })
  const edge = st().employees.at(-1)
  st().postPayroll({ month: '2026-04', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 200000, advancesMinor: 0 }] })
  assert.throws(() => st().postPayroll({ month: '2026-05', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 200001, advancesMinor: 0 }] }), /50%/, `${activityId}: س9 فوق الحد`)
  const runOv = st().postPayroll({ month: '2026-05', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', deductionOverrideBy: 'المالك — موافقة خطية', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 200001, advancesMinor: 0 }] })
  assert.equal(runOv.deductionOverrideBy, 'المالك — موافقة خطية', `${activityId}: س9 توثيق`)
  audit('س9')

  // ═══ س10) السقف يشمل السلف+الخصومات معاً (روح م91/92) ═══
  st().grantEmployeeAdvance({ employeeId: edge.id, amountMinor: 150000, treasury: '1101', notes: '' })
  assert.throws(() => st().postPayroll({ month: '2026-06', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 100000, advancesMinor: 150000 }] }), /50%/, `${activityId}: س10`)
  audit('س10')

  // ═══ س11) الاستحقاق ثم السداد الجزئي على 2104 ═══
  st().postPayroll({ month: '2026-06', payMode: 'accrue', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 100000 }] })
  assert.equal(-bal('2104'), 300000, `${activityId}: س11 استحقاق بالصافي`)
  assert.equal(st().getEmployeeAdvanceBalance(edge.id).remainingMinor, 50000, `${activityId}: س11 السلفة استُقطعت رغم الاستحقاق`)
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 120000, description: 'دفعة رواتب' })
  assert.equal(-bal('2104'), 180000, `${activityId}: س11 سداد جزئي`)
  audit('س11')

  // ═══ س12) سداد نقدي يغلق سلفة الافتتاحي المتبقية FIFO ═══
  const vetRemaining = st().getEmployeeAdvanceBalance(veteran.id).remainingMinor
  st().repayEmployeeAdvance({ employeeId: veteran.id, amountMinor: vetRemaining, treasury: '1101' })
  assert.equal(st().getEmployeeAdvanceBalance(veteran.id).remainingMinor, 0, `${activityId}: س12`)
  audit('س12')

  // ═══ س13) الحمايات: حذف/تكرار/مسير مكرر/سلفة موظف شبح ═══
  assert.throws(() => st().removeEmployee(banker.id), /مسيرات رواتب/, `${activityId}: س13-حذف`)
  assert.throws(() => st().addEmployee({ nameAr: `قديم ${nameAr}`, phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '', notes: '' }), /بنفس الاسم/, `${activityId}: س13-تكرار`)
  assert.throws(() => st().postPayroll({ month: '2026-06', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: edge.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] }), /مرحّل بالفعل/, `${activityId}: س13-شهر مكرر`)
  assert.throws(() => st().grantEmployeeAdvance({ employeeId: 9999, amountMinor: 1000, treasury: '1101', notes: '' }), /الموظف غير موجود/, `${activityId}: س13-موظف شبح`)
  audit('س13')

  // ═══ س14) موظف نظيف بلا أثر يُحذف + الجزاءات صفوف توثيقية بالكشف ═══
  st().addEmployee({ nameAr: `عابر ${nameAr}`, phone: '', jobTitle: '', salaryMinor: 100000, hiredAt: '2026-01-01', notes: '' })
  st().removeEmployee(st().employees.at(-1).id)
  const bankerRows = employeeStatement({ employeeId: banker.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  const dedRows = bankerRows.filter((r) => r.docLabel.includes('جزاء'))
  assert.ok(dedRows.length >= 2 && dedRows.every((r) => r.debitMinor === 0 && r.creditMinor === 0), `${activityId}: س14 صفوف الجزاءات`)
  assert.ok(dedRows.some((r) => r.docLabel.includes('معفو عنه')), `${activityId}: س14 حالة العفو ظاهرة`)
  audit('س14')

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): 14 سيناريو × ${audits} تدقيقاً دفترياً — ${st().journal.length} قيداً، 1107 = Σ السجلات دائماً`)
}

assert.equal(pass, 16)
console.log(`\n✅ verify_employees_recheck_16: إعادة الفحص الكاملة — كل السيناريوهات سليمة على الأنشطة الـ16`)
