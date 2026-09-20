/**
 * 🏦 رحلة عرضية للأقسام المشتركة (تعمل في كل الأنشطة):
 * 1) خزائن وبنوك: إضافة بنك → تحويل بينهما برسوم 5108 → حراس الأشباح.
 * 2) سندات قبض/صرف مربوطة بطرف.
 * 3) شيك وارد: حافظة → إيداع → تحصيل بالبنك + آلة الحالات الصارمة + منع التكرار.
 * 4) شيك وارد يرتد: الدين يعود على العميل.
 * 5) شيك صادر: تحرير → صرف؛ وآخر يُلغى فيعود الدين للمورد.
 * 6) خطة أقساط بهامش تمويل 4111: مقدم فوري + سداد يوزع على الأقدم أولاً.
 * 7) رواتب: سلفة 1107 → مسير يستقطع جزءاً → جزاء يُسجل ثم يُعفى → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_shared_finance.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

console.log('\n═══ 1) بنك جديد + تحويل برسوم + حراس الأشباح ═══')
let bank
{
  bank = st().addTreasury('بنك مصر — فرع المنصورة', 'bank', { iban: 'EG380019000500000000263180002', branch: 'المنصورة' })
  assert.ok(bank.code >= '1121', 'كود دفتري تلقائي للبنك')
  // إيداع رأس مال بسيط في النقدية أولاً (قيد يدوي متوازن)
  st().postManualEntry({ date: '2026-09-20', description: 'رأس مال افتتاحي', lines: [
    { accountCode: '1101', debit: 500000, credit: 0, note: '' },
    { accountCode: '3101', debit: 0, credit: 500000, note: '' },
  ] })
  // تحويل 2000ج من النقدية للبنك برسوم 15ج
  st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: bank.code, amountMinor: 200000, description: 'إيداع بنكي', feeMinor: 1500 })
  assert.equal(acctBal(bank.code), 200000, 'وصل البنك 2000')
  assert.equal(acctBal('1101'), 500000 - 200000 - 1500, 'خرج من النقدية المبلغ + الرسوم')
  assert.equal(acctBal('5108'), 1500, 'الرسوم مصروف بنكي')
  // حراس: خزينة شبح / حساب مقابل شبح / وجهة تحويل شبح
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '9999', counterAccountCode: '4110', amountMinor: 100, description: 'x' }), /غير موجود/)
  assert.throws(() => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5999', amountMinor: 100, description: 'x' }), /غير موجود/)
  assert.throws(() => st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1104', amountMinor: 100, description: 'x' }), /الوجهة/)
  ok(`بنك ${bank.code} + تحويل 2000 برسوم 15 (5108) + 3 حراس أشباح يعملون`)
}

console.log('\n═══ 2) سند قبض من عميل وسند صرف لمورد ═══')
{
  st().addCustomer({ nameAr: 'شركة النور', phone: '0100', creditLimitMinor: 10000000, notes: '', ...EXT })
  st().addSupplier({ nameAr: 'مورد المواد', phone: '0111', notes: '', ...EXT })
  const c = st().customers[0]
  const s = st().suppliers[0]
  // سند قبض 300ج من العميل (يخفض ذمته) وسند صرف 150ج للمورد (يخفض ديننا)
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 30000, description: 'دفعة من شركة النور', partyKind: 'customer', partyId: c.id })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 15000, description: 'دفعة لمورد المواد', partyKind: 'supplier', partyId: s.id })
  assert.equal(acctBal('1104'), -30000, 'ذمة العميل انخفضت')
  assert.equal(acctBal('2101'), 15000, 'دين المورد انخفض')
  // طرف شبح مرفوض
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100, description: 'x', partyKind: 'customer', partyId: 999 }), /غير موجود/)
  ok('سند قبض 300 وسند صرف 150 بطرفين مسجلين — والطرف الشبح مرفوض')
}

console.log('\n═══ 3) شيك وارد: حافظة → إيداع → تحصيل + آلة حالات صارمة ═══')
{
  const c = st().customers[0]
  const ch = st().receiveCheque({ chequeNumber: '445566', partyId: c.id, bankName: 'CIB', amountMinor: 80000, dueDate: '2026-10-01', notes: '' })
  assert.equal(ch.status, 'held')
  assert.equal(acctBal('1106'), 80000, 'أوراق قبض مدينة')
  // نفس الرقم والبنك مرفوض
  assert.throws(() => st().receiveCheque({ chequeNumber: '445566', partyId: c.id, bankName: 'CIB', amountMinor: 100, dueDate: '2026-10-01', notes: '' }), /مسجل من قبل/)
  st().setChequeStatus(ch.id, 'deposited')
  st().setChequeStatus(ch.id, 'collected', bank.code)
  assert.equal(acctBal('1106'), 0, 'أوراق القبض صُفيت')
  assert.equal(acctBal(bank.code), 200000 + 80000, 'الشيك دخل البنك')
  // نهائية: لا انتقال بعد التحصيل
  assert.throws(() => st().setChequeStatus(ch.id, 'bounced'))
  ok('شيك 800 حُصل في البنك عبر الدورة الكاملة — التكرار والانتقال بعد النهائية مرفوضان')
}

console.log('\n═══ 4) شيك وارد يرتد: الدين يعود على العميل ═══')
{
  const c = st().customers[0]
  const before1104 = acctBal('1104')
  const ch = st().receiveCheque({ chequeNumber: '778899', partyId: c.id, bankName: 'QNB', amountMinor: 50000, dueDate: '2026-10-05', notes: '' })
  st().setChequeStatus(ch.id, 'deposited')
  st().setChequeStatus(ch.id, 'bounced')
  assert.equal(acctBal('1106'), 0, 'الورقة خرجت من أوراق القبض')
  assert.equal(acctBal('1104'), before1104, 'ذمة العميل عادت كما كانت قبل الشيك (الاستلام خفضها والارتداد أعادها)')
  ok('شيك 500 ارتد — الدين رجع على العميل وأوراق القبض صفر')
}

console.log('\n═══ 5) شيك صادر يُصرف وآخر يُلغى ═══')
{
  const s = st().suppliers[0]
  const ch1 = st().issueCheque({ chequeNumber: '111', partyId: s.id, bankName: 'بنك مصر', amountMinor: 40000, dueDate: '2026-10-10', notes: '' })
  assert.equal(acctBal('2106'), -40000, 'أوراق دفع دائنة')
  st().setChequeStatus(ch1.id, 'cleared', bank.code)
  assert.equal(acctBal('2106'), 0)
  assert.equal(acctBal(bank.code), 280000 - 40000, 'صُرف من البنك')
  const before2101 = acctBal('2101')
  const ch2 = st().issueCheque({ chequeNumber: '112', partyId: s.id, bankName: 'بنك مصر', amountMinor: 25000, dueDate: '2026-11-01', notes: '' })
  st().setChequeStatus(ch2.id, 'cancelled')
  assert.equal(acctBal('2101'), before2101, 'الإلغاء أعاد دين المورد كما كان')
  ok('شيك صادر 400 صُرف من البنك، وشيك 250 أُلغي فعاد الدين للمورد')
}

console.log('\n═══ 6) خطة أقساط بهامش تمويل: مقدم فوري + توزيع الأقدم أولاً ═══')
{
  // الحارس: لا خطة أقساط بلا ذمة قائمة تغطي أصلها (فاتورة آجلة أو رصيد افتتاحي)
  assert.throws(() => st().createInstallmentPlan({ customerId: st().customers[0].id, saleId: null, totalMinor: 440000, downPaymentMinor: 40000, interestMinor: 40000, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' }), /أكبر من ذمة العميل/)
  // عميل بذمة افتتاحية 4000 — أصل الخطة مغطى
  st().addCustomer({ nameAr: 'عميل التقسيط', phone: '0155', creditLimitMinor: 100000000, notes: '', ...EXT })
  const c = st().customers[1]
  st().setOpeningBalance({ kind: 'customer', refId: c.id, amountMinor: 400000, label: 'مديونية سابقة' })
  // مديونية أصلها 4000 + هامش 400 = 4400، مقدم 400، والباقي 4000 على 4 أقساط شهرية
  const plan = st().createInstallmentPlan({ customerId: c.id, saleId: null, totalMinor: 440000, downPaymentMinor: 40000, interestMinor: 40000, count: 4, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' })
  assert.equal(acctBal('4111'), -40000, 'هامش التقسيط إيراد 4111')
  assert.equal(plan.items.length, 4)
  const scheduled = plan.items.reduce((s, i) => s + i.amountMinor, 0)
  assert.equal(scheduled, 400000, 'المجدول = الإجمالي − المقدم')
  // سداد 150000 يغطي القسط الأول (100000) وجزءاً من الثاني
  const p2 = st().payInstallment(plan.id, 150000, '1101')
  assert.equal(p2.items[0].paidMinor, p2.items[0].amountMinor, 'القسط الأول اكتمل')
  assert.equal(p2.items[1].paidMinor, 150000 - p2.items[0].amountMinor, 'الفائض ذهب للقسط الثاني')
  assert.equal(p2.items[2].paidMinor, 0, 'الثالث لم يُمس')
  ok('حارس الذمة يعمل + خطة 4400 بهامش 400 (4111): مقدم 400 وسداد 1500 وُزع على الأقدم أولاً')
}

console.log('\n═══ 7) رواتب: سلفة → استقطاع بالمسير → جزاء يُعفى → الميزان ═══')
{
  st().addEmployee({ nameAr: 'محمود البائع', phone: '0120', jobTitle: 'بائع', hireDate: '2025-01-01', baseSalaryMinor: 500000, allowancesMinor: 50000, active: true, notes: '', ...EXT })
  const emp = st().employees[0]
  st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة طارئة' })
  assert.equal(acctBal('1107'), 100000, 'السلفة أصل على الموظف')
  // جزاء 50ج ثم عفو عنه
  const ded = st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 5000, reason: 'تأخير' })
  st().waiveEmployeeDeduction({ deductionId: ded.id, approvedBy: 'المالك', reason: 'أول مرة — عفو' })
  assert.equal(st().getEmployeeDeductionBalance(emp.id).remainingMinor, 0, 'الجزاء أُعفي بالكامل')
  // مسير سبتمبر: يستقطع 400 من السلفة فقط
  st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [
    { employeeId: emp.id, baseMinor: 500000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40000 },
  ], notes: '' })
  assert.equal(acctBal('1107'), 60000, 'بقي من السلفة 600')
  assert.equal(st().getEmployeeAdvanceBalance(emp.id).remainingMinor, 60000, 'رصيد السلفة متطابق مع الدفاتر')
  assert.equal(acctBal('5102'), 550000, 'مصروف الرواتب = أساسي + بدلات')
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`سلفة 1000 استُقطع منها 400 بالمسير، جزاء مُعفى، ${st().journal.length} قيداً متزنة (ميزان ${tb.totalDebitMinor})`)
}

console.log(`\n✅ رحلة الأقسام المالية المشتركة: ${pass} محطات — كلها خضراء\n`)
