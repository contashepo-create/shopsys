/**
 * المراجعة الفردية الشاملة لقسم التقارير (طلب المالك — كل قسم كبناء أول مرة):
 * كل تقرير يُفحص بأرقام حقيقية من دورة عمليات كاملة على كل نشاط من الـ16:
 * شراء بضريبة مدخلات → مرتجع شراء جزئي → بيع بضريبة مخرجات → مرتجع بيع جزئي
 * → سداد ضريبة جزئي → تحويل بين خزينتين برسوم — ثم تُطابَق كل التقارير بالقرش:
 *
 * ت1) ميزان المراجعة: متوازن + إجمالي مدينه = إجمالي دائنه = مجموع أسطر الفترة
 * ت2) قائمة الدخل: صافي الربح = (بيع صافٍ − مرتجعه) − (تكلفة − مرتجعها) − الرسوم
 * ت3) المركز المالي: أصول = التزامات + حقوق + أرباح مرحلة (متوازن حتى تاريخه)
 * ت4) دفتر الأستاذ: الافتتاحي + الحركات = الختامي = الرصيد الفعلي (1101 و2101 و2102)
 * ت5) التدفق النقدي: الختامي = Σ أرصدة الخزائن فعلاً + التحويل الداخلي مُصفّى
 *     (لا يظهر كدخل/خرج — رسومه فقط خارجة)
 * ت6) تقرير الضريبة (إصلاح المراجعة): التصنيف بمصدر القيد لا اتجاه السطر —
 *     مرتجع الشراء يخفض المدخلات (لا يضخم المخرجات)، مرتجع البيع يخفض المخرجات،
 *     وسداد المصلحة معزول في «المسدد/المتبقي» ولا يلوث الإقرار
 * ت7) أفضل الأصناف (إصلاح المراجعة): الإيراد صافٍ بلا ضريبة وبعد خصم الفاتورة —
 *     Σ إيرادات الأصناف = صافي الملخص، وΣ أرباحها = صافي ربح الملخص بالقرش
 * ت8) ملخص المبيعات: نقدي/آجل بالدفع المجزأ + أثر المرتجعات
 * ت9) تقرير المصروفات: صافي 5101 = التكلفة − مرتجعها + النسب تُجمع إلى 100%
 * ت10) خصم فاتورة إجمالي: topItems يوزعه نسبياً ويظل متسقاً مع الملخص
 * ت11) قيود الإقفال السنوي (نواة خالصة): قائمة الدخل تستثنيها والميزانية تطرح
 *      المُقفل من نتيجة الفترة فلا يتضاعف — وتظل موزونة قبل وبعد
 * ت12) CSV: BOM + تهريب فواصل/اقتباسات
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
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { trialBalance, incomeStatement, balanceSheet, generalLedger, cashFlowReport, vatReport, toCsv } = await import(join(root, 'src/core/financialReports.ts'))
const { salesSummary, topItems, dailySales } = await import(join(root, 'src/core/reports.ts'))
const { expensesSummary } = await import(join(root, 'src/core/expenseReports.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 18)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const ALL = { from: '0000-01-01', to: '9999-12-31' }

/* ═══ ت11) الإقفال السنوي — نواة خالصة بدفتر مُنشأ ═══ */
{
  const J = [
    { id: 1, entryNumber: 1, date: '2025-03-01', description: 'بيع', sourceType: 'sale', sourceId: 1, lines: [
      { accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1000 },
      { accountCode: '5101', debit: 600, credit: 0 }, { accountCode: '1103', debit: 0, credit: 600 },
    ] },
    { id: 2, entryNumber: 2, date: '2025-12-31', description: 'إقفال 2025', sourceType: 'year_closing', sourceId: 1, lines: [
      { accountCode: '4101', debit: 1000, credit: 0 }, { accountCode: '5101', debit: 0, credit: 600 },
      { accountCode: '3102', debit: 0, credit: 400 },
    ] },
    { id: 3, entryNumber: 3, date: '2026-02-01', description: 'بيع جديد', sourceType: 'sale', sourceId: 2, lines: [
      { accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '4101', debit: 0, credit: 500 },
    ] },
  ]
  const inc25 = incomeStatement(J, { from: '2025-01-01', to: '2025-12-31' })
  assert.equal(inc25.netProfitMinor, 400, 'ت11: قائمة الدخل 2025 تستثني قيد الإقفال وتعرض الأداء الحقيقي')
  const bs25 = balanceSheet(J, '2025-12-31')
  assert.ok(bs25.balanced, 'ت11: ميزانية نهاية 2025 موزونة بعد الإقفال')
  assert.equal(bs25.retainedEarningsMinor, 0, 'ت11: المُقفل في 3102 لا يتضاعف في نتيجة الفترة')
  assert.equal(bs25.equity.find((r) => r.code === '3102')?.amountMinor, 400, 'ت11: الأرباح المرحلة في بندها')
  const bs26 = balanceSheet(J, '2026-12-31')
  assert.ok(bs26.balanced, 'ت11: ميزانية 2026 موزونة')
  assert.equal(bs26.retainedEarningsMinor, 500, 'ت11: نتيجة 2026 الجارية فقط')
  // vatReport لا يتأثر بقيود الإقفال (لا تلمس 2102 أصلاً — وإن لمست تُعزل كتسوية)
  const v = vatReport(J, ALL)
  assert.equal(v.outputVatMinor + v.inputVatMinor + v.settledMinor, 0, 'ت11: الإقفال لا يلوث الضريبة')
}

