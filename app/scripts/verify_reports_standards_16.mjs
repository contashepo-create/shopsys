/**
 * مطابقة القوائم المالية للمعايير العالمية (طلب المالك — المقارنة بالبرامج العالمية وسد الفجوات):
 * المرجعية: QuickBooks/Xero (عرض القوائم) + IAS 1 (تبويب الميزانية) + IAS 7 (التدفق النقدي):
 *
 * م1) قائمة الدخل متعددة المراحل: إيرادات → تكاليف مباشرة → «مجمل الربح» →
 *     مصروفات تشغيلية → صافي الربح — والمجاميع تتطابق بالقرش
 *     (costOfSales ∪ operatingExpenses = expenses بلا تقاطع)
 * م2) الميزانية مبوبة (IAS 1): أصول متداولة/غير متداولة — الأصل الثابت ومجمع
 *     الإهلاك في غير المتداولة، والخزائن والمخزون والذمم في المتداولة،
 *     ومجموع القسمين = إجمالي الأصول
 * م3) التدفق النقدي مصنف (IAS 7 — طريقة مباشرة): تشغيلي/استثماري/تمويلي —
 *     شراء الأصل استثماري خارج، رأس المال تمويلي داخل، الدورة التجارية تشغيلية،
 *     ومجموع الأنشطة الثلاثة = صافي التغير بالقرش
 * م4) الإهلاك قيد غير نقدي: لا يلمس التدفق النقدي ويخفض الأصول غير المتداولة
 *     (مجمع الإهلاك) ويدخل قائمة الدخل مصروفاً تشغيلياً
 * م5) الاتساق بين القوائم (المعيار الأهم): صافي ربح قائمة الدخل = الأرباح
 *     المرحلة بالميزانية، والنقدية الختامية بالتدفق = بند النقدية بالميزانية
 * م6) هوامش الربح: هامش مجمل وهامش صافٍ قابلان للاشتقاق (إيراد > 0)
 *
 * على كل نشاط من الأنشطة الـ16.
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

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { trialBalance, incomeStatement, balanceSheet, cashFlowReport } = await import(join(root, 'src/core/financialReports.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 16)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const ALL = { from: '0000-01-01', to: '9999-12-31' }

let pass = 0
for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 14, taxInclusive: false, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?repstd=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  st().seed([])
  // تمويلي: رأس مال 100000 | استثماري: أصل نقدي 12000 | تشغيلي: شراء 500 نقدي + بيع 500 + إيجار 50
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 10000000, label: 'خزينة' })
  st().addAsset({ nameAr: `أصل ${nameAr}`, costMinor: 1200000, salvageMinor: 0, lifeMonths: 24, paidMinor: 1200000, notes: '', funding: 'cash', treasury: '1101' })
  st().addItem({ nameAr: `صنف ${nameAr}`, barcode: '', categoryId: null, unit: 'قطعة', priceMinor: 10000, costMinor: 0, stockQty: 0, minQty: 0, expiryTracking: false })
  const item = st().items.at(-1)
  st().addSupplier({ nameAr: 'مورد المعايير', phone: '', notes: '' })
  const sup = st().suppliers.at(-1)
  st().postPurchase({ supplierId: sup.id, date: '2026-01-05', payMode: 'cash', treasury: '1101', paidMinor: 50000, lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 5000 }], expenses: [], notes: '' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 5, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: 5000, description: 'إيجار الشهر' })

  /* م1) قائمة الدخل متعددة المراحل */
  const inc = incomeStatement(st().journal, ALL)
  assert.equal(inc.totalRevenueMinor, 50000, `${activityId}: م1 الإيراد`)
  assert.equal(inc.totalCostOfSalesMinor, 25000, `${activityId}: م1 التكلفة المباشرة`)
  assert.equal(inc.grossProfitMinor, 25000, `${activityId}: م1 مجمل الربح = إيراد − تكلفة`)
  assert.equal(inc.totalOperatingExpenseMinor, 5000, `${activityId}: م1 التشغيلية (الإيجار)`)
  assert.equal(inc.netProfitMinor, 20000, `${activityId}: م1 الصافي = مجمل − تشغيلية`)
  assert.equal(inc.totalExpenseMinor, inc.totalCostOfSalesMinor + inc.totalOperatingExpenseMinor, `${activityId}: م1 لا تقاطع ولا فاقد`)
  assert.equal(inc.expenses.length, inc.costOfSales.length + inc.operatingExpenses.length, `${activityId}: م1 كل بند في قسم واحد`)

  /* م2) الميزانية المبوبة IAS 1 */
  const bs = balanceSheet(st().journal, '9999-12-31')
  assert.ok(bs.balanced, `${activityId}: م2 موزونة`)
  assert.ok(bs.nonCurrentAssets.some((r) => r.code === '1201'), `${activityId}: م2 الأصل الثابت غير متداول`)
  assert.equal(bs.totalNonCurrentAssetsMinor, 1200000, `${activityId}: م2 غير المتداولة بالقرش`)
  assert.ok(bs.currentAssets.every((r) => !r.code.startsWith('12')), `${activityId}: م2 لا تسرب للمتداولة`)
  assert.equal(bs.totalCurrentAssetsMinor + bs.totalNonCurrentAssetsMinor, bs.totalAssetsMinor, `${activityId}: م2 مجموع القسمين = الإجمالي`)

  /* م3) التدفق النقدي IAS 7 */
  const cashCodes = st().treasuries.map((t) => t.code)
  const cf = cashFlowReport(st().journal, cashCodes, ALL)
  assert.equal(cf.investingNetMinor, -1200000, `${activityId}: م3 شراء الأصل استثماري خارج`)
  assert.equal(cf.financingNetMinor, 10000000, `${activityId}: م3 رأس المال تمويلي داخل`)
  assert.equal(cf.operatingNetMinor, -5000, `${activityId}: م3 التشغيلي (بيع 500 − شراء 500 − إيجار 50)`)
  assert.equal(cf.operatingNetMinor + cf.investingNetMinor + cf.financingNetMinor, cf.netChangeMinor, `${activityId}: م3 مجموع الأنشطة = صافي التغير`)
  assert.equal(cf.closingCashMinor, cashCodes.reduce((s, c) => s + bal(c), 0), `${activityId}: م3 الختامي = الفعلي`)
  assert.ok(cf.inflows.every((r) => ['operating', 'investing', 'financing'].includes(r.activity)), `${activityId}: م3 كل صف مصنف`)

  /* م4) الإهلاك غير نقدي */
  st().postMonthlyDepreciation()
  const cf2 = cashFlowReport(st().journal, cashCodes, ALL)
  assert.equal(cf2.netChangeMinor, cf.netChangeMinor, `${activityId}: م4 الإهلاك لا يلمس النقدية`)
  const bs2 = balanceSheet(st().journal, '9999-12-31')
  assert.equal(bs2.totalNonCurrentAssetsMinor, 1200000 - 50000, `${activityId}: م4 مجمع الإهلاك يخفض غير المتداولة`)
  const inc2 = incomeStatement(st().journal, ALL)
  assert.ok(inc2.operatingExpenses.some((r) => r.code === '5107'), `${activityId}: م4 الإهلاك مصروف تشغيلي لا تكلفة مباشرة`)
  assert.equal(inc2.grossProfitMinor, inc.grossProfitMinor, `${activityId}: م4 مجمل الربح لا يتأثر بالإهلاك`)

  /* م5) الاتساق بين القوائم الثلاث */
  assert.equal(bs2.retainedEarningsMinor, inc2.netProfitMinor, `${activityId}: م5 صافي الدخل = أرباح الميزانية`)
  const bsCash = bs2.currentAssets.filter((r) => cashCodes.includes(r.code)).reduce((a, r) => a + r.amountMinor, 0)
  assert.equal(cf2.closingCashMinor, bsCash, `${activityId}: م5 نقدية التدفق = نقدية الميزانية`)
  assert.ok(trialBalance(st().journal, ALL).balanced, `${activityId}: م5 الميزان متوازن ختامياً`)

  /* م6) الهوامش قابلة للاشتقاق */
  const grossMargin = Math.round((inc2.grossProfitMinor / inc2.totalRevenueMinor) * 1000) / 10
  const netMargin = Math.round((inc2.netProfitMinor / inc2.totalRevenueMinor) * 1000) / 10
  assert.equal(grossMargin, 50, `${activityId}: م6 هامش مجمل 50%`)
  // الإهلاك الشهري 500 > ربح الدورة 200 ⇒ صافي −300 وهامش −60% — الهامش يعمل بالسالب أيضاً
  assert.equal(inc2.netProfitMinor, 20000 - 50000, `${activityId}: م6 الصافي بعد الإهلاك`)
  assert.equal(netMargin, -60, `${activityId}: م6 هامش صافٍ سالب محسوب صحيحاً`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): 6 معايير (مجمل الربح + IAS 1 + IAS 7 + إهلاك غير نقدي + اتساق القوائم + الهوامش)`)
}

assert.equal(pass, 16)
console.log(`\n✅ verify_reports_standards_16: القوائم المالية مطابقة للمعايير العالمية على الأنشطة الـ16`)
