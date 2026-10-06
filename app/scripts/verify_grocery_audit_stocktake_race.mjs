/**
 * تدقيق نشاط الأغذية (أكتوبر 2026) — الجرد مع حركة متزامنة:
 * قبل الإصلاح كان postStocktake يكتب «المعدود» فوق الرصيد الحي، فيضيع أي بيع حدث بين بدء العدّ
 * والترحيل (الأستاذ 1103 ينقص بالقيد الصحيح بينما دفتر الأصناف يعرض رصيداً أعلى).
 * الآن: تطبيق فرق الجرد (المعدود − الدفتري وقت العدّ) على الرصيد الحي.
 * تشغيل: node --experimental-strip-types scripts/verify_grocery_audit_stocktake_race.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const bal = (code) => S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((a, l) => a + l.debit - l.credit, 0)
const stock = (id) => S().items.find((i) => i.id === id).stockQty
const mkItem = (nameAr) => {
  S().addItem({
    nameAr, sku: '', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [],
    costMinor: 1000, stockQty: 0, priceMinor: 1500, minQty: 0, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  return S().items.at(-1).id
}
const sell = (itemId, qty) => S().postSale({
  lines: [{ itemId, nameAr: 'x', qty, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
})

S().addSupplier({ nameAr: 'مورد الفحص' })
const supplierId = S().suppliers.at(-1).id
const buy = (itemId, qty) => S().postPurchase({ supplierId, date: '2026-10-06', lines: [{ itemId, qty, unitPriceMinor: 1000 }], expenses: [], paidMinor: qty * 1000, notes: '' })

console.log('\n1️⃣ جرد بلا حركة متزامنة: النتيجة = المعدود (سلوك قديم محفوظ)')
const a = mkItem('أرز أ')
buy(a, 100)
S().postStocktake([{ itemId: a, nameAr: 'أرز أ', expectedQty: 100, countedQty: 95, unitCostMinor: 1000 }], '')
ok('الرصيد 95', stock(a) === 95)
ok('1103 = 95,000', bal('1103') === 95000)

console.log('\n2️⃣ بيع بعد بدء العدّ وقبل الترحيل: لا يضيع البيع')
const b = mkItem('أرز ب')
buy(b, 100)
const counts = [{ itemId: b, nameAr: 'أرز ب', expectedQty: 100, countedQty: 95, unitCostMinor: 1000 }]
sell(b, 10)
S().postStocktake(counts, '')
ok('الرصيد الحقيقي 100−10−5 = 85', stock(b) === 85, `الفعلي ${stock(b)}`)
const itemsValue = S().items.reduce((s, i) => s + (i.stockQty ?? 0) * i.costMinor, 0)
ok('Σ(رصيد×تكلفة) = الأستاذ 1103 كاملاً', itemsValue === bal('1103'), `${itemsValue} ≠ ${bal('1103')}`)

console.log('\n3️⃣ شراء بعد بدء العدّ: لا يضيع')
const c = mkItem('أرز ج')
buy(c, 50)
const counts3 = [{ itemId: c, nameAr: 'أرز ج', expectedQty: 50, countedQty: 48, unitCostMinor: 1000 }]
buy(c, 20)
S().postStocktake(counts3, '')
ok('50+20−2 = 68', stock(c) === 68, `الفعلي ${stock(c)}`)
ok('Σ(رصيد×تكلفة) = الأستاذ 1103', S().items.reduce((s, i) => s + (i.stockQty ?? 0) * i.costMinor, 0) === bal('1103'))

console.log('\n4️⃣ حارس: الرصيد الحي لا يتسع للفرق ⇒ رفض صريح بلا أثر')
const d = mkItem('أرز د')
buy(d, 10)
const counts4 = [{ itemId: d, nameAr: 'أرز د', expectedQty: 10, countedQty: 4, unitCostMinor: 1000 }] // عجز 6
sell(d, 8) // بقي 2 فقط، والعجز 6 لا يتسع
const jn = S().journal.length, st = S().stocktakes.length
let msg = ''
try { S().postStocktake(counts4, '') } catch (e) { msg = e.message }
ok('رُفض برسالة عربية تطلب إعادة العدّ', msg.includes('أعد عدّ'), msg)
ok('لا قيد ولا مستند جرد أُضيف', S().journal.length === jn && S().stocktakes.length === st)
ok('الرصيد لم يتغير (2)', stock(d) === 2)

console.log(`\n═══ النتيجة: نجح ${pass} — فشل ${fail} ═══`)
process.exit(fail ? 1 : 0)
