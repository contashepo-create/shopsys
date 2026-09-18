/**
 * الموظفون والرواتب والخصومات في كل الأنشطة الـ16
 *
 * لكل نشاط متجر نظيف — دورة موظفين كاملة:
 * 1) موظفان (كاشير + إداري) — اسم مكرر يُرفض
 * 2) سلفة نقدية للكاشير بقيد 1107
 * 3) جزاء مسجل DED على الإداري + جزاء يُعفى عنه بمعتمد
 * 4) مسير شهري: استقطاع سلفة جزئي + خصم الجزاء FIFO + سقف 50% يصد
 * 5) قيد المسير: 5102 متوازن والخزينة تنقص الصافي فقط
 * 6) كشف الموظف: الرصيد يطابق 1107 وصفوف الجزاءات ظاهرة
 * 7) حمايات الحذف: عليه سلفة/جزاء لا يُحذف
 * 8) الثوابت: قيود متوازنة و1107 = Σ متبقي السلف
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
const { employeeStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 16)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href

let pass = 0

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?empactivity=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 3000000, label: 'خزينة' })

  // 1) موظفان
  st().addEmployee({ nameAr: `كاشير ${nameAr}`, phone: '0100', jobTitle: 'كاشير', salaryMinor: 600000, hiredAt: '2026-01-01', notes: '' })
  const cashier = st().employees.at(-1)
  st().addEmployee({ nameAr: `إداري ${nameAr}`, phone: '0101', jobTitle: 'إداري', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const admin = st().employees.at(-1)
  assert.throws(() => st().addEmployee({ nameAr: `كاشير ${nameAr}`, phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '', notes: '' }), /بنفس الاسم/, `${activityId}: تكرار`)

  // 2) سلفة
  st().grantEmployeeAdvance({ employeeId: cashier.id, amountMinor: 90000, treasury: '1101', notes: '' })
  assert.equal(bal('1107'), 90000, `${activityId}: 1107 بعد السلفة`)

  // 3) جزاءان: واحد يُخصم وواحد يُعفى عنه
  st().addEmployeeDeduction({ employeeId: admin.id, amountMinor: 40000, reason: 'غياب' })
  const dedWaive = st().addEmployeeDeduction({ employeeId: admin.id, amountMinor: 25000, reason: 'تسجيل خاطئ' })
  st().waiveEmployeeDeduction({ deductionId: dedWaive.id, approvedBy: 'المالك', reason: 'ثبت الخطأ' })
  assert.equal(st().getEmployeeDeductionBalance(admin.id).remainingMinor, 40000, `${activityId}: المتبقي بعد العفو`)

  // 4) سقف 50% يصد ثم مسير سليم
  assert.throws(
    () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: admin.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 300000, advancesMinor: 0 }] }),
    /50%/, `${activityId}: سقف الخصم`,
  )
  const cashBefore = bal('1101')
  const run = st().postPayroll({
    month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
    lines: [
      { employeeId: cashier.id, baseMinor: 600000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 50000 },
      { employeeId: admin.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 20000, deductionsMinor: 40000, advancesMinor: 0 },
    ],
  })
  // الكاشير: 650−50 سلفة=600 · الإداري: 520−40 جزاء=480 ⇒ صافي 1080
  assert.equal(run.totals.netMinor, 1080000, `${activityId}: صافي المسير`)

  // 5) القيد والنقدية
  assert.equal(bal('1101'), cashBefore - 1080000, `${activityId}: الخزينة نقصت الصافي فقط`)
  assert.equal(st().getEmployeeAdvanceBalance(cashier.id).remainingMinor, 40000, `${activityId}: متبقي السلفة`)
  assert.equal(st().getEmployeeDeductionBalance(admin.id).remainingMinor, 0, `${activityId}: الجزاء خُصم`)

  // 6) الكشف
  const rows = employeeStatement({ employeeId: cashier.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.equal(statementBalance(rows), 40000, `${activityId}: كشف الكاشير = متبقي سلفته`)
  const adminRows = employeeStatement({ employeeId: admin.id, advances: st().employeeAdvances, payrollRuns: st().payrollRuns, advanceRepayments: st().advanceRepayments, deductions: st().employeeDeductions })
  assert.ok(adminRows.some((r) => r.docLabel.includes('جزاء')), `${activityId}: الجزاءات في الكشف`)

  // 7) الحمايات
  assert.throws(() => st().removeEmployee(cashier.id), /مسيرات رواتب مرحّلة|سلف غير مستردة/, `${activityId}: حذف مدين`)

  // 8) الثوابت
  for (const e of st().journal) assertBalanced(e.lines)
  const totalRemaining = st().employees.reduce((s, e) => s + st().getEmployeeAdvanceBalance(e.id).remainingMinor, 0)
  assert.equal(bal('1107'), totalRemaining, `${activityId}: 1107 = Σ`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): سلف↔جزاءات↔عفو↔سقف 50%↔مسير — 1107 = Σ المتبقي والكشوف مطابقة`)
}

assert.equal(pass, 16)
console.log(`\n✅ verify_employees_all_activities: دورة الموظفين والخصومات سليمة على الأنشطة الـ${pass}`)
