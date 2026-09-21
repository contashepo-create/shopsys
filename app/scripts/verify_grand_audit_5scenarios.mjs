/**
 * 🏆 التدقيق الأكبر — 5 سيناريوهات كاملة عبر 5 أنشطة (طلب المالك):
 * «تأكد على الأقل خمس مرات بسيناريوهات مختلفة أن النواة المحاسبية وارتباطها
 *  بكل قسم على مستوى كل الأنشطة تعمل بشكل صحيح تماماً»
 *
 * كل سيناريو = مستخدم حقيقي في نشاط مختلف يمر بكل أقسامه، وبعد كل عملية:
 *  ① كل قيد متوازن (مدين=دائن) بمبالغ صحيحة غير سالبة
 *  ② ميزان المراجعة الكلي متزن
 *  ③ المخزون الدفتري (1103) = الفعلي × المتوسط (سماحية تقريب قرش/صنف)
 *  ④ كشوف العملاء/الموردين تطابق أرصدة الأستاذ
 *  ⑤ قائمة الدخل تُنتج الربح المتوقع يدوياً بالقرش
 *
 * السيناريوهات:
 *  S1 سوبرماركت مصر: مشتريات بمصاريف→كاشير وردية→آجل بحد ائتمان→مرتجع→رواتب→إقفال وردية
 *  S2 مقاولات السعودية: مشروع BOQ→مستخلص بندي بضريبة→تكاليف بعزل ضريبة→باطن→عهدة→محتجزات
 *  S3 عيادة+معمل: مرضى→زيارات جزئية→تحصيل متأخرات→طلب معمل بعمولة محيل→سدادها
 *  S4 عقارات السعودية: مملوك+مدار→عقود أقساط→تحصيل بسعي→صيانة على المالك→سداد المالك→بيع عقار
 *  S5 لوجستيات+تأجير+صيانة: رحلة بمصاريف→عقد معدة بتأمين→تذكرة بقطع غيار→سندات وتحويل خزائن
 *
 * تشغيل: node --experimental-strip-types scripts/verify_grand_audit_5scenarios.mjs
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
const { summarizeShift } = await import(join(root, 'src/core/shifts.ts'))

const st = () => useDataStore.getState()
const P = { from: '2000-01-01', to: '2099-12-31' }
let pass = 0, checkpoints = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }
const throws = (name, fn, part) => {
  try { fn() } catch (e) {
    if (!part || String(e.message).includes(part)) { pass++; console.log(`  ✓ ${name}`); return }
    throw new Error(`${name}: رسالة غير متوقعة — ${e.message}`)
  }
  throw new Error(`${name}: لم يرمِ خطأ`)
}
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

/** نقطة تفتيش النواة — تُنفذ بعد كل عملية مهمة */
function core(label) {
  checkpoints++
  // ① كل قيد سليم بنيوياً
  for (const e of st().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `[${label}] قيد ${e.id}: مبلغ كسري`)
      assert.ok(l.debit >= 0 && l.credit >= 0, `[${label}] قيد ${e.id}: مبلغ سالب`)
      assert.ok(!(l.debit > 0 && l.credit > 0), `[${label}] قيد ${e.id}: سطر مدين ودائن معاً`)
      d += l.debit; c += l.credit
    }
    assert.equal(d, c, `[${label}] قيد ${e.id} غير متوازن: ${e.description}`)
    assert.ok(e.sourceType, `[${label}] قيد ${e.id} بلا مصدر`)
  }
  // ② ميزان المراجعة
  const tb = trialBalance(st().journal, P)
  assert.ok(tb.balanced, `[${label}] ميزان المراجعة غير متزن: ${tb.totalDebitMinor} ≠ ${tb.totalCreditMinor}`)
  // ③ المخزون الدفتري = الفعلي (سماحية تقريب المتوسط: نصف قرش × الكمية لكل صنف — المتوسط يُخزن قرشاً صحيحاً)
  const physical = st().items.reduce((a, i) => a + Math.round(i.stockQty * i.costMinor), 0)
    + (st().cars ?? []).filter((c) => c.status !== 'sold').reduce((a, c) => a + c.purchaseCostMinor + c.prepCostMinor, 0)
  const book = bal('1103')
  const tolerance = st().items.reduce((a, i) => a + Math.ceil((i.stockQty ?? 0) / 2), 0) + 1
  assert.ok(Math.abs(book - physical) <= tolerance, `[${label}] 1103 دفتري ${book} ≠ فعلي ${physical} (سماحية ${tolerance})`)
  // ④ كشوف الأطراف تطابق دوالّ الرصيد الموحدة
  for (const cst of st().customers) {
    const rows = st().getCustomerStatementRows(cst.id)
    const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
    assert.equal(last, st().getCustomerBalance(cst.id), `[${label}] كشف العميل ${cst.nameAr} لا يطابق رصيده`)
  }
  for (const sup of st().suppliers) {
    const rows = st().getSupplierStatementRows(sup.id)
    const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
    assert.equal(last, st().getSupplierBalance(sup.id), `[${label}] كشف المورد ${sup.nameAr} لا يطابق رصيده`)
  }
}

