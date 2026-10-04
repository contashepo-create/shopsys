/**
 * البندان المتبقيان من تقرير التدقيق المحاسبي (§8):
 *
 *   ① **عملة ثانية داخل السند** — تحصيل/سداد بعملة غير عملة الدفتر.
 *      القرار: الدفتر أحادي العملة؛ السند يحمل المبلغ الأجنبي وسعر الصرف،
 *      والمرحَّل هو حاصل التحويل بعملة الدفتر بحساب صحيح بلا كسور عائمة.
 *
 *   ② **تخصيص السند على مستندات نشاط متخصص من شاشة السندات** — كانت شاشة
 *      السندات لا تعرض إلا فواتير البيع/الشراء (والمستخلص)، فصار كل مستند
 *      يحمل ذمة على الطرف قابلاً للتخصيص بمفتاح ثابت: معمل · عيادة · تأجير ·
 *      نقل · صيانة · محافظ · معرض سيارات · وحدات عقارية · فواتير سيارات ·
 *      تجهيز · تكاليف مشاريع.
 *
 * وتحرس البوابة أيضاً **إصلاح ازدواج تسوية العيادة**: سند مخصَّص لفاتورة بيع
 * كان يُنشئ تحصيل عيادة بكامل قيمته فيُسدَّد مستندان بنفس النقود.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_voucher_fx_and_specialized.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshCase, addParty, addSimpleItem, assertInvariants, expectReject, reporter } from './auditKit.mjs'
import { convertFxToBookMinor, parseRateToPpm, formatRate, validateFxLeg, describeFxLeg } from '../src/core/foreignCurrency.ts'
import { openCustomerSpecializedDocuments, openSupplierSpecializedDocuments, documentKindLabel } from '../src/core/openPartyDocuments.ts'

const R = reporter('العملة الثانية وتخصيص السند على مستندات الأنشطة')
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ① حساب التحويل: أعداد صحيحة، تقريب نصفي لأعلى، وعملات بثلاث خانات */
{
  const usd = { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }
  assert.equal(convertFxToBookMinor(usd, 2), 485000, '100.00 USD × 48.5 = 4,850.00')
  // كسر يقع في منتصف الوحدة الصغرى ⇒ لأعلى
  assert.equal(convertFxToBookMinor({ ...usd, amountMinor: 1, ratePpm: 48_500_000 }, 2), 49, 'سنت واحد × 48.5 = 0.485 ⇒ 0.49')
  // عملة بثلاث خانات (دينار كويتي) إلى دفتر بخانتين
  assert.equal(convertFxToBookMinor({ currencyCode: 'KWD', amountMinor: 1000, ratePpm: 157_300_000, decimals: 3 }, 2), 15730, '1 KWD × 157.3 = 157.30')
  // مبالغ ضخمة: لا فقدان دقة (BigInt داخلياً)
  assert.equal(convertFxToBookMinor({ currencyCode: 'USD', amountMinor: 999_999_999, ratePpm: 48_500_000, decimals: 2 }, 2), 48_499_999_952)
  assert.equal(parseRateToPpm('48.5'), 48_500_000)
  assert.equal(parseRateToPpm('٤٨٫٧٥'), 48_750_000, 'أرقام عربية وفاصلة عربية')
  assert.equal(formatRate(48_500_000), '48.5')
  assert.equal(describeFxLeg(usd, 485000, 2), '100.00 USD × 48.5 = 4850.00')
  R.ok('تحويل العملة بأعداد صحيحة: تقريب نصفي لأعلى · عملة ثلاثية الخانات · مبالغ ضخمة بلا فقدان دقة')
}

/* ② فحوص ساق العملة: رمز صالح، ليست عملة الدفتر، مبلغ وسعر موجبان */
{
  assert.deepEqual(validateFxLeg({ currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }, 'EGP'), [])
  assert.ok(validateFxLeg({ currencyCode: 'EGP', amountMinor: 100, ratePpm: 1_000_000, decimals: 2 }, 'EGP').some((e) => e.includes('عملة الدفتر')))
  assert.ok(validateFxLeg({ currencyCode: 'US', amountMinor: 100, ratePpm: 1, decimals: 2 }, 'EGP').some((e) => e.includes('ثلاثة حروف')))
  assert.ok(validateFxLeg({ currencyCode: 'USD', amountMinor: 0, ratePpm: 1, decimals: 2 }, 'EGP').some((e) => e.includes('أكبر من صفر')))
  assert.ok(validateFxLeg({ currencyCode: 'USD', amountMinor: 100, ratePpm: 0, decimals: 2 }, 'EGP').some((e) => e.includes('سعر الصرف')))
  R.ok('ساق العملة مرفوضة بنص عربي عند: رمز خاطئ · عملة الدفتر نفسها · مبلغ أو سعر غير موجب')
}

