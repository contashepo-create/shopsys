/**
 * المرحلة 2 من خطة التدقيق المحاسبي — القسمان 2.1 المبيعات/الكاشير و2.2 المرتجعات.
 *
 * لكل حدث: «الحدث ← القيد المتوقع» مفحوصاً سطراً سطراً على متجر معزول (auditKit)،
 * ثم الثوابت العشرة بعد كل خطوة، ثم حالات الحافة وسلوك الرفض الذري.
 *
 * 2.1 المبيعات: نقدي · آجل · مختلط (paidMinor) · توزيع متعدد الوسائل · شامل/غير شامل الضريبة ·
 *     خصم سطر + خصم فاتورة · قيد التكلفة (المتوسط لحظة البيع) · خدمة بلا تكلفة ·
 *     عمولة مندوب · وردية إلزامية · حد ائتمان (رفض + تجاوز باعتماد) · بيع بالسالب.
 * 2.2 المرتجعات: مرتجع نقدي كامل/جزئي · سقف الكمية التراكمي · تالف (5111 لا يعود للمخزون) ·
 *     التوزيع الحر الرباعي (نقد/ذمم/رصيد عميل/تنازل 4110) · مرتجع فاتورة آجلة · أثر ث7.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase2_sales_returns.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'

const R = reporter('المرحلة 2 — 2.1 المبيعات و2.2 المرتجعات')
const money = (n) => `${(n / 100).toLocaleString('ar-EG')}ج`

/** رصيد حساب في حالة تدقيق */
const bal = (c, code) => balanceOf(c.st().journal, code)
/** قيد المستند الأخير */
const lastEntry = (c) => c.st().journal.at(-1)
/** سطر حساب داخل قيد (يجمع التكرار) */
const lineOf = (entry, code) => {
  const rows = entry.lines.filter((l) => l.accountCode === code)
  if (!rows.length) return null
  return { debit: rows.reduce((s, l) => s + l.debit, 0), credit: rows.reduce((s, l) => s + l.credit, 0) }
}
const cart = (item, qty, price, extra = {}) => ({
  itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: price,
  unitCostMinor: 0, discountPercent: 0, soldByWeight: false, ...extra,
})