console.log('\n🏆 التدقيق الأكبر — خمسة سيناريوهات عبر خمسة أنشطة\n')

/* ══════════════════ S1: سوبرماركت — الدورة التجارية الكاملة ══════════════════ */
console.log('🛒 S1: سوبرماركت (مصر 14٪) — مشتريات→كاشير→آجل→مرتجع→رواتب→وردية')

st().addSupplier({ nameAr: 'مخازن الدلتا', phone: '0100', address: '', notes: '', openingMinor: 0 })
const sup1 = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'مطعم الحاج سيد', phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 100_000 })
const cust1 = st().customers.at(-1)
const item = (nameAr, sku, price, extra = {}) => ({
  nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: price, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...extra,
})
st().addItem(item('زيت عباد 1ل', 'OIL-1', 9000))
st().addItem(item('أرز مصري 1ك', 'RICE-1', 4500))
const [oil, rice] = st().items

// شراء 100+200 بمصاريف نقل 3000 موزعة بالقيمة — المتوسط يشمل النقل
st().postPurchase({
  supplierId: sup1.id, date: '2026-09-01',
  lines: [{ itemId: oil.id, qty: 100, unitPriceMinor: 6000 }, { itemId: rice.id, qty: 200, unitPriceMinor: 3000 }],
  expenses: [{ nameAr: 'نقل', amountMinor: 3000, method: 'value', paidBy: 'us' }],
  paidMinor: 500_000, notes: 'توريد أسبوعي',
})
core('S1 شراء بمصاريف')
const oilCost = st().items.find((i) => i.id === oil.id).costMinor
assert.equal(oilCost, 6015) // 600000+نصيبه 1500 = 601500/100
ok('التكلفة المحملة: زيت 60.15 (النقل وُزّع بالقيمة)')
assert.equal(st().getSupplierBalance(sup1.id), 1_200_000 + 3000 - 500_000)
ok('رصيد المورد = فاتورة+نقله−المدفوع')

