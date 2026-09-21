/**
 * فحص كشوف الحساب + سلف الموظفين (طلب المالك)
 * node --experimental-strip-types scripts/verify_statements.mjs
 */
import { customerStatement, supplierStatement, employeeStatement, statementBalance } from '../src/core/statements.ts'
import { buildPayrollEntry } from '../src/core/payroll.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)

/* ─── كشف عميل ─── */
const sales = [
  { id: 1, invoiceNumber: 'S-0001', date: '2026-01-01T10:00', customerId: 7, payment: 'credit', paidMinor: 0, totals: { totalMinor: 100000 } },
  { id: 2, invoiceNumber: 'S-0002', date: '2026-01-05T10:00', customerId: 7, payment: 'cash', totals: { totalMinor: 50000 } }, // كاش لا يدخل
  { id: 3, invoiceNumber: 'S-0003', date: '2026-01-08T10:00', customerId: 7, payment: 'credit', paidMinor: 30000, totals: { totalMinor: 80000 } }, // مجزأ: 50000 آجل
  { id: 4, invoiceNumber: 'S-0004', date: '2026-01-09T10:00', customerId: 9, payment: 'credit', paidMinor: 0, totals: { totalMinor: 999 } }, // عميل آخر
]
const saleReturns = [
  { returnNumber: 'R-0001', date: '2026-01-10T10:00', saleId: 1, refund: 'credit', totals: { totalMinor: 20000 } },
  { returnNumber: 'R-0002', date: '2026-01-11T10:00', saleId: 2, refund: 'cash', totals: { totalMinor: 5000 } }, // نقدي لا يدخل
]
const vouchers = [
  { voucherNumber: 'RV-0001', kind: 'receipt', date: '2026-01-15T10:00', partyKind: 'customer', partyId: 7, amountMinor: 40000 },
  { voucherNumber: 'RV-0002', kind: 'receipt', date: '2026-01-16T10:00', partyKind: 'customer', partyId: 9, amountMinor: 999 },
]
const cheques = [
  { chequeNumber: '123', direction: 'incoming', partyId: 7, amountMinor: 30000, status: 'bounced', createdAt: '2026-01-18T10:00', settledAt: '2026-01-25T10:00' },
]
const cs = customerStatement({ customerId: 7, sales, saleReturns, allSales: sales, vouchers, cheques })
ok(cs.length === 6, `كشف العميل 6 صفوف (فعلياً ${cs.length})`)
// 100000 + 50000 − 20000 − 40000 − 30000 + 30000 (ارتداد) = 90000
ok(statementBalance(cs) === 90000, `رصيد العميل 90000 (فعلياً ${statementBalance(cs)})`)
ok(cs[0].docLabel.includes('S-0001'), 'مرتب زمنياً — الفاتورة الأولى أولاً')
ok(cs.some((r) => r.docLabel.includes('مجزأ') || r.docLabel.includes('S-0003')), 'الفاتورة المجزأة موجودة بالجزء الآجل')
const splitRow = cs.find((r) => r.docLabel.includes('S-0003'))
ok(splitRow?.debitMinor === 50000, 'الجزء الآجل فقط (50000) لا كامل الفاتورة')
ok(!cs.some((r) => r.docLabel.includes('S-0002')), 'فاتورة الكاش لا تدخل الكشف')
ok(!cs.some((r) => r.docLabel.includes('S-0004')), 'فواتير عميل آخر لا تدخل')
ok(cs.some((r) => r.docLabel.includes('ارتداد')), 'ارتداد الشيك يعيد المديونية')

/* ─── كشف مورد ─── */
const purchases = [
  { id: 1, invoiceNumber: 'P-0001', date: '2026-02-01', supplierId: 3, grandTotalMinor: 200000, paidMinor: 50000 },
  { id: 2, invoiceNumber: 'P-0002', date: '2026-02-05', supplierId: 3, grandTotalMinor: 60000, paidMinor: 60000 }, // مسددة
]
const pReturns = [
  { returnNumber: 'PR-0001', date: '2026-02-07', purchaseId: 1, refund: 'debt', totalMinor: 30000 },
]
const pVouchers = [
  { voucherNumber: 'PV-0001', kind: 'payment', date: '2026-02-10', partyKind: 'supplier', partyId: 3, amountMinor: 70000 },
]
const ss = supplierStatement({ supplierId: 3, purchases, purchaseReturns: pReturns, allPurchases: purchases, vouchers: pVouchers, cheques: [] })
// 150000 − 30000 − 70000 = 50000 مستحق له
ok(statementBalance(ss) === 50000, `رصيد المورد 50000 (فعلياً ${statementBalance(ss)})`)
ok(!ss.some((r) => r.docLabel.includes('P-0002')), 'الفاتورة المسددة بالكامل لا تدخل')
ok(ss.some((r) => r.docLabel.includes('مرتجع')), 'مرتجع الشراء يخفض المستحق')

/* ─── كشف موظف ─── */
const advances = [
  { advanceNumber: 'ADV-0001', date: '2026-03-01', employeeId: 5, amountMinor: 20000 },
  { advanceNumber: 'ADV-0002', date: '2026-03-10', employeeId: 5, amountMinor: 10000 },
]
const runs = [
  { runNumber: 'SAL-0001', date: '2026-03-30', lines: [{ employeeId: 5, advancesMinor: 15000, deductionsMinor: 0, netMinor: 85000 }] },
]
const es = employeeStatement({ employeeId: 5, advances, payrollRuns: runs })
ok(es.length === 3, 'كشف الموظف: سلفتان + استقطاع')
ok(statementBalance(es) === 15000, `متبقي سلف الموظف 15000 (فعلياً ${statementBalance(es)})`)

/* ─── قيد الرواتب مع استرداد السلف ─── */
const pe = buildPayrollEntry(85000, 'cash', '1101', 'مارس 2026', 15000)
ok(sum(pe, 'debit') === sum(pe, 'credit'), 'قيد الرواتب مع السلف متوازن')
ok(pe.find((l) => l.accountCode === '5102')?.debit === 100000, 'المصروف = صافي + سلف مستردة')
ok(pe.find((l) => l.accountCode === '1107')?.credit === 15000, 'السلف تُقفل من 1107')
ok(pe.find((l) => l.accountCode === '1101')?.credit === 85000, 'الخزينة بالصافي فقط')
const peNoAdv = buildPayrollEntry(85000, 'cash', '1101', 'مارس')
ok(peNoAdv.length === 2 && sum(peNoAdv, 'debit') === 85000, 'بلا سلف: قيد ثنائي كالسابق')
// خزينة مخصصة في الرواتب
const peCustom = buildPayrollEntry(50000, 'cash', '1121', 'أبريل')
ok(peCustom.find((l) => l.accountCode === '1121')?.credit === 50000, 'الرواتب من خزينة مخصصة')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص كشوف الحساب والسلف — ${pass} اختباراً`)
