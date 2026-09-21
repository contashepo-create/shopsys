/**
 * فحص جولة مراجعة نشاط الذهب والمجوهرات (الطلبات 6–9 — الجولة 7):
 * البيع بمقايضة كسر — أشهر عملية بمحل الصاغة:
 * ① النواة: computeTradeInNet + validateTradeIn
 * ② repo.postGoldTradeIn: فاتورة بيع + لوط كسر بمستند GTI + الفرق النقدي فقط بالخزينة
 * ③ الذرية: فشل أي جزء يسترجع الحالة كاملة
 * تشغيل: node --experimental-strip-types scripts/verify_jewelry_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeTradeInNet, validateTradeIn } = await import('../src/core/jewelry.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const sumAcc = (code) => S().journal.reduce((a, e) => a + e.lines.reduce((x, l) => x + (l.accountCode === code ? l.debit - l.credit : 0), 0), 0)
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('\n1️⃣ نواة المقايضة')
// مشغول 50,000 وكسر 10جم × 4,000 = 40,000 ⇒ العميل يدفع 10,000
const p1 = computeTradeInNet(50_000, 10, 4_000)
ok('الصافي = 50,000 − 40,000 = +10,000', p1.scrapValueMinor === 40_000 && p1.netMinor === 10_000)
ok('كسر أغلى من المشغول = نرد للعميل', computeTradeInNet(30_000, 10, 4_000).netMinor === -10_000)
ok('متكافئة = صفر', computeTradeInNet(40_000, 10, 4_000).netMinor === 0)
ok('وزن صفر يُرفض', validateTradeIn({ scrapWeightGrams: 0, scrapPricePerGramMinor: 100 }).some((e) => e.includes('فاتورة بيع عادية')))
ok('سعر جرام صفر يُرفض', validateTradeIn({ scrapWeightGrams: 5, scrapPricePerGramMinor: 0 }).length > 0)
ok('مدخل سليم يمر', validateTradeIn({ scrapWeightGrams: 5, scrapPricePerGramMinor: 100 }).length === 0)

console.log('\n2️⃣ المقايضة في المخزن (repo)')
S().addItem(item({ nameAr: 'غويشة عيار 21', costMinor: 42_000, priceMinor: 50_000, stockQty: 3 }))
const bangle = S().items.find((i) => i.nameAr === 'غويشة عيار 21')
const cashBefore = sumAcc('1101')
const inv1103Before = sumAcc('1103')
const doc = S().postGoldTradeIn({
  lines: [{ itemId: bangle.id, nameAr: bangle.nameAr, qty: 1, unitPriceMinor: 50_000, unitCostMinor: 42_000, discountPercent: 0, soldByWeight: false }],
  scrapKarat: 'k21', scrapWeightGrams: 10, scrapPricePerGramMinor: 4_000,
  taxPercent: 0, taxInclusive: true,
})
ok('مستند GTI-0001 وصافي +10,000', doc.tradeNumber === 'GTI-0001' && doc.netMinor === 10_000)
ok('فاتورة البيع موجودة ومربوطة', S().sales.some((x) => x.id === doc.saleId))
ok('لوط الكسر موجود ومربوط (10 جم متبقية)', S().scrapLots.some((l) => l.id === doc.scrapLotId && l.remainingGrams === 10 && l.karat === 'k21'))
ok('النقدية الصافية = الفرق فقط (+10,000)', sumAcc('1101') === cashBefore + 10_000)
ok('مخزون المشغولات نقص 1', S().items.find((i) => i.id === bangle.id).stockQty === 2)
// 1103: خرج المشغول بتكلفته 42,000 ودخل الكسر 40,000 ⇒ صافي −2,000
ok('1103: −42,000 مشغول +40,000 كسر = −2,000', sumAcc('1103') === inv1103Before - 2_000)
ok('اسم بائع الكسر «عميل مقايضة» للنقدي', S().scrapLots.find((l) => l.id === doc.scrapLotId).sellerName === 'عميل مقايضة')

// بيع الكسر المشترى لاحقاً للتاجر يستهلك اللوط FIFO
const scrapSale = S().sellScrap({ karat: 'k21', weightGrams: 10, pricePerGramMinor: 4_200 })
ok('بيع الكسر لاحقاً: ربح (4,200−4,000)×10 = 2,000', scrapSale.profitMinor === 2_000)

console.log('\n3️⃣ الذرية والحواجز')
const before = { sales: S().sales.length, lots: S().scrapLots.length, journal: S().journal.length, trades: S().goldTradeIns.length }
throws('بيع بلا مخزون مشغولات يفشل ويسترجع', () => S().postGoldTradeIn({
  lines: [{ itemId: bangle.id, nameAr: bangle.nameAr, qty: 99, unitPriceMinor: 50_000, unitCostMinor: 42_000, discountPercent: 0, soldByWeight: false }],
  scrapKarat: 'k21', scrapWeightGrams: 5, scrapPricePerGramMinor: 4_000,
  taxPercent: 0, taxInclusive: true,
}), 'مخزون')
ok('لا بيع يتيم — الحالة استُرجعت',
  S().sales.length === before.sales && S().scrapLots.length === before.lots &&
  S().journal.length === before.journal && S().goldTradeIns.length === before.trades)
throws('وزن كسر صفر يُرفض', () => S().postGoldTradeIn({
  lines: [{ itemId: bangle.id, nameAr: bangle.nameAr, qty: 1, unitPriceMinor: 50_000, unitCostMinor: 42_000, discountPercent: 0, soldByWeight: false }],
  scrapKarat: 'k21', scrapWeightGrams: 0, scrapPricePerGramMinor: 4_000,
  taxPercent: 0, taxInclusive: true,
}), 'فاتورة بيع عادية')
throws('بلا مشغولات يُرفض', () => S().postGoldTradeIn({
  lines: [], scrapKarat: 'k21', scrapWeightGrams: 5, scrapPricePerGramMinor: 4_000, taxPercent: 0, taxInclusive: true,
}), 'شاشة الصاغة')

const total = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة إجمالاً', total === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
