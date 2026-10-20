/**
 * تحقق سد فجوة تقرير النشاط #20 (مخبز وحلويات — دفعة ب):
 * تقرير "نسبة الهالك الأسبوعية" — ميزة إجماع عالمي كامل في كل برامج
 * المخابز المتخصصة (BakeSmart, Fournil, DoughOps, Logibake, kardopos…
 * راجع البحث): قياس الهالك أسبوعياً كنسبة من تكلفة البضاعة المُعدة، لا
 * كرقم تراكمي كلي فقط — هو ما يحوّل الهالك من "خسارة صامتة" إلى قرار
 * إنتاج فوري. دليل الاستخدام المدمج (`core/guides.ts` → `bakery_wastage`)
 * كان **يَعِد** المستخدم بهذا التقرير تحديداً بالنص: "راقب نسبة الهالك
 * أسبوعياً من التقارير: نسبة تتجاوز 8-10٪ تعني أنك تخبز أكثر من طلب
 * السوق" — رغم عدم وجود أي تقرير كهذا في `ReportsPage` قبل هذه الدفعة.
 * تشغيل: node --experimental-strip-types scripts/verify_bakery_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { isoWeekKey, wastageRatioReport, wastageByItemReport } = await import('../src/core/wastage.ts')
const { getActivity } = await import('../src/core/activities.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① بطاقة النشاط: مخبز وحلويات من فصيلة الوصفات/الإنتاج —')
const bakery = getActivity('bakery')
ok(!!bakery && bakery.modules.includes('recipes'), 'نشاط المخبز يملك وحدة recipes')
ok(!!bakery && bakery.features.includes('expiry_batches'), 'المخبز يفعّل تتبع الصلاحية (صلاحيات قصيرة)')

console.log('— ② isoWeekKey (حساب أسبوع ISO 8601 معياري) —')
ok(isoWeekKey('2026-01-01') === '2026-W01', 'الخميس 1 يناير 2026 داخل الأسبوع ISO 01')
ok(isoWeekKey('2025-12-29') === '2026-W01', 'الاثنين 29 ديسمبر 2025 يقع في أسبوع ISO 2026-W01 (يمتد عبر السنة)')
ok(isoWeekKey('2026-03-16') === isoWeekKey('2026-03-17'), 'يومان متتاليان من نفس الأسبوع (اثنين وثلاثاء) يعطيان نفس المفتاح')
ok(isoWeekKey('2026-03-15') !== isoWeekKey('2026-03-23'), 'أسبوعان مختلفان بوضوح يعطيان مفتاحين مختلفين')

console.log('— ③ wastageRatioReport: نسبة صحيحة حسابياً ومجمّعة بالأسبوع —')
const wastagesSample = [
  { date: '2026-03-16T10:00:00.000Z', totalCostMinor: 1000 }, // أسبوع 1
  { date: '2026-03-17T10:00:00.000Z', totalCostMinor: 500 },  // أسبوع 1 أيضاً
  { date: '2026-03-23T10:00:00.000Z', totalCostMinor: 2000 }, // أسبوع 2
]
const salesSample = [
  { date: '2026-03-16T12:00:00.000Z', cogsMinor: 9000 }, // أسبوع 1: هالك 1500 / (1500+9000) = 14.28٪
  { date: '2026-03-23T12:00:00.000Z', cogsMinor: 18000 }, // أسبوع 2: هالك 2000 / (2000+18000) = 10٪
]
const ratioReport = wastageRatioReport(wastagesSample, salesSample)
ok(ratioReport.length === 2, 'أسبوعان ناتجان من البيانات (لا تكرار ولا دمج خاطئ)')
const week1 = ratioReport.find((r) => r.period === isoWeekKey('2026-03-16'))
const week2 = ratioReport.find((r) => r.period === isoWeekKey('2026-03-23'))
ok(week1?.wastageCostMinor === 1500, 'أسبوع 1: هالك 1000+500 = 1500 مجمّع بالضبط')
ok(week1?.salesCogsMinor === 9000, 'أسبوع 1: تكلفة مبيعات 9000 كما هي')
ok(week1?.ratioPercent === 14.29, 'أسبوع 1: النسبة 1500/(1500+9000)×100 = 14.29٪ بالضبط')
ok(week2?.ratioPercent === 10, 'أسبوع 2: النسبة 2000/(2000+18000)×100 = 10٪ بالضبط')
ok(ratioReport[0].period > ratioReport[1].period, 'مرتب تنازلياً: الأسبوع الأحدث أولاً')

console.log('— ④ حالات حدية: لا قسمة على صفر، ولا بيانات = تقرير فارغ —')
ok(wastageRatioReport([], []).length === 0, 'بلا أي بيانات = تقرير فارغ تماماً')
const onlyWastageNoSales = wastageRatioReport([{ date: '2026-05-01T00:00:00.000Z', totalCostMinor: 500 }], [])
ok(onlyWastageNoSales[0].ratioPercent === 100, 'هالك بلا أي مبيعات في نفس الأسبوع = نسبة 100٪ (كله هالك فعلياً)')
const onlySalesNoWastage = wastageRatioReport([], [{ date: '2026-05-01T00:00:00.000Z', cogsMinor: 500 }])
ok(onlySalesNoWastage[0].ratioPercent === 0, 'مبيعات بلا أي هالك = نسبة 0٪ تماماً')

console.log('— ⑤ wastageByItemReport: تجميع صحيح حسب الصنف عبر عدة مستندات —')
const byItem = wastageByItemReport([
  { lines: [{ itemId: 1, nameAr: 'كرواسون', qty: 10, unitCostMinor: 100 }, { itemId: 2, nameAr: 'عيش فينو', qty: 20, unitCostMinor: 50 }] },
  { lines: [{ itemId: 1, nameAr: 'كرواسون', qty: 5, unitCostMinor: 100 }] },
])
ok(byItem.length === 2, 'صنفان فقط رغم ثلاثة سطور — تجميع صحيح')
const croissant = byItem.find((r) => r.itemId === 1)
ok(croissant?.totalQty === 15 && croissant?.totalCostMinor === 1500 && croissant?.docsCount === 2, 'الكرواسون: كمية 15 وتكلفة 1500 عبر مستندين')
ok(byItem[0].itemId === 1, 'مرتب تنازلياً بالقيمة — الكرواسون (1500) قبل العيش الفينو (1000)')

console.log('— ⑥ تكامل حقيقي مع المتجر: postWastage + postSale يغذيان التقرير فعلياً —')
mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'bakery', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
const S = () => useDataStore.getState()
S().seed([])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500000, label: 'خزينة' })
S().addItem({ nameAr: 'كرواسون زبدة', sku: 'BK-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 500, priceMinor: 1000, minQty: 0, stockQty: 50, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false })
const item = S().items.at(-1)
S().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
S().postWastage({ reason: 'بواقي إنتاج اليوم', lines: [{ itemId: item.id, qty: 4 }], notes: 'آخر اليوم' })
const liveReport = wastageRatioReport(S().wastages, S().sales.map((s) => ({ date: s.date, cogsMinor: s.totals.cogsMinor })))
ok(liveReport.length === 1, 'أسبوع واحد فقط (كل الحركة اليوم) من تكامل فعلي مع المتجر')
ok(liveReport[0].wastageCostMinor === 2000, 'هالك 4 قطع × 500 = 2000 من postWastage الفعلي')
ok(liveReport[0].salesCogsMinor === 5000, 'تكلفة مبيعات 10 قطع × 500 = 5000 من postSale الفعلي')
ok(liveReport[0].ratioPercent === Math.round((2000 / 7000) * 10000) / 100, 'النسبة المحسوبة من بيانات حقيقية مطابقة للصيغة بالضبط')
const liveByItem = wastageByItemReport(S().wastages)
ok(liveByItem.length === 1 && liveByItem[0].totalQty === 4 && liveByItem[0].totalCostMinor === 2000, 'تجميع حسب الصنف من بيانات حقيقية صحيح')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) { console.error('❌ فشل تحقق دفعة ب — مخبز وحلويات'); process.exit(1) }
console.log('🎉 نجح تحقق سد فجوة تقرير نسبة الهالك الأسبوعية — نشاط المخبز (دفعة ب)')
