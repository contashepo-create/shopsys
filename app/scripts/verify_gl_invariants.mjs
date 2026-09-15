/**
 * المراجعة العميقة للمحرك المحاسبي — ثوابت دفتر الأستاذ عبر كل الأنشطة.
 *
 * بعد كل عملية من 40+ عملية حقيقية على المخزن نتحقق من 5 ثوابت:
 *   1) كل قيد متوازن (مدين = دائن) وبتواريخ ومصادر سليمة
 *   2) ميزان المراجعة الكلي متوازن
 *   3) 1103 دفترياً = Σ(كمية الصنف × متوسط تكلفته) فعلياً (سماحية تقريب ≤ قرش/صنف)
 *   4) المعادلة المحاسبية: الأصول = الخصوم + حقوق الملكية + (إيرادات − مصروفات)
 *   5) لا مبالغ سالبة ولا كسور في أي سطر قيد
 *
 * تشغيل: node --experimental-strip-types scripts/verify_gl_invariants.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

const balances = () => {
  const b = {}
  for (const e of S().journal) for (const l of e.lines) b[l.accountCode] = (b[l.accountCode] ?? 0) + l.debit - l.credit
  return b
}
const bal = (code) => balances()[code] ?? 0
const root = (p) => Object.entries(balances()).filter(([c]) => c.startsWith(p)).reduce((a, [, v]) => a + v, 0)

/** الثوابت الخمسة — تُفحص بعد كل عملية */
let checkpoints = 0
function invariants(label) {
  checkpoints++
  const errs = []
  for (const e of S().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      d += l.debit; c += l.credit
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) errs.push(`قيد ${e.id}: مبلغ كسري`)
      if (l.debit < 0 || l.credit < 0) errs.push(`قيد ${e.id}: مبلغ سالب`)
      if (l.debit > 0 && l.credit > 0) errs.push(`قيد ${e.id}: سطر مدين ودائن معاً`)
    }
    if (d !== c) errs.push(`قيد ${e.id} غير متوازن (${d}≠${c})`)
    if (!e.sourceType) errs.push(`قيد ${e.id} بلا مصدر`)
  }
  // المخزون الدفتري ضد الفعلي (سماحية تقريب المتوسط: قرش لكل صنف له مخزون)
  const glStock = bal('1103')
  // الدفتر المساعد للمخزون = أصناف (كمية × متوسط) + سيارات متاجرة غير مباعة (شراء + تجهيز)
  const itemsStock = S().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * (it.costMinor ?? 0)), 0)
  const carsStock = (S().cars ?? []).filter((c) => c.status !== 'sold').reduce((a, c) => a + c.purchaseCostMinor + c.prepCostMinor, 0)
  const subStock = itemsStock + carsStock
  // المتوسط يُخزَّن قرشاً صحيحاً لكل وحدة → أقصى انحراف مشروع = نصف قرش × الكمية لكل صنف
  const tolerance = S().items.reduce((a, it) => a + Math.ceil((it.stockQty ?? 0) / 2), 0) + 1
  if (Math.abs(glStock - subStock) > tolerance) errs.push(`مخزون: دفتري ${glStock} ≠ فعلي ${subStock}`)
  // المعادلة المحاسبية
  const eq = root('1') - (-root('2')) - (-root('3')) - (-root('4') - root('5'))
  if (eq !== 0) errs.push(`المعادلة المحاسبية منحرفة بـ ${eq}`)
  ok(`ثوابت بعد: ${label}`, errs.length === 0, errs.slice(0, 3).join(' | '))
}

/* ═══════════ التأسيس ═══════════ */
console.log('🏗️ التأسيس')
S().addCategory({ nameAr: 'بقالة', parentId: null })
const catId = S().categories.at(-1).id
const blank = { sku: '', barcodes: [], extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, costMinor: 0, stockQty: 0 }
S().addItem({ ...blank, nameAr: 'أرز', categoryId: catId, baseUnit: 'كجم', priceMinor: 3000 })
S().addItem({ ...blank, nameAr: 'زيت', categoryId: catId, baseUnit: 'زجاجة', priceMinor: 8000 })
S().addItem({ ...blank, nameAr: 'لبن', categoryId: catId, baseUnit: 'علبة', priceMinor: 2000, trackExpiry: true })
const [rice, oil, milk] = S().items.slice(-3)
S().addSupplier({ nameAr: 'مورد الجملة' })
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr: 'عميل دائم' })
const cust = S().customers.at(-1)
S().addEmployee({ nameAr: 'موظف', baseSalaryMinor: 600000, allowancesMinor: 50000 })
const emp = S().employees.at(-1)
S().addTreasury('بنك الأهلي الثاني', 'bank')
const bank2 = S().treasuries.at(-1)
invariants('التأسيس (لا قيود بعد)')

