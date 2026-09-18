/**
 * فحص دفعة الأوامر 8 و13 و22 و23 و24 (batch25 — الجزء الثاني):
 * ① الأمر 24 — خدمات المحافظ: الربح = المحصَّل − المدفوع للمزوّد (مشتق)، قيد متوازن،
 *    أصل الاستلام يختلف عن أصل التمويل، الآجل على عميل مسجل، المرتجع قيد عاكس كامل.
 * ② الأمر 13 — دفتر حركة الصنف: بناء من المستندات (شراء/بيع/مرتجعات/جرد/إنتاج/صرف مواد)،
 *    رصيد جارٍ صحيح، فلترة فترة برصيد أول المدة، قالب طباعة يحمل الأرقام.
 * ③ الأمر 8 — مخزن الفاتورة: computeWarehouseStock مع مستندات مخازن — شراء لمخزن فرعي
 *    يظهر فيه، بيع منه يخصم منه، «غير محدد» على الرئيسي، الإجمالي ثابت.
 * ④ الأمر 23 — الصيانة: خدمات بتكلفة وسعر، تحصيل مجزأ نقدي+آجل بقيد صحيح، الربح محسوب،
 *    فاتورة العميل المطبوعة لا تتضمن التكلفة أو الربح.
 * ⑤ الأمر 22 — الأقساط: هامش تمويل يُثبت إيراداً 4111 بقيد متوازن يرفع ذمة العميل.
 * تشغيل: node --experimental-strip-types scripts/verify_batch25_part2.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeWalletTotals, buildWalletServiceEntry, validateWalletService, walletSummary } = await import('../src/core/walletServices.ts')
const { buildItemLedger } = await import('../src/core/itemLedger.ts')
const { renderItemLedgerHtml } = await import('../src/ui/print/printItemLedger.ts')
const { computeWarehouseStock, buildWarehouseDocs } = await import('../src/core/transfers.ts')
const { computeTicketTotals, buildTicketDeliveryEntry, validateDelivery, validateService } = await import('../src/core/maintenance.ts')
const { renderTicketInvoiceHtml } = await import('../src/ui/print/printMaintenanceTicket.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const balanced = (lines) => lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0
const acct = (entry, code) => entry.lines.filter((l) => l.accountCode === code)
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cartLine = (itemId, qty, price, cost) => ({ itemId, nameAr: 'صنف', qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: 0, soldByWeight: false })

/* ════════ ① الأمر 24 — خدمات المحافظ ════════ */
console.log('\n1️⃣ خدمات المحافظ (الأمر 24) — الربح مشتق لا يُدخل')
// النواة: تحويل رصيد 1000 مدفوع للمزوّد، محصَّل 1100 ⇒ الربح 100 (مشتق)
const wIn = { type: 'balance_transfer', provider: 'vodafone', targetPhone: '0100', paidToProviderMinor: 100000, chargeMinor: 110000, paidMinor: 110000, customerId: null, fundingTreasury: '1101', receiveTreasury: '1102', vatPercent: 0, notes: '' }
const wt = computeWalletTotals(wIn)
ok('الربح = المحصَّل − المدفوع للمزوّد (مشتق)', wt.profitGrossMinor === 10000)
ok('لا آجل عند السداد الكامل', wt.remainingMinor === 0)
const wl = buildWalletServiceEntry(wIn, wt, 'WS-0001')
ok('قيد المحافظ متوازن', balanced(wl))
ok('أصل الاستلام (بنك) مدين بالمحصَّل', wl.some((l) => l.accountCode === '1102' && l.debit === 110000))
ok('أصل التمويل (خزينة) دائن بالمدفوع للمزوّد', wl.some((l) => l.accountCode === '1101' && l.credit === 100000))
ok('4103 دائن بالربح فقط', wl.some((l) => l.accountCode === '4103' && l.credit === 10000))
// تحقق الرفض
ok('محصَّل أكبر من الإجمالي يُرفض', validateWalletService({ type: 'balance_transfer', provider: 'vodafone', targetPhone: '', paidToProviderMinor: 1000, chargeMinor: 900, paidMinor: 1500, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' }).length > 0)

// repo: عملية كاملة + آجل + مرتجع
S().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 500000, description: 'تمويل فحص' })
S().addCustomer({ ...party('عميل محافظ'), creditLimitMinor: 0 })
const wCust = S().customers.at(-1)
const jBefore = S().journal.length
const op1 = S().postWalletService({ type: 'balance_transfer', provider: 'vodafone', targetPhone: '01000000000', paidToProviderMinor: 50000, chargeMinor: 55000, paidMinor: 30000, customerId: wCust.id, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' })
ok('عملية محافظ رُحّلت برقم WS', /^WS-\d{4}$/.test(op1.opNumber))
ok('refCode بادئة WLT', op1.refCode.startsWith('WLT-'))
const wEntry = S().journal.find((e) => e.id === op1.journalEntryId)
ok('قيدها متوازن ومصدره wallet_service', wEntry && balanced(wEntry.lines) && wEntry.sourceType === 'wallet_service')
ok('الجزء الآجل 25000 على العملاء (1104)', acct(wEntry, '1104').some((l) => l.debit === 25000))
ok('الربح 5000 في 4103', acct(wEntry, '4103').some((l) => l.credit === 5000))
throws('آجل بلا عميل مسجل يُرفض', () => S().postWalletService({ type: 'topup', provider: 'orange', targetPhone: '', paidToProviderMinor: 10000, chargeMinor: 12000, paidMinor: 5000, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' }))
// مرتجع
const ret = S().returnWalletService(op1.id, 'فحص مرتجع')
ok('المرتجع وسم العملية returned', ret.status === 'returned')
const retEntry = S().journal.find((e) => e.id === ret.returnEntryId)
ok('قيد المرتجع عاكس متوازن يعكس الأصل', retEntry && balanced(retEntry.lines) && retEntry.reversesEntryId === wEntry.id)
ok('الأصل موسوم reversedBy', S().journal.find((e) => e.id === wEntry.id).reversedByEntryId === retEntry.id)
throws('مرتجع ثانٍ لنفس العملية يُرفض', () => S().returnWalletService(op1.id, 'تكرار'))
const wSum = walletSummary(S().walletOps)
ok('الملخص يستبعد المرتجع', wSum.count === 0 && wSum.profitMinor === 0)
ok('عدد القيود زاد 2 فقط (عملية + عكس)', S().journal.length === jBefore + 2)

/* ════════ ② الأمر 13 — دفتر حركة الصنف ════════ */
console.log('\n2️⃣ كارت الصنف — دفتر الحركة (الأمر 13)')
const ledger = buildItemLedger({
  itemId: 7,
  openingQty: 10,
  purchases: [{ invoiceNumber: 'P-0001', date: '2026-01-05', lines: [{ itemId: 7, qty: 20, unitPriceMinor: 1000, expenseShareMinor: 100 }] }],
  purchaseReturns: [{ returnNumber: 'PR-0001', date: '2026-01-08', lines: [{ itemId: 7, qty: 2, unitCostMinor: 1100 }] }],
  sales: [{ invoiceNumber: 'S-0001', date: '2026-01-10', lines: [{ itemId: 7, qty: 5, unitPriceMinor: 2000, discountPercent: 0 }] }],
  saleReturns: [{ returnNumber: 'R-0001', date: '2026-01-12', lines: [{ itemId: 7, qty: 1, unitPriceMinor: 2000 }] }],
  stocktakes: [{ stocktakeNumber: 'ST-0001', date: '2026-01-15', rows: [{ itemId: 7, systemQty: 24, countedQty: 23 }] }],
  productionOrders: [],
  materialRequisitions: [{ reqNumber: 'MRQ-0001', date: '2026-01-20', lines: [{ itemId: 7, qty: 3 }] }],
})
ok('وارد = شراء 20 + مرتجع بيع 1', ledger.totalIn === 21)
ok('منصرف = بيع 5 + مرتجع شراء 2 + عجز جرد 1 + صرف مواد 3', ledger.totalOut === 11)
ok('رصيد آخر المدة = 10 + 21 − 11 = 20', ledger.closingQty === 20)
ok('الرصيد الجاري تسلسلي صحيح', ledger.rows.at(-1).balance === 20)
ok('الحركات مرتبة زمنياً', ledger.rows.every((r, i, a) => i === 0 || a[i - 1].date <= r.date))
// فلترة فترة: من 10 يناير — الافتتاحي يستوعب ما قبلها
const part = buildItemLedger({
  itemId: 7, openingQty: 10,
  purchases: [{ invoiceNumber: 'P-0001', date: '2026-01-05', lines: [{ itemId: 7, qty: 20, unitPriceMinor: 1000 }] }],
  purchaseReturns: [], sales: [{ invoiceNumber: 'S-0001', date: '2026-01-10', lines: [{ itemId: 7, qty: 5, unitPriceMinor: 2000, discountPercent: 0 }] }],
  saleReturns: [], stocktakes: [], productionOrders: [], materialRequisitions: [],
}, '2026-01-10', '2026-01-31')
ok('أول المدة للفترة يشمل ما قبلها (10+20)', part.openingQty === 30)
ok('حركات الفترة فقط', part.rows.length === 1 && part.closingQty === 25)
// أمر إنتاج: منتج داخل + خامة خارجة
const prod = buildItemLedger({
  itemId: 9, openingQty: 0,
  purchases: [], purchaseReturns: [], sales: [], saleReturns: [], stocktakes: [], materialRequisitions: [],
  productionOrders: [{ orderNumber: 'PRD-0001', date: '2026-02-01', productItemId: 9, qty: 12, ingredients: [{ itemId: 5, qty: 30 }] }],
})
ok('أمر الإنتاج يورد المنتج التام', prod.totalIn === 12 && prod.closingQty === 12)
const ing = buildItemLedger({
  itemId: 5, openingQty: 50,
  purchases: [], purchaseReturns: [], sales: [], saleReturns: [], stocktakes: [], materialRequisitions: [],
  productionOrders: [{ orderNumber: 'PRD-0001', date: '2026-02-01', productItemId: 9, qty: 12, ingredients: [{ itemId: 5, qty: 30 }] }],
})
ok('أمر الإنتاج يصرف الخامة', ing.totalOut === 30 && ing.closingQty === 20)
const html = renderItemLedgerHtml({ shopName: 'متجر الفحص', headerLines: [], itemName: 'صنف الفحص', itemDetails: ['SKU: T-1'], ledger, period: 'يناير', cur: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' } })
ok('قالب الطباعة يحمل الاسم والأرقام', html.includes('صنف الفحص') && html.includes('متجر الفحص') && html.includes('20'))

/* ════════ ③ الأمر 8 — مخزن الفاتورة ════════ */
console.log('\n3️⃣ اختيار المخزن أعلى الفاتورة (الأمر 8)')
const whItems = [{ id: 1, stockQty: 100 }]
const whs = [{ id: 1, isMain: true }, { id: 2, isMain: false }]
// شراء 30 لمخزن فرعي + بيع 10 منه
const docs = buildWarehouseDocs(
  [{ warehouseId: 2, lines: [{ itemId: 1, qty: 30 }] }, { warehouseId: null, lines: [{ itemId: 1, qty: 999 }] }],
  [{ warehouseId: 2, lines: [{ itemId: 1, qty: 10 }] }],
)
ok('فواتير «غير محدد» لا تولّد مستند مخزن', docs.length === 2)
const st = computeWarehouseStock(whItems, whs, [], docs)
ok('الفرعي = 30 وارد − 10 بيع = 20', st.get(2).get(1) === 20)
ok('الرئيسي = 100 − 20 (المتبقي)', st.get(1).get(1) === 80)
ok('الإجمالي محفوظ = stockQty', st.get(1).get(1) + st.get(2).get(1) === 100)
// repo: فاتورة كاشير بمخزن + شراء بمخزن
S().addItem(item({ nameAr: 'صنف مخازن', stockQty: 0, costMinor: 0, priceMinor: 5000 }))
const whItem = S().items.at(-1)
useDataStore.setState({ warehouses: [{ id: 1, nameAr: 'المخزن الرئيسي', isMain: true }] }) // الحالة النظيفة بلا مخازن — نحقن الرئيسي
S().addWarehouse('مخزن فرعي فحص')
const subWh = S().warehouses.at(-1)
S().addSupplier(party('مورد مخازن'))
const whSup = S().suppliers.at(-1)
const pInv = S().postPurchase({ supplierId: whSup.id, date: '2026-03-01', lines: [{ itemId: whItem.id, qty: 40, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, notes: '', warehouseId: subWh.id })
ok('فاتورة الشراء حفظت المخزن', pInv.warehouseId === subWh.id)
const sInv = S().postSale({ lines: [cartLine(whItem.id, 4, 5000, 2000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 20000, warehouseId: subWh.id })
ok('فاتورة البيع حفظت المخزن', sInv.warehouseId === subWh.id)
const st2 = computeWarehouseStock(S().items, S().warehouses, S().transfers, buildWarehouseDocs(S().purchases, S().sales))
ok('رصيد الفرعي = 40 شراء − 4 بيع = 36', st2.get(subWh.id).get(whItem.id) === 36)
const mainWh = S().warehouses.find((w) => w.isMain)
ok('الرئيسي لا يتأثر بحركة الفرعي لهذا الصنف', (st2.get(mainWh.id).get(whItem.id) ?? 0) === 0)

/* ════════ ④ الأمر 23 — الصيانة بمستوى موبايل شوب ════════ */
console.log('\n4️⃣ الصيانة: خدمات + تحصيل مجزأ + ربح سري (الأمر 23)')
const tt = computeTicketTotals({
  laborMinor: 10000,
  parts: [{ itemId: 1, nameAr: 'شاشة', qty: 1, unitPriceMinor: 50000, unitCostMinor: 30000 }],
  services: [{ serviceId: 1, nameAr: 'سوفتوير', qty: 1, unitPriceMinor: 20000, unitCostMinor: 5000 }],
  payment: 'cash', paidMinor: 45000, vatPercent: 0,
})
ok('الإيراد = أجرة + قطع + خدمات', tt.revenueMinor === 80000)
ok('التحصيل المجزأ: 45000 نقداً و35000 آجلاً', tt.paidMinor === 45000 && tt.creditMinor === 35000)
ok('الربح = الإيراد − تكلفة القطع − تكلفة الخدمات', tt.profitMinor === 80000 - 30000 - 5000)
const tl = buildTicketDeliveryEntry(tt, 'cash', 'MT-0009', '1101')
ok('قيد التسليم متوازن', balanced(tl))
ok('الخزينة مدينة بالنقدي فقط', tl.some((l) => l.accountCode === '1101' && l.debit === 45000))
ok('العملاء مدينون بالآجل', tl.some((l) => l.accountCode === '1104' && l.debit === 35000))
ok('المدفوع أكبر من الإجمالي يُرفض', validateDelivery({ laborMinor: 1000, parts: [], payment: 'cash', paidMinor: 99999, vatPercent: 0 }).length > 0)
ok('خدمة كتالوج بلا اسم تُرفض', validateService({ nameAr: ' ', costMinor: 0, priceMinor: 100 }).length > 0)
// repo: كتالوج + تذكرة كاملة بتحصيل مجزأ
const svc = S().addMaintenanceService({ nameAr: 'تغيير شاشة', costMinor: 2000, priceMinor: 8000 })
ok('خدمة أُضيفت للكتالوج', S().maintenanceServices.some((x) => x.id === svc.id))
S().addItem(item({ nameAr: 'قطعة فحص صيانة', stockQty: 5, costMinor: 3000, priceMinor: 7000 }))
const partItem = S().items.at(-1)
S().addCustomer({ ...party('عميل صيانة23'), creditLimitMinor: 0 })
const mCust = S().customers.at(-1)
const tk = S().openTicket({ customerId: mCust.id, customerName: '', customerPhone: '', deviceName: 'iPhone 13', issue: 'شاشة مكسورة', estimateMinor: 0, notes: '' })
S().setTicketStatus(tk.id, 'ready')
const delivered = S().deliverTicket(tk.id, {
  laborMinor: 5000,
  parts: [{ itemId: partItem.id, qty: 1, unitPriceMinor: 7000 }],
  services: [{ serviceId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor: svc.priceMinor, unitCostMinor: svc.costMinor }],
  payment: 'cash', paidMinor: 12000, vatPercent: 0, treasury: '1101',
})
ok('الإجمالي 20000 والمحصَّل 12000 والآجل 8000', delivered.totals.grandMinor === 20000 && delivered.totals.paidMinor === 12000 && delivered.totals.creditMinor === 8000)
ok('الربح = 20000 − 3000 قطع − 2000 خدمات = 15000', delivered.totals.profitMinor === 15000)
ok('payment انعكس آجلاً لوجود متبقٍ', delivered.payment === 'credit')
const dEntry = S().journal.find((e) => e.id === delivered.journalEntryId)
ok('قيد التسليم في الدفتر متوازن', dEntry && balanced(dEntry.lines))
ok('مخزون القطعة نقص', S().items.find((i) => i.id === partItem.id).stockQty === 4)
// فاتورة العميل المطبوعة: لا تكلفة ولا ربح
const invHtml = renderTicketInvoiceHtml({
  shopName: 'متجر', headerLines: [], ticketNumber: delivered.ticketNumber, date: '2026-03-05',
  customerName: 'عميل صيانة23', customerPhone: '', deviceName: delivered.deviceName, issue: delivered.issue,
  laborMinor: delivered.totals.laborMinor,
  parts: delivered.parts.map((p) => ({ nameAr: p.nameAr, qty: p.qty, unitPriceMinor: p.unitPriceMinor })),
  services: delivered.services.map((sv) => ({ nameAr: sv.nameAr, qty: sv.qty, unitPriceMinor: sv.unitPriceMinor })),
  totals: delivered.totals,
}, { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' })
ok('فاتورة العميل لا تتضمن كلمة تكلفة أو ربح', !invHtml.includes('تكلفة') && !invHtml.includes('الربح'))
ok('فاتورة العميل تُظهر المحصَّل والمتبقي', invHtml.includes('المحصَّل نقداً') && invHtml.includes('المتبقي'))
throws('تحصيل جزئي بلا عميل مسجل يُرفض', () => {
  const t2 = S().openTicket({ customerId: null, customerName: 'نقدي', customerPhone: '', deviceName: 'جهاز', issue: 'عطل', estimateMinor: 0, notes: '' })
  S().setTicketStatus(t2.id, 'ready')
  S().deliverTicket(t2.id, { laborMinor: 10000, parts: [], payment: 'cash', paidMinor: 4000, vatPercent: 0, treasury: '1101' })
}, 'عميلاً مسجلاً')

/* ════════ ⑤ الأمر 22 — هامش التقسيط ════════ */
console.log('\n5️⃣ الأقساط: هامش تمويل يُثبت إيراداً 4111 (الأمر 22)')
S().addCustomer({ ...party('عميل أقساط22'), creditLimitMinor: 0 })
const iCust = S().customers.at(-1)
const plan = S().createInstallmentPlan({ customerId: iCust.id, saleId: null, totalMinor: 120000, downPaymentMinor: 20000, interestMinor: 20000, count: 10, intervalMonths: 1, firstDueDate: '2026-04-01', treasury: '1101', notes: '' })
ok('الخطة حفظت الهامش', plan.interestMinor === 20000 && plan.interestEntryId != null)
const iEntry = S().journal.find((e) => e.id === plan.interestEntryId)
ok('قيد الهامش متوازن: 1104 مدين / 4111 دائن', iEntry && balanced(iEntry.lines) && acct(iEntry, '1104').some((l) => l.debit === 20000) && acct(iEntry, '4111').some((l) => l.credit === 20000))
ok('جدول الأقساط = الإجمالي − المقدم', plan.items.reduce((a, i) => a + i.amountMinor, 0) === 100000)
throws('هامش ≥ الإجمالي يُرفض', () => S().createInstallmentPlan({ customerId: iCust.id, saleId: null, totalMinor: 5000, downPaymentMinor: 0, interestMinor: 5000, count: 2, intervalMonths: 1, firstDueDate: '2026-04-01', treasury: '1101', notes: '' }), 'أقل من إجمالي')
const planNoInterest = S().createInstallmentPlan({ customerId: iCust.id, saleId: null, totalMinor: 60000, downPaymentMinor: 0, count: 6, intervalMonths: 1, firstDueDate: '2026-04-01', treasury: '1101', notes: '' })
ok('خطة بلا هامش: لا قيد هامش', planNoInterest.interestEntryId == null)

/* ════════ الخلاصة ════════ */
console.log(`\n${'═'.repeat(40)}\n✅ نجح: ${pass}  ❌ فشل: ${fail}\n${'═'.repeat(40)}`)
if (fail > 0) process.exit(1)
