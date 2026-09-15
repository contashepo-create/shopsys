// تحقق وحدة اللوجستيات (المرحلة 6 — القرار 13):
// validateTrip، computeTripTotals، buildTripEntry (توازن + تركيب السطور)، tripProfitReport
// التشغيل: node --experimental-strip-types scripts/verify_logistics.mjs
import {
  validateTrip,
  computeTripTotals,
  buildTripEntry,
  tripProfitReport,
  EXPENSE_SOURCE_LABELS,
} from '../src/core/logistics.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const baseInput = {
  fromLoc: 'ميناء الدمام',
  toLoc: 'الرياض',
  qty: 2,
  unitPriceMinor: 150000, // 1500.00
  expenses: [],
  payment: 'cash',
  vatPercent: 0,
  containerNumbers: [],
}

console.log('— validateTrip —')
check('نقلة سليمة بلا أخطاء', validateTrip(baseInput).length === 0)
check('يرفض جهة انطلاق فارغة', validateTrip({ ...baseInput, fromLoc: '  ' }).some((e) => e.includes('الانطلاق')))
check('يرفض جهة وصول فارغة', validateTrip({ ...baseInput, toLoc: '' }).some((e) => e.includes('الوصول')))
check('يرفض qty=0', validateTrip({ ...baseInput, qty: 0 }).length === 1)
check('يرفض qty كسري', validateTrip({ ...baseInput, qty: 1.5 }).length === 1)
check('يرفض qty>1000', validateTrip({ ...baseInput, qty: 1001 }).length === 1)
check('يرفض سعر صفر', validateTrip({ ...baseInput, unitPriceMinor: 0 }).length === 1)
check('يرفض سعر سالب', validateTrip({ ...baseInput, unitPriceMinor: -5 }).length === 1)
check('يرفض ضريبة 101', validateTrip({ ...baseInput, vatPercent: 101 }).length === 1)
check('يرفض حاويات أكثر من العدد', validateTrip({ ...baseInput, containerNumbers: ['A', 'B', 'C'] }).some((e) => e.includes('الحاويات')))
check('يقبل حاويات = العدد', validateTrip({ ...baseInput, containerNumbers: ['A', 'B'] }).length === 0)
check('يتجاهل حاويات فارغة في العدّ', validateTrip({ ...baseInput, containerNumbers: ['A', 'B', ' ', ''] }).length === 0)
check('يرفض مصروفاً بلا بيان', validateTrip({ ...baseInput, expenses: [{ nameAr: '', qty: 1, unitAmountMinor: 100, source: 'cash' }] }).some((e) => e.includes('البيان')))
check('يرفض مصروفاً بقيمة صفر', validateTrip({ ...baseInput, expenses: [{ nameAr: 'سولار', qty: 1, unitAmountMinor: 0, source: 'cash' }] }).length === 1)
check('يرفض مصروفاً بعدد صفر', validateTrip({ ...baseInput, expenses: [{ nameAr: 'سولار', qty: 0, unitAmountMinor: 100, source: 'cash' }] }).length === 1)

console.log('— computeTripTotals —')
const t1 = computeTripTotals(baseInput)
check('base = qty×unitPrice = 3000.00', t1.baseMinor === 300000)
check('بلا مصاريف: revenue=base', t1.revenueMinor === 300000)
check('بلا ضريبة: grand=revenue', t1.grandMinor === 300000)
check('بلا مصاريف: cost=0 وprofit=revenue', t1.costMinor === 0 && t1.profitMinor === 300000)

const withExp = {
  ...baseInput,
  vatPercent: 15,
  expenses: [
    { nameAr: 'سولار', qty: 2, unitAmountMinor: 20000, source: 'cash' }, // 400.00 نقدي
    { nameAr: 'تفويج', qty: 1, unitAmountMinor: 15000, source: 'customer' }, // 150.00 على العميل
    { nameAr: 'كارت طريق', qty: 2, unitAmountMinor: 5000, source: 'credit' }, // 100.00 آجل
  ],
}
const t2 = computeTripTotals(withExp)
check('billable = مصاريف العميل = 150.00', t2.billableMinor === 15000)
check('revenue = base+billable = 3150.00', t2.revenueMinor === 315000)
check('vat 15% على revenue = 472.50', t2.vatMinor === 47250)
check('grand = revenue+vat', t2.grandMinor === 362250)
check('directCash = 400.00', t2.directCashMinor === 40000)
check('credit = 100.00', t2.creditMinor === 10000)
check('cost = 500.00', t2.costMinor === 50000)
check('profit = revenue−cost = 2650.00', t2.profitMinor === 265000)
// مصاريف العميل لا تدخل التكلفة (تمريرة محايدة تزيد الإيراد فقط)
check('مصروف العميل ليس تكلفة', t2.costMinor === t2.directCashMinor + t2.creditMinor)

