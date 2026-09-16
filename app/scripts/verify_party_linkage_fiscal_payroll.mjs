/**
 * تحقق إصلاحات الترابط الشامل (بلاغ المالك):
 * ① «حصّلت بسند قبض ولم ينخفض رصيد المريض» — سند قبض على عميل مرتبط بمريض
 *    يولّد تحصيل عيادة تلقائياً: ملف المريض وكشف الحساب يتطابقان من نفس المستند.
 * ② كشف حساب العميل الموحّد يشمل كل الأنشطة: معمل/محافظ/مستخلصات/أقساط.
 * ③ إقفال السنة المالية بمنهجية QuickBooks/Xero: تصفير 4xxx/5xxx → أرباح مرحلة 3102
 *    + قفل الفترة + قائمة الدخل التاريخية تظل صحيحة.
 * ④ الرواتب: سجل جزاءات DED مع تتبع (كامل/جزء/تأجيل) + سداد نقدي للسلفة ADR.
 * تشغيل: node --experimental-strip-types scripts/verify_party_linkage_fiscal_payroll.mjs
 */

/* ─── بيئة صناعية قبل استيراد المخازن ─── */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
globalThis.document = { createElement: () => ({ style: {} }), addEventListener: () => {}, removeEventListener: () => {} }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { completed: true, allowNegativeTreasury: true, countryCode: 'EG', activityId: 'clinic', modules: [] }, fiscalYears: [] }, version: 0 }))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { buildYearClosingLines, validateYearClose, dateInClosedYear } = await import('../src/core/fiscal.ts')
const { incomeStatement, balanceSheet } = await import('../src/core/financialReports.ts')
const { customerUnitDocs, customerStatement, statementBalance, employeeStatement } = await import('../src/core/statements.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }
const S = () => useDataStore.getState()

/* تمويل الخزينة برأس مال حتى لا يعوق الصرف */
S().postManualEntry({ date: new Date().toISOString().slice(0, 10), description: 'رأس مال افتتاحي', lines: [
  { accountCode: '1101', debit: 10_000_00, credit: 0, note: '' },
  { accountCode: '3101', debit: 0, credit: 10_000_00, note: '' },
] })

console.log('— ① سند القبض يخفض رصيد المريض (جوهر البلاغ) —')
S().addCustomer({ nameAr: 'شركة التأمين الطبي', phone: '0100', creditLimitMinor: 0, notes: '', extended: null })
const customer = S().customers.at(-1)
const patient = S().addClinicPatient({ nameAr: 'مريض السند', phone: '0111', gender: 'male', birthDate: '', notes: '', history: undefined })
S().updateClinicPatient(patient.id, { linkedCustomerId: customer.id })
// زيارة آجلة 300 جنيه
S().addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: 'كشف', diagnosis: '', treatment: '', feeMinor: 300_00, paidMinor: 0, vatPercent: 0, planId: null, treasury: '1101', rxLines: [], vitals: null, nextVisit: '' })
ok(S().getPatientBalance(patient.id) === 300_00, 'زيارة آجلة 300 — رصيد المريض 300')
// سند قبض 200 من العميل المرتبط (1104)
S().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 200_00, description: 'تحصيل من شركة التأمين', partyKind: 'customer', partyId: customer.id })
ok(S().getPatientBalance(patient.id) === 100_00, 'بعد سند قبض 200: رصيد المريض انخفض إلى 100 (كان لا يتأثر إطلاقاً — الإصلاح)')
const autoCollection = S().clinicCollections.find((c) => c.patientId === patient.id)
ok(autoCollection && autoCollection.viaVoucherId != null, 'التحصيل التلقائي موسوم بسند القبض (viaVoucherId)')
// كشف حساب العميل = رصيد المريض (تطابق الملف مع الكشف)
const custBal1 = S().getCustomerBalance(customer.id)
ok(custBal1 === 100_00, `كشف حساب العميل ${custBal1 / 100} = ملف المريض 100 — لا تعارض بعد اليوم`)
// لا ازدواج: التحصيل عبر السند لا يتكرر صفين في الكشف
const rows1 = customerStatement({ customerId: customer.id, sales: S().sales, saleReturns: S().saleReturns, allSales: S().sales, vouchers: S().vouchers, cheques: S().cheques, extraDocs: customerUnitDocs({ customerId: customer.id, clinicVisits: S().clinicVisits, clinicCollections: S().clinicCollections, linkedPatientIds: [patient.id] }) })
const creditRows = rows1.filter((r) => r.creditMinor === 200_00)
ok(creditRows.length === 1, 'سند القبض يظهر صفاً واحداً في الكشف (لا ازدواج قيد)')
// تحصيل مباشر من ملف المريض يبقى يعمل
S().collectFromPatient(patient.id, 100_00, '1101')
ok(S().getPatientBalance(patient.id) === 0 && S().getCustomerBalance(customer.id) === 0, 'تحصيل الملف المباشر: المريض والعميل صفر معاً — مصدر حقيقة واحد')

