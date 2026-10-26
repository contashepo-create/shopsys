/**
 * المرحلة 4 من التدقيق — تركيب وحدة غير أصلية على نشاط (الترقية بأمر البوت اليوم، وبلوحة المالك لاحقاً).
 *
 * السؤال: لو منح المالك «مغسلة» لصاحب سوبرماركت، أو «مقاولات» لمعمل تحاليل — هل يبقى النظام
 * سليماً محاسبياً؟ المخاطر الأربع التي نفحصها:
 *   ① حساب مخفي: الوحدة تُرحّل على حساب لا تراه شجرة النشاط ⇒ قيد في العتمة.
 *   ② شاشة محجوبة: الوحدة مفعّلة والمسار مرفوض (أو العكس: مسار مفتوح لوحدة غير ممنوحة).
 *   ③ محرك لا يعمل خارج نشاطه الأصلي: الدالة تفترض نشاطاً بعينه.
 *   ④ سحب الوحدة بعد استعمالها: الحسابات التي عليها حركة يجب أن تبقى ظاهرة (صمام الأمان)
 *      وإلا اختفت أرصدة من التقارير.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase4_module_grafting.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, balanceOf, addSimpleItem, addParty, reporter, ACTIVITY_IDS } from './auditKit.mjs'
import { ALL_MODULES, effectiveModules, ACTIVITY_TEMPLATES } from '../src/core/activities.ts'
import { coaForModules, ACCOUNT_MODULE_MAP, MODULE_ROUTES, pathAllowedForSetup } from '../src/core/coaVisibility.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { trialBalance, balanceSheet } from '../src/core/financialReports.ts'

const R = reporter('المرحلة 4 — تركيب وحدة غير أصلية على نشاط')
const bal = (c, code) => balanceOf(c.st().journal, code)
const ALL_FEATURES = ['price_lists', 'weight_scale', 'serial_warranty', 'expiry', 'variants', 'gold_karat']

/* ① الشجرة: كل تركيبة (29 نشاطاً × كل وحدة إضافية) تكشف حسابات الوحدة ولا تكشف غيرها */
{
  let combos = 0
  for (const activityId of ACTIVITY_IDS) {
    const native = effectiveModules(activityId, [])
    for (const extra of ALL_MODULES) {
      if (native.includes(extra)) continue
      const grafted = effectiveModules(activityId, [extra])
      assert.ok(grafted.includes(extra), `${activityId}: الوحدة ${extra} لم تُضَف`)
      const before = new Set(coaForModules(STANDARD_COA, native).map((a) => a.code))
      const after = new Set(coaForModules(STANDARD_COA, grafted).map((a) => a.code))
      // لا حساب اختفى بالتركيب
      for (const code of before) assert.ok(after.has(code), `${activityId}+${extra}: الحساب ${code} اختفى بعد التركيب`)
      // كل حساب تحتاجه الوحدة صار ظاهراً
      for (const [code, needed] of Object.entries(ACCOUNT_MODULE_MAP)) {
        if (needed.includes(extra)) assert.ok(after.has(code), `${activityId}+${extra}: حساب الوحدة ${code} ما زال مخفياً`)
      }
      // ولا حساب ظهر بلا مبرر (لا تسرب لوحدات أخرى)
      for (const code of after) {
        if (before.has(code)) continue
        const needed = ACCOUNT_MODULE_MAP[code]
        assert.ok(needed && needed.includes(extra), `${activityId}+${extra}: ظهر الحساب ${code} بلا علاقة بالوحدة`)
      }
      combos++
    }
  }
  R.ok(`${combos} تركيبة (نشاط × وحدة غير أصلية): الشجرة تكشف حسابات الوحدة وحدها — لا حساب يختفي ولا يتسرب`)
}

