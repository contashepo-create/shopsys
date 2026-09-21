/**
 * 🚚 رحلة عرضية: عُهد الموظفين + لوجستيات + عيادة
 * 1) ملف عهدة: فتح → تعزيز 1108 → مصروف ضمن الرصيد → زيادة بموافقة (2107 للموظف).
 * 2) تسوية العهدة بعجز → العجز يتحول سلفة 1107 تُخصم من الرواتب.
 * 3) صرف زيادة العهدة مع الراتب (excessPaidMinor يصفي 2107).
 * 4) نقلة: إيراد + مصاريف من 4 مصادر (نقدي/على العميل/آجلة 2113/عهدة 1108)
 *    + عمولة سائق تُستحق 2111 ثم تسوى مجمعة.
 * 5) مرتجع نقلة: يعكس الإيراد نسبياً والمصاريف تبقى (تكبدناها فعلاً).
 * 6) عيادة: مريض بتاريخ مرضي → زيارة بسداد جزئي (4108) → تحصيل متأخرات
 *    → خطة علاج جلسات → مرتجع زيارة بسقف.
 * 7) الميزان الختامي متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_custody_logistics_clinic.mjs
 */
import assert from 'node:assert/strict'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'logistics', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

st().addEmployee({ nameAr: 'رمضان السائق', phone: '0100', jobTitle: 'سائق', hireDate: '2025-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true, notes: '', ...EXT })
const emp = st().employees[0]

console.log('\n═══ 1) عهدة: فتح → تعزيز → مصروف → زيادة بموافقة (2107) ═══')
let file
{
  file = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'مصاريف تشغيل النقلات', notes: '' })
  // مصروف قبل التعزيز بلا موافقة زيادة = مرفوض (رصيد صفر)
  assert.throws(() => st().postCustodyExpense({ fileId: file.id, amountMinor: 1000, description: 'قبل التمويل' }))
  st().fundCustodyFile({ fileId: file.id, amountMinor: 100000, treasury: '1101', description: 'تعزيز أولي' })
  assert.equal(acctBal('1108'), 100000, 'العهدة أصل باسم الموظف')
  st().postCustodyExpense({ fileId: file.id, amountMinor: 30000, description: 'سولار' })
  // مصروف 90000 والرصيد 70000: بلا allowExcess مرفوض، وبموافقة تنقسم 70000 عهدة + 20000 مستحق للموظف
  assert.throws(() => st().postCustodyExpense({ fileId: file.id, amountMinor: 90000, description: 'كارت طريق كبير' }))
  st().postCustodyExpense({ fileId: file.id, amountMinor: 90000, description: 'كارت طريق كبير', allowExcess: true })
  const sum = st().getCustodySummary(file.id)
  assert.equal(sum.remainingMinor, 0, 'العهدة نفدت')
  assert.equal(sum.excessMinor, 20000, 'الزيادة مستحقة للموظف')
  assert.equal(acctBal('2107'), -20000, 'التزام تجاه الموظف')
  assert.equal(st().getEmployeeExcessDue(emp.id), 20000)
  ok('تعزيز 1000، مصروفان (300 + 900 بموافقة زيادة): 200 مستحقة للموظف في 2107')
}

console.log('\n═══ 2) عهدة ثانية تُسوى بعجز → العجز سلفة 1107 ═══')
{
  const f2 = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'عهدة مشوار', notes: '' })
  st().fundCustodyFile({ fileId: f2.id, amountMinor: 50000, treasury: '1101', description: 'تعزيز' })
  st().postCustodyExpense({ fileId: f2.id, amountMinor: 20000, description: 'وقود' })
  // المتبقي 300 لكنه يرد 250 فقط → عجز 50 يتحول سلفة على الموظف
  const before1107 = acctBal('1107')
  const settled = st().settleCustodyFile({ fileId: f2.id, returnedMinor: 25000, treasury: '1101' })
  assert.equal(settled.status, 'settled')
  assert.equal(settled.shortageMinor, 5000)
  assert.equal(acctBal('1107') - before1107, 5000, 'العجز صار سلفة تُخصم من الرواتب')
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 5000)
  // لا مصروف على ملف مقفل
  assert.throws(() => st().postCustodyExpense({ fileId: f2.id, amountMinor: 100, description: 'بعد القفل' }))
  ok('تسوية بعجز 50: رجع 250 نقداً والعجز سلفة 1107 — والملف المقفل مرفوض')
}

