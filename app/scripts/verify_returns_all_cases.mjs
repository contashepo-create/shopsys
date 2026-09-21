/**
 * مراجعة شاملة لكل حالات المرتجعات (أسئلة المالك) + سد الفجوات G1/G2:
 * 1) عميل نقدي: رد نقدي كامل من خزينة البيع، ومنع «على الحساب/إيداع رصيد»
 * 2) الضريبة: مرتجع فاتورة بضريبة شاملة/مضافة يعكس 2102 بنفس معاملة البيع
 * 3) G1: فاتورة مختلطة (صنف خاضع + معفى) — مرتجع الصنف المعفى بلا ضريبة إطلاقاً
 * 4) G2: إيداع رصيداً في حساب العميل (Store Credit) — لا نقدية تخرج ورصيده ينقلب دائناً
 *    والرصيد الدائن يُخصم تلقائياً من فاتورة قادمة
 * 5) المخزون: عودة بالكمية والقيمة التاريخية والمتوسط المرجح سليم
 * 6) مرتجع المشتريات: مخزون بتكلفة الشراء المحملة + منع إرجاع ما بيع
 * 7) الخدمات (مغسلة): إلغاء قبل التسليم يرد العربون (2109) — لا مساس بالإيراد
 * تشغيل: node --experimental-strip-types scripts/verify_returns_all_cases.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { customerStatement } = await import('../src/core/statements.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('1️⃣ عميل نقدي — رد نقدي فقط ومن خزينة البيع الأصلية')
S().seed([])
S().addSupplier({ ...party('مورد'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
S().addItem(item({ nameAr: 'قميص', priceMinor: 20000 }))
const shirt = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: shirt.id, qty: 50, unitPriceMinor: 10000, expiryDate: null }], expenses: [], paidMinor: 500000, notes: '' })
// بيع نقدي على البنك 1102 (خزينة غير افتراضية لاختبار «نفس خزينة البيع»)
const bankT = S().addTreasury('البنك', 'bank')
const BANK = bankT.code
const cashSale = S().postSale({
  lines: [{ itemId: shirt.id, nameAr: 'قميص', qty: 2, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: BANK,
})
throws('«على الحساب» مرفوض للعميل النقدي', () => S().postSaleReturn({ saleId: cashSale.id, qtyByItem: new Map([[shirt.id, 1]]), refund: 'credit', reason: 'x' }), 'عميل نقدي')
throws('«إيداع رصيداً» مرفوض للعميل النقدي', () => S().postSaleReturn({ saleId: cashSale.id, qtyByItem: new Map([[shirt.id, 1]]), refund: 'store_credit', reason: 'x' }), 'عميل نقدي')
const bank0 = bal(BANK)
S().postSaleReturn({ saleId: cashSale.id, qtyByItem: new Map([[shirt.id, 1]]), refund: 'cash', reason: 'مقاس' })
ok('الرد خرج من خزينة البيع نفسها (البنك)', bank0 - bal(BANK) === 20000, `فعلي ${bank0 - bal(BANK)}`)
ok('1104 لم يُمس (لا عميل)', bal('1104') === 0)

console.log('\n2️⃣ الضريبة في المرتجع — بنفس معاملة البيع (مضافة 14٪)')
S().addCustomer({ ...party('شركة النور'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)
const vatSale = S().postSale({
  lines: [{ itemId: shirt.id, nameAr: 'قميص', qty: 10, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0 }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, paidMinor: 0,
})
ok('البيع: 2102 دائن 280 (2000×14٪)', bal('2102') === -28000, `فعلي ${bal('2102')}`)
ok('G1: الفاتورة خزّنت نسبتها (14 مضافة)', vatSale.taxPercent === 14 && vatSale.taxInclusive === false)
S().postSaleReturn({ saleId: vatSale.id, qtyByItem: new Map([[shirt.id, 5]]), refund: 'credit', reason: 'فائض' })
ok('المرتجع عكس نصف الضريبة بالضبط (2102 مدين 140)', bal('2102') === -14000, `فعلي ${bal('2102')}`)
ok('4102 مدين بنصف الأساس (1000) فوق مرتجع الحالة 1 (200)', bal('4102') === 120000, `فعلي ${bal('4102')}`)
ok('ذمة العميل انخفضت بالقيمة مع الضريبة (1140)', bal('1104') === 114000, `فعلي ${bal('1104')}`)
ok('الميزان متوازن', balanced())

console.log('\n3️⃣ G1: فاتورة مختلطة (خاضع + معفى) — مرتجع المعفى بلا ضريبة')
S().addItem(item({ nameAr: 'دواء معفى', priceMinor: 5000 }))
const med = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: med.id, qty: 30, unitPriceMinor: 2000, expiryDate: null }], expenses: [], paidMinor: 60000, notes: '' })
// فاتورة: قميص خاضع 14٪ + دواء معفى (override=0)
const mixSale = S().postSale({
  lines: [
    { itemId: shirt.id, nameAr: 'قميص', qty: 4, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0 },
    { itemId: med.id, nameAr: 'دواء معفى', qty: 6, unitPriceMinor: 5000, unitCostMinor: 2000, discountPercent: 0, vatPercentOverride: 0 },
  ],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, paidMinor: 0,
})
ok('البيع المختلط: ضريبة على القميص فقط (112 = 800×14٪)', mixSale.totals.taxMinor === 11200, `فعلي ${mixSale.totals.taxMinor}`)
const vatBeforeMix = bal('2102')
// مرتجع الدواء المعفى فقط — يجب ألا يمس 2102 إطلاقاً
S().postSaleReturn({ saleId: mixSale.id, qtyByItem: new Map([[med.id, 6]]), refund: 'credit', reason: 'انتهاء حاجة' })
ok('مرتجع المعفى: 2102 لم يتحرك قرشاً', bal('2102') === vatBeforeMix, `تحرك ${bal('2102') - vatBeforeMix}`)
ok('الميزان متوازن', balanced())

console.log('\n4️⃣ G2: إيداع رصيداً في حساب العميل (Store Credit)')
// فاتورة مدفوعة بالكامل نقداً لعميل مسجل — المرتجع «إيداع رصيداً»: لا نقدية تخرج ورصيده ينقلب دائناً
const paidSale = S().postSale({
  lines: [{ itemId: shirt.id, nameAr: 'قميص', qty: 3, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0 }],
  customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 60000,
})
const cash1 = bal('1101'), ar1 = bal('1104')
const scRet = S().postSaleReturn({ saleId: paidSale.id, qtyByItem: new Map([[shirt.id, 3]]), refund: 'store_credit', reason: 'استبدال لاحق' })
ok('لا نقدية خرجت من الخزينة', bal('1101') === cash1)
ok('كامل القيمة (600) قُيدت دائنة على 1104', ar1 - bal('1104') === 60000, `فعلي ${ar1 - bal('1104')}`)
ok('المستند: cash=0 وcredit=600', scRet.cashRefundMinor === 0 && scRet.creditRefundMinor === 60000)
// كشف الحساب: للعميل الآن دين مفتوح من فاتورة 2 (1140) + مختلطة (بعد مرتجعها) − رصيد 600
const stmt = customerStatement({ customerId: cust.id, sales: S().sales, saleReturns: S().saleReturns, allSales: S().sales, vouchers: [], cheques: [] })
const stmtBal = stmt.at(-1)?.balanceMinor ?? 0
ok('كشف الحساب يطابق دفتر 1104 بالضبط', stmtBal === bal('1104'), `كشف ${stmtBal} / دفتر ${bal('1104')}`)
ok('الميزان متوازن', balanced())

console.log('\n5️⃣ المخزون بعد المرتجعات — كمية وقيمة ومتوسط')
const shirtNow = S().items.find((i) => i.id === shirt.id)
// 50 شراء − 2 بيع نقدي + 1 مرتجع − 10 بيع + 5 مرتجع − 4 مختلطة + 0 + 3 − 3 مرتجع رصيد... نحسب:
// مبيعات القميص: 2+10+4+3=19، مرتجعاته: 1+5+3=9 ⇒ 50−19+9=40
ok('كمية القميص = 40 (كل حركة بدقة)', shirtNow.stockQty === 40, `فعلي ${shirtNow.stockQty}`)
ok('متوسط التكلفة ثابت 100ج (البيع والمرتجع بالتكلفة التاريخية)', shirtNow.costMinor === 10000, `فعلي ${shirtNow.costMinor}`)
// 1103 الدفتري = قيمة المخزون الفعلية (قميص 40×100 + دواء 30×20 عاد كله)
const invBook = bal('1103')
const invReal = S().items.reduce((a, i) => a + Math.round((i.stockQty ?? 0) * i.costMinor), 0)
ok('1103 الدفتري = كمية×متوسط لكل الأصناف (لا انفصال)', invBook === invReal, `دفتر ${invBook} / فعلي ${invReal}`)

console.log('\n6️⃣ مرتجع المشتريات — قيمة محملة ومنع إرجاع المبيع')
S().addItem(item({ nameAr: 'مكواة' }))
const iron = S().items.at(-1)
// شراء 10 × 500 + مصاريف شحن 1000 على حساب المورد ⇒ تكلفة محملة 600
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: iron.id, qty: 10, unitPriceMinor: 50000, expiryDate: null }], expenses: [{ nameAr: 'شحن', amountMinor: 100000, method: 'qty', paidBy: 'supplier', payAccount: null, custodyFileId: null }], paidMinor: 0, notes: '' })
const ironInv = S().purchases.at(-1)
ok('التكلفة المحملة = 600 (500 + نصيب الشحن)', S().items.find((i) => i.id === iron.id).costMinor === 60000)
// بيع 8 ⇒ لا يمكن إرجاع 5 للمورد (المخزون 2 فقط)
S().postSale({ lines: [{ itemId: iron.id, nameAr: 'مكواة', qty: 8, unitPriceMinor: 90000, unitCostMinor: 60000, discountPercent: 0 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
throws('منع إرجاع بضاعة بيعت بالفعل (متاح 2 فقط)', () => S().postPurchaseReturn({ purchaseId: ironInv.id, qtyByItem: new Map([[iron.id, 5]]), refund: 'debt', reason: 'x' }), 'بيعت بالفعل')
const ap0 = bal('2101'), inv0 = bal('1103'), loss0 = bal('5111')
S().postPurchaseReturn({ purchaseId: ironInv.id, qtyByItem: new Map([[iron.id, 2]]), refund: 'debt', reason: 'عيوب' })
ok('مرتجع الشراء خفض 1103 بالتكلفة المحملة (1200 = 2×600)', inv0 - bal('1103') === 120000, `فعلي ${inv0 - bal('1103')}`)
// G4: المورد يرد سعر فاتورته فقط (2×500) — نصيب الشحن الموزع (2×100) خسارة 5111
ok('G4: دين المورد انخفض بسعر فاتورته فقط (1000 = 2×500)', bal('2101') - ap0 === 100000, `فعلي ${bal('2101') - ap0}`)
ok('G4: نصيب الشحن غير المسترد خسارة 5111 (200)', bal('5111') - loss0 === 20000, `فعلي ${bal('5111') - loss0}`)
ok('الميزان متوازن', balanced())

console.log('\n7️⃣ الخدمات (مغسلة) — الإلغاء يرد العربون والتسليم يحقق الإيراد')
S().openLaundryOrder({ customerId: null, customerName: 'أم أحمد', phone: '', lines: [{ desc: 'بدلة', service: 'dry_clean', qty: 2, unitPriceMinor: 15000 }], prepaidMinor: 10000, notes: '' })
const order1 = S().laundryOrders.at(-1)
ok('العربون التزام 2109 (دائن 100) لا إيراد', bal('2109') === -10000 && bal('4103') === 0)
const cashL = bal('1101')
S().cancelLaundryOrder(order1.id)
ok('الإلغاء: رد العربون من الخزينة و2109 صُفّي', cashL - bal('1101') === 10000 && bal('2109') === 0)
ok('لا إيراد سُجل للإلغاء قبل التسليم (سليم — الإيراد لم يتحقق)', bal('4103') === 0)
// أمر ثانٍ يُسلَّم: الإيراد يتحقق مع الضريبة
S().openLaundryOrder({ customerId: null, customerName: 'أم أحمد', phone: '', lines: [{ desc: 'سجادة', service: 'carpet', qty: 1, unitPriceMinor: 30000 }], prepaidMinor: 0, notes: '' })
const order2 = S().laundryOrders.at(-1)
S().setLaundryStatus(order2.id, 'ready')
const rev0 = bal('4103')
S().deliverLaundryOrder({ orderId: order2.id, treasury: '1101' })
ok('التسليم حقق الإيراد 4103 (300 أساساً)', bal('4103') - rev0 === -30000, `فعلي ${bal('4103') - rev0}`)
ok('الميزان متوازن', balanced())

console.log('\n8️⃣ G3: مرتجع خدمة بعد التسليم (عميل غير راضٍ)')
const d2 = S().laundryOrders.find((o) => o.id === order2.id)
// أمر المغسلة سُلم بضريبة 14٪ مضافة (من الإعدادات) ⇒ grand=342، tax=42
ok('الأمر المُسلَّم: grand=342 وtax=42 (14٪ مضافة)', d2.grandMinor === 34200 && d2.taxMinor === 4200, `grand=${d2.grandMinor} tax=${d2.taxMinor}`)
throws('الاسترداد قبل التسليم مرفوض (أمر جديد received)', () => {
  S().openLaundryOrder({ customerId: null, customerName: 'س', phone: '', lines: [{ desc: 'ثوب', service: 'wash', qty: 1, unitPriceMinor: 5000 }], prepaidMinor: 0, notes: '' })
  S().refundLaundryOrder({ orderId: S().laundryOrders.at(-1).id, amountMinor: 1000, mode: 'cash', reason: 'x' })
}, 'بعد التسليم')
throws('إيداع في حساب عميل عابر مرفوض', () => S().refundLaundryOrder({ orderId: order2.id, amountMinor: 1000, mode: 'customer_credit', reason: 'x' }), 'عميل نقدي عابر')
throws('استرداد أكبر من الإجمالي مرفوض', () => S().refundLaundryOrder({ orderId: order2.id, amountMinor: 40000, mode: 'cash', reason: 'x' }), 'تتجاوز')
// استرداد جزئي نقدي 171 (نصف الأمر) — يعكس نصف الضريبة 21
const vat0 = bal('2102'), cash0 = bal('1101'), sret0 = bal('4102')
const u1 = S().refundLaundryOrder({ orderId: order2.id, amountMinor: 17100, mode: 'cash', reason: 'بقع لم تُزل' })
ok('رد نقدي 171 خرج من الخزينة', cash0 - bal('1101') === 17100)
ok('نصف الضريبة عُكس بالضبط (2102 مدين 21)', bal('2102') - vat0 === 2100, `فعلي ${bal('2102') - vat0}`)
ok('الأساس ذهب لمرتجعات المبيعات 4102 (150)', bal('4102') - sret0 === 15000, `فعلي ${bal('4102') - sret0}`)
ok('المستند تتبع: refunded=171 وtax=21', u1.refundedMinor === 17100 && u1.refundedTaxMinor === 2100)
// الاسترداد الثاني للباقي كله — الضريبة المتبقية 21 بلا كسور مفقودة
S().refundLaundryOrder({ orderId: order2.id, amountMinor: 17100, mode: 'cash', reason: 'تسوية نهائية' })
ok('بعد رد الكل: كامل ضريبة الأمر عُكست (سقف N2)', bal('2102') - vat0 === 4200, `فعلي ${bal('2102') - vat0}`)
throws('لا يمكن رد أكثر بعد استنفاد الإجمالي', () => S().refundLaundryOrder({ orderId: order2.id, amountMinor: 100, mode: 'cash', reason: 'x' }), 'تتجاوز')
ok('الميزان متوازن ختاماً', balanced())

console.log('\n9️⃣ G5: مرتجع الشراء يخفض دفعات الصلاحية ويعلّم السيريالات «مرتجعة للمورد»')
S().addItem(item({ nameAr: 'زبادي', trackExpiry: true }))
const yog = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: yog.id, qty: 20, unitPriceMinor: 1000, expiryDate: '2026-12-31' }], expenses: [], paidMinor: 0, notes: '' })
const yogInv = S().purchases.at(-1)
const batchQty0 = S().batches.filter((b) => b.itemId === yog.id).reduce((a, b) => a + b.qty, 0)
ok('دفعة صلاحية فُتحت بالشراء (20)', batchQty0 === 20, `فعلي ${batchQty0}`)
S().postPurchaseReturn({ purchaseId: yogInv.id, qtyByItem: new Map([[yog.id, 8]]), refund: 'debt', reason: 'قرب انتهاء' })
const batchQty1 = S().batches.filter((b) => b.itemId === yog.id).reduce((a, b) => a + b.qty, 0)
ok('G5: المرتجع خفض كمية الدفعة (20−8=12)', batchQty1 === 12, `فعلي ${batchQty1}`)
S().addItem(item({ nameAr: 'موبايل', trackSerial: true, warrantyMonths: 12 }))
const mob = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: mob.id, qty: 3, unitPriceMinor: 500000, expiryDate: null, serialsRaw: 'IMEI-111\nIMEI-222\nIMEI-333' }], expenses: [], paidMinor: 0, notes: '' })
const mobInv = S().purchases.at(-1)
S().postPurchaseReturn({ purchaseId: mobInv.id, qtyByItem: new Map([[mob.id, 2]]), refund: 'debt', reason: 'عيب مصنعي' })
const retSupp = S().serials.filter((u) => u.itemId === mob.id && u.status === 'returned_supplier')
const stillIn = S().serials.filter((u) => u.itemId === mob.id && u.status === 'in_stock')
ok('G5: سيريالان عُلّما «مرتجعة للمورد» وواحد بقي متاحاً', retSupp.length === 2 && stillIn.length === 1, `مرتجع=${retSupp.length} متاح=${stillIn.length}`)
ok('G5: المرتجع FIFO — الأقدم دخولاً أولاً (IMEI-111 خرج)', retSupp.some((u) => u.serial === 'IMEI-111'))
ok('الميزان متوازن بعد G5', balanced())

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
