// تحقق دفعات الصلاحية FEFO (القراران 5 و8):
// ترتيب FEFO، تخطيط وتطبيق الصرف، حظر المنتهي، تنبيهات الصلاحية
// التشغيل: node --experimental-strip-types scripts/verify_batches.mjs
import {
  sortFefo,
  planFefo,
  applyFefo,
  expiryAlerts,
  expiredQty,
  isValidExpiryDate,
  ExpiredStockError,
} from '../src/core/batches.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const b = (id, itemId, expiryDate, qty, receivedAt = '2026-01-01T00:00:00.000Z') =>
  ({ id, itemId, expiryDate, qty, purchaseId: null, receivedAt })

console.log('— isValidExpiryDate —')
check('تاريخ سليم', isValidExpiryDate('2026-12-31'))
check('يرفض 2026-02-30 (يوم غير موجود)', !isValidExpiryDate('2026-02-30'))
check('يرفض 2026-13-01 (شهر 13)', !isValidExpiryDate('2026-13-01'))
check('يرفض صيغة خاطئة', !isValidExpiryDate('31/12/2026'))
check('يقبل 29 فبراير بسنة كبيسة', isValidExpiryDate('2028-02-29') && !isValidExpiryDate('2026-02-29'))

console.log('— sortFefo —')
const unsorted = [b(1, 1, null, 5), b(2, 1, '2026-12-01', 5), b(3, 1, '2026-03-01', 5), b(4, 1, '2026-03-01', 5, '2025-06-01T00:00:00.000Z')]
const sorted = sortFefo(unsorted)
check('الأقرب انتهاءً أولاً', sorted[0].expiryDate === '2026-03-01')
check('نفس التاريخ: الأقدم استلاماً أولاً', sorted[0].id === 4 && sorted[1].id === 3)
check('بلا تاريخ في الآخر', sorted[3].id === 1)
check('لا يعدّل الأصل', unsorted[0].id === 1)

console.log('— planFefo —')
const TODAY = '2026-09-14T12:00:00.000Z'
const batches = [
  b(1, 1, '2026-08-01', 3), // منتهية (قبل اليوم)
  b(2, 1, '2026-10-01', 5), // سليمة
  b(3, 1, '2027-01-01', 10), // سليمة أبعد
  b(4, 2, '2026-12-01', 4), // صنف آخر
]
// FEFO يبدأ بالمنتهية (الأقرب انتهاءً) — وهذا ما يفعّل الحظر
const p1 = planFefo(batches, 1, 2, TODAY)
check('يصرف من الأقرب انتهاءً (المنتهية)', p1.allocations[0].batchId === 1 && p1.allocations[0].qty === 2)
check('يعلّم أنها تمس منتهياً', p1.touchesExpired === true)
const p2 = planFefo(batches, 1, 6, TODAY)
check('يمتد عبر دفعتين 3+3', p2.allocations.length === 2 && p2.allocations[0].qty === 3 && p2.allocations[1].qty === 3)
check('الدفعة الثانية سليمة', p2.allocations[1].expired === false)
const p3 = planFefo(batches, 1, 25, TODAY)
check('فوق المتتبَّع: untracked=7', p3.untrackedQty === 7)
check('كمية صنف آخر لا تتأثر', planFefo(batches, 2, 4, TODAY).allocations[0].batchId === 4)
const p4 = planFefo(batches, 9, 5, TODAY)
check('صنف بلا دفعات: كله untracked بلا اعتراض', p4.allocations.length === 0 && p4.untrackedQty === 5 && !p4.touchesExpired)
// كسور وزنية
const pw = planFefo([b(9, 3, '2026-10-01', 0.3)], 3, 0.1 + 0.2, TODAY)
check('كسور: 0.3 تُصرف كاملة بلا بقايا عائمة', pw.allocations[0].qty === 0.3 && pw.untrackedQty === 0)

console.log('— applyFefo —')
const after = applyFefo(batches, p2) // صرف 3+3 من الصنف 1
check('الدفعة المنتهية استُهلكت وحُذفت', !after.some((x) => x.id === 1))
check('الثانية نقصت 5−3=2', after.find((x) => x.id === 2).qty === 2)
check('الثالثة كما هي', after.find((x) => x.id === 3).qty === 10)
check('صنف آخر لم يُمس', after.find((x) => x.id === 4).qty === 4)
// بعد الصرف: البيع التالي لا يمس منتهياً
check('بعد الصرف لا منتهي متبقٍ', planFefo(after, 1, 2, TODAY).touchesExpired === false)

console.log('— ExpiredStockError —')
const err = new ExpiredStockError(['لبن', 'زبادي'])
check('يحمل أسماء الأصناف', err.itemNames.length === 2 && err.itemNames[0] === 'لبن')
check('رسالة عربية بذكر القرار 8', err.message.includes('منتهية الصلاحية') && err.message.includes('المدير'))
check('instanceof يعمل (للكاشير)', err instanceof ExpiredStockError && err instanceof Error)

console.log('— expiryAlerts / expiredQty —')
const names = { 1: 'لبن', 2: 'جبنة' }
const alerts = expiryAlerts(batches, (id) => names[id] ?? '؟', TODAY, 30)
check('منتهية + تنتهي خلال 30 يوماً فقط', alerts.length === 2)
check('المنتهي أولاً بأيام سالبة', alerts[0].status === 'expired' && alerts[0].daysLeft < 0)
check('القريبة soon بأيامها', alerts[1].status === 'soon' && alerts[1].daysLeft === 17)
check('البعيدة (2027) خارج الأفق', !alerts.some((a) => a.expiryDate === '2027-01-01'))
const alertsWide = expiryAlerts(batches, (id) => names[id] ?? '؟', TODAY, 120)
check('أفق أوسع يشمل ديسمبر', alertsWide.some((a) => a.expiryDate === '2026-12-01'))
check('expiredQty للصنف 1 = 3', expiredQty(batches, 1, TODAY) === 3)
check('expiredQty لصنف سليم = 0', expiredQty(batches, 2, TODAY) === 0)

console.log(`\nالدفعات: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
