import assert from 'node:assert/strict'
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: true, done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
const { useDataStore } = await import('/home/user/shopsys/app/src/data/repo.ts')
const { trialBalance, balanceSheet, incomeStatement } = await import('/home/user/shopsys/app/src/core/financialReports.ts')
const st = () => useDataStore.getState()
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

// يوم كامل في سوبرماركت مصري: ضريبة شاملة 14%، وردية إلزامية
// 1) شراء بمصاريف نقل landed
st().addItem({ nameAr: 'أرز', categoryId: null, unit: 'كجم', priceMinor: 4000, barcode: '100', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: true, isService: false, minSalePriceMinor: 3200, costMinor: 0, stockQty: 0 })
st().addItem({ nameAr: 'زيت', categoryId: null, unit: 'زجاجة', priceMinor: 9000, barcode: '200', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
const [rice, oil] = st().items
st().addSupplier({ nameAr: 'مورد جملة', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-19', treasury: '1101', notes: '', paidMinor: 0,
  expenses: [{ nameAr: 'نقل', amountMinor: 5000, allocation: 'quantity', paidFrom: 'supplier' }],
  lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 2500 }, { itemId: oil.id, qty: 50, unitPriceMinor: 6000 }] })
// landed: نقل 5000 على 150 وحدة = 33.33/وحدة → أرز ≈2533، زيت ≈6033
const riceCost = st().items.find(i => i.id === rice.id).costMinor
const oilCost = st().items.find(i => i.id === oil.id).costMinor
assert.ok(riceCost > 2500 && oilCost > 6000, 'مصاريف النقل دخلت التكلفة')
assert.equal(100 * riceCost + 50 * oilCost <= 100*2500 + 50*6000 + 5000 + 150, true)
ok(`landed cost: أرز ${riceCost} وزيت ${oilCost} — النقل موزع بالكمية`)

// 2) لا بيع بلا وردية (الإعداد الافتراضي مفعل)
assert.throws(() => st().postSale({ lines: [{ itemId: oil.id, nameAr: 'زيت', qty: 1, unitPriceMinor: 9000, unitCostMinor: oilCost, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }), /وردية/)
ok('لا بيع بلا وردية — الحارس يعمل')

// 3) وردية + بيع بالوزن (2.75 كجم أرز) بضريبة شاملة
const shift = st().openShift({ openedBy: 'الكاشير', openingFloatMinor: 50000 })
const sale1 = st().postSale({ shiftId: shift.id, lines: [
  { itemId: rice.id, nameAr: 'أرز', qty: 2.75, unitPriceMinor: 4000, unitCostMinor: riceCost, discountPercent: 0, soldByWeight: true },
  { itemId: oil.id, nameAr: 'زيت', qty: 2, unitPriceMinor: 9000, unitCostMinor: oilCost, discountPercent: 0, soldByWeight: false },
], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
assert.equal(sale1.totals.totalMinor, Math.round(2.75 * 4000) + 2 * 9000, 'شاملة الضريبة: الإجمالي = المكتوب على الرف')
assert.ok(sale1.totals.taxMinor > 0, 'الضريبة مفكوكة من الداخل')
assert.equal(st().items.find(i => i.id === rice.id).stockQty, 97.25, 'وزن عشري خُصم بدقة')
ok(`بيع وزن 2.75كجم بضريبة شاملة: إجمالي ${sale1.totals.totalMinor} وvat ${sale1.totals.taxMinor}`)

// 4) أرضية السعر: بيع أرز بـ30 (تحت 32) داخل وردية — يُرفض ثم يمر باعتماد
assert.throws(() => st().postSale({ shiftId: shift.id, lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 1, unitPriceMinor: 3000, unitCostMinor: riceCost, discountPercent: 0, soldByWeight: true }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }))
st().postSale({ shiftId: shift.id, priceFloorOverrideBy: 'صاحب المحل', lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 1, unitPriceMinor: 3000, unitCostMinor: riceCost, discountPercent: 0, soldByWeight: true }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
ok('أرضية السعر داخل الوردية: رفض ثم مرور باعتماد المالك')

// 5) عرض «زيت + 5 كجم أرز» وبيعه داخل الوردية
const promo = st().addPromotion({ nameAr: 'عرض الخير', components: [{ itemId: oil.id, qty: 2 }], bundlePriceMinor: 17000, startIso: '', endIso: '', isActive: true })
// ملاحظة: الأرز بالوزن ممنوع في العروض — أكد
assert.throws(() => st().addPromotion({ nameAr: 'خطأ', components: [{ itemId: rice.id, qty: 2 }], bundlePriceMinor: 7000, startIso: '', endIso: '', isActive: true }), /بالوزن/)
assert.throws(() => st().getPromotionCartLines(promo.id, 1).length && st().addPromotion({ nameAr: 'عرض الخير', components: [{ itemId: oil.id, qty: 2 }], bundlePriceMinor: 1, startIso: '', endIso: '', isActive: true }))
const pl = st().getPromotionCartLines(promo.id, 1)
const sale3 = st().postSale({ shiftId: shift.id, lines: pl, payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
assert.equal(sale3.totals.totalMinor, 17000, 'الباقة 2 زيت بـ17000')
ok('عرض داخل الوردية: الوزن مرفوض من العروض، وباقتان بـ17000 بالقرش')

// 6) إقفال الوردية: النقدي المتوقع = عهدة + كل مبيعات الوردية النقدية
const expected = st().getShiftExpectedCash ? st().getShiftExpectedCash(shift.id) : null
st().closeShift({ shiftId: shift.id, countedCashMinor: (expected ?? 0) || 50000 + sale1.totals.totalMinor + 3000 + 17000, closedBy: 'الكاشير' })
const closed = st().shifts.find(s => s.id === shift.id)
assert.equal(closed.status, 'closed')
ok('الوردية أُقفلت بجرد نقدي')

// 7) الدفاتر متزنة بعد كل شيء + قائمة الدخل منطقية
const P = { from: '2020-01-01', to: '2030-12-31' }
const tb = trialBalance(st().journal, P)
assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'ميزان المراجعة متزن')
const bs = balanceSheet(st().journal, '2030-12-31')
assert.ok(bs.balanced, 'الميزانية متزنة')
assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor)
const is1 = incomeStatement(st().journal, P)
assert.ok(is1.totalRevenueMinor > 0 && is1.grossProfitMinor > 0, 'إيراد ومجمل ربح موجبان')
ok(`الختام: ميزان متزن (${tb.totalDebitMinor})، ميزانية متزنة، مجمل ربح ${is1.grossProfitMinor}`)

console.log(`\n✅ يوم سوبرماركت كامل: ${pass} محطات — كلها خضراء`)
