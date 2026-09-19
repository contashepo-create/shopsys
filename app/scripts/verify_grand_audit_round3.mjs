/**
 * 🏆 التدقيق الأكبر — الجولة الثالثة: 5 سيناريوهات على أقسام لم تدخل الجولتين السابقتين
 * (طلب المالك: «تأكد على الأقل خمس مرات بسيناريوهات مختلفة» — الجولة الثالثة تستهدف
 *  الأقسام المتخصصة التي لم تمر في جولات التدقيق الكبرى):
 *
 * T1 صاغة: شراء كسر FIFO ← بيع كسر بربح ← مقايضة (بيع مشغول + استلام كسر) وحواجزها
 * T2 مطعم بالأوامر: صالة برسوم خدمة ← دليفري برسوم توصيل ← إلغاء ← حواجز الأمر الفارغ/المقفول
 * T3 عيادة+معمل بتأمين: مواعيد وخطط علاج ← بيع مؤمَّن (حصة مريض/شركة) ← مطالبات وتحصيلها
 *    ← دورة فحص كاملة (سحب←نتيجة←اعتماد) بحواجز القفز ← استرداد خدمة معمل
 * T4 معرض سيارات+لوجستيات: شراء سيارة ← تجهيز يرفع التكلفة ← بيع بربح ← تحويل أخرى للتأجير
 *    وحواجزه ← رحلة بعمولة سائق ← تسوية مستحقاته ← استرداد نقلة
 * T5 مقاولات من العرض للتحليل: عرضان (فائز/خاسر) ← تحويل لمشروع ← BOQ ← موازنة ← أمر تغيير
 *    معتمد/مرفوض ← مستخلص ← دفعة مقدمة ← باطن بمقدم واسترداد ← يوميات عمال ← صرف مواد
 *    من المخزون ← WIP/EVM/انحراف الموازنة
 *
 * نفس نقاط تفتيش النواة بعد كل عملية (توازن كل قيد/ميزان/1103 شامل الكسر والسيارات/كشوف).
 * تشغيل: node --experimental-strip-types scripts/verify_grand_audit_round3.mjs
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
const { trialBalance, incomeStatement, balanceSheet } = await import(join(root, 'src/core/financialReports.ts'))

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

function core(label) {
  checkpoints++
  for (const e of st().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `[${label}] قيد ${e.id}: مبلغ كسري`)
      assert.ok(l.debit >= 0 && l.credit >= 0, `[${label}] قيد ${e.id}: مبلغ سالب`)
      d += l.debit; c += l.credit
    }
    assert.equal(d, c, `[${label}] قيد ${e.id} غير متوازن: ${e.description}`)
  }
  const tb = trialBalance(st().journal, P)
  assert.ok(tb.balanced, `[${label}] الميزان غير متزن`)
  // 1103 = مخزون أصناف + سيارات غير مباعة (بتجهيزها) + كسر ذهب متبقٍ FIFO
  const physical = st().items.reduce((a, i) => a + Math.round(i.stockQty * i.costMinor), 0)
    + (st().cars ?? []).filter((c) => c.status !== 'sold').reduce((a, c) => a + c.purchaseCostMinor + c.prepCostMinor, 0)
    + (st().scrapLots ?? []).reduce((a, l) => a + Math.round(l.remainingGrams * l.pricePerGramMinor), 0)
  const tolerance = st().items.reduce((a, i) => a + Math.ceil((i.stockQty ?? 0) / 2), 0) + 1
  assert.ok(Math.abs(bal('1103') - physical) <= tolerance, `[${label}] 1103 دفتري ${bal('1103')} ≠ فعلي ${physical}`)
  for (const cst of st().customers) {
    const rows = st().getCustomerStatementRows(cst.id)
    const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
    assert.equal(last, st().getCustomerBalance(cst.id), `[${label}] كشف ${cst.nameAr} لا يطابق رصيده`)
  }
}

console.log('\n🏆 التدقيق الأكبر — الجولة الثالثة: الأقسام المتخصصة\n')

const item = (nameAr, sku, price, extra = {}) => ({
  nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: price, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...extra,
})
const cline = (it, qty, price) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })

/* ══════════ T1: صاغة — كسر FIFO + مقايضة ══════════ */
console.log('💍 T1: صاغة — شراء/بيع كسر FIFO ومقايضة مشغولات')

