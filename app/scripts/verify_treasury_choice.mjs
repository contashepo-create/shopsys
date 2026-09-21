/**
 * فحص «اختيار مصدر النقد في كل عملية» (طلب المالك):
 * كل بُناة القيود النقدية عبر الأنشطة تحترم الخزينة/البنك المُمرَّر بدل 1101 الثابتة.
 * تشغيل: node --experimental-strip-types scripts/verify_treasury_choice.mjs
 */
import { buildAssetPurchaseEntry } from '../src/core/assets.ts'
import { buildCarPurchaseEntry, buildCarPrepEntry, buildCarSaleEntry, computeCarSale } from '../src/core/cars.ts'
import { buildVisitEntry, buildPatientCollectionEntry, computeVisitTotals } from '../src/core/clinic.ts'
import { buildExtractEntry, buildProjectCostEntry, buildRetentionReleaseEntry, computeExtractTotals } from '../src/core/contracting.ts'
import { buildLabOrderEntry, buildCommissionPayoutEntry, computeLabTotals } from '../src/core/lab.ts'
import { buildTripEntry, computeTripTotals } from '../src/core/logistics.ts'
import { buildTicketDeliveryEntry, computeTicketTotals } from '../src/core/maintenance.ts'
import { buildRentalOpenEntry, buildRentalCloseEntry, computeRentalTotals } from '../src/core/rental.ts'
import { buildExtraUsageEntry } from '../src/core/rentalMeter.ts'
import { buildPurchaseReturnEntry } from '../src/core/purchases.ts'

let pass = 0, fail = 0
const BANK = '1102'
const uses = (lines, code) => lines.some((l) => l.accountCode === code && (l.debit > 0 || l.credit > 0))
const balanced = (lines) => lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0
const ok = (name, lines, expectBank = true) => {
  const good = balanced(lines) && uses(lines, BANK) === expectBank && !uses(lines, '1101')
  good ? pass++ : fail++
  console.log(`  ${good ? '✅' : '❌'} ${name}`)
}

console.log('🏦 كل نشاط يحترم البنك 1102 المختار (ولا يلمس 1101)')

ok('أصل ثابت مدفوع من البنك', buildAssetPurchaseEntry(100000, 60000, 'FA-0001', BANK))
ok('شراء سيارة نقدي من البنك', buildCarPurchaseEntry(500000, 'cash', 'سيارة', BANK))
ok('تجهيز سيارة نقدي من البنك', buildCarPrepEntry(20000, 'cash', 'سمكرة', BANK))
{
  const t = computeCarSale(600000, 520000, 0)
  ok('بيع سيارة نقدي للبنك', buildCarSaleEntry(t, 'cash', 'بيع', BANK))
}
{
  const t = computeVisitTotals({ kind: 'checkup', feeMinor: 30000, paidMinor: 30000, vatPercent: 0 })
  ok('زيارة عيادة محصلة للبنك', buildVisitEntry(t, 'زيارة', BANK))
}
ok('تحصيل من مريض للبنك', buildPatientCollectionEntry(15000, 'مريض', BANK))
{
  const t = computeExtractTotals(100000, 5, 0)
  ok('مستخلص نقدي للبنك', buildExtractEntry(t, 'cash', 'EXT-1', BANK))
}
ok('تكلفة مشروع نقدية من البنك', buildProjectCostEntry(40000, 'cash', 'خامات', BANK))
ok('إفراج محتجزات للبنك', buildRetentionReleaseEntry(5000, 'مشروع', BANK))
{
  const t = computeLabTotals([20000, 15000], 0, 0)
  ok('طلب تحاليل نقدي للبنك', buildLabOrderEntry(t, 'cash', 'LAB-1', BANK))
}
ok('صرف عمولات محيل من البنك', buildCommissionPayoutEntry(8000, 'د. أحمد', BANK))
{
  const t = computeTripTotals({ fromLoc: 'ميناء', toLoc: 'مخزن', qty: 2, unitPriceMinor: 5000, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [] })
  ok('نقلة محصلة للبنك', buildTripEntry(t, 'cash', 'TRIP-1', BANK))
}
{
  const t = computeTicketTotals({ laborMinor: 20000, parts: [], payment: 'cash', vatPercent: 0 })
  ok('تسليم صيانة محصل للبنك', buildTicketDeliveryEntry(t, 'cash', 'TCK-1', BANK))
}
{
  const t = computeRentalTotals({ equipmentName: 'حفار', days: 3, dailyRateMinor: 10000, depositMinor: 5000, payment: 'cash', vatPercent: 0 })
  ok('فتح عقد إيجار محصل للبنك', buildRentalOpenEntry(t, 'RC-1', BANK))
  const close = buildRentalCloseEntry(5000, 1000, 'RC-1', BANK)
  ok('إقفال العقد يرد التأمين من البنك', close)
}
ok('تجاوز استخدام نقدي للبنك', buildExtraUsageEntry(7000, 0, 'cash', 'RC-1', BANK))
ok('مرتجع شراء نقدي يرد للبنك', buildPurchaseReturnEntry(12000, 'cash', BANK))

// الافتراضي يبقى 1101 لو لم يُمرَّر شيء (توافق رجعي)
{
  const lines = buildPurchaseReturnEntry(12000, 'cash')
  const good = lines.some((l) => l.accountCode === '1101' && l.debit === 12000)
  good ? pass++ : fail++
  console.log(`  ${good ? '✅' : '❌'} الافتراضي بلا تمرير = 1101 (توافق رجعي)`)
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 نجح فحص اختيار مصدر النقد في كل الأنشطة')