/* ═══ ت12) CSV ═══ */
{
  const csv = toCsv(['اسم', 'قيمة'], [['بند "خاص", فاصلة', 100]])
  assert.ok(csv.startsWith('\uFEFF'), 'ت12: BOM')
  assert.ok(csv.includes('"بند ""خاص"", فاصلة"'), 'ت12: تهريب')
}

let pass = 0
for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 14, taxInclusive: false, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?repreview=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 10000000, label: 'خزينة' })
  st().addItem({ nameAr: `صنف ${nameAr}`, barcode: '', categoryId: null, unit: 'قطعة', priceMinor: 10000, costMinor: 0, stockQty: 0, minQty: 0, expiryTracking: false })
  const item = st().items.at(-1)
  st().addSupplier({ nameAr: 'مورد التقارير', phone: '', notes: '' })
  const sup = st().suppliers.at(-1)

  // الدورة: شراء بمدخلات 7000 → مرتجع 4/10 → بيع بمخرجات 7000 → مرتجع 2/5 → سداد 1000 → تحويل برسوم
  const pur = st().postPurchase({ supplierId: sup.id, date: '2026-01-05', payMode: 'cash', treasury: '1101', paidMinor: 57000, inputVatMinor: 7000, lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 5000 }], expenses: [], notes: '' })
  st().postPurchaseReturn({ purchaseId: pur.id, qtyByItem: new Map([[item.id, 4]]), refundMode: 'cash', treasury: '1101' })
  const sale = st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 5, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101' })
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'مراجعة التقارير', reasonCode: 'other' })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2102', amountMinor: 1000, description: 'سداد ض.ق.م جزئي' })
  st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 100000, description: 'إيداع بنكي', feeMinor: 500 })

  for (const e of st().journal) assertBalanced(e.lines)

  /* ت1) ميزان المراجعة */
  const tb = trialBalance(st().journal, ALL)
  assert.ok(tb.balanced, `${activityId}: ت1 متوازن`)
  const sumDebits = st().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit, 0)
  assert.equal(tb.totalDebitMinor, sumDebits, `${activityId}: ت1 إجمالي المدين = مجموع الأسطر`)
  assert.equal(tb.totalCreditMinor, sumDebits, `${activityId}: ت1 الدائن كذلك`)

  /* ت2) قائمة الدخل: إيراد صافٍ 30000، تكلفة صافية 15000، رسوم 500 */
  const inc = incomeStatement(st().journal, ALL)
  assert.equal(inc.totalRevenueMinor, 30000, `${activityId}: ت2 الإيراد الصافي`)
  assert.equal(inc.totalExpenseMinor, 15500, `${activityId}: ت2 تكلفة 15000 + رسوم 500`)
  assert.equal(inc.netProfitMinor, 14500, `${activityId}: ت2 صافي الربح`)

  /* ت3) المركز المالي */
  const bs = balanceSheet(st().journal, '9999-12-31')
  assert.ok(bs.balanced, `${activityId}: ت3 موزون`)
  assert.equal(bs.retainedEarningsMinor, 14500, `${activityId}: ت3 نتيجة النشاط`)

  /* ت4) دفتر الأستاذ = الرصيد الفعلي لثلاثة حسابات بطبائع مختلفة */
  for (const code of ['1101', '2101', '2102']) {
    const gl = generalLedger(st().journal, code, ALL)
    const actual = bal(code)
    const natural = code.startsWith('1') ? actual : -actual
    assert.equal(gl.closingMinor, natural, `${activityId}: ت4 ختامي ${code}`)
    const moves = gl.rows.reduce((a, r) => a + (code.startsWith('1') ? r.debitMinor - r.creditMinor : r.creditMinor - r.debitMinor), 0)
    assert.equal(gl.openingMinor + moves, gl.closingMinor, `${activityId}: ت4 افتتاحي+حركات=ختامي ${code}`)
    if (gl.rows.length) assert.equal(gl.rows.at(-1).balanceMinor, gl.closingMinor, `${activityId}: ت4 الرصيد الجاري ينتهي بالختامي ${code}`)
  }

  /* ت5) التدفق النقدي */
  const cashCodes = st().treasuries.map((t) => t.code)
  const cf = cashFlowReport(st().journal, cashCodes, ALL)
  const actualCash = cashCodes.reduce((s, c) => s + bal(c), 0)
  assert.equal(cf.closingCashMinor, actualCash, `${activityId}: ت5 الختامي = الفعلي`)
  assert.ok(!cf.inflows.some((r) => r.label.includes('بنك') && r.amountMinor === 100000), `${activityId}: ت5 التحويل الداخلي مُصفّى`)
  assert.ok(!cf.outflows.some((r) => r.amountMinor === 100000), `${activityId}: ت5 لا خرج وهمي بقيمة التحويل`)

  /* ت6) الضريبة بالقرش */
  const v = vatReport(st().journal, ALL)
  assert.equal(v.inputVatMinor, 4200, `${activityId}: ت6 مدخلات صافية 7000−2800`)
  assert.equal(v.outputVatMinor, 4200, `${activityId}: ت6 مخرجات صافية 7000−2800`)
  assert.equal(v.netDueMinor, 0, `${activityId}: ت6 الإقرار صفر`)
  assert.equal(v.settledMinor, 1000, `${activityId}: ت6 المسدد معزول`)
  assert.equal(v.remainingMinor, -1000, `${activityId}: ت6 المتبقي = الإقرار − المسدد`)

  /* ت7+ت8) topItems يتسق مع الملخص وقائمة الدخل */
  const today = new Date().toISOString().slice(0, 10)
  const P = { from: today, to: today }
  const sum = salesSummary(st().sales, st().saleReturns, P)
  const top = topItems(st().sales, st().saleReturns, P, 10)
  const returnsTax = st().saleReturns.reduce((a, r) => a + r.totals.taxMinor, 0)
  const netNoTax = (sum.totalMinor - sum.taxMinor) - (sum.returnsMinor - returnsTax)
  assert.equal(top.reduce((a, r) => a + r.revenueMinor, 0), netNoTax, `${activityId}: ت7 Σ إيرادات الأصناف = صافي الملخص بلا ضريبة`)
  assert.equal(top.reduce((a, r) => a + r.profitMinor, 0), sum.netProfitMinor, `${activityId}: ت7 Σ أرباح الأصناف = صافي ربح الملخص`)
  assert.equal(netNoTax, 30000, `${activityId}: ت7 ويطابق إيراد قائمة الدخل`)
  assert.equal(sum.cashMinor, sum.totalMinor, `${activityId}: ت8 بيع نقدي كامل`)
  assert.equal(sum.creditMinor, 0, `${activityId}: ت8 لا آجل`)
  assert.ok(dailySales(st().sales, P).length === 1, `${activityId}: ت8 يوم بيع واحد`)

  /* ت9) المصروفات: صافي 5101 = 15000 والنسب تُجمع 100% */
  const exp = expensesSummary(st().journal, {}, (c) => c, new Set())
  const cogsRow = exp.rows.find((r) => r.accountCode === '5101')
  assert.equal(cogsRow?.totalMinor, 15000, `${activityId}: ت9 تكلفة صافية بعد المرتجع`)
  assert.equal(exp.grandTotalMinor, 15500, `${activityId}: ت9 الإجمالي مع الرسوم`)
  const shares = exp.rows.reduce((a, r) => a + r.sharePercent, 0)
  assert.ok(Math.abs(shares - 100) < 0.5, `${activityId}: ت9 النسب ≈ 100% (${shares})`)

  /* ت10) خصم فاتورة إجمالي 10% — التوزيع النسبي يبقى متسقاً */
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 10, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const sum2 = salesSummary(st().sales, st().saleReturns, P)
  const top2 = topItems(st().sales, st().saleReturns, P, 10)
  const returnsTax2 = st().saleReturns.reduce((a, r) => a + r.totals.taxMinor, 0)
  const netNoTax2 = (sum2.totalMinor - sum2.taxMinor) - (sum2.returnsMinor - returnsTax2)
  assert.equal(top2.reduce((a, r) => a + r.revenueMinor, 0), netNoTax2, `${activityId}: ت10 بعد خصم الفاتورة ما زالا متسقين`)
  const tbEnd = trialBalance(st().journal, ALL)
  assert.ok(tbEnd.balanced, `${activityId}: ت10 الميزان الختامي متوازن`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): 10 فحوص تقارير × دورة كاملة — كل التقارير متسقة بالقرش مع الدفتر`)
}

assert.equal(pass, 18)
console.log(`\n✅ verify_reports_review_16: مراجعة قسم التقارير — 12 محوراً على الأنشطة الـ16 سليمة`)
