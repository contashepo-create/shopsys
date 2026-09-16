/**
 * تحقق القوائم المالية العالمية (core/financialReports.ts):
 * ميزان مراجعة متوازن، قائمة دخل صحيحة، مركز مالي يوازن (أصول = التزامات+حقوق+أرباح)،
 * دفتر أستاذ برصيد جارٍ، تدفق نقدي يطابق حركة الخزائن، تقرير ضريبة مخرجات/مدخلات.
 * تشغيل: node --experimental-strip-types scripts/verify_financial_reports.mjs
 */
import {
  trialBalance, incomeStatement, balanceSheet, generalLedger, cashFlowReport, vatReport, toCsv,
} from '../src/core/financialReports.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

// دفتر يومية مصغّر (كل الأرقام Minor):
// 1) 2026-01-05 بيع نقدي 1000+150 ضريبة → خزينة 1150 / مبيعات 1000 + ض 150، وتكلفة 600
// 2) 2026-01-10 شراء آجل 800+120 ضريبة → مخزون 800 + ض 120 / موردون 920
// 3) 2026-01-15 مصروف إيجار نقدي 200
// 4) 2026-02-01 بيع آجل 500 (بلا ضريبة) وتكلفة 300 — خارج فترة يناير
const J = [
  { id: 1, entryNumber: 1, date: '2026-01-05', description: 'فاتورة بيع نقدي', lines: [
    { accountCode: '1101', debit: 1150, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 1000 },
    { accountCode: '2102', debit: 0, credit: 150 },
    { accountCode: '5101', debit: 600, credit: 0 },
    { accountCode: '1103', debit: 0, credit: 600 },
  ] },
  { id: 2, entryNumber: 2, date: '2026-01-10', description: 'فاتورة شراء آجل', lines: [
    { accountCode: '1103', debit: 800, credit: 0 },
    { accountCode: '2102', debit: 120, credit: 0 },
    { accountCode: '2101', debit: 0, credit: 920 },
  ] },
  { id: 3, entryNumber: 3, date: '2026-01-15', description: 'إيجار المحل', lines: [
    { accountCode: '5102', debit: 200, credit: 0 },
    { accountCode: '1101', debit: 0, credit: 200 },
  ] },
  { id: 4, entryNumber: 4, date: '2026-02-01', description: 'بيع آجل', lines: [
    { accountCode: '1104', debit: 500, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 500 },
    { accountCode: '5101', debit: 300, credit: 0 },
    { accountCode: '1103', debit: 0, credit: 300 },
  ] },
]
const JAN = { from: '2026-01-01', to: '2026-01-31' }
const ALL = { from: '2026-01-01', to: '2026-12-31' }

console.log('— ميزان المراجعة —')
const tb = trialBalance(J, JAN)
ok(tb.balanced, 'يناير متوازن (مدين = دائن)')
ok(tb.totalDebitMinor === 1150 + 600 + 800 + 120 + 200, `إجمالي المدين ${tb.totalDebitMinor} = 2870`)
const tb1103 = tb.rows.find((r) => r.code === '1103')
ok(tb1103 && tb1103.debitMinor === 800 && tb1103.creditMinor === 600, 'المخزون: مدين 800 / دائن 600')
ok(!tb.rows.some((r) => r.code === '1104'), 'قيد فبراير خارج فترة يناير')

console.log('— قائمة الدخل —')
const inc = incomeStatement(J, JAN)
ok(inc.totalRevenueMinor === 1000, `إيرادات يناير ${inc.totalRevenueMinor} = 1000`)
ok(inc.totalExpenseMinor === 800, `مصروفات يناير (تكلفة 600 + إيجار 200) = ${inc.totalExpenseMinor}`)
ok(inc.netProfitMinor === 200, `صافي ربح يناير ${inc.netProfitMinor} = 200`)
const incAll = incomeStatement(J, ALL)
ok(incAll.netProfitMinor === 200 + 200, `صافي ربح السنة ${incAll.netProfitMinor} = 400 (بيع فبراير +200)`)

console.log('— المركز المالي —')
const bs = balanceSheet(J, '2026-01-31')
ok(bs.balanced, 'الميزانية تتوازن: أصول = التزامات + حقوق + أرباح مرحلة')
ok(bs.retainedEarningsMinor === 200, `الأرباح المرحلة ${bs.retainedEarningsMinor} = 200`)
const cash = bs.assets.find((r) => r.code === '1101')
ok(cash && cash.amountMinor === 950, `الخزينة ${cash?.amountMinor} = 950 (1150−200)`)
const bsAll = balanceSheet(J, '2026-12-31')
ok(bsAll.balanced && bsAll.retainedEarningsMinor === 400, 'ميزانية نهاية السنة متوازنة وأرباح 400')

console.log('— دفتر الأستاذ العام —')
const gl = generalLedger(J, '1101', ALL)
ok(gl.openingMinor === 0 && gl.rows.length === 2, 'حركتان على الخزينة')
ok(gl.rows[0].balanceMinor === 1150 && gl.rows[1].balanceMinor === 950, `رصيد جارٍ 1150 ثم 950`)
ok(gl.closingMinor === 950, 'رصيد الإقفال 950')
const glFeb = generalLedger(J, '1103', { from: '2026-02-01', to: '2026-02-28' })
ok(glFeb.openingMinor === 200, `مخزون أول فبراير ${glFeb.openingMinor} = 200 (رصيد سابق مُرحّل)`)
ok(glFeb.closingMinor === -100, `مخزون آخر فبراير ${glFeb.closingMinor} = −100 (صرف 300)`)

console.log('— التدفق النقدي —')
const cf = cashFlowReport(J, ['1101'], JAN)
ok(cf.totalInMinor === 1150 && cf.totalOutMinor === 200, `داخل 1150 / خارج 200`)
ok(cf.closingCashMinor === 950, `نقدية آخر يناير ${cf.closingCashMinor} = 950 (تطابق الميزانية)`)
const cfFeb = cashFlowReport(J, ['1101'], { from: '2026-02-01', to: '2026-02-28' })
ok(cfFeb.openingCashMinor === 950 && cfFeb.netChangeMinor === 0, 'أول فبراير 950 بلا حركة (البيع آجل)')

console.log('— تقرير الضريبة —')
const vat = vatReport(J, JAN)
ok(vat.outputVatMinor === 150 && vat.inputVatMinor === 120, 'مخرجات 150 / مدخلات 120')
ok(vat.netDueMinor === 30, `صافي مستحق للمصلحة ${vat.netDueMinor} = 30`)

console.log('— تصدير CSV —')
const csv = toCsv(['اسم', 'قيمة'], [['بند "خاص", فاصلة', 100]])
ok(csv.startsWith('\uFEFF'), 'BOM موجود ليفتح Excel عربي سليم')
ok(csv.includes('"بند ""خاص"", فاصلة"'), 'تهريب الفواصل وعلامات الاقتباس')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