console.log('\n═══ 3) مسير يصرف زيادة العهدة ويستقطع سلفة العجز ═══')
{
  st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [
    { employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 5000, excessPaidMinor: 20000 },
  ], notes: '' })
  assert.equal(acctBal('2107'), 0, 'زيادة العهدة صُرفت مع الراتب')
  assert.equal(acctBal('1107'), 0, 'سلفة العجز (السلفة الوحيدة) استُقطعت بالكامل')
  assert.equal(st().getEmployeeExcessDue(emp.id), 0)
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 0, 'سلفة العجز صفر')
  assert.equal(acctBal('5102'), 400000, 'مصروف الرواتب = الأساسي فقط (الزيادة ليست راتباً)')
  ok('المسير صرف زيادة 200 (تصفية 2107) واستقطع عجز 50 — ومصروف الرواتب لم ينتفخ')
}

console.log('\n═══ 4) نقلة بمصاريف من 4 مصادر + عمولة سائق تُستحق ثم تسوى ═══')
{
  st().addCustomer({ nameAr: 'شركة الشحن المتحدة', phone: '0122', creditLimitMinor: 100000000, notes: '', ...EXT })
  st().addVehicle({ plateNumber: 'ق ن ر 1234', vehicleType: 'تريلا', defaultDriverId: emp.id, notes: '' })
  const cust = st().customers[0]
  const veh = st().vehicles[0]
  // عهدة جديدة لتغذية مصاريف النقلة
  const f3 = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'عهدة نقلات الأسبوع', notes: '' })
  st().fundCustodyFile({ fileId: f3.id, amountMinor: 40000, treasury: '1101', description: 'تعزيز' })
  const trip = st().postTrip({
    customerId: cust.id, vehicleId: veh.id, driverId: emp.id,
    input: {
      fromLoc: 'ميناء دمياط', toLoc: 'العاشر من رمضان', qty: 2, unitPriceMinor: 150000,
      payment: 'credit', vatPercent: 14, containerNumbers: ['MSKU111', 'MSKU222'],
      expenses: [
        { nameAr: 'سولار', qty: 2, unitAmountMinor: 20000, source: 'cash' },
        { nameAr: 'تفويج', qty: 2, unitAmountMinor: 5000, source: 'customer' },
        { nameAr: 'كارت طريق', qty: 2, unitAmountMinor: 3000, source: 'credit' },
        { nameAr: 'مبيت سائق', qty: 1, unitAmountMinor: 10000, source: 'custody' },
      ],
    },
    notes: '', custodyFileId: f3.id, driverCommissionMinor: 15000,
  })
  // الإيراد = 300000 + 10000 على العميل = 310000، ض 14% = 43400
  assert.equal(trip.totals.revenueMinor, 310000)
  assert.equal(trip.totals.grandMinor, 310000 + 43400)
  assert.equal(trip.totals.costMinor, 40000 + 6000 + 10000, 'التكلفة = نقدي + آجل + عهدة (بند العميل ليس تكلفة)')
  assert.equal(acctBal('2113'), -6000, 'مصاريف آجلة مستحقة')
  assert.equal(st().getCustodySummary(f3.id).remainingMinor, 30000, 'العهدة نقصت بالمبيت')
  assert.equal(acctBal('2111'), -15000, 'عمولة السائق مستحقة لا مدفوعة')
  assert.equal(st().getDriverDueBalance(emp.id), 15000)
  const r = st().settleDriverDues(emp.id, '1101')
  assert.equal(r.total, 15000)
  assert.equal(acctBal('2111'), 0, 'تسوية مجمعة صفّت المستحق')
  ok('نقلتان بـ3100 + مصاريف من 4 مصادر (تكلفة 560) + عمولة سائق 150 استُحقت ثم سُويت')
}

