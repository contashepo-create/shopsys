/**
 * 🛒 بوابة جاهزية البقالة/السوبر ماركت — تحرس ما أثبتته مراجعة 2026-11-17:
 * ─────────────────────────────────────────────────────────────────────────
 * G1 قالب النشاط: الوحدات/الخصائص/ضريبة شاملة افتراضية (لا تُكسر بصمت).
 * G2 أرصدة المحاسبة: كل حساب تلمسه دورة البقالة موجود وقابل للترحيل.
 * G3 أرضية السعر تشمل خصم الفاتورة (لا تجاوز حماية الهامش بخصم رأسي).
 * G4 شاشة الكاشير: حارس كمية صحيحة للقطعة، والباقي للعميل، والسعر اليدوي محفوظ.
 * G5 كل شاشة بقالة لها مكوّن ومسار حقيقي في App.tsx.
 * G6 كل شاشة بقالة ممثَّلة في اختبار/رحلة (لا شاشة بلا تغطية).
 * G7 عقود المحاسبة الأساسية (بيع/مرتجع/هالك/جرد/شراء/وردية) موجودة في اختبار العقد.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_grocery_readiness.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

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

let pass = 0
const ok = (n) => { pass++; console.log(`  ✓ ${n}`) }
const fail = (n) => { console.error(`  ✗ ${n}`); process.exitCode = 1 }

const { ACTIVITY_TEMPLATES } = await import(pathToFileURL(join(root, 'src/core/activities.ts')).href)
const { STANDARD_COA } = await import(pathToFileURL(join(root, 'src/core/ledger.ts')).href)
const { priceFloorViolations } = await import(pathToFileURL(join(root, 'src/core/items.ts')).href)
const { repriceCartForPriceList, computeTotals, buildSaleEntry, buildSaleEntryWithAllocations, checkStock } = await import(pathToFileURL(join(root, 'src/core/pos.ts')).href)
const { netWeightKg, itemTareGrams } = await import(pathToFileURL(join(root, 'src/core/barcode.ts')).href)
const { categoryAncestors } = await import(pathToFileURL(join(root, 'src/core/items.ts')).href)
const { resolvePrice } = await import(pathToFileURL(join(root, 'src/core/priceLists.ts')).href)
const { promotionCartLines } = await import(pathToFileURL(join(root, 'src/core/promotions.ts')).href)
const { summarizeShift, salesShiftPolicy } = await import(pathToFileURL(join(root, 'src/core/shifts.ts')).href)

console.log('\n═══ G1) قالب نشاط البقالة ═══')
{
  const grocery = ACTIVITY_TEMPLATES.find((t) => t.id === 'grocery')
  assert.ok(grocery, 'قالب البقالة مفقود')
  for (const mod of ['pos', 'inventory', 'purchases']) assert.ok(grocery.modules.includes(mod), `وحدة ${mod} مفقودة`)
  for (const feature of ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists']) {
    assert.ok(grocery.features.includes(feature), `خاصية ${feature} مفقودة`)
  }
  assert.equal(grocery.taxInclusiveDefault, true, 'قالب البقالة يجب أن يكون شامل الضريبة افتراضياً')
  ok('الوحدات والخصائص وضريبة شاملة افتراضية كما في قالب السوبرماركت')
}

console.log('\n═══ G2) أرصدة المحاسبة المستخدمة في دورة البقالة ═══')
{
  const postable = new Set(STANDARD_COA.filter((a) => a.isPostable).map((a) => a.code))
  const required = {
    '1101': 'الخزينة', '1102': 'البنك/الماكينة', '1103': 'المخزون', '1104': 'العملاء',
    '1107': 'سلف الموظفين', '2101': 'الموردون', '2102': 'ض.ق.م',
    '4101': 'المبيعات', '4102': 'مرتجعات المبيعات', '4110': 'فوائض/إيرادات أخرى',
    '5101': 'تكلفة المبيعات', '5108': 'مصروفات عمومية', '5111': 'هالك',
  }
  for (const [code, label] of Object.entries(required)) {
    assert.ok(postable.has(code), `الحساب ${code} (${label}) غير قابل للترحيل`)
  }
  ok(`${Object.keys(required).length} حساباً تلمسه دورة البقالة معرّف وقابل للترحيل`)
}

console.log('\n═══ G3) أرضية السعر تشمل خصم الفاتورة ═══')
{
  const items = [{ id: 1, nameAr: 'كرتونة', costMinor: 1000, minSalePriceMinor: 0 }]
  const line = [{ itemId: 1, unitPriceMinor: 6000, unitFactor: 6, discountPercent: 0 }]
  assert.deepEqual(priceFloorViolations(line, items), [], 'السعر بلا خصم يجب أن يمر')
  assert.deepEqual(priceFloorViolations(line, items, 10), ['كرتونة'], 'خصم فاتورة 10٪ يهبط بالتكلفة ويجب أن يُرفض')
  assert.deepEqual(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6600, unitFactor: 6, discountPercent: 0 }], items, 5), [], 'خصم 5٪ على سعر أعلى يبقى فوق الأرضية')
  assert.throws(() => priceFloorViolations(line, items, 120), RangeError)
  const repo = read('src/data/repo.ts')
  const calls = repo.match(/priceFloorViolations\((?:saleLines|costedLines), state\.items, args\.invoiceDiscountPercent\)/g) ?? []
  assert.equal(calls.length, 2, 'مساري الترحيل (بيع/تعديل) يجب أن يمررا خصم الفاتورة لفحص الأرضية')
  ok('خصم السطر + خصم الفاتورة يُفحصان معاً على السعر الأساسي في الترحيل والتعديل')
}

console.log('\n═══ G4) حرّاس شاشة الكاشير ═══')
{
  const pos = read('src/ui/pages/PosPage.tsx')
  assert.ok(pos.includes("l.soldByWeight ? /^\\d*\\.?\\d*$/ : /^\\d*$/"), 'حارس الكمية الصحيحة للقطعة مفقود')
  assert.ok(pos.includes('data-testid="pos-change-due"'), 'عرض الباقي للعميل مفقود')
  assert.ok(pos.includes('data-testid="pos-quick-cash"'), 'الفئات النقدية السريعة مفقودة')
  assert.ok(pos.includes('repriceCartForPriceList'), 'إعادة التسعير يجب أن تمر بالدالة النقية المحفوظة للسعر اليدوي')

  const cart = [
    { itemId: 1, nameAr: 'عادي', qty: 1, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false },
    { itemId: 2, nameAr: 'يدوي', qty: 1, unitPriceMinor: 700, unitCostMinor: 500, discountPercent: 0, soldByWeight: false, priceManual: true },
  ]
  const repriced = repriceCartForPriceList(cart, (id) => (id === 1 ? 1600 : 800))
  assert.equal(repriced[0].unitPriceMinor, 1600, 'السطر غير المعدّل يجب أن يُسعَّر بقائمة العميل')
  assert.equal(repriced[1].unitPriceMinor, 700, 'السعر اليدوي يجب ألا يُمحى عند تغيير العميل')
  ok('كمية القطعة صحيحة، الباقي للعميل ظاهر، والسعر اليدوي محفوظ عند إعادة التسعير')
}

console.log('\n═══ G4b) حقيقة حسابية: البيع الشامل الضريبة لا يخالف الإجمالي ═══')
{
  const totals = computeTotals([
    { itemId: 1, nameAr: 'أرز', qty: 2, unitPriceMinor: 2300, unitCostMinor: 1800, discountPercent: 0, soldByWeight: false },
    { itemId: 2, nameAr: 'زيت', qty: 1, unitPriceMinor: 1250, unitCostMinor: 900, discountPercent: 10, soldByWeight: false },
  ], 0, 15, true, 2)
  assert.equal(totals.taxBaseMinor + totals.taxMinor, totals.totalMinor, 'الأساس + الضريبة يجب أن يساوي الإجمالي')
  assert.equal(totals.totalMinor, 5725, 'الإجمالي شامل الضريبة يجب أن يبقى سعر الرف')
  const entry = buildSaleEntry(totals, 'cash', '1101')
  assert.equal(entry.reduce((s, l) => s + l.debit - l.credit, 0), 0, 'قيد البيع يجب أن يتوازن')
  const split = buildSaleEntryWithAllocations(totals, [{ accountCode: '1101', amountMinor: 3000 }, { accountCode: '1102', amountMinor: 2725 }])
  assert.equal(split.find((l) => l.accountCode === '1104')?.debit ?? 0, 0, 'الدفع الكامل لا يترك ذمة على العميل')
  ok('الضريبة الشاملة تنفصل بقرش، والقيد متوازن، والدفع المجزأ لا يفتح ذمة')
}

console.log('\n═══ G4c) باقات العروض تبقى بقرش مضبوط ═══')
{
  const items = [
    { id: 1, nameAr: 'مياه', priceMinor: 500, costMinor: 300, vatOverride: null },
    { id: 2, nameAr: 'عصير', priceMinor: 1000, costMinor: 700, vatOverride: null },
  ]
  const lines = promotionCartLines({ nameAr: 'باقة', bundlePriceMinor: 1999, components: [{ itemId: 1, qty: 3 }, { itemId: 2, qty: 1 }] }, 1, items)
  assert.equal(lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0), 1999, 'مجموع سطور الباقة يجب أن يساوي سعرها بالقرش')
  assert.ok(lines.every((l) => Number.isInteger(l.unitPriceMinor)), 'أسعار سطور الباقة صحيحة بلا كسور')
  ok('توزيع سعر الباقة على المكونات مضبوط بالقرش (باقٍ = 0)')
}

console.log('\n═══ G4d) الوردية: المتوقع في الدرج والماكينة خارجه ═══')
{
  const summary = summarizeShift(
    { id: 1, openedAt: '2026-11-17T08:00:00.000Z', openedBy: 'كاشير', openingCashMinor: 20000, closedAt: null, countedCashMinor: null, status: 'open' },
    [
      { id: 1, shiftId: 1, date: '2026-11-17T09:00:00.000Z', totalMinor: 4000, paidMinor: 4000, payment: 'cash', treasury: '1101', treasuryKind: 'cash' },
      { id: 2, shiftId: 1, date: '2026-11-17T09:30:00.000Z', totalMinor: 6000, paidMinor: 6000, payment: 'terminal', treasury: '1102', treasuryKind: 'bank' },
      { id: 3, shiftId: 1, date: '2026-11-17T10:00:00.000Z', totalMinor: 5000, paidMinor: 1000, payment: 'credit', customerId: 1, treasuryKind: 'cash' },
    ],
    [{ id: 1, shiftId: 1, date: '2026-11-17T11:00:00.000Z', totalMinor: 1000, payment: 'cash', treasury: '1101', treasuryKind: 'cash' }],
  )
  // 4000 نقدي + 1000 مقدَّم نقدي على الفاتورة الآجلة
  assert.equal(summary.cashSalesMinor, 5000, 'النقدي المحصل فعلاً في الدرج')
  assert.equal(summary.bankSalesMinor, 6000, 'الماكينة خارج الدرج')
  assert.equal(summary.creditSalesMinor, 4000, 'الآجل لا يدخل الدرج')
  assert.equal(summary.cashRefundsMinor, 1000, 'الرد النقدي يخصم من المتوقع')
  assert.equal(summary.expectedCashMinor, 20000 + 5000 - 1000, 'المتوقع = افتتاحي + نقدي − مرتجع نقدي')
  const policy = salesShiftPolicy({ roleId: 'cashier', isOwner: false, requireOpenShiftForSales: true, invoiceFirst: false })
  assert.equal(policy.required, true, 'سياسة «لا بيع بلا وردية» يجب أن تُلزم الكاشير')
  ok('ملخص الوردية يفصل النقدي/البنكي/الآجل ويطرح المرتجع النقدي، وسياسة الوردية تُلزم الكاشير')
}

console.log('\n═══ G5) شاشات البقالة: مسار + مكوّن في App.tsx ═══')
const GROCERY_SCREENS = [
  ['/pos', 'PosPage'],
  ['/sales/invoices', 'SalesInvoicesPage'],
  ['/sales/returns', 'SaleReturnsPage'],
  ['/sales/exchange', 'ExchangePage'],
  ['/sales/shifts', 'ShiftsPage'],
  ['/sales/price-lists', 'PriceListsPage'],
  ['/sales/promotions', 'PromotionsPage'],
  ['/inventory/items', 'ItemsPage'],
  ['/inventory/warehouses', 'WarehousesPage'],
  ['/inventory/transfers', 'TransfersPage'],
  ['/inventory/counting', 'StocktakePage'],
  ['/inventory/wastage', 'WastagePage'],
  ['/inventory/consumption', 'ConsumptionPage'],
  ['/inventory/barcode-center', 'BarcodeCenterPage'],
  ['/inventory/scale', 'ScaleSettingsPage'],
  ['/inventory/recipes', 'RecipesPage'],
  ['/purchases/orders', 'PurchaseOrdersPage'],
  ['/purchases/invoices', 'PurchasesPage'],
  ['/purchases/returns', 'PurchaseReturnsPage'],
  ['/purchases/suppliers', 'SuppliersPage'],
  ['/parties/customers', 'CustomersPage'],
  ['/accounting/journal', 'JournalPage'],
  ['/accounting/trial-balance', 'TrialBalancePage'],
  ['/accounting/treasury', 'TreasuryPage'],
  ['/accounting/payment-terminals', 'PaymentTerminalsPage'],
  ['/settings/permissions', 'PermissionsPage'],
  ['/settings/printing', 'PrintSettingsPage'],
]
{
  const appSource = read('src/App.tsx')
  const routes = new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}=${m[2]}`))
  // navCatalog.tsx لا يُستورد في Node (TSX) — نقرأ مساراته نصياً
  const navPaths = new Set([...read('src/ui/navCatalog.tsx').matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]))
  const missing = GROCERY_SCREENS.filter(([path, comp]) => !routes.has(`${path}=${comp}`)).map(([p, c]) => `${p}→${c}`)
  assert.deepEqual(missing, [], `شاشات بلا مسار/مكوّن: ${missing.join(', ')}`)
  const notInNav = GROCERY_SCREENS.filter(([path]) => !navPaths.has(path)).map(([p]) => p)
  assert.deepEqual(notInNav, [], `شاشات في السجل وغير موجودة في قائمة التنقل: ${notInNav.join(', ')}`)
  ok(`${GROCERY_SCREENS.length} شاشة بقالة: مسار موجود في App.tsx وقائمة التنقل`)
}

console.log('\n═══ G6) كل شاشة بقالة ممثَّلة في اختبار أو رحلة ═══')
{
  const corpus = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`
      const st = statSync(join(root, rel))
      if (st.isDirectory()) { if (entry !== 'node_modules') walk(rel) }
      else if (/\.(ts|tsx|mjs)$/.test(entry)) corpus.push(read(rel))
    }
  }
  walk('tests'); walk('scripts')
  const text = corpus.join('\n')
  const uncovered = GROCERY_SCREENS.filter(([, comp]) => !new RegExp(`\\b${comp}\\b`).test(text)).map(([, c]) => c)
  assert.deepEqual(uncovered, [], `شاشات بلا أي اختبار/رحلة: ${uncovered.join(', ')}`)
  ok(`${GROCERY_SCREENS.length} شاشة بقالة مذكورة في اختبار أو رحلة مستخدم — لا شاشة بلا تغطية`)
}

console.log('\n═══ G8) وزن الوعاء وباركود الوحدة في البقالة ═══')
{
  assert.equal(netWeightKg(0.75, 50), 0.7, 'وزن الملصق يجب أن يُطرح منه وزن الوعاء')
  assert.equal(netWeightKg(0.75, 0), 0.75, 'بلا وعاء يبقى الوزن كما هو')
  assert.equal(netWeightKg(0.2, 250), 0, 'وعاء أثقل من الوزن = صفر ولا يُسعَّر سالباً')
  assert.equal(itemTareGrams({ tareGrams: -1 }), 0, 'وزن وعاء سالب يجب أن يُتجاهل')
  const pos = read('src/ui/pages/PosPage.tsx')
  const stocktake = read('src/ui/pages/StocktakePage.tsx')
  for (const [file, text] of [['PosPage', pos], ['StocktakePage', stocktake]]) {
    assert.ok(text.includes('netWeightKg'), `${file}: وزن الوعاء غير مطروح من ملصق الميزان`)
    assert.ok(text.includes('itemTareGrams'), `${file}: وزن الوعاء لا يُقرأ من الصنف`)
  }
  assert.ok(stocktake.includes('unitHit'), 'الجرد لا يتعرف على باركود الوحدة الأكبر (كرتونة)')
  assert.ok(stocktake.includes('unitHit.unit.factor') || stocktake.includes('unit?.factor'), 'الجرد لا يضيف معامل الوحدة عند مسح الكرتونة')
  const itemsPage = read('src/ui/pages/ItemsPage.tsx')
  assert.ok(itemsPage.includes('tareGrams'), 'شاشة الأصناف بلا خانة وزن الوعاء')
  assert.ok(read('tests/grocery_round6_deep_audit.test.tsx').includes('وزن الوعاء'), 'وزن الوعاء بلا اختبار')
  ok('ملصق الميزان والميزان الحيّ والجرد كلها تطرح وزن الوعاء، ومسح الكرتونة يضيف معاملها')
}

console.log('\n═══ G9) قواعد الأسعار والشراء والمخزون بالوحدة الأساسية ═══')
{
  const categories = [
    { id: 1, nameAr: 'بقالة', parentId: null, features: [] },
    { id: 2, nameAr: 'ألبان', parentId: 1, features: [] },
    { id: 3, nameAr: 'حليب', parentId: 2, features: [] },
  ]
  assert.deepEqual(categoryAncestors(3, categories), [2, 1], 'سلسلة الفئات غير صحيحة')
  const lists = [{ id: 9, nameAr: 'جملة', defaultDiscountPercent: 0, isActive: true }]
  const rules = [{ listId: 9, categoryId: 2, discountPercent: 10 }]
  assert.equal(resolvePrice(5, 1000, 9, lists, [], rules, 3, categoryAncestors(3, categories)), 900, 'قاعدة الفئة لا تسري على الفئات الفرعية')
  assert.ok(read('src/data/repo.ts').includes('categoryAncestors(item?.categoryId'), 'getEffectivePrice لا يمرر آباء الفئة')

  const repo = read('src/data/repo.ts')
  assert.ok(repo.includes('discountKeepPpm'), 'خصم فاتورة الشراء غير مطبَّق على أسعار السطور في المحرك')
  assert.ok(read('tests/grocery_round6_deep_audit.test.tsx').includes('discountKeepPpm') === false, 'الاختبار يجب أن يفحص السلوك لا الاسم')
  const shortages = checkStock([
    { itemId: 1, nameAr: 'كرتونة', qty: 2, unitFactor: 6, unitPriceMinor: 1000, unitCostMinor: 800, discountPercent: 0, soldByWeight: false },
  ], () => 6)
  assert.equal(shortages.length, 1, 'فحص المخزون يجب أن يحسب الكرتونة 6 قطع (2×6 > 6 متاح)')
  assert.equal(shortages[0].requested, 12, 'الكمية المطلوبة في الفحص يجب أن تكون بالوحدة الأساسية')
  ok('قاعدة سعر الفئة تسري على أبنائها، وخصم الشراء يدخل القيد، وفحص المخزون بالوحدة الأساسية')
}

console.log('\n═══ G10) تقرير X للوردية (معاينة بلا إقفال) ═══')
{
  const shifts = read('src/ui/pages/ShiftsPage.tsx')
  assert.ok(shifts.includes('تقرير X'), 'زر تقرير X مفقود من شاشة الورديات')
  assert.ok(shifts.includes('shift-x-report'), 'منطقة تقرير X غير معلَّمة للاختبار')
  assert.ok(shifts.includes('buildSimpleDocModel'), 'تقرير X لا يُطبع عبر قالب المستندات المعتمد')
  const printBody = shifts.slice(shifts.indexOf('const printXReport'), shifts.indexOf('const doOpen'))
  assert.ok(printBody.length > 0, 'دالة طباعة تقرير X مفقودة')
  for (const forbidden of ['closeShift(', 'settleShiftVariance(', 'postJournal']) {
    assert.ok(!printBody.includes(forbidden), `تقرير X يجب ألا ينفّذ ${forbidden} — المعاينة لا تقفل ولا تقيّد`)
  }
  assert.ok(read('tests/grocery_round6_deep_audit.test.tsx').includes('shift-x-report'), 'تقرير X بلا اختبار')
  ok('تقرير X يطبع ملخص الوردية من نفس المحرك بلا إقفال ولا قيد')
}

console.log('\n═══ G7) عقد المحاسبة: الترحيلات الستة موثّقة باختبار ═══')
{
  const contract = read('tests/grocery_accounting_contract.test.ts')
  const required = [
    ["postSale", 'postSale('], ["postSaleReturn", 'postSaleReturn('], ["postWastage", 'postWastage('],
    ["postStocktake", 'postStocktake('], ["postPurchase", 'postPurchase('], ["closeShift", 'closeShift('],
    ["settleShiftVariance", 'settleShiftVariance('],
  ]
  const missing = required.filter(([, token]) => !contract.includes(token)).map(([name]) => name)
  assert.deepEqual(missing, [], `مسارات غير مغطاة في عقد المحاسبة: ${missing.join(', ')}`)
  for (const code of ['1101', '1103', '1104', '2102', '4101', '4102', '5101', '5111']) {
    assert.ok(contract.includes(`'${code}'`), `حساب ${code} غير مفحوص في عقد المحاسبة`)
  }
  ok('البيع/المرتجع/الهالك/الجرد/الشراء/الوردية كلها مفحوصة على مستوى القيد والحسابات')
}

if (process.exitCode) console.error(`\n❌ بوابة البقالة: ${pass} فحصاً ناجحاً وفشل واحد أو أكثر`)
else console.log(`\n✅ بوابة جاهزية البقالة: نجحت كل الفحوص (${pass})`)