/** يجهّز صنفاً بمخزون حقيقي عبر فاتورة شراء (المتوسط المرجح يصير معلوماً) */
function stockedItem(c, { nameAr, priceMinor, qty, costMinor, supplierId }) {
  const item = addSimpleItem(c, { nameAr, priceMinor })
  c.st().postPurchase({
    supplierId, date: '2026-03-01', lines: [{ itemId: item.id, qty, unitPriceMinor: costMinor, expiryDate: null }],
    expenses: [], paidMinor: qty * costMinor, treasury: '1101', notes: '',
  })
  return c.st().items.find((i) => i.id === item.id)
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.1 المبيعات والكاشير —')
// ══════════════════════════════════════════════════════════════════

// (1) بيع نقدي بضريبة غير شاملة: خزينة مدين بالإجمالي / 4101 بالأساس / 2102 بالضريبة / 5101↔1103 بالتكلفة
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'أرز', priceMinor: 10000, qty: 100, costMinor: 6000, supplierId: sup.id })
  const cashBefore = bal(c, '1101')
  const sale = c.st().postSale({
    lines: [cart(item, 10, 10000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(sale.totals.netMinor, 100000)
  assert.equal(sale.totals.taxMinor, 14000)
  assert.equal(sale.totals.totalMinor, 114000)
  assert.equal(lineOf(e, '1101').debit, 114000)
  assert.equal(lineOf(e, '4101').credit, 100000)
  assert.equal(lineOf(e, '2102').credit, 14000)
  assert.equal(lineOf(e, '5101').debit, 60000)
  assert.equal(lineOf(e, '1103').credit, 60000)
  assert.equal(bal(c, '1101') - cashBefore, 114000)
  assert.equal(e.sourceType, 'sale')
  assertInvariants('بيع نقدي', c)
  R.ok(`نقدي غير شامل: 1101 مدين ${money(114000)} · 4101 ${money(100000)} · 2102 ${money(14000)} · 5101/1103 ${money(60000)}`)
}

// (2) بيع آجل + ضريبة شاملة: الإجمالي = الصافي، و1104 = رصيد العميل (ث7)
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: true })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل آجل')
  const item = stockedItem(c, { nameAr: 'زيت', priceMinor: 11400, qty: 50, costMinor: 5000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 10, 11400)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(sale.totals.totalMinor, 114000)
  assert.equal(sale.totals.netMinor, 114000, 'الشامل: العميل يدفع الصافي كما هو')
  assert.equal(sale.totals.taxBaseMinor + sale.totals.taxMinor, sale.totals.totalMinor, 'الأساس + الضريبة = الإجمالي بلا قرش ضائع')
  assert.equal(lineOf(e, '1104').debit, 114000)
  assert.equal(lineOf(e, '1101'), null, 'الآجل لا يمس الخزينة')
  assert.equal(c.st().getCustomerBalance(cust.id), 114000)
  assertInvariants('بيع آجل شامل الضريبة', c)
  R.ok(`آجل شامل: 1104 مدين ${money(114000)} = كشف العميل · الأساس ${money(sale.totals.taxBaseMinor)} + ضريبة ${money(sale.totals.taxMinor)} = الإجمالي`)
}

// (3) الدفع المجزأ: paidMinor نقداً والباقي ذمماً — بالقرش
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل مجزأ')
  const item = stockedItem(c, { nameAr: 'سكر', priceMinor: 5000, qty: 100, costMinor: 3000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 20, 5000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101', paidMinor: 40000,
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(sale.totals.totalMinor, 114000)
  assert.equal(lineOf(e, '1101').debit, 40000)
  assert.equal(lineOf(e, '1104').debit, 74000)
  assert.equal(c.st().getCustomerBalance(cust.id), 74000)
  assertInvariants('بيع مجزأ', c)
  R.ok(`مجزأ: نقدي ${money(40000)} + ذمم ${money(74000)} = ${money(114000)} بلا فروق`)
  // الرفض الذري: مدفوع أكبر من الإجمالي
  expectReject('مدفوع أكبر من الفاتورة', c, () => c.st().postSale({
    lines: [cart(item, 1, 5000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101', paidMinor: 999999,
  }), /أكبر من إجمالي الفاتورة/)
  R.ok('رفض ذري: المدفوع نقداً > إجمالي الفاتورة (بلا أثر جزئي)')
}

// (4) التحصيل متعدد الوسائل (allocations): خزينة + بنك + الباقي ذمم
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل مختلط')
  const item = stockedItem(c, { nameAr: 'شاي', priceMinor: 10000, qty: 50, costMinor: 4000, supplierId: sup.id })
  c.st().addTreasury('بنك مصر', 'bank')
  const bank = c.st().treasuries.at(-1)
  const sale = c.st().postSale({
    lines: [cart(item, 10, 10000)], customerId: cust.id, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
    paymentAllocations: [
      { accountCode: '1101', amountMinor: 50000, note: 'نقدي' },
      { accountCode: bank.code, amountMinor: 30000, note: 'تحويل بنكي' },
    ],
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(lineOf(e, '1101').debit, 50000)
  assert.equal(lineOf(e, bank.code).debit, 30000)
  assert.equal(lineOf(e, '1104').debit, 114000 - 80000)
  assertInvariants('تحصيل متعدد الوسائل', c)
  R.ok(`توزيع التحصيل: ${money(50000)} خزينة + ${money(30000)} بنك + ${money(34000)} ذمم = الإجمالي`)
  expectReject('تحصيل أكبر من الفاتورة', c, () => c.st().postSale({
    lines: [cart(item, 1, 10000)], customerId: cust.id, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
    paymentAllocations: [{ accountCode: '1101', amountMinor: 900000, note: 'خطأ' }],
  }), /أكبر من إجمالي الفاتورة/)
  R.ok('رفض ذري: مجموع وسائل التحصيل > الإجمالي')
}

// (5) خصم السطر + خصم الفاتورة: الإيراد بالصافي والضريبة على الصافي
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'جبن', priceMinor: 20000, qty: 40, costMinor: 10000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 10, 20000, { discountPercent: 10 })], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 5, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  const gross = 200000, afterLine = 180000, afterInvoice = 171000
  assert.equal(sale.totals.grossMinor, gross)
  assert.equal(sale.totals.discountMinor, gross - afterInvoice)
  assert.equal(sale.totals.netMinor, afterInvoice)
  assert.equal(lineOf(e, '4101').credit, afterInvoice, 'الإيراد يُثبت صافياً بعد الخصمين')
  assert.equal(lineOf(e, '2102').credit, Math.round(afterInvoice * 0.14))
  assert.equal(lineOf(e, '5101').debit, 100000, 'الخصم لا يمس التكلفة')
  assertInvariants('خصم سطر + خصم فاتورة', c)
  R.ok(`خصم 10% سطر ثم 5% فاتورة: ${money(gross)} ← ${money(afterInvoice)} إيراداً والضريبة على الصافي والتكلفة كما هي`)
}

// (6) قيد التكلفة يستعمل المتوسط لحظة البيع لا سعر السطر الوارد من الواجهة
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'دقيق', priceMinor: 9000, qty: 100, costMinor: 5000, supplierId: sup.id })
  c.st().postPurchase({ supplierId: sup.id, date: '2026-03-05', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 7000, expiryDate: null }], expenses: [], paidMinor: 700000, treasury: '1101', notes: '' })
  const avg = c.st().items.find((i) => i.id === item.id).costMinor
  assert.equal(avg, 6000, 'المتوسط المرجح = (100×50 + 100×70) / 200')
  const sale = c.st().postSale({
    lines: [cart(item, 10, 9000, { unitCostMinor: 1 })], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(sale.lines[0].unitCostMinor, avg, 'اللقطة تُصحح تكلفة السطر')
  assert.equal(lineOf(e, '5101').debit, 10 * avg)
  assertInvariants('تكلفة بالمتوسط', c)
  R.ok(`التكلفة من المتوسط المرجح (${money(avg)}) لا من سطر الواجهة — 5101 = ${money(10 * avg)}`)
}

// (7) صنف خدمي: إيراد بلا تكلفة ولا حركة مخزون
{
  const c = await freshCase({ activityId: 'general', taxInclusive: false })
  const svc = addSimpleItem(c, { nameAr: 'خدمة صيانة', priceMinor: 50000, isService: true })
  const sale = c.st().postSale({
    lines: [cart(svc, 2, 50000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  const e = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(lineOf(e, '5101'), null)
  assert.equal(lineOf(e, '1103'), null)
  assert.equal(lineOf(e, '4101').credit, 100000)
  assert.equal(c.st().items.find((i) => i.id === svc.id).stockQty, 0)
  assertInvariants('بيع خدمة', c)
  R.ok('الخدمة: إيراد وضريبة فقط — لا 5101 ولا 1103 ولا حركة مخزون')
}

// (8) عمولة مندوب على الفاتورة: مصروف + التزام للموظف، والإجمالي لا يتأثر
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'عطر', priceMinor: 100000, qty: 20, costMinor: 40000, supplierId: sup.id })
  c.st().addEmployee({ nameAr: 'مندوب', phone: '', jobTitle: 'مندوب مبيعات', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '' })
  const emp = c.st().employees.at(-1)
  const before = { exp: bal(c, '5117'), due: bal(c, '2116') }
  const sale = c.st().postSale({
    lines: [cart(item, 2, 100000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
    staffCommission: { employeeId: emp.id, amountMinor: 5000, description: 'عمولة بيع' },
  })
  const saleEntry = c.st().journal.find((x) => x.id === sale.journalEntryId)
  assert.equal(sale.totals.totalMinor, 200000, 'العمولة لا تغيّر إجمالي الفاتورة')
  assert.equal(lineOf(saleEntry, '1101').debit, 200000)
  const commissionEntries = c.st().journal.filter((x) => x.id !== sale.journalEntryId && x.lines.some((l) => l.debit === 5000 || l.credit === 5000))
  assert.ok(commissionEntries.length >= 1, 'للعمولة قيد استحقاق مستقل')
  const delta = { exp: bal(c, '5117') - before.exp, due: bal(c, '2116') - before.due }
  assert.equal(delta.exp, 5000, 'مصروف عمولات الموظفين 5117 مدين بالعمولة')
  assert.equal(delta.due, -5000, 'عمولات موظفين مستحقة 2116 دائنة بنفس القيمة')
  assertInvariants('عمولة مندوب', c)
  R.ok(`عمولة المندوب ${money(5000)}: 5117 مدين / 2116 دائن في قيد مستقل — الفاتورة ${money(200000)} كما هي`)
}

// (9) الوردية الإلزامية: بيع بلا وردية مرفوض ذرياً، وبعد الفتح يمر ويدخل حصيلة الوردية
{
  const c = await freshCase({ activityId: 'grocery', requireOpenShiftForSales: true, taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'ماء', priceMinor: 1000, qty: 100, costMinor: 500, supplierId: sup.id })
  // السياسة بالدور: المالك معفى تلميحاً — نُلزم الكاشير كما في الواقع
  const { hashPin } = await import('../src/core/audit.ts')
  c.st().setOwnerPin(await hashPin('123456'))
  const cashier = c.st().addAppUser({ nameAr: 'كاشير الوردية', roleId: 'cashier', pinHash: await hashPin('567890'), active: true })
  await c.st().login(cashier.id, '567890')
  expectReject('بيع بلا وردية مفتوحة', c, () => c.st().postSale({
    lines: [cart(item, 1, 1000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }), /وردية/)
  R.ok('رفض ذري: لا بيع بلا وردية مفتوحة حين تُفعّل السياسة')
  c.st().openShift('كاشير الوردية', 10000)
  const sale = c.st().postSale({
    lines: [cart(item, 5, 1000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const shift = c.st().shifts.at(-1)
  assert.equal(c.st().sales.find((s) => s.id === sale.id).shiftId, shift.id, 'الفاتورة مربوطة بالوردية المفتوحة')
  assertInvariants('بيع داخل وردية', c)
  R.ok('بعد فتح الوردية: البيع يمر ويُربط برقم الوردية')
}

// (10) حد الائتمان: تجاوزه مرفوض، وباعتماد مدير يمر ويُوثَّق
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'مكرونة', priceMinor: 5000, qty: 200, costMinor: 2000, supplierId: sup.id })
  const cust = addParty(c, 'customer', 'عميل محدود')
  c.st().updateCustomer(cust.id, { creditLimitMinor: 50000 })
  expectReject('تجاوز حد الائتمان', c, () => c.st().postSale({
    lines: [cart(item, 20, 5000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }), /ائتمان|الحد/)
  R.ok('رفض ذري: بيع آجل يتجاوز حد ائتمان العميل')
  const okSale = c.st().postSale({
    lines: [cart(item, 20, 5000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
    creditLimitOverrideBy: 'مدير الفرع',
  })
  assert.equal(c.st().sales.find((s) => s.id === okSale.id).creditLimitOverrideBy, 'مدير الفرع')
  assert.equal(c.st().getCustomerBalance(cust.id), 100000)
  assertInvariants('تجاوز حد الائتمان باعتماد', c)
  R.ok('الاعتماد يمرر البيع ويُحفظ اسم المعتمِد على الفاتورة')
}

// (11) البيع بالسالب: مرفوض بلا إذن، ويمر بإذن صريح مع بقاء 1103 = التقييم
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'عصير', priceMinor: 3000, qty: 5, costMinor: 1000, supplierId: sup.id })
  expectReject('بيع أكثر من الرصيد', c, () => c.st().postSale({
    lines: [cart(item, 9, 3000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }), /مخزون غير كاف/)
  R.ok('رفض ذري: البيع بأكثر من المتاح بلا إذن السالب')
  c.st().postSale({
    lines: [cart(item, 9, 3000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101', allowNegativeStock: true,
  })
  assert.equal(c.st().items.find((i) => i.id === item.id).stockQty, -4)
  assertInvariants('بيع بالسالب بإذن', c)
  R.ok('بإذن صريح: الرصيد −4 والدفتر 1103 مطابق للتقييم السالب (ث5 صامدة)')
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.2 المرتجعات والاستبدال —')
// ══════════════════════════════════════════════════════════════════

// (12) مرتجع نقدي جزئي: عكس نسبي للإيراد والضريبة والتكلفة + رد من الخزينة
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'أرز', priceMinor: 10000, qty: 100, costMinor: 6000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 10, 10000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  const cashBefore = bal(c, '1101'), stockBefore = bal(c, '1103')
  const ret = c.st().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 4]]), refund: 'cash', reason: 'لم يعجب العميل' })
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assert.equal(ret.totals.totalMinor, 45600, '4 × 100ج + ضريبة 14%')
  assert.equal(lineOf(e, '1101').credit, 45600, 'النقدية تخرج بقيمة المرتجع')
  assert.ok(lineOf(e, '4102')?.debit === 40000 || lineOf(e, '4101')?.debit === 40000, 'الإيراد يُعكس بالأساس')
  assert.equal(lineOf(e, '2102').debit, 5600, 'الضريبة تُعكس')
  assert.equal(lineOf(e, '1103').debit, 24000, 'البضاعة تعود بتكلفتها')
  assert.equal(lineOf(e, '5101').credit, 24000)
  assert.equal(bal(c, '1101') - cashBefore, -45600)
  assert.equal(bal(c, '1103') - stockBefore, 24000)
  assert.equal(c.st().items.find((i) => i.id === item.id).stockQty, 94)
  assertInvariants('مرتجع نقدي جزئي', c)
  R.ok(`مرتجع 4 من 10: رد ${money(45600)} · عكس الإيراد ${money(40000)} والضريبة ${money(5600)} · عودة المخزون ${money(24000)}`)
  // السقف التراكمي
  expectReject('إرجاع أكثر من المتبقي', c, () => c.st().postSaleReturn({
    saleId: sale.id, qtyByItem: new Map([[item.id, 7]]), refund: 'cash', reason: 'تجاوز',
  }), /المتبقي القابل للإرجاع/)
  R.ok('رفض ذري: الكمية التراكمية المرتجعة لا تتجاوز المباع')
}

// (13) مرتجع تالف: القيمة تُرد للعميل والتكلفة تذهب هالكاً 5111 بلا عودة للمخزون
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = stockedItem(c, { nameAr: 'زبادي', priceMinor: 2000, qty: 60, costMinor: 1000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 10, 2000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const qtyBefore = c.st().items.find((i) => i.id === item.id).stockQty
  const ret = c.st().postSaleReturn({
    saleId: sale.id,
    lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'damaged' }],
    refund: 'cash', reason: 'وصل تالفاً', reasonCode: 'damaged',
  })
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assert.equal(lineOf(e, '5111').debit, 3000, 'تكلفة التالف على 5111 هالك وتوالف')
  assert.equal(lineOf(e, '1103'), null, 'التالف لا يعود للمخزون')
  assert.equal(c.st().items.find((i) => i.id === item.id).stockQty, qtyBefore, 'الرصيد لم يزد')
  assert.equal(lineOf(e, '1101').credit, 6000, 'العميل استرد قيمته كاملة')
  assertInvariants('مرتجع تالف', c)
  R.ok(`تالف: رد ${money(6000)} للعميل · التكلفة ${money(3000)} هالكاً 5111 · المخزون لم يتغير`)
}

// (14) التوزيع الحر الرباعي: نقد + خصم دين + رصيد عميل + تنازل (4110)
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل الحرية')
  const item = stockedItem(c, { nameAr: 'سمن', priceMinor: 10000, qty: 100, costMinor: 5000, supplierId: sup.id })
  // فاتورة 1000ج: 400 نقداً و600 آجل ⇒ المُحصَّل 400 والمفتوح 600
  const sale = c.st().postSale({
    lines: [cart(item, 10, 10000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101', paidMinor: 40000,
  })
  const before = { cash: bal(c, '1101'), ar: bal(c, '1104'), other: bal(c, '4110') }
  const ret = c.st().postSaleReturn({
    saleId: sale.id, qtyByItem: new Map([[item.id, 8]]), refund: 'custom', reason: 'توزيع حر',
    allocation: { cashMinor: 20000, creditMinor: 40000, storeCreditMinor: 15000, waivedMinor: 5000 },
  })
  assert.equal(ret.totals.totalMinor, 80000)
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assert.equal(lineOf(e, '1101').credit, 20000, 'النقد الخارج = الجزء النقدي فقط')
  assert.equal(lineOf(e, '1104').credit, 40000 + 15000, 'خصم الدين + رصيد العميل كلاهما دائن على 1104')
  assert.equal(lineOf(e, '4110').credit, 5000, 'التنازل مكسب على إيرادات أخرى')
  assert.equal(bal(c, '1101') - before.cash, -20000)
  assert.equal(bal(c, '1104') - before.ar, -55000)
  assert.equal(bal(c, '4110') - before.other, -5000, 'رصيد الإيراد الآخر دائن بالتنازل')
  assertInvariants('توزيع حر رباعي', c)
  R.ok(`التوزيع الرباعي: نقد ${money(20000)} + دين ${money(40000)} + رصيد ${money(15000)} + تنازل ${money(5000)} = ${money(80000)}`)
  expectReject('توزيع لا يساوي قيمة المرتجع', c, () => c.st().postSaleReturn({
    saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'custom', reason: 'خطأ',
    allocation: { cashMinor: 1, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 },
  }), /مجموع التوزيع/)
  R.ok('رفض ذري: مجموع التوزيع ≠ قيمة المرتجع')
  // المُحصَّل فعلاً 400ج ورُدّ منه 200ج ⇒ المتبقي القابل للرد نقداً 200ج بالضبط
  c.st().postSaleReturn({
    saleId: sale.id, qtyByItem: new Map([[item.id, 2]]), refund: 'custom', reason: 'إتمام الإرجاع',
    allocation: { cashMinor: 20000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 },
  })
  assert.equal(bal(c, '1101') - before.cash, -40000, 'مجموع النقد المردود = المُحصَّل فعلاً ولا قرش زيادة')
  assert.equal(c.st().getCustomerBalance(cust.id), 5000, 'المتبقي على العميل = ما تنازل عنه بالضبط (تطابق حسابي كامل)')
  assert.equal(bal(c, '4110') - before.other, -5000)
  assertInvariants('إغلاق دورة الإرجاع الحر', c)
  R.ok('إرجاع كامل الكمية بتوزيعين: النقد المردود = المحصَّل · والمتبقي على العميل = المتنازَل عنه (تطابق بالقرش)')
  // سقف النقد: فاتورة آجلة بالكامل لا يخرج منها قرش نقدي
  const creditOnly = c.st().postSale({
    lines: [cart(item, 5, 10000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  expectReject('رد نقدي من فاتورة آجلة لم يُحصَّل منها شيء', c, () => c.st().postSaleReturn({
    saleId: creditOnly.id, qtyByItem: new Map([[item.id, 1]]), refund: 'custom', reason: 'خطأ',
    allocation: { cashMinor: 10000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 },
  }), /نقد/)
  R.ok('رفض ذري: لا نرد نقداً من فاتورة لم نستلم منها نقداً')
}

// (15) مرتجع فاتورة آجلة: يخفض دين العميل ويطابق كشفه (ث7)
{
  const c = await freshCase({ activityId: 'grocery', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل آجل')
  const item = stockedItem(c, { nameAr: 'شوكولاتة', priceMinor: 4000, qty: 100, costMinor: 2000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(item, 25, 4000)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  assert.equal(c.st().getCustomerBalance(cust.id), 114000)
  c.st().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 5]]), refund: 'credit', reason: 'فائض' })
  const expected = 114000 - Math.round(114000 * 5 / 25)
  assert.equal(c.st().getCustomerBalance(cust.id), expected)
  assert.equal(bal(c, '1104'), expected, 'الدفتر = الكشف بالقرش (ث7)')
  assertInvariants('مرتجع آجل', c)
  R.ok(`مرتجع آجل: دين العميل ${money(114000)} ← ${money(expected)} ودفتر 1104 مطابق`)
}

// (16) الاستبدال: مرتجع + فاتورة جديدة وصافي الفرق فقط
{
  const c = await freshCase({ activityId: 'clothing', taxInclusive: false })
  const sup = addParty(c, 'supplier', 'مورد')
  const shirt = stockedItem(c, { nameAr: 'قميص', priceMinor: 20000, qty: 50, costMinor: 10000, supplierId: sup.id })
  const jacket = stockedItem(c, { nameAr: 'جاكيت', priceMinor: 50000, qty: 50, costMinor: 25000, supplierId: sup.id })
  const sale = c.st().postSale({
    lines: [cart(shirt, 1, 20000)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const cashBefore = bal(c, '1101')
  const exchange = c.st().postExchange({
    originalSaleId: sale.id,
    returnQtyByItem: new Map([[shirt.id, 1]]),
    newLines: [cart(jacket, 1, 50000)],
    treasury: '1101',
    notes: 'استبدال بمقاس أكبر',
  })
  assert.equal(bal(c, '1101') - cashBefore, 30000, 'العميل دفع الفرق فقط')
  assert.equal(c.st().items.find((i) => i.id === shirt.id).stockQty, 50)
  assert.equal(c.st().items.find((i) => i.id === jacket.id).stockQty, 49)
  assert.ok(exchange.netMinor === 30000 || exchange.netDueMinor === 30000, 'مستند الاستبدال يوثق الصافي')
  assertInvariants('استبدال', c)
  R.ok(`استبدال قميص بجاكيت: صافي مقبوض ${money(30000)} · المخزونان صحيحان · مستند رابط`)
}

R.done('— 2.1 و2.2 مغطيان بجدول «الحدث ← القيد» كاملاً')