console.log('— ② الكشف الموحّد يشمل كل الأنشطة —')
// مريض معمل مرتبط بالعميل + طلب آجل
const labPat = S().addLabPatient({ nameAr: 'مريض معمل', phone: '', gender: 'male', birthDate: '', notes: '' })
S().updateLabPatient(labPat.id, { linkedCustomerId: customer.id })
S().addLabTest({ nameAr: 'سكر صائم', code: 'FBS', category: 'كيمياء', sampleType: 'دم', unit: 'mg/dL', priceMinor: 150_00, costMinor: 0, refRanges: [] })
const test = S().labTests.at(-1)
S().registerLabOrder({ patientId: labPat.id, referrerId: null, testIds: [test.id], payment: 'credit', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
ok(S().getCustomerBalance(customer.id) === 150_00, 'طلب معمل آجل 150 لمريض مرتبط → دخل كشف العميل (كان غائباً)')
const docs = customerUnitDocs({ customerId: customer.id, labOrders: S().labOrders, linkedLabPatientIds: [labPat.id] })
ok(docs.some((d) => d.docLabel.includes('طلب معمل')), 'صف «طلب معمل … (آجل)» في المستندات')
// أقساط: خطة بمقدم وسداد
S().addCustomer({ nameAr: 'عميل أقساط', phone: '', creditLimitMinor: 0, notes: '', extended: null })
const instCust = S().customers.at(-1)
let instPlanned = false
try {
  S().createInstallmentPlan({ customerId: instCust.id, totalMinor: 1200_00, downPaymentMinor: 200_00, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', saleId: null, interestMinor: 200_00, notes: '' })
  instPlanned = true
} catch { /* واجهة مختلفة */ }
if (instPlanned) {
  const plan = S().installmentPlans.at(-1)
  S().payInstallment(plan.id, 100_00, '1101')
  const iDocs = customerUnitDocs({ customerId: instCust.id, installmentPlans: S().installmentPlans })
  ok(iDocs.some((d) => d.docLabel.includes('هامش تقسيط') && d.debitMinor === 200_00), 'هامش التقسيط 200 مدين في الكشف (كان غائباً)')
  ok(iDocs.some((d) => d.docLabel.includes('مقدم خطة') && d.creditMinor === 200_00), 'مقدم الخطة 200 دائن في الكشف (كان غائباً)')
  ok(iDocs.some((d) => d.docLabel.includes('سداد قسط') && d.creditMinor === 100_00), 'سداد القسط 100 دائن في الكشف (كان غائباً)')
} else {
  ok(false, 'createInstallmentPlan لم يعمل بالتوقيع المتوقع')
}

console.log('— ③ إقفال السنة المالية (منهجية عالمية) —')
const journal = S().journal
const thisYear = new Date().getFullYear()
const fy = { id: 1, nameAr: String(thisYear), startDate: `${thisYear}-01-01`, endDate: `${thisYear}-12-31`, status: 'open' }
// تحقق الرفض: سنة لم تنته
const errsOpen = validateYearClose(fy, [fy], new Date().toISOString().slice(0, 10))
ok(errsOpen.some((e) => e.includes('لا تُقفل سنة قبل انتهائها')), 'يُرفض إقفال سنة لم تنته بعد')
// سنة ماضية صناعية بنفس القيود
const fyPast = { id: 2, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }
const pastJournal = journal.map((e) => ({ ...e, date: `2025${e.date.slice(4)}` }))
const closing = buildYearClosingLines(pastJournal, fyPast)
const d = closing.lines.reduce((a, l) => a + l.debit, 0)
const c = closing.lines.reduce((a, l) => a + l.credit, 0)
ok(d === c && d > 0, `قيد الإقفال متوازن (${d} = ${c})`)
ok(closing.lines.some((l) => l.accountCode === '3102'), 'صافي النتيجة يُرحَّل إلى أرباح مرحّلة 3102')
// الإيرادات المقفلة: كل حساب 4xxx في القيد بسطر مدين يساوي صافي رصيده
const rev4108 = pastJournal.flatMap((e) => e.lines).filter((l) => l.accountCode === '4108').reduce((a, l) => a + l.credit - l.debit, 0)
if (rev4108 > 0) {
  const closes4108 = closing.lines.find((l) => l.accountCode === '4108')
  ok(closes4108 && closes4108.debit === rev4108, `إيراد الكشف 4108 (${rev4108}) يُصفَّر بالكامل`)
}
ok(closing.netProfitMinor === closing.totalRevenueMinor - closing.totalExpenseMinor, 'صافي الربح = إيرادات − مصروفات')
// بعد إضافة قيد الإقفال: قائمة دخل السنة المقفلة تظل تعرض الأرقام الحقيقية
const closedEntry = { id: 9999, entryNumber: 9999, date: fyPast.endDate, description: 'إقفال', sourceType: 'year_closing', sourceId: 2, lines: closing.lines, createdBy: '', createdAt: '', reversedByEntryId: null, reversesEntryId: null }
const journalAfter = [...pastJournal, closedEntry]
const inc2025 = incomeStatement(journalAfter, { from: '2025-01-01', to: '2025-12-31' })
ok(inc2025.netProfitMinor === closing.netProfitMinor, 'قائمة دخل السنة المقفلة تظل صحيحة (قيد الإقفال مستثنى)')
// الميزانية بعد الإقفال متوازنة ولا تحسب الربح مرتين
const bs = balanceSheet(journalAfter, '2025-12-31')
ok(bs.balanced, 'الميزانية بعد الإقفال متوازنة (لا ازدواج للأرباح المرحلة)')
// قفل الفترة
const closedFy = { ...fyPast, status: 'closed' }
ok(dateInClosedYear('2025-06-15', [closedFy]) !== null, 'تاريخ داخل سنة مقفلة يُكتشف (حارس القيود بأثر رجعي)')
ok(dateInClosedYear('2026-06-15', [closedFy]) === null, 'تاريخ خارجها لا يُحجب')
// الإقفال بالترتيب: سنة أقدم مفتوحة تمنع
const errsOrder = validateYearClose({ id: 3, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }, [fyPast, { id: 3, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }], '2026-09-16')
ok(errsOrder.length === 0, 'أقدم سنة منتهية تُقفل أولاً بلا مانع')
const errsSkip = validateYearClose(fyPast, [fyPast, { id: 3, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }], '2026-09-16')
ok(errsSkip.some((e) => e.includes('أقفل السنة الأقدم')), 'يُرفض تخطي سنة أقدم مفتوحة (الإقفال بالترتيب)')
// closeFiscalYear الحي في repo (سنة ماضية مفتوحة بقيود حقيقية)
useAppStore.getState().addFiscalYear({ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31' })
const liveFy = useAppStore.getState().fiscalYears.at(-1)
// لا قيود 2025 في المخزن الحي — يرفض «لا شيء يُقفل»
let liveCloseError = ''
try { S().closeFiscalYear(liveFy, useAppStore.getState().fiscalYears) } catch (e) { liveCloseError = e.message }
ok(liveCloseError.includes('لا حركة'), 'إقفال سنة بلا حركة يُرفض برسالة واضحة')
// أضف قيداً في 2025 ثم أقفل
S().postManualEntry({ date: '2025-05-01', description: 'إيراد 2025', lines: [
  { accountCode: '1101', debit: 500_00, credit: 0, note: '' },
  { accountCode: '4103', debit: 0, credit: 500_00, note: '' },
] })
const { netProfitMinor } = S().closeFiscalYear(liveFy, useAppStore.getState().fiscalYears)
ok(netProfitMinor === 500_00, `الإقفال الحي: صافي ربح 2025 = 500 (${netProfitMinor / 100})`)
useAppStore.getState().markFiscalYearClosed(liveFy.id)
ok(S().journal.some((e) => e.sourceType === 'year_closing' && e.sourceId === liveFy.id), 'قيد الإقفال sourceType=year_closing مثبت')
let dupError = ''
try { S().closeFiscalYear({ ...liveFy, status: 'open' }, [{ ...liveFy, status: 'open' }]) } catch (e) { dupError = e.message }
ok(dupError.includes('قيد إقفال بالفعل'), 'لا يُقفل مرتين')
let retroError = ''
try { S().postManualEntry({ date: '2025-06-01', description: 'قيد متأخر', lines: [
  { accountCode: '1101', debit: 100, credit: 0, note: '' },
  { accountCode: '4103', debit: 0, credit: 100, note: '' },
] }) } catch (e) { retroError = e.message }
ok(retroError.includes('مقفلة'), 'قيد يدوي بتاريخ داخل السنة المقفلة يُرفض (Closing Date)')

console.log('— ④ الرواتب: جزاءات + سلف + سداد نقدي —')
S().addEmployee({ nameAr: 'موظف الاختبار', phone: '', jobTitle: 'محاسب', baseSalaryMinor: 3000_00, allowancesMinor: 500_00, hireDate: '2026-01-01', active: true, notes: '', extended: null })
const emp = S().employees.at(-1)
// جزاء 400 بسجل
const ded = S().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 400_00, reason: 'غياب 3 أيام' })
ok(ded.dedNumber === 'DED-0001', 'الجزاء بمستند مرقم DED-0001')
ok(S().getEmployeeDeductionBalance(emp.id).remainingMinor === 400_00, 'متبقي الجزاءات 400')
// سلفة 600
S().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 600_00, treasury: '1101', notes: '' })
ok(S().getEmployeeAdvanceBalance(emp.id).remainingMinor === 600_00, 'متبقي السلف 600')
// سداد نقدي 150 خارج المسير
const rp = S().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 150_00, treasury: '1101' })
ok(rp.repayNumber === 'ADR-0001', 'السداد النقدي بمستند ADR-0001')
ok(S().getEmployeeAdvanceBalance(emp.id).remainingMinor === 450_00, 'بعد السداد النقدي: متبقي السلف 450')
const rpEntry = S().journal.find((e) => e.id === rp.journalEntryId)
ok(rpEntry.lines.some((l) => l.accountCode === '1107' && l.credit === 150_00), 'قيد السداد: دائن 1107 بالمبلغ')
let overRepay = ''
try { S().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 999_00, treasury: '1101' }) } catch (e) { overRepay = e.message }
ok(overRepay.includes('أكبر من متبقي'), 'سداد أكبر من المتبقي يُرفض')
// مسير: خصم جزء من الجزاء (250) وجزء من السلفة (200) — تأجيل الباقي
const run = S().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, lines: [
  { employeeId: emp.id, baseMinor: 3000_00, allowancesMinor: 500_00, overtimeMinor: 0, deductionsMinor: 250_00, advancesMinor: 200_00, excessPaidMinor: 0 },
], notes: '' })
ok(run.totals.netMinor === 3050_00, 'صافي المسير = 3500 − 250 − 200 = 3050')
ok(S().getEmployeeDeductionBalance(emp.id).remainingMinor === 150_00, 'الجزاء تتبّع: خُصم 250 وبقي 150 مؤجلاً (خصم جزئي بحرية المالك)')
ok(S().getEmployeeAdvanceBalance(emp.id).remainingMinor === 250_00, 'السلفة تتبّع: 450 − 200 = 250')
// كشف الموظف يشمل السداد النقدي
const empRows = employeeStatement({ employeeId: emp.id, advances: S().employeeAdvances, payrollRuns: S().payrollRuns, advanceRepayments: S().advanceRepayments })
ok(empRows.some((r) => r.docLabel.includes('سداد نقدي ADR-0001')), 'كشف الموظف يعرض السداد النقدي (كان غائباً)')
ok(statementBalance(empRows) === 250_00, 'رصيد كشف الموظف = 250 يطابق متبقي السلف')
// قيد المسير: 5102 بالمدفوع + السلف — الخصومات خفّضت المصروف بطبيعتها
const runEntry = S().journal.find((e) => e.id === run.journalEntryId)
const dr5102 = runEntry.lines.find((l) => l.accountCode === '5102')
ok(dr5102.debit === 3250_00, 'مصروف الرواتب 5102 = صافي 3050 + سلف مستردة 200 (الجزاء 250 خفّضه تلقائياً)')
const cr1107 = runEntry.lines.find((l) => l.accountCode === '1107')
ok(cr1107.credit === 200_00, 'استرداد السلفة من 1107 بالمسير')
// تسوية مطابقة العميل تستخدم الرصيد الموحد
const varRes = S().applySettlement({ section: 'customer', refId: customer.id, actualMinor: 150_00, reason: 'مطابقة يدوية' })
const setDoc = S().settlements.at(-1)
ok(setDoc.bookMinor === 150_00, 'تسوية المطابقة: الرصيد الدفتري = الموحّد (يشمل المعمل 150) — كانت تحسب بدون الأنشطة')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
