/**
 * تحقق سد فجوات تقرير النشاط #15 (ذهب ومجوهرات — دفعة ب):
 * ① إعفاء قيمة الذهب من ضريبة القيمة المضافة في البيع العادي بالكاشير —
 *    الضريبة قانوناً (بروتوكول مصلحة الضرائب المصرية مع شعبة الذهب، قرار
 *    32 لسنة 2026) على «المصنعية» فقط لا على كامل السعر (Gap 1).
 * ② نفس الإعفاء في مقايضة الكسر (`postGoldTradeIn`) — المشغول الجديد المباع
 *    ضمن المقايضة يخضع لنفس القاعدة (Gap 1 أيضاً).
 * ③ `computeTotals` بلا جزء معفى يعمل بالضبط كما كان (لا كسر توافق خلفي).
 * ④ تنبيه جرس مركزي لسعر جرام لم يُحدَّث اليوم — فقط لو الصاغة مفعَّلة
 *    فعلاً بوصف ذهبي واحد على الأقل (Gap 2).
 * ⑤ لا كود ميت: التوصيل الفعلي بالواجهة (PosPage.tsx + JewelryPage.tsx + Header.tsx).
 * تشغيل: node --experimental-strip-types scripts/verify_jewelry_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeTotals } = await import('../src/core/pos.ts')
const { collectNotifications } = await import('../src/core/notifications.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

const S = () => useDataStore.getState()
S().seed([])

console.log('— ① إعفاء قيمة الذهب من الضريبة عبر computeTotals —')
// قطعة: وزن 10جم × سعر جرام 3000 = 30,000 (معفى) + مصنعية 6000 (خاضعة) = 36,000 سعر بيع
const goldExempt = 30_000_00
const workmanship = 6_000_00
const totals = computeTotals(
  [{ itemId: 1, nameAr: 'خاتم', qty: 1, unitPriceMinor: goldExempt + workmanship, unitCostMinor: 32_000_00, discountPercent: 0, soldByWeight: false, vatExemptPerUnitMinor: goldExempt }],
  0, 14, false,
)
ok(totals.taxBaseMinor === goldExempt + workmanship, `الأساس الضريبي = كامل السعر (${totals.taxBaseMinor}) — المعفى يدخل الإيراد بلا ضريبة`)
ok(totals.taxMinor === Math.round(workmanship * 0.14), `الضريبة المحسوبة (${totals.taxMinor}) = 14% من المصنعية فقط لا من كامل السعر`)
ok(totals.totalMinor === goldExempt + workmanship + totals.taxMinor, 'الإجمالي المستحق = السعر + ضريبة المصنعية فقط')

console.log('— ② نفس الإعفاء مع خصم سطر 10% (يتناسب الإعفاء مع الانكماش) —')
const totalsDisc = computeTotals(
  [{ itemId: 1, nameAr: 'خاتم', qty: 1, unitPriceMinor: goldExempt + workmanship, unitCostMinor: 32_000_00, discountPercent: 10, soldByWeight: false, vatExemptPerUnitMinor: goldExempt }],
  0, 14, false,
)
const expectedNet = Math.round((goldExempt + workmanship) * 0.9)
const expectedExemptNet = Math.round(goldExempt * 0.9)
const expectedTaxableNet = expectedNet - expectedExemptNet
const expectedTax = Math.round(expectedTaxableNet * 0.14)
ok(totalsDisc.netMinor === expectedNet, 'الصافي بعد خصم 10% صحيح')
ok(totalsDisc.taxMinor === expectedTax, `الضريبة بعد الخصم (${totalsDisc.taxMinor}) تُحسب على نصيب المصنعية من الصافي فقط`)

console.log('— ③ بلا جزء معفى: السلوك القديم كما هو تماماً (توافق خلفي) —')
const legacy = computeTotals(
  [{ itemId: 2, nameAr: 'صنف عادي', qty: 2, unitPriceMinor: 10000, unitCostMinor: 6000, discountPercent: 0, soldByWeight: false }],
  0, 14, false,
)
ok(legacy.taxBaseMinor === 20000 && legacy.taxMinor === 2800, 'صنف بلا vatExemptPerUnitMinor يُحسب كالمعتاد بلا أي تغيير')

console.log('— ④ بيع فعلي عبر المتجر الحقيقي (postSale) لصنف موصوف ذهبياً —')
S().addItem({ nameAr: 'دبلة', sku: 'G1', barcodes: [], categoryId: null, baseUnit: 'قطعة', extraUnits: [], costMinor: 32_000_00, stockQty: 5, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const goldItem = S().items.find((i) => i.sku === 'G1')
S().setGramPrices({ k18: 200000, k21: 300000, k24: 400000 }) // 3000.00 ج.م/جم عيار 21
S().setJewelryProfile({ itemId: goldItem.id, karat: 'k21', weightGrams: 10, workmanshipMinor: workmanship })
const priced = S().items.find((i) => i.id === goldItem.id)
ok(priced.priceMinor === goldExempt + workmanship, 'إعادة التسعير التلقائي صحيحة: وزن×جرام + مصنعية')
const journalBefore = S().journal.length
const sale = S().postSale({
  lines: [{ itemId: priced.id, nameAr: priced.nameAr, qty: 1, unitPriceMinor: priced.priceMinor, unitCostMinor: priced.costMinor, discountPercent: 0, soldByWeight: false, vatExemptPerUnitMinor: goldExempt }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
})
ok(sale.totals.taxMinor === Math.round(workmanship * 0.14), 'فاتورة بيع حقيقية: ضريبة المصنعية فقط لا كامل السعر')
const saleEntry = S().journal.find((e) => e.id === sale.journalEntryId)
ok(saleEntry.lines.some((l) => l.accountCode === '4101' && l.credit === goldExempt + workmanship), 'الإيراد 4101 بكامل السعر (معفى + خاضع) كما هو متوقع محاسبياً')
ok(saleEntry.lines.some((l) => l.accountCode === '2102' && l.credit === Math.round(workmanship * 0.14)), 'ض.ق.م المستحقة 2102 بقيمة ضريبة المصنعية فقط')
ok(S().journal.length === journalBefore + 1, 'قيد واحد فقط للبيع')

console.log('— ⑤ مقايضة كسر (postGoldTradeIn) تُعفي قيمة الذهب أيضاً —')
S().addItem({ nameAr: 'سلسلة', sku: 'G2', barcodes: [], categoryId: null, baseUnit: 'قطعة', extraUnits: [], costMinor: 32_000_00, stockQty: 3, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const goldItem2 = S().items.find((i) => i.sku === 'G2')
S().setJewelryProfile({ itemId: goldItem2.id, karat: 'k21', weightGrams: 10, workmanshipMinor: workmanship })
const priced2 = S().items.find((i) => i.id === goldItem2.id)
const doc = S().postGoldTradeIn({
  lines: [{ itemId: priced2.id, nameAr: priced2.nameAr, qty: 1, unitPriceMinor: priced2.priceMinor, unitCostMinor: priced2.costMinor, discountPercent: 0, soldByWeight: false, vatExemptPerUnitMinor: goldExempt }],
  customerId: null, scrapKarat: 'k21', scrapWeightGrams: 5, scrapPricePerGramMinor: 290000,
  treasury: '1101', taxPercent: 14, taxInclusive: false,
})
const tradeSaleEntry = S().journal.find((e) => e.id === S().sales.find((s) => s.id === doc.saleId)?.journalEntryId)
ok(!!tradeSaleEntry, 'فاتورة بيع المقايضة لها قيد')
ok(tradeSaleEntry.lines.some((l) => l.accountCode === '2102' && l.credit === Math.round(workmanship * 0.14)), 'مقايضة الكسر: ضريبة المصنعية فقط أيضاً')

console.log('— ⑥ تنبيه مركزي لسعر جرام غير محدَّث اليوم —')
const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString()
const notifBase = {
  batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [],
  fmt: (m) => String(m), todayIso: new Date().toISOString(),
}
const withStale = collectNotifications({ ...notifBase, staleGoldPrices: { updatedAt: yesterdayIso } })
ok(withStale.some((n) => n.id === 'goldpricestale'), 'سعر أمس يولّد تنبيهاً مركزياً')
const withFresh = collectNotifications({ ...notifBase, staleGoldPrices: { updatedAt: new Date().toISOString() } })
ok(!withFresh.some((n) => n.id === 'goldpricestale'), 'سعر محدَّث اليوم لا يولّد تنبيهاً')
const withNone = collectNotifications({ ...notifBase, staleGoldPrices: null })
ok(!withNone.some((n) => n.id === 'goldpricestale'), 'لا وصف ذهبي أصلاً (null) ⇒ لا تنبيه مزعج لنشاط غير الصاغة')

console.log('— ⑦ لا كود ميت: التوصيل الفعلي بالواجهة —')
const { readFileSync } = await import('node:fs')
const posPage = readFileSync(new URL('../src/ui/pages/PosPage.tsx', import.meta.url), 'utf8')
ok(posPage.includes('itemVatExemptPerUnit') && posPage.includes('vatExemptPerUnitMinor: itemVatExemptPerUnit'), 'شاشة الكاشير تحسب وتمرر الجزء المعفى لكل سطر ذهبي')
const jewelryPage = readFileSync(new URL('../src/ui/pages/JewelryPage.tsx', import.meta.url), 'utf8')
ok(jewelryPage.includes('vatExemptPerUnitMinor: tradeExemptMinor'), 'شاشة الصاغة تمرر الإعفاء في مقايضة الكسر')
const header = readFileSync(new URL('../src/ui/layout/Header.tsx', import.meta.url), 'utf8')
ok(header.includes('staleGoldPrices:'), 'الجرس المركزي يستقبل حالة سعر الذهب')
const notif = readFileSync(new URL('../src/core/notifications.ts', import.meta.url), 'utf8')
ok(notif.includes('goldpricestale'), 'منطق الإشعارات يولّد بند سعر الذهب غير المحدَّث')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