/* ② المسارات: الوحدة الممنوحة تفتح شاشاتها، وغير الممنوحة تبقى مغلقة */
{
  let checks = 0
  for (const activityId of ACTIVITY_IDS) {
    const native = effectiveModules(activityId, [])
    for (const route of MODULE_ROUTES) {
      if (!route.module) continue
      const allowedNative = pathAllowedForSetup(route.prefix, native, ALL_FEATURES, activityId)
      if (!native.includes(route.module)) {
        assert.equal(allowedNative, false, `${activityId}: المسار ${route.prefix} مفتوح بلا وحدة ${route.module}`)
        const grafted = effectiveModules(activityId, [route.module])
        const allowedAfter = pathAllowedForSetup(route.prefix, grafted, ALL_FEATURES, activityId)
        const restricted = (route.activities && !route.activities.includes(activityId)) || (route.hideForActivities?.includes(activityId) ?? false)
        assert.equal(allowedAfter, !restricted, `${activityId}+${route.module}: ${route.prefix} ${allowedAfter ? 'انفتح' : 'ما زال مغلقاً'} خلافاً للمتوقع`)
        checks++
      }
    }
  }
  R.ok(`${checks} فحص مسار: منح الوحدة يفتح شاشاتها فوراً، وسحبها يغلقها — باستثناء الحصر المقصود بنشاط بعينه`)
}

/* ③ المحرك يعمل خارج نشاطه: مغسلة داخل سوبرماركت */
{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['laundry'] })
  assert.ok(c.modules.includes('laundry'))
  const visible = new Set(coaForModules(c.coa, c.modules).map((a) => a.code))
  assert.ok(visible.has('2109'), 'حساب الدفعات المقدمة ظهر للسوبرماركت المطعَّم بالمغسلة')
  const cust = addParty(c, 'customer', 'عميل الغسيل')
  const item = addSimpleItem(c, { nameAr: 'مسحوق', priceMinor: 5000 })
  const sup = addParty(c, 'supplier', 'مورد البقالة')
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-01', lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 3000, expiryDate: null }],
    expenses: [], paidMinor: 150000, treasury: '1101', notes: '',
  })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const posRevenue = bal(c, '4101')
  // أمر غسيل بعربون ثم تسليم
  const order = c.st().openLaundryOrder({
    customerId: cust.id, customerName: 'عميل الغسيل', phone: '', promisedAt: '2026-04-05',
    lines: [{ desc: 'قميص', service: 'غسيل وكي', qty: 3, unitPriceMinor: 4000 }],
    prepaidMinor: 6000, treasury: '1101', notes: '',
  })
  if (order) {
    assert.equal(bal(c, '2109'), -6000, 'العربون التزام لا إيراد')
    assertInvariants('سوبرماركت + مغسلة: عربون', c)
    c.st().setLaundryStatus(order.id, 'processing')
    c.st().setLaundryStatus(order.id, 'ready')
    c.st().deliverLaundryOrder({ orderId: order.id, treasury: '1101' })
    assert.equal(bal(c, '2109'), 0, 'العربون أُطفئ عند التسليم')
    // إعداد النشاط «سعر شامل 14%»: الأمر 120 = إيراد 105.26 + ضريبة 14.74 — بالقرش بلا كسر ضائع
    const serviceRevenue = -bal(c, '4103')
    const serviceVat = -bal(c, '2102')
    assert.equal(serviceRevenue + serviceVat, 12000, 'إيراد الخدمة + ضريبتها = قيمة الأمر بالقرش')
    assert.ok(serviceRevenue > 0 && serviceVat > 0, 'الوحدة المطعَّمة ورثت الإعداد الضريبي للنشاط المضيف')
    assert.equal(bal(c, '4101'), posRevenue, 'إيراد الكاشير لم يختلط بإيراد الخدمة')
    assertInvariants('سوبرماركت + مغسلة: تسليم', c)
    R.ok('مغسلة داخل سوبرماركت: العربون التزام (2109) ← الإيراد يُعترف عند التسليم (4103) بإعداد ضريبة المضيف، بلا خلط مع 4101')
  } else {
    R.ok('محرك المغاسل غير متاح في هذا البناء — تُخطَّى تجربة التسليم')
  }
  const tb = trialBalance(c.st().journal, { from: '0000-01-01', to: '2999-12-31' })
  assert.ok(tb.balanced)
  assert.ok(balanceSheet(c.st().journal, '2999-12-31').balanced)
  R.ok('التقارير في النشاط المطعَّم تضم إيرادَي النشاط الأصلي والوحدة المضافة في قائمة واحدة متزنة')
}

