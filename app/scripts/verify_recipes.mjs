/**
 * فحص الوصفات والتصنيع (سد فجوة Foodics للمطاعم):
 * طبق «عند الطلب» يخصم خاماته لحظة البيع بتكلفة آلية،
 * أمر إنتاج مسبق يحول خامات لمنتج مخزون بمتوسط مرجح جديد،
 * مرتجع الطبق لا يعيد خامات مطهية، والدفتر متوازن دائماً.
 * تشغيل: node --experimental-strip-types scripts/verify_recipes.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
// سياسة الورديات معطلة في بيئة السكربت — المختبر هنا التسعير/الوصفات لا الورديات
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } }, version: 0 }))
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const stockOf = (id) => S().items.find((it) => it.id === id).stockQty
const costOf = (id) => S().items.find((it) => it.id === id).costMinor
const invValue = () => S().items.reduce((s, it) => s + Math.round((it.stockQty ?? 0) * it.costMinor), 0)

console.log('🍔 التأسيس: خامات + طبق + منتج نصف مصنع')
S().addItem(item({ nameAr: 'لحم مفروم', baseUnit: 'كجم', costMinor: 30000, stockQty: 10 }))
S().addItem(item({ nameAr: 'خبز برجر', costMinor: 500, stockQty: 100 }))
S().addItem(item({ nameAr: 'جبن شرائح', costMinor: 800, stockQty: 50 }))
S().addItem(item({ nameAr: 'طماطم', baseUnit: 'كجم', costMinor: 2000, stockQty: 20 }))
S().addItem(item({ nameAr: 'برجر لحم', priceMinor: 15000 })) // الطبق — بلا مخزون وبلا تكلفة يدوية
S().addItem(item({ nameAr: 'صوص خاص', priceMinor: 3000 })) // منتج نصف مصنع
const [meat, bun, cheese, tomato, burger, sauce] = S().items.slice(-6).map((i) => i.id)
const openingInv = invValue()
const opening1103 = bal('1103') // المخزون الافتتاحي عبر addItem بلا قيد — نقارن الفروقات

console.log('👨‍🍳 وصفة الطبق «عند الطلب»')
const r1 = S().addRecipe({
  productItemId: burger, mode: 'made_to_order', yieldQty: 1,
  ingredients: [{ itemId: meat, qty: 0.15 }, { itemId: bun, qty: 1 }, { itemId: cheese, qty: 2 }, { itemId: tomato, qty: 0.05 }],
  overheadMinor: 0, isActive: true, notes: '',
})
// 0.15×30000 + 1×500 + 2×800 + 0.05×2000 = 4500+500+1600+100 = 6700
ok('تكلفة الطبق مشتقة آلياً = 67', S().getRecipeUnitCost(r1.id) === 6700)
throws('وصفة ثانية لنفس الصنف تُرفض', () => S().addRecipe({ productItemId: burger, mode: 'made_to_order', yieldQty: 1, ingredients: [{ itemId: bun, qty: 1 }], overheadMinor: 0, isActive: true, notes: '' }), 'بالفعل')
throws('المنتج مكوناً في وصفة نفسه يُرفض', () => S().addRecipe({ productItemId: sauce, mode: 'prepped', yieldQty: 10, ingredients: [{ itemId: sauce, qty: 1 }], overheadMinor: 0, isActive: true, notes: '' }), 'نفسه')
throws('طبق عند الطلب كمكوّن يُرفض', () => S().addRecipe({ productItemId: sauce, mode: 'prepped', yieldQty: 10, ingredients: [{ itemId: burger, qty: 1 }], overheadMinor: 0, isActive: true, notes: '' }), 'لا يصلح')

console.log('🛒 بيع الطبق يخصم الخامات لا الطبق')
const gl5101Before = bal('5101')
const sale = S().postSale({
  lines: [{ itemId: burger, nameAr: 'برجر لحم', qty: 2, unitPriceMinor: 15000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
ok('اللحم خُصم 0.3 كجم', stockOf(meat) === 9.7)
ok('الخبز خُصم 2', stockOf(bun) === 98)
ok('الجبن خُصم 4 شرائح', stockOf(cheese) === 46)
ok('مخزون الطبق نفسه لم يُمس (صفر)', stockOf(burger) === 0)
ok('تكلفة السطر في الفاتورة = 67 للطبق', sale.lines[0].unitCostMinor === 6700)
ok('قيد COGS = 134 (طبقان)', bal('5101') - gl5101Before === 13400)
ok('حركة 1103 تطابق حركة قيمة المخزون', bal('1103') - opening1103 === invValue() - openingInv && invValue() === openingInv - 13400)
throws('بيع 100 برجر بلا خامات كافية يُرفض', () => S().postSale({
  lines: [{ itemId: burger, nameAr: 'برجر لحم', qty: 100, unitPriceMinor: 15000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
}), 'مخزون غير كافٍ')

console.log('↩️ مرتجع الطبق: السعر يُرد والخامات المطهية لا تعود')
const meatBefore = stockOf(meat)
const inv1103Before = bal('1103')
S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[burger, 1]]), refund: 'cash', reason: 'شكوى' })
ok('الخامات لم تعد للمخزون', stockOf(meat) === meatBefore && bal('1103') === inv1103Before)
ok('التكلفة بقيت في 5101 (هالك)', bal('5101') - gl5101Before === 13400)
ok('الدفتر متوازن بعد المرتجع', balanced())

console.log('🏭 الإنتاج المسبق: صوص من خامات + مصاريف تشغيل')
const r2 = S().addRecipe({
  productItemId: sauce, mode: 'prepped', yieldQty: 20,
  ingredients: [{ itemId: tomato, qty: 5 }, { itemId: cheese, qty: 10 }],
  overheadMinor: 2000, isActive: true, notes: '',
})
// تشغيلة: 5×2000 + 10×800 = 18000 خامات + 2000 تشغيل = 20000 ÷ 20 = 1000 للوحدة
ok('تكلفة وحدة الصوص = 10', S().getRecipeUnitCost(r2.id) === 1000)
const invBeforeProd = invValue()
const cashBefore = bal('1101')
const order = S().postProduction({ recipeId: r2.id, batches: 2, treasury: '1101' })
ok('أمر الإنتاج PRD مرقم بمرجع', order.orderNumber === 'PRD-0001' && order.refCode.startsWith('PRD-'))
ok('أُنتج 40 صوص', order.producedQty === 40 && stockOf(sauce) === 40)
ok('الخامات استُهلكت (طماطم −10، جبن −20)', stockOf(tomato) === 9.9 && stockOf(cheese) === 26)
ok('تكلفة الصوص بالمتوسط = 10', costOf(sauce) === 1000)
ok('قيمة المخزون ارتفعت بمصاريف التشغيل فقط', invValue() === invBeforeProd + 4000)
ok('الخزينة دفعت مصاريف التشغيل 40', bal('1101') - cashBefore === -4000)
ok('حركة 1103 ما زالت تطابق حركة المخزون', bal('1103') - opening1103 === invValue() - openingInv)
throws('إنتاج بخامات غير كافية يُرفض', () => S().postProduction({ recipeId: r2.id, batches: 100 }), 'خامات غير كافية')
throws('إنتاج من وصفة «عند الطلب» يُرفض', () => S().postProduction({ recipeId: r1.id, batches: 1 }), 'إنتاج مسبق')
throws('تشغيلات صفر تُرفض', () => S().postProduction({ recipeId: r2.id, batches: 0 }), 'موجباً')

console.log('🥪 الصوص المنتَج يُباع كصنف عادي ويصلح مكوناً')
S().postSale({
  lines: [{ itemId: sauce, nameAr: 'صوص خاص', qty: 5, unitPriceMinor: 3000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
ok('بيع الصوص خصم مخزونه مباشرة', stockOf(sauce) === 35)
S().updateRecipe(r1.id, {
  productItemId: burger, mode: 'made_to_order', yieldQty: 1,
  ingredients: [{ itemId: meat, qty: 0.15 }, { itemId: bun, qty: 1 }, { itemId: sauce, qty: 1 }],
  overheadMinor: 0, isActive: true, notes: 'نسخة بالصوص',
})
// 4500 + 500 + 1000 = 6000
ok('تعديل الوصفة بمنتج مسبق كمكوّن يعمل', S().getRecipeUnitCost(r1.id) === 6000)
const sauceBefore = stockOf(sauce)
S().postSale({
  lines: [{ itemId: burger, nameAr: 'برجر لحم', qty: 1, unitPriceMinor: 15000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
ok('بيع البرجر الجديد خصم صوصاً واحداً', stockOf(sauce) === sauceBefore - 1)

console.log('🔌 تعطيل الوصفة يعيد الطبق صنفاً عادياً')
S().toggleRecipe(r1.id)
throws('بيع الطبق المعطل وصفته بلا مخزون يُرفض', () => S().postSale({
  lines: [{ itemId: burger, nameAr: 'برجر لحم', qty: 1, unitPriceMinor: 15000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
}), 'مخزون غير كافٍ')
throws('حذف وصفة لها أوامر إنتاج يُرفض', () => S().removeRecipe(r2.id), 'أوامر إنتاج')

console.log('⚖️ الميزان النهائي')
ok('الدفتر متوازن بعد كل العمليات', balanced())
ok('حركة 1103 = حركة قيمة المخزون (كمية×متوسط)', bal('1103') - opening1103 === invValue() - openingInv)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 الوصفات والتصنيع تعمل: تكلفة الطبق آلية والمخزون والدفتر متطابقان')
