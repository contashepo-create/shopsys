#!/usr/bin/env node
/**
 * verify_money_ledger — فحص محرك النقود ومحرك القيود
 * القاعدة الملزمة 1: كل وحدة تُنجز يُكتب لها سكربت فحص فوراً.
 * يشغَّل بـ: node --experimental-strip-types scripts/verify_money_ledger.mjs
 */
import { strict as assert } from 'node:assert'
import { toMinor, formatMinor, addMinor, mulQty, percentOf, splitInclusiveTax, addExclusiveTax } from '../src/core/money.ts'
import { assertBalanced, buildReversalLines, accountBalance, UnbalancedEntryError, STANDARD_COA } from '../src/core/ledger.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 فحص محرك النقود (money.ts)')

ok('تحويل 2 خانات: 12.34 → 1234', () => assert.equal(toMinor('12.34', 2), 1234))
ok('تحويل 3 خانات (دينار): 1.234 → 1234', () => assert.equal(toMinor('1.234', 3), 1234))
ok('تحويل 0 خانات (دينار عراقي): 1500 → 1500', () => assert.equal(toMinor('1500', 0), 1500))
ok('قص الكسور الزائدة لا تقريبها: 1.2399 بخانتين → 123', () => assert.equal(toMinor('1.2399', 2), 123))
ok('مصيدة التعويم الكلاسيكية: 0.1+0.2', () => assert.equal(addMinor(toMinor('0.1', 2), toMinor('0.2', 2)), 30))
ok('سالب: -5.50 → -550', () => assert.equal(toMinor('-5.50', 2), -550))
ok('عرض EGP: 1234 → 12.34', () => assert.equal(formatMinor(1234, { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' }, false), '12.34'))
ok('عرض KWD ثلاث خانات مع تجميع', () => assert.equal(formatMinor(1234567, { code: 'KWD', symbol: 'د.ك', decimals: 3, name: '' }, false), '1,234.567'))
ok('وزن 0.750 كجم × 180.00 = 135.00', () => assert.equal(mulQty(18000, 0.75), 13500))
ok('خصم 10% من 264.00', () => assert.equal(percentOf(26400, 10), 2640))
ok('فصل ضريبة 14% شامل: الأساس+الضريبة=الإجمالي تماماً', () => {
  const [base, tax] = splitInclusiveTax(11400, 14)
  assert.equal(base + tax, 11400)
  assert.equal(base, 10000)
  assert.equal(tax, 1400)
})
ok('ضريبة مضافة 15%: 100.00 → 15.00 و115.00', () => {
  const [tax, total] = addExclusiveTax(10000, 15)
  assert.equal(tax, 1500); assert.equal(total, 11500)
})
ok('فصل شامل لا يفقد قرشاً في المبالغ العسرة', () => {
  for (const gross of [1, 7, 99, 101, 12345, 999999]) {
    for (const pct of [5, 10, 14, 15, 16, 19, 20]) {
      const [base, tax] = splitInclusiveTax(gross, pct)
      assert.equal(base + tax, gross, `فقدان قرش عند ${gross}/${pct}%`)
    }
  }
})
ok('رفض المبالغ العائمة في addMinor', () => assert.throws(() => addMinor(1.5, 2)))

console.log('🔍 فحص محرك القيود (ledger.ts)')

const saleEntry = [
  { accountCode: '1101', debit: 26400, credit: 0 },
  { accountCode: '5101', debit: 19850, credit: 0 },
  { accountCode: '4101', debit: 0, credit: 26400 },
  { accountCode: '1103', debit: 0, credit: 19850 },
]
ok('قيد بيع متوازن يُقبل', () => assertBalanced(saleEntry))
ok('قيد غير متوازن يُرفض بنيوياً', () => {
  assert.throws(() => assertBalanced([
    { accountCode: '1101', debit: 100, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 99 },
  ]), UnbalancedEntryError)
})
ok('قيد صفري مرفوض', () => assert.throws(() => assertBalanced([
  { accountCode: '1101', debit: 0, credit: 0 },
  { accountCode: '4101', debit: 0, credit: 0 },
])))
ok('سطر مدين ودائن معاً مرفوض', () => assert.throws(() => assertBalanced([
  { accountCode: '1101', debit: 100, credit: 100 },
  { accountCode: '4101', debit: 100, credit: 100 },
])))
ok('المبالغ السالبة مرفوضة', () => assert.throws(() => assertBalanced([
  { accountCode: '1101', debit: -100, credit: 0 },
  { accountCode: '4101', debit: 0, credit: -100 },
])))
ok('القيد العاكس متوازن ويعكس الطرفين', () => {
  const rev = buildReversalLines(saleEntry)
  assertBalanced(rev)
  assert.equal(rev[0].credit, 26400)
  assert.equal(rev[0].debit, 0)
})
ok('طبيعة الأرصدة: أصول مدينة وإيرادات دائنة', () => {
  assert.equal(accountBalance('assets', 500, 200), 300)
  assert.equal(accountBalance('revenue', 200, 500), 300)
})
ok('شجرة الحسابات: الجذور الخمسة موجودة', () => {
  for (const code of ['1', '2', '3', '4', '5']) assert.ok(STANDARD_COA.find((a) => a.code === code))
})
ok('شجرة الحسابات: كل ورقة لها أب موجود', () => {
  for (const a of STANDARD_COA) {
    if (a.parentCode) assert.ok(STANDARD_COA.find((p) => p.code === a.parentCode), `أب مفقود لـ ${a.code}`)
  }
})
ok('مفاتيح النظام الحرجة معرفة', () => {
  for (const k of ['main_cash', 'inventory', 'customers', 'suppliers', 'sales', 'cogs', 'vat_payable', 'rental_revenue', 'logistics_revenue']) {
    assert.ok(STANDARD_COA.find((a) => a.systemKey === k), `مفتاح مفقود: ${k}`)
  }
})
ok('المعادلة المحاسبية تصمد على سيناريو كامل', () => {
  // رأس مال → شراء بضاعة → بيع → مصروف
  const entries = [
    [ // إثبات رأس مال 100,000
      { accountCode: '1101', debit: 10000000, credit: 0 },
      { accountCode: '3101', debit: 0, credit: 10000000 },
    ],
    [ // شراء بضاعة 40,000 نقداً
      { accountCode: '1103', debit: 4000000, credit: 0 },
      { accountCode: '1101', debit: 0, credit: 4000000 },
    ],
    [ // بيع 15,000 تكلفتها 10,000
      { accountCode: '1101', debit: 1500000, credit: 0 },
      { accountCode: '5101', debit: 1000000, credit: 0 },
      { accountCode: '4101', debit: 0, credit: 1500000 },
      { accountCode: '1103', debit: 0, credit: 1000000 },
    ],
    [ // إيجار 3,000
      { accountCode: '5103', debit: 300000, credit: 0 },
      { accountCode: '1101', debit: 0, credit: 300000 },
    ],
  ]
  const totals = new Map()
  for (const lines of entries) {
    assertBalanced(lines)
    for (const l of lines) {
      const t = totals.get(l.accountCode) ?? { d: 0, c: 0 }
      t.d += l.debit; t.c += l.credit
      totals.set(l.accountCode, t)
    }
  }
  const bal = (code, root) => {
    const t = totals.get(code) ?? { d: 0, c: 0 }
    return accountBalance(root, t.d, t.c)
  }
  const assets = bal('1101', 'assets') + bal('1103', 'assets')
  const equity = bal('3101', 'equity')
  const profit = bal('4101', 'revenue') - bal('5101', 'expenses') - bal('5103', 'expenses')
  // الأصول - الخصوم = رأس المال + صافي الربح
  assert.equal(assets, equity + profit)
  assert.equal(profit, 200000) // ربح 2,000.00
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