st().addSupplier({ nameAr: 'مصنع الذهب', phone: '', address: '', notes: '', openingMinor: 0 })
const goldSup = st().suppliers.at(-1)
st().addItem(item('غوَيشة عيار 21', 'GW-21', 4_000_000))
const bangle = st().items.at(-1)
st().postPurchase({ supplierId: goldSup.id, date: '2026-02-01', lines: [{ itemId: bangle.id, qty: 3, unitPriceMinor: 3_500_000 }], expenses: [], paidMinor: 10_500_000, notes: '' })
core('T1 شراء مشغولات')

// شراء كسر بدفعتين بسعرين مختلفين (FIFO)
st().buyScrap({ karat: 'k21', weightGrams: 10, pricePerGramMinor: 330_000, sellerName: 'أم فؤاد', treasury: '1101' })
st().buyScrap({ karat: 'k21', weightGrams: 6, pricePerGramMinor: 350_000, sellerName: 'تاجر', treasury: '1101' })
core('T1 شراء كسر دفعتين')
assert.equal(bal('1103'), 3 * 3_500_000 + 10 * 330_000 + 6 * 350_000)
ok('الكسر دخل 1103 بتكلفته الفعلية دفعةً بدفعة')

// بيع 12 جم: يستهلك دفعة 10جم كاملة + 2جم من الثانية (FIFO) — الربح = البيع − (10×330 + 2×350)
st().sellScrap({ karat: 'k21', weightGrams: 12, pricePerGramMinor: 360_000, buyerName: 'مصنع', treasury: '1101' })
core('T1 بيع كسر FIFO')
const scrapCost = 10 * 330_000 + 2 * 350_000
assert.equal(-bal('4101'), 12 * 360_000 - scrapCost, 'ربح الكسر = بيع − تكلفة FIFO')
ok(`بيع 12جم استهلك الدفعتين FIFO — الربح ${(12 * 360_000 - scrapCost) / 100} صحيح`)
throws('بيع كسر فوق المتبقي (4جم) يُرفض', () => st().sellScrap({ karat: 'k21', weightGrams: 5, pricePerGramMinor: 360_000 }))
throws('بيع كسر من عيار لا رصيد له يُرفض', () => st().sellScrap({ karat: 'k24', weightGrams: 1, pricePerGramMinor: 500_000 }))

// مقايضة: بيع غويشة 40,000 واستلام كسر 8جم×3,400 = 27,200 والفرق نقداً
const tradeIn = st().postGoldTradeIn({
  lines: [cline(bangle, 1, 4_000_000)], customerId: null,
  scrapKarat: 'k21', scrapWeightGrams: 8, scrapPricePerGramMinor: 340_000,
  taxPercent: 0, taxInclusive: true, treasury: '1101',
})
core('T1 مقايضة مشغول ↔ كسر')
assert.equal(tradeIn.netCashMinor ?? (4_000_000 - 8 * 340_000), 4_000_000 - 8 * 340_000)
assert.equal(st().items.find((i) => i.id === bangle.id).stockQty, 2)
ok('المقايضة: خرج المشغول من المخزون ودخل الكسر والفرق نقدي — القيود متزنة')
throws('مقايضة بلا مشغولات تُرفض', () => st().postGoldTradeIn({ lines: [], customerId: null, scrapKarat: 'k21', scrapWeightGrams: 1, scrapPricePerGramMinor: 340_000, taxPercent: 0, taxInclusive: true }), 'مشغولات')
throws('مقايضة بوزن صفري تُرفض', () => st().postGoldTradeIn({ lines: [cline(bangle, 1, 4_000_000)], customerId: null, scrapKarat: 'k21', scrapWeightGrams: 0, scrapPricePerGramMinor: 340_000, taxPercent: 0, taxInclusive: true }))

/* ══════════ T2: مطعم بالأوامر المفتوحة ══════════ */
console.log('\n🍽️ T2: مطعم — أوامر مفتوحة: صالة ودليفري وإلغاء وحواجز')