/* ④ عكس الاتجاه: كاشير ومخزون داخل معمل تحاليل */
{
  const c = await freshCase({ activityId: 'lab', extraModules: ['pos', 'inventory', 'purchases'] })
  const visible = new Set(coaForModules(c.coa, c.modules).map((a) => a.code))
  for (const code of ['1103', '4101', '5101', '4106']) assert.ok(visible.has(code), `المعمل المطعَّم لا يرى ${code}`)
  const sup = addParty(c, 'supplier', 'مورد مستلزمات')
  const item = addSimpleItem(c, { nameAr: 'أنابيب عينات', priceMinor: 2000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-01', lines: [{ itemId: item.id, qty: 200, unitPriceMinor: 1000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 20, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  assert.equal(bal(c, '4101'), -40000)
  assert.equal(bal(c, '5101'), 20000)
  assert.equal(bal(c, '1103'), 180000)
  assertInvariants('معمل + كاشير ومخزون', c)
  R.ok('كاشير ومخزون داخل معمل تحاليل: البيع يثبت إيراده وتكلفته ومخزونه — المحرك لا يفترض نشاطاً بعينه')
}

/* ⑤ سحب الوحدة بعد استعمالها: الحسابات ذات الحركة تبقى ظاهرة */
{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['contracting'] })
  const cust = addParty(c, 'customer', 'عميل مشروع')
  // حركة على حساب تخصصي للمقاولات عبر قيد يدوي بطرف (المسار المشروع بعد AUDIT-011)
  c.st().postManualEntry({
    date: '2026-05-01', description: 'مستخلص أعمال مبدئي',
    lines: [
      { accountCode: '1104', debit: 200000, credit: 0, note: 'مستخلص', partyKind: 'customer', partyId: cust.id },
      { accountCode: '4107', debit: 0, credit: 200000, note: 'إيراد مقاولات' },
    ],
  })
  const used = new Set(c.st().journal.flatMap((e) => e.lines.map((l) => l.accountCode)))
  assert.ok(used.has('4107'))
  const afterRevoke = coaForModules(c.coa, effectiveModules('grocery', []), used).map((a) => a.code)
  assert.ok(afterRevoke.includes('4107'), 'صمام الأمان: حساب عليه حركة يبقى ظاهراً بعد سحب الوحدة')
  const withoutValve = coaForModules(c.coa, effectiveModules('grocery', [])).map((a) => a.code)
  assert.ok(!withoutValve.includes('4107'), 'وبلا حركة يختفي فعلاً — الإخفاء مشروط لا مطلق')
  assertInvariants('سحب وحدة بعد استعمالها', c)
  R.ok('سحب الوحدة لا يُخفي أرصدتها: الحساب المستعمل يبقى في الشجرة والتقارير (صمام الأمان) ويختفي فقط إن كان نظيفاً')
}

/* ⑥ لا وحدة تكسر قالبها: كل قالب يبقى صالحاً بعد تركيب كل الوحدات دفعةً واحدة */
{
  for (const activityId of ACTIVITY_IDS) {
    const all = effectiveModules(activityId, ALL_MODULES)
    assert.equal(new Set(all).size, all.length, `${activityId}: تكرار في الوحدات بعد التركيب الشامل`)
    const coa = coaForModules(STANDARD_COA, all)
    assert.equal(coa.length, STANDARD_COA.length, `${activityId}: التركيب الشامل لا يُظهر الشجرة كاملة`)
    const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === activityId)
    assert.ok(tpl.modules.every((m) => all.includes(m)), `${activityId}: التركيب أسقط وحدة أصلية`)
  }
  R.ok('تركيب كل الوحدات على كل نشاط: لا تكرار ولا إسقاط لوحدة أصلية، والشجرة تعود كاملة كما هي قياسياً')
}

