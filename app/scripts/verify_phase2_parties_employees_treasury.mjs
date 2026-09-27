/**
 * المرحلة 2 من خطة التدقيق المحاسبي — الأقسام 2.5 الأطراف والذمم · 2.6 الموظفون · 2.7 الخزائن والبنوك.
 *
 * 2.5: كشف حساب العميل/المورد = الدفتر · سند قبض بتوزيع FIFO · الرصيد الافتتاحي (opening) ·
 *      المقاصة عميل/مورد · عكس سند القبض.
 * 2.6: سلفة موظف (1107) · جزاء/خصم · مسير شامل ومسير فرد (5102/2104) · استقطاع السلفة داخل المسير ·
 *      عمولة (استحقاق 5117/2116 ثم صرفها) · عهدة (فتح/صرف/تسوية بعجز ⇒ سلفة).
 * 2.7: تحويل بين خزينتين برسوم · ماكينة دفع وعمولتها وتوريدها · شيك وارد (تحصيل) وشيك مرتد · شيك صادر.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase2_parties_employees_treasury.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'

const R = reporter('المرحلة 2 — 2.5 الأطراف و2.6 الموظفون و2.7 الخزائن')
const money = (n) => `${(n / 100).toLocaleString('ar-EG')}ج`
const bal = (c, code) => balanceOf(c.st().journal, code)
const lineOf = (entry, code) => {
  const rows = entry.lines.filter((l) => l.accountCode === code)
  if (!rows.length) return null
  return { debit: rows.reduce((s, l) => s + l.debit, 0), credit: rows.reduce((s, l) => s + l.credit, 0) }
}
const emp = (c, nameAr, salary = 600000) => {
  c.st().addEmployee({ nameAr, phone: '', jobTitle: 'موظف', hireDate: '2026-01-01', baseSalaryMinor: salary, allowancesMinor: 0, active: true, notes: '' })
  return c.st().employees.at(-1)
}
const sellOnCredit = (c, customerId, amountMinor) => {
  const item = addSimpleItem(c, { nameAr: `خدمة ${amountMinor}`, priceMinor: amountMinor, isService: true })
  return c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: amountMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.5 الأطراف والذمم —')
// ══════════════════════════════════════════════════════════════════

// (1) كشف حساب العميل = دفتر 1104 بعد بيع وتحصيل جزئي، والتوزيع FIFO على أقدم فاتورة
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل الكشف')
  const inv1 = sellOnCredit(c, cust.id, 100000)
  const inv2 = sellOnCredit(c, cust.id, 60000)
  assert.equal(c.st().getCustomerBalance(cust.id), 160000)
  const v = c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 120000,
    description: 'تحصيل من العميل', partyKind: 'customer', partyId: cust.id,
  })
  const e = c.st().journal.find((x) => x.id === v.journalEntryId)
  assert.equal(lineOf(e, '1101').debit, 120000)
  assert.equal(lineOf(e, '1104').credit, 120000)
  assert.equal(c.st().getCustomerBalance(cust.id), 40000)
  assert.equal(bal(c, '1104'), 40000, 'ث7: الكشف = الدفتر')
  const rows = c.st().getCustomerStatementRows(cust.id)
  assert.equal(rows.at(-1).balanceMinor ?? rows.at(-1).balance, 40000)
  // FIFO: الأقدم سُدد بالكامل والثانية جزئياً
  const settled = c.st().sales.find((s) => s.id === inv1.id)
  const partial = c.st().sales.find((s) => s.id === inv2.id)
  const paidOf = (sale) => (c.st().getSalePaidMinor ? c.st().getSalePaidMinor(sale.id) : null)
  if (paidOf(settled) != null) {
    assert.equal(paidOf(settled), 100000, 'الأقدم أُقفلت أولاً (FIFO)')
    assert.equal(paidOf(partial), 20000)
  }
  assertInvariants('تحصيل عميل', c)
  R.ok(`كشف العميل: فاتورتان ${money(160000)} − تحصيل ${money(120000)} = ${money(40000)} في الكشف والدفتر معاً`)
}

// (2) الرصيد الافتتاحي للطرف: sourceType='opening' ومقابله رأس المال 3101
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل قديم')
  const sup = addParty(c, 'supplier', 'مورد قديم')
  c.st().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 250000, label: 'رصيد سابق' })
  c.st().setOpeningBalance({ kind: 'supplier', refId: sup.id, amountMinor: 180000, label: 'رصيد سابق' })
  const openings = c.st().journal.filter((e) => e.sourceType === 'opening')
  assert.equal(openings.length, 2, 'قيود الافتتاح موسومة opening لا adjustment')
  assert.equal(bal(c, '1104'), 250000)
  assert.equal(bal(c, '2101'), -180000)
  assert.equal(bal(c, '3101'), -(250000 - 180000), 'صافي الافتتاح مقابل رأس المال')
  assert.equal(c.st().getCustomerBalance(cust.id), 250000)
  assert.equal(c.st().getSupplierBalance(sup.id), 180000)
  assertInvariants('أرصدة افتتاحية', c)
  R.ok(`افتتاحي: عميل ${money(250000)} ومورد ${money(180000)} مقابل 3101 — والوسم opening`)
  // التعديل يرحّل الفرق فقط
  const before = c.st().journal.length
  c.st().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 300000, label: 'تصحيح' })
  assert.equal(c.st().journal.length, before + 1)
  assert.equal(bal(c, '1104'), 300000, 'الفرق فقط (+500ج) لا قيد جديد كامل')
  R.ok('تعديل الافتتاحي يرحّل الفرق فقط — لا تضخيم للأرصدة')
}

// (3) المقاصة عميل/مورد (نفس الشخص): تخفيض الطرفين بقيد واحد متوازن
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'شريك تجاري')
  const sup = addParty(c, 'supplier', 'شريك تجاري')
  sellOnCredit(c, cust.id, 200000)
  const item = addSimpleItem(c, { nameAr: 'بضاعة', priceMinor: 5000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-05-01', lines: [{ itemId: item.id, qty: 30, unitPriceMinor: 5000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  assert.equal(c.st().getCustomerBalance(cust.id), 200000)
  assert.equal(c.st().getSupplierBalance(sup.id), 150000)
  // AUDIT-011: القيد اليدوي على حسابات المراقبة ممنوع (كان يفصل الدفتر عن الكشف)
  expectReject('قيد يدوي على 1104/2101', c, () => c.st().postManualEntry({
    date: '2026-05-02', description: 'مقاصة بقيد يدوي',
    lines: [
      { accountCode: '2101', debit: 150000, credit: 0, note: 'إقفال دين المورد' },
      { accountCode: '1104', debit: 0, credit: 150000, note: 'تخفيض ذمة العميل' },
    ],
  }), /حساب مراقبة/)
  R.ok('رفض ذري: لا قيد يدوي على حسابات المراقبة (1104/2101) — الرسالة ترشد للمستند الصحيح')
  // AUDIT-012: المستند الصحيح — مقاصة OFS تظهر في الدفتر وكشفي الطرفين معاً
  const offset = c.st().postPartyOffset({ customerId: cust.id, supplierId: sup.id, amountMinor: 150000, notes: 'مقاصة نصف سنوية' })
  const oe = c.st().journal.find((x) => x.id === offset.journalEntryId)
  assert.equal(oe.sourceType, 'party_offset')
  assert.equal(lineOf(oe, '2101').debit, 150000)
  assert.equal(lineOf(oe, '1104').credit, 150000)
  assert.equal(bal(c, '1104'), 50000)
  assert.equal(bal(c, '2101'), 0)
  assert.equal(c.st().getCustomerBalance(cust.id), 50000, 'كشف العميل تحرك مع الدفتر')
  assert.equal(c.st().getSupplierBalance(sup.id), 0, 'كشف المورد أُقفل مع الدفتر')
  assert.ok(c.st().getCustomerStatementRows(cust.id).some((r) => (r.docLabel ?? '').includes(offset.offsetNumber)), 'صف المقاصة في كشف العميل')
  assert.ok(c.st().getSupplierStatementRows(sup.id).some((r) => (r.docLabel ?? '').includes(offset.offsetNumber)), 'صف المقاصة في كشف المورد')
  assertInvariants('مقاصة بمستند', c)
  R.ok(`مقاصة ${offset.offsetNumber}: ${money(150000)} خفضت الطرفين — الدفتر والكشفان متطابقون (ث7)`)
  expectReject('مقاصة أكبر من أقل الرصيدين', c, () => c.st().postPartyOffset({
    customerId: cust.id, supplierId: sup.id, amountMinor: 90000,
  }), /أقصى مقاصة|لا مستحق/)
  R.ok('رفض ذري: المقاصة لا تتجاوز أقل الرصيدين')
  expectReject('قيد يدوي غير متوازن', c, () => c.st().postManualEntry({
    date: '2026-05-03', description: 'خطأ', lines: [
      { accountCode: '1101', debit: 1000, credit: 0, note: 'x' },
      { accountCode: '4101', debit: 0, credit: 900, note: 'y' },
    ],
  }))
  R.ok('رفض ذري: قيد يدوي غير متوازن لا يُحفظ')
}

// (4) عكس سند القبض: قيد عاكس مرتبط ورصيد العميل يعود
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل العكس')
  sellOnCredit(c, cust.id, 90000)
  const v = c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 90000,
    description: 'تحصيل', partyKind: 'customer', partyId: cust.id,
  })
  assert.equal(c.st().getCustomerBalance(cust.id), 0)
  c.st().reverseVoucher(v.id, 'شيك مرتجع من البنك')
  assert.equal(c.st().getCustomerBalance(cust.id), 90000, 'الدين عاد')
  assert.equal(bal(c, '1101'), 0, 'النقدية عادت لما كانت')
  const orig = c.st().journal.find((x) => x.id === v.journalEntryId)
  const rev = c.st().journal.find((x) => x.reversesEntryId === orig.id)
  assert.ok(rev && orig.reversedByEntryId === rev.id, 'ث9: الربط ثنائي الاتجاه')
  assertInvariants('عكس سند قبض', c)
  R.ok('عكس السند: قيد عاكس مربوط ثنائياً — الدين والنقدية عادا بالضبط')
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.6 الموظفون —')
// ══════════════════════════════════════════════════════════════════

// (5) سلفة موظف: 1107 مدين / الخزينة دائن، والمتبقي يتتبع
{
  const c = await freshCase({ activityId: 'general' })
  const e1 = emp(c, 'موظف السلفة')
  const adv = c.st().grantEmployeeAdvance({ employeeId: e1.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة شهر' })
  const entry = c.st().journal.at(-1)
  assert.equal(lineOf(entry, '1107').debit, 100000, 'سلف الموظفين أصل مدين')
  assert.equal(lineOf(entry, '1101').credit, 100000)
  assert.equal(c.st().getEmployeeAdvanceBalance(e1.id).remainingMinor, 100000)
  assertInvariants('سلفة موظف', c)
  R.ok(`سلفة ${money(100000)}: 1107 مدين / الخزينة دائنة — والمتبقي ${money(100000)}`)
  assert.equal(adv.employeeId, e1.id)
}

// (6) مسير رواتب شامل لموظفين + استقطاع سلفة + جزاء
{
  const c = await freshCase({ activityId: 'general' })
  const a = emp(c, 'موظف أ', 500000)
  const b = emp(c, 'موظف ب', 400000)
  c.st().grantEmployeeAdvance({ employeeId: a.id, amountMinor: 50000, treasury: '1101', notes: 'سلفة' })
  c.st().addEmployeeDeduction({ employeeId: b.id, amountMinor: 20000, reason: 'تأخير', notes: '' })
  const run = c.st().postPayroll({
    month: '2026-05', payMode: 'cash', treasury: '1101', notes: 'مسير مايو',
    lines: [
      { employeeId: a.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 20000, deductionsMinor: 0, advancesMinor: 50000 },
      { employeeId: b.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 20000, advancesMinor: 0 },
    ],
  })
  const e = c.st().journal.find((x) => x.id === run.journalEntryId)
  const gross = 520000 + 400000
  // الجزاء يخفض مصروف الرواتب فعلياً (تكلفة العمالة الحقيقية أقل)، والسلفة تُسترد على 1107
  const expense = gross - 20000
  assert.equal(lineOf(e, '5102').debit, expense, 'مصروف الرواتب = الإجمالي − الجزاءات')
  assert.equal(lineOf(e, '1107').credit, 50000, 'السلفة تُسترد من المسير على حسابها لا كمصروف')
  const netPaid = gross - 50000 - 20000
  assert.equal(lineOf(e, '1101').credit, netPaid, 'المصروف نقداً = الصافي')
  assert.equal(lineOf(e, '5102').debit, lineOf(e, '1101').credit + lineOf(e, '1107').credit, 'طرفا القيد متطابقان بالقرش')
  assert.equal(c.st().getEmployeeAdvanceBalance(a.id).remainingMinor, 0)
  assertInvariants('مسير شامل', c)
  R.ok(`مسير موظفَين: مصروف ${money(expense)} (بعد جزاء ${money(20000)}) · استرداد سلفة ${money(50000)} · نقدي ${money(netPaid)}`)
  expectReject('تكرار مسير نفس الشهر', c, () => c.st().postPayroll({
    month: '2026-05', payMode: 'cash', treasury: '1101', notes: 'مكرر',
    lines: [{ employeeId: a.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }],
  }))
  R.ok('رفض ذري: لا مسيران لنفس الشهر')
}

// (7) مسير فرد بالاستحقاق (2104) ثم صرفه لاحقاً
{
  const c = await freshCase({ activityId: 'general' })
  const a = emp(c, 'موظف الاستحقاق', 300000)
  const run = c.st().postPayroll({
    month: '2026-06', payMode: 'accrue', treasury: '1101', notes: 'استحقاق يونيو',
    lines: [{ employeeId: a.id, baseMinor: 300000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }],
  })
  const e = c.st().journal.find((x) => x.id === run.journalEntryId)
  assert.equal(lineOf(e, '5102').debit, 350000)
  assert.equal(lineOf(e, '2104').credit, 350000, 'رواتب مستحقة التزام')
  assert.equal(lineOf(e, '1101'), null, 'الاستحقاق لا يمس الخزينة')
  const v = c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 350000, description: 'صرف راتب يونيو' })
  const pe = c.st().journal.find((x) => x.id === v.journalEntryId)
  assert.equal(lineOf(pe, '2104').debit, 350000)
  assert.equal(lineOf(pe, '1101').credit, 350000)
  assert.equal(bal(c, '2104'), 0, 'الالتزام أُقفل بالصرف')
  assertInvariants('مسير بالاستحقاق', c)
  R.ok(`استحقاق ${money(350000)} على 2104 ثم صرفه من الخزينة — الالتزام صفر`)
}

// (8) العهدة: فتح/صرف/تسوية بعجز يتحول سلفة على الموظف
{
  const c = await freshCase({ activityId: 'general' })
  const a = emp(c, 'أمين العهدة')
  const file = c.st().openCustodyFile({ employeeId: a.id, projectId: null, reason: 'مشتريات تشغيل', notes: '' })
  c.st().fundCustodyFile({ fileId: file.id, amountMinor: 200000, treasury: '1101', description: 'تمويل عهدة' })
  assert.equal(bal(c, '1108'), 200000, 'العهدة أصل على الموظف (1108)')
  assert.equal(bal(c, '1101'), -200000)
  c.st().postCustodyExpense({ fileId: file.id, amountMinor: 120000, description: 'أدوات نظافة', expenseAccount: '5108' })
  assert.equal(bal(c, '5108'), 120000, 'مصروف العهدة على حسابه')
  assert.equal(bal(c, '1108'), 80000, 'رصيد العهدة انخفض بالمصروف')
  assertInvariants('عهدة قبل التسوية', c)
  // تسوية بإرجاع 50 فقط ⇒ العجز 300 يتحول سلفة على الموظف (1107)
  c.st().settleCustodyFile({ fileId: file.id, returnedMinor: 50000, treasury: '1101' })
  assert.equal(bal(c, '1108'), 0, 'ملف العهدة أُقفل بالكامل')
  assert.equal(bal(c, '1107'), 30000, 'العجز صار سلفة على الموظف تُخصم من رواتبه')
  assert.equal(c.st().getEmployeeAdvanceBalance(a.id).remainingMinor, 30000)
  assertInvariants('تسوية عهدة بعجز', c)
  R.ok(`عهدة: تمويل ${money(200000)} · صرف ${money(120000)} · إرجاع ${money(50000)} · العجز ${money(30000)} سلفة على الموظف — 1108 صفر`)
}

// (9) عمولة موظف: استحقاق ثم صرف — 5117 مصروف مرة واحدة و2116 يُقفل
{
  const c = await freshCase({ activityId: 'general' })
  const a = emp(c, 'مندوب العمولة')
  const item = addSimpleItem(c, { nameAr: 'خدمة', priceMinor: 100000, isService: true })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: 'خدمة', qty: 1, unitPriceMinor: 100000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
    staffCommission: { employeeId: a.id, amountMinor: 8000, description: 'عمولة' },
  })
  assert.equal(bal(c, '5117'), 8000)
  assert.equal(bal(c, '2116'), -8000)
  const commission = c.st().staffCommissions.at(-1)
  c.st().payStaffCommission({ commissionId: commission.id, treasury: '1101' })
  assert.equal(bal(c, '2116'), 0, 'الالتزام أُقفل بالصرف')
  assert.equal(bal(c, '5117'), 8000, 'المصروف لم يتكرر')
  assertInvariants('عمولة موظف', c)
  R.ok(`عمولة ${money(8000)}: استحقاق 5117/2116 ثم صرف 2116/الخزينة — لا ازدواج مصروف`)
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.7 الخزائن والبنوك —')
// ══════════════════════════════════════════════════════════════════

// (10) تحويل بين خزينتين برسوم بنكية
{
  const c = await freshCase({ activityId: 'general' })
  c.st().addTreasury('بنك الأهلي', 'bank')
  const bank = c.st().treasuries.at(-1)
  c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 1000000, description: 'رأس مال نقدي' })
  const v = c.st().postVoucher({
    kind: 'transfer', treasury: '1101', counterAccountCode: bank.code, amountMinor: 400000,
    description: 'إيداع بنكي', feeMinor: 2000,
  })
  const e = c.st().journal.find((x) => x.id === v.journalEntryId)
  assert.equal(lineOf(e, bank.code).debit, 400000)
  assert.equal(lineOf(e, '1101').credit, 402000, 'الخارج = المحول + الرسوم')
  assert.equal(lineOf(e, '5108').debit, 2000, 'الرسوم مصروف')
  assert.equal(bal(c, '1101'), 1000000 - 402000)
  assert.equal(bal(c, bank.code), 400000)
  assertInvariants('تحويل خزائن', c)
  R.ok(`تحويل ${money(400000)} برسوم ${money(2000)}: الخزينة −${money(402000)} والبنك +${money(400000)}`)
  expectReject('تحويل لنفس الخزينة', c, () => c.st().postVoucher({
    kind: 'transfer', treasury: '1101', counterAccountCode: '1101', amountMinor: 1000, description: 'خطأ',
  }))
  R.ok('رفض ذري: تحويل من الخزينة لنفسها')
}

// (11) شيك وارد: تحت التحصيل ثم محصَّل — ثم شيك مرتد يعيد الدين
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل الشيك')
  sellOnCredit(c, cust.id, 500000)
  c.st().addTreasury('بنك مصر', 'bank')
  const bank = c.st().treasuries.at(-1)
  const cheque = c.st().receiveCheque({
    chequeNumber: 'CHQ-1', partyId: cust.id, bankName: 'بنك مصر', amountMinor: 500000, dueDate: '2026-07-01', notes: '',
  })
  const e1 = c.st().journal.at(-1)
  assert.equal(lineOf(e1, '1106').debit, 500000, 'أوراق القبض (شيكات واردة) أصل مدين')
  assert.equal(lineOf(e1, '1104').credit, 500000, 'ذمة العميل انخفضت باستلام الشيك')
  c.st().setChequeStatus(cheque.id, 'collected', bank.code)
  assert.equal(bal(c, bank.code), 500000, 'التحصيل أدخل البنك')
  assertInvariants('شيك وارد محصَّل', c)
  R.ok(`شيك وارد ${money(500000)}: تحت التحصيل ← البنك · وذمة العميل انخفضت مرة واحدة`)
  // شيك ثانٍ يرتد
  const cheque2 = c.st().receiveCheque({
    chequeNumber: 'CHQ-2', partyId: cust.id, bankName: 'بنك مصر', amountMinor: 100000, dueDate: '2026-08-01', notes: '',
  })
  const arBefore = bal(c, '1104')
  c.st().setChequeStatus(cheque2.id, 'bounced')
  assert.equal(bal(c, '1104') - arBefore, 100000, 'الارتداد يعيد الدين على العميل')
  assertInvariants('شيك مرتد', c)
  R.ok('الشيك المرتد: الدين عاد على العميل ولا نقدية دخلت')
}

// (12) شيك صادر لمورد: 2101 ← شيكات دفع مستحقة ثم صرفه من البنك
{
  const c = await freshCase({ activityId: 'general' })
  const sup = addParty(c, 'supplier', 'مورد الشيك')
  const item = addSimpleItem(c, { nameAr: 'بضاعة', priceMinor: 10000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-06-01', lines: [{ itemId: item.id, qty: 40, unitPriceMinor: 10000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().addTreasury('بنك القاهرة', 'bank')
  const bank = c.st().treasuries.at(-1)
  c.st().postVoucher({ kind: 'receipt', treasury: bank.code, counterAccountCode: '3101', amountMinor: 1000000, description: 'إيداع رأس مال' })
  const chq = c.st().issueCheque({
    chequeNumber: 'OUT-1', partyId: sup.id, bankName: 'بنك القاهرة', amountMinor: 400000, dueDate: '2026-07-15', notes: '',
  })
  const e = c.st().journal.at(-1)
  assert.equal(lineOf(e, '2101').debit, 400000, 'دين المورد انتقل لالتزام الشيك')
  assert.equal(c.st().getSupplierBalance(sup.id), 0, 'المورد صفر بعد تحرير الشيك')
  const bankBefore = bal(c, bank.code)
  c.st().setChequeStatus(chq.id, 'cleared', bank.code)
  assert.equal(bal(c, bank.code) - bankBefore, -400000, 'الصرف خرج من البنك')
  assertInvariants('شيك صادر', c)
  R.ok(`شيك صادر ${money(400000)}: 2101 ← التزام شيكات ← خروج من البنك عند الصرف`)
}

R.done('— 2.5 و2.6 و2.7 مغطاة بجدول «الحدث ← القيد»')
