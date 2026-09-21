/**
 * فحص الخزائن المتعددة + الدفع المجزأ (طلب المالك)
 * node --experimental-strip-types scripts/verify_treasuries.mjs
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_TREASURIES, nextTreasuryCode, validateTreasury, treasuryAccounts, fullCoa, treasuryLabel,
} from '../src/core/treasury.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { computeTotals, buildSaleEntry } from '../src/core/pos.ts'
import { buildPurchaseEntry } from '../src/core/purchases.ts'
import { buildReceiptVoucherEntry, buildPaymentVoucherEntry, buildTransferEntry } from '../src/core/accounting.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const balanced = (lines) => sum(lines, 'debit') === sum(lines, 'credit')

/* ─── تعريفات الخزائن ─── */
ok(DEFAULT_TREASURIES.length === 2, 'افتراضيان: خزينة رئيسية + بنك')
ok(DEFAULT_TREASURIES[0].code === '1101' && DEFAULT_TREASURIES[0].isDefault === true, '1101 هي الرئيسية')
ok(nextTreasuryCode(DEFAULT_TREASURIES) === '1121', 'أول كود مخصص 1121')
const withCustom = [...DEFAULT_TREASURIES, { code: '1121', nameAr: 'فرع 2', kind: 'cash' }]
ok(nextTreasuryCode(withCustom) === '1122', 'الكود يتزايد 1122')
ok(validateTreasury('خزينة الفرع', DEFAULT_TREASURIES).length === 0, 'اسم سليم يمر')
ok(validateTreasury('x', DEFAULT_TREASURIES).length > 0, 'اسم قصير يُرفض')
ok(validateTreasury('الخزينة الرئيسية', DEFAULT_TREASURIES).length > 0, 'اسم مكرر يُرفض')
ok(validateTreasury('الخزينة الرئيسية', DEFAULT_TREASURIES, '1101').length === 0, 'نفس الاسم لنفس الكود (تعديل) يمر')

/* ─── دمج الشجرة ─── */
ok(treasuryAccounts(DEFAULT_TREASURIES).length === 0, 'القياسيتان لا تُكرران بالشجرة')
const merged = fullCoa(STANDARD_COA, withCustom)
ok(merged.length === STANDARD_COA.length + 1, 'الشجرة الكاملة تضم المخصصة')
const idx1102 = merged.findIndex((a) => a.code === '1102')
ok(merged[idx1102 + 1].code === '1121', 'المخصصة تُدرج بعد البنوك مباشرة')
ok(merged[idx1102 + 1].parentCode === '11' && merged[idx1102 + 1].isPostable === true, 'حساب ورقي تحت الأصول المتداولة')
ok(treasuryLabel(withCustom[2]).includes('💰'), 'وسم الخزينة النقدية')

/* ─── الدفع المجزأ في البيع ─── */
const cart = [{ itemId: 1, nameAr: 'صنف', qty: 2, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0 }]
const t = computeTotals(cart, 0, 0, false) // إجمالي 10000
// كاش كامل
const full = buildSaleEntry(t, 'cash', '1101')
ok(balanced(full), 'كاش كامل متوازن')
ok(full.find((l) => l.accountCode === '1101')?.debit === 10000, 'كاش كامل: الخزينة بالإجمالي')
ok(!full.some((l) => l.accountCode === '1104'), 'كاش كامل: لا ذمم')
// مجزأ: 6000 نقدي والباقي آجل
const split = buildSaleEntry(t, 'cash', '1102', 6000)
ok(balanced(split), 'مجزأ متوازن')
ok(split.find((l) => l.accountCode === '1102')?.debit === 6000, 'مجزأ: البنك المختار بالمدفوع')
ok(split.find((l) => l.accountCode === '1104')?.debit === 4000, 'مجزأ: الذمم بالباقي')
// آجل كامل
const credit = buildSaleEntry(t, 'credit', '1101', 0)
ok(balanced(credit), 'آجل كامل متوازن')
ok(credit.find((l) => l.accountCode === '1104')?.debit === 10000, 'آجل كامل: الذمم بالإجمالي')
ok(!credit.some((l) => l.accountCode === '1101'), 'آجل كامل: لا خزينة')
// خزينة مخصصة
const custom = buildSaleEntry(t, 'cash', '1121')
ok(custom.find((l) => l.accountCode === '1121')?.debit === 10000, 'الخزينة المخصصة تستلم النقدية')
// حدود
assert.throws(() => buildSaleEntry(t, 'cash', '1101', 10001), /أكبر/)
pass++
assert.throws(() => buildSaleEntry(t, 'cash', '1101', -1), /سالب/)
pass++

/* ─── الشراء من خزينة مختارة ─── */
const p = buildPurchaseEntry(100000, 40000, '1121')
ok(balanced(p), 'شراء من خزينة مخصصة متوازن')
ok(p.find((l) => l.accountCode === '1121')?.credit === 40000, 'المدفوع يخرج من الخزينة المختارة')
ok(p.find((l) => l.accountCode === '2101')?.credit === 60000, 'الباقي دين للمورد')
const pDefault = buildPurchaseEntry(50000, 50000)
ok(pDefault.find((l) => l.accountCode === '1101')?.credit === 50000, 'الافتراضي 1101 بلا تمرير')

/* ─── السندات والتحويل بخزائن مخصصة ─── */
ok(balanced(buildReceiptVoucherEntry('1121', '1104', 5000, 'سداد')), 'قبض إلى خزينة مخصصة')
ok(balanced(buildPaymentVoucherEntry('1122', '5103', 3000, 'إيجار')), 'صرف من بنك مخصص')
const tr = buildTransferEntry('1101', '1121', 2000, 'تغذية فرع')
ok(balanced(tr) && tr.find((l) => l.accountCode === '1121')?.debit === 2000, 'تحويل بين أي خزينتين')
assert.throws(() => buildTransferEntry('1121', '1121', 100, 'x'), /مختلفتين/)
pass++

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص الخزائن المتعددة والدفع المجزأ — ${pass} اختباراً`)
