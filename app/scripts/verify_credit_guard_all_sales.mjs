/**
 * المراجعة التراجعية الشاملة للبيع (طلب المالك): «راجع جميع حالات البيع في جميع
 * الأنشطة بما فيها البيع خدمة» — حارس حد الائتمان الموحد guardCreditLimit يسري
 * على كل مستند يرفع ذمم العميل (1104)، بيعاً كان أو خدمة:
 *  1) editSale: تعديل الفاتورة الذي يرفع الجزء الآجل فوق الحد يُرفض (كان فجوة)
 *  2) postExchange: استبدال آجل بأغلى فوق الحد يُرفض واللقطة تُسترجع كاملة
 *  3) deliverTicket (صيانة): تسليم آجل فوق الحد يُرفض والتجاوز المعتمد يمر
 *  4) postTrip (نقلات): نقلة آجلة فوق الحد تُرفض
 *  5) openRental (إيجار معدات): عقد آجل فوق الحد يُرفض
 *  6) postWalletService (محافظ): متبقٍ آجل فوق الحد يُرفض
 *  7) addProjectExtract (مقاولات): مستخلص آجل لعميل المشروع فوق الحد يُرفض
 *  8) registerLabOrder (معمل): طلب آجل لمريض مربوط بعميل فوق الحد يُرفض
 *  9) addClinicVisit (عيادة): متبقي زيارة لمريض مربوط فوق الحد يُرفض
 * 10) createInstallmentPlan: هامش التقسيط يرفع الذمم — فوق الحد يُرفض
 * 11) regression: عميل بلا حد (0) حر في كل ما سبق + التجاوز المعتمد يمر
 * 12) فحص نصي: صفحات الخدمات تعالج CreditLimitError بحوار sales.credit.override
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/* بيئة صورية */
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { CreditLimitError } = await import(join(root, 'src/core/pos.ts'))
const st = () => useDataStore.getState()

const isCL = (e) => e instanceof CreditLimitError