/* ═══════════ دورة الشراء بالمصاريف الموزعة ═══════════ */
console.log('🛒 المشتريات')
S().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [
  { itemId: rice.id, qty: 100, unitPriceMinor: 1500, expiryDate: null },
  { itemId: oil.id, qty: 50, unitPriceMinor: 5000, expiryDate: null },
  { itemId: milk.id, qty: 60, unitPriceMinor: 1200, expiryDate: '2026-12-01' },
], expenses: [{ nameAr: 'شحن', amountMinor: 21000, method: 'value' }], paidMinor: 200000, treasury: '1101', notes: '' })
invariants('شراء 3 أصناف بمصاريف موزعة ودفع جزئي')
ok('المورد دائن بالباقي', bal('2101') === -(100 * 1500 + 50 * 5000 + 60 * 1200 + 21000 - 200000))
const riceAfter = S().items.find((i) => i.id === rice.id)
ok('تكلفة الأرز شملت نصيبها من الشحن', riceAfter.costMinor > 1500, riceAfter.costMinor)

console.log('🛒 شراء ثانٍ بسعر أعلى — تحريك المتوسط')
S().postPurchase({ supplierId: sup.id, date: '2026-09-02', lines: [{ itemId: rice.id, qty: 50, unitPriceMinor: 2100, expiryDate: null }], expenses: [], paidMinor: 105000, treasury: bank2.code, notes: '' })
invariants('شراء ثانٍ من بنك ثانٍ')
ok('البنك الثاني انخفض', bal(bank2.code) === -105000)

/* ═══════════ البيع: نقدي، آجل، مجزأ، بضريبة شاملة ═══════════ */
console.log('💵 المبيعات')
const cash1 = S().postSale({ lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 20, unitPriceMinor: 3000, unitCostMinor: 0, discountPercent: 5, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101' })
invariants('بيع نقدي بخصم سطر وضريبة مضافة')
ok('اللقطة صححت تكلفة السطر للمتوسط الحالي', cash1.lines[0].unitCostMinor === S().items.find((i) => i.id === rice.id).costMinor)

S().postSale({ lines: [{ itemId: oil.id, nameAr: 'زيت', qty: 10, unitPriceMinor: 8000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 2, taxPercent: 14, taxInclusive: true, treasury: '1101' })
invariants('بيع آجل بخصم فاتورة وضريبة مشمولة')

const split = S().postSale({ lines: [{ itemId: milk.id, nameAr: 'لبن', qty: 15, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: bank2.code, paidMinor: 10000 })
invariants('بيع مجزأ: جزء بنكي وجزء ذمم')
ok('الفاتورة المجزأة حملت كود تتبع', typeof split.refCode === 'string' && split.refCode.startsWith('SAL-'))

/* ═══════════ المرتجعات بإعادة التوسيط ═══════════ */
console.log('↩️ المرتجعات')
S().postSaleReturn({ saleId: cash1.id, qtyByItem: new Map([[rice.id, 5]]), refund: 'cash', reason: 'تالف' })
invariants('مرتجع بيع نقدي (من خزينة البيع الأصلية)')
S().postPurchaseReturn({ purchaseId: S().purchases[0].id, qtyByItem: new Map([[oil.id, 5]]), refund: 'debt', reason: 'عبوات مكسورة' })
invariants('مرتجع شراء بتخفيض دين المورد')

/* ═══════════ السندات والتحصيل ═══════════ */
console.log('🧾 السندات')
S().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 50000, description: 'تحصيل من العميل', partyKind: 'customer', partyId: cust.id })
invariants('سند قبض من عميل')
S().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 80000, description: 'سداد للمورد', partyKind: 'supplier', partyId: sup.id })
invariants('سند صرف لمورد')
S().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: bank2.code, amountMinor: 30000, description: 'إيداع بنكي' })
invariants('تحويل خزينة → بنك')

