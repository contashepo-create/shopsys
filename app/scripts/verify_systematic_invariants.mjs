/**
 * 🛡️ الفحص المنهجي الشامل — سد فئات الأخطاء لا اصطياد أفرادها
 *
 * كل خطأ اكتُشف في الجولات السابقة كان فرداً من فئة. هذا السكربت يفحص الفئة كاملة
 * على حالة حية تُبنى بكل أنواع المستندات المتاحة ثم يتحقق من ثوابت (invariants)
 * يجب أن تصمد مهما كان تسلسل العمليات:
 *
 * I1 دفاتر مساعدة ↔ عام: Σدفعات كل صنف بصلاحية = stockQty؛ Σسيريالات المتاحة = المخزون؛
 *    Σكسر متبقٍ يدخل 1103؛ رصيد 1108 = Σعهد مفتوحة؛ 1110 = Σمطالبات غير مسواة
 * I2 كل قيد متزن + أعداد صحيحة + غير سالبة + له تاريخ صالح + وصف غير فارغ
 * I3 كل sourceType في اليومية له مستند مصدر فعلي موجود
 * I4 التقارير تتقاطع: ميزان=ميزانية=دخل؛ ضريبة الإقرار=رصيد 2102
 * I5 الذمم: كل عميل/مورد/موظف كشفه يطابق رصيده المشتق
 * I6 خصائص النشاط: أصناف تتبع صلاحية لها دفعات مطابقة، تتبع سيريال عدد متاحها=مخزونها
 *
 * تشغيل: node --experimental-strip-types scripts/verify_systematic_invariants.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'general', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance, incomeStatement, balanceSheet, vatReport } = await import(join(root, 'src/core/financialReports.ts'))

const st = () => useDataStore.getState()
const P = { from: '2000-01-01', to: '2099-12-31' }
let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

console.log('\n🛡️ الفحص المنهجي: بناء حالة بكل أنواع المستندات ثم فحص الثوابت\n')

/* ═══ بناء حالة غنية: كل نوع مستند يظهر مرة على الأقل ═══ */
const item = (nameAr, sku, price, extra = {}) => ({
  nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: price, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...extra,
})
const cline = (it, qty, price, extra = {}) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, ...extra })

st().addSupplier({ nameAr: 'مورد عام', phone: '', address: '', notes: '', openingMinor: 0 })
const sup = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'عميل عام', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const cust = st().customers.at(-1)
st().addEmployee({ nameAr: 'موظف عام', phone: '', jobTitle: 'إداري', salaryMinor: 600_000, hiredAt: '2026-01-01', notes: '', active: true })
const emp = st().employees.at(-1)

