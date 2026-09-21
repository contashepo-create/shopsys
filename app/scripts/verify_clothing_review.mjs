/**
 * فحص جولة مراجعة نشاط الملابس (الطلبات 6–9 — الجولة 3):
 * ① نواة الاستبدال: تحقق + صافي
 * ② repo.postExchange: مرتجع + بيع مربوطان بمستند EXC + حركة الخزينة الصافية = الفرق
 * ③ الذرية: فشل البيع الجديد يسترجع الحالة (لا مرتجع يتيم)
 * ④ المتغيرات: الاستبدال يخصم من رصيد التركيبة الجديدة ويعيد للأصل
 * تشغيل: node --experimental-strip-types scripts/verify_clothing_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { validateExchange, computeExchangeNet } = await import('../src/core/exchange.ts')
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

console.log('\n1️⃣ نواة الاستبدال')
ok('صافي موجب = يدفع العميل', computeExchangeNet(10_000, 15_000).netMinor === 5_000)
ok('صافي سالب = نرد له', computeExchangeNet(15_000, 10_000).netMinor === -5_000)
ok('متكافئ = صفر', computeExchangeNet(10_000, 10_000).netMinor === 0)
ok('بلا مرتجع يُرفض', validateExchange({ returnLines: [], newLines: [{ itemId: 1, qty: 1 }] }).some((e) => e.includes('إرجاع')))
ok('بلا جديد يُرفض', validateExchange({ returnLines: [{ itemId: 1, qty: 1 }], newLines: [] }).some((e) => e.includes('مرتجع عادي')))
ok('كمية سالبة تُرفض', validateExchange({ returnLines: [{ itemId: 1, qty: -1 }], newLines: [{ itemId: 2, qty: 1 }] }).length > 0)
ok('مدخل سليم يمر', validateExchange({ returnLines: [{ itemId: 1, qty: 1 }], newLines: [{ itemId: 2, qty: 1 }] }).length === 0)

console.log('\n2️⃣ الاستبدال في المخزن (repo)')
// تجهيز: صنفان + بيع أصلي
S().addItem(item({ nameAr: 'قميص M', costMinor: 5_000, priceMinor: 10_000, stockQty: 10 }))
S().addItem(item({ nameAr: 'قميص L', costMinor: 5_000, priceMinor: 12_000, stockQty: 10 }))
const shirtM = S().items.find((i) => i.nameAr === 'قميص M')
const shirtL = S().items.find((i) => i.nameAr === 'قميص L')
const cline = (it, qty) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: it.priceMinor, unitCostMinor: it.costMinor, discountPercent: 0, soldByWeight: false })
const sale = S().postSale({ lines: [cline(shirtM, 2)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
ok('البيع الأصلي: قميصان M بـ20,000', sale.totals.totalMinor === 20_000)
const cashBefore = sumAcc('1101')

// استبدال قطعة M بقطعة L (فرق +2,000 يدفعه العميل)
const doc = S().postExchange({
  originalSaleId: sale.id,
  returnQtyByItem: new Map([[shirtM.id, 1]]),
  newLines: [cline(shirtL, 1)],
  notes: 'مقاس أكبر',
})
ok('مستند EXC-0001 وصافي +2,000', doc.exchangeNumber === 'EXC-0001' && doc.netMinor === 2_000)
ok('المرتجع والبيع الجديد موجودان ومربوطان', S().saleReturns.some((r) => r.id === doc.returnId) && S().sales.some((x) => x.id === doc.newSaleId))
ok('حركة الخزينة الصافية = الفرق فقط (+2,000)', sumAcc('1101') === cashBefore + 2_000)
ok('مخزون M عاد 9 (8+1 مرتجع)', S().items.find((i) => i.id === shirtM.id).stockQty === 9)
ok('مخزون L نقص إلى 9', S().items.find((i) => i.id === shirtL.id).stockQty === 9)
ok('قيدا العمليتين كاملان (4102 مدين 10,000 و4101 دائن إضافي 12,000)', sumAcc('4102') === 10_000)
ok('سبب المرتجع يذكر الاستبدال', S().saleReturns.find((r) => r.id === doc.returnId).reason.includes('استبدال'))

console.log('\n3️⃣ الذرية (لا مرتجع يتيم)')
const stateBefore = { returns: S().saleReturns.length, sales: S().sales.length, journal: S().journal.length, exchanges: S().exchanges.length }
throws('بيع جديد بمخزون غير كافٍ يفشل', () => S().postExchange({
  originalSaleId: sale.id,
  returnQtyByItem: new Map([[shirtM.id, 1]]),
  newLines: [cline(shirtL, 500)],
  notes: '',
}), 'مخزون')
ok('لا مرتجع يتيم — الحالة استُرجعت بالكامل',
  S().saleReturns.length === stateBefore.returns && S().sales.length === stateBefore.sales &&
  S().journal.length === stateBefore.journal && S().exchanges.length === stateBefore.exchanges)
throws('تجاوز المتبقي القابل للإرجاع يُرفض', () => S().postExchange({
  originalSaleId: sale.id,
  returnQtyByItem: new Map([[shirtM.id, 99]]),
  newLines: [cline(shirtL, 1)],
  notes: '',
}))
throws('فاتورة شبح تُرفض', () => S().postExchange({ originalSaleId: 9999, returnQtyByItem: new Map([[1, 1]]), newLines: [cline(shirtL, 1)], notes: '' }), 'غير موجودة')
throws('بلا قطع جديدة يُرفض (مرتجع عادي)', () => S().postExchange({ originalSaleId: sale.id, returnQtyByItem: new Map([[shirtM.id, 1]]), newLines: [], notes: '' }), 'مرتجع عادي')

console.log('\n4️⃣ الاستبدال مع تشكيلة لون×مقاس')
S().addItem(item({ nameAr: 'بلوفر', costMinor: 8_000, priceMinor: 15_000, stockQty: 6, variantColors: ['أحمر', 'أزرق'], variantSizes: ['M', 'L'] }))
const plv = S().items.find((i) => i.nameAr === 'بلوفر')
S().setVariantStock(plv.id, 'أحمر', 'M', 3)
S().setVariantStock(plv.id, 'أزرق', 'L', 3)
const vline = (color, size, qty) => ({ itemId: plv.id, nameAr: 'بلوفر', qty, unitPriceMinor: 15_000, unitCostMinor: 8_000, discountPercent: 0, soldByWeight: false, variantColor: color, variantSize: size })
const vSale = S().postSale({ lines: [vline('أحمر', 'M', 1)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
const vDoc = S().postExchange({
  originalSaleId: vSale.id,
  returnQtyByItem: new Map([[plv.id, 1]]),
  newLines: [vline('أزرق', 'L', 1)],
  notes: 'تغيير لون ومقاس',
})
ok('استبدال تشكيلة متكافئ (صافي صفر)', vDoc.netMinor === 0)
const vs = (c, z) => S().variantStocks.find((v) => v.itemId === plv.id && v.color === c && v.size === z)?.qty ?? 0
ok('رصيد أزرق/L خُصم إلى 2', vs('أزرق', 'L') === 2)
ok('رصيد أحمر/M عاد إلى 3 (المرتجع رجع لتركيبته)', vs('أحمر', 'M') === 3)
ok('إجمالي رصيد الصنف 5 (بيع أصلي 1 + مرتجع 1 − بيع جديد 1)', S().items.find((i) => i.id === plv.id).stockQty === 5)

// اتزان شامل
const total = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة إجمالاً', total === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