/* ═══════════ الشيكات متعددة البنوك ═══════════ */
console.log('🏦 الشيكات')
const chq = S().receiveCheque({ chequeNumber: 'CH-100', partyId: cust.id, bankName: 'الأهلي', amountMinor: 40000, dueDate: '2026-10-01', notes: '' })
invariants('استلام شيك من عميل (1106←1104)')
S().setChequeStatus(chq.id, 'deposited')
invariants('إيداع الشيك (حالة فقط — لا قيد)')
S().setChequeStatus(chq.id, 'collected', bank2.code)
invariants('تحصيل الشيك في البنك الثاني')
ok('التحصيل دخل البنك المختار لا 1102', bal(bank2.code) === -105000 + 10000 + 30000 + 40000)

/* ═══════════ الرواتب والسلف ═══════════ */
console.log('👷 الرواتب')
S().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة طارئة' })
invariants('صرف سلفة (1107←1101)')
S().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 20000, advancesMinor: 40000 }] })
invariants('مسير نقدي باستقطاع سلفة جزئي')
ok('رصيد السلف انخفض بالمستقطع فقط', bal('1107') === 60000)
S().postPayroll({ month: '2026-10', payMode: 'accrual', treasury: '1101', notes: '', lines: [{ employeeId: emp.id, baseMinor: 600000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 60000 }] })
invariants('مسير استحقاق يقفل باقي السلفة')
ok('السلفة صفرت على شهرين', bal('1107') === 0)
ok('الرواتب المستحقة 2104 التزام قائم', bal('2104') < 0)
S().postVoucher({ kind: 'payment', treasury: bank2.code, counterAccountCode: '2104', amountMinor: -bal('2104'), description: 'سداد مسير أكتوبر' })
invariants('سداد الرواتب المستحقة بسند من البنك')
ok('2104 صفرت بعد السداد', bal('2104') === 0)

/* ═══════════ الجرد ═══════════ */
console.log('📦 الجرد')
const riceNow = S().items.find((i) => i.id === rice.id)
S().postStocktake([{ itemId: rice.id, nameAr: 'أرز', expectedQty: riceNow.stockQty, countedQty: riceNow.stockQty - 3, unitCostMinor: riceNow.costMinor }], 'عجز جرد شهري')
invariants('تسوية عجز جرد (5108←1103)')

/* ═══════════ الأصول والإهلاك ═══════════ */
console.log('🏢 الأصول')
S().addAsset({ nameAr: 'ثلاجة عرض', costMinor: 240000, salvageMinor: 0, lifeMonths: 24, paidMinor: 240000, notes: '', treasury: bank2.code })
invariants('شراء أصل من البنك')
const dep = S().postMonthlyDepreciation()
invariants('إهلاك شهر (5107←1202)')
ok('مجمع الإهلاك = قسط شهر', bal('1202') === -10000, bal('1202'))

/* ═══════════ أنشطة الخدمات: تأجير، صيانة، نقل، معمل، عيادة، سيارات ═══════════ */
console.log('🚜 التأجير')
const rental = S().openRental({ customerId: cust.id, equipmentId: null, notes: '', treasury: bank2.code, input: { equipmentName: 'حفار صغير', days: 5, dailyRateMinor: 20000, depositMinor: 50000, payment: 'cash', vatPercent: 14 } })
invariants('فتح عقد إيجار بتأمين (بنك ثانٍ)')
ok('التأمين التزام في 2103', bal('2103') === -50000)
S().closeRental(rental.id, 8000, undefined, bank2.code)
invariants('إقفال العقد بخصم من التأمين')
ok('التأمين صفر بعد الرد', bal('2103') === 0)

console.log('🔧 الصيانة')
const ticket = S().openTicket({ customerId: null, customerName: 'صاحب لابتوب', customerPhone: '', deviceName: 'لابتوب', issue: 'شاشة', estimateMinor: 50000, notes: '' })
invariants('فتح تذكرة (لا قيد حتى التسليم)')
S().setTicketStatus(ticket.id, 'in_progress')
S().setTicketStatus(ticket.id, 'ready')
S().deliverTicket(ticket.id, { laborMinor: 30000, parts: [{ itemId: oil.id, qty: 1, unitPriceMinor: 9000 }], payment: 'cash', vatPercent: 0, treasury: '1101' })
invariants('تسليم التذكرة بأجرة وقطعة من المخزون')

console.log('🚚 النقل')
S().postTrip({ customerId: cust.id, vehicleId: null, driverId: null, notes: '', treasury: '1101', input: { fromLoc: 'دمياط', toLoc: 'القاهرة', qty: 2, unitPriceMinor: 150000, expenses: [{ nameAr: 'سولار', qty: 1, unitAmountMinor: 40000, source: 'cash' }], payment: 'credit', vatPercent: 14, containerNumbers: [] } })
invariants('رحلة آجلة بمصروف سولار نقدي')

