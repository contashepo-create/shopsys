/**
 * 🧑‍💼 رحلة مستخدم — كل أنماط البيع عبر الأنشطة وأثرها على كل الأقسام
 * ──────────────────────────────────────────────────────────────
 * أتصرف كصاحب محل: أشتري بضاعة (متوسط مرجح)، أبيع بكل الأنماط —
 * نقدي/آجل/مجزأ/بضريبة/بخصومات/بوحدة أكبر/بسيريال/بتركيبة/بوصفة مطعم/
 * بقائمة أسعار/من مخزن فرعي/بدفعات صلاحية FEFO — وبعد كل عملية أتحقق من:
 * الخزينة، الذمم، المخزون، متوسط التكلفة، الضريبة، الوردية، الميزان.
 * سكربت استكشافي: node --experimental-strip-types scripts/user_journey_sales.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let step = 0
const ok = (name) => { step++; console.log(`  ✓ [${String(step).padStart(2, '0')}] ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance, incomeStatement } = await import(join(root, 'src/core/financialReports.ts'))
const { summarizeShift } = await import(join(root, 'src/core/shifts.ts'))
const { ExpiredStockError } = await import(join(root, 'src/core/batches.ts'))

const st = () => useDataStore.getState()
const P = { from: '2000-01-01', to: '2099-12-31' }
const bal = (code) => {
  let d = 0, c = 0
  for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) { d += l.debit; c += l.credit }
  return d - c
}
const assertAllBalanced = () => {
  for (const e of st().journal) {
    const d = e.lines.reduce((a, l) => a + l.debit, 0)
    const c = e.lines.reduce((a, l) => a + l.credit, 0)
    assert.equal(d, c, `قيد غير متوازن: #${e.id} ${e.description}`)
  }
}

console.log('\n🧑‍💼 رحلة المستخدم — كل أنماط البيع وأثرها على الأقسام\n')

/* ═══ التجهيز: مورد + أصناف متنوعة ═══ */
useDataStore.setState({ warehouses: [
  { id: 1, nameAr: 'الرئيسي', isMain: true },
  { id: 2, nameAr: 'الفرع', isMain: false },
] })
st().addSupplier({ nameAr: 'مورد الجملة', phone: '0100', address: '', notes: '', openingMinor: 0 })
const supplier = st().suppliers.at(-1)

// أصناف: عادي، دواء بوحدات وصلاحية، موبايل بسيريال، قميص بتركيبات، مكونات طبق
const baseItem = (nameAr, sku, cost, price, extra = {}) => ({
  nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: cost, stockQty: 0, priceMinor: price, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...extra,
})
st().addItem(baseItem('سخان كهربائي', 'HT-1', 0, 80000))
st().addItem(baseItem('دواء باراسيتامول', 'MED-1', 0, 500, {
  trackExpiry: true,
  extraUnits: [{ nameAr: 'شريط', factor: 10, priceMinor: 4500, barcode: 'STRIP-1' }, { nameAr: 'علبة', factor: 20, priceMinor: 8500, barcode: 'BOX-1' }],
}))
st().addItem(baseItem('موبايل X10', 'MOB-1', 0, 500000, { trackSerial: true, warrantyMonths: 12 }))
st().addItem(baseItem('قميص قطن', 'SHIRT-1', 0, 25000, { variantColors: ['أبيض', 'أسود'], variantSizes: ['M', 'L'] }))
st().addItem(baseItem('أرز خام', 'RICE-1', 0, 0, { soldByWeight: true }))
st().addItem(baseItem('دجاج خام', 'CHK-1', 0, 0))
st().addItem(baseItem('طبق كبسة', 'DISH-1', 0, 15000))
const [heater, med, mobile, shirt, rice, chicken, dish] = st().items
st().addCustomer({ nameAr: 'شركة النور', phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const corp = st().customers.at(-1)
ok('جهزت المحل: مورد + 7 أصناف (عادي/دواء بوحدات/موبايل بسيريال/قميص بتركيبات/خامات مطبخ)')

/* ═══ 1: الشراء يؤسس المتوسط المرجح — البيع لا يمس التكلفة يدوياً ═══ */
console.log('\n─── 1: متوسط التكلفة من المشتريات فقط (قرار المالك: لا تكلفة يدوية) ───')
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-01',
  lines: [{ itemId: heater.id, qty: 10, unitPriceMinor: 50000 }],
  expenses: [], paidMinor: 500000, treasury: '1101', notes: '',
})
assert.equal(st().items.find((i) => i.id === heater.id).costMinor, 50000)
// شراء ثانٍ أغلى: 10 أخرى بـ600 ⇒ متوسط (500+600)/2 = 550
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-02',
  lines: [{ itemId: heater.id, qty: 10, unitPriceMinor: 60000 }],
  expenses: [], paidMinor: 600000, treasury: '1101', notes: '',
})
assert.equal(st().items.find((i) => i.id === heater.id).costMinor, 55000)
ok('المتوسط المرجح: شراء 10×500 ثم 10×600 ⇒ التكلفة 550.00 تلقائياً')

