/**
 * فحص محرك ملفات العهد المتكامل (طلب المالك — نمط pro-acc)
 * تشغيل: node --experimental-strip-types scripts/verify_custody.mjs
 */
import {
  CUSTODY_ACCOUNT, CUSTODY_EXCESS_ACCOUNT, CUSTODY_SHORTAGE_ACCOUNT,
  custodyFileNumber, validateCustodyFile, summarizeCustody,
  buildCustodyFundEntry, splitCustodyExpense, buildCustodyExpenseEntry,
  buildCustodySettleEntry, assertFileOpen, paySourceAccount, CUSTODY_TX_LABELS,
} from '../src/core/custody.ts'
import { buildPayrollEntry } from '../src/core/payroll.ts'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ خطأ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}`) }
}
const balanced = (lines) => {
  const d = lines.reduce((s, l) => s + l.debit, 0)
  const c = lines.reduce((s, l) => s + l.credit, 0)
  return d === c && d > 0
}
const tx = (fileId, type, amountMinor, excessMinor = 0) => ({
  id: 0, fileId, type, date: '2026-09-15', amountMinor, excessMinor,
  description: '', treasury: null, projectId: null, purchaseId: null, journalEntryId: 0,
})

console.log('📁 فتح الملف وترقيمه')
ok('رقم الملف عهدة-YYYY-NNNN', custodyFileNumber(7, '2026-09-15') === 'عهدة-2026-0007')
ok('فتح سليم بلا أخطاء', validateCustodyFile({ employeeId: 1, reason: 'عهدة موقع' }).length === 0)
ok('بلا موظف يُرفض', validateCustodyFile({ employeeId: 0, reason: 'x' }).length > 0)
ok('بلا سبب يُرفض', validateCustodyFile({ employeeId: 1, reason: '  ' }).length > 0)
ok('تسميات عربية لكل نوع حركة', ['fund', 'expense', 'invoice', 'return', 'shortage'].every((t) => CUSTODY_TX_LABELS[t]?.nameAr))

console.log('💰 التمويل والتعزيزات')
{
  const lines = buildCustodyFundEntry(100000, '1101', 'عهدة-2026-0001')
  ok('قيد التمويل متوازن', balanced(lines))
  ok('مدين 1108 عهد الموظفين', lines.some((l) => l.accountCode === CUSTODY_ACCOUNT && l.debit === 100000))
  ok('دائن الخزينة المختارة', lines.some((l) => l.accountCode === '1101' && l.credit === 100000))
  const bank = buildCustodyFundEntry(50000, '1102', 'x')
  ok('التعزيز من بنك 1102 يُحترم', bank.some((l) => l.accountCode === '1102' && l.credit === 50000))
}
throws('تمويل بصفر يُرفض', () => buildCustodyFundEntry(0, '1101', 'x'))
throws('تمويل بكسر يُرفض', () => buildCustodyFundEntry(100.5, '1101', 'x'))

console.log('🧮 ملخص الملف: تعزيزات مقابل منصرفات')
{
  const txs = [tx(1, 'fund', 100000), tx(1, 'fund', 50000), tx(1, 'expense', 30000), tx(1, 'invoice', 45000)]
  const s = summarizeCustody(txs)
  ok('الممول = مجموع التعزيزات', s.fundedMinor === 150000)
  ok('المنصرف = مصاريف + فواتير', s.spentMinor === 75000)
  ok('المتبقي = الممول − المنصرف', s.remainingMinor === 75000)
  // مصروف بزيادة: الزيادة لا تنقص العهدة (تُحمَّل على 2107)
  const s2 = summarizeCustody([tx(1, 'fund', 100000), tx(1, 'expense', 120000, 20000)])
  ok('الزيادة لا تُخصم من العهدة', s2.remainingMinor === 0 && s2.excessMinor === 20000)
}

console.log('🧾 المصروف من العهدة والزيادة عنها')
{
  const within = splitCustodyExpense(50000, 30000, false)
  ok('مصروف ضمن الرصيد: كله من العهدة', within.fromCustodyMinor === 30000 && within.excessMinor === 0)
  const over = splitCustodyExpense(50000, 80000, true)
  ok('مصروف بزيادة مسموحة: يقسم صح', over.fromCustodyMinor === 50000 && over.excessMinor === 30000)
  throws('زيادة بلا سماح تُرفض', () => splitCustodyExpense(50000, 80000, false), 'سماح')
  const lines = buildCustodyExpenseEntry('5110', 50000, 30000, 'مواد موقع')
  ok('قيد المصروف بزيادة متوازن', balanced(lines))
  ok('مدين المصروف بكامل المبلغ', lines.some((l) => l.accountCode === '5110' && l.debit === 80000))
  ok('دائن 1108 بجزء العهدة', lines.some((l) => l.accountCode === CUSTODY_ACCOUNT && l.credit === 50000))
  ok('دائن 2107 بالزيادة (مستحق للموظف)', lines.some((l) => l.accountCode === CUSTODY_EXCESS_ACCOUNT && l.credit === 30000))
}

console.log('⚖️ التسوية: مرتجع + عجز')
{
  const lines = buildCustodySettleEntry(40000, 25000, '1101', 'عهدة-2026-0001')
  ok('قيد التسوية متوازن', balanced(lines))
  ok('المرتجع 25000 للخزينة', lines.some((l) => l.accountCode === '1101' && l.debit === 25000))
  ok('العجز 15000 سلفة على 1107', lines.some((l) => l.accountCode === CUSTODY_SHORTAGE_ACCOUNT && l.debit === 15000))
  ok('دائن 1108 بكامل المتبقي', lines.some((l) => l.accountCode === CUSTODY_ACCOUNT && l.credit === 40000))
  const fullReturn = buildCustodySettleEntry(40000, 40000, '1102', 'x')
  ok('مرتجع كامل: لا سطر عجز', !fullReturn.some((l) => l.accountCode === CUSTODY_SHORTAGE_ACCOUNT))
  ok('متبقٍ صفر: إغلاق إداري بلا قيد', buildCustodySettleEntry(0, 0, '1101', 'x') === null)
}
throws('مرتجع أكبر من المتبقي يُرفض', () => buildCustodySettleEntry(40000, 50000, '1101', 'x'), 'أكبر')
throws('مرتجع سالب يُرفض', () => buildCustodySettleEntry(40000, -1, '1101', 'x'))

console.log('🔒 الملف المغلق محظور نهائياً (طلب المالك)')
{
  assertFileOpen({ status: 'open', fileNumber: 'عهدة-2026-0001' }) // لا يرمي
  ok('الملف المفتوح يمر', true)
  throws('أي حركة على ملف مُسوَّى تُرفض', () => assertFileOpen({ status: 'settled', fileNumber: 'عهدة-2026-0001' }), 'مغلق')
}

console.log('💳 مصدر الدفع الموحّد')
ok('خزينة → كودها', paySourceAccount({ kind: 'treasury', code: '1102' }) === '1102')
ok('عهدة → 1108', paySourceAccount({ kind: 'custody', fileId: 3 }) === CUSTODY_ACCOUNT)

console.log('👷 الراتب: خصم سلفة + صرف مستحق عهدة + دفع من عهدة')
{
  // صافي 90000، خصم سلفة 10000، صرف مستحق زيادة 5000 — نقداً من الخزينة
  const lines = buildPayrollEntry(90000, 'cash', '1101', 'مسير 2026-09', 10000, 5000)
  ok('قيد الراتب متوازن', balanced(lines))
  ok('مدين 5102 رواتب = صافي + سلفة مستردة', lines.some((l) => l.accountCode === '5102' && l.debit === 100000))
  ok('دائن الخزينة = صافي + مستحق العهدة', lines.some((l) => l.accountCode === '1101' && l.credit === 95000))
  ok('مدين 2107 بمستحق العهدة المصروف', lines.some((l) => l.accountCode === CUSTODY_EXCESS_ACCOUNT && l.debit === 5000))
  ok('دائن 1107 بالسلفة المستردة', lines.some((l) => l.accountCode === CUSTODY_SHORTAGE_ACCOUNT && l.credit === 10000))
  // الدفع من عهدة موظف: الحساب الدائن 1108 بدل الخزينة
  const fromCustody = buildPayrollEntry(90000, 'cash', CUSTODY_ACCOUNT, 'مسير من عهدة', 0, 0)
  ok('راتب من عهدة: دائن 1108', fromCustody.some((l) => l.accountCode === CUSTODY_ACCOUNT && l.credit === 90000))
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 نجح فحص ملفات العهد المتكاملة')
