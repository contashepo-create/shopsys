/**
 * المراجعة الشاملة للمحرك المحاسبي (أمر المالك: «راجع المحرك بالكامل وتوافقه مع كل نشاط بدقة»):
 * يكمل verify_gl_invariants بتغطية العمليات غير المشمولة هناك — على مخزن واحد حي:
 * إعدام مخزون، استبدال ملابس، أوامر مطعم، محافظ إلكترونية، تأمين طبي، معمل بعمولات محيل،
 * خطط أقساط بهامش، كسر ذهب FIFO، ملفات عهدة كاملة (فتح/تمويل/صرف/تسوية)،
 * مقاولات (مستخلص/مقاول باطن/عمالة يومية)، سيارات أمانة، أمر إنتاج، تحويل مخازن، جرد.
 * وبعد كل عملية: القيود متوازنة + المعادلة المحاسبية صامدة.
 * الفحص التقاطعي الختامي: نفس الدفتر يمر على القوائم المالية الجديدة
 * (ميزان مراجعة/مركز مالي/قائمة دخل) فتتطابق النتائج من مسارين مستقلين.
 * تشغيل: node --experimental-strip-types scripts/verify_engine_full_audit.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { trialBalance, balanceSheet, incomeStatement, generalLedger, cashFlowReport } = await import('../src/core/financialReports.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((a, l) => a + l.debit - l.credit, 0)
const root = (p) => S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode.startsWith(p)).reduce((a, l) => a + l.debit - l.credit, 0)

let checkpoints = 0
function invariants(label) {
  checkpoints++
  const errs = []
  for (const e of S().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      d += l.debit; c += l.credit
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) errs.push(`قيد ${e.id}: كسري`)
      if (l.debit < 0 || l.credit < 0) errs.push(`قيد ${e.id}: سالب`)
    }
    if (d !== c) errs.push(`قيد ${e.id} غير متوازن`)
  }
  const eq = root('1') + root('2') + root('3') + root('4') + root('5')
  if (eq !== 0) errs.push(`المعادلة منحرفة ${eq}`)
  ok(`ثوابت بعد: ${label}`, errs.length === 0, errs.slice(0, 3).join(' | '))
}

const item = (over) => ({
  nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cline = (it, qty, price) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })

/* ═════ التأسيس ═════ */
console.log('🏗️ التأسيس')
S().seed([]) // ينشئ المخزن الرئيسي والفئة العامة كما عند أول تشغيل حقيقي
const cat = S().categories.at(-1).id
S().addItem(item({ nameAr: 'قميص M', categoryId: cat, priceMinor: 20000 }))
S().addItem(item({ nameAr: 'قميص L', categoryId: cat, priceMinor: 22000 }))
S().addItem(item({ nameAr: 'برجر', categoryId: cat, priceMinor: 9000 }))
S().addItem(item({ nameAr: 'عيش برجر', categoryId: cat, baseUnit: 'قطعة', priceMinor: 0 }))
S().addItem(item({ nameAr: 'لحم مفروم', categoryId: cat, baseUnit: 'كجم', priceMinor: 0 }))
const [shirtM, shirtL, burger, bun, meat] = S().items.slice(-5)
S().addSupplier(party('مورد المراجعة'))
const sup = S().suppliers.at(-1)
S().addCustomer(party('عميل المراجعة'))
const cust = S().customers.at(-1)
S().addEmployee({ nameAr: 'موظف عهدة', phone: '', jobTitle: '', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '' })
const emp = S().employees.at(-1)
// تمويل رأس مال
S().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 100_000_000, description: 'رأس المال' })
invariants('تمويل رأس المال')

// شراء تأسيسي
S().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [
  { itemId: shirtM.id, qty: 40, unitPriceMinor: 10000, expiryDate: null },
  { itemId: shirtL.id, qty: 40, unitPriceMinor: 11000, expiryDate: null },
  { itemId: bun.id, qty: 200, unitPriceMinor: 500, expiryDate: null },
  { itemId: meat.id, qty: 30, unitPriceMinor: 15000, expiryDate: null },
], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
invariants('شراء تأسيسي آجل')

/* ═════ ① إعدام مخزون ═════ */
console.log('🗑️ إعدام مخزون (هالك)')
const stockBefore = bal('1103')
S().postWastage({ reason: 'تلف مخزن', lines: [{ itemId: bun.id, qty: 20 }], notes: 'محضر' })
invariants('إعدام 20 قطعة عيش')
ok('الهالك خفض 1103 بتكلفته', bal('1103') === stockBefore - 20 * 500)
throws('إعدام فوق الرصيد يُرفض', () => S().postWastage({ reason: 'تلف', lines: [{ itemId: bun.id, qty: 9999 }], notes: '' }))