/* ③ سند قبض بعملة أجنبية: القيد بعملة الدفتر، والساق محفوظة على السند وفي وصف القيد */
{
  const c = await freshCase({ activityId: 'general' })
  const customer = addParty(c, 'customer', 'شركة التصدير')
  const item = addSimpleItem(c, { nameAr: 'خدمة استشارية', priceMinor: 1_000_000, isService: true })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1_000_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId: customer.id, payment: 'credit', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const before = c.st().getCustomerBalance(customer.id)
  assert.equal(before, 1_000_000, 'دين العميل 10,000.00')

  // 100.00 دولاراً بسعر 48.5 = 4,850.00 جنيهاً
  const voucher = c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 485000,
    description: 'تحصيل دفعة بالدولار', partyKind: 'customer', partyId: customer.id,
    fx: { currencyCode: 'usd', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  assert.equal(voucher.amountMinor, 485000, 'المرحَّل بعملة الدفتر')
  assert.deepEqual(voucher.fx, { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }, 'الساق محفوظة بحروف كبيرة')
  const entry = c.st().journal.find((row) => row.id === voucher.journalEntryId)
  assert.ok(entry.description.includes('100.00 USD × 48.5 = 4850.00'), 'وصف القيد لا يحمل سعر الصرف المستعمل')
  assert.equal(entry.lines.reduce((sum, line) => sum + line.debit, 0), 485000)
  assert.equal(c.st().getCustomerBalance(customer.id), before - 485000, 'الذمة تنقص بالمحوَّل لا بالمبلغ الأجنبي')
  assertInvariants('سند بعملة أجنبية', c)

  // تلاعب: مبلغ لا يساوي حاصل التحويل ⇒ رفض بلا أثر
  expectReject('مبلغ السند ≠ حاصل التحويل', c, () => c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 500000,
    description: 'تلاعب', partyKind: 'customer', partyId: customer.id,
    fx: { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP',
  }), /لا يساوي حاصل التحويل/)
  expectReject('عملة السند = عملة الدفتر', c, () => c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 10000,
    description: 'نفس العملة', partyKind: 'customer', partyId: customer.id,
    fx: { currencyCode: 'EGP', amountMinor: 10000, ratePpm: 1_000_000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP',
  }), /عملة الدفتر/)
  R.ok('سند قبض بالدولار: القيد بعملة الدفتر والساق موثقة — والتلاعب بالمبلغ أو العملة مرفوض بلا أثر')
}