// البيع يثبت تكلفة لحظة الترحيل حتى لو أرسلت السلة تكلفة قديمة/خاطئة
const s1 = st().postSale({
  lines: [{ itemId: heater.id, nameAr: heater.nameAr, qty: 2, unitPriceMinor: 80000, unitCostMinor: 11111, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
})
assert.equal(s1.lines[0].unitCostMinor, 55000)
assert.equal(s1.totals.cogsMinor, 110000)
ok('تثبيت التكلفة لحظة الترحيل: السلة أرسلت 111.11 والقيد خرج بالمتوسط الفعلي 550.00')

/* ═══ 2: البيع بوحدة أكبر (صيدلية) + FEFO ═══ */
console.log('\n─── 2: صيدلية — بيع بالشريط/العلبة ودفعات صلاحية FEFO ───')
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-03',
  lines: [{ itemId: med.id, qty: 100, unitPriceMinor: 300, expiryDate: '2026-10-01' }],
  expenses: [], paidMinor: 30000, treasury: '1101', notes: '',
})
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-04',
  lines: [{ itemId: med.id, qty: 100, unitPriceMinor: 300, expiryDate: '2027-05-01' }],
  expenses: [], paidMinor: 30000, treasury: '1101', notes: '',
})
// بيع علبة (20 قرصاً): المخزون يُخصم بالوحدة الأساسية والدفعة الأقرب انتهاءً أولاً
const medStock0 = st().items.find((i) => i.id === med.id).stockQty
const s2 = st().postSale({
  lines: [{ itemId: med.id, nameAr: 'باراسيتامول (علبة)', qty: 1, unitPriceMinor: 8500, unitCostMinor: 6000, discountPercent: 0, soldByWeight: false, unitFactor: 20, unitLabel: 'علبة' }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
})
assert.equal(st().items.find((i) => i.id === med.id).stockQty, medStock0 - 20)
ok('بيع علبة ×20: المخزون خُصم 20 قرصاً بالوحدة الأساسية')
const oldBatch = st().batches.find((b) => b.itemId === med.id && b.expiryDate === '2026-10-01')
assert.equal(oldBatch.qty, 80)
ok('FEFO: الخصم من الدفعة الأقرب انتهاءً (2026-10) أولاً — بقي 80')
// بيع يمس المنتهي بعد انتهاء الدفعة الأولى محظور بلا اعتماد
useDataStore.setState({ batches: st().batches.map((b) => (b.id === oldBatch.id ? { ...b, expiryDate: '2026-09-01' } : b)) })
assert.throws(
  () => st().postSale({ lines: [{ itemId: med.id, nameAr: med.nameAr, qty: 5, unitPriceMinor: 500, unitCostMinor: 300, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
  (e) => e instanceof ExpiredStockError,
)
ok('بيع يمس كمية منتهية ⇒ ExpiredStockError (يحتاج اعتماد مدير)')
const s2b = st().postSale({ lines: [{ itemId: med.id, nameAr: med.nameAr, qty: 5, unitPriceMinor: 500, unitCostMinor: 300, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', expiryOverrideBy: 'المدير' })
assert.equal(s2b.expiryOverrideBy, 'المدير')
ok('التجاوز المعتمد يمر واسم المعتمد على الفاتورة')

/* ═══ 3: موبايل بسيريال وضمان ═══ */
console.log('\n─── 3: موبايلات — بيع بالقطعة المعيّنة (IMEI) وضمانها ───')
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-05',
  lines: [{ itemId: mobile.id, qty: 3, unitPriceMinor: 400000, serialsRaw: 'IMEI-111\nIMEI-222\nIMEI-333' }],
  expenses: [], paidMinor: 0, treasury: '1101', notes: '',
})
// بيع بلا تعيين سيريال مرفوض (يوجد سيريالات متاحة)
assert.throws(
  () => st().postSale({ lines: [{ itemId: mobile.id, nameAr: mobile.nameAr, qty: 1, unitPriceMinor: 500000, unitCostMinor: 400000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
  /سيريال/,
)
ok('بيع موبايل بلا تعيين IMEI مرفوض — القطعة المعيّنة إلزامية')
const s3 = st().postSale({
  lines: [{ itemId: mobile.id, nameAr: mobile.nameAr, qty: 1, unitPriceMinor: 500000, unitCostMinor: 400000, discountPercent: 0, soldByWeight: false, serials: ['IMEI-222'] }],
  customerId: corp.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0,
})
const soldUnit = st().serials.find((u) => u.serial === 'IMEI-222')
assert.equal(soldUnit.status, 'sold')
assert.equal(soldUnit.saleId, s3.id)
const { warrantyLookup } = await import(join(root, 'src/core/serials.ts'))
const w = warrantyLookup(st().serials, 'IMEI-222', new Date().toISOString())
assert.ok(w && w.active && w.warrantyUntil > '2027-09-01')
ok('IMEI-222 مباعة ومربوطة بفاتورتها — الضمان 12 شهراً سارٍ (يُحسب من تاريخ البيع)')

/* ═══ 4: ملابس بتركيبات لون/مقاس ═══ */
console.log('\n─── 4: ملابس — البيع من رصيد التركيبة ───')
useDataStore.setState({
  variantStocks: [
    { itemId: shirt.id, color: 'أبيض', size: 'M', qty: 5 },
    { itemId: shirt.id, color: 'أسود', size: 'L', qty: 3 },
  ],
  items: st().items.map((i) => (i.id === shirt.id ? { ...i, stockQty: 8, costMinor: 12000 } : i)),
})
// بيع بلا تحديد تركيبة مرفوض
assert.throws(
  () => st().postSale({ lines: [{ itemId: shirt.id, nameAr: shirt.nameAr, qty: 1, unitPriceMinor: 25000, unitCostMinor: 12000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
  /اللون|المقاس/,
)
ok('بيع قميص بلا لون/مقاس مرفوض — الصنف موزع على تركيبات')
st().postSale({
  lines: [{ itemId: shirt.id, nameAr: 'قميص (أبيض M)', qty: 2, unitPriceMinor: 25000, unitCostMinor: 12000, discountPercent: 0, soldByWeight: false, variantColor: 'أبيض', variantSize: 'M' }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
})
assert.equal(st().variantStocks.find((v) => v.itemId === shirt.id && v.color === 'أبيض').qty, 3)
assert.equal(st().items.find((i) => i.id === shirt.id).stockQty, 6)
ok('بيع 2 أبيض/M: رصيد التركيبة 5→3 والإجمالي 8→6 معاً')
// تجاوز رصيد التركيبة مرفوض حتى لو الإجمالي يكفي
assert.throws(
  () => st().postSale({ lines: [{ itemId: shirt.id, nameAr: 'قميص (أسود L)', qty: 4, unitPriceMinor: 25000, unitCostMinor: 12000, discountPercent: 0, soldByWeight: false, variantColor: 'أسود', variantSize: 'L' }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
  /رصيد|متاح/,
)
ok('طلب 4 أسود/L والمتاح 3 مرفوض — رغم أن إجمالي الصنف 6')

/* ═══ 5: مطعم — طبق بوصفة عند الطلب ═══ */
console.log('\n─── 5: مطعم — الطبق يفكك لخاماته والفوترة عبر أمر الصالة ───')
st().postPurchase({
  supplierId: supplier.id, date: '2026-09-06',
  lines: [{ itemId: rice.id, qty: 20, unitPriceMinor: 2000 }, { itemId: chicken.id, qty: 10, unitPriceMinor: 8000 }],
  expenses: [], paidMinor: 120000, treasury: '1101', notes: '',
})
st().addRecipe({
  productItemId: dish.id, mode: 'made_to_order', yieldQty: 1,
  ingredients: [{ itemId: rice.id, qty: 0.5 }, { itemId: chicken.id, qty: 0.25 }],
  overheadMinor: 0, isActive: true, notes: '',
})
const order = st().openRestaurantOrder({ type: 'dine_in', tableName: 'طاولة 5' })
st().setRestaurantOrderLines(order.id, [
  { itemId: dish.id, nameAr: dish.nameAr, qty: 2, unitPriceMinor: 15000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false },
])
const riceBefore = st().items.find((i) => i.id === rice.id).stockQty
const s5 = st().settleRestaurantOrder({ orderId: order.id, payment: 'cash', taxPercent: 14, taxInclusive: true, treasury: '1101', serviceChargePercent: 10 })
// طبقان: أرز 2×0.5=1 ودجاج 2×0.25=0.5 خُصما — الطبق نفسه بلا مخزون
assert.equal(st().items.find((i) => i.id === rice.id).stockQty, riceBefore - 1)
assert.equal(st().items.find((i) => i.id === dish.id).stockQty, 0)
ok('طبقان كبسة: خُصم أرز 1 كجم ودجاج 0.5 — الطبق نفسه بلا مخزون')
// تكلفة الطبق = تكلفة خاماته
const dishLine = s5.lines.find((l) => l.itemId === dish.id)
assert.equal(dishLine.unitCostMinor, Math.round(0.5 * 2000 + 0.25 * 8000))
ok('تكلفة الطبق = خاماته بالمتوسط (0.5×20 + 0.25×80 = 30.00)')
assert.ok(s5.lines.some((l) => l.nameAr.includes('رسوم خدمة')))
ok('رسوم الخدمة 10٪ سطر صناعي في الفاتورة — تدخل الإيراد والضريبة')
assert.equal(st().restaurantOrders.find((o) => o.id === order.id).status, 'settled')
ok('أمر الطاولة أُقفل وربط بفاتورته')

/* ═══ 6: حد الائتمان — الحارس الجديد يعمل في التدفق الكامل ═══ */
console.log('\n─── 6: حد الائتمان (الفجوة المسدودة) في تدفق حقيقي ───')
st().addCustomer({ nameAr: 'عميل بحد', phone: '0155', address: '', notes: '', openingMinor: 0, creditLimitMinor: 100000 })
const limited = st().customers.at(-1)
st().postSale({ lines: [{ itemId: heater.id, nameAr: heater.nameAr, qty: 1, unitPriceMinor: 80000, unitCostMinor: 55000, discountPercent: 0, soldByWeight: false }], customerId: limited.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
assert.throws(
  () => st().postSale({ lines: [{ itemId: heater.id, nameAr: heater.nameAr, qty: 1, unitPriceMinor: 80000, unitCostMinor: 55000, discountPercent: 0, soldByWeight: false }], customerId: limited.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 }),
  /حد ائتمانه/,
)
ok('آجل 800 ثم آجل 800 آخر على حد 1000 — الثاني مرفوض برسالة واضحة')
// سداد يحرر الحد
st().receiveClientPayment({ customerId: limited.id, amountMinor: 50000, treasury: '1101' })
st().postSale({ lines: [{ itemId: heater.id, nameAr: heater.nameAr, qty: 1, unitPriceMinor: 80000, unitCostMinor: 55000, discountPercent: 0, soldByWeight: false }], customerId: limited.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 30000 })
ok('تحصيل 500 حرر الحد — بيع مجزأ جديد (آجل 500) يمر بالضبط عند الحد')

/* ═══ 7: الخصومات والدقة الحسابية ═══ */
console.log('\n─── 7: خصم سطر + خصم فاتورة + ضريبة شاملة — الدقة بالقرش ───')
const s7 = st().postSale({
  lines: [
    { itemId: heater.id, nameAr: heater.nameAr, qty: 3, unitPriceMinor: 80000, unitCostMinor: 55000, discountPercent: 10, soldByWeight: false },
    { itemId: med.id, nameAr: med.nameAr, qty: 10, unitPriceMinor: 500, unitCostMinor: 300, discountPercent: 0, soldByWeight: false, vatPercentOverride: 0 },
  ],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 5, taxPercent: 14, taxInclusive: true, treasury: '1101',
  expiryOverrideBy: 'المدير', // دفعة الدواء القديمة انتهت في سيناريو 2 — النظام أوقفنا بحق فاعتمدنا
})
// يدوياً: سخانات 240000−10%=216000، دواء 5000؛ بعد خصم فاتورة 5%: 221000−11050=209950
assert.equal(s7.totals.totalMinor, 209950)
// الدواء معفى (override=0) — الضريبة على نصيب السخانات فقط
const heaterNet = 216000 - Math.round((11050 * 216000) / 221000)
const expectedTax = heaterNet - Math.round(heaterNet / 1.14)
assert.equal(s7.totals.taxMinor, expectedTax)
ok(`مختلطة (خاضع + معفى): الإجمالي 2099.50 والضريبة على الخاضع فقط ${(expectedTax / 100).toFixed(2)}`)
assert.equal(s7.totals.taxBaseMinor + s7.totals.taxMinor, s7.totals.totalMinor)
ok('الأساس + الضريبة = الإجمالي بالقرش (شاملة)')

/* ═══ 8: الختام — الميزان والتقارير بعد كل الأنماط ═══ */
console.log('\n─── 8: الختام المحاسبي ───')
const tb = trialBalance(st().journal, P)
assert.ok(tb.balanced)
ok(`ميزان المراجعة متزن بعد ${st().journal.length} قيداً من كل الأنماط: ${(tb.totalDebitMinor / 100).toFixed(2)}`)
assertAllBalanced()
ok('كل قيد فردي متوازن (بيع/شراء/تحصيل/مطعم)')
const inc = incomeStatement(st().journal, P)
assert.ok(inc.netProfitMinor > 0)
ok(`قائمة الدخل: صافي ربح موجب منطقي ${(inc.netProfitMinor / 100).toFixed(2)}`)
// 1103 الدفتري = قيمة المخزون الفعلية (كل الشراء دخل بقيد والبيع خرج بالمتوسط)
// استثناء موثق: القمصان حُقنت بـsetState بلا قيد افتتاحي (8×120=960) —
// افتتاحيها 720 المتبقي خارج الدفتر + بيعها 240 دائن بلا مدين سابق = فرق 960 متوقع
const bookInv = st().items.reduce((a, i) => a + Math.round((i.stockQty ?? 0) * i.costMinor), 0)
const shirtInjection = 96000
assert.equal(bal('1103'), bookInv - shirtInjection)
ok(`دفتر المخزون 1103 = Σ(كمية×متوسط) − حقن القمصان الصوري: ${((bookInv - shirtInjection) / 100).toFixed(2)} — كل قرش مفسَّر`)

console.log(`\n✅ رحلة مبيعات المستخدم اكتملت: ${step} تحققاً عبر 8 محاور\n`)