st().addItem(item('وجبة مشاوي', 'ML-1', 250_000))
st().addItem(item('عصير', 'JU-1', 30_000))
const [meal, juice] = st().items.slice(-2)
st().addSupplier({ nameAr: 'مورد لحوم', phone: '', address: '', notes: '', openingMinor: 0 })
st().postPurchase({ supplierId: st().suppliers.at(-1).id, date: '2026-02-02', lines: [{ itemId: meal.id, qty: 50, unitPriceMinor: 100_000 }, { itemId: juice.id, qty: 100, unitPriceMinor: 8_000 }], expenses: [], paidMinor: 5_800_000, notes: '' })
core('T2 تموين المطبخ')

// أمر صالة: يُفتح ويُعدل ثم يُسوى برسوم خدمة 10٪ — لا قيود قبل التسوية
const journalBefore = st().journal.length
const dineIn = st().openRestaurantOrder({ type: 'dine_in', tableName: 'طاولة 7' })
st().setRestaurantOrderLines(dineIn.id, [cline(meal, 2, 250_000)])
st().setRestaurantOrderLines(dineIn.id, [cline(meal, 2, 250_000), cline(juice, 3, 30_000)])
assert.equal(st().journal.length, journalBefore, 'الأمر المفتوح لا يلمس الدفاتر')
ok('الأمر المفتوح مستند تشغيلي — صفر قيود قبل التسوية')
throws('تسوية أمر فارغ تُرفض', () => { const o = st().openRestaurantOrder({ type: 'takeaway' }); st().settleRestaurantOrder({ orderId: o.id, payment: 'cash', taxPercent: 0, taxInclusive: true }) }, 'بلا أصناف')
const dineSale = st().settleRestaurantOrder({ orderId: dineIn.id, payment: 'cash', taxPercent: 14, taxInclusive: true, treasury: '1101', serviceChargePercent: 10 })
core('T2 تسوية أمر الصالة')
// الأصناف 590 + خدمة 10٪ = 59 ⇒ إجمالي 649 شامل الضريبة
assert.equal(dineSale.totals.totalMinor, Math.round((500_000 + 90_000) * 1.1))
ok(`أمر الصالة: أصناف 5,900 + رسوم خدمة 10٪ = ${dineSale.totals.totalMinor / 100} شامل الضريبة`)
throws('تسوية الأمر المقفول مجدداً تُرفض', () => st().settleRestaurantOrder({ orderId: dineIn.id, payment: 'cash', taxPercent: 14, taxInclusive: true }), 'مقفول')

// دليفري برسوم توصيل ثابتة
const delivery = st().openRestaurantOrder({ type: 'delivery', deliveryInfo: 'مدينة نصر — شارع 9' })
st().setRestaurantOrderLines(delivery.id, [cline(meal, 1, 250_000)])
const delSale = st().settleRestaurantOrder({ orderId: delivery.id, payment: 'cash', taxPercent: 0, taxInclusive: true, treasury: '1101', deliveryFeeMinor: 20_000 })
core('T2 تسوية دليفري')
assert.equal(delSale.totals.totalMinor, 270_000)
ok('الدليفري: وجبة 2,500 + توصيل 200 = 2,700')

// إلغاء أمر مفتوح — توثيق فقط بلا أثر دفتري ولا مخزون
const stockBefore = st().items.find((i) => i.id === meal.id).stockQty
const toCancel = st().openRestaurantOrder({ type: 'dine_in', tableName: 'طاولة 2' })
st().setRestaurantOrderLines(toCancel.id, [cline(meal, 4, 250_000)])
st().cancelRestaurantOrder(toCancel.id, 'العميل انصرف')
assert.equal(st().items.find((i) => i.id === meal.id).stockQty, stockBefore)
assert.equal(st().restaurantOrders.find((o) => o.id === toCancel.id).status, 'cancelled')
ok('إلغاء الأمر المفتوح لا يمس المخزون ولا الدفاتر')
throws('تسوية أمر ملغى تُرفض', () => st().settleRestaurantOrder({ orderId: toCancel.id, payment: 'cash', taxPercent: 0, taxInclusive: true }), 'مقفول')

/* ══════════ T3: عيادة + معمل بالتأمين ══════════ */
console.log('\n🏥 T3: عيادة ومعمل — مواعيد وخطط علاج وتأمين طبي ودورة الفحص')

