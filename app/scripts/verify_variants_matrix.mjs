/**
 * فحص مصفوفة مخزون لون×مقاس (ملابس — سد فجوة Loyverse/Cegid):
 * توزيع رصيد الصنف على تركيبات بسقف الإجمالي، بيع يُلزم اختيار تركيبة
 * ويخصم من رصيدها والإجمالي معاً، مرتجع يعيدها للتركيبة نفسها،
 * والدفتر يبقى على مستوى الصنف (لا تغيير في القيود).
 * تشغيل: node --experimental-strip-types scripts/verify_variants_matrix.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')
const { variantTotal, hasVariantStock } = await import('../src/core/variants.ts')
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
const vQty = (id, c, sz) => S().variantStocks.find((v) => v.itemId === id && v.color === c && v.size === sz)?.qty ?? 0

console.log('👕 التأسيس: قميص بألوان ومقاسات ورصيد 20')
S().addItem(item({ nameAr: 'قميص قطن', costMinor: 8000, stockQty: 20, priceMinor: 15000, variantColors: ['أبيض', 'أسود'], variantSizes: ['M', 'L', 'XL'] }))
const shirt = S().items.at(-1).id

console.log('📐 توزيع المصفوفة بسقف رصيد الصنف')
S().setVariantStock(shirt, 'أبيض', 'M', 5)
S().setVariantStock(shirt, 'أبيض', 'L', 4)
S().setVariantStock(shirt, 'أسود', 'M', 6)
S().setVariantStock(shirt, 'أسود', 'XL', 3)
ok('4 تركيبات مجموعها 18', variantTotal(S().variantStocks, shirt) === 18)
ok('غير الموزع = 2', S().getUndistributedQty(shirt) === 2)
throws('توزيع يتجاوز الإجمالي يُرفض', () => S().setVariantStock(shirt, 'أبيض', 'XL', 5), 'يتجاوز رصيد الصنف')
throws('لون ليس من ألوان الصنف يُرفض', () => S().setVariantStock(shirt, 'أحمر', 'M', 1), 'ليس من ألوان')
throws('مقاس غريب يُرفض', () => S().setVariantStock(shirt, 'أبيض', 'XXL', 1), 'ليس من مقاسات')
throws('رصيد سالب يُرفض', () => S().setVariantStock(shirt, 'أبيض', 'M', -1), 'سالباً')
S().setVariantStock(shirt, 'أبيض', 'L', 0)
ok('تصفير تركيبة يحذفها من المصفوفة', S().variantStocks.filter((v) => v.itemId === shirt).length === 3)
S().setVariantStock(shirt, 'أبيض', 'L', 4)

console.log('🛒 البيع يُلزم التركيبة ويخصم منها ومن الإجمالي')
throws('بيع بلا تحديد تركيبة يُرفض', () => S().postSale({
  lines: [{ itemId: shirt, nameAr: 'قميص قطن', qty: 1, unitPriceMinor: 15000, unitCostMinor: 8000, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
}), 'حدد اللون')
throws('بيع من تركيبة رصيدها لا يكفي يُرفض', () => S().postSale({
  lines: [{ itemId: shirt, nameAr: 'قميص', qty: 10, unitPriceMinor: 15000, unitCostMinor: 8000, discountPercent: 0, soldByWeight: false, variantColor: 'أسود', variantSize: 'XL' }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
}), 'متاح 3')
const sale = S().postSale({
  lines: [
    { itemId: shirt, nameAr: 'قميص (أبيض/M)', qty: 2, unitPriceMinor: 15000, unitCostMinor: 8000, discountPercent: 0, soldByWeight: false, variantColor: 'أبيض', variantSize: 'M' },
    { itemId: shirt, nameAr: 'قميص (أسود/M)', qty: 1, unitPriceMinor: 15000, unitCostMinor: 8000, discountPercent: 0, soldByWeight: false, variantColor: 'أسود', variantSize: 'M' },
  ],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
ok('أبيض/M نزل إلى 3', vQty(shirt, 'أبيض', 'M') === 3)
ok('أسود/M نزل إلى 5', vQty(shirt, 'أسود', 'M') === 5)
ok('الإجمالي نزل إلى 17', stockOf(shirt) === 17)
ok('COGS على مستوى الصنف = 240', bal('5101') === 24000)
ok('غير الموزع ثابت = 2', S().getUndistributedQty(shirt) === 2)

console.log('↩️ المرتجع يعيد للتركيبة نفسها')
S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[shirt, 1]]), refund: 'cash', reason: 'مقاس غير مناسب' })
// buildReturnLines يوزع FIFO على سطور البيع — أول سطر أبيض/M
ok('أبيض/M عاد إلى 4', vQty(shirt, 'أبيض', 'M') === 4)
ok('الإجمالي عاد إلى 18', stockOf(shirt) === 18)
ok('مجموع المصفوفة = الإجمالي − غير الموزع', variantTotal(S().variantStocks, shirt) === 18 - 2)

console.log('📦 الشراء يزيد الإجمالي وغير الموزع فقط')
S().addSupplier({ nameAr: 'مورد أقمشة', phone: '', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const sup = S().suppliers.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-15', lines: [{ itemId: shirt, qty: 10, unitPriceMinor: 8000, expiryDate: null }], expenses: [], paidMinor: 80000, treasury: '1101', notes: '' })
ok('الإجمالي 28 والمصفوفة كما هي', stockOf(shirt) === 28 && variantTotal(S().variantStocks, shirt) === 16)
ok('غير الموزع صار 12 (بانتظار التوزيع)', S().getUndistributedQty(shirt) === 12)
S().setVariantStock(shirt, 'أسود', 'L', 12)
ok('وُزعت الكمية الجديدة على أسود/L', vQty(shirt, 'أسود', 'L') === 12 && S().getUndistributedQty(shirt) === 0)

console.log('🧢 صنف بلا مصفوفة يباع عادياً')
S().addItem(item({ nameAr: 'حزام جلد', costMinor: 3000, stockQty: 10, priceMinor: 6000 }))
const belt = S().items.at(-1).id
ok('لا مصفوفة للحزام', !hasVariantStock(S().variantStocks, belt))
S().postSale({
  lines: [{ itemId: belt, nameAr: 'حزام جلد', qty: 1, unitPriceMinor: 6000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
ok('بيع عادي بلا إلزام تركيبة', stockOf(belt) === 9)

console.log('⚖️ الميزان')
ok('الدفتر متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 مصفوفة لون×مقاس تعمل: توزيع بسقف، بيع وإرجاع على مستوى التركيبة، ودفتر سليم')