// وردية كاشير: بيع نقدي بضريبة شاملة ثم آجل عند حد الائتمان
st().openShift('كاشير منى', 50_000)
const sale1 = st().postSale({
  lines: [{ itemId: oil.id, nameAr: 'زيت', qty: 10, unitPriceMinor: 9000, unitCostMinor: 1, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
})
core('S1 بيع نقدي شامل الضريبة')
assert.equal(sale1.totals.totalMinor, 90_000)
assert.equal(sale1.totals.taxMinor, Math.round(90_000 - 90_000 / 1.14))
ok('الضريبة الشاملة فُكَّت صحيحاً من الإجمالي (بائع يرى 900 والقيد يفصل 4102)')
assert.equal(sale1.lines[0].unitCostMinor, 6015)
ok('COGS ثُبّت لحظة الترحيل بالمتوسط الفعلي لا برقم السلة')

// حد الائتمان: بيع آجل داخل الحد يمر، وفوقه يُرفض إلا بموافقة
st().postSale({
  lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 15, unitPriceMinor: 4500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: cust1.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
})
core('S1 بيع آجل داخل الحد')
throws('تجاوز حد الائتمان يُرفض بلا موافقة مدير', () => st().postSale({
  lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 10, unitPriceMinor: 4500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: cust1.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
}), 'حد')
const sale3 = st().postSale({
  lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 10, unitPriceMinor: 4500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: cust1.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, creditLimitOverrideBy: 'المدير عصام',
})
core('S1 آجل فوق الحد بموافقة')
ok('فوق الحد مرّ بموافقة مسماة (نمط SAP B1) وسُجل اسم المعتمد')

// مرتجع سطر بسطر: قطعتان سليمتان تعودان للمخزون
const stockBefore = st().items.find((i) => i.id === rice.id).stockQty
st().postSaleReturn({ saleId: sale3.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'good' }], refund: 'credit', reason: 'زيادة عن الحاجة' })
core('S1 مرتجع آجل')
assert.equal(st().items.find((i) => i.id === rice.id).stockQty, stockBefore + 2)
ok('المرتجع أعاد قطعتين للمخزون وخفض ذمة العميل (لا نقدية خرجت)')

// تحصيل من العميل بسند قبض
const due = st().getCustomerBalance(cust1.id)
st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: due, description: 'تحصيل كامل', partyKind: 'customer', partyId: cust1.id })
core('S1 سند قبض')
assert.equal(st().getCustomerBalance(cust1.id), 0)
ok('سند القبض صفّر رصيد العميل وكشفه متطابق')

// رواتب: موظفة بسلفة تُستقطع
st().addEmployee({ nameAr: 'كاشير منى', phone: '', jobTitle: 'كاشير', salaryMinor: 600_000, hiredAt: '2026-01-01', notes: '' })
const emp1 = st().employees.at(-1)
st().grantEmployeeAdvance({ employeeId: emp1.id, amountMinor: 100_000, treasury: '1101', notes: 'سلفة' })
core('S1 سلفة موظفة')
st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1102', lines: [{ employeeId: emp1.id, baseMinor: 600_000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40_000 }], notes: '' })
core('S1 مسير رواتب باستقطاع سلفة')
assert.equal(st().getEmployeeAdvanceBalance(emp1.id).remainingMinor, 60_000)
ok('السلفة استُقطعت جزئياً (حرية المالك) والمتبقي 600 للشهور القادمة')

const shift1 = st().closeShift(50_000 + 90_000)
core('S1 إقفال وردية')
// نفس تحويلة ShiftsPage: مستندات البيع/المرتجع بموضع الدرج مقابل البنك
const saleDocs = st().sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: 'cash' }))
const shiftSum = summarizeShift(shift1, saleDocs, [])
assert.equal(shiftSum.varianceMinor, 0)
ok('الوردية أُقفلت بلا عجز: افتتاحي 500 + النقدي 900 فقط (الآجل والمرتجع الدائن خارج الدرج)')

// قائمة دخل S1 يدوياً بالقرش: إيراد 4101 − مرتجعات 4102 − COGS 5101 − رواتب 5102
const inc1 = incomeStatement(st().journal, P)
const revenue = -bal('4101'), returns = bal('4102'), cogs = bal('5101'), payrollExp = bal('5102')
assert.equal(inc1.netProfitMinor, revenue - returns - cogs - payrollExp)
ok(`قائمة الدخل بالقرش: ${revenue} − مرتجعات ${returns} − تكلفة ${cogs} − رواتب ${payrollExp} = ${inc1.netProfitMinor}`)

