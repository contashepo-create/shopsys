/**
 * المرحلة 8 من تدقيق المالك — دورة إيراد **حيّة** لكل نشاط متخصص
 * ────────────────────────────────────────────────────────────────
 * الفجوة التي تغلقها هذه البوابة:
 *   `verify_phase3_activity_revenue_map` يثبت الخريطة **نصياً** (لكل نشاط حساب
 *   إيراد ومسار ترحيل مذكور في المصفوفة)، و`verify_phase3_activities_sweep`
 *   يمرّ على الأنشطة الثمانية المتخصصة بمصروف فقط لأن بيعها ليس كاشير.
 *   فبقي سؤال المالك بلا جواب محرَّك: «هل نشاطي نفسه يكسب صحيحاً؟»
 *
 * هنا نشغّل **المحرك الحقيقي** (`repo.ts`) لكل نشاط متخصص: نفتح مستنده الجوهري،
 * نحصّل جزءاً، ونتحقق من ثلاثة أمور معاً:
 *   ① الإيراد هبط على حساب النشاط الجوهري بالقرش الصحيح (ووعاء الضريبة منفصل).
 *   ② الطرف والخزينة تحرّكا بما يطابق التحصيل (لا ذمة معلّقة بلا صاحب).
 *   ③ الثوابت المحاسبية صامدة بعد كل خطوة، والميزان والميزانية متزنان في الختام.
 *
 * ملاحظة منهجية: نقيس **الفرق** قبل/بعد كل عملية لا الرصيد المطلق، حتى تبقى
 * البوابة صحيحة لو تغيّرت البذرة الافتتاحية للنشاط لاحقاً.
 */
import assert from 'node:assert/strict'
import { freshCase, balanceOf, assertInvariants, addParty, reporter } from './auditKit.mjs'

const R = reporter('المرحلة 8 — دورة إيراد حيّة لكل نشاط متخصص')

/** رصيد دائن لحساب إيراد (الإيراد دائن ⇒ سالب في معادلة مدين−دائن) */
const revenueOf = (c, code) => -balanceOf(c.st().journal, code)
const cashOf = (c) => balanceOf(c.st().journal, '1101')
const arOf = (c) => balanceOf(c.st().journal, '1104')
const vatOf = (c) => -balanceOf(c.st().journal, '2102')

/* ① مقاولات — مستخلص مشروع: الإيراد 4107 والضريبة 2102 وذمة العميل 1104 */
{
  const c = await freshCase({ activityId: 'contracting', vatPercent: 14, taxInclusive: false })
  const customer = addParty(c, 'customer', 'شركة الإعمار للمقاولات')
  const project = c.st().addProject({
    nameAr: 'مشروع مدرسة المنصورة', clientName: 'شركة الإعمار للمقاولات', clientId: customer.id,
    contractValueMinor: 5_000_000, retentionPercent: 5, startDate: '2026-01-05', notes: 'عقد أشغال عامة',
  })
  assertInvariants('مقاولات — بعد فتح المشروع', c)

  const before = { rev: revenueOf(c, '4107'), ar: arOf(c), vat: vatOf(c) }
  c.st().addProjectExtract({
    projectId: project.id, grossMinor: 1_000_000, vatPercent: 14,
    payment: 'credit', description: 'مستخلص أول — أعمال حفر وأساسات',
  })
  assertInvariants('مقاولات — بعد المستخلص', c)
  const afterExtract = { rev: revenueOf(c, '4107'), ar: arOf(c), vat: vatOf(c) }
  assert.equal(afterExtract.rev - before.rev, 1_000_000, 'إيراد المقاولات لم يهبط على 4107 بقيمة المستخلص')
  assert.equal(afterExtract.vat - before.vat, 140_000, 'ضريبة المستخلص ليست 14% فوق قيمة الأعمال')
  assert.equal(afterExtract.ar - before.ar, 1_090_000, 'ذمة العميل لا تساوي المستحق بعد حجز ضمان الأعمال')
  assert.equal(balanceOf(c.st().journal, '1105'), 50_000, 'محتجز ضمان الأعمال 5% لم يُرحَّل على 1105')

  const cashBefore = cashOf(c)
  c.st().receiveClientPayment({ customerId: customer.id, amountMinor: 500_000, treasury: '1101' })
  assertInvariants('مقاولات — بعد تحصيل جزئي', c)
  assert.equal(cashOf(c) - cashBefore, 500_000, 'الخزينة لم تستلم التحصيل الجزئي')
  assert.equal(arOf(c) - afterExtract.ar, -500_000, 'ذمة العميل لم تنخفض بقيمة التحصيل')
  R.ok('مقاولات: مستخلص 10,000 ⇒ 4107 كاملاً · 2102 بـ14% · محتجز 5% على 1105 · ذمة 10,900 — والتحصيل الجزئي 5,000 ينقصها ويزيد الخزينة')
}

