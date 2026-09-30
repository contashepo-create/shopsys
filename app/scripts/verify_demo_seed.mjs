/* بوابة بذور البيانات التجريبية (المرحلة ⑥): أنشطة التحديث تغطي الموارد البشرية
   والمستندات الجديدة — حضور وإجازات ومسير رواتب مسدَّد وعروض أسعار وأوامر شراء
   ودفعات منتهية/قاربت الانتهاء — وتُبنى القاعدة وتُحمَّل بالإجراءات الرسمية. */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants } from './auditKit.mjs'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DEMO_ACTIVITIES } from '../demo-db/seed.data.mjs'
import { buildDemoDatabase, DB_PATH } from '../demo-db/build.mjs'
import { quotationTotals, quotationEstCost } from '../src/core/contracting.ts'

const R = reporter('بذرة البيانات التجريبية — توسعة المرحلة ⑥')
const loader = readFileSync(new URL('../src/dev/demoDatabase.ts', import.meta.url), 'utf8')
const plugin = readFileSync(new URL('../demo-db/vitePlugin.mjs', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../demo-db/schema.sql', import.meta.url), 'utf8')

/* ① المخطط: الجداول الجديدة السبعة + عمود الصلاحية في بنود الشراء */
{
  for (const table of ['employees', 'attendance_records', 'leave_requests', 'payroll_months', 'quotations', 'quotation_lines', 'purchase_orders', 'purchase_order_lines', 'wastage_docs', 'wastage_lines', 'equipment', 'rental_contracts', 'equipment_costs', 'sub_contracts', 'project_extracts']) {
    assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), `جدول ${table} مفقود من المخطط`)
  }
  assert.ok(/purchase_lines[\s\S]{0,400}expiry_date/.test(schema), 'عمود تاريخ الصلاحية مفقود من بنود الشراء')
  for (const table of ['employees', 'attendance_records', 'leave_requests', 'payroll_months', 'quotations', 'quotation_lines', 'purchase_orders', 'purchase_order_lines', 'wastage_docs', 'wastage_lines', 'equipment', 'rental_contracts', 'equipment_costs', 'sub_contracts', 'project_extracts']) {
    assert.ok(plugin.includes(`'${table}'`), `جدول ${table} خارج قائمة TABLES (الحذف عند إعادة الكتابة)`)
  }
  R.ok('المخطط: 15 جدولاً جديداً + expiry_date في بنود الشراء + كلها في قائمة المسح')
}

