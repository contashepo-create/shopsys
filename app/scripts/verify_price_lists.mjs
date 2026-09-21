/**
 * فحص قوائم الأسعار: قائمة بخصم افتراضي + أسعار خاصة، ربط العملاء،
 * حل السعر الفعلي (خاص ← خصم ← تجزئة)، والبيع بسعر القائمة يقيد صحيحاً.
 * تشغيل: node --experimental-strip-types scripts/verify_price_lists.mjs
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

console.log('🏷️ إنشاء القوائم')
const wholesale = S().addPriceList('جملة', 10)
const vip = S().addPriceList('VIP', 0)
ok('قائمتان نشطتان', S().priceLists.length === 2 && wholesale.isActive)
throws('اسم مكرر يُرفض', () => S().addPriceList('جملة', 5), 'بهذا الاسم')
throws('خصم فوق 100 يُرفض', () => S().addPriceList('غلط', 150), 'بين 0 و100')
throws('اسم فارغ يُرفض', () => S().addPriceList('  ', 0), 'مطلوب')

console.log('💲 حل السعر الفعلي')
S().addItem(item({ nameAr: 'أرز 5 كجم', costMinor: 8000, stockQty: 100, priceMinor: 10000 }))
S().addItem(item({ nameAr: 'زيت 1 لتر', costMinor: 4000, stockQty: 100, priceMinor: 5000 }))
const [rice, oil] = S().items.slice(-2).map((i) => i.id)
ok('بلا قائمة = تجزئة', S().getEffectivePrice(rice, null) === 10000)
ok('قائمة الجملة بلا سعر خاص = خصم 10٪', S().getEffectivePrice(rice, wholesale.id) === 9000)
S().setPriceListEntry(wholesale.id, rice, 8500)
ok('السعر الخاص يتقدم على الخصم', S().getEffectivePrice(rice, wholesale.id) === 8500)
ok('صنف آخر ما زال بالخصم الافتراضي', S().getEffectivePrice(oil, wholesale.id) === 4500)
ok('قائمة VIP بلا خصم وبلا سعر خاص = تجزئة', S().getEffectivePrice(rice, vip.id) === 10000)
S().setPriceListEntry(wholesale.id, rice, null)
ok('حذف السعر الخاص يعيد الخصم', S().getEffectivePrice(rice, wholesale.id) === 9000)
S().setPriceListEntry(wholesale.id, rice, 8500)
throws('سعر خاص صفري يُرفض', () => S().setPriceListEntry(wholesale.id, oil, 0), 'أكبر من صفر')
throws('قائمة غير موجودة تُرفض', () => S().setPriceListEntry(999, oil, 100), 'غير موجودة')

console.log('👥 ربط العملاء')
S().addCustomer({ nameAr: 'سوبر ماركت النور', phone: '', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cust = S().customers.at(-1)
S().setCustomerPriceList(cust.id, wholesale.id)
ok('العميل رُبط بالجملة', S().customers.find((c) => c.id === cust.id).priceListId === wholesale.id)
throws('ربط بقائمة معطلة يُرفض', () => { S().togglePriceList(vip.id); S().setCustomerPriceList(cust.id, vip.id) }, 'معطلة')
throws('حذف قائمة بعملاء يُرفض', () => S().removePriceList(wholesale.id), 'مربوطون')

console.log('🛒 البيع بسعر القائمة يقيد صحيحاً')
const sale = S().postSale({
  lines: [
    { itemId: rice, nameAr: 'أرز 5 كجم', qty: 10, unitPriceMinor: S().getEffectivePrice(rice, wholesale.id), unitCostMinor: 8000, discountPercent: 0, soldByWeight: false },
    { itemId: oil, nameAr: 'زيت 1 لتر', qty: 5, unitPriceMinor: S().getEffectivePrice(oil, wholesale.id), unitCostMinor: 4000, discountPercent: 0, soldByWeight: false },
  ],
  payment: 'cash', treasury: '1101', customerId: cust.id, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
// 10×8500 + 5×4500 = 85000 + 22500 = 107500
ok('إجمالي الفاتورة بأسعار الجملة = 1075', sale.totals.totalMinor === 107_500)
ok('الخزينة استلمت 1075', bal('1101') === 107_500)
ok('المبيعات 4101 بالمثل', bal('4101') === -107_500)
ok('الدفتر متوازن', balanced())

console.log('🔌 تعطيل القائمة يعيد التجزئة')
S().togglePriceList(wholesale.id)
ok('السعر الفعلي عاد للتجزئة', S().getEffectivePrice(rice, wholesale.id) === 10000)
S().togglePriceList(wholesale.id)

console.log('🧹 الحذف الآمن')
S().setCustomerPriceList(cust.id, null)
S().removePriceList(wholesale.id)
ok('حُذفت القائمة وأسعارها الخاصة', S().priceLists.length === 1 && S().priceListEntries.length === 0)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 قوائم الأسعار تعمل: خاص ← خصم افتراضي ← تجزئة، والكاشير يسعّر بقائمة العميل')