/* ② معمل تحاليل — طلب فحوصات: الإيراد 4106 وعمولة المُحيل 5109/2105 */
{
  const c = await freshCase({ activityId: 'lab', vatPercent: 0, taxInclusive: false })
  const test = c.st().addLabTest({ code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم وريدي', unit: '', priceMinor: 20_000, costMinor: 4_000, refRanges: [] })
  const patient = c.st().addLabPatient({ nameAr: 'مريم عبد الله', phone: '01000000001', gender: 'female', birthDate: '1990-04-01', notes: '' })
  const referrer = c.st().addLabReferrer({ nameAr: 'د. سامي', phone: '01000000009', commissionPercent: 10, notes: '' })

  const before = { rev: revenueOf(c, '4106'), cash: cashOf(c), comm: balanceOf(c.st().journal, '5109'), due: -balanceOf(c.st().journal, '2105') }
  c.st().registerLabOrder({
    patientId: patient.id, referrerId: referrer.id, testIds: [test.id],
    payment: 'cash', discountPercent: 0, vatPercent: 0, notes: 'طلب عيادة خارجية',
  })
  assertInvariants('معمل — بعد طلب التحاليل', c)
  assert.equal(revenueOf(c, '4106') - before.rev, 20_000, 'إيراد التحاليل لم يهبط على 4106')
  assert.equal(cashOf(c) - before.cash, 20_000, 'التحصيل النقدي لم يدخل الخزينة')
  assert.equal(balanceOf(c.st().journal, '5109') - before.comm, 2_000, 'عمولة المُحيل لم تُثبت مصروفاً 5109')
  assert.equal(-balanceOf(c.st().journal, '2105') - before.due, 2_000, 'عمولة المُحيل لم تُستحق على 2105')
  R.ok('معمل: طلب 200 نقداً ⇒ 4106 بالكامل وخزينة +200، وعمولة المُحيل 10% تُستحق 5109/2105 ولا تُدفع الآن')
}

/* ③ عيادة — كشف بسداد جزئي: الإيراد 4108 والباقي ذمة على المريض */
{
  const c = await freshCase({ activityId: 'clinic', vatPercent: 0, taxInclusive: false })
  const patient = c.st().addClinicPatient({ nameAr: 'خالد منصور', phone: '01000000002', gender: 'male', birthDate: '1985-07-11', medicalHistory: '', notes: '' })
  const before = { rev: revenueOf(c, '4108'), cash: cashOf(c), ar: arOf(c) }
  c.st().addClinicVisit({
    patientId: patient.id, kind: 'new', complaint: 'ألم بالركبة', diagnosis: 'التهاب', treatment: 'مضاد التهاب',
    feeMinor: 30_000, paidMinor: 20_000, vatPercent: 0, planId: null,
  })
  assertInvariants('عيادة — بعد الكشف', c)
  assert.equal(revenueOf(c, '4108') - before.rev, 30_000, 'إيراد العيادة لم يهبط على 4108 بكامل الأتعاب')
  assert.equal(cashOf(c) - before.cash, 20_000, 'المدفوع لم يدخل الخزينة')
  assert.equal(arOf(c) - before.ar, 10_000, 'باقي الكشف لم يُسجَّل ذمة على المريض')

  const pb = c.st().getPatientBalance(patient.id)
  assert.equal(pb, 10_000, `رصيد المريض في دفتره المساعد (${pb}) لا يطابق الذمة الدفترية`)
  c.st().collectFromPatient(patient.id, 10_000, '1101')
  assertInvariants('عيادة — بعد تحصيل الباقي', c)
  assert.equal(c.st().getPatientBalance(patient.id), 0, 'تحصيل الباقي لم يُصفِّر رصيد المريض')
  R.ok('عيادة: كشف 300 بسداد 200 ⇒ 4108 كاملاً وذمة 100 مطابقة لدفتر المريض، والتحصيل يُصفّرها')
}

/* ④ عقارات — إيجار وبيع وحدة: الإيجار 4113 والبيع 4115 بتكلفته 5116 */
{
  const c = await freshCase({ activityId: 'realestate', vatPercent: 0, taxInclusive: false })
  const property = c.st().addProperty({
    nameAr: 'برج النيل', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0,
    address: 'المنصورة', costMinor: 0, notes: 'عقار مملوك للمكتب',
  })
  const rented = c.st().addPropertyUnit({ propertyId: property.id, code: 'A-1', annualRentMinor: 120_000, costMinor: 400_000, salePriceMinor: 700_000, acquisitionPayment: 'cash' })
  const forSale = c.st().addPropertyUnit({ propertyId: property.id, code: 'A-2', annualRentMinor: 120_000, costMinor: 500_000, salePriceMinor: 900_000, acquisitionPayment: 'cash' })
  assertInvariants('عقارات — بعد اقتناء وحدتين', c)

  // ① الإيجار: عقد سنوي بأقساط شهرية — التحصيل يعترف بإيراد الإيجار 4113
  const lease = c.st().addLease({
    propertyId: property.id, unitId: rented.id, tenantName: 'مستأجر أول', tenantId: null,
    startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 120_000, depositMinor: 10_000,
  })
  assertInvariants('عقارات — بعد توقيع العقد', c)
  const rentBefore = revenueOf(c, '4113')
  c.st().collectLeaseInstallment({ leaseId: lease.id, seq: 1, treasury: '1101' })
  assertInvariants('عقارات — بعد تحصيل قسط إيجار', c)
  assert.equal(revenueOf(c, '4113') - rentBefore, 10_000, 'قسط الإيجار لم يُعترف به على 4113')

  // ② البيع: إيراد 4115 وتكلفة الوحدة 5116 تخرج من الأصول
  const before = { rev: revenueOf(c, '4115'), cost: balanceOf(c.st().journal, '5116'), cash: cashOf(c) }
  c.st().sellPropertyUnit({ propertyId: property.id, unitId: forSale.id, salePriceMinor: 900_000, payment: 'cash', buyerName: 'مشترٍ نقدي' })
  assertInvariants('عقارات — بعد بيع الوحدة', c)
  assert.equal(revenueOf(c, '4115') - before.rev, 900_000, 'إيراد بيع الوحدة لم يهبط على 4115')
  assert.equal(balanceOf(c.st().journal, '5116') - before.cost, 500_000, 'تكلفة الوحدة المباعة لم تُحمَّل على 5116')
  assert.equal(cashOf(c) - before.cash, 900_000, 'ثمن الوحدة لم يدخل الخزينة')
  R.ok('عقارات: قسط إيجار 100 ⇒ 4113، وبيع وحدة بـ9,000 ⇒ 4115 بالثمن و5116 بالتكلفة 5,000 — مجمل ربح 4,000')
}

/* ⑤ لوجستيات — نقلة آجلة: الإيراد 4105 وذمة العميل ومصاريف الرحلة */
{
  const c = await freshCase({ activityId: 'logistics', vatPercent: 14, taxInclusive: false })
  const customer = addParty(c, 'customer', 'مصنع الدلتا للأسمنت')
  const before = { rev: revenueOf(c, '4105'), ar: arOf(c), vat: vatOf(c) }
  c.st().postTrip({
    customerId: customer.id, vehicleId: null, driverId: null, notes: 'نقلة أسمنت',
    input: { fromLoc: 'المنصورة', toLoc: 'القاهرة', qty: 2, unitPriceMinor: 150_000, expenses: [], payment: 'credit', vatPercent: 14, containerNumbers: [] },
  })
  assertInvariants('لوجستيات — بعد النقلة', c)
  assert.equal(revenueOf(c, '4105') - before.rev, 300_000, 'إيراد النقل لم يهبط على 4105 (نقلتان × 1500)')
  assert.equal(vatOf(c) - before.vat, 42_000, 'ضريبة النقل ليست 14% فوق الإيراد')
  assert.equal(arOf(c) - before.ar, 342_000, 'ذمة العميل لا تساوي الإيراد بضريبته')
  R.ok('لوجستيات: نقلتان بـ3,000 آجل ⇒ 4105 بالإيراد و2102 بـ14% وذمة 3,420 على العميل')
}

/* ⑥ مغاسل — عربون ثم تسليم: العربون التزام 2109 والإيراد 4103 عند التسليم فقط */
{
  const c = await freshCase({ activityId: 'laundry', vatPercent: 0, taxInclusive: false })
  const before = { rev: revenueOf(c, '4103'), adv: -balanceOf(c.st().journal, '2109'), cash: cashOf(c) }
  const order = c.st().openLaundryOrder({
    customerId: null, customerName: 'أم أحمد', phone: '01000000003', promisedAt: '2026-02-02',
    lines: [{ desc: 'قميص قطن', service: 'wash_iron', qty: 5, unitPriceMinor: 4_000 }],
    prepaidMinor: 10_000, treasury: '1101', notes: 'طلب عادي',
  })
  assertInvariants('مغاسل — بعد فتح الأمر', c)
  assert.equal(revenueOf(c, '4103') - before.rev, 0, 'الإيراد اعتُرف قبل التسليم — خطأ في توقيت الاعتراف')
  assert.equal(-balanceOf(c.st().journal, '2109') - before.adv, 10_000, 'العربون لم يُثبت التزاماً على 2109')

  c.st().setLaundryStatus(order.id, 'processing')
  c.st().setLaundryStatus(order.id, 'ready')
  c.st().deliverLaundryOrder({ orderId: order.id, treasury: '1101' })
  assertInvariants('مغاسل — بعد التسليم', c)
  assert.equal(revenueOf(c, '4103') - before.rev, 20_000, 'إيراد المغسلة عند التسليم لا يساوي قيمة الأمر')
  assert.equal(-balanceOf(c.st().journal, '2109') - before.adv, 0, 'العربون لم يُصفَّ من الالتزامات عند التسليم')
  assert.equal(cashOf(c) - before.cash, 20_000, 'إجمالي المقبوض لا يساوي قيمة الأمر')
  R.ok('مغاسل: عربون 100 يبقى التزاماً 2109، والتسليم يعترف بـ200 على 4103 ويصفّي العربون — لا إيراد قبل أوانه')
}

/* ⑦ تأجير معدات — عقد بتأمين: الإيراد 4104 والتأمين التزام لا إيراد */
{
  const c = await freshCase({ activityId: 'equipment_rental', vatPercent: 0, taxInclusive: false })
  const customer = addParty(c, 'customer', 'مقاولات الشرق')
  const before = { rev: revenueOf(c, '4104'), cash: cashOf(c) }
  const contract = c.st().openRental({
    customerId: customer.id, equipmentId: null, notes: 'حفار يومي',
    input: { equipmentName: 'حفار كاتربيلر', days: 4, dailyRateMinor: 100_000, depositMinor: 50_000, payment: 'cash', vatPercent: 0 },
  })
  assertInvariants('تأجير — بعد فتح العقد', c)
  assert.equal(revenueOf(c, '4104') - before.rev, 400_000, 'إيراد الإيجار لم يهبط على 4104 (4 أيام × 1000)')
  assert.equal(cashOf(c) - before.cash, 450_000, 'المقبوض لا يساوي الإيجار + التأمين')
  const revBeforeClose = revenueOf(c, '4104')
  c.st().closeRental(contract.id, 10_000, undefined, '1101')
  assertInvariants('تأجير — بعد إقفال العقد بخصم', c)
  assert.equal(revenueOf(c, '4104') - revBeforeClose, 10_000, 'الخصم من التأمين لم يُعترف به إيراداً 4104')
  R.ok('تأجير معدات: عقد 4 أيام ⇒ 4104 بـ4,000 والتأمين مقبوض بلا إيراد، وخصم الإقفال 100 وحده يصير إيراداً')
}

/* ⑧ معرض سيارات — شراء ثم بيع: الإيراد 4101 وتكلفة المبيعات 5101 من 1103 */
{
  const c = await freshCase({ activityId: 'cars', vatPercent: 0, taxInclusive: false })
  const car = c.st().addCar({
    make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'ق ر ع 1234', purpose: 'sale',
    purchaseCostMinor: 40_000_000, odometerKm: 40_000, payment: 'cash', notes: 'شراء نقدي للمعرض',
  })
  assertInvariants('سيارات — بعد الشراء', c)
  const stockAfterBuy = balanceOf(c.st().journal, '1103')
  assert.equal(stockAfterBuy, 40_000_000, 'ثمن السيارة لم يدخل المخزون 1103')

  const before = { rev: revenueOf(c, '4101'), cogs: balanceOf(c.st().journal, '5101'), cash: cashOf(c) }
  c.st().sellCar({ carId: car.id, priceMinor: 48_000_000, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ نقدي' })
  assertInvariants('سيارات — بعد البيع', c)
  assert.equal(revenueOf(c, '4101') - before.rev, 48_000_000, 'إيراد بيع السيارة لم يهبط على 4101')
  assert.equal(balanceOf(c.st().journal, '5101') - before.cogs, 40_000_000, 'تكلفة السيارة المباعة لم تُحمَّل على 5101')
  assert.equal(balanceOf(c.st().journal, '1103'), 0, 'السيارة المباعة ما زالت في المخزون')
  assert.equal(cashOf(c) - before.cash, 48_000_000, 'ثمن البيع لم يدخل الخزينة')
  R.ok('سيارات: شراء بـ400,000 ثم بيع بـ480,000 نقداً ⇒ 4101 بالثمن و5101 بالتكلفة و1103 يفرغ — مجمل ربح 80,000')
}

/* ⑨ الحصيلة: الأنشطة الثمانية كلها تُنهي دورتها بميزان وميزانية متزنين */
{
  const { trialBalance, incomeStatement, balanceSheet } = await import('../src/core/financialReports.ts')
  const cases = [
    ['contracting', '4107'], ['lab', '4106'], ['clinic', '4108'], ['realestate', '4113'],
    ['logistics', '4105'], ['laundry', '4103'], ['equipment_rental', '4104'], ['cars', '4101'],
  ]
  let checked = 0
  for (const [activityId, revenueCode] of cases) {
    const c = await freshCase({ activityId })
    const coa = c.coa
    const account = coa.find((a) => a.code === revenueCode)
    assert.ok(account, `${activityId}: حساب الإيراد ${revenueCode} غائب عن شجرة النشاط`)
    assert.ok(account.isPostable !== false, `${activityId}: حساب الإيراد ${revenueCode} غير قابل للترحيل`)
    const tb = trialBalance(c.st().journal, coa)
    assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, `${activityId}: ميزان المراجعة غير متزن`)
    const bs = balanceSheet(c.st().journal, '2026-12-31')
    assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor, `${activityId}: المعادلة المحاسبية مكسورة`)
    assert.ok(bs.balanced, `${activityId}: الميزانية تعلن عدم اتزانها`)
    const is = incomeStatement(c.st().journal, { from: '2026-01-01', to: '2026-12-31' })
    assert.ok(Number.isInteger(is.netProfitMinor), `${activityId}: صافي الربح ليس قرشاً صحيحاً`)
    checked += 1
  }
  assert.equal(checked, 8, 'لم تُفحص الأنشطة المتخصصة الثمانية كلها')
  R.ok('الأنشطة المتخصصة الثمانية: حساب الإيراد مرئي وقابل للترحيل، والميزان والمعادلة المحاسبية متزنان في كل واحد منها')
}

R.done()