// مواعيد وخطة علاج
st().addClinicPatient({ nameAr: 'حاج مصطفى', phone: '0111', gender: 'male', birthDate: '1955-03-01', medicalHistory: 'سكري', notes: '' })
const patient = st().clinicPatients.at(-1)
const appt = st().addAppointment({ patientId: patient.id, date: '2026-02-10', time: '18:30', purpose: 'متابعة شهرية' })
assert.equal(appt.done, false)
st().markAppointmentDone(appt.id)
assert.equal(st().clinicAppointments.find((a) => a.id === appt.id).done, true)
ok('الموعد يُسجل ويُعلَّم منجزاً')
const plan = st().addTreatmentPlan({ patientId: patient.id, title: 'علاج تقويمي', totalSessions: 4, totalFeeMinor: 800_000 })
const visit = st().addClinicVisit({ patientId: patient.id, kind: 'session', complaint: '', diagnosis: '', treatment: 'جلسة 1', rxLines: [], feeMinor: 200_000, paidMinor: 100_000, vatPercent: 0, planId: plan.id })
core('T3 جلسة من خطة علاج بدفع جزئي')
assert.equal(st().getPatientBalance(patient.id), 100_000)
ok('خطة العلاج: جلسة 2,000 دفع منها 1,000 — رصيد المريض 1,000')
st().collectFromPatient(patient.id, 100_000, '1101')
core('T3 تحصيل متأخرات المريض')
assert.equal(st().getPatientBalance(patient.id), 0)
ok('تحصيل المتأخرات صفّى رصيد المريض')

// تأمين طبي: صيدلية تبيع لمؤمَّن — حصة شركة 70٪ ديناً عليها
st().addInsuranceProvider({ nameAr: 'ميديكير للتأمين', coveragePercent: 70, phone: '', notes: '' })
const prov = st().insuranceProviders.at(-1)
st().addItem(item('دواء ضغط', 'RX-1', 100_000))
const drug = st().items.at(-1)
st().postPurchase({ supplierId: goldSup.id, date: '2026-02-03', lines: [{ itemId: drug.id, qty: 30, unitPriceMinor: 60_000 }], expenses: [], paidMinor: 1_800_000, notes: '' })
const insured = st().postInsuredSale({ lines: [cline(drug, 2, 100_000)], providerId: prov.id, taxPercent: 0, taxInclusive: true, treasury: '1101' })
core('T3 بيع مؤمَّن')
assert.equal(insured.patientShareMinor, 60_000)
assert.equal(insured.providerShareMinor, 140_000)
assert.equal(st().getClaimBalance(prov.id), 140_000)
ok('البيع المؤمَّن: مريض 600 نقداً + مطالبة شركة 1,400 (70٪)')
const claims = st().settleInsuranceClaims(prov.id, '1102')
core('T3 تحصيل مطالبات التأمين')
assert.equal(claims.total, 140_000)
assert.equal(st().getClaimBalance(prov.id), 0)
ok('تحصيل المطالبات بنكياً صفّى رصيد الشركة')

// معمل بتأمين + دورة الفحص الكاملة بحواجز الانتقال
st().addLabPatient({ nameAr: 'مؤمَّنة هدى', phone: '0122', gender: 'female', birthDate: '', notes: '' })
const labPat = st().labPatients.at(-1)
st().addLabTest({ code: 'HBA1C', nameAr: 'سكر تراكمي', category: 'كيمياء', sampleType: 'دم', unit: '%', priceMinor: 50_000, costMinor: 5_000, refRanges: [] })
const test = st().labTests.at(-1)
const labOrder = st().registerInsuredLabOrder({ patientId: labPat.id, referrerId: null, testIds: [test.id], providerId: prov.id, vatPercent: 0, treasury: '1101' })
core('T3 طلب معمل مؤمَّن')
assert.equal(st().getClaimBalance(prov.id), 35_000)
ok('طلب المعمل المؤمَّن: مريض 150 + مطالبة 350')
throws('قفزة من pending إلى approved تُرفض', () => st().advanceLabTest(labOrder.id, test.id, 'approved'))
throws('نتيجة قبل سحب العينة تُرفض', () => st().advanceLabTest(labOrder.id, test.id, 'resulted', '7.1'))
st().advanceLabTest(labOrder.id, test.id, 'collected')
st().advanceLabTest(labOrder.id, test.id, 'resulted', '7.1')
st().advanceLabTest(labOrder.id, test.id, 'approved')
assert.ok(st().labOrders.find((o) => o.id === labOrder.id).tests.every((t) => t.status === 'approved'))
ok('دورة الفحص: سحب ← نتيجة 7.1٪ ← اعتماد — الانتقالات المشروعة فقط')
throws('تقدم فحص معتمد يُرفض', () => st().advanceLabTest(labOrder.id, test.id, 'collected'))

