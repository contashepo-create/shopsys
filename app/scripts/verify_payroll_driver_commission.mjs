/**
 * verify_payroll_driver_commission — عمولة سائق النقلات تظهر وتُصرف مع مسير الرواتب
 *
 * بلاغ المالك: «عمولة سائق لوجيستي لم تظهر في الرواتب عند إصدار مسير».
 * السبب: العمولة تُستحق على 2111 (مستحقات سائقين) بينما المسير كان يقرأ 2116
 * (عمولات موظفي المبيعات) فقط، فلم يكن للسائق أي أثر في المسير.
 *
 * هذا الفحص يثبت:
 * 1) استحقاق عمولة النقلة يرصد رصيداً للسائق (2111) بلا نقدية
 * 2) المسير يعرض/يصرف المستحق: قيد واحد فيه 2111 مدين والخزينة دائنة بالصافي + العمولة
 * 3) لا صرف مزدوج: بعد المسير رصيد السائق صفر وتسوية النقلات تُرفض
 * 4) حارس «كاملة أو لا شيء» وحارس «أكبر من الرصيد»
 * 5) الدفتر متوازن ومصروف النقلات (5106) لم يتضاعف
 * تشغيل: node --experimental-strip-types scripts/verify_payroll_driver_commission.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 0, taxInclusive: false } }, version: 0 }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ` — ${e.message}`}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0 })
const employee = (nameAr, base) => ({ nameAr, phone: '', jobTitle: 'سائق', hireDate: '2026-01-01', baseSalaryMinor: base, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0 })
const line = (employeeId, base, over = {}) => ({ employeeId, baseMinor: base, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, ...over })
const tripInput = (over = {}) => ({ fromLoc: 'الإسكندرية', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 500000, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [], ...over })

S().seed(['logistics'])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 50_000_00, label: 'رصيد افتتاحي' })
S().addCustomer({ ...party('شركة النقل الوطنية'), creditLimitMinor: 0 })
const customerId = S().customers.at(-1).id
S().addEmployee(employee('محمود السائق', 300000))
const driverId = S().employees.at(-1).id
S().addEmployee(employee('سالم الإداري', 400000))
const clerkId = S().employees.at(-1).id

console.log('1️⃣ استحقاق عمولة السائق على النقلة')
S().postTrip({ customerId, vehicleId: null, driverId, input: tripInput(), notes: '', treasury: '1101', driverCommissionMinor: 50000 })
S().postTrip({ customerId, vehicleId: null, driverId, input: tripInput({ unitPriceMinor: 300000 }), notes: '', treasury: '1101', driverCommissionMinor: 30000 })
ok('رصيد مستحقات السائق = مجموع عمولتي النقلتين', S().getDriverDueBalance(driverId) === 80000, String(S().getDriverDueBalance(driverId)))
ok('العمولة استُحقت على 2111 (دائن) ولم تُدفع نقداً', bal('2111') === -80000, String(bal('2111')))
ok('مصروف النقلات 5106 حُمِّل بالعمولة لحظة الاستحقاق', bal('5106') === 80000, String(bal('5106')))
ok('السائق لا عمولات مبيعات له (2116 فارغ)', bal('2116') === 0)
const expense5106 = bal('5106')

console.log('\n2️⃣ حراس المسير قبل الصرف')
throws('صرف أكبر من رصيد السائق مرفوض', () => S().postPayroll({
  month: '2026-08', payMode: 'cash', treasury: '1101', notes: '',
  lines: [line(driverId, 300000, { driverDuesPaidMinor: 90000 })],
}), 'أكبر من رصيده')
throws('صرف جزئي مرفوض — كاملة أو لا شيء', () => S().postPayroll({
  month: '2026-08', payMode: 'cash', treasury: '1101', notes: '',
  lines: [line(driverId, 300000, { driverDuesPaidMinor: 40000 })],
}), 'كاملة مع الراتب')
ok('لم يُرحَّل أي مسير بعد الرفض', S().payrollRuns.length === 0)

console.log('\n3️⃣ المسير يصرف عمولة النقلات مع الراتب')
const cashBefore = bal('1101')
const run = S().postPayroll({
  month: '2026-08', payMode: 'cash', treasury: '1101', notes: '',
  lines: [line(driverId, 300000, { driverDuesPaidMinor: 80000 }), line(clerkId, 400000)],
})
const entry = S().journal.find((e) => e.id === run.journalEntryId)
ok('سطر المسير يحمل عمولة النقلات المصروفة', run.lines.find((l) => l.employeeId === driverId).driverDuesPaidMinor === 80000)
ok('إجماليات المسير تُظهر عمولات النقلات', run.totals.driverDuesPaidMinor === 80000, String(run.totals.driverDuesPaidMinor))
ok('قيد المسير يصفّي 2111 مديناً بالعمولة', entry.lines.some((l) => l.accountCode === '2111' && l.debit === 80000 && l.credit === 0))
ok('الخزينة دائنة بالصافي + العمولة', entry.lines.some((l) => l.accountCode === '1101' && l.credit === 700000 + 80000))
ok('مصروف الرواتب 5102 لا يتضخم بالعمولة (حُمِّلت على النقلة)', entry.lines.some((l) => l.accountCode === '5102' && l.debit === 700000))
ok('النقدية انخفضت بالصافي + العمولة', bal('1101') === cashBefore - 780000, String(bal('1101')))
ok('رصيد مستحقات السائق صار صفراً', S().getDriverDueBalance(driverId) === 0)
ok('حساب 2111 صُفّي بالكامل', bal('2111') === 0, String(bal('2111')))
ok('5106 لم يتضاعف بالصرف', bal('5106') === expense5106, String(bal('5106')))
ok('كل مستحقات النقلات موسومة بقيد المسير', S().driverDues.every((d) => d.settled && d.settlementEntryId === run.journalEntryId))

console.log('\n4️⃣ لا صرف مزدوج بعد المسير')
throws('تسوية مستحقات السائق من النقلات مرفوضة بعد صرفها بالمسير', () => S().settleDriverDues(driverId, '1101'), 'لا مستحقات')
S().postTrip({ customerId, vehicleId: null, driverId, input: tripInput({ unitPriceMinor: 200000 }), notes: '', treasury: '1101', driverCommissionMinor: 20000 })
ok('نقلة جديدة تفتح مستحقاً جديداً بعد المسير', S().getDriverDueBalance(driverId) === 20000, String(S().getDriverDueBalance(driverId)))
throws('راتب الشهر نفسه لا يتكرر للسائق', () => S().postPayroll({
  month: '2026-08', payMode: 'cash', treasury: '1101', notes: '',
  lines: [line(driverId, 300000, { driverDuesPaidMinor: 20000 })],
}), 'مرحّل بالفعل')
const run2 = S().postPayroll({
  month: '2026-09', payMode: 'cash', treasury: '1101', notes: '',
  lines: [line(driverId, 300000, { driverDuesPaidMinor: 20000 })],
})
ok('مسير الشهر التالي يصرف المستحق الجديد', run2.totals.driverDuesPaidMinor === 20000)
ok('رصيد السائق صفر بعد المسير الثاني', S().getDriverDueBalance(driverId) === 0)

console.log('\n5️⃣ سلامة الدفتر')
ok('الدفتر متوازن بعد كل الحركات', balanced())
ok('لا مسير بلا عمولة يلمس 2111', S().journal.filter((e) => e.sourceType === 'payroll').every((e) => e.lines.every((l) => l.accountCode !== '2111' || l.debit > 0)))
ok('موظف بلا مستحقات نقلات يمر بلا 2111', (() => {
  const r = S().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', notes: '', lines: [line(clerkId, 400000)] })
  const e = S().journal.find((x) => x.id === r.journalEntryId)
  return r.totals.driverDuesPaidMinor === 0 && e.lines.every((l) => l.accountCode !== '2111')
})())

console.log(`\n${fail ? `💥 فشل ${fail} من ${pass + fail}` : `🎉 نجح الفحص — ${pass} اختباراً`}`)
process.exit(fail ? 1 : 0)