/* ② البذرة: كل نشاط له موظفون؛ والسيناريوهات الخاصة في أماكنها */
{
  const byId = Object.fromEntries(DEMO_ACTIVITIES.map((activity) => [activity.id, activity]))
  assert.ok(DEMO_ACTIVITIES.length >= 7, `الأنشطة أقل من سبعة (${DEMO_ACTIVITIES.length}) — أنشطة المرحلة ⑥ ناقصة`)
  for (const activity of DEMO_ACTIVITIES) {
    assert.ok((activity.employees ?? []).length > 0, `نشاط ${activity.id} بلا موظفين`)
    assert.ok((activity.attendance ?? []).length > 0, `نشاط ${activity.id} بلا بصمات حضور`)
    for (const row of activity.attendance ?? []) {
      assert.ok(row.employee_ref && row.date, `بصمة ناقصة في ${activity.id}`)
      assert.ok(!row.check_in || /^([01]\d|2[0-3]):[0-5]\d$/.test(row.check_in), `وقت دخول غير صالح ${row.check_in}`)
    }
  }
  /* الجروسري: مسير رواتب + إجازات + دفعة منتهية الصلاحية */
  const grocery = byId.grocery
  assert.ok((grocery.payroll_months ?? []).length === 1, 'الجروسري بلا مسير رواتب')
  assert.ok(grocery.payroll_months[0].pay_employee_refs, 'مسير الجروسري لا يسدد قسيمة أحد')
  assert.ok((grocery.leaves ?? []).length >= 2, 'إجازات الجروسري ناقصة')
  const expiredLine = (grocery.purchases ?? []).flatMap((purchase) => purchase.lines).find((line) => line.expiry_date && line.expiry_date < '2026-09-30')
  assert.ok(expiredLine, 'لا دفعة منتهية الصلاحية في الجروسري (لوحة الفرز ستكون فارغة)')
  /* الصيدلية: دفعة قاربت الانتهاء (تنبيه 30 يوماً) */
  const pharmacy = byId.pharmacy
  const soonLine = (pharmacy.purchases ?? []).flatMap((purchase) => purchase.lines).find((line) => line.expiry_date && line.expiry_date >= '2026-09-30' && line.expiry_date <= '2026-10-31')
  assert.ok(soonLine, 'لا دفعة قاربت الانتهاء في الصيدلية (تنبيهات الصلاحية ستكون فارغة)')
  /* أوامر الشراء المفتوحة: مطعم + ملابس + أعلاف */
  assert.ok((byId.restaurant.purchase_orders ?? []).length >= 1, 'المطعم بلا أمر شراء')
  assert.ok((byId.clothing.purchase_orders ?? []).length >= 1, 'الملابس بلا أمر شراء')
  assert.ok((byId.feed_trade.purchase_orders ?? []).length >= 1, 'الأعلاف بلا أمر شراء')
  for (const order of [...(byId.restaurant.purchase_orders ?? []), ...(byId.clothing.purchase_orders ?? []), ...(byId.feed_trade.purchase_orders ?? [])]) {
    assert.ok(order.supplier_ref && order.order_date && order.expected_date, `أمر شراء ناقص الحقول في ${order.ref}`)
    assert.ok((order.lines ?? []).length > 0, `أمر شراء ${order.ref} بلا بنود`)
  }
  R.ok('البذرة: موظفون وبصمات في كل نشاط + منتهي/قارب الانتهاء + أوامر شراء مفتوحة')
}

