/**
 * التحقق من حزمة «وحدة المغاسل + ضريبة لكل صنف»:
 * ① نواة المغاسل: خدمات/حالات/انتقالات/إجماليات
 * ② قيود المغاسل: عربون (2109) → تسليم (تحقق الإيراد 4103+2102) → إلغاء (رد العربون)
 * ③ repo: فتح أمر بعربون + دورة الحالات كاملة + قيود اليومية متوازنة
 * ④ ضريبة الصنف: vatOverride (إعفاء/مخصصة) + computeTotals سطراً بسطر + التوافق الخلفي
 * ⑤ نشاط المغسلة يعرض وحدة laundry لا maintenance
 */
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } }, version: 0 }))

const {
  LAUNDRY_SERVICE_LABELS, LAUNDRY_STATUS_LABELS, LAUNDRY_TRANSITIONS, assertLaundryTransition,
  validateLaundryOrder, laundryTotal, buildLaundryPrepaidEntry, buildLaundryDeliverEntry, buildLaundryCancelEntry, laundryReport,
} = await import('../src/core/laundry.ts')
const { effectiveVatPercent } = await import('../src/core/items.ts')
const { computeTotals } = await import('../src/core/pos.ts')
const { ACTIVITY_TEMPLATES, MODULE_LABELS, ALL_MODULES } = await import('../src/core/activities.ts')
const { useDataStore } = await import('../src/data/repo.ts')

let n = 0
const ok = (name, cond) => { n++; assert.ok(cond, name); console.log(`  ✓ ${n}. ${name}`) }
const balanced = (lines) => lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0

console.log('― نواة المغاسل ―')
ok('6 خدمات و5 حالات', Object.keys(LAUNDRY_SERVICE_LABELS).length === 6 && Object.keys(LAUNDRY_STATUS_LABELS).length === 5)
ok('الانتقالات: مستلم→تجهيز/جاهز/إلغاء، والتسليم من جاهز فقط، ومُسلَّم نهائي', LAUNDRY_TRANSITIONS.received.length === 3 && LAUNDRY_TRANSITIONS.ready.includes('delivered') && LAUNDRY_TRANSITIONS.delivered.length === 0)
assert.throws(() => assertLaundryTransition('delivered', 'received'))
ok('انتقال عكسي مرفوض', true)
const lines = [
  { desc: 'قميص', service: 'wash_iron', qty: 3, unitPriceMinor: 2_000 },
  { desc: 'بدلة', service: 'dry_clean', qty: 1, unitPriceMinor: 15_000 },
]
ok('الإجمالي 3×20 + 150 = 210', laundryTotal(lines) === 21_000)
ok('validate يرفض عربوناً أكبر من الإجمالي', validateLaundryOrder({ lines, prepaidMinor: 25_000 }).length > 0)
ok('validate يقبل أمراً سليماً', validateLaundryOrder({ lines, prepaidMinor: 5_000 }).length === 0)

console.log('― قيود المغاسل ―')
const pre = buildLaundryPrepaidEntry(5_000, 'عربون', '1101')
ok('العربون: خزينة مدين / 2109 دائن (التزام لا إيراد)', balanced(pre) && pre.some((l) => l.accountCode === '1101' && l.debit === 5_000) && pre.some((l) => l.accountCode === '2109' && l.credit === 5_000))
const del = buildLaundryDeliverEntry({ totalMinor: 21_000, prepaidMinor: 5_000, taxPercent: 14, taxInclusive: false, note: 'x', treasury: '1101' })
ok('التسليم (ضريبة مضافة): الإجمالي 210×1.14=239.4', del.grandMinor === 23_940 && del.taxMinor === 2_940 && del.baseMinor === 21_000)
ok('التسليم: خزينة بالمتبقي 189.4 + تصفية 2109 بـ50', balanced(del.lines) && del.lines.some((l) => l.accountCode === '1101' && l.debit === 18_940) && del.lines.some((l) => l.accountCode === '2109' && l.debit === 5_000))
ok('التسليم: 4103 دائن 210 + 2102 دائن 29.4', del.lines.some((l) => l.accountCode === '4103' && l.credit === 21_000) && del.lines.some((l) => l.accountCode === '2102' && l.credit === 2_940))
const delInc = buildLaundryDeliverEntry({ totalMinor: 11_400, prepaidMinor: 0, taxPercent: 14, taxInclusive: true, note: 'x', treasury: '1101' })
ok('شامل الضريبة: 114 = أساس 100 + ضريبة 14', delInc.grandMinor === 11_400 && delInc.baseMinor === 10_000 && delInc.taxMinor === 1_400)
const cnc = buildLaundryCancelEntry(5_000, 'رد')
ok('الإلغاء: 2109 مدين / خزينة دائن', balanced(cnc) && cnc.some((l) => l.accountCode === '2109' && l.debit === 5_000) && cnc.some((l) => l.accountCode === '1101' && l.credit === 5_000))

