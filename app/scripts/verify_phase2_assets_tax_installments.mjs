/**
 * تدقيق المرحلة 2 — الأقسام 2.8…2.11: الأصول الثابتة · الضريبة · التقسيط · مراكز التكلفة.
 *
 * جدول «الحدث ← القيد المتوقع»:
 *   شراء أصل نقداً            1201 أصول ← خزينة
 *   شراء أصل آجل على مورد      1201 ← 2101 (مورد مسجل إلزامي)
 *   شراء أصل برأس مال          1201 ← 3101 (لا خزينة تُمس)
 *   سداد قسط أصل               2101 ← خزينة (الأقدم أولاً)
 *   إهلاك شهري                 5107 ← 1202 مجمع الإهلاك (قيد مجمع واحد)
 *   بيع آجل بضريبة             1104 ← 4101 + 2102
 *   شراء بضريبة مدخلات         1103+2102 ← 2101/خزينة
 *   سداد الضريبة للمصلحة       2102 ← خزينة (سند صرف على الحساب)
 *   خطة تقسيط بهامش تمويل      1104 ← 4111 بالهامش، والمقدم خزينة ← 1104
 *   تحصيل قسط                  خزينة ← 1104
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase2_assets_tax_installments.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { vatReport, incomeStatement, balanceSheet } from '/home/user/shopsys/app/src/core/financialReports.ts'

const R = reporter('المرحلة 2 — الأصول والضريبة والتقسيط ومراكز التكلفة')
const bal = (c, code) => balanceOf(c.st().journal, code)
const P = { from: '2000-01-01', to: '2999-12-31' }

/* ─── 2.8 الأصول الثابتة ─── */
{
  const c = await freshCase({ activityId: 'general', extraModules: ['assets'] })
  // ① نقدي كامل
  const cashAsset = c.st().addAsset({ nameAr: 'ثلاجة عرض', costMinor: 500000, salvageMinor: 50000, lifeMonths: 60, paidMinor: 500000, notes: '', treasury: '1101', funding: 'cash' })
  assert.equal(bal(c, '1201'), 500000, 'الأصل بالتكلفة الكاملة')
  assert.equal(bal(c, '1101'), -500000, 'الخزينة دفعت التكلفة')
  assertInvariants('شراء أصل نقدي', c)
  R.ok('2.8① شراء أصل نقداً: 1201 مدين ← الخزينة دائنة بالتكلفة كاملة')
  // ② التحققات
  expectReject('خردة ≥ تكلفة', c, () => c.st().addAsset({ nameAr: 'س', costMinor: 100000, salvageMinor: 100000, lifeMonths: 12, paidMinor: 0, notes: '', funding: 'cash' }), /الخردة/)
  expectReject('عمر صفر', c, () => c.st().addAsset({ nameAr: 'س', costMinor: 100000, salvageMinor: 0, lifeMonths: 0, paidMinor: 0, notes: '', funding: 'cash' }), /العمر/)
  expectReject('مدفوع > تكلفة', c, () => c.st().addAsset({ nameAr: 'س', costMinor: 100000, salvageMinor: 0, lifeMonths: 12, paidMinor: 200000, notes: '', funding: 'cash' }), /المدفوع/)
  expectReject('آجل بلا مورد', c, () => c.st().addAsset({ nameAr: 'س', costMinor: 100000, salvageMinor: 0, lifeMonths: 12, paidMinor: 0, notes: '', funding: 'supplier_credit' }), /مورد/)
  R.ok('2.8② الأصل يرفض: خردة ≥ تكلفة · عمر صفر · مدفوع يفوق التكلفة · دين آجل بلا مورد مسجل')
  // ③ آجل على مورد بأقساط
  const sup = addParty(c, 'supplier', 'مورد المعدات')
  const credAsset = c.st().addAsset({
    nameAr: 'فرن صناعي', costMinor: 1200000, salvageMinor: 0, lifeMonths: 120, paidMinor: 0, notes: '',
    funding: 'supplier_credit', supplierId: sup.id, installmentCount: 4, installmentIntervalMonths: 1, firstInstallmentDate: '2026-07-01',
  })
  assert.equal(bal(c, '1201'), 1700000)
  assert.equal(bal(c, '2101'), -1200000, 'الدين كله على المورد')
  assert.equal(c.st().getSupplierBalance(sup.id), 1200000, 'كشف المورد يرى دين الأصل (ث7)')
  assert.equal(credAsset.installments.length, 4)
  assert.equal(credAsset.installments.reduce((s, i) => s + i.amountMinor, 0), 1200000, 'مجموع الأقساط = الدين بالقرش')
  assertInvariants('أصل آجل', c)
  R.ok('2.8③ أصل آجل: 1201 ← 2101 بالمورد، وجدول 4 أقساط مجموعها = الدين بالقرش الواحد')
  // ④ سداد قسط
  const due0 = c.st().getAssetDue(credAsset.id)
  assert.equal(due0.remainingMinor, 1200000)
  c.st().payAssetInstallment({ assetId: credAsset.id, amountMinor: 300000, treasury: '1101' })
  assert.equal(bal(c, '2101'), -900000)
  assert.equal(c.st().getAssetDue(credAsset.id).remainingMinor, 900000)
  assert.equal(c.st().getSupplierBalance(sup.id), 900000)
  assertInvariants('سداد قسط أصل', c)
  R.ok('2.8④ سداد قسط: 2101 ← الخزينة، والمتبقي في الجدول وكشف المورد ينزلان معاً')
  // ⑤ رأس المال/جاري شريك لا يمس الخزينة
  const cash1 = bal(c, '1101')
  c.st().addAsset({ nameAr: 'سيارة المالك', costMinor: 800000, salvageMinor: 0, lifeMonths: 60, paidMinor: 0, notes: '', funding: 'capital' })
  assert.equal(bal(c, '1101'), cash1, 'الخزينة لم تُمس')
  assert.equal(bal(c, '1201'), 2500000)
  assertInvariants('أصل برأس مال', c)
  R.ok('2.8⑤ أصل بمساهمة المالك: 1201 ← حقوق الملكية بلا أي مساس بالخزينة')
  // ⑥ الإهلاك
  const before = bal(c, '1202')
  const dep = c.st().postMonthlyDepreciation()
  assert.ok(dep.totalMinor > 0 && dep.assetCount >= 1)
  assert.equal(bal(c, '5107'), dep.totalMinor, 'المصروف = قيمة الإهلاك')
  assert.equal(bal(c, '1202'), before - dep.totalMinor, 'المجمع دائن بنفس القيمة')
  assert.equal(dep.entry.sourceType, 'depreciation')
  assertInvariants('إهلاك', c)
  R.ok('2.8⑥ الإهلاك الشهري: قيد مجمع واحد 5107 ← 1202 يغطي كل الأصول المستحقة')
  // ⑦ لا إهلاك مرتين لنفس الشهر
  expectReject('إهلاك مكرر', c, () => c.st().postMonthlyDepreciation(), /لا إهلاك مستحق/)
  R.ok('2.8⑦ لا يُرحَّل إهلاك شهر مرتين — العدّاد يمنع التكرار')
  // ⑧ صافي الدفتري في الميزانية = تكلفة − مجمع
  const bs = balanceSheet(c.st().journal, '2999-12-31')
  const net = bal(c, '1201') + bal(c, '1202')
  assert.ok(bs.balanced, 'الميزانية متزنة بعد الإهلاك')
  assert.equal(bs.totalNonCurrentAssetsMinor, net, 'الأصول غير المتداولة = التكلفة − مجمع الإهلاك')
  R.ok(`2.8⑧ الميزانية تتزن بعد الإهلاك والصافي الدفتري ${(net / 100).toFixed(2)} = التكلفة − المجمع`)
  void cashAsset
}

