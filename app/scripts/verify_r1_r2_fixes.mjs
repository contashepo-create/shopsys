/**
 * فحص إصلاحي مراجعة قسم الكاشير R1 وR2:
 * R1 — الرد الهجين لمرتجع فاتورة الدفع المجزأ:
 *   • رد «نقدي» لا يُخرج من الخزينة أكثر من المُحصَّل فعلاً — الباقي يخفض ذمم العميل
 *   • رد «على الحساب» لا يخفض الذمم أكثر من المتبقي المفتوح — الفائض يُرد نقداً
 *   • كشف حساب العميل يصفّر بدقة، والوردية تحسب النقدية الخارجة فعلاً فقط
 *   • الفاتورة النقدية الكاملة والآجلة الكاملة: نفس السلوك القديم
 * R2 — مرتجعات المخازن الفرعية:
 *   • مرتجع بيع يعيد الرصيد لمخزن الفاتورة الأصلية
 *   • مرتجع شراء يسحب الرصيد من المخزن الذي وردت له الفاتورة
 * تشغيل: node --experimental-strip-types scripts/verify_r1_r2_fixes.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { splitRefund, returnCashRefundMinor } = await import('../src/core/returns.ts')
const { customerStatement } = await import('../src/core/statements.ts')
const { summarizeShift } = await import('../src/core/shifts.ts')
const { buildWarehouseDocs, computeWarehouseStock } = await import('../src/core/transfers.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('🧮 نواة splitRefund (خالصة)')
// فاتورة 1000: مدفوع 100، مفتوح 900
ok('رد نقدي 1000 والمحصل 100 ⇒ نقدي 100 + ذمم 900', JSON.stringify(splitRefund(1000, 'cash', 900, 100)) === JSON.stringify({ cashMinor: 100, creditMinor: 900 }))
ok('رد على الحساب 1000 والمفتوح 900 ⇒ ذمم 900 + نقدي 100', JSON.stringify(splitRefund(1000, 'credit', 900, 100)) === JSON.stringify({ creditMinor: 900, cashMinor: 100 }))
ok('نقدية كاملة: رد نقدي كله نقدي', JSON.stringify(splitRefund(500, 'cash', 0, 500)) === JSON.stringify({ cashMinor: 500, creditMinor: 0 }))
ok('آجلة كاملة: رد على الحساب كله ذمم', JSON.stringify(splitRefund(500, 'credit', 500, 0)) === JSON.stringify({ creditMinor: 500, cashMinor: 0 }))

console.log('\n🔶 R1: مرتجع فاتورة الدفع المجزأ — رد هجين')
S().seed([])
S().addCustomer({ ...party('عميل مجزأ'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)
S().addItem(item({ nameAr: 'مروحة', stockQty: 0, costMinor: 0, priceMinor: 10000 }))
const fan = S().items.at(-1)
S().addSupplier({ ...party('مورد'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
// شراء 20 مروحة × 60ج نقداً — لتكوين تكلفة حقيقية
S().postPurchase({ supplierId: sup.id, date: '2026-09-16', lines: [{ itemId: fan.id, qty: 20, unitPriceMinor: 6000, expiryDate: null }], expenses: [], paidMinor: 120000, notes: '' })

// وردية مفتوحة لفحص الدرج
S().openShift('كاشير', 0)
const shift = S().shifts.at(-1)

// فاتورة مجزأة: 10 مراوح × 100ج = 1000ج — مدفوع نقداً 100ج والباقي 900ج آجل
const sale = S().postSale({
  lines: [{ itemId: fan.id, nameAr: 'مروحة', qty: 10, unitPriceMinor: 10000, unitCostMinor: 6000, discountPercent: 0 }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
  paidMinor: 10000, treasury: '1101',
})
ok('الفاتورة: مدفوع 100ج وآجل 900ج', sale.paidMinor === 10000 && sale.totals.totalMinor === 100000)

const cashBefore = bal('1101'), arBefore = bal('1104')
// مرتجع كامل «نقدي» — قبل الإصلاح كان يُخرج 1000ج من الخزينة ويترك دين 900ج قائماً
const ret = S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[fan.id, 10]]), refund: 'cash', reason: 'إلغاء كامل' })
ok('النقدية الخارجة = المُحصَّل فقط (100ج)', cashBefore - bal('1101') === 10000, `فعلي ${cashBefore - bal('1101')}`)
ok('الذمم انخفضت بالمتبقي المفتوح (900ج)', arBefore - bal('1104') === 90000, `فعلي ${arBefore - bal('1104')}`)
ok('المستند حفظ التقسيم (cash=100، credit=900)', ret.cashRefundMinor === 10000 && ret.creditRefundMinor === 90000)
ok('رصيد العميل في الدفتر صفر بعد المرتجع', bal('1104') === 0)
ok('الميزان متوازن', balanced())

// كشف حساب العميل يصفّر
const stmt = customerStatement({
  customerId: cust.id, sales: S().sales, saleReturns: S().saleReturns,
  allSales: S().sales, vouchers: [], cheques: [],
})
const lastBal = stmt.length ? stmt[stmt.length - 1].balanceMinor : 0
ok('كشف الحساب يصفّر (آجل 900 − مرتجع 900)', lastBal === 0, `فعلي ${lastBal}`)

// الوردية: النقدية الخارجة من الدرج = 100ج فقط
const kindOf = () => 'cash'
const saleDocs = S().sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf() }))
const returnDocs = S().saleReturns.map((r) => ({ shiftId: r.shiftId, payment: 'cash', totalMinor: returnCashRefundMinor(r), treasuryKind: kindOf() }))
const sum = summarizeShift(S().shifts.find((x) => x.id === shift.id), saleDocs, returnDocs)
ok('الوردية: مرتجعات الدرج = 100ج لا 1000ج', sum.cashRefundsMinor === 10000, `فعلي ${sum.cashRefundsMinor}`)
ok('الوردية: المتوقع بالدرج = 100 محصل − 100 مردود = 0', sum.expectedCashMinor === 0, `فعلي ${sum.expectedCashMinor}`)

// الاتجاه المعاكس: مجزأة أخرى، رد «على الحساب» أكبر من المفتوح
const sale2 = S().postSale({
  lines: [{ itemId: fan.id, nameAr: 'مروحة', qty: 5, unitPriceMinor: 10000, unitCostMinor: 6000, discountPercent: 0 }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
  paidMinor: 30000, treasury: '1101', // مدفوع 300 ومفتوح 200
})
const cash2 = bal('1101'), ar2 = bal('1104')
const ret2 = S().postSaleReturn({ saleId: sale2.id, qtyByItem: new Map([[fan.id, 5]]), refund: 'credit', reason: 'إلغاء' })
ok('رد على الحساب: الذمم انخفضت بالمفتوح فقط (200ج)', ar2 - bal('1104') === 20000, `فعلي ${ar2 - bal('1104')}`)
ok('والفائض المدفوع رُدّ نقداً (300ج)', cash2 - bal('1101') === 30000, `فعلي ${cash2 - bal('1101')}`)
ok('لا رصيد دائن مصطنع للعميل (1104 = 0)', bal('1104') === 0)
ok('المستند: credit=200 وcash=300', ret2.creditRefundMinor === 20000 && ret2.cashRefundMinor === 30000)

console.log('\n🔶 R2: مرتجعات المخازن الفرعية')
S().addWarehouse('فرع المنصورة')
const wh = S().warehouses.at(-1)
// شراء 10 قطع لمخزن الفرع ثم بيع 4 منه ثم مرتجع 3
S().postPurchase({ supplierId: sup.id, date: '2026-09-16', lines: [{ itemId: fan.id, qty: 10, unitPriceMinor: 6000, expiryDate: null }], expenses: [], paidMinor: 60000, warehouseId: wh.id, notes: '' })
const whPurchase = S().purchases.at(-1)
const sale3 = S().postSale({
  lines: [{ itemId: fan.id, nameAr: 'مروحة', qty: 4, unitPriceMinor: 10000, unitCostMinor: 6000, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, warehouseId: wh.id,
})
const stockAt = () => computeWarehouseStock(S().items, S().warehouses, S().transfers, buildWarehouseDocs(S().purchases, S().sales, S().saleReturns, S().purchaseReturns))
ok('قبل المرتجع: رصيد الفرع = 10−4 = 6', stockAt().get(wh.id)?.get(fan.id) === 6, `فعلي ${stockAt().get(wh.id)?.get(fan.id)}`)
S().postSaleReturn({ saleId: sale3.id, qtyByItem: new Map([[fan.id, 3]]), refund: 'cash', reason: 'مقاس خاطئ' })
ok('مرتجع البيع عاد لمخزن الفرع: 6+3 = 9', stockAt().get(wh.id)?.get(fan.id) === 9, `فعلي ${stockAt().get(wh.id)?.get(fan.id)}`)
S().postPurchaseReturn({ purchaseId: whPurchase.id, qtyByItem: new Map([[fan.id, 2]]), refund: 'cash', treasury: '1101', reason: 'تالف' })
ok('مرتجع الشراء خرج من مخزن الفرع: 9−2 = 7', stockAt().get(wh.id)?.get(fan.id) === 7, `فعلي ${stockAt().get(wh.id)?.get(fan.id)}`)
ok('الميزان متوازن بعد كل العمليات', balanced())

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
