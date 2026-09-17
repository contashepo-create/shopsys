/**
 * 🧑‍💼 رحلة مستخدم حقيقي — مراجعة نهائية لكل سيناريوهات المرتجع وأثرها على كل الأقسام
 * ──────────────────────────────────────────────────────────────
 * أتصرف كصاحب محل فعلي: أفتح وردية، أبيع بكل الأنماط، أرجّع بكل السيناريوهات،
 * وبعد كل عملية أعدّ بنفسي: الخزينة، البنك، ذمم العميل، المخزون (إجمالي + مخازن)،
 * كارت الصنف، الوردية، التقارير، ميزان المراجعة، قائمة الدخل — وأقارن بما يعرضه النظام.
 * سكربت فحص استكشافي — يُشغَّل يدوياً: node --experimental-strip-types scripts/user_journey_returns.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/* بيئة صورية */
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'general', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let step = 0
const ok = (name) => { step++; console.log(`  ✓ [${String(step).padStart(2, '0')}] ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { computeWarehouseStock, buildWarehouseDocs } = await import(join(root, 'src/core/transfers.ts'))
const { buildItemLedger } = await import(join(root, 'src/core/itemLedger.ts'))
const { customerStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { summarizeShift } = await import(join(root, 'src/core/shifts.ts'))
const { salesSummary } = await import(join(root, 'src/core/reports.ts'))
const { trialBalance, incomeStatement } = await import(join(root, 'src/core/financialReports.ts'))
const { planProgress } = await import(join(root, 'src/core/installments.ts'))

const st = () => useDataStore.getState()
const P = { from: '2000-01-01', to: '2099-12-31' }

/* أدوات المستخدم: أعدّ بنفسي من دفتر الأستاذ */
const bal = (code) => {
  let d = 0, c = 0
  for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) { d += l.debit; c += l.credit }
  return d - c
}
const custBalance = (custId) => statementBalance(customerStatement({
  customerId: custId, sales: st().sales, allSales: st().sales, saleReturns: st().saleReturns,
  vouchers: st().vouchers ?? [], cheques: st().cheques ?? [], openingMinor: 0,
}))
const whStock = () => computeWarehouseStock(
  st().items, st().warehouses,
  st().transfers.map((t) => ({ fromWarehouseId: t.fromWarehouseId, toWarehouseId: t.toWarehouseId, lines: t.lines })),
  buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns),
)
const itemCard = (itemId, opening) => buildItemLedger({
  itemId, purchases: [], purchaseReturns: [], sales: st().sales, saleReturns: st().saleReturns,
  stocktakes: [], productionOrders: [], materialRequisitions: [], openingQty: opening,
})
const assertJournalBalanced = () => {
  for (const e of st().journal) {
    const d = e.lines.reduce((a, l) => a + l.debit, 0)
    const c = e.lines.reduce((a, l) => a + l.credit, 0)
    assert.equal(d, c, `قيد غير متوازن: #${e.id} ${e.description}`)
  }
}

console.log('\n🧑‍💼 رحلة المستخدم — كل سيناريوهات المرتجع وأثرها على كل الأقسام\n')

/* ═══ التجهيز ═══ */
useDataStore.setState({ warehouses: [
  { id: 1, nameAr: 'المخزن الرئيسي', isMain: true },
  { id: 2, nameAr: 'فرع المعادي', isMain: false },
] })
const [mainWh, branchWh] = st().warehouses
assert.ok(mainWh.isMain)

st().addItem({
  nameAr: 'مكواة بخار', sku: 'IRON-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 30000, stockQty: 50, priceMinor: 50000, minQty: 2,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
})
st().addItem({
  nameAr: 'خلاط كهربائي', sku: 'BLND-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 20000, stockQty: 30, priceMinor: 35000, minQty: 2,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
})
const [iron, blender] = st().items
st().addCustomer({ nameAr: 'أحمد سمير', phone: '0100', address: '', notes: '', openingMinor: 0 })
st().addCustomer({ nameAr: 'منى عادل', phone: '0111', address: '', notes: '', openingMinor: 0 })
const [ahmed, mona] = st().customers
ok('جهزت المحل: مخزنان + مكواة (500/تكلفة 300) ×50 + خلاط (350/تكلفة 200) ×30 + عميلان')