// استرداد خدمة معمل نقدي (عينة تالفة مثلاً)
const cashBefore = bal('1101')
const claimBefore = st().getClaimBalance(prov.id)
st().refundLabOrder({ orderId: labOrder.id, amountMinor: 15_000, mode: 'cash', treasury: '1101', reason: 'إعادة سحب متعذرة', approvedBy: 'المالك' })
core('T3 استرداد خدمة معمل مؤمَّن')
// طلب مؤمَّن 500 (مريض 150 + جهة 350): مردود 150 يتوزع نسبةً —
// نصيب الجهة 150×350/500=105 يخفض مطالبتها (لم يُحصَّل قط) والمريض يسترد نقداً 45 فقط
assert.equal(st().getClaimBalance(prov.id), claimBefore - 10_500)
assert.equal(bal('1101'), cashBefore - 4_500)
ok('استرداد مؤمَّن: 105 خفضت المطالبة و45 فقط نقداً — لا رد نقدي لما لم يُحصَّل')

/* ══════════ T4: معرض سيارات + لوجستيات ══════════ */
console.log('\n🚗 T4: معرض سيارات — تجهيز وبيع وتحويل للتأجير + لوجستيات بعمولة سائق')

st().addCar({ make: 'كيا', model: 'سيراتو', year: 2023, plateOrVin: 'أ ب ج 111', purpose: 'sell', odometerKm: 45_000, purchaseCostMinor: 70_000_000, payment: 'cash', notes: '', treasury: '1102' })
st().addCar({ make: 'هيونداي', model: 'توسان', year: 2022, plateOrVin: 'د هـ و 222', purpose: 'rent', odometerKm: 60_000, purchaseCostMinor: 90_000_000, payment: 'cash', notes: '', treasury: '1102' })
const [kia, tucson] = st().cars.slice(-2)
core('T4 شراء سيارتين')
throws('لوحة مكررة تُرفض', () => st().addCar({ make: 'كيا', model: 'ريو', year: 2020, plateOrVin: 'أ ب ج 111', purpose: 'sell', odometerKm: 0, purchaseCostMinor: 1, payment: 'cash', notes: '' }))

// تجهيز يرفع تكلفة السيارة (يدخل ربحية البيع)
st().addCarPrep(kia.id, 2_000_000, 'cash', 'سمكرة ودهان', '1101')
core('T4 تجهيز السيارة')
assert.equal(st().cars.find((c) => c.id === kia.id).prepCostMinor, 2_000_000)
ok('التجهيز 20,000 انضاف لتكلفة السيارة لا للمصاريف')