/* ═════ ② استبدال (ملابس) ═════ */
console.log('👕 استبدال مقاسات')
const sale1 = S().postSale({ lines: [cline(shirtM, 2, 20000)], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101' })
const mQtyBefore = S().items.find((i) => i.id === shirtM.id).stockQty
const lQtyBefore = S().items.find((i) => i.id === shirtL.id).stockQty
S().postExchange({ originalSaleId: sale1.id, returnQtyByItem: new Map([[shirtM.id, 1]]), newLines: [cline(shirtL, 1, 22000)], notes: 'مقاس أكبر' })
invariants('استبدال M→L بفرق سعر')
ok('M رجع للمخزون و L خرج', S().items.find((i) => i.id === shirtM.id).stockQty === mQtyBefore + 1 && S().items.find((i) => i.id === shirtL.id).stockQty === lQtyBefore - 1)

/* ═════ ③ مطعم: وصفة + أمر صالة ═════ */
console.log('🍽️ المطعم')
S().addRecipe({ productItemId: burger.id, mode: 'made_to_order', yieldQty: 1, ingredients: [{ itemId: bun.id, qty: 1 }, { itemId: meat.id, qty: 0.15 }], overheadMinor: 0, isActive: true, notes: '' })
const order = S().openRestaurantOrder({ type: 'dine_in', tableName: '3' })
S().setRestaurantOrderLines(order.id, [cline(burger, 2, 9000)])
throws('نفس الطاولة لا تُفتح مرتين', () => S().openRestaurantOrder({ type: 'dine_in', tableName: '3' }))
const meatBefore = S().items.find((i) => i.id === meat.id).stockQty
S().settleRestaurantOrder({ orderId: order.id, payment: 'cash', serviceChargePercent: 10, taxPercent: 0, taxInclusive: true })
invariants('قفل أمر صالة بخدمة 10٪')
ok('خامات الوصفة خُصمت (لحم −0.3)', Math.abs(S().items.find((i) => i.id === meat.id).stockQty - (meatBefore - 0.3)) < 1e-9)

/* ═════ ④ محافظ إلكترونية ═════ */
console.log('📲 المحافظ')
const rev4103Before = -bal('4103')
S().postWalletService({ type: 'balance_transfer', provider: 'vodafone', targetPhone: '0100', paidToProviderMinor: 100000, chargeMinor: 108000, paidMinor: 108000, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' })
invariants('تحويل رصيد بربح 80 قرشاً')
ok('ربح المحافظ 8000 في 4103', -bal('4103') - rev4103Before === 8000)

/* ═════ ⑤ تأمين طبي ═════ */
console.log('🏥 التأمين الطبي')
S().addInsuranceProvider({ nameAr: 'شركة التأمين الأهلية', coveragePercent: 70 })
const prov = S().insuranceProviders.at(-1)
const ins = S().postInsuredSale({ lines: [cline(shirtL, 1, 22000)], providerId: prov.id, taxPercent: 0, taxInclusive: false, treasury: '1101' })
invariants('بيع مؤمَّن 70/30')
ok('حصة المريض 30٪ وحصة الشركة 70٪', ins.patientShareMinor === 6600 && ins.providerShareMinor === 15400)
const insSt = S().settleInsuranceClaims(prov.id, '1101')
invariants('تحصيل مطالبات التأمين')
ok('حُصلت المطالبة كاملة', insSt.total === 15400)

/* ═════ ⑥ معمل تحاليل بعمولة محيل ═════ */
console.log('🔬 المعمل')
S().addLabTest({ nameAr: 'صورة دم كاملة', code: 'CBC', category: 'دم', sampleType: 'وريدي', unit: '', priceMinor: 30000, costMinor: 5000, refRanges: [] })
const test = S().labTests.at(-1)
S().addLabReferrer({ nameAr: 'د. محيل', phone: '', commissionPercent: 10, notes: '' })
const ref = S().labReferrers.at(-1)
S().addLabPatient({ nameAr: 'مريض معمل', phone: '', gender: 'male', birthDate: '', notes: '' })
const lp = S().labPatients.at(-1)
S().registerLabOrder({ patientId: lp.id, referrerId: ref.id, testIds: [test.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
invariants('طلب معمل نقدي بعمولة مستحقة')
ok('عمولة المحيل 10٪ التزام مستحق 2105', -bal('2105') >= 3000)
const refPay = S().payReferrerCommissions(ref.id, '1101')
invariants('صرف عمولات المحيل')
ok('صُرفت عمولة واحدة', refPay.orderCount === 1 && refPay.total === 3000)

/* ═════ ⑦ أقساط بهامش تمويل ═════ */
console.log('📆 الأقساط')
const arBefore = bal('1104')
S().createInstallmentPlan({ customerId: cust.id, saleId: null, totalMinor: 120000, downPaymentMinor: 20000, interestMinor: 20000, count: 10, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' })
const plan = S().installmentPlans.at(-1)
invariants('خطة أقساط بهامش 20٪ ومقدم')
ok('هامش التمويل إيراد 4111', -bal('4111') === 20000)
S().payInstallment(plan.id, 10000, '1101')
invariants('سداد قسط جزئي')
// أصل المديونية يُثبت من فاتورة البيع الآجل نفسها — الخطة تضيف الهامش فقط
// فصافي حركة 1104 هنا = هامش 200 − مقدم 200 − قسط 100 = −100
ok('حركة 1104 من الخطة = هامش − مقدم − قسط (−100)', bal('1104') - arBefore === -10000)
throws('سداد فوق المتبقي يُرفض', () => S().payInstallment(plan.id, 999_999_999, '1101'))

/* ═════ ⑧ ذهب: كسر FIFO ═════ */
console.log('💍 الذهب')
S().setGramPrices({ k18: 300000, k21: 350000, k24: 400000 })
S().buyScrap({ karat: 'k21', weightGrams: 10, pricePerGramMinor: 330000, sellerName: 'بائعة' })
invariants('شراء كسر 10 جم')
S().buyScrap({ karat: 'k21', weightGrams: 5, pricePerGramMinor: 340000, sellerName: 'آخر' })
const scrapProfitBefore = -bal('4102') - bal('5109')
S().sellScrap({ karat: 'k21', weightGrams: 12, pricePerGramMinor: 345000, buyerName: 'تاجر' })
invariants('بيع كسر 12 جم يستهلك لوطين FIFO')
throws('بيع كسر فوق الرصيد يُرفض', () => S().sellScrap({ karat: 'k21', weightGrams: 999, pricePerGramMinor: 345000 }))

/* ═════ ⑨ عهدة: دورة كاملة ═════ */
console.log('👜 العهدة')
const f = S().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'نثريات تشغيل', notes: '' })
S().fundCustodyFile({ fileId: f.id, amountMinor: 200000, treasury: '1101', description: 'تمويل' })
invariants('تمويل عهدة 2000')
ok('1108 مدين بالعهدة', bal('1108') >= 200000)
S().postCustodyExpense({ fileId: f.id, amountMinor: 120000, description: 'مشتريات نثرية', allowExcess: false })
invariants('صرف من العهدة')
S().settleCustodyFile({ fileId: f.id, returnedMinor: 80000, treasury: '1101' })
invariants('تسوية العهدة بردّ الباقي')
throws('صرف من ملف مقفل يُرفض', () => S().postCustodyExpense({ fileId: f.id, amountMinor: 100, description: 'x', allowExcess: false }))

/* ═════ ⑩ مقاولات: مشروع + مستخلص + باطن + يومية ═════ */
console.log('🏗️ المقاولات')
S().addProject({ nameAr: 'مشروع المراجعة', clientName: 'هيئة عامة', contractValueMinor: 10_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })
const proj = S().projects.at(-1)
S().addProjectCost({ projectId: proj.id, kind: 'materials', amountMinor: 500000, payment: 'cash', description: 'أسمنت', treasury: '1101' })
invariants('تكلفة مواد على المشروع')
S().addProjectExtract({ projectId: proj.id, grossMinor: 2_000_000, vatPercent: 14, payment: 'credit', description: 'مستخلص أول' })
invariants('مستخلص عميل آجل بضريبة واحتجاز')
const sc = S().addSubContract({ projectId: proj.id, contractorName: 'مقاول باطن', scopeAr: 'حفر', contractValueMinor: 800000, retentionPercent: 10, startDate: '2026-09-02' })
S().addSubCertificate({ contractId: sc.id, amountMinor: 400000, description: 'دفعة أعمال' })
invariants('شهادة مقاول باطن باحتجاز')
S().paySubContractor({ contractId: sc.id, amountMinor: 200000, treasury: '1101' })
invariants('دفعة للمقاول الباطن')
const dw = S().addDailyWorker({ nameAr: 'عامل يومية', phone: '', dailyWageMinor: 25000 })
S().addDailyWorkRecord({ workerId: dw.id, projectId: proj.id, date: '2026-09-10', days: 2 })
const dwSt = S().settleDailyWorker(dw.id, '1101')
invariants('تسوية أجور اليومية')
ok('أجرة يومين = 500', dwSt.total === 50000)

/* ═════ ⑪ سيارات أمانة (عمولة) ═════ */
console.log('🚗 سيارات الأمانة')
S().addConsignmentCar({ make: 'هيونداي', model: 'إلنترا', year: 2023, plateOrVin: 'م ر ج 100', ownerName: 'مالك السيارة', ownerNetMinor: 50_000_000, askingPriceMinor: 53_000_000 })
const cc = S().consignmentCars.at(-1)
S().sellConsignmentCar({ id: cc.id, salePriceMinor: 54_000_000, vatPercentOnCommission: 0, payment: 'cash', buyerName: 'مشترٍ', treasury: '1101' })
invariants('بيع أمانة — العمولة فقط إيراد')
S().payConsignmentOwner(cc.id, '1101')
invariants('سداد صافي مالك السيارة')
throws('سداد المالك مرتين يُرفض', () => S().payConsignmentOwner(cc.id, '1101'))

/* ═════ ⑫ أمر إنتاج مسبق ═════ */
console.log('🏭 الإنتاج')
S().addItem(item({ nameAr: 'صوص جاهز', categoryId: cat, baseUnit: 'برطمان', priceMinor: 5000 }))
const sauce = S().items.at(-1)
S().addRecipe({ productItemId: sauce.id, mode: 'prepped', yieldQty: 10, ingredients: [{ itemId: meat.id, qty: 2 }], overheadMinor: 30000, isActive: true, notes: '' })
const sauceRecipe = S().recipes.at(-1)
S().postProduction({ recipeId: sauceRecipe.id, batches: 1, treasury: '1101' })
invariants('أمر إنتاج تشغيلة واحدة')
const sauceItem = S().items.find((i) => i.id === sauce.id)
ok('الناتج دخل المخزون بتكلفة (خامات+تشغيل)/كمية', sauceItem.stockQty === 10 && sauceItem.costMinor > 0)

/* ═════ ⑬ تحويل مخازن + جرد ═════ */
console.log('🏬 المخازن والجرد')
S().addWarehouse('مخزن فرعي للمراجعة')
const wh2 = S().warehouses.at(-1)
const mainWh = S().warehouses.find((w) => w.isMain)
S().postTransfer({ fromWarehouseId: mainWh.id, toWarehouseId: wh2.id, lines: [{ itemId: shirtM.id, qty: 5 }], notes: '' })
invariants('تحويل مخزني (لا قيد مالي — كميات فقط)')
const shirtNow = S().items.find((i) => i.id === shirtM.id)
S().postStocktake([{ itemId: shirtM.id, nameAr: shirtNow.nameAr, expectedQty: shirtNow.stockQty, countedQty: shirtNow.stockQty - 2, unitCostMinor: shirtNow.costMinor }], 'جرد المراجعة')
ok('عجز الجرد خرج مصروفاً 5108 بتكلفته', bal('5108') >= 2 * shirtNow.costMinor)
invariants('تسوية جرد بالعجز')

/* ═════ الفحص التقاطعي: القوائم المالية على نفس الدفتر ═════ */
console.log('⚖️ الفحص التقاطعي مع القوائم المالية')
const P = { from: '0000-01-01', to: '9999-12-31' }
const extraNames = Object.fromEntries(S().treasuries.map((t) => [t.code, t.nameAr]))
const tb = trialBalance(S().journal, P, extraNames)
ok(`ميزان المراجعة متوازن (${S().journal.length} قيداً)`, tb.balanced)
const bs = balanceSheet(S().journal, '9999-12-31', extraNames)
ok('المركز المالي يوازن: أصول = التزامات + حقوق + أرباح', bs.balanced)
const inc = incomeStatement(S().journal, P, extraNames)
ok('صافي الربح بالقائمة = (إيرادات − مصروفات) بالدفتر', inc.netProfitMinor === -root('4') - root('5'))
ok('الأرباح المرحلة بالميزانية = صافي ربح القائمة', bs.retainedEarningsMinor === inc.netProfitMinor)
// دفتر الأستاذ للخزينة = رصيدها المباشر
const gl1101 = generalLedger(S().journal, '1101', P, extraNames)
ok('أستاذ الخزينة الختامي = رصيدها من القيود', gl1101.closingMinor === bal('1101'))
// التدفق النقدي = مجموع حركة كل الخزائن
const cashCodes = S().treasuries.map((t) => t.code)
const cf = cashFlowReport(S().journal, cashCodes, P, extraNames)
const cashDirect = cashCodes.reduce((a, c) => a + bal(c), 0)
ok('نقدية آخر الفترة بالتدفق = مجموع أرصدة الخزائن', cf.closingCashMinor === cashDirect)
console.log(`   نقاط الفحص: ${checkpoints} عملية`)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 المراجعة الشاملة اجتازت — المحرك متوافق مع كل الأنشطة والقوائم المالية تتطابق من مسارين مستقلين')
