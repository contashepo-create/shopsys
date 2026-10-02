/**
 * فحص بطاقة تقرير المطعم الشاملة (ثالثة وحدات «تقارير لكل نشاط» — طلب المالك):
 * restaurantReportCard — سيناريو محسوب باليد يغطي إيراد الأسطر بعد خصم السطر
 * (بمنطق lineTotal نفسه: mulQty/percentOf)، وتكلفة المواد وFood Cost %، وتجميع
 * الأطباق وترتيبها بالربح، وعدادات الأوامر (صالة/تيك أواي/دليفري × مقفل/مفتوح/ملغى)
 * وقيمة المفتوح غير المرحّل، ومتوسط قيمة الأمر من فواتير الأوامر المقفلة.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_restaurant_reports.mjs
 */
import assert from 'node:assert/strict'
import { restaurantReportCard } from '../src/core/restaurant.ts'
import { mulQty, percentOf } from '../src/core/money.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

/* السيناريو: مطعم بثلاثة أصناف مباعة + رسوم توصيل صناعية، وخمسة أوامر */
const soldLines = [
  // كشري (له وصفة): 100 طبق × 50 ج.م بلا خصم، تكلفة المواد 22 ج.م
  { itemId: 1, qty: 100, unitPriceMinor: 5_000, unitCostMinor: 2_200, discountPercent: 0 },
  // شاي كشري (له وصفة): 200 كوب × 10 ج.م، تكلفة 3 ج.م
  { itemId: 2, qty: 200, unitPriceMinor: 1_000, unitCostMinor: 300, discountPercent: 0 },
  // مشروب كانز (جاهز): 50 × 15 ج.م بخصم سطر 10٪، تكلفة 9 ج.م
  { itemId: 3, qty: 50, unitPriceMinor: 1_500, unitCostMinor: 900, discountPercent: 10 },
  // رسوم توصيل صناعية (itemId=-1): 20 طلب × 5 ج.م بلا تكلفة
  { itemId: -1, qty: 20, unitPriceMinor: 500, unitCostMinor: 0, discountPercent: 0 },
]
const orders = [
  { type: 'dine_in', status: 'settled', lines: [] },
  { type: 'dine_in', status: 'settled', lines: [] },
  { type: 'takeaway', status: 'settled', lines: [] },
  // أوامر مفتوحة: قيمتها لم تُرحَّل بعد — دليفري 11,000 وصالة 10,000
  { type: 'delivery', status: 'open', lines: [
    { qty: 3, unitPriceMinor: 2_000, discountPercent: 0 },
    { qty: 1, unitPriceMinor: 5_000, discountPercent: 0 },
  ] },
  { type: 'dine_in', status: 'open', lines: [
    { qty: 2, unitPriceMinor: 5_000, discountPercent: 0 },
  ] },
  // ملغى لا يُحسب في شيء
  { type: 'delivery', status: 'cancelled', lines: [
    { qty: 9, unitPriceMinor: 9_999, discountPercent: 0 },
  ] },
]
const c = restaurantReportCard({
  soldLines,
  recipeProductIds: [1, 2], // كشري وشاي يُحضَّران بالمطبخ؛ الكانز جاهز
  orders,
  settledOrdersSalesMinor: 600_000, // فواتير الأوامر المقفلة الثلاثة (200 ألف لكل أمر)
})

/* ═══ ① الإيراد وتكلفة المواد ومجمل الربح ═══ */
{
  assert.equal(c.revenueMinor, 777_500, 'الإيراد = 500,000 + 200,000 + 67,500 (بعد خصم 10٪) + 10,000 رسوم')
  assert.equal(c.cogsMinor, 325_000, 'التكلفة = 220,000 + 60,000 + 45,000 + 0')
  assert.equal(c.grossProfitMinor, 452_500, 'المجمل = 777,500 − 325,000')
  ok('الإيراد 777,500 · تكلفة المواد 325,000 · مجمل الربح 452,500')
}

/* ═══ ② Food Cost % — بتقريب النواة نفسه (round لعُشر) ═══ */
{
  const manual = Math.round((325_000 / 777_500) * 1000) / 10
  assert.equal(c.foodCostPercent, manual)
  assert.equal(c.foodCostPercent, 41.8)
  ok(`Food Cost % = 41.8٪ (فوق معيار 35٪ — كاشف في الواجهة)`)
}