/* تجهيز: صنف + عميلان (محدود 500 / حر بلا حد) */
st().addItem({
  nameAr: 'صنف اختبار', barcode: '', categoryId: null, unit: 'قطعة',
  costMinor: 5000, priceMinor: 10000, stockQty: 1000, minStock: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
})
const item = st().items.at(-1)
st().addCustomer({ nameAr: 'مقيد', phone: '0100', address: '', notes: '', openingMinor: 0, creditLimitMinor: 50000 })
const bounded = st().customers.at(-1)
st().addCustomer({ nameAr: 'حر', phone: '0101', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const free = st().customers.at(-1)
const line = (qty, price = 10000) => ({ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: price, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false })

/* ═══ 1) editSale: التعديل الذي يرفع الآجل فوق الحد ═══ */
{
  // فاتورة آجلة 300 ≤ 500 تمر
  const s = st().postSale({ lines: [line(3)], customerId: bounded.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  assert.equal(s.totals.totalMinor, 30000)
  ok('editSale تجهيز: فاتورة آجلة 300 لعميل حده 500 مرّت')

  // تعديلها إلى 700 آجلة: 700 > 500 ⇒ يُرفض
  assert.throws(
    () => st().editSale({ saleId: s.id, lines: [line(7)], customerId: bounded.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'زيادة كمية', einvoiceActive: false }),
    isCL,
  )
  ok('editSale: رفع الفاتورة إلى 700 آجلة (فوق الحد 500) — CreditLimitError (فجوة سُدت)')

  // الفاتورة الأصلية سليمة لم تُمس (الرمي قبل أي كتابة)
  const after = st().sales.find((x) => x.id === s.id)
  assert.equal(after.totals.totalMinor, 30000)
  assert.equal(st().journal.filter((e) => e.sourceId === s.id && e.sourceType === 'sale').length, 1)
  ok('editSale: الرفض قبل أي كتابة — الفاتورة والقيود سليمة')

  // نفس التعديل بتجاوز معتمد يمر
  const upd = st().editSale({ saleId: s.id, lines: [line(7)], customerId: bounded.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'زيادة كمية', einvoiceActive: false, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(upd.totals.totalMinor, 70000)
  ok('editSale: التجاوز المعتمد (creditLimitOverrideBy) يمرر التعديل')

  // تعديل يخفض الآجل لا يحتاج تجاوزاً حتى مع تجاوز الرصيد القائم للحد —
  // الفحص على صافي الزيادة: (رصيد − آجل قديم 700) + آجل جديد 200 = 200 ≤ 500
  const upd2 = st().editSale({ saleId: s.id, lines: [line(2)], customerId: bounded.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تخفيض', einvoiceActive: false })
  assert.equal(upd2.totals.totalMinor, 20000)
  ok('editSale: تعديل يخفض الآجل يمر بلا تجاوز (الفحص على صافي الزيادة لا الإجمالي)')

  // تسوية الرصيد: تحصيل 200 لتصفير ذمة العميل قبل بقية المحاور
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: 20000, treasury: '1101' })
  assert.equal(st().getCustomerBalance(bounded.id), 0)
  ok('تصفير رصيد العميل المقيد تمهيداً لمحاور الخدمات')
}

/* ═══ 2) postExchange: استبدال آجل بأغلى فوق الحد ═══ */
{
  const s = st().postSale({ lines: [line(1)], customerId: bounded.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  const salesBefore = st().sales.length
  const returnsBefore = st().saleReturns.length
  // إرجاع القطعة (100) وأخذ 7 قطع (700): البيع الجديد آجل 700 > 500−100=400 المتاح ⇒ رفض
  assert.throws(
    () => st().postExchange({ originalSaleId: s.id, returnLineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], newLines: [line(7)], notes: 'استبدال بأغلى', approvedBy: 'المشرف' }),
    isCL,
  )
  ok('postExchange: البيع الجديد الآجل فوق الحد — CreditLimitError تصعد من postSale الداخلي')
  assert.equal(st().sales.length, salesBefore)
  assert.equal(st().saleReturns.length, returnsBefore)
  ok('postExchange: اللقطة استُرجعت كاملة — لا مرتجع يتيم ولا بيع ناقص')

  // بتجاوز معتمد يمر ويتكوّن المستندان
  const doc = st().postExchange({ originalSaleId: s.id, returnLineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], newLines: [line(7)], notes: 'استبدال بأغلى معتمد', approvedBy: 'المشرف', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(doc.netMinor, 60000)
  const newSale = st().sales.find((x) => x.id === doc.newSaleId)
  assert.equal(newSale.creditLimitOverrideBy, 'المدير سامي')
  ok('postExchange: التجاوز المعتمد يمر واسم المعتمد على فاتورة البيع الجديد')

  // تصفير: تحصيل صافي الذمة
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 3) deliverTicket (صيانة): تسليم آجل فوق الحد ═══ */
{
  st().openTicket({ customerId: bounded.id, customerName: 'مقيد', customerPhone: '0100', deviceName: 'لابتوب', issue: 'شاشة', estimateMinor: 0, notes: '' })
  const t1 = st().tickets.at(-1)
  st().setTicketStatus(t1.id, 'ready')
  assert.throws(
    () => st().deliverTicket(t1.id, { laborMinor: 60000, parts: [], services: [], payment: 'credit', vatPercent: 0 }),
    isCL,
  )
  ok('deliverTicket: أجرة 600 آجلة > حد 500 — CreditLimitError (الخدمة دين كالبيع)')
  // بتجاوز معتمد يمر
  const done = st().deliverTicket(t1.id, { laborMinor: 60000, parts: [], services: [], payment: 'credit', vatPercent: 0, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(done.status, 'delivered')
  ok('deliverTicket: التجاوز المعتمد يسلّم التذكرة')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })

  // عميل بلا حد: تسليم آجل بأي مبلغ يمر
  st().openTicket({ customerId: free.id, customerName: 'حر', customerPhone: '0101', deviceName: 'موبايل', issue: 'بطارية', estimateMinor: 0, notes: '' })
  const t2 = st().tickets.at(-1)
  st().setTicketStatus(t2.id, 'ready')
  const done2 = st().deliverTicket(t2.id, { laborMinor: 999900, parts: [], services: [], payment: 'credit', vatPercent: 0 })
  assert.equal(done2.status, 'delivered')
  ok('deliverTicket: عميل حده 0 (بلا حد) يُسلَّم آجلاً بأي مبلغ — regression سليم')
}

/* ═══ 4) postTrip (نقلات): نقلة آجلة فوق الحد ═══ */
{
  const input = { fromLoc: 'دمياط', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 70000, expenses: [], payment: 'credit', vatPercent: 0, containerNumbers: [] }
  assert.throws(
    () => st().postTrip({ customerId: bounded.id, vehicleId: null, driverId: null, input, notes: '', treasury: '1101' }),
    isCL,
  )
  ok('postTrip: نقلة آجلة 700 > حد 500 — CreditLimitError')
  const trip = st().postTrip({ customerId: bounded.id, vehicleId: null, driverId: null, input, notes: '', treasury: '1101', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(trip.totals.grandMinor, 70000)
  ok('postTrip: التجاوز المعتمد يرحّل النقلة')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
  // التحصيل الجزئي: 650 محصَّل من 700 ⇒ آجل 50 ≤ 500 يمر بلا تجاوز
  const trip2 = st().postTrip({ customerId: bounded.id, vehicleId: null, driverId: null, input, notes: '', treasury: '1101', paidMinor: 65000 })
  assert.equal(trip2.totals.grandMinor - 65000, 5000)
  ok('postTrip: الفحص على المتبقي بعد المحصَّل الآن فقط (جزئي 50 يمر)')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 5) openRental (إيجار معدات): عقد آجل فوق الحد ═══ */
{
  const input = { equipmentName: 'حفار', days: 7, dailyRateMinor: 10000, depositMinor: 0, payment: 'credit', vatPercent: 0 }
  assert.throws(
    () => st().openRental({ customerId: bounded.id, equipmentId: null, input, notes: '' }),
    isCL,
  )
  ok('openRental: إيجار آجل 700 > حد 500 — CreditLimitError')
  const c = st().openRental({ customerId: bounded.id, equipmentId: null, input, notes: '', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(c.totals.collectCreditMinor, 70000)
  ok('openRental: التجاوز المعتمد يفتح العقد')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 6) postWalletService (محافظ): متبقٍ آجل فوق الحد ═══ */
{
  const base = { type: 'transfer', provider: 'vodafone', targetPhone: '01000000000', paidToProviderMinor: 60000, chargeMinor: 70000, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' }
  assert.throws(
    () => st().postWalletService({ ...base, customerId: bounded.id, paidMinor: 0 }),
    isCL,
  )
  ok('postWalletService: متبقٍ آجل 700 > حد 500 — CreditLimitError')
  const op = st().postWalletService({ ...base, customerId: bounded.id, paidMinor: 0, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(op.totals.remainingMinor, 70000)
  ok('postWalletService: التجاوز المعتمد يسجل العملية')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 7) addProjectExtract (مقاولات): مستخلص آجل فوق الحد ═══ */
{
  st().addProject({ nameAr: 'برج المنزلة', clientName: 'مقيد', clientId: bounded.id, contractValueMinor: 10000000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const project = st().projects.at(-1)
  assert.throws(
    () => st().addProjectExtract({ projectId: project.id, grossMinor: 70000, vatPercent: 0, payment: 'credit', description: 'مستخلص 1' }),
    isCL,
  )
  ok('addProjectExtract: مستخلص آجل 700 > حد 500 لعميل المشروع — CreditLimitError')
  const ex = st().addProjectExtract({ projectId: project.id, grossMinor: 70000, vatPercent: 0, payment: 'credit', description: 'مستخلص 1 معتمد', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(ex.totals.dueMinor, 70000)
  ok('addProjectExtract: التجاوز المعتمد يسجل المستخلص')
  // المستخلص النقدي لا يفحص الحد أصلاً
  const ex2 = st().addProjectExtract({ projectId: project.id, grossMinor: 99900000, vatPercent: 0, payment: 'cash', description: 'مستخلص نقدي' })
  assert.ok(ex2.totals.dueMinor > 0)
  ok('addProjectExtract: النقدي حر مهما بلغ (لا ذمة تنشأ)')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 8) registerLabOrder (معمل): مريض مربوط بعميل مقيد ═══ */
{
  st().addLabTest({ code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم وريدي', unit: 'g/dL', priceMinor: 70000, costMinor: 5000, refRanges: [] })
  const test = st().labTests.at(-1)
  st().addLabPatient({ nameAr: 'مريض مربوط', phone: '0102', gender: 'male', birthDate: '', notes: '', linkedCustomerId: bounded.id })
  const patient = st().labPatients.at(-1)
  assert.throws(
    () => st().registerLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], payment: 'credit', discountPercent: 0, vatPercent: 0, notes: '' }),
    isCL,
  )
  ok('registerLabOrder: طلب آجل 700 لمريض مربوط بعميل حده 500 — CreditLimitError')
  const o = st().registerLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], payment: 'credit', discountPercent: 0, vatPercent: 0, notes: '', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(o.totals.totalMinor, 70000)
  ok('registerLabOrder: التجاوز المعتمد يسجل الطلب')
  // مريض غير مربوط: الطلب النقدي حر (لا عميل مالي أصلاً)
  st().addLabPatient({ nameAr: 'مريض عابر', phone: '0103', gender: 'female', birthDate: '', notes: '' })
  const walkin = st().labPatients.at(-1)
  const o2 = st().registerLabOrder({ patientId: walkin.id, referrerId: null, testIds: [test.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '' })
  assert.equal(o2.totals.totalMinor, 70000)
  ok('registerLabOrder: مريض غير مربوط نقدي — لا فحص (لا ذمة عميل)')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 9) addClinicVisit (عيادة): متبقي زيارة لمريض مربوط ═══ */
{
  st().addClinicPatient({ nameAr: 'مريض عيادة', phone: '0104', gender: 'male', birthDate: '', medicalHistory: '', linkedCustomerId: bounded.id })
  const cp = st().clinicPatients.at(-1)
  assert.throws(
    () => st().addClinicVisit({ patientId: cp.id, kind: 'checkup', complaint: 'صداع', diagnosis: '', treatment: '', feeMinor: 70000, paidMinor: 0, vatPercent: 0, planId: null }),
    isCL,
  )
  ok('addClinicVisit: زيارة بمتبقٍ 700 > حد 500 لمريض مربوط — CreditLimitError')
  const v = st().addClinicVisit({ patientId: cp.id, kind: 'checkup', complaint: 'صداع', diagnosis: '', treatment: '', feeMinor: 70000, paidMinor: 0, vatPercent: 0, planId: null, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(v.totals.dueMinor, 70000)
  ok('addClinicVisit: التجاوز المعتمد يسجل الزيارة')
  // زيارة مسددة كاملة لا تُفحص (dueMinor = 0)
  const v2 = st().addClinicVisit({ patientId: cp.id, kind: 'followup', complaint: 'متابعة', diagnosis: '', treatment: '', feeMinor: 99900000, paidMinor: 99900000, vatPercent: 0, planId: null })
  assert.equal(v2.totals.dueMinor, 0)
  ok('addClinicVisit: المسددة كاملة حرة مهما بلغت — لا ذمة')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: st().getCustomerBalance(bounded.id), treasury: '1101' })
}

/* ═══ 10) createInstallmentPlan: هامش التقسيط يرفع الذمم ═══ */
{
  assert.throws(
    () => st().createInstallmentPlan({ customerId: bounded.id, saleId: null, totalMinor: 200000, downPaymentMinor: 0, interestMinor: 60000, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' }),
    isCL,
  )
  ok('createInstallmentPlan: هامش 600 > حد 500 — CreditLimitError (الهامش دين جديد)')
  const plan = st().createInstallmentPlan({ customerId: bounded.id, saleId: null, totalMinor: 200000, downPaymentMinor: 0, interestMinor: 60000, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '', creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(plan.items.length, 4)
  ok('createInstallmentPlan: التجاوز المعتمد ينشئ الخطة')
  // خطة بلا هامش لا تفحص (الأصل فُحص في postSale لحظة الفاتورة)
  const plan2 = st().createInstallmentPlan({ customerId: bounded.id, saleId: null, totalMinor: 500000, downPaymentMinor: 100000, interestMinor: 0, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' })
  assert.equal(plan2.items.length, 4)
  ok('createInstallmentPlan: خطة بلا هامش حرة — لا ذمة جديدة تنشأ منها')
}

/* ═══ 11) regression: العميل الحر (حد 0) حر في كل المسارات ═══ */
{
  const s = st().postSale({ lines: [line(50)], customerId: free.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  assert.equal(s.totals.totalMinor, 500000)
  const input = { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 500000, expenses: [], payment: 'credit', vatPercent: 0, containerNumbers: [] }
  const trip = st().postTrip({ customerId: free.id, vehicleId: null, driverId: null, input, notes: '', treasury: '1101' })
  assert.equal(trip.totals.grandMinor, 500000)
  ok('regression: عميل بلا حد — بيع 5000 ونقلة 5000 آجلة تمر بلا أي حارس')
  // قيود الدفتر متوازنة بعد كل المحاور
  const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`regression: كل قيود الدفتر (${st().journal.length}) متوازنة بعد المحاور العشرة`)
}

/* ═══ 12) فحص نصي: الصفحات تعالج CreditLimitError بحوار الاعتماد ═══ */
{
  const pages = [
    ['SalesInvoicesPage.tsx', 'saveEdit'],
    ['ExchangePage.tsx', 'submit'],
    ['MaintenancePage.tsx', 'doDeliver'],
    ['TripsPage.tsx', 'save'],
    ['RentalContractsPage.tsx', 'save'],
    ['WalletServicesPage.tsx', 'save'],
    ['ContractingPages.tsx', 'saveExtract'],
    ['LabPages.tsx', 'save'],
    ['ClinicPages.tsx', 'saveVisit'],
    ['InstallmentsPage.tsx', 'save'],
  ]
  for (const [file] of pages) {
    const src = readFileSync(join(root, 'src/ui/pages', file), 'utf8')
    assert.ok(src.includes("useSupervisorApproval('sales.credit.override')"), `${file}: حوار اعتماد الائتمان`)
    assert.ok(src.includes('CreditLimitError'), `${file}: يلتقط CreditLimitError`)
    assert.ok(src.includes('creditApproval.dialog'), `${file}: الحوار مركب في الصفحة`)
  }
  ok('10 صفحات بيع/خدمة تلتقط CreditLimitError وتعرض حوار اعتماد sales.credit.override')
  // repo: الحارس الموحد معرف ويُستدعى في المسارات الخدمية
  const repo = readFileSync(join(root, 'src/data/repo.ts'), 'utf8')
  assert.ok(repo.includes('function guardCreditLimit('))
  const guards = (repo.match(/guardCreditLimit\(get\(\)/g) ?? []).length
  assert.ok(guards >= 8, `عدد استدعاءات الحارس الموحد ${guards} — المتوقع ≥ 8`)
  ok(`الحارس الموحد guardCreditLimit مستدعى ${guards} مرات في مسارات repo الخدمية`)
}

console.log(`\n✅ verify_credit_guard_all_sales: ${pass} تحققاً ناجحاً — حد الائتمان يسري على كل حالات البيع (سلعة وخدمة) في كل الأنشطة`)