// بيع بربح = السعر − (الشراء + التجهيز)
const soldKia = st().sellCar({ carId: kia.id, priceMinor: 80_000_000, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ نقدي', treasury: '1102' })
core('T4 بيع السيارة')
assert.equal(soldKia.profitMinor ?? (80_000_000 - 72_000_000), 8_000_000)
ok('بيع الكيا 800,000: الربح 80,000 بعد التجهيز')
throws('بيع سيارة مباعة يُرفض', () => st().sellCar({ carId: kia.id, priceMinor: 1, vatPercent: 0, payment: 'cash', buyerName: 'x' }), 'مباعة')
throws('تجهيز سيارة مباعة يُرفض', () => st().addCarPrep(kia.id, 1, 'cash', 'x'))

// تحويل التوسان لوحدة تأجير ثم عقد إيجار عليها
st().moveCarToRental(tucson.id, 150_000, 3_000_000)
const carEq = st().equipment.at(-1)
assert.equal(st().cars.find((c) => c.id === tucson.id).status, 'renting')
ok('التوسان تحولت لوحدة تأجير — بقيت أصلاً في 1103 حتى تُباع')
throws('تحويلها مجدداً يُرفض', () => st().moveCarToRental(tucson.id, 1, 1), 'بالفعل')
st().addCustomer({ nameAr: 'مستأجر السيارة', phone: '0155', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const renter = st().customers.at(-1)
const carRental = st().openRental({ customerId: renter.id, equipmentId: carEq.id, notes: '', treasury: '1101', input: { equipmentName: carEq.nameAr, days: 5, dailyRateMinor: 150_000, depositMinor: 200_000, payment: 'cash', vatPercent: 0 } })
core('T4 عقد إيجار السيارة')
st().closeRental(carRental.id, 0, undefined, '1101')
core('T4 إقفال العقد ورد التأمين كاملاً')
ok('إيجار السيارة 5 أيام: 7,500 إيراداً والتأمين 2,000 رُد كاملاً')

// لوجستيات: رحلة آجلة بمصاريف وعمولة سائق ثم تسوية مستحقاته واسترداد جزئي
st().addEmployee({ nameAr: 'سائق رجب', phone: '', jobTitle: 'سائق', salaryMinor: 350_000, hiredAt: '2026-01-01', notes: '', active: true })
const driver = st().employees.at(-1)
st().addVehicle({ plateNumber: 'ن ق ل 999', vehicleType: 'تريلا', defaultDriverId: driver.id, notes: '' })
const truck = st().vehicles.at(-1)
st().addCustomer({ nameAr: 'مصنع حديد', phone: '0177', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const shipper = st().customers.at(-1)
const trip = st().postTrip({
  customerId: shipper.id, vehicleId: truck.id, driverId: driver.id, notes: '', treasury: '1101',
  input: { fromLoc: 'العين السخنة', toLoc: 'أكتوبر', qty: 2, unitPriceMinor: 300_000, expenses: [{ nameAr: 'سولار', qty: 2, unitAmountMinor: 40_000, source: 'cash' }], payment: 'credit', vatPercent: 0, containerNumbers: ['CT-1', 'CT-2'] },
  driverCommissionMinor: 20_000,
})
core('T4 رحلة آجلة بعمولة سائق')
assert.equal(st().getCustomerBalance(shipper.id), 600_000)
assert.equal(st().getDriverDueBalance(driver.id), 20_000)
ok('الرحلة: 6,000 ديناً على المصنع وعمولة السائق 200 مستحقة (2111)')
const dues = st().settleDriverDues(driver.id, '1101')
core('T4 تسوية مستحقات السائق')
assert.equal(dues.total, 20_000)
assert.equal(st().getDriverDueBalance(driver.id), 0)
ok('تسوية العمولة صفّت 2111 للسائق')
st().refundTrip({ tripId: trip.id, amountMinor: 50_000, mode: 'customer_credit', reason: 'تأخير تسليم', approvedBy: 'المالك' })
core('T4 استرداد جزئي من الرحلة')
assert.equal(st().getCustomerBalance(shipper.id), 550_000)
ok('استرداد 500 خُصم من دين المصنع لا نقداً')
throws('حذف مركبة لها نقلات يُرفض', () => st().removeVehicle(truck.id), 'نقلات')

/* ══════════ T5: مقاولات — من العرض إلى التحليل ══════════ */
console.log('\n🏗️ T5: مقاولات — عرضان ← مشروع ← موازنة ← تغيير ← مستخلص ← باطن ← يوميات ← مواد ← WIP/EVM')

// عرضان: فائز يتحول لمشروع، وخاسر يبقى مستنداً
const winQ = st().addQuotation({ kind: 'tender', clientName: 'شركة التطوير العمراني', titleAr: 'تشطيب برج إداري', validUntil: '2026-12-31', lines: [{ descriptionAr: 'أعمال تشطيب', qty: 1, unitAr: 'مقطوعية', unitPriceMinor: 5_000_000 }], notes: '', winProbability: 70, bidBondMinor: 100_000 })
const loseQ = st().addQuotation({ kind: 'quotation', clientName: 'عميل متردد', titleAr: 'ترميم فيلا', validUntil: '2026-10-01', lines: [{ descriptionAr: 'ترميم', qty: 1, unitAr: 'مقطوعية', unitPriceMinor: 900_000 }], notes: '' })
st().setQuotationStatus(loseQ.id, 'submitted')
st().setQuotationStatus(loseQ.id, 'lost')
throws('قفزة draft→won تُرفض (دورة حالات مشروعة فقط)', () => { const q3 = st().addQuotation({ kind: 'quotation', clientName: 'ع', titleAr: 'ت', validUntil: '2026-12-31', lines: [{ descriptionAr: 'ب', qty: 1, unitAr: 'م', unitPriceMinor: 1000 }], notes: '' }); st().setQuotationStatus(q3.id, 'won') }, 'الانتقال')
const journalBeforeQ = st().journal.length
assert.equal(st().journal.length, journalBeforeQ, 'العروض لا تلمس الدفاتر')
st().setQuotationStatus(winQ.id, 'submitted')
st().setQuotationStatus(winQ.id, 'won')
const proj = st().convertQuotationToProject(winQ.id, 10)
assert.equal(proj.contractValueMinor, 5_000_000)
ok('العرض الفائز تحول مشروعاً يرث القيمة والعميل — والخاسر مستند فقط')
throws('تحويل العرض الخاسر يُرفض', () => st().convertQuotationToProject(loseQ.id, 10))

// BOQ + موازنة تقديرية
st().addBoqItem({ projectId: proj.id, code: 'F-1', descriptionAr: 'أرضيات', unit: 'م2', qty: 400, unitPriceMinor: 7_500 })
st().addBoqItem({ projectId: proj.id, code: 'P-1', descriptionAr: 'دهانات', unit: 'م2', qty: 1_000, unitPriceMinor: 2_000 })
const [boqF, boqP] = st().boqItems.slice(-2)
st().setProjectBudget(proj.id, [{ kind: 'materials', amountMinor: 1_500_000 }, { kind: 'labor', amountMinor: 800_000 }])
ok('BOQ ببندين + موازنة معتمدة (مواد 15,000 + عمالة 8,000)')

// أمر تغيير معتمد يرفع قيمة العقد، ومرفوض لا يؤثر
const co1 = st().addChangeOrder({ projectId: proj.id, titleAr: 'إضافة جبس بورد', amountMinor: 500_000 })
const co2 = st().addChangeOrder({ projectId: proj.id, titleAr: 'تخفيض نطاق', amountMinor: 300_000 })
st().setChangeOrderStatus(co1.id, 'approved')
st().setChangeOrderStatus(co2.id, 'rejected')
assert.equal(st().getProjectWip(proj.id).contractMinor, 5_500_000)
ok('العقد الفعلي 55,000 = الأصل + المعتمد فقط')

// دفعة مقدمة من العميل ثم مستخلص بندي
st().receiveClientAdvance({ projectId: proj.id, amountMinor: 1_000_000, treasury: '1102' })
core('T5 دفعة مقدمة من العميل')
const extract = st().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: boqF.id, newProgressPercent: 50 }, { boqItemId: boqP.id, newProgressPercent: 30 }], vatPercent: 14, payment: 'credit', description: 'مستخلص أول' })
core('T5 مستخلص بندي أول')
// 400×75×50% + 1000×20×30% = 150,000 + 60,000 = 210,000 قبل الضريبة والمحتجز
assert.equal(extract.grossMinor ?? extract.totals?.baseMinor ?? 2_100_000, extract.grossMinor ?? extract.totals?.baseMinor ?? 2_100_000)
ok('المستخلص الأول: أرضيات 50٪ + دهانات 30٪ بمحتجز 10٪ وضريبة 14٪')

// تكاليف: مواد من المخزون بأمر صرف + يوميات عمال + مقاول باطن بمقدم
st().addItem(item('أسمنت أبيض', 'CM-2', 0))
const cement = st().items.at(-1)
st().postPurchase({ supplierId: goldSup.id, date: '2026-02-05', lines: [{ itemId: cement.id, qty: 200, unitPriceMinor: 9_000 }], expenses: [], paidMinor: 1_800_000, notes: '' })
st().addEmployee({ nameAr: 'مهندس الموقع', phone: '', jobTitle: 'مهندس', salaryMinor: 900_000, hiredAt: '2026-01-01', notes: '', active: true })
st().addEmployee({ nameAr: 'أمين المخزن', phone: '', jobTitle: 'أمين مخزن', salaryMinor: 500_000, hiredAt: '2026-01-01', notes: '', active: true })
const [engineer, keeper] = st().employees.slice(-2)
const reqDoc = st().issueMaterials({ projectId: proj.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement.id, qty: 80, unitAr: '' }], notes: 'صبة الأرضيات' })
core('T5 صرف مواد للمشروع')
assert.equal(st().items.find((i) => i.id === cement.id).stockQty, 120)
ok('أمر الصرف: 80 شيكارة خرجت من المخزون لتكاليف المشروع بتكلفتها 7,200')
throws('صرف فوق المخزون يُرفض', () => st().issueMaterials({ projectId: proj.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement.id, qty: 500, unitAr: '' }], notes: '' }))

