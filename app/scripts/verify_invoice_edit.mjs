/**
 * فحص تعديل الفواتير + سياسة الفاتورة الإلكترونية (طلب المالك):
 * ① السياسة: منظومة إلكترونية غير مفعلة ⇒ تعديل متاح؛ مفعلة ⇒ إشعارات فقط
 * ② باركود زاتكا: يُطبع فقط مع (ميزة مفعلة + إنترنت + خيار طباعة) — الضريبة تُحسب دائماً
 * ③ editSale: عكس القيد + قيد جديد متوازن + مخزون صحيح + سجل تدقيق + الرقم المرجعي ثابت
 * ④ موانع تعديل البيع: مرتجع/أقساط/وردية مقفلة/سيريالات/تحصيلات مخصصة
 * ⑤ editPurchase: عكس + إعادة ترحيل بالتكلفة المحملة + متوسط مرجح صحيح + دفعات صلاحية
 * ⑥ موانع تعديل الشراء: بيع من بضاعتها/مرتجع شراء/مصاريف من خزائن
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_edit.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { invoiceEditPolicy, zatcaQrPolicy, saleEditBlocks } = await import('../src/core/invoiceEdit.ts')
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
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cartLine = (itemId, qty, price, cost) => ({ itemId, nameAr: 'صنف', qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: 0, soldByWeight: false })

console.log('\n1️⃣ السياسة الخالصة: تفعيل المنظومة يقلب التعديل إلى إشعارات')
ok('غير مفعلة ⇒ التعديل متاح', invoiceEditPolicy({ einvoiceActive: false }).canEdit === true)
ok('مفعلة ⇒ التعديل محظور', invoiceEditPolicy({ einvoiceActive: true }).canEdit === false)
ok('سبب الحظر يذكر الإشعارات', invoiceEditPolicy({ einvoiceActive: true }).reasonAr.includes('إشعار'))

console.log('\n2️⃣ باركود زاتكا: ميزة + إنترنت + خيار — الضريبة دائماً')
ok('كل الشروط ⇒ يُطبع', zatcaQrPolicy({ featureActive: true, online: true, printEnabled: true }).printQr === true)
ok('بلا إنترنت ⇒ لا باركود (مرحلة ثانية)', zatcaQrPolicy({ featureActive: true, online: false, printEnabled: true }).printQr === false)
ok('سبب الأوفلاين يوضح أن الضريبة تظهر طبيعياً', String(zatcaQrPolicy({ featureActive: true, online: false, printEnabled: true }).reasonAr).includes('الضريبي'))
ok('ميزة موقوفة ⇒ لا باركود والضريبة طبيعية', (() => { const p = zatcaQrPolicy({ featureActive: false, online: true, printEnabled: true }); return !p.printQr && p.reasonAr.includes('الضريبة تُحسب') })())
ok('خيار الطباعة موقوف ⇒ لا باركود', zatcaQrPolicy({ featureActive: true, online: true, printEnabled: false }).printQr === false)

console.log('\n🏗️ التأسيس: صنفان + عميل + مورد')
S().addCustomer({ ...party('عميل التعديل'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)
S().addSupplier(party('مورد التعديل'))
const sup = S().suppliers.at(-1)
S().addItem(item({ nameAr: 'سلعة أ', stockQty: 100, costMinor: 1000, priceMinor: 3000 }))
const itA = S().items.at(-1)
S().addItem(item({ nameAr: 'سلعة ب', stockQty: 50, costMinor: 2000, priceMinor: 5000 }))
const itB = S().items.at(-1)

console.log('\n3️⃣ editSale: عكس القيد + قيد جديد + مخزون + ضريبة 15٪ شاملة')
// فاتورة بيع بضريبة سعودية 15٪ شاملة: 2 × 3000 = 6000
const sale = S().postSale({ lines: [cartLine(itA.id, 2, 3000, 1000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101', paidMinor: 6000 })
const cashBefore = bal('1101'), taxBefore = bal('2102')
const stockBeforeEdit = S().items.find((i) => i.id === itA.id).stockQty
// التعديل: 3 قطع بدلاً من 2 وبسعر 2500 = 7500 — بنفس المعاملة الضريبية
const edited = S().editSale({
  saleId: sale.id, lines: [cartLine(itA.id, 3, 2500, 999)], customerId: null,
  payment: 'cash', paidMinor: 7500, treasury: '1101', invoiceDiscountPercent: 0,
  reason: 'كمية خاطئة', einvoiceActive: false,
})
ok('الدفتر متوازن بعد التعديل', balanced())
ok('رقم الفاتورة والمرجع ثابتان', edited.invoiceNumber === sale.invoiceNumber && edited.refCode === sale.refCode)
ok('القيد القديم عُلّم معكوساً', S().journal.find((e) => e.id === sale.journalEntryId)?.reversedByEntryId != null)
ok('قيد عاكس بنوع reversal موجود', S().journal.some((e) => e.sourceType === 'reversal' && e.reversesEntryId === sale.journalEntryId))
ok('الفاتورة تشير للقيد الجديد', edited.journalEntryId !== sale.journalEntryId && S().journal.some((e) => e.id === edited.journalEntryId))
ok('الخزينة صافيها = 7500 الجديدة فقط', bal('1101') - cashBefore + 6000 === 7500, bal('1101') - cashBefore)
ok('المخزون: أعاد 2 وخصم 3 (صافي -1)', S().items.find((i) => i.id === itA.id).stockQty === stockBeforeEdit - 1)
ok('سجل التدقيق: تعديل واحد بسببه', edited.editHistory?.length === 1 && edited.editHistory[0].reason === 'كمية خاطئة')
ok('تكلفة السطر ثُبتت على متوسط المخزون لا 999', edited.lines[0].unitCostMinor === 1000, edited.lines[0].unitCostMinor)
// الضريبة الشاملة 15٪: 7500 شامل ⇒ صافي 6522 وضريبة 978 (تقريب)
ok('ضريبة الفاتورة المعدلة رُحّلت (2102 تغير)', bal('2102') !== taxBefore)
ok('الشامل: الإجمالي = الأساس الضريبي + الضريبة', edited.totals.totalMinor === edited.totals.taxBaseMinor + edited.totals.taxMinor)

console.log('\n4️⃣ موانع تعديل البيع')
throws('einvoiceActive ⇒ الرفض بالإشعارات', () => S().editSale({ saleId: edited.id, lines: [cartLine(itA.id, 1, 3000, 1000)], customerId: null, payment: 'cash', paidMinor: 3000, treasury: '1101', invoiceDiscountPercent: 0, reason: '', einvoiceActive: true }), 'إشعار')
throws('مدفوع أكبر من الإجمالي يُرفض', () => S().editSale({ saleId: edited.id, lines: [cartLine(itA.id, 1, 3000, 1000)], customerId: null, payment: 'cash', paidMinor: 999999, treasury: '1101', invoiceDiscountPercent: 0, reason: '', einvoiceActive: false }), 'أكبر')
throws('جزء آجل بلا عميل يُرفض', () => S().editSale({ saleId: edited.id, lines: [cartLine(itA.id, 1, 3000, 1000)], customerId: null, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: '', einvoiceActive: false }), 'عميل')
// فاتورة عليها مرتجع لا تُعدَّل
const sale2 = S().postSale({ lines: [cartLine(itA.id, 2, 3000, 1000)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
S().postSaleReturn({ saleId: sale2.id, qtyByItem: new Map([[itA.id, 1]]), refund: 'credit', reason: 'عيب' })
throws('فاتورة عليها مرتجع تُرفض', () => S().editSale({ saleId: sale2.id, lines: [cartLine(itA.id, 1, 3000, 1000)], customerId: cust.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: '', einvoiceActive: false }), 'مرتجعات')
// الوردية المقفلة تمنع
const shift = S().openShift('كاشير', 0)
const sale3 = S().postSale({ lines: [cartLine(itA.id, 1, 3000, 1000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 3000 })
S().closeShift(3000)
throws('فاتورة وردية مقفلة تُرفض', () => S().editSale({ saleId: sale3.id, lines: [cartLine(itA.id, 2, 3000, 1000)], customerId: null, payment: 'cash', paidMinor: 6000, treasury: '1101', invoiceDiscountPercent: 0, reason: '', einvoiceActive: false }), 'أُقفلت')
// الدالة الخالصة تجمع كل الأسباب
ok('saleEditBlocks تجمع 5 موانع', saleEditBlocks({ hasReturns: true, hasSoldSerials: true, hasInstallmentPlan: true, hasSettlementAllocation: true, shiftClosed: true }).length === 5)
ok('بلا موانع ⇒ قائمة فارغة', saleEditBlocks({ hasReturns: false, hasSoldSerials: false, hasInstallmentPlan: false, hasSettlementAllocation: false, shiftClosed: false }).length === 0)

console.log('\n5️⃣ editPurchase: عكس + تكلفة محملة + متوسط مرجح')
// شراء: 10 × 2000 + نولون 1000 على المورد = 21000 محملة
const pur = S().postPurchase({
  supplierId: sup.id, date: '2026-09-15',
  lines: [{ itemId: itB.id, qty: 10, unitPriceMinor: 2000, expiryDate: null }],
  expenses: [{ nameAr: 'نولون', amountMinor: 1000, method: 'qty' }],
  paidMinor: 0, treasury: '1101', notes: '',
})
const invBefore = bal('1103'), apBefore = bal('2101')
const qtyBeforePE = S().items.find((i) => i.id === itB.id).stockQty
// التعديل: 20 قطعة بسعر 2500 + نفس النولون = 51000
const editedPur = S().editPurchase({
  purchaseId: pur.id,
  lines: [{ itemId: itB.id, qty: 20, unitPriceMinor: 2500 }],
  expenses: pur.expenses, paidMinor: 0, treasury: '1101', reason: 'كمية المورد الصحيحة', einvoiceActive: false,
})
ok('الدفتر متوازن بعد تعديل الشراء', balanced())
ok('رقم فاتورة الشراء ثابت', editedPur.invoiceNumber === pur.invoiceNumber && editedPur.refCode === pur.refCode)
ok('إجمالي المعدلة = 20×2500 + 1000 = 51000', editedPur.grandTotalMinor === 51000, editedPur.grandTotalMinor)
ok('1103 صافي التغير = 51000 − 21000', bal('1103') - invBefore === 30000, bal('1103') - invBefore)
ok('دين المورد صافي = −30000 إضافية', bal('2101') - apBefore === -30000, bal('2101') - apBefore)
ok('المخزون +10 صافياً (أُلغيت 10 وأُضيفت 20)', S().items.find((i) => i.id === itB.id).stockQty === qtyBeforePE + 10)
ok('التكلفة المحملة للسطر = 2500 + 50 نولون', editedPur.lines[0].landedUnitCostMinor === 2550, editedPur.lines[0].landedUnitCostMinor)
ok('سجل تدقيق الشراء موجود', editedPur.editHistory?.length === 1)
ok('قيد الشراء القديم معكوس', S().journal.find((e) => e.id === pur.journalEntryId)?.reversedByEntryId != null)

console.log('\n6️⃣ موانع تعديل الشراء')
throws('einvoiceActive ⇒ رفض تعديل الشراء', () => S().editPurchase({ purchaseId: pur.id, lines: [{ itemId: itB.id, qty: 1, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: '', einvoiceActive: true }), 'مرتجع شراء')
// بيع من بضاعة الفاتورة يمنع تعديلها (يفسد التكلفة)
S().postSale({ lines: [cartLine(itB.id, 55, 5000, 2550)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 275000 })
throws('بيع من بضاعتها ⇒ يُرفض', () => S().editPurchase({ purchaseId: pur.id, lines: [{ itemId: itB.id, qty: 1, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: '', einvoiceActive: false }), 'بيع من بضاعة')
// مصاريف مدفوعة من خزينة تمنع
const pur2 = S().postPurchase({
  supplierId: sup.id, date: '2026-09-15',
  lines: [{ itemId: itA.id, qty: 5, unitPriceMinor: 1000, expiryDate: null }],
  expenses: [{ nameAr: 'شحن', amountMinor: 500, method: 'qty', paidBy: 'treasury', payAccount: '1101' }],
  paidMinor: 0, treasury: '1101', notes: '',
})
throws('مصاريف من خزينة ⇒ يُرفض', () => S().editPurchase({ purchaseId: pur2.id, lines: [{ itemId: itA.id, qty: 5, unitPriceMinor: 1000 }], expenses: pur2.expenses, paidMinor: 0, treasury: '1101', reason: '', einvoiceActive: false }), 'مدفوعة من خزائن')

console.log(`\n═══════════ PASS=${pass} FAIL=${fail} ═══════════`)
if (fail > 0) process.exit(1)
