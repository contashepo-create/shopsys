/**
 * فحص جولة مراجعة نشاط المطعم (الطلبات 6–9 — الجولة 5):
 * ① نواة الأوامر: تحقق نوع/طاولة/دليفري + رسوم الخدمة + سطر الرسوم الصناعي
 * ② repo: فتح/تعديل/إلغاء أمر بلا أي أثر دفتري + منع فتح طاولة مشغولة
 * ③ القفل: فاتورة واحدة تتضمن الرسوم وتخصم خامات الوصفة وتولد قيداً متوازناً
 * ④ بون المطبخ: بلا أي أسعار
 * تشغيل: node --experimental-strip-types scripts/verify_restaurant_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { validateRestaurantOrder, feeLine, serviceChargeMinor, orderSubtotalMinor, occupiedTables } = await import('../src/core/restaurant.ts')
const { renderKitchenTicketHtml } = await import('../src/ui/print/printKitchen.ts')
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

console.log('\n1️⃣ نواة أوامر المطعم')
ok('صالة بلا طاولة تُرفض', validateRestaurantOrder({ type: 'dine_in', tableName: ' ', deliveryInfo: '' }).some((e) => e.includes('الطاولة')))
ok('دليفري بلا بيانات يُرفض', validateRestaurantOrder({ type: 'delivery', tableName: '', deliveryInfo: '' }).some((e) => e.includes('التوصيل')))
ok('تيك أواي بلا شيء يمر', validateRestaurantOrder({ type: 'takeaway', tableName: '', deliveryInfo: '' }).length === 0)
ok('رسوم خدمة 12٪ من 10,000 = 1,200', serviceChargeMinor(10_000, 12) === 1_200)
throws('نسبة رسوم خارج النطاق تُرفض', () => serviceChargeMinor(1_000, 150))
const fee = feeLine('رسوم توصيل', 2_000)
ok('سطر الرسوم: itemId=-1 وتكلفة صفر', fee.itemId === -1 && fee.unitCostMinor === 0 && fee.unitPriceMinor === 2_000)
throws('رسوم بصفر تُرفض', () => feeLine('x', 0))
ok('orderSubtotal يحسب الخصومات', orderSubtotalMinor([{ itemId: 1, nameAr: 'x', qty: 2, unitPriceMinor: 1_000, unitCostMinor: 0, discountPercent: 50, soldByWeight: false }]) === 1_000)

console.log('\n2️⃣ فتح وتعديل وإلغاء (لا أثر دفتري)')
const journalBefore = S().journal.length
const o1 = S().openRestaurantOrder({ type: 'dine_in', tableName: '5' })
ok('ORD-0001 مفتوح لطاولة 5', o1.orderNumber === 'ORD-0001' && o1.status === 'open')
throws('نفس الطاولة لا تُفتح مرتين', () => S().openRestaurantOrder({ type: 'dine_in', tableName: '5' }), 'مفتوح بالفعل')
ok('طاولة 5 ضمن المشغولة', occupiedTables(S().restaurantOrders).has('5'))
// أصناف: طبق بوصفة عند الطلب + مشروب عادي
S().addItem(item({ nameAr: 'أرز', costMinor: 500, priceMinor: 0, stockQty: 100 }))
S().addItem(item({ nameAr: 'دجاج', costMinor: 3_000, priceMinor: 0, stockQty: 50 }))
S().addItem(item({ nameAr: 'طبق كبسة', costMinor: 0, priceMinor: 12_000, stockQty: 0 }))
S().addItem(item({ nameAr: 'كولا', costMinor: 800, priceMinor: 2_000, stockQty: 30 }))
const rice = S().items.find((i) => i.nameAr === 'أرز'), chicken = S().items.find((i) => i.nameAr === 'دجاج')
const dish = S().items.find((i) => i.nameAr === 'طبق كبسة'), cola = S().items.find((i) => i.nameAr === 'كولا')
S().addRecipe({ productItemId: dish.id, mode: 'made_to_order', ingredients: [{ itemId: rice.id, qty: 2 }, { itemId: chicken.id, qty: 1 }], overheadMinor: 0, notes: '', isActive: true })
S().setRestaurantOrderLines(o1.id, [
  { itemId: dish.id, nameAr: 'طبق كبسة', qty: 2, unitPriceMinor: 12_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false },
  { itemId: cola.id, nameAr: 'كولا', qty: 2, unitPriceMinor: 2_000, unitCostMinor: 800, discountPercent: 0, soldByWeight: false },
])
ok('السطور محفوظة على الأمر', S().restaurantOrders.find((o) => o.id === o1.id).lines.length === 2)
ok('لا قيود ولا فواتير قبل القفل', S().journal.length === journalBefore && S().sales.length === 0)
const o2 = S().openRestaurantOrder({ type: 'takeaway' })
S().cancelRestaurantOrder(o2.id, 'العميل غادر')
ok('الإلغاء يوثق السبب بلا أثر دفتري', S().restaurantOrders.find((o) => o.id === o2.id).status === 'cancelled' && S().journal.length === journalBefore)
throws('إلغاء بلا سبب يُرفض', () => { const t = S().openRestaurantOrder({ type: 'takeaway' }); S().cancelRestaurantOrder(t.id, ' ') }, 'سبب')

console.log('\n3️⃣ القفل بفاتورة (المحاسبة تبدأ هنا)')
const cashBefore = sumAcc('1101')
const sale = S().settleRestaurantOrder({ orderId: o1.id, payment: 'cash', serviceChargePercent: 10, taxPercent: 0, taxInclusive: true })
// الأصناف: 2×12,000 + 2×2,000 = 28,000 + خدمة 10٪ = 2,800 → 30,800
ok('الإجمالي = أصناف 28,000 + خدمة 2,800', sale.totals.totalMinor === 30_800)
ok('سطر رسوم الخدمة داخل الفاتورة', sale.lines.some((l) => l.itemId === -1 && l.nameAr.includes('خدمة') && l.unitPriceMinor === 2_800))
ok('النقدية زادت 30,800', sumAcc('1101') === cashBefore + 30_800)
ok('خامات الوصفة خُصمت: أرز 100−4=96 ودجاج 50−2=48',
  S().items.find((i) => i.id === rice.id).stockQty === 96 && S().items.find((i) => i.id === chicken.id).stockQty === 48)
ok('الكولا خُصمت 30−2=28', S().items.find((i) => i.id === cola.id).stockQty === 28)
ok('COGS = خامات الطبقين (2×(2×500+3,000)) + كولا 2×800 = 9,600', sale.totals.cogsMinor === 9_600)
const closed = S().restaurantOrders.find((o) => o.id === o1.id)
ok('الأمر مقفول ومربوط بالفاتورة', closed.status === 'settled' && closed.saleId === sale.id)
ok('الطاولة 5 تحررت', !occupiedTables(S().restaurantOrders).has('5'))
throws('قفل أمر مقفول يُرفض', () => S().settleRestaurantOrder({ orderId: o1.id, payment: 'cash', taxPercent: 0, taxInclusive: true }), 'مقفول')
throws('قفل أمر بلا أصناف يُرفض', () => { const t = S().openRestaurantOrder({ type: 'takeaway' }); S().settleRestaurantOrder({ orderId: t.id, payment: 'cash', taxPercent: 0, taxInclusive: true }) }, 'بلا أصناف')

// دليفري برسوم توصيل
const d = S().openRestaurantOrder({ type: 'delivery', deliveryInfo: 'أحمد — 0100 — المنصورة' })
S().setRestaurantOrderLines(d.id, [{ itemId: cola.id, nameAr: 'كولا', qty: 1, unitPriceMinor: 2_000, unitCostMinor: 800, discountPercent: 0, soldByWeight: false }])
const dSale = S().settleRestaurantOrder({ orderId: d.id, payment: 'cash', deliveryFeeMinor: 1_500, taxPercent: 0, taxInclusive: true })
ok('دليفري: 2,000 + توصيل 1,500 = 3,500', dSale.totals.totalMinor === 3_500 && dSale.lines.some((l) => l.nameAr === 'رسوم توصيل'))

console.log('\n4️⃣ بون المطبخ بلا أسعار')
const html = renderKitchenTicketHtml({
  shopName: 'مطعمنا', orderNumber: 'ORD-0009', typeLabel: 'صالة', tableName: '3', notes: 'بدون بصل',
  lines: [{ itemId: 1, nameAr: 'كبسة', qty: 2, unitPriceMinor: 12_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  dateIso: new Date().toISOString(),
})
ok('البون يحمل الصنف والكمية والملاحظات', html.includes('كبسة') && html.includes('2×') && html.includes('بدون بصل'))
ok('البون بلا أي سعر', !html.includes('12000') && !html.includes('120,00') && !html.includes('12,000') && !html.includes('120٫00'))

const total = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة إجمالاً', total === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