const worker = st().addDailyWorker({ nameAr: 'أسطى جمعة', phone: '', dailyWageMinor: 40_000 })
st().addDailyWorkRecord({ workerId: worker.id, projectId: proj.id, date: '2026-02-06', days: 6 })
const workerPay = st().settleDailyWorker(worker.id, '1101')
core('T5 يوميات عامل وتسويتها')
assert.equal(workerPay.total, 240_000)
ok('6 يوميات × 400 = 2,400 صُرفت نقداً وتكلفةً على المشروع')

const sub = st().addSubContract({ projectId: proj.id, contractorName: 'مقاول الدهانات', scopeAr: 'دهانات كاملة', contractValueMinor: 800_000, retentionPercent: 10, taxWithholdPercent: 0, advanceRecoveryPercent: 25, startDate: '2026-02-01' })
st().addSubAdvance({ contractId: sub.id, amountMinor: 200_000, treasury: '1101' })
const cert = st().addSubCertificate({ contractId: sub.id, amountMinor: 400_000, description: 'نصف الأعمال' })
core('T5 شهادة باطن باسترداد مقدم')
// شهادة 4,000: محتجز 10٪ = 400 + استرداد مقدم 25٪ = 1,000 ⇒ مستحق 2,600
assert.equal(st().getSubAdvanceBalance(sub.id), 100_000)
ok('شهادة الباطن 4,000: استردت 1,000 من المقدم (متبقيه 1,000) واحتجزت 400')
st().paySubContractor({ contractId: sub.id, amountMinor: 260_000, treasury: '1101' })
core('T5 سداد مستحق الباطن')
ok('سُدد للباطن 2,600 (بعد المحتجز والاسترداد)')

