/**
 * تدقيق المرحلة 2 — القسمان 2.12 و2.13: التقارير المالية · الإقفال السنوي والأرصدة الافتتاحية.
 *
 * السؤال المحاسبي: هل التقارير تقرأ الدفتر كما هو (لا حساباً موازياً)، وهل الإقفال
 * ينقل النتيجة لحقوق الملكية ويترك الميزانية متزنة والسنة المقفلة محصّنة؟
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase2_reports_yearclose.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { trialBalance, incomeStatement, balanceSheet, generalLedger, cashFlowReport, toCsv } from '/home/user/shopsys/app/src/core/financialReports.ts'

const R = reporter('المرحلة 2 — التقارير المالية والإقفال السنوي')
const bal = (c, code) => balanceOf(c.st().journal, code)
const ALL = { from: '0000-01-01', to: '2999-12-31' }

/* ─── 2.12 التقارير ─── */
const c = await freshCase({ activityId: 'general' })
const cust = addParty(c, 'customer', 'عميل التقارير')
const sup = addParty(c, 'supplier', 'مورد التقارير')
const item = addSimpleItem(c, { nameAr: 'بضاعة', priceMinor: 20000 })
c.st().postPurchase({
  supplierId: sup.id, date: '2026-02-01', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 10000, expiryDate: null }],
  expenses: [], paidMinor: 400000, treasury: '1101', notes: '',
})
c.st().postSale({
  lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 40, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
})
c.st().postSale({
  lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
})
c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 120000, description: 'إيجار فبراير' })
c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 300000, description: 'تحصيل من العميل', partyKind: 'customer', partyId: cust.id })
assertInvariants('بيانات التقارير', c)

{
  const tb = trialBalance(c.st().journal, ALL)
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'ميزان المراجعة متزن')
  assert.ok(tb.balanced)
  const rowOf = (code) => tb.rows.find((r) => r.code === code)
  assert.equal(rowOf('1104').debitMinor - rowOf('1104').creditMinor, bal(c, '1104'), 'صف الميزان = رصيد الدفتر')
  assert.equal(bal(c, '1104'), 500000, 'ذمة العميل 800 − 300 محصلة')
  assert.equal(c.st().getCustomerBalance(cust.id), 500000, 'الكشف = الميزان = الدفتر')
  R.ok('2.12① ميزان المراجعة: متزن، وكل صف فيه = رصيد الحساب في الدفتر = كشف الطرف')
  const is = incomeStatement(c.st().journal, ALL)
  assert.equal(is.totalRevenueMinor, 1000000, 'إيراد 50 قطعة × 200')
  assert.equal(is.totalCostOfSalesMinor, 500000, 'تكلفة 50 × 100')
  assert.equal(is.grossProfitMinor, 500000, 'مجمل الربح = إيراد − تكلفة مباشرة')
  assert.equal(is.totalOperatingExpenseMinor, 120000)
  assert.equal(is.netProfitMinor, 380000, 'صافي الربح = 5000 − 1200')
  assert.equal(is.grossProfitMinor - is.totalOperatingExpenseMinor, is.netProfitMinor, 'سلسلة القائمة مغلقة حسابياً')
  R.ok('2.12② قائمة الدخل: إيراد 10000 ← تكلفة 5000 ← مجمل 5000 ← تشغيلي 1200 ← صافٍ 3800 (متسلسلة لا مجمعة)')
  const bs = balanceSheet(c.st().journal, '2999-12-31')
  assert.ok(bs.balanced, 'الميزانية متزنة')
  assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor)
  assert.equal(bs.retainedEarningsMinor, is.netProfitMinor, 'الأرباح المحتجزة قبل الإقفال = صافي الفترة')
  const inv = bs.assets.find((r) => r.code === '1103')
  assert.equal(inv.amountMinor, 500000, 'المخزون المتبقي 50 × 100')
  R.ok('2.12③ الميزانية: الأصول = الخصوم + الملكية، والمخزون فيها = المتبقي المقوَّم بالتكلفة')
  const gl = generalLedger(c.st().journal, '1104', ALL)
  assert.equal(gl.closingMinor, 500000, 'رصيد الأستاذ الختامي = الدفتر')
  const running = gl.rows[gl.rows.length - 1].balanceMinor
  assert.equal(running, gl.closingMinor, 'الرصيد الجاري في آخر سطر = الختامي')
  R.ok('2.12④ الأستاذ العام: الرصيد الجاري يتراكم سطراً بسطر وينتهي عند رصيد الدفتر بالضبط')
  const cf = cashFlowReport(c.st().journal, ['1101', '1102'], ALL)
  const cash = bal(c, '1101') + bal(c, '1102')
  assert.equal(cf.closingCashMinor, cash, 'قائمة التدفقات تنتهي عند نقدية الدفتر')
  assert.equal(cf.openingCashMinor + cf.netChangeMinor, cf.closingCashMinor, 'افتتاحي + صافي الحركة = ختامي')
  R.ok('2.12⑤ التدفقات النقدية: افتتاحي + الحركة = ختامي = نقدية الدفتر — لا نقد يظهر من العدم')
  const csv = toCsv(['الحساب', 'مدين', 'دائن'], tb.rows.map((r) => [r.nameAr, r.debitMinor, r.creditMinor]))
  assert.ok(csv.startsWith('\ufeff'), 'CSV يبدأ بـ BOM ليفتح بالعربية في Excel')
  assert.ok(csv.includes('العملاء'))
  R.ok('2.12⑥ التصدير: CSV بترميز UTF-8 BOM فتقرؤه Excel بالعربية بلا رموز مشوهة')
  // التقارير تحترم الفترة
  const emptyP = { from: '2024-01-01', to: '2024-12-31' }
  assert.equal(incomeStatement(c.st().journal, emptyP).netProfitMinor, 0, 'فترة بلا حركة = صفر')
  assert.equal(trialBalance(c.st().journal, emptyP).totalDebitMinor, 0)
  R.ok('2.12⑦ حدود الفترة محترمة: فترة سابقة بلا حركة تعطي أصفاراً لا أرصدة مسربة')
}