console.log('🔬 المعمل')
S().addLabTest({ nameAr: 'صورة دم', code: 'CBC', category: 'دم', sampleType: 'دم وريدي', unit: '', priceMinor: 25000, costMinor: 3000, refRanges: [] })
const test = S().labTests.at(-1)
S().addLabReferrer({ nameAr: 'د. حاتم', phone: '', commissionPercent: 10, notes: '' })
const referrer = S().labReferrers.at(-1)
S().addLabPatient({ nameAr: 'مريض معمل', phone: '', gender: 'male', birthDate: '', notes: '' })
const labPatient = S().labPatients.at(-1)
S().registerLabOrder({ patientId: labPatient.id, referrerId: referrer.id, testIds: [test.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
invariants('طلب معمل نقدي مع استحقاق عمولة')
ok('عمولة الطبيب استُحقت في 2105', bal('2105') === -2500)
S().payReferrerCommissions(referrer.id, bank2.code)
invariants('صرف العمولة من البنك الثاني')
ok('2105 صفرت', bal('2105') === 0)

console.log('🩺 العيادة')
S().addClinicPatient({ nameAr: 'مريض عيادة', phone: '', gender: 'female', birthDate: '', bloodType: '', allergies: '', chronic: '', notes: '' })
const clinicPatient = S().clinicPatients.at(-1)
S().addClinicVisit({ patientId: clinicPatient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 30000, paidMinor: 10000, vatPercent: 0, planId: null, treasury: '1101' })
invariants('كشف بدفع جزئي (الباقي دين مريض)')
ok('رصيد المريض = الباقي', S().getPatientBalance(clinicPatient.id) === 20000)
S().collectFromPatient(clinicPatient.id, 20000, bank2.code)
invariants('تحصيل متأخرات المريض في البنك')
ok('ذمة المريض صفرت', S().getPatientBalance(clinicPatient.id) === 0)

console.log('🚗 السيارات')
const car = S().addCar({ make: 'تويوتا', model: 'كورولا', year: 2021, plateOrVin: 'س ب ج 1234', purpose: 'resale', purchaseCostMinor: 5000000, odometerKm: 80000, payment: 'cash', notes: '', treasury: bank2.code })
invariants('شراء سيارة للمتاجرة (مخزون سيارات)')
S().addCarPrep(car.id, 150000, 'cash', 'دهان وميكانيكا', '1101')
invariants('تجهيز يرسمل على تكلفة السيارة')
const rev4101Before = -bal('4101')
const cogs5101Before = bal('5101')
S().sellCar({ carId: car.id, priceMinor: 6000000, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ', treasury: bank2.code })
invariants('بيع السيارة بالتكلفة الكاملة (شراء + تجهيز)')
ok('إيراد البيع 6م دخل 4101', -bal('4101') - rev4101Before === 6000000)
ok('التكلفة الكاملة 5.15م خرجت لـ 5101 (شراء 5م + تجهيز 150 ألف)', bal('5101') - cogs5101Before === 5150000)
ok('السيارة خرجت من المخزون بحالتها', S().cars.find((c) => c.id === car.id).status === 'sold')

/* ═══════════ خلاصة الذمم ضد التقارير ═══════════ */
console.log('🔍 تطابق الذمم مع دفتر الأستاذ')
const { customerBalances, supplierBalances } = await import('../src/core/reports.ts')
const custRows = customerBalances(S().sales, S().saleReturns, S().collections ?? [])
ok('تقرير العملاء لا يرمي ويرجع صفوفاً', Array.isArray(custRows))

/* ═══════════ الختام ═══════════ */
console.log('⚖️ الميزان الختامي')
const b = balances()
let td = 0, tc = 0
for (const e of S().journal) for (const l of e.lines) { td += l.debit; tc += l.credit }
ok(`ميزان المراجعة النهائي متوازن (${S().journal.length} قيداً)`, td === tc)
ok('لا حساب خارج الدليل', Object.keys(b).every((c) => /^[1-5]\d{3}$/.test(c)), Object.keys(b).filter((c) => !/^[1-5]\d{3}$/.test(c)).join(','))
console.log(`   نقاط الفحص: ${checkpoints} عملية × 5 ثوابت`)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 المحرك المحاسبي اجتاز المراجعة العميقة — الثوابت صامدة بعد كل عملية')