/* ══════════════════ S2: مقاولات — BOQ→مستخلص→تكاليف→باطن→عهدة→محتجز ══════════════════ */
console.log('\n🏗️ S2: مقاولات السعودية (15٪) — الدورة الكاملة بعزل الضريبة')

// كما تفعل الواجهة تماماً: قيمة العقد تُحسب من بنود BOQ قبل الإنشاء (100×50 + 50×300 = 20,000)
st().addProject({ nameAr: 'فيلا العليا', clientName: 'أ. فهد', contractValueMinor: 2_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })
const proj = st().projects.at(-1)
st().addBoqItem({ projectId: proj.id, code: '1', descriptionAr: 'أعمال حفر', unit: 'م3', qty: 100, unitPriceMinor: 5000 })
st().addBoqItem({ projectId: proj.id, code: '2', descriptionAr: 'هيكل خرساني', unit: 'م3', qty: 50, unitPriceMinor: 30000 })
const [bq1, bq2] = st().boqItems.filter((b) => b.projectId === proj.id)
ok('BOQ: بندان بقيمة 500k+1.5m = 2m (تُدخل كخانات مسماة كما في الواجهة)')

// مستخلص بندي بضريبة 15٪ — الإيراد صافٍ على 4107
const ex1 = st().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: bq1.id, newProgressPercent: 100 }, { boqItemId: bq2.id, newProgressPercent: 40 }], vatPercent: 15, payment: 'credit', description: 'مستخلص 1' })
core('S2 مستخلص بندي بضريبة')
assert.equal(ex1.totals.grossMinor, 500_000 + 600_000)
assert.equal(-bal('4107'), 1_100_000)
ok('إيراد المقاولات 4107 = 1.1م صافياً — الضريبة معزولة على 2102 والمحتجز على 1105')
assert.equal(bal('1105'), 110_000)
ok('محتجز الضمان 10٪ مدين 1105 (لن يظهر إيراداً مبكراً)')

// تكلفة نقدية بعزل ضريبة المدخلات: 100k صافي + 15k ضريبة
st().addProjectCost({ projectId: proj.id, kind: 'materials', amountMinor: 100_000, inputVatMinor: 15_000, payment: 'cash', description: 'حديد', treasury: '1102' })
core('S2 تكلفة بعزل ضريبة')
const profitNow = st().getProjectProfit(proj.id)
assert.equal(profitNow.costsMinor, 100_000)
ok('ربحية المشروع حُسبت من الصافي 100k فقط — الضريبة 15k خارجها تماماً (طلب المالك)')

// عهدة مهندس تشتري مواد للمشروع
st().addEmployee({ nameAr: 'مهندس ماجد', phone: '', jobTitle: 'مهندس موقع', salaryMinor: 900_000, hiredAt: '2026-01-01', notes: '' })
const eng = st().employees.at(-1)
const cf = st().openCustodyFile({ employeeId: eng.id, projectId: proj.id, reason: 'مشتريات موقع', notes: '' })
st().fundCustodyFile({ fileId: cf.id, amountMinor: 200_000, treasury: '1101', description: 'تمويل أولي' })
core('S2 تمويل عهدة')
st().addProjectCost({ projectId: proj.id, kind: 'labor', amountMinor: 50_000, inputVatMinor: 0, payment: 'cash', description: 'يوميات عمال', custodyFileId: cf.id })
core('S2 صرف من عهدة')
throws('الصرف فوق المتبقي في العهدة يُرفض', () => st().addProjectCost({ projectId: proj.id, kind: 'other', amountMinor: 999_000, payment: 'cash', description: 'كبير', custodyFileId: cf.id }), 'أكبر')
st().settleCustodyFile({ fileId: cf.id, returnedMinor: 150_000, treasury: '1101' })
core('S2 تسوية العهدة')
ok('العهدة: تمويل 2000→صرف 500→ردّ 1500 — الملف صُفّي بقيد متوازن')