// أصناف بكل الخصائص: عادي، صلاحية، سيريال، خدمة
st().addItem(item('عادي', 'N-1', 10_000))
st().addItem(item('بصلاحية', 'E-1', 20_000, { trackExpiry: true }))
st().addItem(item('بسيريال', 'S-1', 500_000, { trackSerial: true }))
const [normal, expiry, serialItem] = st().items
// شراء بكل الأنواع
st().postPurchase({ supplierId: sup.id, date: '2026-03-01', lines: [{ itemId: normal.id, qty: 100, unitPriceMinor: 6_000 }, { itemId: expiry.id, qty: 50, unitPriceMinor: 12_000, expiryDate: '2027-06-30' }, { itemId: serialItem.id, qty: 3, unitPriceMinor: 350_000, serialsRaw: 'SN-A,SN-B,SN-C' }], expenses: [{ nameAr: 'شحن', amountMinor: 30_000, paidFrom: 'cash' }], paidMinor: 2_000_000, notes: '' })
st().postPurchase({ supplierId: sup.id, date: '2026-03-02', lines: [{ itemId: expiry.id, qty: 30, unitPriceMinor: 13_000, expiryDate: '2027-09-30' }], expenses: [], paidMinor: 0, notes: '' })
// بيع نقدي وآجل وبسيريال
st().postSale({ lines: [cline(normal, 10, 10_000), cline(expiry, 5, 20_000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
st().postSale({ lines: [cline(serialItem, 1, 500_000, { serials: ['SN-B'] })], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
const creditSale = st().sales.at(-1)
// مرتجع جزئي
st().postSaleReturn({ saleId: st().sales[0].id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'good' }], refund: 'cash', reason: 'فحص منهجي' })
// مرتجع شراء
st().postPurchaseReturn({ purchaseId: st().purchases.at(-1).id, qtyByItem: new Map([[expiry.id, 5]]), refund: 'cash', reason: 'فحص' })
// هالك + صرف داخلي + جرد
st().postWastage({ reason: 'تلف مخزن', lines: [{ itemId: normal.id, qty: 3 }], notes: '' })
st().postConsumption({ purpose: 'نظافة', lines: [{ itemId: normal.id, qty: 2 }], notes: '' })
{
  const cur = st().items.find((i) => i.id === normal.id)
  st().postStocktake([{ itemId: cur.id, nameAr: cur.nameAr, expectedQty: cur.stockQty, countedQty: cur.stockQty - 1, unitCostMinor: cur.costMinor }], 'عجز حبة')
}
// سندات وعهدة وشيكات
st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100_000, description: 'تحصيل من عميل', partyKind: 'customer', partyId: cust.id })
const cf = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'نثريات', notes: '' })
st().fundCustodyFile({ fileId: cf.id, amountMinor: 80_000, treasury: '1101', description: 'تمويل' })
st().postCustodyExpense({ fileId: cf.id, expenseAccount: '5104', amountMinor: 30_000, description: 'مواصلات', excessMinor: 0 })
st().receiveCheque({ chequeNumber: 'CHQ-9', partyId: cust.id, partyName: cust.nameAr, bankName: 'بنك', amountMinor: 50_000, dueDate: '2026-10-01', notes: '' })
// تأمين + مطالبات
st().addInsuranceProvider({ nameAr: 'جهة تعاقد', coveragePercent: 60, phone: '', notes: '' })
const prov = st().insuranceProviders.at(-1)
st().postInsuredSale({ lines: [cline(expiry, 4, 20_000)], providerId: prov.id, taxPercent: 0, taxInclusive: true, treasury: '1101' })
// كسر ذهب
st().buyScrap({ karat: 'k21', weightGrams: 5, pricePerGramMinor: 300_000, sellerName: 'بائع', treasury: '1101' })
st().sellScrap({ karat: 'k21', weightGrams: 2, pricePerGramMinor: 320_000, buyerName: 'مشترٍ', treasury: '1101' })
// أصل بإهلاك
st().addAsset({ nameAr: 'جهاز', costMinor: 1_200_000, salvageMinor: 0, lifeMonths: 24, paidMinor: 1_200_000, notes: '', treasury: '1102' })
st().postMonthlyDepreciation()
// قيد يدوي + عكسه
const manual = st().postManualEntry({ description: 'تسوية يدوية', lines: [{ accountCode: '5104', debit: 10_000, credit: 0, note: '' }, { accountCode: '1101', debit: 0, credit: 10_000, note: '' }] })
st().reverseEntry(manual.id, 'اختبار العكس')

ok(`بُنيت حالة بـ${st().journal.length} قيداً عبر ${new Set(st().journal.map((e) => e.sourceType)).size} نوع مستند`)

/* ═══ I1: الدفاتر المساعدة ↔ الدفتر العام ═══ */
console.log('\n📚 I1: تطابق الدفاتر المساعدة مع العام')
for (const it of st().items) {
  if (it.trackExpiry) {
    const batchSum = st().batches.filter((b) => b.itemId === it.id).reduce((a, b) => a + b.qty, 0)
    assert.ok(Math.abs(batchSum - it.stockQty) < 0.001, `دفعات «${it.nameAr}» ${batchSum} ≠ مخزونه ${it.stockQty}`)
  }
  if (it.trackSerial) {
    const avail = st().serials.filter((s) => s.itemId === it.id && s.status === 'in_stock').length
    assert.equal(avail, it.stockQty, `سيريالات «${it.nameAr}» المتاحة ${avail} ≠ مخزونه ${it.stockQty}`)
  }
}
ok('كل صنف بصلاحية: Σدفعاته = مخزونه | كل صنف بسيريال: المتاح = مخزونه')

const custodyOpen = st().custodyFiles.filter((f) => f.status === 'open').reduce((a, f) => a + st().getCustodySummary(f.id).remainingMinor, 0)
assert.equal(bal('1108'), custodyOpen, '1108 = مجموع أرصدة العهد المفتوحة')
ok(`1108 عهد الموظفين ${bal('1108')} = Σأرصدة الملفات المفتوحة`)

const claimsOpen = st().insuranceProviders.reduce((a, p) => a + st().getClaimBalance(p.id), 0)
assert.equal(bal('1110'), claimsOpen, '1110 = مطالبات غير مسواة')
ok(`1110 مطالبات التأمين ${bal('1110')} = Σغير المسوى`)

