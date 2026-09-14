// تحقق وحدة إيجار المعدات (المرحلة 6 — القرار 13):
// validateRental، computeRentalTotals، قيدا الفتح والإقفال (توازن + تركيب)، rentalReport
// التشغيل: node --experimental-strip-types scripts/verify_rental.mjs
import {
  validateRental,
  computeRentalTotals,
  buildRentalOpenEntry,
  buildRentalCloseEntry,
  rentalReport,
} from '../src/core/rental.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const base = {
  equipmentName: 'حفار كاتربيلر 320',
  days: 5,
  dailyRateMinor: 200000, // 2000.00 يومياً
  depositMinor: 500000, // 5000.00 تأمين
  payment: 'cash',
  vatPercent: 0,
}

console.log('— validateRental —')
check('عقد سليم بلا أخطاء', validateRental(base).length === 0)
check('يرفض معدة بلا اسم', validateRental({ ...base, equipmentName: ' ' }).some((e) => e.includes('المعدة')))
check('يرفض days=0', validateRental({ ...base, days: 0 }).length === 1)
check('يرفض days كسرية', validateRental({ ...base, days: 2.5 }).length === 1)
check('يرفض days>3650', validateRental({ ...base, days: 3651 }).length === 1)
check('يرفض سعراً يومياً صفرياً', validateRental({ ...base, dailyRateMinor: 0 }).length === 1)
check('يرفض تأميناً سالباً', validateRental({ ...base, depositMinor: -1 }).length === 1)
check('يقبل تأميناً صفرياً', validateRental({ ...base, depositMinor: 0 }).length === 0)
check('يرفض ضريبة سالبة', validateRental({ ...base, vatPercent: -1 }).length === 1)

console.log('— computeRentalTotals —')
const t1 = computeRentalTotals(base)
check('rent = 5×2000 = 10000.00', t1.rentMinor === 1000000)
check('بلا ضريبة: grand=rent', t1.grandMinor === 1000000)
check('نقدي: يُقبض rent+deposit', t1.collectCashMinor === 1500000)
check('نقدي: لا آجل', t1.collectCreditMinor === 0)

const t2 = computeRentalTotals({ ...base, payment: 'credit', vatPercent: 15 })
check('vat 15% = 1500.00', t2.vatMinor === 150000)
check('grand = rent+vat', t2.grandMinor === 1150000)
check('آجل: نقداً يُقبض التأمين فقط', t2.collectCashMinor === 500000)
check('آجل: على العميل grand', t2.collectCreditMinor === 1150000)

const t3 = computeRentalTotals({ ...base, depositMinor: 0 })
check('بلا تأمين نقدي: يُقبض rent فقط', t3.collectCashMinor === 1000000)

console.log('— buildRentalOpenEntry —')
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const find = (lines, code) => lines.filter((l) => l.accountCode === code)

const e1 = buildRentalOpenEntry(t1, 'RC-0001')
check('نقدي: مدين 1101 = rent+deposit', find(e1, '1101')[0].debit === 1500000)
check('دائن 4104 = rent', find(e1, '4104')[0].credit === 1000000)
check('دائن 2103 = deposit (التزام لا إيراد)', find(e1, '2103')[0].credit === 500000)
check('لا سطر 1104 في النقدي', find(e1, '1104').length === 0)
check('لا سطر ضريبة عند vat=0', find(e1, '2102').length === 0)
check('قيد الفتح متوازن', sum(e1, 'debit') === sum(e1, 'credit'))

const e2 = buildRentalOpenEntry(t2, 'RC-0002')
check('آجل: مدين 1101 = التأمين فقط', find(e2, '1101')[0].debit === 500000)
check('آجل: مدين 1104 = grand', find(e2, '1104')[0].debit === 1150000)
check('سطر ضريبة 2102 = vat', find(e2, '2102')[0].credit === 150000)
check('قيد آجل متوازن', sum(e2, 'debit') === sum(e2, 'credit'))
check('عدد سطوره 5', e2.length === 5)

const e3 = buildRentalOpenEntry(t3, 'RC-0003')
check('بلا تأمين: لا سطر 2103', find(e3, '2103').length === 0)

let threw = false
try { buildRentalOpenEntry({ ...t1, rentMinor: 0 }, 'RC-X') } catch { threw = true }
check('يرفض إيجاراً صفرياً', threw)

console.log('— buildRentalCloseEntry —')
const c1 = buildRentalCloseEntry(500000, 0, 'RC-0001')
check('ردّ كامل: مدين 2103 = deposit', find(c1, '2103')[0].debit === 500000)
check('ردّ كامل: دائن 1101 = deposit', find(c1, '1101')[0].credit === 500000)
check('ردّ كامل: لا سطر إيراد', find(c1, '4104').length === 0)
check('متوازن', sum(c1, 'debit') === sum(c1, 'credit'))

const c2 = buildRentalCloseEntry(500000, 120000, 'RC-0002')
check('خصم أضرار: دائن 1101 = المردود 3800.00', find(c2, '1101')[0].credit === 380000)
check('خصم أضرار: دائن 4104 = الخصم', find(c2, '4104')[0].credit === 120000)
check('متوازن', sum(c2, 'debit') === sum(c2, 'credit'))

const c3 = buildRentalCloseEntry(500000, 500000, 'RC-0003')
check('مصادرة كاملة: لا سطر ردّ نقدي', find(c3, '1101').length === 0)
check('مصادرة كاملة: الإيراد = كامل التأمين', find(c3, '4104')[0].credit === 500000)

check('بلا تأمين: يعيد null (لا قيد)', buildRentalCloseEntry(0, 0, 'RC-X') === null)
threw = false
try { buildRentalCloseEntry(100, 200, 'RC-X') } catch { threw = true }
check('يرفض خصماً يتجاوز التأمين', threw)
threw = false
try { buildRentalCloseEntry(100, -5, 'RC-X') } catch { threw = true }
check('يرفض خصماً سالباً', threw)

console.log('— rentalReport —')
const mk = (id, date, rent, deposit, status) => ({
  id, contractNumber: `RC-${String(id).padStart(4, '0')}`, date,
  customerId: null, equipmentName: 'حفار', days: 3, status,
  totals: { rentMinor: rent, vatMinor: 0, grandMinor: rent, depositMinor: deposit, collectCashMinor: rent + deposit, collectCreditMinor: 0 },
})
const contracts = [
  mk(2, '2026-02-01T08:00:00.000Z', 300000, 100000, 'active'),
  mk(1, '2026-01-10T08:00:00.000Z', 500000, 200000, 'closed'),
  mk(3, '2026-02-15T08:00:00.000Z', 200000, 50000, 'active'),
]
const r = rentalReport(contracts, { from: '2026-01-01', to: '2026-02-28' })
check('يشمل الثلاثة مرتبة بالتاريخ', r.rows.map((x) => x.contractId).join(',') === '1,2,3')
check('إجمالي الإيجار', r.totalRentMinor === 1000000)
check('عدد النشطة 2', r.activeCount === 2)
check('التأمينات المحتجزة = النشطة فقط', r.heldDepositsMinor === 150000)
const rFeb = rentalReport(contracts, { from: '2026-02-01', to: '2026-02-28' })
check('تصفية فبراير', rFeb.rows.length === 2 && rFeb.totalRentMinor === 500000)

console.log(`\nإيجار المعدات: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
