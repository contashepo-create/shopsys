#!/usr/bin/env node
/**
 * verify_accounting — فحص ميزان المراجعة + قائمة الدخل + السندات + القيد اليدوي + العكس
 * node --experimental-strip-types scripts/verify_accounting.mjs
 */
import { strict as assert } from 'node:assert'
import {
  computeTrialBalance, computeIncomeStatement,
  buildReceiptVoucherEntry, buildPaymentVoucherEntry, buildTransferEntry,
  validateManualEntry,
} from '../src/core/accounting.ts'
import { STANDARD_COA, buildReversalLines, assertBalanced } from '../src/core/ledger.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const sumD = (ls) => ls.reduce((a, l) => a + l.debit, 0)
const sumC = (ls) => ls.reduce((a, l) => a + l.credit, 0)

const mkEntry = (id, date, lines) => ({
  id, entryNumber: id, date, description: `قيد ${id}`, sourceType: 'manual', sourceId: null,
  lines, createdBy: 'فحص', createdAt: date, reversedByEntryId: null, reversesEntryId: null,
})

// دفتر تجريبي: رأس مال 1000، بيع كاش 300 (تكلفته 180)، مصروف إيجار 50
const journal = [
  mkEntry(1, '2026-01-01', [
    { accountCode: '1101', debit: 100000, credit: 0 },
    { accountCode: '3101', debit: 0, credit: 100000 },
  ]),
  mkEntry(2, '2026-02-10', [
    { accountCode: '1101', debit: 30000, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 30000 },
    { accountCode: '5101', debit: 18000, credit: 0 },
    { accountCode: '1103', debit: 0, credit: 18000 },
  ]),
  mkEntry(3, '2026-03-05', [
    { accountCode: '5103', debit: 5000, credit: 0 },
    { accountCode: '1101', debit: 0, credit: 5000 },
  ]),
]

console.log('🔍 ميزان المراجعة')

ok('إجمالي المدين = إجمالي الدائن دائماً (balanced=true)', () => {
  const tb = computeTrialBalance(journal, STANDARD_COA)
  assert.equal(tb.balanced, true)
  assert.equal(tb.totalDebit, tb.totalCredit)
  assert.equal(tb.totalDebit, 153000)
})

ok('أرصدة الحسابات في الجانب الصحيح', () => {
  const tb = computeTrialBalance(journal, STANDARD_COA)
  const cash = tb.rows.find((r) => r.code === '1101')
  assert.equal(cash.balanceDebit, 125000) // 100000+30000-5000
  assert.equal(cash.balanceCredit, 0)
  const capital = tb.rows.find((r) => r.code === '3101')
  assert.equal(capital.balanceCredit, 100000)
  const inv = tb.rows.find((r) => r.code === '1103')
  assert.equal(inv.balanceCredit, 18000) // مخزون سالب هنا لأن لا شراء في المثال
})

ok('مجموع أرصدة المدين = مجموع أرصدة الدائن', () => {
  const tb = computeTrialBalance(journal, STANDARD_COA)
  assert.equal(tb.balanceDebitTotal, tb.balanceCreditTotal)
})

ok('الحسابات غير المتحركة لا تظهر', () => {
  const tb = computeTrialBalance(journal, STANDARD_COA)
  assert.ok(!tb.rows.some((r) => r.code === '2102'))
})

console.log('🔍 قائمة الدخل')

ok('الإيرادات والمصروفات وصافي الربح', () => {
  const is = computeIncomeStatement(journal, STANDARD_COA)
  assert.equal(is.totalRevenue, 30000)
  assert.equal(is.totalExpenses, 23000) // 18000 تكلفة + 5000 إيجار
  assert.equal(is.netIncome, 7000)
})

ok('التصفية بفترة تواريخ (فبراير فقط)', () => {
  const is = computeIncomeStatement(journal, STANDARD_COA, '2026-02-01', '2026-02-28')
  assert.equal(is.totalRevenue, 30000)
  assert.equal(is.totalExpenses, 18000)
  assert.equal(is.netIncome, 12000)
})

ok('رأس المال لا يدخل قائمة الدخل', () => {
  const is = computeIncomeStatement(journal, STANDARD_COA)
  assert.ok(!is.revenueRows.some((r) => r.code === '3101'))
})

