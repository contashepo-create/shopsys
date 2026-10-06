/**
 * 📦 رحلة دورة حياة صنف كاملة (طلب المالك قبل دمج v1.0.17):
 * «افحص دورة الصنف من بداية الشراء حتى بيعها وتحويلها ومرتجعها».
 *
 * صنف واحد (سماعة بلوتوث) يدخل من الصفر ويمر بكل محطاته:
 *   شراء 100 (نصفها آجل) → تحويل 30 للفرع → بيع 20 من الفرع →
 *   مرتجع بيع 5 (نقدي) → مرتجع شراء 10 (على حساب المورد)
 * ثم التحقق الختامي من كل شيء دفعة واحدة:
 *   الكميات (الإجمالي وتوزيع المخازن) · التكلفة المرجحة · القيمة الدفترية=1103 ·
 *   ذمم المورد · ميزان المراجعة متوازن · قائمة الدخل (مجمل الربح=الوحدات الصافية×هامش الوحدة)
 *   وفحوص رفض: بيع فوق المخزون، مرتجع فوق المتبقي، مرتجع شراء فوق الموجود.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_item_lifecycle.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const { computeWarehouseStock, buildWarehouseDocs } = await import(pathToFileURL(join(root, 'src/core/transfers.ts')).href)
const { trialBalance, incomeStatement } = await import(pathToFileURL(join(root, 'src/core/financialReports.ts')).href)

const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const item = () => st().items.find((i) => i.sku === 'BTH-1')
const whStock = () => computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns, st().productionOrders, st().processingOrders))
const accBalance = (code, asOf = '2026-12-31') => {
  const tb = trialBalance(st().journal, { from: '2000-01-01', to: asOf })
  const row = tb.rows.find((r) => r.code === code)
  return row ? row.debitMinor - row.creditMinor : 0
}

console.log('📦 رحلة دورة حياة صنف كاملة: شراء → تحويل → بيع → مرتجعان')

console.log('\n═══ 0) التجهيز: مخزنان + مورد + عميل + صنف يبدأ من صفر ═══')
{
  useDataStore.setState({ warehouses: [
    { id: 1, nameAr: 'المخزن الرئيسي', isMain: true },
    { id: 2, nameAr: 'فرع مدينة نصر', isMain: false },
  ] })
  const [mainWh, branchWh] = st().warehouses
  st().addItem({
    nameAr: 'سماعة بلوتوث', sku: 'BTH-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 0, stockQty: 0, priceMinor: 35000, minQty: 0,
    trackExpiry: false, trackSerial: false, warrantyMonths: 6, soldByWeight: false,
    variantColors: [], variantSizes: [], isActive: true,
  })
  st().addSupplier({ nameAr: 'مورد الإلكترونيات', phone: '0100', address: '', notes: '', openingMinor: 0 })
  st().addCustomer({ nameAr: 'عميل الدورة', phone: '0111', address: '', notes: '', openingMinor: 0 })
  assert.equal(item().stockQty, 0, 'الصنف يبدأ من صفر — لا وجود قبل الشراء')
  assert.equal(accBalance('1103'), 0, 'لا مخزون دفترياً قبل الشراء')
  ok('مخزنان + مورد + عميل + سماعة بلوتوث (بلا رصيد) — الصفر المرجعي مثبت')
}

let purchase
console.log('\n═══ 1) الشراء: 100 وحدة × 200.00 — نصفها مدفوع والنصف آجل ═══')
{
  purchase = st().postPurchase({
    supplierId: st().suppliers[0].id, date: '2026-10-01',
    lines: [{ itemId: item().id, qty: 100, unitPriceMinor: 20000, warehouseId: 1 }],
    expenses: [], paidMinor: 1000000, treasury: '1101', notes: 'توريد أول دفعة',
  })
  assert.equal(item().stockQty, 100, 'المخزون الفعلي 100')
  assert.equal(item().costMinor, 20000, 'التكلفة المرجحة 200.00 للوحدة')
  assert.equal(accBalance('1103'), 2000000, 'قيمة المخزون الدفترية = 100×200 = 2,000,000 قرشاً')
  assert.equal(purchase.supplierDueMinor, 2000000, 'إجمالي دين الفاتورة 2,000,000 (قبل الدفع)')
  assert.equal(accBalance('2101'), -1000000, 'حساب المورد دائن بالمتبقي بعد الدفع: 1,000,000')
  ok('شراء 100: مخزون وتكلفة وقيد ودين المورد — كلها مطابقة')
}

console.log('\n═══ 2) التحويل: 30 وحدة من الرئيسي إلى الفرع ═══')
{
  st().postTransfer({ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: item().id, nameAr: item().nameAr, qty: 30 }], notes: 'تموين الفرع' })
  assert.equal(item().stockQty, 100, 'التحويل لا يغير الإجمالي')
  const ws = whStock()
  assert.equal(ws.get(1)?.get(item().id) ?? 0, 70, 'الرئيسي 70')
  assert.equal(ws.get(2)?.get(item().id) ?? 0, 30, 'الفرع 30')
  assert.equal(accBalance('1103'), 2000000, 'قيمة المخزون لم تتغير بالتحويل')
  ok('تحويل 30: 70/30 بين المخزنين والإجمالي والقيمة كما هما')
}

let sale
console.log('\n═══ 3) البيع: 20 وحدة من الفرع × 350.00 نقدياً (بلا ضريبة للوضوح) ═══')
{
  st().openShift('كاشير الدورة', 100000)
  sale = st().postSale({
    lines: [{ itemId: item().id, nameAr: item().nameAr, qty: 20, unitPriceMinor: 35000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', warehouseId: 2,
  })
  assert.equal(item().stockQty, 80, 'المخزون 80 بعد البيع')
  assert.equal(whStock().get(2)?.get(item().id) ?? 0, 10, 'الفرع خصم منه فقط: 30−20=10')
  assert.equal(accBalance('1103'), 1600000, 'قيمة المخزون 80×200=1,600,000')
  const inc = incomeStatement(st().journal, { from: '2026-10-01', to: '2026-12-31' })
  assert.equal(inc.totalRevenueMinor, 700000, 'الإيراد 20×350=700,000')
  assert.equal(inc.totalCostOfSalesMinor, 400000, 'تكلفة المبيعات 20×200=400,000')
  assert.equal(inc.grossProfitMinor, 300000, 'مجمل الربح 300,000')
  ok('بيع 20 من الفرع: مخزون وتكلفة وإيراد ومجمل ربح — كلها مطابقة')
}

console.log('\n═══ 4) مرتجع البيع: 5 وحدات سليمة تعود للمخزون — رد نقدي ═══')
{
  const ret = st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 5, condition: 'resellable' }],
    refund: 'cash', reason: 'العميل غيّر رأيه', reasonCode: 'other', treasury: '1101',
  })
  assert.equal(item().stockQty, 85, 'المخزون 80+5')
  assert.equal(whStock().get(2)?.get(item().id) ?? 0, 15, 'المرتجع عاد لمخزن البيع: 10+5=15')
  assert.equal(accBalance('1103'), 1700000, 'قيمة المخزون 85×200=1,700,000')
  const inc = incomeStatement(st().journal, { from: '2026-10-01', to: '2026-12-31' })
  assert.equal(inc.totalRevenueMinor, 700000 - 175000, 'الإيراد الصافي 700,000−175,000 (5×350)')
  assert.equal(inc.totalCostOfSalesMinor, 400000 - 100000, 'تكلفة صافية 400,000−100,000 (5×200)')
  assert.equal(inc.grossProfitMinor, 225000, 'مجمل الربح الصافي = 15 وحدة صافية × 150 هامش = 225,000')
  assert.ok(ret.id, 'مستند المرتجع أُنشئ')
  ok('مرتجع بيع 5: عادت للمخزون وقائمة الدخل صافية صحيحة')
}

console.log('\n═══ 5) مرتجع الشراء: 10 وحدات للمورد — تخفيض الدين ═══')
{
  st().postPurchaseReturn({
    purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 10, warehouseId: 1 }],
    refund: 'debt', reason: 'عيب مصنعية', approvedBy: 'المالك',
  })
  assert.equal(item().stockQty, 75, 'المخزون 85−10')
  assert.equal(whStock().get(1)?.get(item().id) ?? 0, 60, 'من مخزن الشراء الرئيسي: 70−10=60')
  assert.equal(accBalance('1103'), 1500000, 'قيمة المخزون 75×200=1,500,000')
  assert.equal(accBalance('2101'), -800000, 'دين المورد انخفض 10×200: 1,000,000→800,000')
  ok('مرتجع شراء 10: خرجت بالتكلفة ودين المورد انخفض بدقة')
}

console.log('\n═══ 6) المطابقة الختامية الشاملة ═══')
{
  // التوزيع النهائي: 60 رئيسي + 15 فرع = 75 إجمالي
  const ws = whStock()
  assert.equal((ws.get(1)?.get(item().id) ?? 0) + (ws.get(2)?.get(item().id) ?? 0), item().stockQty, 'مجموع المخازن = الإجمالي — لا كمية ضائعة')
  // ميزان المراجعة متوازن على كل الدفتر
  const tb = trialBalance(st().journal, { from: '2000-01-01', to: '2026-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'ميزان المراجعة متوازن')
  // قائمة الدخل النهائية
  const inc = incomeStatement(st().journal, { from: '2026-10-01', to: '2026-12-31' })
  assert.equal(inc.grossProfitMinor, 225000, 'مجمل الربح النهائي لم يتغير بمرتجع الشراء (لا يمس الدخل)')
  // كل قيود الدورة موجودة وموثقة المصدر (التحويل مستند مخازن بلا قيد —
  // نفس حساب المخزون للجهتين فلا أثر مالياً: تصميم سليم)
  const sources = new Set(st().journal.map((e) => e.sourceType))
  for (const src of ['purchase', 'sale', 'sale_return', 'purchase_return']) {
    assert.ok(sources.has(src), `قيد/مستند ${src} موجود بالدفتر`)
  }
  assert.ok(st().transfers.length >= 1, 'مستند التحويل مسجل بسجل المخازن')
  ok(`الختام: 60+15=75 وحدة · ميزان متوازن · مجمل ربح 2,250.00 · كل مستندات الدورة موثقة (${st().journal.length} قيداً + مستند تحويل)`)
}

console.log('\n═══ 7) حرس الحدود: الرفض الصحيح عند تجاوز الحدود ═══')
{
  assert.throws(() => st().postSale({
    lines: [{ itemId: item().id, nameAr: item().nameAr, qty: 76, unitPriceMinor: 35000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }), undefined, 'بيع 76 من أصل 75 مرفوض')
  assert.throws(() => st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 16, condition: 'resellable' }], refund: 'cash', reason: 'تجاوز', reasonCode: 'other' }), undefined, 'مرتجع يتجاوز المتبقي (15 من أصل 20) مرفوض')
  assert.throws(() => st().postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 91, warehouseId: 1 }], refund: 'debt', reason: 'تجاوز', approvedBy: 'المالك' }), undefined, 'مرتجع شراء يتجاوز المشترى المتبقي مرفوض')
  assert.equal(item().stockQty, 75, 'المخزون لم يتأثر بمحاولات الرفض')
  ok('ثلاث محاولات تجاوز رُفضت كلها والمخزون سليم بعدها')
}

console.log(`\n✅ رحلة دورة حياة صنف كاملة: 7 محطات — كلها خضراء — الشراء والتحويل والبيع والمرتجعان بلا قرش تائه ولا قطعة ضائعة`)
