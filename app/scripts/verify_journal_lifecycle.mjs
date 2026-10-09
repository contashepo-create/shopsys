/**
 * verify_journal_lifecycle.mjs — دورة حياة كاملة لدفتر اليومية في سيناريو واحد متصل.
 * (طلب المالك 2026-10-09): «تأكد أن القيود تُنشأ بشكل سليم — وأن إنشاء القيد الحر
 * اليدوي يعمل بشكل سليم ويؤثر بشكل سليم على الحسابات التي تمت عليها العملية».
 *
 * المحطات: قيد حر افتتاحي → شراء آجل → بيع نقدي بالضريبة → تعديل البيع (عكس + قيد
 * جديد) → مرتجع البيع → مرتجع الشراء → قيد حر على حساب عميل → عكس القيد الحر.
 * في كل محطة:
 *   • كل قيد متوازن بذاته (assertBalanced)
 *   • ميزان المراجعة متزن (trialBalance) والثوابت العامة سليمة (assertInvariants)
 *   • الأثر بالقرش على الحسابات المستهدفة: خزينة/إيراد/ضريبة/تكلفة/مخزون/مورد/عميل
 *   • الرفض ذري برسالة عربية (expectReject) — لا قيد ناقص ولا عكس مزدوج
 *
 * تشغيل: node --experimental-strip-types scripts/verify_journal_lifecycle.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { assertBalanced } from '../src/core/ledger.ts'
import { trialBalance, generalLedger } from '../src/core/financialReports.ts'

const R = reporter('دورة حياة القيود (إنشاء · تعديل · مرتجع · قيد حر)')
const bal = (c, code) => balanceOf(c.st().journal, code)
const PERIOD = { from: '2026-01-01', to: '2026-12-31' }
const tb = (c) => trialBalance(c.st().journal, PERIOD)
const everyEntryBalanced = (c) => { for (const e of c.st().journal) assertBalanced(e.lines) }
const balancedTb = (c) => { const t = tb(c); assert.equal(t.totalDebitMinor, t.totalCreditMinor, `الميزان غير متزن: مدين ${t.totalDebitMinor} ≠ دائن ${t.totalCreditMinor}`); return t }

const c = await freshCase({ activityId: 'general' })
const cust = addParty(c, 'customer', 'عميل دورة الحياة')
const sup = addParty(c, 'supplier', 'مورد دورة الحياة')
const item = addSimpleItem(c, { nameAr: 'بند دورة الحياة', priceMinor: 10000, extra: { stockQty: 100, costMinor: 3000 } })
const stockOf = () => c.st().items.find((i) => i.id === item.id).stockQty
assert.equal(stockOf(), 100, 'رصيد البداية كما أُدخل')

// ——— ① القيد الحر اليدوي: الإنشاء والأثر على الحسابات ———
R.section('① القيد الحر اليدوي — الإنشاء والأثر بالقرش')
{
  const pre1101 = bal(c, '1101'), pre3101 = bal(c, '3101')
  const preTb = balancedTb(c)
  const open = c.st().postManualEntry({
    date: '2026-01-15', description: 'رأس مال افتتاحي',
    lines: [
      { accountCode: '1101', debit: 1000000, credit: 0, note: 'نقدية' },
      { accountCode: '3101', debit: 0, credit: 1000000, note: 'رأس مال' },
    ],
  })
  assert.equal(open.sourceType, 'manual')
  assertBalanced(open.lines)
  assert.equal(bal(c, '1101'), pre1101 + 1000000, 'الخزينة: أثر المدين بالقرش')
  assert.equal(bal(c, '3101'), pre3101 - 1000000, 'رأس المال: أثر الدائن بالقرش')
  const t = balancedTb(c)
  assert.equal(t.totalDebitMinor - preTb.totalDebitMinor, 1000000, 'مجموع المدين بالميزان زاد بالمبلغ نفسه')
  assert.equal(t.totalCreditMinor - preTb.totalCreditMinor, 1000000, 'مجموع الدائن بالميزان زاد بالمبلغ نفسه')
  const gl = generalLedger(c.st().journal, '1101', PERIOD)
  assert.ok(gl.rows.some((r) => r.description === 'رأس مال افتتاحي'), 'صف القيد داخل كشف حساب 1101')
  assert.equal(gl.closingMinor, bal(c, '1101'), 'إقفال كشف 1101 = رصيد الدفتر')
  assertInvariants('بعد القيد الافتتاحي', c)
  everyEntryBalanced(c)
  R.ok('قيد حر افتتاحي: متوازن · أثره على 1101/3101 بالميزان وكشف الحساب بالضبط')
}

// ——— ② فاتورة شراء آجلة: مخزون + مورد ———
R.section('② فاتورة شراء — قيودها وأثرها على المخزون والمورد')
{
  const pre2101 = bal(c, '2101'), pre1103 = bal(c, '1103')
  const preSup = c.st().getSupplierBalance(sup.id)
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-02-01',
    lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 3000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  assert.equal(stockOf(), 150, 'المخزون +50 بالشراء')
  assert.equal(bal(c, '1103') - pre1103, 150000, '1103 بمبلغ الشراء')
  assert.equal(bal(c, '2101') - pre2101, -150000, '2101 دائن بمستحق المورد')
  assert.equal(c.st().getSupplierBalance(sup.id), preSup + 150000, 'كشف المورد = المديونية بالقرش')
  balancedTb(c); everyEntryBalanced(c); assertInvariants('بعد الشراء', c)
  R.ok('شراء آجل 150,000: قيد متوازن · مخزون +150,000 · 2101 وكشف المورد بالمقدار نفسه')
}

// ——— ③ فاتورة بيع نقدية بالضريبة ———
R.section('③ فاتورة بيع نقدية 14% — كل حساب في قيدها')
{
  const pre = { t1101: bal(c, '1101'), t4101: bal(c, '4101'), t2102: bal(c, '2102'), t5101: bal(c, '5101'), t1103: bal(c, '1103') }
  const preCust = c.st().getCustomerBalance(cust.id)
  const sale = c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 10000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  const { totalMinor: T, taxBaseMinor: N, taxMinor: X, cogsMinor: COGS } = sale.totals
  assert.equal(bal(c, '1101') - pre.t1101, T, 'الخزينة بالمُحصَّل')
  assert.equal(bal(c, '4101') - pre.t4101, -N, 'الإيراد دائن بالنافع')
  assert.equal(bal(c, '2102') - pre.t2102, -X, 'ض.ق.م دائنة بالضريبة')
  assert.equal(bal(c, '5101') - pre.t5101, COGS, 'تكلفة البيع مديونة')
  assert.equal(bal(c, '1103') - pre.t1103, -COGS, 'المخزون خرج بالتكلفة')
  assert.equal(stockOf(), 140, '10 قطع خرجت')
  assert.equal(c.st().getCustomerBalance(cust.id), preCust, 'بيع نقدي لا يلمس ذمة العميل')
  balancedTb(c); everyEntryBalanced(c); assertInvariants(' بعد البيع', c)
  R.ok(`بيع نقدي ${T}: خزينة/إيراد/ضريبة/تكلفة/مخزون — خمسة حسابات كلها بالقرش`)
}

// ——— ④ تعديل الفاتورة: عكس القيد القديم + قيد جديد ———
R.section('④ تعديل البيع 10 ← 5 — العكس والقيد الجديد وأثرهما')
{
  const sale = c.st().sales.at(-1)
  const oldEntryId = sale.journalEntryId
  const pre = { t1101: bal(c, '1101'), t4101: bal(c, '4101'), t2102: bal(c, '2102'), t5101: bal(c, '5101'), t1103: bal(c, '1103'), len: c.st().journal.length }
  const oldTotals = { ...sale.totals }
  const updated = c.st().editSale({
    saleId: sale.id,
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 5, unitPriceMinor: 10000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'cash', paidMinor: 50000, treasury: '1101',
    invoiceDiscountPercent: 0, reason: 'تصحيح الكمية 10 ← 5', einvoiceActive: false, allowNegativeStock: false,
  })
  assert.equal(updated.totals.totalMinor, 50000, 'الإجمالي الجديد 50000')
  const oldEntry = c.st().journal.find((e) => e.id === oldEntryId)
  const reversal = c.st().journal.find((e) => e.id === oldEntry.reversedByEntryId)
  assert.ok(reversal && reversal.reversesEntryId === oldEntryId, 'القيد العاكس مرتبط بالأصل في الاتجاهين')
  assertBalanced(reversal.lines); assertBalanced(c.st().journal.find((e) => e.id === updated.journalEntryId).lines)
  assert.equal(c.st().journal.length, pre.len + 2, 'قيدان جديدان: عكس + معدل — لا حذف')
  const N2 = updated.totals.taxBaseMinor, X2 = updated.totals.taxMinor, COGS2 = updated.totals.cogsMinor
  assert.equal(bal(c, '1101') - pre.t1101, updated.totals.totalMinor - oldTotals.totalMinor, 'الخزينة بالفرق بين القيمتين')
  assert.equal(bal(c, '4101') - pre.t4101, oldTotals.taxBaseMinor - N2, 'الإيراد يرجع بالفرق')
  assert.equal(bal(c, '2102') - pre.t2102, oldTotals.taxMinor - X2, 'الضريبة تُصحح بالفرق')
  assert.equal(bal(c, '5101') - pre.t5101, COGS2 - oldTotals.cogsMinor, 'تكلفة البيع تُصحح')
  assert.equal(bal(c, '1103') - pre.t1103, -(COGS2 - oldTotals.cogsMinor), 'المخزون يعود بالفرق')
  assert.equal(stockOf(), 145, '10 عادت و5 خرجت = 145')
  balancedTb(c); everyEntryBalanced(c); assertInvariants('بعد التعديل', c)
  R.ok('تعديل البيع: عكس + قيد جديد متوازنان · كل الحسابات تحرّكت بالفرق بالضبط · لا حذف')
}

// ——— ⑤ مرتجع البيع (إشعار دائن) ———
R.section('⑤ مرتجع بيع 1 من 5 — الضريبة تُعكس نسبياً')
{
  const sale = c.st().sales.at(-1)
  const X2 = sale.totals.taxMinor
  const pre = { t1101: bal(c, '1101'), t2102: bal(c, '2102') }
  const ret = c.st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'cash', reason: 'قطعة معيبة', reasonCode: 'defective', approvedBy: 'المشرف',
  })
  assert.equal(stockOf(), 146, 'قطعة عادت للمخزون')
  assert.equal(bal(c, '1101') - pre.t1101, -ret.totals.totalMinor, 'الخزينة نقصت بمبلغ الاسترداد نقداً')
  assert.equal(bal(c, '2102') - pre.t2102, Math.round(X2 / 5), 'ض.ق.م عكست ضريبة القطعة الواحدة بالضبط')
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assertBalanced(e.lines)
  balancedTb(c); everyEntryBalanced(c); assertInvariants('بعد مرتجع البيع', c)
  R.ok('مرتجع البيع: قيد متوازن · مخزون +1 · خزينة بمبلغ الاسترداد · الضريبة نسبية للكمية')
}

// ——— ⑥ مرتجع الشراء (إشعار مدين على المورد) ———
R.section('⑥ مرتجع شراء 5 من 50 — أثره على المورد والمخزون')
{
  const purchase = c.st().purchases.at(-1)
  const preSup = c.st().getSupplierBalance(sup.id), pre1103 = bal(c, '1103')
  const ret = c.st().postPurchaseReturn({
    purchaseId: purchase.id, qtyByItem: new Map([[item.id, 5]]),
    refund: 'debt', reason: 'كميات معيبة', approvedBy: 'المشرف',
  })
  assert.equal(stockOf(), 141, '5 خرجت بالمرتجع')
  assert.equal(c.st().getSupplierBalance(sup.id), preSup - 15000, 'كشف المورد نقص 15,000')
  assert.equal(bal(c, '1103') - pre1103, -15000, 'المخزون نزل 15,000')
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assertBalanced(e.lines)
  balancedTb(c); everyEntryBalanced(c); assertInvariants('بعد مرتجع الشراء', c)
  R.ok('مرتجع الشراء: قيد متوازن · مخزون ومورد كلاهما −15,000 بالقرش')
}

// ——— ⑦ القيد الحر على حساب عميل: الأثر على الحساب المعني وكشفه ———
R.section('⑦ قيد حر على 1104 بعميل محدد — الدفتر = الكشف')
{
  const preCust = c.st().getCustomerBalance(cust.id), pre1104 = bal(c, '1104')
  const t0 = balancedTb(c)
  const manual = c.st().postManualEntry({
    date: '2026-03-10', description: 'غرامة تأخير على العميل',
    lines: [
      { accountCode: '1104', debit: 50000, credit: 0, note: 'غرامة تأخير', partyKind: 'customer', partyId: cust.id },
      { accountCode: '4110', debit: 0, credit: 50000, note: 'إيراد غرامات' },
    ],
  })
  assert.equal(bal(c, '1104'), pre1104 + 50000, '1104 بمقدار القيد')
  assert.equal(c.st().getCustomerBalance(cust.id), preCust + 50000, 'كشف العميل تحرك مع الدفتر')
  assert.ok(c.st().getCustomerStatementRows(cust.id).some((r) => r.docLabel.includes('قيد يدوي')), 'صف القيد داخل كشف العميل')
  const t = balancedTb(c)
  assert.equal(t.totalDebitMinor - t0.totalDebitMinor, 50000, 'الميزان يستوعب القيد')
  assertInvariants('بعد قيد العميل', c)
  R.ok('قيد حر على 1104 بعميل: الدفتر والكشف والميزان ثلاثة أرقام واحدة')
}

// ——— ⑧ عكس القيد الحر: يعيد الحسابات كما كانت + الرفض الذري ———
R.section('⑧ عكس القيد الحر — وإغلاق المسارات الخاطئة')
{
  // القيد من ⑦ موجود في نهاية الدفتر
  const manual = [...c.st().journal].reverse().find((e) => e.sourceType === 'manual' && e.description === 'غرامة تأخير على العميل')
  const preCust = c.st().getCustomerBalance(cust.id), pre1104 = bal(c, '1104')
  const rev = c.st().reverseEntry(manual.id, 'إلغاء الغرامة بقرار المالك')
  assert.equal(rev.reversesEntryId, manual.id, 'العاكس يرجع للأصل')
  assert.equal(c.st().journal.find((e) => e.id === manual.id).reversedByEntryId, rev.id, 'الأصل موسوم معكوساً')
  assertBalanced(rev.lines)
  assert.equal(bal(c, '1104'), pre1104 - 50000, '1104 عاد كما كان')
  assert.equal(c.st().getCustomerBalance(cust.id), preCust - 50000, 'كشف العميل عاد كما كان')
  expectReject('عكس مرتين', c, () => c.st().reverseEntry(manual.id, 'مرة أخرى'), /معكوس/)
  const currentSaleEntry = c.st().journal.find((e) => e.id === c.st().sales.at(-1).journalEntryId)
  expectReject('عكس قيد بيع مباشرة', c, () => c.st().reverseEntry(currentSaleEntry.id, 'محاولة تجاوز'), /فاتورة بيع/)
  const currentRet = [...c.st().journal].reverse().find((e) => e.sourceType === 'sale_return')
  expectReject('عكس قيد مرتجع مباشرة', c, () => c.st().reverseEntry(currentRet.id, 'محاولة تجاوز'), /مرتجع مبيعات/)
  expectReject('قيد غير متوازن', c, () => c.st().postManualEntry({
    date: '2026-03-11', description: 'مختل',
    lines: [
      { accountCode: '1101', debit: 100, credit: 0, note: '' },
      { accountCode: '4101', debit: 0, credit: 99, note: '' },
    ],
  }), /غير متوازن/)
  balancedTb(c); everyEntryBalanced(c); assertInvariants('الختام', c)
  R.ok('عكس القيد الحر يعيد الحسابات بالضبط · عكس مزدوج وقيد بيع/مرتجع/غير متوازن كلها مرفوضة')
}

// ——— ⑨ الختام: الدفتر كله متوازن وكمياته متسقة ———
{
  const t = balancedTb(c)
  assert.ok(t.balanced)
  const gl = generalLedger(c.st().journal, '1101', PERIOD)
  assert.equal(gl.closingMinor, bal(c, '1101'), 'كشف 1101 = الدفتر بعد الدورة كلها')
  everyEntryBalanced(c)
  R.ok(`الختام: ${c.st().journal.length} قيداً — كلها متوازنة والميزان متزن وإقفال كشف 1101 يطابق الدفتر`)
}

R.done('— الإنشاء والتعديل والمرتجعات والقيد الحر: كل قيد متوازن وأثره على حساباته بالقرش')
