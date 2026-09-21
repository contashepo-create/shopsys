// تحقق وحدة الصيانة (المرحلة 6 — القرار 13):
// حالات التذكرة وانتقالاتها، validateTicket/validateDelivery،
// computeTicketTotals، قيد التسليم (توازن + تركيب)، maintenanceReport
// التشغيل: node --experimental-strip-types scripts/verify_maintenance.mjs
import {
  validateTicket,
  validateDelivery,
  computeTicketTotals,
  buildTicketDeliveryEntry,
  maintenanceReport,
  TICKET_TRANSITIONS,
  TICKET_STATUS_LABELS,
} from '../src/core/maintenance.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('— الحالات والانتقالات —')
check('خمس حالات معنونة', Object.keys(TICKET_STATUS_LABELS).length === 5)
check('مستلَمة → تحت الصيانة مسموح', TICKET_TRANSITIONS.received.includes('in_progress'))
check('مستلَمة → مسلَّمة ممنوع (لا تسليم بلا جاهزية)', !TICKET_TRANSITIONS.received.includes('delivered'))
check('جاهزة → مسلَّمة مسموح', TICKET_TRANSITIONS.ready.includes('delivered'))
check('جاهزة → تحت الصيانة (تراجع) مسموح', TICKET_TRANSITIONS.ready.includes('in_progress'))
check('مسلَّمة نهائية', TICKET_TRANSITIONS.delivered.length === 0)
check('ملغاة نهائية', TICKET_TRANSITIONS.cancelled.length === 0)

console.log('— validateTicket —')
check('تذكرة سليمة', validateTicket({ deviceName: 'آيفون 13', issue: 'شاشة مكسورة' }).length === 0)
check('يرفض جهازاً فارغاً', validateTicket({ deviceName: ' ', issue: 'عطل' }).length === 1)
check('يرفض عطلاً فارغاً', validateTicket({ deviceName: 'آيفون', issue: '' }).length === 1)

console.log('— validateDelivery / computeTicketTotals —')
const part = (price, cost, qty = 1) => ({ itemId: 1, nameAr: 'شاشة', qty, unitPriceMinor: price, unitCostMinor: cost })
const base = { laborMinor: 50000, parts: [], payment: 'cash', vatPercent: 0 } // أجرة 500.00

check('تسليم بأجرة فقط سليم', validateDelivery(base).length === 0)
check('يرفض أجرة سالبة', validateDelivery({ ...base, laborMinor: -1 }).length >= 1)
check('يرفض إجمالياً صفرياً', validateDelivery({ ...base, laborMinor: 0 }).some((e) => e.includes('موجباً')))
check('قطع فقط بلا أجرة سليم', validateDelivery({ ...base, laborMinor: 0, parts: [part(30000, 20000)] }).length === 0)
check('يرفض قطعة بكمية صفرية', validateDelivery({ ...base, parts: [part(100, 50, 0)] }).length === 1)
check('يرفض قطعة بلا اسم', validateDelivery({ ...base, parts: [{ ...part(100, 50), nameAr: '' }] }).length === 1)
check('يرفض ضريبة 101', validateDelivery({ ...base, vatPercent: 101 }).length === 1)

const t1 = computeTicketTotals({ ...base, parts: [part(60000, 35000, 2)], vatPercent: 15 })
check('partsPrice = 2×600 = 1200.00', t1.partsPriceMinor === 120000)
check('partsCost = 2×350 = 700.00', t1.partsCostMinor === 70000)
check('revenue = labor+parts = 1700.00', t1.revenueMinor === 170000)
check('vat 15% = 255.00', t1.vatMinor === 25500)
check('grand = 1955.00', t1.grandMinor === 195500)

console.log('— buildTicketDeliveryEntry —')
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const find = (lines, code) => lines.filter((l) => l.accountCode === code)

const e1 = buildTicketDeliveryEntry(t1, 'cash', 'MT-0001')
check('نقدي: مدين 1101 = grand', find(e1, '1101')[0].debit === t1.grandMinor)
check('دائن 4103 = revenue', find(e1, '4103')[0].credit === t1.revenueMinor)
check('دائن 2102 = vat', find(e1, '2102')[0].credit === t1.vatMinor)
check('مدين 5101 = تكلفة القطع', find(e1, '5101')[0].debit === t1.partsCostMinor)
check('دائن 1103 = تكلفة القطع (صرف مخزون)', find(e1, '1103')[0].credit === t1.partsCostMinor)
check('القيد متوازن', sum(e1, 'debit') === sum(e1, 'credit'))
check('عدد السطور 5', e1.length === 5)

const t2 = computeTicketTotals({ ...base, payment: 'credit' }) // أجرة فقط بلا قطع ولا ضريبة — آجل بالكامل (الأمر 23: القيد يتبع paid/credit)
const e2 = buildTicketDeliveryEntry(t2, 'credit', 'MT-0002')
check('آجل: المدين 1104', find(e2, '1104')[0].debit === t2.grandMinor)
check('بلا قطع: لا سطر 5101/1103', find(e2, '5101').length === 0 && find(e2, '1103').length === 0)
check('بلا ضريبة: لا سطر 2102', find(e2, '2102').length === 0)
check('سطران فقط ومتوازن', e2.length === 2 && sum(e2, 'debit') === sum(e2, 'credit'))

let threw = false
try { buildTicketDeliveryEntry({ ...t2, revenueMinor: 0, grandMinor: 0 }, 'cash', 'MT-X') } catch { threw = true }
check('يرفض إيراداً صفرياً', threw)

console.log('— maintenanceReport —')
const mk = (id, date, status, totals) => ({
  id, ticketNumber: `MT-${String(id).padStart(4, '0')}`, date,
  customerId: null, deviceName: 'آيفون', status, totals,
})
const done = { laborMinor: 50000, partsPriceMinor: 100000, partsCostMinor: 60000, revenueMinor: 150000, vatMinor: 0, grandMinor: 150000 }
const tickets = [
  mk(2, '2026-02-05T08:00:00.000Z', 'delivered', done),
  mk(1, '2026-01-10T08:00:00.000Z', 'in_progress', null),
  mk(3, '2026-02-20T08:00:00.000Z', 'cancelled', null),
]
const r = maintenanceReport(tickets, { from: '2026-01-01', to: '2026-02-28' })
check('يشمل الثلاث مرتبة بالتاريخ', r.rows.map((x) => x.ticketId).join(',') === '1,2,3')
check('الإيراد من المسلَّمة فقط', r.totalRevenueMinor === 150000)
check('الربح = revenue−partsCost', r.totalProfitMinor === 90000)
check('المفتوحة = 1 (الملغاة والمسلَّمة لا تُعدّان)', r.openCount === 1)
const rJan = maintenanceReport(tickets, { from: '2026-01-01', to: '2026-01-31' })
check('تصفية يناير', rJan.rows.length === 1 && rJan.totalRevenueMinor === 0)

console.log(`\nالصيانة: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