/* ③ الأنشطة الثلاثة الجديدة (المرحلة ٦): أعلاف · مقاولات · تأجير معدات */
{
  const byId = Object.fromEntries(DEMO_ACTIVITIES.map((activity) => [activity.id, activity]))
  /* أعلاف: بيع بالوزن + أمر شراء صوامع */
  const feed = byId.feed_trade
  assert.ok(feed, 'نشاط الأعلاف مفقود من البذرة')
  assert.ok(feed.items.some((row) => row.sold_by_weight), 'الأعلاف بلا أصناف بيع بالوزن (الميزان)')
  assert.ok((feed.purchase_orders ?? []).length >= 1, 'الأعلاف بلا أمر شراء')
  assert.ok(feed.items.some((row) => row.extra_units && String(row.extra_units).includes('طن:')), 'الأعلاف بلا وحدات إضافية (طن)')
  /* مقاولات: عرض يتحول مشروعاً + مسير رواتب + مواد بناء */
  const contracting = byId.contracting
  assert.ok(contracting, 'نشاط المقاولات مفقود من البذرة')
  const tender = (contracting.quotations ?? [])[0]
  assert.ok(tender, 'المقاولات بلا عرض سعر')
  assert.equal(tender.convert, 'project', 'عرض المقاولات لا يُحوَّل مشروعاً')
  assert.ok((contracting.employees ?? []).length >= 3, 'فريق المقاولات ناقص')
  assert.ok((contracting.payroll_months ?? []).length >= 1, 'المقاولات بلا مسير رواتب')
  /* تأجير معدات: مناقصة إيجار + خدمات يومية بالسائق + مسير */
  const rental = byId.equipment_rental
  assert.ok(rental, 'نشاط تأجير المعدات مفقود من البذرة')
  const bid = (rental.quotations ?? [])[0]
  assert.ok(bid && bid.kind === 'tender', 'التأجير بلا مناقصة معدات')
  assert.ok(bid.bid_bond_minor > 0, 'مناقصة التأجير بلا تأمين ابتدائي')
  assert.ok(rental.items.filter((row) => row.is_service).length >= 4, 'خدمات الإيجار اليومية ناقصة')
  assert.ok((rental.payroll_months ?? []).length >= 1, 'التأجير بلا مسير رواتب (سائقون)')
  assert.ok(loader.includes('convertQuotationToProject'), 'المحمّل لا يحوّل العرض الفائز مشروعاً')
  /* التعميق: مقاول باطن بمحتجز ومقدمة وشهادة + مستخلص بنسبة إنجاز */
  const sub = (contracting.sub_contracts ?? [])[0]
  assert.ok(sub, 'المقاولات بلا عقد مقاول باطن')
  assert.ok(sub.quotation_ref === 'q1', 'عقد الباطن غير مربوط بعرض المشروع')
  assert.ok(sub.contract_value_minor > 0 && sub.retention_percent > 0 && sub.retention_percent <= 20, 'عقد الباطن بقيمة/محتجز غير صالح')
  assert.ok(sub.advance_minor > 0 && sub.certificate_amount_minor > 0, 'عقد الباطن بلا دفعة مقدمة أو شهادة أعمال')
  const extract = (contracting.project_extracts ?? [])[0]
  assert.ok(extract && extract.percent > 0 && extract.percent <= 100, 'المقاولات بلا مستخلص صالح النسبة')
  /* التعميق: خمس معدات وثلاثة عقود (نقدي مقفل + آجل + مختلط) ومصروفات تشغيل */
  assert.ok((rental.equipment ?? []).length >= 5, 'أسطول المعدات ناقص عن خمس معدات')
  assert.ok((rental.equipment ?? []).every((row) => row.service_every_hours > 0), 'معدات بلا خطة صيانة وقائية (ساعات)')
  const contracts = rental.rental_contracts ?? []
  assert.ok(contracts.length >= 3, 'عقود الإيجار أقل من ثلاثة')
  for (const mode of ['cash', 'credit', 'mixed']) assert.ok(contracts.some((row) => row.payment === mode), `لا عقد إيجار بطريقة ${mode}`)
  assert.ok(contracts.some((row) => row.close_deduct_minor > 0 && row.close_end_date), 'لا عقد إيجار مقفل بخصم تالفيات')
  assert.ok((rental.equipment_costs ?? []).length >= 3, 'مصروفات تشغيل المعدات ناقصة')
  for (const marker of ['openRental', 'closeRental', 'addEquipmentCost', 'addSubContract', 'addSubAdvance', 'addSubCertificate', 'addProjectExtract']) {
    assert.ok(loader.includes(marker), `المحمّل لا يستخدم ${marker} — القسم يُحقن بلا إجراء رسمي`)
  }
  R.ok('أنشطة المرحلة ⑥: أعلاف (وزن/صوامع) · مقاولات (عرض⇐مشروع⇐باطن⇐مستخلص) · تأجير (أسطول/عقود مختلطة)')
}

/* ③-ب عرض سعر الملابس: بنود بضريبة وهامش موجب — يصلح للتحويل مشروعاً */
{
  const clothing = DEMO_ACTIVITIES.find((activity) => activity.id === 'clothing')
  const quotation = (clothing.quotations ?? [])[0]
  assert.ok(quotation, 'الملابس بلا عرض سعر')
  assert.equal(quotation.kind, 'quotation', 'نوع العرض ليس عرض سعر')
  const lines = quotation.lines.map((line) => ({
    nameAr: line.name_ar, descriptionAr: line.description_ar, qty: line.qty, unitAr: line.unit_ar,
    unitPriceMinor: line.unit_price_minor, estCostMinor: line.est_cost_minor, vatPercent: line.vat_percent, taxIncluded: !!line.tax_included,
  }))
  const totals = quotationTotals(lines)
  assert.ok(totals.netMinor > 0, 'صافي العرض صفر')
  assert.ok(totals.taxMinor > 0, 'ضريبة العرض صفر رغم بنود خاضعة')
  const margin = totals.netMinor - quotationEstCost(lines)
  assert.ok(margin > 0, 'هامش العرض سالب — عرض خاسر لا يصلح للعرض التجريبي')
  R.ok('عرض سعر الملابس: ضريبة 14٪ وهامش موجب جاهز للفوز والتحويل')
}

