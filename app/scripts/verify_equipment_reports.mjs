/**
 * فحص بطاقة تقرير المعدة الشاملة (وحدة تقارير المعدات — طلب المالك):
 * equipmentReportCard فوق equipmentProfitability — سيناريو محسوب باليد يغطي
 * الإيراد (إيجار + تجاوز) والمصاريف والربح وربح الساعة من الساعات الموثقة
 * (عدّاد العقود الساعية المقفلة + وردانيات المشغلين)، وعدد العقود والنشطة
 * والوحدات المحجوزة والتأمينات المحتجزة (النشطة فقط — المقفلة صُفّيت).
 *
 * التشغيل: node --experimental-strip-types scripts/verify_equipment_reports.mjs
 */
import assert from 'node:assert/strict'
import { equipmentReportCard, equipmentProfitability, usageHours } from '../src/core/rentalMeter.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

/* السيناريو: لودر بثلاثة عقود (ساعي مقفل بقراءات، يومي نشط، يومي مقفل بتجاوز) ووردانيتين */
const contracts = [
  // ساعي مقفل: 8 ساعات محجوزة × 500، قراءات العدّاد 100 ← 107.5 = 7.5 ساعة موثقة
  { days: 8, status: 'closed', extraMinor: 0, rateType: 'hourly', startReading: 100, endReading: 107.5, totals: { rentMinor: 4_000, depositMinor: 1_000 } },
  // يومي نشط: 10 أيام × 3,500 + تجاوز 1,200 — تأمين 5,000 لا يزال محتجزاً
  { days: 10, status: 'active', extraMinor: 1_200, rateType: 'daily', startReading: null, endReading: null, totals: { rentMinor: 35_000, depositMinor: 5_000 } },
  // يومي مقفل بلا تجاوز: 5 أيام × 3,000 — تأمينه رُد عند الإقفال
  { days: 5, status: 'closed', extraMinor: 0, rateType: 'daily', startReading: null, endReading: null, totals: { rentMinor: 15_000, depositMinor: 3_000 } },
]
const costs = [
  { amountMinor: 8_000 },  // وقود
  { amountMinor: 4_000 },  // صيانة
]
const shiftHours = 6.5 // وردانيات مشغلين موثقة
const c = equipmentReportCard({ contracts, costs, shiftHours })

/* ═══ ① الإيراد والربح ═══ */
{
  assert.equal(c.revenueMinor, 55_200, 'الإيراد = 4,000 + 35,000 + 1,200 تجاوز + 15,000')
  assert.equal(c.costsMinor, 12_000)
  assert.equal(c.profitMinor, 43_200, 'الربح = 55,200 − 12,000')
  ok('الإيراد 55,200 (إيجار 54,000 + تجاوز 1,200) · المصاريف 12,000 · الربح 43,200')
}

/* ═══ ② الساعات الموثقة وربح الساعة ═══ */
{
  // الساعي المقفل وحده يوثّق ساعات عدّاد (النشط بلا قراءة إرجاع بعد)
  assert.equal(usageHours(100, 107.5), 7.5, 'استخدام usageHours: 107.5 − 100 = 7.5 ساعة')
  assert.equal(c.hours, 14, 'الساعات = 7.5 عدّاد + 6.5 وردانيات')
  assert.equal(c.profitPerHourMinor, Math.round(43_200 / 14), 'ربح الساعة = 43,200 ÷ 14 مقرباً')
  ok('الساعات الموثقة 14 (عدّاد العقد الساعي المقفل 7.5 + وردانيات 6.5) · ربح الساعة محسوب منها')
}

/* ═══ ③ العقود والتأمينات المحتجزة ═══ */
{
  assert.equal(c.contractsCount, 3)
  assert.equal(c.activeContracts, 1, 'عقد نشط واحد')
  assert.equal(c.rentedUnits, 23, 'الوحدات المحجوزة = 8 + 10 + 5')
  assert.equal(c.depositsHeldMinor, 5_000, 'المحتجز = تأمين النشط وحده (المقفلتان صُفّيتا)')
  ok('العقود 3 (نشط 1) · الوحدات المحجوزة 23 · التأمينات المحتجزة 5,000 للنشط فقط')
}

/* ═══ ④ التوافق مع equipmentProfitability: البطاقة امتداد لا استبدال ═══ */
{
  const base = equipmentProfitability({ rentMinor: 54_000, extraMinor: 1_200, costsMinor: 12_000, contractHours: 7.5, shiftHours: 6.5 })
  assert.equal(base.revenueMinor, c.revenueMinor)
  assert.equal(base.profitMinor, c.profitMinor)
  assert.equal(base.hours, c.hours)
  assert.equal(base.profitPerHourMinor, c.profitPerHourMinor)
  ok('البطاقة تمتد equipmentProfitability كما هي — لا ازدواج منطق ولا انحراف')
}

/* ═══ ⑤ حواف: معدة بلا عقود ولا وردانيات ═══ */
{
  const empty = equipmentReportCard({ contracts: [], costs: [], shiftHours: 0 })
  assert.equal(empty.revenueMinor, 0)
  assert.equal(empty.profitMinor, 0)
  assert.equal(empty.hours, 0)
  assert.equal(empty.profitPerHourMinor, null, 'بلا ساعات ⇒ ربح الساعة غير معرف لا صفر')
  assert.equal(empty.depositsHeldMinor, 0)
  ok('معدة جديدة بلا تاريخ: أصفار نظيفة وربح ساعة null (لا قسمة على صفر)')
}

console.log(`\n✅ بطاقة تقرير المعدة الشاملة: ${pass} فحوصاً ناجحة`)
