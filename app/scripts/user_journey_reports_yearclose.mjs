/**
 * 📊 رحلة التقارير المالية وإقفال السنة (سيناريو قاسٍ متقاطع):
 * سنة 2025 كاملة الحركة: رأس مال → شراء → بيع نقدي وآجل → مصروف →
 * سداد ضريبة، ثم مطابقة التقارير الخمسة ببعضها:
 * 1) ميزان المراجعة متزن وأرصدته = الأستاذ العام لكل حساب.
 * 2) قائمة الدخل: مجمل الربح = مبيعات − 5101، والصافي = مجمل − تشغيلية.
 * 3) الميزانية: أصول = خصوم + حقوق (بأرباح الفترة) قبل وبعد الإقفال.
 * 4) إقرار الضريبة: مخرجات − مدخلات = المستحق، والسداد يظهر منفصلاً.
 * 5) التدفق النقدي: صافي التغير = فرق أرصدة النقدية فعلياً.
 * 6) إقفال 2025: قيد يصفّر 4xxx/5xxx إلى 3102 — والإقفال المزدوج مرفوض
 *    وقائمة دخل 2026 تبدأ من صفر بينما الميزانية تحمل الأرباح المرحلة.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_reports_yearclose.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance, incomeStatement, balanceSheet, generalLedger, cashFlowReport, vatReport } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const Y25 = { from: '2025-01-01', to: '2025-12-31' }

// ───── تجهيز سنة 2025 كاملة الحركة ─────
// ملاحظة: القيود التلقائية تُختم بتاريخ اليوم (2026) — لذا نبني حركة 2025
// بقيود يدوية متوازنة بتواريخ داخل 2025، وهذا نفسه فحص postManualEntry بعمق.
{
  st().postManualEntry({ date: '2025-01-05', description: 'رأس مال نقدي', lines: [
    { accountCode: '1101', debit: 1000000, credit: 0, note: '' },
    { accountCode: '3101', debit: 0, credit: 1000000, note: '' },
  ] })
  // شراء بضاعة 400 + ض مدخلات 56 نقداً
  st().postManualEntry({ date: '2025-02-10', description: 'شراء بضاعة', lines: [
    { accountCode: '1103', debit: 400000, credit: 0, note: '' },
    { accountCode: '2102', debit: 56000, credit: 0, note: 'مدخلات' },
    { accountCode: '1101', debit: 0, credit: 456000, note: '' },
  ] })
  // بيع نقدي 500 + ض مخرجات 70، تكلفته 250
  st().postManualEntry({ date: '2025-03-15', description: 'بيع نقدي', lines: [
    { accountCode: '1101', debit: 570000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 500000, note: '' },
    { accountCode: '2102', debit: 0, credit: 70000, note: 'مخرجات' },
  ] })
  st().postManualEntry({ date: '2025-03-15', description: 'تكلفة البيع', lines: [
    { accountCode: '5101', debit: 250000, credit: 0, note: '' },
    { accountCode: '1103', debit: 0, credit: 250000, note: '' },
  ] })
  // بيع آجل 200 + ض 28
  st().postManualEntry({ date: '2025-06-20', description: 'بيع آجل', lines: [
    { accountCode: '1104', debit: 228000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 200000, note: '' },
    { accountCode: '2102', debit: 0, credit: 28000, note: 'مخرجات' },
  ] })
  st().postManualEntry({ date: '2025-06-20', description: 'تكلفة البيع الآجل', lines: [
    { accountCode: '5101', debit: 100000, credit: 0, note: '' },
    { accountCode: '1103', debit: 0, credit: 100000, note: '' },
  ] })
  // إيجار (مصروف تشغيلي) 60
  st().postManualEntry({ date: '2025-07-01', description: 'إيجار المحل', lines: [
    { accountCode: '5103', debit: 60000, credit: 0, note: '' },
    { accountCode: '1101', debit: 0, credit: 60000, note: '' },
  ] })
  // قيد غير متوازن يُرفض بنيوياً
  assert.throws(() => st().postManualEntry({ date: '2025-12-01', description: 'مختل', lines: [
    { accountCode: '1101', debit: 100, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 99, note: '' },
  ] }))
}

console.log('\n═══ 1) ميزان المراجعة = الأستاذ العام لكل حساب ═══')
{
  const tb = trialBalance(st().journal, Y25)
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'متزن')
  for (const row of tb.rows) {
    const gl = generalLedger(st().journal, row.code, Y25)
    const glNet = gl.rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0)
    assert.equal(row.debitMinor - row.creditMinor, glNet, `حساب ${row.code}: الميزان ≠ الأستاذ`)
  }
  ok(`ميزان متزن (${tb.totalDebitMinor}) و${tb.rows.length} حساباً كلها مطابقة لأستاذها العام`)
}

console.log('\n═══ 2) قائمة الدخل متعددة المراحل ═══')
let net25
{
  const inc = incomeStatement(st().journal, Y25)
  assert.equal(inc.totalRevenueMinor, 700000, 'مبيعات 5000+2000')
  assert.equal(inc.totalCostOfSalesMinor, 350000, 'تكلفة مباشرة 5101')
  assert.equal(inc.grossProfitMinor, 350000, 'مجمل الربح')
  const opex = inc.operatingExpenses.reduce((s, r) => s + r.amountMinor, 0)
  assert.equal(opex, 60000, 'الإيجار تشغيلي لا تكلفة مباشرة')
  assert.equal(inc.netProfitMinor, 350000 - 60000, 'الصافي 2900')
  net25 = inc.netProfitMinor
  ok('مبيعات 7000 − تكلفة 3500 = مجمل 3500 − إيجار 600 = صافي 2900')
}

console.log('\n═══ 3) الميزانية: أصول = خصوم + حقوق (قبل الإقفال) ═══')
{
  const bs = balanceSheet(st().journal, '2025-12-31')
  assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor, 'معادلة المحاسبة')
  assert.equal(bs.retainedEarningsMinor, net25, 'أرباح الفترة غير المقفلة تسد الفجوة')
  const cash = bs.currentAssets.find((r) => r.code === '1101')
  assert.equal(cash.amountMinor, 1000000 - 456000 + 570000 - 60000, 'النقدية بالميزانية = الحركة الفعلية')
  ok(`أصول ${bs.totalAssetsMinor} = خصوم+حقوق — وأرباح الفترة ${net25} ظاهرة قبل أي إقفال`)
}

console.log('\n═══ 4) إقرار الضريبة: مخرجات − مدخلات والسداد منفصل ═══')
{
  const vr = vatReport(st().journal, Y25)
  assert.equal(vr.outputVatMinor, 98000, 'مخرجات 70+28 — القيد اليدوي الدائن مخرجات')
  assert.equal(vr.inputVatMinor, 56000, 'مدخلات الشراء — القيد اليدوي المدين مدخلات لا مخرجات سالبة')
  assert.equal(vr.netDueMinor, 42000, 'الإقرار = 420')
  // سداد 300 للمصلحة بسند صرف حقيقي (بتاريخ اليوم 2026) — مصدر تسوية معتمد
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2102', amountMinor: 30000, description: 'سداد إقرار ض.ق.م' })
  const vrAll = vatReport(st().journal, { from: '2025-01-01', to: '2026-12-31' })
  assert.equal(vrAll.settledMinor, 30000, 'السند تسوية منفصلة لا مدخلات')
  assert.equal(vrAll.netDueMinor, 42000, 'الإقرار لم يتأثر بالسداد')
  assert.equal(vrAll.remainingMinor, 12000, 'المتبقي بعد السداد')
  const vr25 = vatReport(st().journal, Y25)
  assert.equal(vr25.settledMinor, 0, 'فلترة الفترة: سداد 2026 لا يظهر في إقرار 2025')
  ok('إقرار 420 (مخرجات 980 − مدخلات 560)، سداد بسند صرف = تسوية منفصلة 300، متبقٍ 120')
}

console.log('\n═══ 5) التدفق النقدي = فرق النقدية الفعلي ═══')
{
  const cf = cashFlowReport(st().journal, ['1101'], Y25)
  const expectedNet = -456000 + 570000 - 60000 + 1000000
  assert.equal(cf.closingCashMinor - cf.openingCashMinor, expectedNet, 'صافي التغير النقدي')
  assert.equal(cf.netChangeMinor, expectedNet, 'netChange متسق')
  assert.equal(cf.operatingNetMinor + cf.investingNetMinor + cf.financingNetMinor, cf.netChangeMinor, 'مجموع الأنشطة الثلاثة = الصافي (IAS 7)')
  const tb = trialBalance(st().journal, Y25)
  const cashRow = tb.rows.find((r) => r.code === '1101')
  assert.equal(cf.closingCashMinor, cashRow.debitMinor - cashRow.creditMinor, 'ختامي التدفق = الميزان')
  ok(`صافي تدفق ${expectedNet} مطابق للميزان — لا قرش تائه`)
}

console.log('\n═══ 6) إقفال 2025: تصفير 4xxx/5xxx إلى 3102 + منع الإقفال المزدوج ═══')
{
  const fy25 = { id: 1, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }
  const fy26 = { id: 2, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }
  // إقفال 2026 قبل 2025 مرفوض (الترتيب الزمني) وأيضاً لأنها لم تنته
  assert.throws(() => st().closeFiscalYear(fy26, [fy25, fy26]))
  const { netProfitMinor } = st().closeFiscalYear(fy25, [fy25, fy26])
  assert.equal(netProfitMinor, net25, 'صافي الإقفال = قائمة الدخل')
  // بعد الإقفال: قائمة الدخل تستثني قيود الإقفال بالتصميم — تعرض أداء 2025 الحقيقي للأبد
  const incAfter = incomeStatement(st().journal, Y25)
  assert.equal(incAfter.netProfitMinor, net25, 'قائمة الدخل تعرض الأداء الحقيقي حتى بعد الإقفال (تستثني قيد الإقفال)')
  const bs = balanceSheet(st().journal, '2025-12-31')
  assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor, 'المعادلة صامدة بعد الإقفال')
  const re = bs.equity.find((r) => r.code === '3102')
  assert.equal(re.amountMinor, net25, 'الأرباح المرحلة تحمل الصافي')
  // الإقفال المزدوج مرفوض
  assert.throws(() => st().closeFiscalYear(fy25, [fy25, fy26]), /بالفعل/)
  // 2026 تبدأ من صفر في قائمة الدخل
  const inc26 = incomeStatement(st().journal, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(inc26.netProfitMinor, 0, 'سنة جديدة — دخل صفر')
  ok(`إقفال 2025 رحّل ${netProfitMinor} إلى 3102، المزدوج والمعكوس مرفوضان، و2026 تبدأ نظيفة`)
}

console.log(`\n✅ رحلة التقارير وإقفال السنة: ${pass} محطات — كلها خضراء\n`)