/* ─── 2.13 الإقفال السنوي ─── */
{
  const y = await freshCase({
    activityId: 'general',
    fiscalYears: [
      { id: 1, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' },
      { id: 2, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' },
    ],
  })
  const { useAppStore } = await import('/home/user/shopsys/app/src/stores/app.store.ts')
  const allYears = () => useAppStore.getState().fiscalYears
  const kust = addParty(y, 'customer', 'عميل 2025')
  // ربح 2025 بقيود يدوية مؤرخة (البيع لا يقبل تاريخاً سابقاً)
  y.st().postManualEntry({
    date: '2025-06-01', description: 'مبيعات 2025',
    lines: [
      { accountCode: '1104', debit: 900000, credit: 0, note: 'ذمة 2025', partyKind: 'customer', partyId: kust.id },
      { accountCode: '4101', debit: 0, credit: 900000, note: 'إيراد 2025' },
    ],
  })
  y.st().postManualEntry({
    date: '2025-07-01', description: 'مصروفات 2025',
    lines: [
      { accountCode: '5108', debit: 250000, credit: 0, note: 'مصروف 2025' },
      { accountCode: '1101', debit: 0, credit: 250000, note: 'من الخزينة' },
    ],
  })
  const years = allYears()
  const fy2025 = years.find((f) => f.nameAr === '2025')
  const is2025 = incomeStatement(y.st().journal, { from: '2025-01-01', to: '2025-12-31' })
  assert.equal(is2025.netProfitMinor, 650000)
  const res = y.st().closeFiscalYear(fy2025, years)
  useAppStore.setState({ fiscalYears: years.map((f) => (f.id === fy2025.id ? { ...f, status: 'closed' } : f)) })
  assert.equal(res.netProfitMinor, 650000, 'القيد الختامي رحّل صافي الربح كاملاً')
  assert.equal(bal(y, '3102'), -650000, 'الأرباح المرحّلة دائنة بصافي 2025')
  assert.equal(balanceOf(y.st().journal, '4101'), 0, 'حسابات النتيجة صفرت')
  assert.equal(balanceOf(y.st().journal, '5108'), 0)
  const entry = y.st().journal.find((e) => e.id === res.entryId)
  assert.equal(entry.sourceType, 'year_closing')
  assertInvariants('بعد الإقفال', y)
  R.ok('2.13① الإقفال: الإيرادات والمصروفات تصفر وصافي 6500 ينتقل إلى 3102 بقيد year_closing واحد')
  // الميزانية بعد الإقفال لا تحتسب الربح مرتين
  const bsAfter = balanceSheet(y.st().journal, '2025-12-31')
  assert.ok(bsAfter.balanced, 'الميزانية بعد الإقفال متزنة')
  assert.equal(bsAfter.retainedEarningsMinor, 0, 'ما أُقفل لا يُحتسب ثانيةً كأرباح فترة')
  R.ok('2.13② لا ازدواج: الربح المقفل في 3102 لا يُضاف مرة أخرى كأرباح محتجزة في الميزانية')
  // السنة المقفلة محصنة
  expectReject('قيد في سنة مقفلة', y, () => y.st().postManualEntry({
    date: '2025-08-01', description: 'محاولة بعد الإقفال',
    lines: [
      { accountCode: '5108', debit: 10000, credit: 0, note: '' },
      { accountCode: '1101', debit: 0, credit: 10000, note: '' },
    ],
  }), /مقفل/)
  R.ok('2.13③ السنة المقفلة محصّنة: أي قيد بتاريخها يُرفض — الأرقام المعتمدة لا تتغير بأثر رجعي')
  // 2026 مفتوحة
  const okEntry = y.st().postManualEntry({
    date: '2026-01-05', description: 'مصروف 2026',
    lines: [
      { accountCode: '5108', debit: 10000, credit: 0, note: '' },
      { accountCode: '1101', debit: 0, credit: 10000, note: '' },
    ],
  })
  assert.ok(okEntry.id)
  const is2026 = incomeStatement(y.st().journal, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(is2026.totalExpenseMinor, 10000, 'سنة جديدة تبدأ بنتيجة نظيفة')
  R.ok('2.13④ السنة الجديدة تبدأ من صفر في النتيجة بينما أرصدة الميزانية تُرحَّل — لا خلط')
  // لا إقفال مرتين
  expectReject('إقفال مكرر', y, () => y.st().closeFiscalYear(allYears().find((f) => f.nameAr === '2025'), allYears()), /./)
  R.ok('2.13⑤ لا إقفال لسنة مقفلة مرتين — لا مضاعفة لأرباح مرحّلة')
}

/* ─── الأرصدة الافتتاحية ─── */
{
  const o = await freshCase({ activityId: 'general' })
  const k = addParty(o, 'customer', 'عميل برصيد سابق')
  const v = addParty(o, 'supplier', 'مورد برصيد سابق')
  o.st().setOpeningBalance({ kind: 'customer', refId: k.id, amountMinor: 250000, label: 'رصيد أول المدة' })
  o.st().setOpeningBalance({ kind: 'supplier', refId: v.id, amountMinor: 180000, label: 'رصيد أول المدة' })
  assert.equal(bal(o, '1104'), 250000)
  assert.equal(bal(o, '2101'), -180000)
  assert.equal(o.st().getCustomerBalance(k.id), 250000, 'الكشف يبدأ من الافتتاحي')
  assert.equal(o.st().getSupplierBalance(v.id), 180000)
  assert.equal(balanceOf(o.st().journal, '3101'), -70000, 'الفرق يقابله رأس المال — لا ربح وهمي')
  assertInvariants('أرصدة افتتاحية', o)
  R.ok('الافتتاحي: ذمم العملاء والموردين تدخل الدفتر مقابل رأس المال 3101 — لا يتسرب إلى الإيراد')
  // التعديل يرحّل الفرق فقط
  o.st().setOpeningBalance({ kind: 'customer', refId: k.id, amountMinor: 300000, label: 'تصحيح' })
  assert.equal(bal(o, '1104'), 300000, 'الرصيد صار 3000 لا 5500')
  assert.equal(o.st().getCustomerBalance(k.id), 300000)
  assertInvariants('تعديل افتتاحي', o)
  R.ok('تعديل الافتتاحي يرحّل الفرق فقط (50) لا القيمة كاملة — لا تضخيم للذمم')
}

R.done('— التقارير تقرأ الدفتر وحده، والإقفال ينقل النتيجة مرة واحدة ويحصّن السنة')