/* ④ النواة: كل مستند نشاط متخصص يخرج بمفتاح ثابت وذمة صحيحة */
{
  const rows = openCustomerSpecializedDocuments({
    customerId: 1,
    settledOf: (key) => (key === 'lab:1' ? 5000 : 0),
    labOrders: [{ id: 1, orderNumber: 'LAB-0001', date: '2026-03-01', patientId: 7, payment: 'credit', paidMinor: 0, totals: { totalMinor: 20000 } }],
    linkedLabPatientIds: [7],
    clinicVisits: [
      { id: 1, visitNumber: 'VIS-0001', date: '2026-01-05', patientId: 3, totals: { totalMinor: 30000, paidMinor: 20000, dueMinor: 10000 } },
      { id: 2, visitNumber: 'VIS-0002', date: '2026-02-05', patientId: 3, totals: { totalMinor: 40000, paidMinor: 0, dueMinor: 40000 } },
    ],
    clinicCollections: [{ patientId: 3, date: '2026-02-10', amountMinor: 10000 }],
    linkedPatientIds: [3],
    rentals: [{ id: 4, contractNumber: 'RC-0004', date: '2026-02-01', customerId: 1, totals: { grandMinor: 50000, collectCreditMinor: 15000 } }],
    trips: [{ id: 2, tripNumber: 'TR-0002', date: '2026-02-03', customerId: 1, payment: 'credit', paidMinor: 5000, totals: { grandMinor: 25000 } }],
    tickets: [
      { id: 6, ticketNumber: 'MT-0006', customerId: 1, deliveredAt: '2026-02-20', totals: { grandMinor: 18000, paidMinor: 3000 } },
      { id: 7, ticketNumber: 'MT-0007', customerId: 1, deliveredAt: null, totals: { grandMinor: 90000, paidMinor: 0 } },
    ],
    walletOps: [{ id: 9, opNumber: 'WS-0009', date: '2026-02-11', customerId: 1, status: 'done', chargeMinor: 4000, paidMinor: 1000 }],
    cars: [{ id: 5, make: 'تويوتا', model: 'كورولا', plateOrVin: 'ح ط ب 1', buyerCustomerId: 1, salePayment: 'credit', salePaidMinor: 100000, saleTotalMinor: 400000, soldAt: '2026-02-15' }],
    propertySales: [{ id: 3, saleNumber: 'RS-0003', date: '2026-02-18', buyerCustomerId: 1, dueMinor: 250000 }],
  })
  const byKey = Object.fromEntries(rows.map((row) => [row.docKey, row]))
  assert.equal(byKey['lab:1'].dueMinor, 20000)
  assert.equal(byKey['lab:1'].settledMinor, 5000, 'المخصص سابقاً يظهر على المستند')
  // تحصيل المريض 10,000 يُستهلك على أقدم زيارة (الأولى) فتختفي، وتبقى الثانية كاملة
  assert.ok(!byKey['visit:1'], 'الزيارة الأقدم سُدِّدت بتحصيل المريض')
  assert.equal(byKey['visit:2'].dueMinor, 40000)
  assert.equal(byKey['rental:4'].dueMinor, 15000, 'الإيجار: الجزء الآجل فقط')
  assert.equal(byKey['trip:2'].dueMinor, 20000)
  assert.equal(byKey['ticket:6'].dueMinor, 15000)
  assert.ok(!byKey['ticket:7'], 'تذكرة لم تُسلَّم ⇒ لا ذمة (نفس قاعدة الكشف)')
  assert.equal(byKey['wallet:9'].dueMinor, 3000)
  assert.equal(byKey['carsale:5'].dueMinor, 300000)
  assert.equal(byKey['propsale:3'].dueMinor, 250000)
  const supplierRows = openSupplierSpecializedDocuments({
    supplierId: 2,
    settledOf: () => 0,
    carPurchaseInvoices: [{ id: 1, invoiceNumber: 'CPI-0001', date: '2026-01-02', supplierId: 2, dueMinor: 700000, carIds: [1, 2] }],
    carPrepCosts: [{ id: 3, carId: 1, date: '2026-01-09', description: 'دهان', supplierId: 2, dueMinor: 40000 }],
    projectCosts: [{ id: 8, date: '2026-01-20', description: 'حديد تسليح', supplierId: 2, dueMinor: 150000 }],
  })
  assert.deepEqual(supplierRows.map((row) => row.docKey), ['carinv:1', 'carprep:3', 'projcost:8'])
  assert.equal(documentKindLabel('lab:1'), 'معمل تحاليل')
  assert.equal(documentKindLabel('projcost:8'), 'تكلفة مشروع')
  R.ok('النواة: ١١ نوع مستند متخصص بمفاتيح ثابتة وذمم مطابقة لقواعد كشف الحساب (التذكرة غير المسلَّمة لا ذمة لها)')
}

/* ⑤ المحرك: طلب معمل آجل يظهر في شاشة السندات ويُخصَّص ويُغلق */
{
  const c = await freshCase({ activityId: 'lab' })
  const customer = addParty(c, 'customer', 'شركة التأمين الأهلية')
  const patient = c.st().addLabPatient({ nameAr: 'سمير فؤاد', phone: '0100', gender: 'male', birthDate: '1980-01-01', notes: '', linkedCustomerId: customer.id })
  c.st().addLabTest({ code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم وريدي', unit: '', priceMinor: 15000, costMinor: 3000, refRanges: [] })
  const test = c.st().labTests[c.st().labTests.length - 1]
  const order = c.st().registerLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], payment: 'credit', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
  const due = order.totals.totalMinor
  assert.ok(due > 0)

  const open = c.st().getOpenClientInvoices(customer.id)
  const labDoc = open.find((row) => row.docKey === `lab:${order.id}`)
  assert.ok(labDoc, 'طلب المعمل لا يظهر في مستندات العميل المفتوحة')
  assert.equal(labDoc.dueMinor, due)

  const voucher = c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: due,
    description: 'تحصيل طلب معمل', partyKind: 'customer', partyId: customer.id,
    allocations: [{ docKey: `lab:${order.id}`, appliedMinor: due }],
  })
  assert.deepEqual(voucher.allocations?.map((row) => ({ docKey: row.docKey, appliedMinor: row.appliedMinor })), [{ docKey: `lab:${order.id}`, appliedMinor: due }], 'التخصيص لم يُحفظ على السند')
  assert.equal(voucher.unallocatedMinor, 0)
  assert.ok(!c.st().getOpenClientInvoices(customer.id).some((row) => row.docKey === `lab:${order.id}`), 'الطلب بقي مفتوحاً بعد تخصيصه')
  assert.equal(c.st().getCustomerBalance(customer.id), 0, 'رصيد العميل لم يُصفَّر بالسند')
  assertInvariants('تخصيص سند على طلب معمل', c)
  R.ok('طلب معمل آجل: يظهر في جدول تخصيص السند · يُخصَّص بمفتاحه · يُغلق · والذمة تتصفّر والميزان متزن')
}