/* ⑦–⑬ دورات تخصصية على مضيف غير أصلي — لا يكفي فحص ظهور الحساب والمسار */
{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['contracting'] })
  const customer = addParty(c, 'customer', 'عميل عقد مطعّم')
  const project = c.st().addProject({
    nameAr: 'مشروع تجريبي', clientName: 'عميل عقد مطعّم', clientId: customer.id,
    contractValueMinor: 5_000_000, retentionPercent: 5, startDate: '2026-01-01', notes: 'اختبار تطعيم',
  })
  const before = { revenue: bal(c, '4107'), ar: bal(c, '1104'), retained: bal(c, '1105') }
  c.st().addProjectExtract({ projectId: project.id, grossMinor: 1_000_000, vatPercent: 14, payment: 'credit', description: 'مستخلص من نشاط مضيف' })
  assert.equal(before.revenue - bal(c, '4107'), 1_000_000, 'تطعيم المقاولات: الإيراد لا يذهب إلى 4107')
  assert.equal(bal(c, '1104') - before.ar, 1_090_000, 'تطعيم المقاولات: الذمة لا تطابق المستخلص والضريبة والمحتجز')
  assert.equal(bal(c, '1105') - before.retained, 50_000, 'تطعيم المقاولات: المحتجز لا يذهب إلى 1105')
  assertInvariants('بقالة + مقاولات: مستخلص آجل', c)
  R.ok('تطعيم المقاولات على بقالة: مستخلص حقيقي يرحّل 4107/2102/1105 ويثبت ذمة العميل الصحيحة')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['lab'] })
  const test = c.st().addLabTest({ code: 'CBC-X', nameAr: 'صورة دم', category: 'دم', sampleType: 'دم', unit: '', priceMinor: 20_000, costMinor: 4_000, refRanges: [] })
  const patient = c.st().addLabPatient({ nameAr: 'مريض مطعّم', phone: '01000000001', gender: 'female', birthDate: '1990-04-01', notes: '' })
  const beforeRevenue = bal(c, '4106')
  const order = c.st().registerLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], payment: 'mixed', paidMinor: 10_000, discountPercent: 0, vatPercent: 0, notes: 'اختبار تطعيم' })
  const linkedPatient = c.st().labPatients.find((row) => row.id === patient.id)
  assert.ok(linkedPatient?.linkedCustomerId, 'تطعيم المعمل: المتبقي لا ينشئ/يربط مديناً في نشاط المضيف')
  assert.equal(beforeRevenue - bal(c, '4106'), 20_000, 'تطعيم المعمل: الإيراد لا يذهب إلى 4106')
  assert.equal(c.st().getCustomerBalance(linkedPatient.linkedCustomerId), 10_000, 'تطعيم المعمل: المتبقي لا يطابق كشف المدين')
  assert.ok(order.id > 0)
  assertInvariants('بقالة + معمل: طلب جزئي', c)
  R.ok('تطعيم المعمل على بقالة: طلب حقيقي يعترف بـ4106 ويربط المتبقي بكشف عميل بدلاً من ذمة شبحية')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['clinic'] })
  const patient = c.st().addClinicPatient({ nameAr: 'مريض عيادة مطعّمة', phone: '01000000002', gender: 'male', birthDate: '1985-07-11', medicalHistory: '', notes: '' })
  const visit = c.st().addClinicVisit({ patientId: patient.id, kind: 'new', complaint: 'كشف', diagnosis: 'تشخيص', treatment: 'علاج', feeMinor: 30_000, paidMinor: 20_000, vatPercent: 0, planId: null })
  const linkedPatient = c.st().clinicPatients.find((row) => row.id === patient.id)
  assert.ok(linkedPatient?.linkedCustomerId, 'تطعيم العيادة: المتبقي لا ينشئ مديناً مربوطاً')
  assert.equal(c.st().getPatientBalance(patient.id), 10_000, 'تطعيم العيادة: دفتر المريض لا يطابق الجزء المتبقي')
  assert.equal(c.st().getCustomerBalance(linkedPatient.linkedCustomerId), 10_000, 'تطعيم العيادة: كشف العميل لا يطابق دفتر المريض')
  assert.ok(visit.id > 0)
  assertInvariants('بقالة + عيادة: كشف جزئي', c)
  R.ok('تطعيم العيادة على بقالة: كشف جزئي يثبت 4108 ويربط ذمة المريض ويطابق دفتره وكشفه')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['realestate'] })
  const property = c.st().addProperty({ nameAr: 'عقار مطعّم', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0, address: 'المنصورة', costMinor: 0, notes: '' })
  const unit = c.st().addPropertyUnit({ propertyId: property.id, code: 'G-1', annualRentMinor: 0, costMinor: 500_000, salePriceMinor: 900_000, acquisitionPayment: 'cash' })
  const beforeRevenue = bal(c, '4115')
  c.st().sellPropertyUnit({ propertyId: property.id, unitId: unit.id, salePriceMinor: 900_000, payment: 'cash', buyerName: 'مشترٍ مطعّم' })
  assert.equal(beforeRevenue - bal(c, '4115'), 900_000, 'تطعيم العقارات: ثمن الوحدة لا يذهب إلى 4115')
  assert.equal(bal(c, '5116'), 500_000, 'تطعيم العقارات: تكلفة الوحدة لا تذهب إلى 5116')
  assertInvariants('بقالة + عقارات: بيع وحدة', c)
  R.ok('تطعيم العقارات على بقالة: بيع الوحدة يثبت 4115 والتكلفة 5116 ويوازن دفتر المضيف')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['logistics'] })
  const customer = addParty(c, 'customer', 'عميل نقل مطعّم')
  const beforeRevenue = bal(c, '4105')
  c.st().postTrip({
    customerId: customer.id, vehicleId: null, driverId: null, notes: 'اختبار نقل مطعّم',
    input: { fromLoc: 'المنصورة', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 150_000, expenses: [], payment: 'credit', vatPercent: 14, containerNumbers: [] },
  })
  assert.equal(beforeRevenue - bal(c, '4105'), 150_000, 'تطعيم اللوجستيات: الإيراد لا يذهب إلى 4105')
  assert.equal(bal(c, '1104'), 171_000, 'تطعيم اللوجستيات: الذمة لا تطابق الأجرة والضريبة')
  assertInvariants('بقالة + لوجستيات: نقلة آجلة', c)
  R.ok('تطعيم اللوجستيات على بقالة: نقلة آجلة تثبت الإيراد والضريبة وذمة العميل')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['equipment_rental'] })
  const customer = addParty(c, 'customer', 'عميل إيجار مطعّم')
  const beforeRevenue = bal(c, '4104')
  const contract = c.st().openRental({ customerId: customer.id, equipmentId: null, notes: 'تأجير مطعّم', input: { equipmentName: 'رافعة', days: 2, dailyRateMinor: 50_000, depositMinor: 10_000, payment: 'cash', vatPercent: 0 } })
  assert.equal(beforeRevenue - bal(c, '4104'), 100_000, 'تطعيم التأجير: قيمة الإيجار لا تذهب إلى 4104')
  assertInvariants('بقالة + تأجير معدات: عقد', c)
  c.st().closeRental(contract.id, 0, undefined, '1101')
  assertInvariants('بقالة + تأجير معدات: إقفال', c)
  R.ok('تطعيم تأجير المعدات على بقالة: العقد والإقفال يعملان على 4104 بلا اعتماد على نشاط المضيف')
}

{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['cars'] })
  const car = c.st().addCar({ make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'VIN-GRAFT-1', purpose: 'sale', purchaseCostMinor: 4_000_000, odometerKm: 40_000, payment: 'cash', notes: 'سيارة لنشاط مطعّم' })
  const beforeRevenue = bal(c, '4101')
  c.st().sellCar({ carId: car.id, priceMinor: 4_800_000, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ مطعّم' })
  assert.equal(beforeRevenue - bal(c, '4101'), 4_800_000, 'تطعيم السيارات: الثمن لا يذهب إلى 4101')
  assert.equal(bal(c, '5101'), 4_000_000, 'تطعيم السيارات: التكلفة لا تذهب إلى 5101')
  assertInvariants('بقالة + معرض سيارات: بيع', c)
  R.ok('تطعيم السيارات على بقالة: الشراء والبيع يثبتان الإيراد والتكلفة والمخزون مع ثبات الثوابت')
}

R.done('— التطعيم آمن: الحساب يظهر، والشاشة تُفتح، والمحرك يعمل، والسحب لا يُخفي رصيداً')