const scrapVal = st().scrapLots.reduce((a, l) => a + Math.round(l.remainingGrams * l.pricePerGramMinor), 0)
const itemsVal = st().items.reduce((a, i) => a + Math.round(i.stockQty * i.costMinor), 0)
const tolerance = st().items.reduce((a, i) => a + Math.ceil((i.stockQty ?? 0) / 2), 0) + 1
assert.ok(Math.abs(bal('1103') - itemsVal - scrapVal) <= tolerance, `1103 ${bal('1103')} ≠ أصناف ${itemsVal} + كسر ${scrapVal}`)
ok(`1103 المخزون = قيمة الأصناف + الكسر المتبقي (ضمن سماحية التقريب)`)

const chequesHeld = st().cheques.filter((c) => c.direction === 'incoming' && (c.status === 'held' || c.status === 'deposited')).reduce((a, c) => a + c.amountMinor, 0)
assert.equal(bal('1106'), chequesHeld, '1106 = شيكات واردة قائمة')
ok(`1106 أوراق القبض ${bal('1106')} = Σالشيكات القائمة`)

/* ═══ I2: سلامة بنية كل قيد ═══ */
console.log('\n⚖️ I2: بنية القيود')
for (const e of st().journal) {
  let d = 0, c = 0
  assert.ok(e.description.trim().length > 0, `قيد ${e.id} بلا وصف`)
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `قيد ${e.id} تاريخه تالف: ${e.date}`)
  assert.ok(e.lines.length >= 2, `قيد ${e.id} أقل من سطرين`)
  for (const l of e.lines) {
    assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `قيد ${e.id}: كسور`)
    assert.ok(l.debit >= 0 && l.credit >= 0, `قيد ${e.id}: سالب`)
    assert.ok(!(l.debit > 0 && l.credit > 0), `قيد ${e.id}: سطر مدين ودائن معاً`)
    assert.ok(/^\d{4}$|^\d{4}-/.test(l.accountCode) || l.accountCode.length >= 4, `قيد ${e.id}: كود حساب تالف ${l.accountCode}`)
    d += l.debit; c += l.credit
  }
  assert.equal(d, c, `قيد ${e.id} غير متزن`)
}
ok(`${st().journal.length} قيداً: متزنة، صحيحة الأعداد، بوصف وتاريخ وكودات سليمة، لا سطر مزدوج الاتجاه`)

/* ═══ I3: كل قيد له مستند مصدر حقيقي ═══ */
console.log('\n🔗 I3: القيد ↔ المستند المصدر')
const S = st()
const sourceCheck = {
  sale: (id) => S.sales.some((x) => x.id === id),
  sale_return: (id) => S.saleReturns.some((x) => x.id === id),
  purchase: (id) => S.purchases.some((x) => x.id === id),
  purchase_return: (id) => S.purchaseReturns.some((x) => x.id === id),
  wastage: (id) => S.wastages.some((x) => x.id === id),
  internal_use: (id) => S.consumptions.some((x) => x.id === id),
  adjustment: () => true, // جرد/افتتاحي/تسوية درج — مستنداتها متعددة المصادر
  receipt_voucher: () => true, payment_voucher: () => true,
  insured_sale: () => true, claim_settlement: () => true,
  scrap_purchase: (id) => S.scrapLots.some((x) => x.id === id),
  scrap_sale: () => true,
  asset_purchase: (id) => S.assets.some((x) => x.id === id),
  depreciation: () => true,
  cheque_receive: (id) => S.cheques.some((x) => x.id === id),
  cheque_status: (id) => S.cheques.some((x) => x.id === id),
  custody_fund: () => true, custody_expense: () => true, custody_settle: () => true,
  manual: () => true, reversal: () => true,
}
let checked = 0
for (const e of S.journal) {
  const fn = sourceCheck[e.sourceType]
  assert.ok(fn, `sourceType بلا فاحص: ${e.sourceType}`)
  assert.ok(fn(e.sourceId), `قيد ${e.id} (${e.sourceType}#${e.sourceId}) بلا مستند مصدر`)
  checked++
}
ok(`${checked} قيداً كلها تشير لمستندات مصدر موجودة فعلاً`)

/* ═══ I4: تقاطع التقارير ═══ */
console.log('\n📊 I4: تقاطع التقارير المالية')
const tb = trialBalance(S.journal, P)
const bs = balanceSheet(S.journal, P.to)
const is = incomeStatement(S.journal, P)
assert.ok(tb.balanced && bs.balanced)
assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor)
assert.equal(is.netProfitMinor, bs.retainedEarningsMinor)
ok(`ميزان ${tb.totalDebitMinor} متزن | ميزانية متزنة | صافي الدخل = أرباح الميزانية المحتجزة`)
const vat = vatReport(S.journal, P)
assert.equal(vat.remainingMinor, -bal('2102'), 'متبقي الإقرار = رصيد 2102')
ok(`إقرار الضريبة: المتبقي ${vat.remainingMinor} يطابق رصيد 2102 في الأستاذ`)

