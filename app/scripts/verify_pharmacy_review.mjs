/**
 * فحص جولة مراجعة نشاط الصيدلية (الطلبات 6–9 — الجولة 4):
 * البيع متعدد الوحدات (قطعة/شريط/علبة) — أهم خصوصية بيع بالصيدلية:
 * ① baseQty: خصم المخزون بالوحدة الأساسية qty×factor
 * ② postSale بسطر وحدة أكبر: مخزون وتكلفة COGS صحيحان + تثبيت متوسط لحظة الترحيل بالمعامل
 * ③ مرتجع سطر وحدة أكبر: يعيد الكمية الأساسية كاملة
 * ④ سعر الوحدة الأكبر المستقل (سعر العلبة ≠ 10 × سعر الشريط بالضرورة)
 * ⑤ FEFO مع الوحدات الكبرى: الخصم من الدفعات بالكمية الأساسية
 * تشغيل: node --experimental-strip-types scripts/verify_pharmacy_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { baseQty, computeTotals } = await import('../src/core/pos.ts')
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

console.log('\n1️⃣ نواة الوحدات (baseQty)')
ok('بلا معامل = الكمية نفسها', baseQty({ qty: 3 }) === 3)
ok('شريط ×10: 2 شريط = 20 قرصاً', baseQty({ qty: 2, unitFactor: 10 }) === 20)
ok('كسور مضبوطة لثلاث خانات', baseQty({ qty: 0.5, unitFactor: 3 }) === 1.5)

console.log('\n2️⃣ بيع بوحدة أكبر (شريط من قرص)')
// دواء: الوحدة الأساسية قرص، شريط = 10 أقراص بسعر مستقل، علبة = 30 قرصاً
S().addItem(item({
  nameAr: 'بنادول', baseUnit: 'قرص', costMinor: 100, priceMinor: 200, stockQty: 300,
  extraUnits: [
    { nameAr: 'شريط', factor: 10, priceMinor: 1_800, barcode: 'STRIP-1' }, // أرخص من 10×200
    { nameAr: 'علبة', factor: 30, priceMinor: 5_000 },
  ],
}))
const drug = S().items.find((i) => i.nameAr === 'بنادول')
ok('سعر الشريط المستقل محفوظ', drug.extraUnits[0].priceMinor === 1_800 && drug.extraUnits[0].barcode === 'STRIP-1')

const stripLine = {
  itemId: drug.id, nameAr: 'بنادول (شريط)', qty: 2,
  unitPriceMinor: 1_800, unitCostMinor: 1_000, // 10 × 100
  discountPercent: 0, soldByWeight: false, unitFactor: 10, unitLabel: 'شريط',
}
const cashBefore = sumAcc('1101')
const sale = S().postSale({ lines: [stripLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
ok('الفاتورة: شريطان = 3,600', sale.totals.totalMinor === 3_600)
ok('المخزون خُصم بالأقراص: 300−20=280', S().items.find((i) => i.id === drug.id).stockQty === 280)
ok('COGS = 20 قرصاً × 100 = 2,000', sale.totals.cogsMinor === 2_000)
ok('النقدية زادت 3,600', sumAcc('1101') === cashBefore + 3_600)

console.log('\n3️⃣ تثبيت متوسط التكلفة بالمعامل (لقطة لحظة الترحيل)')
// سطر أُضيف للسلة بتكلفة قديمة — الترحيل يصحح تكلفة الوحدة الكبرى = متوسط×معامل
const staleLine = { ...stripLine, qty: 1, unitCostMinor: 999 } // تكلفة بالية
const sale2 = S().postSale({ lines: [staleLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
ok('تكلفة السطر ثُبتت على 100×10=1,000 لا 999', sale2.lines[0].unitCostMinor === 1_000 && sale2.totals.cogsMinor === 1_000)

console.log('\n4️⃣ مرتجع سطر الوحدة الأكبر')
const stockBefore = S().items.find((i) => i.id === drug.id).stockQty
const ret = S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[drug.id, 1]]), refund: 'cash', reason: 'انتهاء حاجة' })
ok('رد قيمة شريط 1,800', ret.totals.totalMinor === 1_800)
ok('عاد 10 أقراص للمخزون', S().items.find((i) => i.id === drug.id).stockQty === stockBefore + 10)

console.log('\n5️⃣ FEFO مع الوحدات الكبرى')
S().addItem(item({ nameAr: 'شراب كحة', baseUnit: 'زجاجة', costMinor: 3_000, priceMinor: 5_000, stockQty: 24, trackExpiry: true, extraUnits: [{ nameAr: 'كرتونة', factor: 12 }] }))
const syrup = S().items.find((i) => i.nameAr === 'شراب كحة')
useDataStore.setState({
  batches: [
    { id: 9001, itemId: syrup.id, expiryDate: '2026-10-01', qty: 12, receivedAt: '2026-01-01' },
    { id: 9002, itemId: syrup.id, expiryDate: '2027-05-01', qty: 12, receivedAt: '2026-02-01' },
  ],
})
const cartonLine = { itemId: syrup.id, nameAr: 'شراب كحة (كرتونة)', qty: 1, unitPriceMinor: 55_000, unitCostMinor: 36_000, discountPercent: 0, soldByWeight: false, unitFactor: 12, unitLabel: 'كرتونة' }
S().postSale({ lines: [cartonLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
const b1 = S().batches.find((b) => b.id === 9001), b2 = S().batches.find((b) => b.id === 9002)
ok('FEFO: الدفعة الأقرب انتهاءً استُهلكت كاملة (12)', (b1?.qty ?? 0) === 0)
ok('الدفعة الأبعد لم تُمس', b2.qty === 12)
ok('مخزون الزجاجات 24−12=12', S().items.find((i) => i.id === syrup.id).stockQty === 12)

// حارس المخزون يحسب بالوحدة الأساسية
throws('بيع 2 كرتونة (24 زجاجة) والرصيد 12 يُرفض', () => S().postSale({
  lines: [{ ...cartonLine, qty: 2 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
}), 'مخزون غير كافٍ')

// الضريبة تعمل على أسعار الوحدات الكبرى كأي سطر
const t = computeTotals([{ ...stripLine, qty: 1 }], 0, 14, false)
ok('ضريبة 14٪ مضافة على سعر الشريط', t.taxMinor === Math.round(1_800 * 0.14) && t.totalMinor === 1_800 + t.taxMinor)

const total = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة إجمالاً', total === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