/* ═══ ③ الأطباق مجمعة ومرتبة بالربح + شارة الوصفة ═══ */
{
  assert.equal(c.dishCount, 4)
  const byId = new Map(c.dishes.map((d) => [d.itemId, d]))
  assert.deepEqual(
    c.dishes.map((d) => d.itemId),
    [1, 2, 3, -1],
    'الترتيب بالربح تنازلياً: كشري 280,000 ثم شاي 140,000 ثم كانز 22,500 ثم رسوم 10,000',
  )
  const koshary = byId.get(1)
  assert.equal(koshary.revenueMinor, 500_000)
  assert.equal(koshary.costMinor, 220_000)
  assert.equal(koshary.profitMinor, 280_000)
  assert.equal(koshary.marginPercent, 56)
  assert.equal(koshary.hasRecipe, true, 'الكشري له وصفة — يُحضَّر بالمطبخ')
  const cans = byId.get(3)
  // خصم السطر بمنطق lineTotal نفسه: 75,000 − percentOf(75,000, 10) = 67,500
  const gross = mulQty(1_500, 50)
  assert.equal(gross - percentOf(gross, 10), 67_500)
  assert.equal(cans.revenueMinor, 67_500)
  assert.equal(cans.marginPercent, 33.3, 'هامش الكانز 22,500 ÷ 67,500 = 33.3٪ بعُشر دقيق')
  assert.equal(cans.hasRecipe, false, 'الكانز جاهز — لا وصفة')
  assert.equal(byId.get(-1).profitMinor, 10_000, 'رسوم التوصيل صناعية: إيراد كامل بلا تكلفة')
  assert.equal(byId.get(2).marginPercent, 70, 'هامش الشاي 140,000 ÷ 200,000 = 70٪')
  ok('الأطباق مجمعة ومرتبة بالربح؛ الهوامش بعُشر دقيق وشارة «يُحضَّر بالمطبخ» صحيحة')
}

/* ═══ ④ الأوامر: العدادات والقيمة المفتوحة غير المرحّلة ═══ */
{
  assert.equal(c.orders.settledCount, 3)
  assert.equal(c.orders.openCount, 2)
  assert.equal(c.orders.cancelledCount, 1)
  assert.equal(c.orders.openValueMinor, 21_000, 'قيد التحصيل = 11,000 دليفري + 10,000 صالة — لم تُرحَّل بعد')
  assert.equal(c.orders.byType.dine_in.settled, 2)
  assert.equal(c.orders.byType.dine_in.open, 1)
  assert.equal(c.orders.byType.dine_in.openValueMinor, 10_000)
  assert.equal(c.orders.byType.takeaway.settled, 1)
  assert.equal(c.orders.byType.takeaway.openValueMinor, 0)
  assert.equal(c.orders.byType.delivery.open, 1)
  assert.equal(c.orders.byType.delivery.openValueMinor, 11_000)
  assert.equal(c.orders.byType.delivery.settled, 0)
  ok('الأوامر: 3 مقفلة · 2 مفتوحة بقيمة 21,000 · 1 ملغى — والتوزيع بالأنواع صحيح')
}

/* ═══ ⑤ متوسط قيمة الأمر المقفل ═══ */
{
  assert.equal(c.orders.avgSettledOrderMinor, 200_000, '600,000 فواتير الأوامر ÷ 3 أوامر مقفلة')
  ok('متوسط قيمة الأمر = 200,000')
}

/* ═══ ⑥ الحافة: بطاقة فارغة — لا قسمة على صفر ═══ */
{
  const empty = restaurantReportCard({ soldLines: [], recipeProductIds: [], orders: [], settledOrdersSalesMinor: 0 })
  assert.equal(empty.revenueMinor, 0)
  assert.equal(empty.foodCostPercent, null, 'إيراد صفر ⇒ Food Cost % = null')
  assert.equal(empty.orders.avgSettledOrderMinor, null, 'لا أوامر مقفلة ⇒ متوسط = null')
  assert.deepEqual(empty.dishes, [])
  ok('البطاقة الفارغة: null بلا قسمة على صفر — وصفرة أطباق')
}

console.log(`\n✅ بطاقة تقرير المطعم الشاملة: ${pass} فحوصاً ناجحة`)