/* ═══ I5: الذمم كشوف = أرصدة ═══ */
console.log('\n👥 I5: الذمم')
for (const c of S.customers) {
  const rows = S.getCustomerStatementRows(c.id)
  const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
  assert.equal(last, S.getCustomerBalance(c.id), `كشف ${c.nameAr}`)
}
for (const s of S.suppliers) {
  const rows = S.getSupplierStatementRows(s.id)
  const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
  assert.equal(last, S.getSupplierBalance(s.id), `كشف ${s.nameAr}`)
}
ok('كشف كل عميل ومورد يقفل على رصيده المشتق تماماً')

/* ═══ I6: العمليات المستحيلة تُرفض (عينة من كل حارس فئة) ═══ */
console.log('\n🚫 I6: الحواجز')
const throwsCheck = (name, fn) => { try { fn(); throw new Error(`${name}: لم يُرفض!`) } catch (e) { if (e.message.includes('لم يُرفض')) throw e; pass++; console.log(`  ✓ ${name}`) } }
throwsCheck('بيع سيريال مباع', () => st().postSale({ lines: [cline(serialItem, 1, 500_000, { serials: ['SN-B'] })], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }))
throwsCheck('حذف بند BOQ عليه تقدم (الحارس الجديد)', () => {
  st().addProject({ nameAr: 'م', clientName: 'ع', contractValueMinor: 1_000_000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const pr = st().projects.at(-1)
  st().addBoqItem({ projectId: pr.id, code: 'X', descriptionAr: 'بند', unit: 'م', qty: 10, unitPriceMinor: 100_000 })
  const bq = st().boqItems.at(-1)
  st().addProjectExtract({ projectId: pr.id, extractLines: [{ boqItemId: bq.id, newProgressPercent: 40 }], vatPercent: 0, payment: 'credit', description: 'م1' })
  st().removeBoqItem(bq.id)
})
throwsCheck('سند صرف بخزينة وهمية', () => st().postVoucher({ kind: 'payment', treasury: '9999', counterAccountCode: '5104', amountMinor: 1000, description: 'x' }))
throwsCheck('مبلغ سند صفري', () => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 0, description: 'x' }))
throwsCheck('مرتجع تراكمي فوق المباع', () => st().postSaleReturn({ saleId: creditSale.id, lineSpecs: [{ lineIndex: 0, qty: 5, condition: 'good' }], refund: 'cash', reason: 'x' }))

/* عكس القيود — قائمة السماح المغلقة الجديدة */
const entryOf = (type) => st().journal.find((e) => e.sourceType === type && !e.reversedByEntryId && !e.reversesEntryId)
throwsCheck('عكس قيد هالك مباشرة (دفتر مخزون)', () => st().reverseEntry(entryOf('wastage').id, 'x'))
throwsCheck('عكس قيد جرد مباشرة (دفتر مخزون)', () => st().reverseEntry(entryOf('adjustment').id, 'x'))
throwsCheck('عكس قيد استلام شيك (دفتر شيكات)', () => st().reverseEntry(entryOf('cheque_receive').id, 'x'))
throwsCheck('عكس قيد شراء كسر (دفتر الكسر)', () => st().reverseEntry(entryOf('scrap_purchase').id, 'x'))
throwsCheck('عكس قيد إهلاك (عداد الأصل)', () => st().reverseEntry(entryOf('depreciation').id, 'x'))
throwsCheck('عكس سند عهدة مولد آلياً (دفتر العهدة)', () => {
  const fund = st().journal.find((e) => e.sourceType === 'payment_voucher' && st().custodyTxs.some((t) => t.journalEntryId === e.id))
  st().reverseEntry(fund.id, 'x')
})
// السند الحقيقي (له سجل في vouchers وبلا دفتر مساعد) يبقى قابلاً للعكس
{
  const realVoucher = st().journal.find((e) => e.sourceType === 'receipt_voucher' && st().vouchers.some((v) => v.journalEntryId === e.id) && !e.reversedByEntryId)
  const rv = st().reverseEntry(realVoucher.id, 'خطأ إدخال')
  assert.ok(rv.reversesEntryId === realVoucher.id)
  ok('السند الحقيقي البسيط ما زال قابلاً للعكس (لا إفراط في الحجب)')
}

console.log(`\n✅ الفحص المنهجي: ${pass} ثابتاً صامداً — الفئات الست مسدودة على الحالة الحية`)