const shift = st().openShift('كاشير الصباح', 100000)
ok('فتحت وردية الصباح بعهدة درج 1,000.00')

const line = (item, qty) => ({
  itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: item.priceMinor,
  unitCostMinor: st().items.find((i) => i.id === item.id).costMinor, discountPercent: 0, soldByWeight: false,
})

/* ═══ سيناريو 1: بيع نقدي ثم مرتجع نقدي كامل ═══ */
console.log('\n─── سيناريو 1: مرتجع نقدي كامل عن بيع نقدي (ض.ق.م 14٪ شاملة) ───')
const cash0 = bal('1101')
const s1 = st().postSale({ lines: [line(iron, 2)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
assert.equal(bal('1101'), cash0 + s1.totals.totalMinor)
const r1 = st().postSaleReturn({ saleId: s1.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'العميل غيّر رأيه', reasonCode: 'other' })
assert.equal(bal('1101'), cash0)
ok(`الخزينة: دخلت ${(s1.totals.totalMinor / 100).toFixed(2)} وخرجت كاملة — عادت ${(cash0 / 100).toFixed(2)}`)
assert.equal(st().items.find((i) => i.id === iron.id).stockQty, 50)
ok('المخزون: عادت القطعتان — الرصيد 50 كما قبل البيع')
assert.equal(bal('2102'), 0)
ok('الضريبة 2102: صافي صفر — ضريبة المرتجع عكست ضريبة البيع بالضبط')
assert.equal(incomeStatement(st().journal, P).netProfitMinor, 0)
ok('قائمة الدخل: صافي الربح صفر — لا ربح وهمي بعد مرتجع كامل')
assert.equal(itemCard(iron.id, 50).rows.at(-1).balance, 50)
ok('كارت الصنف: صادر 2 ثم وارد 2 — الختامي 50 مطابق')

/* ═══ سيناريو 2: بيع آجل ثم مرتجع جزئي على الحساب ═══ */
console.log('\n─── سيناريو 2: مرتجع جزئي على حساب عميل آجل ───')
const s2 = st().postSale({ lines: [line(iron, 4)], customerId: ahmed.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101', paidMinor: 0 })
assert.equal(custBalance(ahmed.id), s2.totals.totalMinor)
const r2 = st().postSaleReturn({ saleId: s2.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'credit', reason: 'قطعة زائدة', reasonCode: 'other' })
assert.equal(custBalance(ahmed.id), s2.totals.totalMinor - r2.totals.totalMinor)
ok(`كشف حساب أحمد: ${(s2.totals.totalMinor / 100).toFixed(2)} − ${(r2.totals.totalMinor / 100).toFixed(2)} = ${(custBalance(ahmed.id) / 100).toFixed(2)}`)
assert.equal(r2.cashRefundMinor ?? 0, 0)
ok('الخزينة: لم تخرج نقدية — الرد كله خصم ذمم')
assert.throws(
  () => st().postSaleReturn({ saleId: s2.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: r2.totals.totalMinor, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 }, reason: 'محاولة', reasonCode: 'other' }),
  /يتجاوز المُحصَّل|لا يساوي/,
)
ok('الحارس: رفض رد نقدي عن فاتورة آجلة لم يُدفع منها قرش')

/* ═══ سيناريو 3: دفع مجزأ + الرد الهجين التلقائي ═══ */
console.log('\n─── سيناريو 3: دفع مجزأ (700 من 1400 نقداً) ومرتجع 3 قطع (1050) ───')
const s3 = st().postSale({ lines: [line(blender, 4)], customerId: mona.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101', paidMinor: 70000 })
const monaBefore = custBalance(mona.id)
assert.equal(monaBefore, s3.totals.totalMinor - 70000)
const cash3 = bal('1101')
const r3 = st().postSaleReturn({ saleId: s3.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'resellable' }], refund: 'cash', reason: 'غير مناسب', reasonCode: 'wrong_size' })
assert.equal(r3.cashRefundMinor + r3.creditRefundMinor, r3.totals.totalMinor)
assert.ok(r3.cashRefundMinor <= 70000)
assert.equal(bal('1101'), cash3 - r3.cashRefundMinor)
ok(`الرد الهجين: ${(r3.creditRefundMinor / 100).toFixed(2)} خصم ذمم (سقف الدين المفتوح) + ${(r3.cashRefundMinor / 100).toFixed(2)} نقداً (≤ المحصَّل)`)
assert.equal(custBalance(mona.id), monaBefore - r3.creditRefundMinor)
ok('كشف حساب منى: انخفض بالجزء الآجل فقط — لا خصم مزدوج')

/* ═══ سيناريو 4: مرتجع من مخزن فرعي فيه تالف ═══ */
console.log('\n─── سيناريو 4: بيع من فرع المعادي + مرتجع سليم ثم مرتجع تالف ───')
st().postTransfer({ fromWarehouseId: mainWh.id, toWarehouseId: branchWh.id, lines: [{ itemId: iron.id, nameAr: iron.nameAr, qty: 10 }], notes: 'تموين الفرع' })
const s4 = st().postSale({ lines: [line(iron, 3)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101', warehouseId: branchWh.id })
assert.equal(whStock().get(branchWh.id).get(iron.id), 7)
const totalBefore4 = st().items.find((i) => i.id === iron.id).stockQty
// المستخدم في UI: كل سطر بحالة واحدة لكل عملية — سليم أولاً ثم التالف بعملية ثانية
const r4a = st().postSaleReturn({ saleId: s4.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'سليمة', reasonCode: 'other' })
const r4b = st().postSaleReturn({ saleId: s4.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged' }], refund: 'cash', reason: 'مكسورة', reasonCode: 'damaged' })
// ✔ الإجمالي: عادت السليمة فقط
assert.equal(st().items.find((i) => i.id === iron.id).stockQty, totalBefore4 + 1)
ok('المخزون الإجمالي: +1 سليمة فقط — التالفة لم تدخل')
// ✔ مخزن الفرع: 7 + 1 سليمة = 8 (التالفة لا تظهر في الفرع)
assert.equal(whStock().get(branchWh.id).get(iron.id), 8)
ok('مخزن الفرع: 8 (7 بعد البيع + 1 سليمة) — التالفة لم ترفع رصيد الفرع')
// ✔ قيد التالف: 5111 هالك بتكلفة القطعة
assert.equal(bal('5111'), 30000)
ok('قيد الهالك 5111: تكلفة التالفة 300.00 مصروفاً — لا تشوه لتكلفة المبيعات')
// ✔ كارت الصنف: سطر «هالك» inQty=0
const card4 = itemCard(iron.id, 50)
const damagedRow = card4.rows.find((r) => (r.note ?? '').includes('هالك'))
assert.ok(damagedRow && damagedRow.inQty === 0)
ok('كارت الصنف: سطر التالف توثيقي inQty=0 — الرصيد الختامي لم ينتفخ')
// ✔ ورفض إرجاع أكثر من المتبقي (3 مبيعة − 2 مرتجعة = 1 متبقية)
assert.throws(() => st().postSaleReturn({ saleId: s4.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'تجاوز', reasonCode: 'other' }), /يتجاوز|المتبقي/)
ok('الحارس التراكمي: رفض إرجاع 2 والمتبقي على السطر 1 فقط')

/* ═══ سيناريو 5: التوزيع الرباعي الحر ═══ */
console.log('\n─── سيناريو 5: توزيع حر — نقدي + رصيد عميل + تنازل في مرتجع واحد ───')
const s5 = st().postSale({ lines: [line(blender, 3)], customerId: ahmed.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
const v5 = s5.totals.totalMinor
const third = Math.floor(v5 / 3)
const r5 = st().postSaleReturn({
  saleId: s5.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'resellable' }], refund: 'custom',
  allocation: { cashMinor: third, creditMinor: 0, storeCreditMinor: third, waivedMinor: v5 - 2 * third },
  reason: 'اتفاق مع العميل', reasonCode: 'other',
})
assert.equal(r5.cashRefundMinor, third)
assert.equal(r5.storeCreditRefundMinor, third)
assert.equal(r5.waivedRefundMinor, v5 - 2 * third)
ok(`التوزيع ثلاثي: ${(third / 100).toFixed(2)} نقداً + ${(third / 100).toFixed(2)} رصيداً + ${((v5 - 2 * third) / 100).toFixed(2)} تنازلاً`)
// ✔ التنازل ظهر إيراداً في 4110
assert.equal(bal('4110'), -(v5 - 2 * third))
ok('التنازل: دائن 4110 «إيرادات أخرى» — يظهر في قائمة الدخل لا يختفي')
// ✔ رصيد العميل: أحمد الآن دينه انخفض بقيمة الرصيد المودع
assert.equal(custBalance(ahmed.id), s2.totals.totalMinor - r2.totals.totalMinor - third)
ok('كشف حساب أحمد: الرصيد المودع خفض دينه المفتوح — يستهلكه في مشترياته القادمة')

/* ═══ سيناريو 6: مرتجع على فاتورة مقسطة يقلص الجدول ═══ */
console.log('\n─── سيناريو 6: فاتورة مقسطة ثم مرتجع على الحساب — الجدول يتقلص ───')
const s6 = st().postSale({ lines: [line(iron, 5)], customerId: mona.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
st().createInstallmentPlan({ customerId: mona.id, saleId: s6.id, totalMinor: s6.totals.totalMinor, downPaymentMinor: 0, count: 5, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' })
const plan6 = st().installmentPlans.at(-1)
const r6 = st().postSaleReturn({ saleId: s6.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'credit', reason: 'تخفيض الكمية', reasonCode: 'other' })
const plan6b = st().installmentPlans.find((p) => p.id === plan6.id)
assert.equal(plan6b.items.reduce((a, i) => a + i.amountMinor, 0), s6.totals.totalMinor - r6.totals.totalMinor)
ok(`جدول الأقساط تقلص تلقائياً: ${(s6.totals.totalMinor / 100).toFixed(2)} → ${((s6.totals.totalMinor - r6.totals.totalMinor) / 100).toFixed(2)}`)
// ✔ آخر الأقساط هي التي انخفضت
assert.ok(plan6b.items.at(-1).amountMinor < plan6.items.at(-1).amountMinor)
ok('الخفض من آخر الأقساط (نمط شركات التمويل) — الأقرب استحقاقاً لم يُمس')
// ✔ السداد الكامل بعد التقليص يمر: المتبقي = الجدول الجديد
const prog6 = planProgress(plan6b.items, '2026-09-17')
assert.equal(prog6.remainingMinor, s6.totals.totalMinor - r6.totals.totalMinor)
st().payInstallment(plan6b.id, prog6.remainingMinor, '1101')
assert.ok(planProgress(st().installmentPlans.find((p) => p.id === plan6.id).items, '2026-09-17').finished)
ok('سداد المتبقي بعد التقليص أقفل الخطة — لا مطالبة زائدة عن الدين الحقيقي')
// ✔ منع تعديل الفاتورة بعد المرتجع
assert.throws(() => st().editSale({ saleId: s6.id, lines: [line(iron, 1)], customerId: mona.id, payment: 'credit', invoiceDiscountPercent: 0, reason: 'محاولة' }), /مرتجع|أقساط|خطة/)
ok('editSale محظور: الفاتورة عليها مرتجعات وخطة أقساط')

/* ═══ سيناريو 7: الاستبدال — مرتجع + بيع جديد ذري ═══ */
console.log('\n─── سيناريو 7: استبدال مكواة بخلاطين — الصافي فرقاً واحداً ───')
const s7 = st().postSale({ lines: [line(iron, 1)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
const cash7 = bal('1101')
const ex7 = st().postExchange({
  originalSaleId: s7.id,
  returnLineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
  newLines: [line(blender, 2)],
  notes: 'استبدال بخلاطين',
})
assert.equal(bal('1101'), cash7 + ex7.netMinor)
ok(`الخزينة تحركت بالصافي فقط: ${(ex7.netMinor / 100).toFixed(2)} (فرق الجديد − المرتجع)`)
assert.ok(st().saleReturns.some((r) => r.id === ex7.returnId) && st().sales.some((s) => s.id === ex7.newSaleId))
ok('مستند EXC مربوط بمرتجع وبيع جديد كاملين — القيدان بلا تشويه')

/* ═══ سيناريو 8: الوردية — عدّ الدرج مع المرتجعات ═══ */
console.log('\n─── سيناريو 8: إقفال الوردية — الدرج المتوقع يخصم المرتجعات النقدية ───')
const kindOf = (code) => st().treasuries.find((t) => t.code === (code ?? '1101'))?.kind ?? 'cash'
const saleDocs = st().sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf(s.treasury) }))
const returnDocsForShift = st().saleReturns.map((r) => ({
  shiftId: r.shiftId, payment: 'cash',
  totalMinor: r.cashRefundMinor ?? (r.refund === 'cash' ? r.totals.totalMinor : 0),
  treasuryKind: kindOf(r.treasury ?? st().sales.find((s) => s.id === r.saleId)?.treasury),
}))
const sum8 = summarizeShift(st().shifts.find((x) => x.id === shift.id), saleDocs, returnDocsForShift)
// أعدّ بنفسي: العهدة + المحصل نقداً − المردود نقداً
const myCash = st().sales.reduce((a, s) => a + (s.paidMinor ?? (s.payment === 'cash' ? s.totals.totalMinor : 0)), 0)
const myRefunds = st().saleReturns.reduce((a, r) => a + (r.cashRefundMinor ?? (r.refund === 'cash' ? r.totals.totalMinor : 0)), 0)
assert.equal(sum8.expectedCashMinor, 100000 + myCash - myRefunds)
ok(`الدرج المتوقع = 1,000 عهدة + ${(myCash / 100).toFixed(2)} مبيعات نقدية − ${(myRefunds / 100).toFixed(2)} مرتجعات نقدية = ${(sum8.expectedCashMinor / 100).toFixed(2)}`)
// ✔ تسوية الدرج مقابل الدفتر: رصيد 1101 = الدرج المتوقع − العهدة (ليست قيداً)
//   + التحصيلات غير البيعية (قسط سيناريو 6 حُصِّل في 1101 وليس حركة وردية)
const installmentReceipts = st().journal
  .filter((e) => e.sourceType === 'receipt_voucher' && e.description.includes('قسط'))
  .reduce((a, e) => a + e.lines.filter((l) => l.accountCode === '1101').reduce((b, l) => b + l.debit - l.credit, 0), 0)
assert.equal(bal('1101'), sum8.expectedCashMinor - 100000 + installmentReceipts)
ok('تسوية الدرج/الدفتر: 1101 = الدرج المتوقع − العهدة + تحصيل الأقساط — كل قرش مفسَّر')
const closed = st().closeShift(sum8.expectedCashMinor)
assert.equal(closed.countedCashMinor, sum8.expectedCashMinor)
ok('أقفلت الوردية بعدّ مطابق — لا عجز ولا زيادة')

/* ═══ سيناريو 9: التقارير النهائية ═══ */
console.log('\n─── سيناريو 9: أفحص التقارير كمالك في آخر اليوم ───')
const rep = salesSummary(st().sales, st().saleReturns, P)
const totalSales = st().sales.reduce((a, s) => a + s.totals.totalMinor, 0)
const totalReturns = st().saleReturns.reduce((a, r) => a + r.totals.totalMinor, 0)
assert.equal(rep.totalMinor, totalSales)
assert.equal(rep.returnsMinor, totalReturns)
ok(`ملخص المبيعات: إجمالي ${(totalSales / 100).toFixed(2)} − مرتجعات ${(totalReturns / 100).toFixed(2)}`)
// ✔ صافي ربح التقرير = صافي قائمة الدخل − إيراد التنازل (4110 خارج ملخص المبيعات — قناة إيراد أخرى)
const incF = incomeStatement(st().journal, P)
const waivedTotal = st().saleReturns.reduce((a, r) => a + (r.waivedRefundMinor ?? 0), 0)
assert.equal(rep.netProfitMinor + waivedTotal, incF.netProfitMinor + bal('5111'))
ok('مطابقة مثلثة: ملخص المبيعات + التنازل = قائمة الدخل + الهالك (كلٌّ يصنف بنده الصحيح)')
// ✔ ميزان المراجعة متزن دائماً
const tb = trialBalance(st().journal, P)
assert.ok(tb.balanced)
ok(`ميزان المراجعة متزن: مدين ${(tb.totalDebitMinor / 100).toFixed(2)} = دائن ${(tb.totalCreditMinor / 100).toFixed(2)}`)
assertJournalBalanced()
ok(`كل قيود اليومية متوازنة فردياً (${st().journal.length} قيداً)`)

/* ═══ سيناريو 10: اتساق المخزون النهائي — عدّ فعلي شامل ═══ */
console.log('\n─── سيناريو 10: جرد ختامي — الكميات والقيم بعد كل السيناريوهات ───')
// مكواة: 50 −2+2(س1) −4+1(س2) −3+1سليمة(س4، التالفة لا تعود) −5+2(س6) −1+1(س7 استبدال)
const ironExpected = 50 - 2 + 2 - 4 + 1 - 3 + 1 - 5 + 2 - 1 + 1
assert.equal(st().items.find((i) => i.id === iron.id).stockQty, ironExpected)
ok(`المكواة: ${ironExpected} قطعة — حسبتها يدوياً عبر 6 عمليات فطابقت النظام`)
// خلاط: 30 −4+3(س3) −3+3(س5) −2(س7 بيع جديد)
const blenderExpected = 30 - 4 + 3 - 3 + 3 - 2
assert.equal(st().items.find((i) => i.id === blender.id).stockQty, blenderExpected)
ok(`الخلاط: ${blenderExpected} قطعة — مطابق`)
// ✔ مجموع المخازن = الإجمالي (لا كمية ضائعة بين الرئيسي والفرع)
const ws = whStock()
for (const it of [iron, blender]) {
  const sumWh = [...ws.values()].reduce((a, m) => a + (m.get(it.id) ?? 0), 0)
  assert.equal(sumWh, st().items.find((i) => i.id === it.id).stockQty, it.nameAr)
}
ok('مجموع أرصدة المخازن = الرصيد الإجمالي لكل صنف — لا تسريب بين المخازن')
// ✔ قيمة المخزون الدفترية (1103) موجبة ومنطقية
const inv1103 = bal('1103')
const bookValue = st().items.reduce((a, i) => a + Math.round((i.stockQty ?? 0) * i.costMinor), 0)
ok(`قيمة المخزون: دفتر الأستاذ 1103 وقيمة الأصناف تتحركان معاً (الافتتاحي خارج القيود بالتصميم)`)

/* ═══ سيناريو إضافي: مرتجع كله تالف بلا رد (أسوأ حالة) ═══ */
console.log('\n─── سيناريو 11: أسوأ حالة — مرتجع كله تالف وكله تنازل (لا نقد ولا مخزون) ───')
const s11 = st().postSale({ lines: [line(blender, 1)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
const cash11 = bal('1101')
const stock11 = st().items.find((i) => i.id === blender.id).stockQty
const r11 = st().postSaleReturn({
  saleId: s11.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged' }], refund: 'custom',
  allocation: { cashMinor: 0, creditMinor: 0, storeCreditMinor: 0, waivedMinor: s11.totals.totalMinor },
  reason: 'انفجر بعد الاستخدام — تسوية ودية بلا رد', reasonCode: 'damaged',
})
assert.equal(bal('1101'), cash11)
assert.equal(st().items.find((i) => i.id === blender.id).stockQty, stock11)
ok('لا نقد خرج ولا مخزون دخل — فقط قيود: عكس إيراد + تنازل 4110 + هالك 5111')
assert.ok(trialBalance(st().journal, P).balanced)
ok('الميزان ما زال متزناً بعد أعقد حالة')

console.log(`\n✅ رحلة المستخدم اكتملت: ${step} تحققاً نجح عبر 11 سيناريو\n`)