/* ⑥ إصلاح الازدواج: سند مخصَّص لفاتورة بيع لا يُسدِّد زيارة عيادة بنفس النقود */
{
  const c = await freshCase({ activityId: 'clinic' })
  const customer = addParty(c, 'customer', 'أسرة المريض')
  const patient = c.st().addClinicPatient({ nameAr: 'منى سيد', phone: '0111', gender: 'female', birthDate: '1990-02-02', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  c.st().addClinicVisit({ patientId: patient.id, kind: 'consultation', complaint: 'كشف', diagnosis: '', treatment: '', feeMinor: 30000, paidMinor: 0, vatPercent: 0, planId: null, treasury: '1101' })
  assert.equal(c.st().getPatientBalance(patient.id), 30000)

  const item = addSimpleItem(c, { nameAr: 'مستلزمات', priceMinor: 20000 })
  const supplier = addParty(c, 'supplier', 'مورد المستلزمات')
  c.st().postPurchase({ supplierId: supplier.id, date: '2026-03-01', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 5000, vatPercent: 0 }], paidMinor: 50000, treasury: '1101', expenses: [], notes: '' })
  const sale = c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 20000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }],
    customerId: customer.id, payment: 'credit', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })

  const collectionsBefore = c.st().clinicCollections.length
  c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 20000,
    description: 'تحصيل فاتورة البيع فقط', partyKind: 'customer', partyId: customer.id,
    allocations: [{ docKey: `sale:${sale.id}`, appliedMinor: 20000 }],
  })
  assert.equal(c.st().clinicCollections.length, collectionsBefore, 'سند مخصص لفاتورة بيع أنشأ تحصيل عيادة — ازدواج سجل فرعي')
  assert.equal(c.st().getPatientBalance(patient.id), 30000, 'رصيد المريض تأثر بنقود خُصصت لمستند آخر')

  // وتخصيصٌ صريح على الزيارة ⇒ يُسدِّدها في ملف المريض بنفس المبلغ
  const visitDoc = c.st().getOpenClientInvoices(customer.id).find((row) => row.docKey.startsWith('visit:'))
  assert.ok(visitDoc, 'زيارة العيادة لا تظهر في مستندات العميل المفتوحة')
  c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 30000,
    description: 'تحصيل زيارة العيادة', partyKind: 'customer', partyId: customer.id,
    allocations: [{ docKey: visitDoc.docKey, appliedMinor: 30000 }],
  })
  assert.equal(c.st().getPatientBalance(patient.id), 0, 'التخصيص الصريح لم يُسدِّد الزيارة في ملف المريض')
  assert.equal(c.st().getCustomerBalance(customer.id), 0, 'رصيد العميل بعد تسوية المستندين')
  assertInvariants('تخصيص العيادة بلا ازدواج', c)
  R.ok('ازدواج تسوية العيادة أُغلق: المال المخصَّص لفاتورة لا يُسدِّد زيارة — والتخصيص الصريح يُصفّر ملف المريض')
}

/* ⑦ الواجهة: شاشة السندات تعرض الخيارين فعلاً (لا زر ميت ولا حقل بلا أثر) */
{
  const page = readFileSync(`${ROOT}/src/ui/pages/VouchersPage.tsx`, 'utf8')
  const repo = readFileSync(`${ROOT}/src/data/repo.ts`, 'utf8')
  assert.ok(page.includes('data-voucher-fx'), 'شاشة السندات بلا خانة العملة الأجنبية')
  assert.ok(page.includes('convertFxToBookMinor') && page.includes('validateFxLeg'), 'الشاشة تحسب التحويل بغير دوال النواة')
  assert.ok(/fx: fxOn \? fxLeg : undefined/.test(page), 'ساق العملة لا تُرسل إلى postVoucher')
  assert.ok(page.includes('readOnly={fxOn}'), 'حقل المبلغ يجب أن يكون محسوباً عند تفعيل العملة الأجنبية')
  assert.ok(page.includes('documentKindLabel'), 'جدول التخصيص لا يوسم نوع المستند المتخصص')
  assert.ok(repo.includes('openCustomerSpecializedDocuments') && repo.includes('openSupplierSpecializedDocuments'), 'قوائم المستندات المفتوحة لا تقرأ مستندات الأنشطة')
  assert.ok(/fx: fxLeg,/.test(repo), 'السند لا يحفظ ساق العملة')
  assert.ok(repo.includes("allocation.docKey.startsWith('visit:')"), 'تسوية العيادة لا تقرأ التخصيص الصريح')
  R.ok('شاشة السندات: خانة عملة موصولة بنواة التحويل · مبلغ محسوب لا يدوي · وسم نوع كل مستند في جدول التخصيص')
}

R.done()