console.log('🔍 السندات')

ok('سند قبض: خزينة مدين / عميل دائن — متوازن', () => {
  const e = buildReceiptVoucherEntry('1101', '1104', 25000, 'سداد دين')
  assert.equal(sumD(e), sumC(e))
  assert.ok(e.some((l) => l.accountCode === '1101' && l.debit === 25000))
  assert.ok(e.some((l) => l.accountCode === '1104' && l.credit === 25000))
})

ok('سند صرف: مورد مدين / خزينة دائن', () => {
  const e = buildPaymentVoucherEntry('1101', '2101', 40000, 'سداد للمورد')
  assert.ok(e.some((l) => l.accountCode === '2101' && l.debit === 40000))
  assert.ok(e.some((l) => l.accountCode === '1101' && l.credit === 40000))
})

ok('تحويل خزينة→بنك (إيداع)', () => {
  const e = buildTransferEntry('1101', '1102', 60000, 'إيداع بنكي')
  assert.ok(e.some((l) => l.accountCode === '1102' && l.debit === 60000))
  assert.ok(e.some((l) => l.accountCode === '1101' && l.credit === 60000))
})

ok('رفض مبلغ صفري/سالب ونفس الخزينة', () => {
  assert.throws(() => buildReceiptVoucherEntry('1101', '1104', 0, ''), /موجب/)
  assert.throws(() => buildPaymentVoucherEntry('1101', '1101', 100, ''), /نفس/)
  assert.throws(() => buildTransferEntry('1101', '1101', 100, ''), /مختلفتين/)
})

console.log('🔍 القيد اليدوي')

ok('قيد سليم: لا أخطاء', () => {
  const errs = validateManualEntry([
    { accountCode: '5104', debit: 3000, credit: 0 },
    { accountCode: '1101', debit: 0, credit: 3000 },
  ], STANDARD_COA)
  assert.equal(errs.length, 0)
})

ok('رفض غير المتوازن والحساب التجميعي والمجهول', () => {
  assert.ok(validateManualEntry([
    { accountCode: '5104', debit: 3000, credit: 0 },
    { accountCode: '1101', debit: 0, credit: 2000 },
  ], STANDARD_COA).some((e) => e.includes('غير متوازن')))
  assert.ok(validateManualEntry([
    { accountCode: '11', debit: 100, credit: 0 }, // تجميعي
    { accountCode: '1101', debit: 0, credit: 100 },
  ], STANDARD_COA).some((e) => e.includes('تجميعي')))
  assert.ok(validateManualEntry([
    { accountCode: '9999', debit: 100, credit: 0 },
    { accountCode: '1101', debit: 0, credit: 100 },
  ], STANDARD_COA).some((e) => e.includes('غير معروف')))
})

ok('رفض طرف واحد وسطر مزدوج', () => {
  assert.ok(validateManualEntry([{ accountCode: '1101', debit: 100, credit: 0 }], STANDARD_COA).some((e) => e.includes('طرفين')))
  assert.ok(validateManualEntry([
    { accountCode: '1101', debit: 100, credit: 50 },
    { accountCode: '5104', debit: 0, credit: 50 },
  ], STANDARD_COA).some((e) => e.includes('معاً')))
})

console.log('🔍 عكس القيود')

ok('القيد العاكس يقلب الأطراف ويبقى متوازناً', () => {
  const original = journal[1].lines
  const rev = buildReversalLines(original)
  assertBalanced(rev)
  assert.equal(rev.find((l) => l.accountCode === '1101').credit, 30000) // انقلب
  assert.equal(rev.find((l) => l.accountCode === '4101').debit, 30000)
})

ok('دفتر + عكوسه = ميزان صفري للحساب المعكوس', () => {
  const rev = mkEntry(4, '2026-03-06', buildReversalLines(journal[2].lines))
  const tb = computeTrialBalance([...journal, rev], STANDARD_COA)
  const rent = tb.rows.find((r) => r.code === '5103')
  assert.equal(rent.balanceDebit, 0)
  assert.equal(rent.balanceCredit, 0)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