/* ④ بناء القاعدة فعلياً: الجداول الجديدة بها صفوف وبنية الأعمدة سليمة */
{
  const counts = buildDemoDatabase()
  assert.ok(counts.activities >= 7, `أنشطة القاعدة أقل من سبعة (${counts.activities})`)
  assert.ok(counts.employees >= 15, `موظفو القاعدة أقل من المتوقع (${counts.employees})`)
  assert.ok(counts.attendance_records >= 14, 'بصمات الحضور ناقصة في القاعدة')
  assert.ok(counts.leave_requests >= 2, 'الإجازات ناقصة في القاعدة')
  assert.ok(counts.payroll_months >= 1, 'مسيرات الرواتب ناقصة في القاعدة')
  assert.ok(counts.quotations >= 3 && counts.quotation_lines >= 10, 'عروض الأسعار ناقصة في القاعدة')
  assert.ok(counts.purchase_orders >= 3 && counts.purchase_order_lines >= 6, 'أوامر الشراء ناقصة في القاعدة')
  assert.ok(counts.payroll_months >= 3, 'مسيرات الرواتب أقل من ثلاثة أنشطة')
  assert.ok(counts.equipment >= 5 && counts.rental_contracts >= 3, 'المعدات/عقود الإيجار ناقصة في القاعدة')
  assert.ok(counts.equipment_costs >= 3, 'مصروفات المعدات ناقصة في القاعدة')
  assert.ok(counts.sub_contracts >= 1 && counts.project_extracts >= 1, 'عقود الباطن/المستخلصات ناقصة في القاعدة')
  const db = new DatabaseSync(DB_PATH)
  try {
    const expired = db.prepare("SELECT COUNT(*) AS n FROM purchase_lines WHERE expiry_date != '' AND expiry_date < '2026-09-30'").get().n
    assert.ok(expired >= 1, 'لا بنود شراء منتهية الصلاحية في القاعدة')
    const soon = db.prepare("SELECT COUNT(*) AS n FROM purchase_lines WHERE expiry_date != '' AND expiry_date >= '2026-09-30'").get().n
    assert.ok(soon >= 1, 'لا بنود قاربت الانتهاء في القاعدة')
    /* سجل حضور بموظف مرجعي صحيح */
    const orphan = db.prepare('SELECT COUNT(*) AS n FROM attendance_records a LEFT JOIN employees e ON e.activity = a.activity AND e.ref = a.employee_ref WHERE e.id IS NULL').get().n
    assert.equal(orphan, 0, 'بصمات معلقة لموظف غير موجود')
    const orphanOrder = db.prepare('SELECT COUNT(*) AS n FROM purchase_order_lines l LEFT JOIN items i ON i.activity = l.activity AND i.ref = l.item_ref WHERE i.id IS NULL').get().n
    assert.equal(orphanOrder, 0, 'بنود أمر شراء لأصناف غير موجودة')
  } finally { db.close() }
  R.ok('القاعدة المبنية: صفوف جديدة سليمة ولا مراجع معلقة')
}