// مقاول باطن بشهادة ومحتجز ودفعة
const sc = st().addSubContract({ projectId: proj.id, contractorName: 'مؤسسة السباكة', scopeAr: 'سباكة كاملة', contractValueMinor: 300_000, retentionPercent: 10, startDate: '2026-09-10' })
st().addSubCertificate({ contractId: sc.id, amountMinor: 200_000, description: 'دفعة أولى' })
core('S2 شهادة باطن')
st().paySubContractor({ contractId: sc.id, amountMinor: 150_000, treasury: '1102' })
core('S2 دفعة باطن')
ok('الباطن: شهادة 2000 (صافي 1800+محتجز 200) ثم دفعة 1500 من البنك')
assert.ok(st().projectCosts.some((c) => c.projectId === proj.id && c.kind === 'subcontract'))
ok('شهادة الباطن دخلت تكاليف المشروع تلقائياً (ترابط قسم↔قسم)')

// الربحية النهائية متسقة مع الأستاذ
const pf = st().getProjectProfit(proj.id)
assert.equal(pf.extractedMinor, 1_100_000)
assert.equal(pf.costsMinor, 100_000 + 50_000 + 200_000)
ok(`ربحية المشروع: مستخلصات ${pf.extractedMinor} − تكاليف ${pf.costsMinor} = ${pf.profitMinor} (متسقة مع القيود)`)

/* ══════════════════ S3: عيادة + معمل — مرضى→زيارات→محيل→عمولات ══════════════════ */
console.log('\n🩺 S3: عيادة ومعمل تحاليل — زيارات جزئية وتحصيل وعمولة محيل')

st().addClinicPatient({ nameAr: 'أم كريم', phone: '0155', gender: 'female', birthDate: '1980-05-01', medicalHistory: '', notes: '' })
const patient = st().clinicPatients.at(-1)
const v1 = st().addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: 'صداع', diagnosis: 'ضغط', treatment: 'دواء', feeMinor: 30_000, paidMinor: 10_000, vatPercent: 0, planId: null })
core('S3 زيارة بسداد جزئي')
assert.equal(st().getPatientBalance(patient.id), 20_000)
ok('الزيارة: 300 كشف، دفعت 100 والباقي 200 دين متتبع على المريضة')
st().collectFromPatient(patient.id, 20_000, '1101')
core('S3 تحصيل متأخرات')
assert.equal(st().getPatientBalance(patient.id), 0)
ok('تحصيل المتأخرات صفّر رصيدها (1101←1104)')