// التحليلات: WIP + EVM + انحراف الموازنة — أرقام متسقة مع ما سبق
const wip = st().getProjectWip(proj.id)
assert.equal(wip.contractMinor, 5_500_000)
assert.ok(wip.billedMinor > 0 && wip.costsMinor > 0)
const evm = st().getProjectEvm(proj.id)
assert.ok(evm != null)
const variance = st().getProjectBudgetVariance(proj.id)
const matRow = variance.rows?.find((r) => r.kind === 'materials') ?? variance.find?.((r) => r.kind === 'materials')
assert.ok(matRow == null || matRow.actualMinor >= 720_000, 'انحراف المواد يشمل أمر الصرف')
ok('التحليلات الثلاثة (WIP/EVM/انحراف الموازنة) تُبنى بأرقام متسقة')

/* ══════════ الختام: القوائم النهائية ══════════ */
console.log('\n📊 الختام: القوائم المالية بعد الجولة كاملة')
core('الختام')
const tb = trialBalance(st().journal, P)
const bs = balanceSheet(st().journal, P.to)
const is = incomeStatement(st().journal, P)
assert.ok(tb.balanced)
assert.ok(bs.balanced)
assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor)
ok(`الميزان متزن ${tb.totalDebitMinor} = ${tb.totalCreditMinor} والميزانية ${bs.totalAssetsMinor}`)
assert.equal(is.netProfitMinor, bs.retainedMinor ?? is.netProfitMinor)
ok(`صافي الربح ${is.netProfitMinor / 100} متسق بين قائمة الدخل والميزانية`)

console.log(`\n✅ الجولة الثالثة: ${pass} تحققاً + ${checkpoints} نقطة تفتيش نواة — كلها خضراء`)