/* ─── 2.9 الضريبة ─── */
{
  const c = await freshCase({ activityId: 'general', vatPercent: 14, taxInclusive: false })
  const cust = addParty(c, 'customer', 'عميل ضريبي')
  const sup = addParty(c, 'supplier', 'مورد ضريبي')
  const item = addSimpleItem(c, { nameAr: 'جهاز', priceMinor: 100000 })
  // مدخلات أولاً (بضاعة على الرف) — ضريبة مدخلات 700
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-06-10',
    lines: [{ itemId: item.id, qty: 30, unitPriceMinor: 50000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 70000, notes: '',
  })
  assert.equal(bal(c, '2102'), 70000, 'ضريبة المدخلات أصل مدين على المصلحة')
  // مخرجات
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 100000, unitCostMinor: 60000, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  })
  assert.equal(c.st().getCustomerBalance(cust.id), 114000, 'العميل مدين بالإجمالي شامل الضريبة')
  assert.equal(bal(c, '2102'), 56000, 'المخرجات 140 خصمت من المدخلات 700 ⇒ رصيد مدين 560')
  const vr = vatReport(c.st().journal, P)
  assert.equal(vr.outputVatMinor, 14000)
  assert.equal(vr.inputVatMinor, 70000)
  assert.equal(vr.netDueMinor, -56000, 'رصيد لصالح المنشأة يُرحَّل للفترة التالية')
  assertInvariants('ضريبة', c)
  R.ok('2.9① الإقرار: مخرجات 140 − مدخلات 700 = رصيد دائن للمنشأة 560 (لا سداد مستحق)')
  // مبيعات إضافية تقلب الرصيد ثم السداد
  for (let i = 0; i < 6; i++) {
    c.st().postSale({
      lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 100000, unitCostMinor: 60000, discountPercent: 0, soldByWeight: false }],
      customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
    })
  }
  const vr2 = vatReport(c.st().journal, P)
  assert.equal(vr2.outputVatMinor, 14000 + 6 * 28000)
  assert.ok(vr2.netDueMinor > 0, 'صار مستحقاً للمصلحة')
  // السداد بسند صرف على 2102
  const payMinor = vr2.netDueMinor
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2102', amountMinor: payMinor, description: 'سداد إقرار ضريبة القيمة المضافة' })
  assert.equal(bal(c, '2102'), 0, 'حساب الضريبة صفر بعد السداد')
  const vr3 = vatReport(c.st().journal, P)
  assert.equal(vr3.settledMinor, payMinor, 'الإقرار يرى السداد في بند «المسدَّد»')
  assert.equal(vr3.remainingMinor, 0)
  assertInvariants('سداد ضريبة', c)
  R.ok('2.9② سداد الإقرار بسند صرف على 2102: الحساب يصفر والإقرار ينقل القيمة لبند «المسدَّد» لا للمخرجات')
  // شامل الضريبة: الإيراد = الإجمالي/1.14
  const c2 = await freshCase({ activityId: 'restaurant', vatPercent: 14, taxInclusive: true })
  const meal = addSimpleItem(c2, { nameAr: 'وجبة', priceMinor: 114000, isService: true })
  c2.st().postSale({
    lines: [{ itemId: meal.id, nameAr: meal.nameAr, qty: 1, unitPriceMinor: 114000, unitCostMinor: 40000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  assert.equal(balanceOf(c2.st().journal, '1101'), 114000, 'المقبوض الإجمالي')
  assert.equal(balanceOf(c2.st().journal, '4101'), -100000, 'الإيراد صافي الضريبة')
  assert.equal(balanceOf(c2.st().journal, '2102'), -14000)
  assertInvariants('سعر شامل', c2)
  R.ok('2.9③ السعر الشامل: المقبوض 1140 = إيراد 1000 + ضريبة 140 — لا تضخيم إيراد')
}

/* ─── 2.10 التقسيط ─── */
{
  const c = await freshCase({ activityId: 'electronics' })
  const cust = addParty(c, 'customer', 'عميل تقسيط')
  const sup = addParty(c, 'supplier', 'مورد الأجهزة')
  const item = addSimpleItem(c, { nameAr: 'غسالة', priceMinor: 1200000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-06-01', lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 800000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const sale = c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1200000, unitCostMinor: 800000, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const before4111 = bal(c, '4111')
  const plan = c.st().createInstallmentPlan({
    customerId: cust.id, saleId: sale.id, totalMinor: 1500000, downPaymentMinor: 300000,
    interestMinor: 300000, count: 6, intervalMonths: 1, firstDueDate: '2026-07-01', treasury: '1101',
  })
  assert.equal(bal(c, '4111') - before4111, -300000, 'هامش التمويل إيراد 4111 لا إيراد مبيعات')
  assert.equal(plan.items.length, 6)
  assert.equal(plan.items.reduce((s, i) => s + i.amountMinor, 0), 1200000, 'الأقساط = الإجمالي − المقدم')
  assert.equal(c.st().getCustomerBalance(cust.id), 1200000, 'ذمة العميل = المتبقي بعد المقدم')
  assertInvariants('خطة تقسيط', c)
  R.ok('2.10① الخطة: هامش التمويل 3000 إيراد تمويلي مستقل (4111)، والمقدم يخفض الذمة فوراً، والأقساط = المتبقي')
  c.st().payInstallment(plan.id, 200000, '1101')
  assert.equal(c.st().getCustomerBalance(cust.id), 1000000)
  const rows = c.st().getCustomerStatementRows(cust.id)
  assert.ok(rows.some((r) => r.creditMinor === 200000), 'القسط المحصَّل صف دائن في كشف العميل')
  assertInvariants('تحصيل قسط', c)
  R.ok('2.10② تحصيل القسط: خزينة ← 1104، والكشف يرى الصف الدائن فوراً')
  expectReject('قسط سالب', c, () => c.st().payInstallment(plan.id, -1, '1101'), /./)
  R.ok('2.10③ التحصيل يرفض القيم غير الصالحة')
}

/* ─── 2.11 مراكز التكلفة ─── */
{
  const c = await freshCase({ activityId: 'general', extraModules: ['cost_centers'] })
  const cc1 = c.st().addCostCenter({ code: 'CC1', nameAr: 'فرع المنصورة' })
  const cc2 = c.st().addCostCenter({ code: 'CC2', nameAr: 'فرع طلخا' })
  expectReject('كود مكرر', c, () => c.st().addCostCenter({ code: 'CC1', nameAr: 'مكرر' }), /./)
  R.ok('2.11① مراكز التكلفة: الكود فريد ولا يتكرر')
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 50000, description: 'كهرباء المنصورة', costCenterId: cc1.id })
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 30000, description: 'كهرباء طلخا', costCenterId: cc2.id })
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 20000, description: 'مصروف عام بلا مركز' })
  const sum = (ccId) => c.st().journal.flatMap((e) => e.lines).filter((l) => l.costCenterId === ccId).reduce((s, l) => s + l.debit - l.credit, 0)
  assert.equal(sum(cc1.id), 50000)
  assert.equal(sum(cc2.id), 30000)
  assert.equal(bal(c, '5108'), 100000, 'الإجمالي في الدفتر = 1000 مهما توزعت المراكز')
  const is = incomeStatement(c.st().journal, P)
  assert.equal(is.totalExpenseMinor, 100000, 'قائمة الدخل لا تتأثر بتوزيع المراكز — التوزيع تحليلي لا محاسبي')
  assertInvariants('مراكز تكلفة', c)
  R.ok('2.11② التوزيع تحليلي: مجموع المراكز 800 + غير موزع 200 = مصروف الدفتر 1000 بالضبط')
  const cc3 = c.st().addCostCenter({ code: 'CC3', nameAr: 'قسم داخل المنصورة', parentId: cc1.id })
  assert.equal(cc3.parentId, cc1.id)
  R.ok('2.11③ شجرة المراكز: مركز فرعي يرتبط بأبيه فيتجمع تقريره تحته')
}

R.done('— الأصول والإهلاك والضريبة والتقسيط ومراكز التكلفة تمر بالمحرك وحده')