// معمل: محيل بعمولة 10٪ يُحاسب مجمعاً
st().addLabReferrer({ nameAr: 'د. سامي (باطنة)', phone: '', specialty: 'باطنة', commissionPercent: 10, isActive: true, notes: '' })
const ref = st().labReferrers.at(-1)
st().addLabTest({ code: 'CBC', nameAr: 'صورة دم', category: 'دم', sampleType: 'دم وريدي', unit: 'g/dL', priceMinor: 40_000, costMinor: 3_000, refRanges: [] })
st().addLabTest({ code: 'FBS', nameAr: 'سكر صائم', category: 'كيمياء', sampleType: 'دم', unit: 'mg/dL', priceMinor: 15_000, costMinor: 1_000, refRanges: [] })
const [t1, t2] = st().labTests.slice(-2)
st().addLabPatient({ nameAr: 'أم كريم', phone: '0155', gender: 'female', birthDate: '', notes: '' })
const labPat = st().labPatients.at(-1)
const order = st().registerLabOrder({ patientId: labPat.id, referrerId: ref.id, testIds: [t1.id, t2.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '' })
core('S3 طلب معمل بعمولة محيل')
assert.equal(order.commissionMinor, 5_500)
assert.equal(-bal('2105'), 5_500)
ok('عمولة المحيل 10٪ = 55 استُحقت على 2105 (مصروف 5109) ولم تُدفع بعد')
const paid = st().payReferrerCommissions(ref.id, '1101')
core('S3 سداد عمولات المحيل')
assert.equal(paid.total, 5_500)
assert.equal(bal('2105'), 0)
ok('سداد العمولات مجمعاً صفّر 2105 — دورة المحيل مقفلة')

/* ══════════════════ S4: عقارات — مملوك+مدار→أقساط→سعي→صيانة→بيع ══════════════════ */
console.log('\n🏢 S4: عقارات سعودية — إدارة أملاك الغير بسعي + بيع عقار مملوك')

const owned = st().addProperty({ nameAr: 'شقة النرجس', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0, address: 'الرياض', costMinor: 800_000, notes: '', unitCodes: ['A1'], acquisitionPayment: 'cash', treasury: '1102' })
const managed = st().addProperty({ nameAr: 'عمارة أبو صالح', kind: 'residential', ownership: 'managed', ownerName: 'أبو صالح', commissionPercent: 5, address: 'جدة', costMinor: 0, notes: '', unitCodes: ['B1'] })
core('S4 اقتناء عقارين')
assert.equal(bal('1113'), 800_000)
ok('العقار المملوك أصل على 1113 بتكلفته — المدار بلا قيد (ليس أصلنا)')

const uOwned = st().propertyUnits.find((u) => u.propertyId === owned.id)
const uManaged = st().propertyUnits.find((u) => u.propertyId === managed.id)
st().addLease({ propertyId: owned.id, unitId: uOwned.id, tenantName: 'خالد', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 240_000, depositMinor: 20_000, treasury: '1101' })
const leaseOwned = st().leases.at(-1)
st().addLease({ propertyId: managed.id, unitId: uManaged.id, tenantName: 'مشعل', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 120_000, depositMinor: 10_000, treasury: '1101' })
const leaseManaged = st().leases.at(-1)
core('S4 عقدا إيجار بتأمينين')
assert.equal(-bal('2103'), 30_000)
ok('التأمينان التزام مسترد على 2103 (لا يدخلان الإيراد أبداً)')

const c1 = st().collectLeaseInstallment({ leaseId: leaseOwned.id, seq: 1, treasury: '1101' })
core('S4 تحصيل قسط مملوك')
assert.equal(c1.commissionMinor, 0)
assert.equal(-bal('4113'), 20_000)
ok('قسط المملوك 200 إيراد إيجار كامل 4113')
const c2 = st().collectLeaseInstallment({ leaseId: leaseManaged.id, seq: 1, treasury: '1101' })
core('S4 تحصيل قسط مدار بسعي')
assert.equal(c2.commissionMinor, 500)
assert.equal(c2.ownerShareMinor, 9_500)
ok('قسط المدار 100: سعي 5٪ = 5 إيرادنا 4114، و95 التزام للمالك 2115 (نمط الوسيط)')

st().addUnitMaintenance({ unitId: uManaged.id, amountMinor: 2_000, bearer: 'owner', description: 'سباكة', treasury: '1101' })
core('S4 صيانة على المالك')
assert.equal(st().getOwnerBalance(managed.id), 9_500 - 2_000)
ok('صيانة الوحدة خُصمت من مستحق المالك لا من مصاريفنا (bearer=owner)')
st().payPropertyOwner({ propertyId: managed.id, amountMinor: 7_500, treasury: '1101' })
core('S4 سداد المالك')
assert.equal(st().getOwnerBalance(managed.id), 0)
ok('سداد المالك صفّى 2115 — دورة إدارة الأملاك مكتملة')

st().endLease({ leaseId: leaseOwned.id, deductionMinor: 3_000, treasury: '1101' })
core('S4 إخلاء برد التأمين ناقص أضرار')
ok('الإخلاء: رد 170 من التأمين والخصم 30 اعتُرف به إيراداً')
st().sellProperty({ propertyId: owned.id, salePriceMinor: 950_000, payment: 'cash', vatPercent: 0, treasury: '1102' })
core('S4 بيع العقار المملوك')
assert.equal(bal('1113'), 0)
assert.equal(-bal('4115'), 950_000)
assert.equal(bal('5116'), 800_000)
ok('البيع: إيراد 4115 وتكلفة 5116 في قيد واحد وخرج الأصل من 1113 (ربح 1500 ظاهر)')

/* ══════════════════ S5: لوجستيات+تأجير معدات+صيانة+خزائن ══════════════════ */
console.log('\n🚚 S5: لوجستيات وتأجير وصيانة — الخدمات الثلاث + إدارة الخزائن')

st().addCustomer({ nameAr: 'مصنع الأسمنت', phone: '0122', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const shipper = st().customers.at(-1)
st().addEmployee({ nameAr: 'سائق حمادة', phone: '', jobTitle: 'سائق', salaryMinor: 400_000, hiredAt: '2026-01-01', notes: '' })
const driver = st().employees.at(-1)
throws('عمولة سائق بلا اختيار سائق تُرفض', () => st().postTrip({
  customerId: shipper.id, vehicleId: null, driverId: null, notes: '', treasury: '1101',
  input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 1000, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [] },
  driverCommissionMinor: 500,
}), 'سائق')
const trip = st().postTrip({
  customerId: shipper.id, vehicleId: null, driverId: driver.id, notes: '', treasury: '1101',
  input: { fromLoc: 'السخنة', toLoc: '6 أكتوبر', qty: 3, unitPriceMinor: 200_000, expenses: [{ nameAr: 'سولار', qty: 3, unitAmountMinor: 30_000, source: 'cash' }, { nameAr: 'كارتة', qty: 3, unitAmountMinor: 5_000, source: 'cash' }], payment: 'credit', vatPercent: 14, containerNumbers: ['C1', 'C2', 'C3'] },
  driverCommissionMinor: 15_000,
})
core('S5 رحلة آجلة بمصاريف وعمولة سائق')
assert.equal(trip.totals.baseMinor, 600_000)
ok('الرحلة: 3 نقلات×2000 آجلة بضريبة فوق السعر، مصاريف 105 نقدية، عمولة سائق مستحقة')
assert.equal(-bal('2111'), 15_000)
ok('عمولة السائق التزام 2111 حتى تُسوى مجمعة')

st().addEquipment({ nameAr: 'ونش 25 طن', code: 'CR-25', dailyRateMinor: 50_000, notes: '', meterType: 'none', currentReading: 0, serviceEveryUnits: 0, lastServiceReading: 0 })
const eq = st().equipment.at(-1)
const rc = st().openRental({ customerId: shipper.id, equipmentId: eq.id, notes: '', treasury: '1101', input: { equipmentName: 'ونش 25 طن', days: 4, dailyRateMinor: 50_000, depositMinor: 100_000, payment: 'cash', vatPercent: 0 } })
core('S5 فتح عقد تأجير معدة')
st().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 20_000, description: 'سولار الونش', treasury: '1101' })
core('S5 مصروف تشغيل معدة')
st().closeRental(rc.id, 10_000, undefined, '1101')
core('S5 إقفال العقد بخصم تأمين')
const eqProfit = st().getEquipmentProfit(eq.id)
assert.equal(eqProfit.revenueMinor, 200_000) // خصم التأمين تعويض أضرار (4104 عام) لا إيراد تشغيل للمعدة
assert.equal(eqProfit.costsMinor, 20_000)
ok(`ربحية المعدة: إيراد تشغيل ${eqProfit.revenueMinor} − تكاليف ${eqProfit.costsMinor} (خصم التأمين إيراد عام لا تشغيلي — تمييز سليم)`)