/* ⑤ محمّل التطبيق: إعادة التشغيل بالإجراءات الرسمية لكل قسم جديد */
{
  for (const marker of ['addEmployee', 'setAttendanceDay', 'addLeaveRequest', 'decideLeaveRequest', 'accruePayrollSlips', 'settleSlipIds', 'addQuotation', 'setQuotationStatus', 'addPurchaseOrder', 'postWastage']) {
    assert.ok(loader.includes(marker), `المحمّل لا يستخدم ${marker} — القسم يُحقن بلا إجراء رسمي`)
  }
  assert.ok(loader.includes('expiryDate: str(line.expiry_date) || null'), 'تواريخ صلاحية البذور لا تمر لفاتورة الشراء')
  assert.ok(plugin.includes('employees: rows('), 'قارئ النشاط لا يقرأ جدول الموظفين')
  assert.ok(plugin.includes('purchaseOrders: purchaseOrders.map'), 'قارئ النشاط لا يقرأ أوامر الشراء')
  assert.ok(/insertRows\('quotations'/.test(plugin), 'كاتب النشاط لا يحفظ العروض')
  R.ok('المحمّل: حضور/إجازات/مسير/عروض/أوامر بالإجراءات الرسمية + تواريخ الصلاحية')
}

/* ⑤-ب سيولة البذرة: كل صرف (مشتريات مدفوعة/رواتب مسددة/مقدمات باطن) له رصيد خزينة يغطيه —
   وإلا رُفض سند الصرف عند التحميل الحقيقي وظهر «تخطّينا» في اللوحة */
{
  for (const activity of DEMO_ACTIVITIES) {
    const paid = Object.fromEntries((activity.treasuries ?? []).map((tr) => [tr.ref, tr.opening_minor ?? 0]))
    const spend = (ref, amount) => { if (ref && amount > 0) paid[ref] = (paid[ref] ?? 0) - amount }
    for (const purchase of activity.purchases ?? []) spend(purchase.treasury_ref, purchase.paid_minor ?? 0)
    for (const pm of activity.payroll_months ?? []) {
      const employee = (activity.employees ?? []).find((e) => e.ref === pm.pay_employee_refs)
      spend(pm.treasury_ref || 'cash-main', employee ? employee.base_salary_minor + employee.allowances_minor : 0)
    }
    for (const sc of activity.sub_contracts ?? []) spend(sc.advance_treasury_ref, sc.advance_minor ?? 0)
    for (const rc of activity.rental_contracts ?? []) spend(rc.treasury_ref, (rc.paid_minor ?? 0) + (rc.deposit_minor ?? 0))
    const deficit = Object.entries(paid).filter(([, v]) => v < 0)
    assert.deepEqual(deficit.map(([ref]) => ref), [], `نشاط ${activity.id}: صرف بلا رصيد كافٍ في ${deficit.map(([ref, v]) => `${ref} (${v})`).join(' · ')}`)
  }
  R.ok('سيولة البذرة: كل خزينة تغطي صروفها — لا سند مرفوض عند التحميل')
}

/* ⑥ رحلة التعميق على متجر نظيف — نفس تسلسل المحمّل حرفياً: إثبات أن البذرة تُحمَّل بلا رفض */
{
  /* المقاولات: عرض فائز ⇐ مشروع ⇐ باطن (مقدمة + شهادة) ⇐ مستخلص 35٪ */
  const c = await freshCase({ activityId: 'contracting' })
  const g = () => c.store.getState()
  /* ث7: العميل والمورد مسجلان فيربطان بالعرض والعقد فتتطابق الكشوف مع الدفتر */
  g().addCustomer({ nameAr: 'جامعة الدلتا', phone: '', creditLimitMinor: 200000000, notes: '' })
  g().addSupplier({ nameAr: 'حديد الدخيلة — موزع الدلتا', phone: '', notes: '' })
  const client = g().customers[0], vendor = g().suppliers[0]
  const q = g().addQuotation({
    kind: 'quotation', clientName: 'جامعة الدلتا', clientId: client.id, titleAr: 'مبنى إداري', validUntil: '2026-10-20',
    lines: [
      { nameAr: 'حفر', descriptionAr: 'حفر وردم', qty: 850, unitAr: 'م3', unitPriceMinor: 55000, estCostMinor: 40000, vatPercent: 14, taxIncluded: false },
      { nameAr: 'مباني', descriptionAr: 'طوب 25سم', qty: 1200, unitAr: 'م2', unitPriceMinor: 78000, estCostMinor: 61000, vatPercent: 14, taxIncluded: false },
    ],
    notes: '', winProbability: 70, bidBondMinor: 0,
  })
  g().setQuotationStatus(q.id, 'submitted')
  g().setQuotationStatus(q.id, 'won')
  const project = g().convertQuotationToProject(q.id, 5)
  assert.ok(g().boqItems.filter((item) => item.projectId === project.id).length === 2, 'بنود BOQ لم تنتقل من العرض')
  const contract = g().addSubContract({ projectId: project.id, contractorName: 'أبو الفتوح', supplierId: vendor.id, scopeAr: 'أعمال الحفر والردم', contractValueMinor: 32000000, retentionPercent: 5, taxWithholdPercent: 1, advanceRecoveryPercent: 10, startDate: '2026-09-10' })
  assert.ok(/^SC-/.test(contract.contractNumber), 'عقد الباطن بلا رقم SC')
  g().addSubAdvance({ contractId: contract.id, amountMinor: 3200000, treasury: '1101' })
  const certificate = g().addSubCertificate({ contractId: contract.id, amountMinor: 16000000, description: 'شهادة 1' })
  assert.ok(certificate, 'شهادة الباطن لم تُنشأ')
  const extractDoc = g().addProjectExtract({
    projectId: project.id,
    extractLines: g().boqItems.filter((item) => item.projectId === project.id).map((item) => ({ boqItemId: item.id, newProgressPercent: 35 })),
    vatPercent: 14, payment: 'credit', description: 'المستخلص 1', treasury: '1101',
  })
  assert.ok(extractDoc, 'المستخلص لم يُنشأ')
  assert.ok(g().journal.length > 0, 'رحلة المقاولات لم تُنشئ أي قيد')
  assertInvariants('مقاولات: مشروع + باطن + شهادة + مستخلص', c)
  R.ok('رحلة المقاولات: عرض⇐مشروع⇐باطن(مقدمة+شهادة)⇐مستخلص 35٪ — الثوابت سليمة')
}

{
  /* التأجير: معدات ⇐ عقود مختلط/نقدي مقفل ⇐ مصروف تشغيل */
  const c = await freshCase({ activityId: 'equipment_rental' })
  const g = () => c.store.getState()
  g().addCustomer({ nameAr: 'شركة الريان للمقاولات', phone: '', creditLimitMinor: 60000000, notes: '' })
  const customer = g().customers[0]
  g().addEquipment({ nameAr: 'لودر كتربيلر 950H', code: 'LD-01', dailyRateMinor: 1200000, hourlyRateMinor: 175000, monthlyRateMinor: 28000000, meterReading: 3450, serviceEveryHours: 500, lastServiceReading: 0, notes: '' })
  g().addEquipment({ nameAr: 'حدافة 10 طن', code: 'RL-01', dailyRateMinor: 900000, hourlyRateMinor: 130000, monthlyRateMinor: 21000000, meterReading: 940, serviceEveryHours: 400, lastServiceReading: 0, notes: '' })
  const loader = g().equipment[0], roller = g().equipment[1]
  /* مختلط: 30 يوم × 1.2م + 14٪ ضريبة، المحصل 20م والباقي آجل */
  const mixed = g().openRental({ customerId: customer.id, equipmentId: loader.id, input: { equipmentName: loader.nameAr, days: 30, dailyRateMinor: 1200000, depositMinor: 500000, payment: 'mixed', paidMinor: 20000000, vatPercent: 14 }, notes: 'تعاقد شهري', treasury: '1101' })
  assert.ok(/^RC-/.test(mixed.contractNumber), 'عقد الإيجار بلا رقم RC')
  assert.equal(mixed.status, 'active', 'عقد المختلط ليس نشطاً')
  /* نقدي مقفل: 3 أيام حدافة مع خصم تالفيات 50 ألف */
  const cash = g().openRental({ customerId: customer.id, equipmentId: roller.id, input: { equipmentName: roller.nameAr, days: 3, dailyRateMinor: 900000, depositMinor: 200000, payment: 'cash', vatPercent: 14 }, notes: 'ردمية قصيرة', treasury: '1101' })
  g().closeRental(cash.id, 50000, undefined, '1101')
  assert.equal(g().rentalContracts.find((row) => row.id === cash.id).status, 'closed', 'عقد النقدي لم يُقفل')
  /* مصروف تشغيل: وقود 5105/خزينة */
  g().addEquipmentCost({ equipmentId: loader.id, kind: 'fuel', amountMinor: 1850000, description: 'وقود أسبوع', treasury: '1101' })
  assert.ok(g().journal.length >= 3, 'رحلة التأجير لم تُنشئ قيود الفتح والإقفال والمصروف')
  assertInvariants('تأجير: عقود مختلطة ونقدية مقفلة ومصروفات', c)
  R.ok('رحلة التأجير: أسطول ⇐ عقد مختلط + نقدي مقفل + مصروف وقود — الثوابت سليمة')
}

R.done()