console.log('— buildTripEntry —')
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const find = (lines, code) => lines.filter((l) => l.accountCode === code)

const e1 = buildTripEntry(t1, 'cash', 'TR-0001')
check('نقدي بلا مصاريف/ضريبة: سطران فقط', e1.length === 2)
check('مدين 1101 = grand', find(e1, '1101')[0].debit === t1.grandMinor)
check('دائن 4105 = revenue', find(e1, '4105')[0].credit === t1.revenueMinor)
check('القيد متوازن', sum(e1, 'debit') === sum(e1, 'credit'))
check('لا سطر ضريبة عند vat=0', find(e1, '2102').length === 0)

const e2 = buildTripEntry(t2, 'credit', 'TR-0002')
check('آجل: المدين 1104 (العملاء)', find(e2, '1104')[0]?.debit === t2.grandMinor)
check('سطر ضريبة 2102 دائن', find(e2, '2102')[0]?.credit === t2.vatMinor)
check('مدين 5106 = التكلفة', find(e2, '5106')[0]?.debit === t2.costMinor)
check('دائن 1101 = المصاريف النقدية', find(e2, '1101')[0]?.credit === t2.directCashMinor)
check('دائن 2113 = المصاريف الآجلة (إصلاح: لا تلمس ذمم الموردين 2101)', find(e2, '2113')[0]?.credit === t2.creditMinor && !find(e2, '2101').length)
check('القيد المركب متوازن', sum(e2, 'debit') === sum(e2, 'credit'))
check('عدد السطور 6', e2.length === 6)

// مصاريف نقدية فقط (بلا آجل) → لا سطر 2101
const t3 = computeTripTotals({ ...baseInput, expenses: [{ nameAr: 'سولار', qty: 1, unitAmountMinor: 30000, source: 'cash' }] })
const e3 = buildTripEntry(t3, 'cash', 'TR-0003')
check('مصاريف نقدية فقط: لا سطر 2101', find(e3, '2101').length === 0)
check('سطر 1101 مرتان (تحصيل + صرف)', find(e3, '1101').length === 2)
check('متوازن', sum(e3, 'debit') === sum(e3, 'credit'))

let threw = false
try { buildTripEntry({ ...t1, revenueMinor: 0 }, 'cash', 'TR-X') } catch { threw = true }
check('يرفض إيراداً صفرياً', threw)

console.log('— tripProfitReport —')
const mkTrip = (id, date, revenue, cost, extra = {}) => ({
  id, tripNumber: `TR-${String(id).padStart(4, '0')}`, date,
  customerId: null, fromLoc: 'أ', toLoc: 'ب', qty: 1,
  totals: { baseMinor: revenue, billableMinor: 0, revenueMinor: revenue, vatMinor: 0, grandMinor: revenue, directCashMinor: cost, creditMinor: 0, costMinor: cost, profitMinor: revenue - cost },
  ...extra,
})
const trips = [
  mkTrip(3, '2026-02-10T08:00:00.000Z', 100000, 40000),
  mkTrip(1, '2026-01-05T08:00:00.000Z', 200000, 50000),
  mkTrip(2, '2026-01-20T08:00:00.000Z', 50000, 60000), // خاسرة
]
const rAll = tripProfitReport(trips, { from: '2026-01-01', to: '2026-02-28' })
check('يشمل الثلاثة', rAll.rows.length === 3)
check('مرتب تصاعدياً بالتاريخ', rAll.rows.map((r) => r.tripId).join(',') === '1,2,3')
check('إجمالي الإيراد', rAll.totalRevenueMinor === 350000)
check('إجمالي التكلفة', rAll.totalCostMinor === 150000)
check('إجمالي الربح', rAll.totalProfitMinor === 200000)
check('هامش النقلة 1 = 75٪', rAll.rows[0].marginPercent === 75)
check('النقلة الخاسرة هامش سالب', rAll.rows[1].profitMinor === -10000 && rAll.rows[1].marginPercent === -20)
check('المسار «أ ← ب»', rAll.rows[0].route === 'أ ← ب')

const rJan = tripProfitReport(trips, { from: '2026-01-01', to: '2026-01-31' })
check('تصفية يناير فقط', rJan.rows.length === 2 && rJan.totalProfitMinor === 140000)
const rNone = tripProfitReport(trips, { from: '2025-01-01', to: '2025-12-31' })
check('فترة فارغة = صفر صفوف وإجماليات صفرية', rNone.rows.length === 0 && rNone.totalRevenueMinor === 0)

console.log('— تسميات —')
check('تسميات المصادر الثلاثة موجودة', ['cash', 'customer', 'credit'].every((s) => (EXPENSE_SOURCE_LABELS[s] ?? '').length > 0))

console.log(`\nلوجستيات: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