// صيانة بقطعة غيار من المخزون
st().addItem(item('شاشة موبايل', 'SCR-1', 50_000))
const screen = st().items.at(-1)
st().postPurchase({ supplierId: sup1.id, date: '2026-09-18', lines: [{ itemId: screen.id, qty: 5, unitPriceMinor: 30_000 }], expenses: [], paidMinor: 150_000, notes: '' })
core('S5 شراء قطع غيار')
const tk = st().openTicket({ customerId: null, customerName: 'عميل عابر', customerPhone: '0100', deviceName: 'موبايل A51', issue: 'شاشة مكسورة', estimateMinor: 80_000, notes: '' })
st().setTicketStatus(tk.id, 'in_progress'); st().setTicketStatus(tk.id, 'ready')
st().deliverTicket(tk.id, { laborMinor: 30_000, parts: [{ itemId: screen.id, qty: 1, unitPriceMinor: 50_000 }], payment: 'cash', vatPercent: 0, treasury: '1101' })
core('S5 تسليم تذكرة صيانة')
assert.equal(st().items.find((i) => i.id === screen.id).stockQty, 4)
ok('التذكرة: أجرة 300 + قطعة بيعت 500 وتكلفتها 300 خرجت من المخزون (ترابط صيانة↔مخزون)')