console.log('― repo: دورة أمر غسيل كاملة ―')
const s = () => useDataStore.getState()
const order = s().openLaundryOrder({ customerId: null, customerName: 'أم أحمد', phone: '0100', promisedAt: '2026-09-20', lines, prepaidMinor: 5_000, notes: '' })
ok('فُتح الأمر LN-0001 بعربون وقيد', order.orderNumber === 'LN-0001' && order.prepaidEntryId != null)
const preEntry = s().journal.find((e) => e.id === order.prepaidEntryId)
ok('قيد العربون متوازن ومصدره laundry', preEntry && balanced(preEntry.lines) && preEntry.sourceType === 'laundry')
s().setLaundryStatus(order.id, 'processing')
s().setLaundryStatus(order.id, 'ready')
assert.throws(() => s().setLaundryStatus(order.id, 'delivered'))
ok('التسليم عبر setStatus مرفوض (يجب المرور بقيد الإيراد)', true)
const delivered = s().deliverLaundryOrder({ orderId: order.id })
ok('سُلِّم الأمر وتولد قيد الإيراد', delivered.status === 'delivered' && delivered.deliverEntryId != null && delivered.grandMinor === 23_940)
const delEntry = s().journal.find((e) => e.id === delivered.deliverEntryId)
ok('قيد التسليم متوازن ويصفي 2109', delEntry && balanced(delEntry.lines) && delEntry.lines.some((l) => l.accountCode === '2109' && l.debit === 5_000))
assert.throws(() => s().deliverLaundryOrder({ orderId: order.id }))
ok('تسليم مكرر مرفوض', true)
// أمر ثانٍ يُلغى برد العربون
const o2 = s().openLaundryOrder({ customerId: null, customerName: 'زبون', phone: '', promisedAt: '', lines: [{ desc: 'سجادة', service: 'carpet', qty: 1, unitPriceMinor: 8_000 }], prepaidMinor: 3_000, notes: '' })
const cancelled = s().cancelLaundryOrder(o2.id)
ok('أُلغي الثاني ورُد العربون بقيد', cancelled.status === 'cancelled' && cancelled.cancelEntryId != null)
const rep = laundryReport(s().laundryOrders)
ok('التقرير: مُسلَّم واحد بإيراد 210 والملغي مستبعد', rep.totalRevenueMinor === 21_000 && rep.totalPieces === 4 && rep.rows.length === 2)

console.log('― ضريبة لكل صنف ―')
ok('effectiveVatPercent: undefined→العامة، 0→معفى، 5→مخصصة', effectiveVatPercent({ vatOverride: undefined }, 14) === 14 && effectiveVatPercent({ vatOverride: 0 }, 14) === 0 && effectiveVatPercent({ vatOverride: 5 }, 14) === 5)
const mk = (price, qty, ov) => ({ itemId: 1, nameAr: 'x', unitPriceMinor: price, unitCostMinor: 0, qty, discountPercent: 0, ...(ov !== undefined ? { vatPercentOverride: ov } : {}) })
// توافق خلفي: بلا تجاوزات = المسار القديم
const tOld = computeTotals([mk(10_000, 1)], 0, 14, false)
ok('توافق خلفي: 100 + 14% = 114', tOld.totalMinor === 11_400 && tOld.taxMinor === 1_400)
// سطر معفى + سطر عادي (غير شامل)
const tMix = computeTotals([mk(10_000, 1, 0), mk(10_000, 1)], 0, 14, false)
ok('خليط: معفى + خاضع 14% → ضريبة 14 فقط', tMix.taxMinor === 1_400 && tMix.totalMinor === 21_400)
// نسبة مخصصة 5%
const tCustom = computeTotals([mk(10_000, 1, 5), mk(10_000, 1)], 0, 14, false)
ok('مخصصة 5% + عامة 14% → ضريبة 19', tCustom.taxMinor === 1_900)
// شامل الضريبة مع إعفاء
const tInc = computeTotals([mk(11_400, 1, 0), mk(11_400, 1)], 0, 14, true)
ok('شامل: المعفى أساسه كامل والخاضع يفصل 14', tInc.taxMinor === 1_400 && tInc.totalMinor === 22_800)
// خصم فاتورة يوزع نسبياً
const tDisc = computeTotals([mk(10_000, 1, 0), mk(10_000, 1)], 10, 14, false)
ok('خصم فاتورة 10% يوزع نسبياً: ضريبة على 90 فقط', tDisc.taxMinor === 1_260 && tDisc.totalMinor === 19_260)

console.log('― نشاط المغسلة والوحدات ―')
const laundryTpl = ACTIVITY_TEMPLATES.find((t) => t.id === 'laundry')
ok('نشاط المغسلة يستخدم وحدة laundry لا maintenance', laundryTpl.modules.includes('laundry') && !laundryTpl.modules.includes('maintenance'))
ok('MODULE_LABELS و ALL_MODULES تشمل laundry', 'laundry' in MODULE_LABELS && ALL_MODULES.includes('laundry'))

console.log(`\n✅ نجح التحقق: ${n} فحصاً — وحدة المغاسل وضريبة الصنف سليمتان`)