console.log('\n═══ 5) مرتجع نقلة: يعكس الإيراد والمصاريف تبقى ═══')
{
  const trip = st().trips[0]
  const cost5101Before = acctBal('5101')
  const costTripBefore = acctBal('5110')
  st().refundTrip({ tripId: trip.id, amountMinor: 50000, mode: 'customer_credit', reason: 'تأخير تسليم — تعويض متفق', approvedBy: 'المدير' })
  assert.equal(acctBal('5101'), cost5101Before, 'لا مساس بأي تكلفة')
  assert.equal(acctBal('5110'), costTripBefore, 'مصاريف النقلة باقية — تكبدناها فعلاً')
  // فوق سقف النقلة مرفوض
  assert.throws(() => st().refundTrip({ tripId: trip.id, amountMinor: 99999999, mode: 'cash', treasury: '1101', reason: 'كله', approvedBy: 'المدير' }))
  ok('تعويض 500 على حساب العميل عكس الإيراد نسبياً والمصاريف لم تُمس — والسقف يمنع التجاوز')
}

console.log('\n═══ 6) عيادة: زيارة بسداد جزئي → تحصيل → خطة علاج → مرتجع بسقف ═══')
{
  const p = st().addClinicPatient({ nameAr: 'حسن عبد الفتاح', phone: '0155', gender: 'male', birthDate: '1970-05-10', medicalHistory: '', notes: '' })
  const visit = st().addClinicVisit({
    patientId: p.id, kind: 'consultation', complaint: 'آلام أسفل الظهر', diagnosis: 'شد عضلي', treatment: '',
    feeMinor: 30000, paidMinor: 20000, vatPercent: 0, planId: null, treasury: '1101',
    rxLines: [{ medication: 'مرخي عضلات 500مج', form: 'strip', formQty: 1, timesPerDay: 2, everyHours: 0, mealRelation: 'after', mealsCount: 2, durationDays: 5, repeated: false, repeatTimes: 0, repeatEveryDays: 0, notes: '' }],
    vitals: { bpSys: 130, bpDia: 85, pulse: 78, tempC: 370, weightKg: 920 },
  })
  assert.equal(visit.totals.dueMinor, 10000, 'متبقٍ على المريض')
  assert.equal(st().getPatientBalance(p.id), 10000)
  assert.equal(acctBal('4108'), -30000, 'إيراد الكشف')
  // سداد أكبر من الإجمالي مرفوض
  assert.throws(() => st().addClinicVisit({ patientId: p.id, kind: 'checkup', complaint: 'x', diagnosis: '', treatment: '', feeMinor: 10000, paidMinor: 20000, vatPercent: 0, planId: null }), /أكبر/)
  st().collectFromPatient(p.id, 10000, '1101')
  assert.equal(st().getPatientBalance(p.id), 0, 'المتأخرات حُصلت')
  // خطة علاج 6 جلسات
  const plan = st().addTreatmentPlan({ patientId: p.id, title: 'علاج طبيعي — 6 جلسات', totalSessions: 6, totalFeeMinor: 180000 })
  st().addClinicVisit({ patientId: p.id, kind: 'procedure', complaint: 'جلسة 1', diagnosis: '', treatment: '', feeMinor: 30000, paidMinor: 30000, vatPercent: 0, planId: plan.id, treasury: '1101' })
  // مرتجع زيارة بسقف المدفوع
  st().refundClinicVisit({ visitId: visit.id, amountMinor: 5000, mode: 'cash', treasury: '1101', reason: 'خصم مجاملة', approvedBy: 'الطبيب' })
  assert.throws(() => st().refundClinicVisit({ visitId: visit.id, amountMinor: 99999999, mode: 'cash', treasury: '1101', reason: 'كله', approvedBy: 'الطبيب' }))
  ok('زيارة 300 (سداد جزئي 200) + تحصيل متأخرات + جلسة خطة علاج + مرتجع 50 بسقف')
}

console.log('\n═══ 7) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة العهد واللوجستيات والعيادة: ${pass} محطات — كلها خضراء\n`)