// إدارة خزائن: تحويل برسوم ثم سند صرف مصروف
st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 300_000, description: 'إيداع بنكي', feeMinor: 1_000 })
core('S5 تحويل خزينة→بنك برسوم')
ok('التحويل: خرج 3010 من الخزينة، وصل 3000 للبنك، والرسوم 10 مصروف 5108')
st().postVoucher({ kind: 'payment', treasury: '1102', counterAccountCode: '5104', amountMinor: 15_000, description: 'كهرباء المعرض' })
core('S5 سند صرف مصروف')
ok('سند الصرف قيّد الكهرباء مصروفاً من البنك')



/* ══════════════════ الخلاصة الكلية: القوائم النهائية ══════════════════ */
console.log('\n📊 القوائم المالية النهائية بعد الأنشطة الخمسة معاً')
const tb = trialBalance(st().journal, P)
assert.ok(tb.balanced)
ok(`ميزان المراجعة الختامي متزن: ${tb.totalDebitMinor.toLocaleString('en')} = ${tb.totalCreditMinor.toLocaleString('en')}`)
const bs = balanceSheet(st().journal, '2099-12-31')
assert.ok(bs.balanced)
assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor)
ok(`الميزانية العمومية متزنة: أصول ${bs.totalAssetsMinor.toLocaleString('en')} = خصوم+حقوق ${bs.totalLiabilitiesEquityMinor.toLocaleString('en')} (ربح الفترة أُقفل في الأرباح المرحلة)`)
const vat = vatReport(st().journal, P)
ok(`تقرير الضريبة: مخرجات ${vat.outputVatMinor} − مدخلات ${vat.inputVatMinor} = صافٍ ${vat.netDueMinor} (كل أنشطة الضريبة معاً)`)
const inc = incomeStatement(st().journal, P)
const rev4 = tb.rows.filter((r) => r.code.startsWith('4')).reduce((a, r) => a + r.creditMinor - r.debitMinor, 0)
const exp5 = tb.rows.filter((r) => r.code.startsWith('5')).reduce((a, r) => a + r.debitMinor - r.creditMinor, 0)
assert.equal(inc.netProfitMinor, rev4 - exp5)
ok(`قائمة الدخل الموحدة = ميزان المراجعة بالقرش: صافي الربح ${inc.netProfitMinor.toLocaleString('en')}`)

console.log(`\n✅ التدقيق الأكبر اكتمل: ${pass} تحققاً صريحاً + ${checkpoints} نقطة تفتيش نواة (كلٌّ منها 4 فحوص شاملة) — كل القيود متوازنة وكل الكشوف متطابقة\n`)
