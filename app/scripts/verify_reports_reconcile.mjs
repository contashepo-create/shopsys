/**
 * verify_reports_reconcile.mjs — الطبقة ⑥ من منهجية الفحص: **مطابقة التقارير بالدفتر**
 * ───────────────────────────────────────────────────────────────────────────────────
 * الثوابت تُفحص على *الحالة*؛ لكن ما يراه المالك هو *التقرير*. سِت ثغرات سابقة كانت
 * «حساباً صحيحاً وعرضاً خاطئاً»: إقرار ضريبة يستبعد قيداً، ميزان مراجعة غير متوازن،
 * لائحة عملاء لا تساوي 1104، مخزون في التقرير لا يساوي 1103.
 *
 * هذه البوابة تُشغّل دورة أعمال واقعية (شراء/بيع/مرتجع/إتلاف/جرد/سند/تحويل/إنتاج)
 * ثم تُطالب كل تقرير بأن يطابق الدفتر **بالقرش**:
 *
 *   ميزان المراجعة      : مجموع مدين == مجموع دائن == مجموع الدفتر
 *   قائمة الدخل         : صافي = إيرادات − مصروفات (من الدفتر مباشرة)
 *   المركز المالي       : الأصول == الخصوم + الملكية (متوازن دائماً)
 *   دفتر الأستاذ        : رصيد الإقفال لكل حساب == رصيد القيد
 *   إقرار الضريبة       : صافي المستحق == رصيد 2102 (مخرجات − مدخلات − مسدد)
 *   التدفق النقدي       : رصيد النهاية == مجموع أرصدة الخزائن
 *   كشف العميل/المورد   : مجموع الحركات == الرصيد == حساب الدفتر
 *
 * التشغيل: node --experimental-strip-types scripts/verify_reports_reconcile.mjs
 */
import { freshCase, addSimpleItem, balanceOf, reporter } from './auditKit.mjs'
import { trialBalance, incomeStatement, balanceSheet, generalLedger, vatReport, cashFlowReport } from '../src/core/financialReports.ts'
import { computeTotals } from '../src/core/pos.ts'

const r = reporter('مطابقة التقارير بالدفتر')
const eq = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label}: ${actual} ≠ ${expected} (فرق ${actual - expected})`)
  r.ok(`${label} = ${expected}`)
}
const period = { from: '2026-01-01', to: '2026-12-31' }
const valueSum = (st) => st().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor : Math.round(it.stockQty * it.costMinor)), 0)

const c = await freshCase({ activityId: 'grocery', vatPercent: 15, taxInclusive: true })
const st = c.st
const wh = st().warehouses[0]?.id ?? 1
st().addWarehouse('فرع التقارير')
const wh2 = st().warehouses.at(-1).id
st().addSupplier({ nameAr: 'مورد التقارير', phone: '', notes: '' })
st().addCustomer({ nameAr: 'عميل التقارير', phone: '', notes: '' })
const supplier = st().suppliers.at(-1)
const customer = st().customers.at(-1)
const a = addSimpleItem(c, { nameAr: 'صنف أ', priceMinor: 1150 })
const b = addSimpleItem(c, { nameAr: 'صنف ب', priceMinor: 2300 })

st().postPurchase({
  supplierId: supplier.id, date: '2026-03-01',
  lines: [
    { itemId: a.id, qty: 12, unitPriceMinor: 800, vatPercent: 15, warehouseId: wh },
    { itemId: b.id, qty: 7.5, unitPriceMinor: 1700, vatPercent: 15, warehouseId: wh },
  ],
  expenses: [{ nameAr: 'نقل', amountMinor: 450, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory', taxTreatment: 'exempt' }],
  paidMinor: 3000, treasury: '1101', notes: '',
})
const aStock = () => st().items.find((row) => row.id === a.id)
const saleLines = [{ itemId: a.id, nameAr: a.nameAr, qty: 3.4, unitPriceMinor: 1150, unitCostMinor: aStock().costMinor, discountPercent: 5, soldByWeight: true, warehouseId: wh }]
const totals = computeTotals(saleLines, 0, 15, true, 2)
const sale = st().postSale({ lines: saleLines, customerId: customer.id, payment: 'credit', treasury: '1101', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true })
st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.4, condition: 'good' }], refund: 'credit' })
st().postWastage({ reason: 'تلف', lines: [{ itemId: b.id, qty: 0.5 }], notes: '' })
st().postStocktake([{ itemId: b.id, nameAr: b.nameAr, expectedQty: st().items.find((row) => row.id === b.id).stockQty, countedQty: Math.round((st().items.find((row) => row.id === b.id).stockQty - 0.3) * 1000) / 1000, unitCostMinor: st().items.find((row) => row.id === b.id).costMinor }], 'تقرير')
st().postTransfer({ fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ itemId: a.id, qty: 0.6 }], notes: '' })
st().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 700, description: 'تحصيل', date: '2026-06-10' })
st().postVoucher({ kind: 'payment', partyKind: 'supplier', partyId: supplier.id, treasury: '1101', counterAccountCode: '2101', amountMinor: 900, description: 'سداد', date: '2026-06-11' })
const product = (() => { addSimpleItem(c, { nameAr: 'منتج', priceMinor: 5000 }); return st().items.at(-1) })()
st().postProduction({ batches: 1, productItemId: product.id, producedQty: 1.5, ingredients: [{ itemId: a.id, qty: 1.2, warehouseId: wh }], warehouseId: wh, ingredientWarehouseId: wh, notes: '' })

const journal = st().journal
r.section('📊 ميزان المراجعة = الدفتر بالقرش')
const tb = trialBalance(journal, period)
const journalDebit = journal.filter((e) => e.date >= period.from && e.date <= period.to).reduce((sum, e) => sum + e.lines.reduce((x, l) => x + l.debit, 0), 0)
const journalCredit = journal.filter((e) => e.date >= period.from && e.date <= period.to).reduce((sum, e) => sum + e.lines.reduce((x, l) => x + l.credit, 0), 0)
eq('ميزان المراجعة متوازن', tb.balanced, true)
eq('مجموع مدين الميزان = مدين الدفتر', tb.totalDebitMinor, journalDebit)
eq('مجموع دائن الميزان = دائن الدفتر', tb.totalCreditMinor, journalCredit)
for (const code of ['1101', '1103', '1104', '2101', '2102', '4101', '4102', '5101', '5111']) {
  const row = tb.rows.find((x) => x.code === code)
  const inReport = row ? row.debitMinor - row.creditMinor : 0
  eq(`ميزان المراجعة — الحساب ${code}`, inReport, balanceOf(journal, code))
}

r.section('💵 قائمة الدخل = الإيرادات − المصروفات من الدفتر')
const inc = incomeStatement(journal, period)
const revenueBook = ['4'].map((root) => journal.reduce((sum, e) => sum + e.lines.filter((l) => l.accountCode.startsWith(root)).reduce((x, l) => x + l.credit - l.debit, 0), 0))[0]
const expenseBook = journal.reduce((sum, e) => sum + e.lines.filter((l) => l.accountCode.startsWith('5')).reduce((x, l) => x + l.debit - l.credit, 0), 0)
eq('إجمالي إيرادات القائمة = إيرادات الدفتر', inc.totalRevenueMinor, revenueBook)
eq('إجمالي مصروفات القائمة = مصروفات الدفتر', inc.totalExpenseMinor, expenseBook)
eq('صافي الربح = إيرادات − مصروفات', inc.netProfitMinor, revenueBook - expenseBook)
eq('مجمل الربح = إيرادات − تكاليف مباشرة', inc.grossProfitMinor, inc.totalRevenueMinor - inc.totalCostOfSalesMinor)
eq('المصروفات = تكاليف مباشرة + تشغيلية', inc.totalExpenseMinor, inc.totalCostOfSalesMinor + inc.totalOperatingExpenseMinor)

r.section('⚖️ المركز المالي: الأصول = الخصوم + الملكية')
const bs = balanceSheet(journal, period.to)
eq('المركز المالي متوازن', bs.balanced, true)
eq('مجموع الأصول = أصول الدفتر (1)', bs.totalAssetsMinor, journal.reduce((sum, e) => sum + e.lines.filter((l) => l.accountCode.startsWith('1')).reduce((x, l) => x + l.debit - l.credit, 0), 0))
eq('أصول متداولة + غير متداولة = الإجمالي', bs.totalCurrentAssetsMinor + bs.totalNonCurrentAssetsMinor, bs.totalAssetsMinor)

r.section('📚 دفتر الأستاذ: رصيد الإقفال = رصيد القيد لكل حساب')
for (const code of ['1101', '1103', '1104', '2101', '2102', '4101', '5101', '5111']) {
  const gl = generalLedger(journal, code, period)
  // دفتر الأستاذ يعرض بطبيعة الحساب (خصوم/إيرادات بالموجب) والدفتر يعرض مدين−دائن
  const natural = code.startsWith('2') || code.startsWith('3') || code.startsWith('4') ? -balanceOf(journal, code) : balanceOf(journal, code)
  eq(`دفتر الأستاذ — رصيد إقفال ${code}`, gl.closingMinor, natural)
  const rowsSum = gl.rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0)
  const sign = code.startsWith('2') || code.startsWith('3') || code.startsWith('4') ? -1 : 1
  eq(`دفتر الأستاذ — حركات ${code} = الإقفال − الافتتاح`, sign * rowsSum, gl.closingMinor - gl.openingMinor)
}

r.section('🧮 إقرار الضريبة: الصافي = رصيد 2102 صفراً بعد كل القيود')
const vat = vatReport(journal, period)
eq('صافي الضريبة المستحقة = مخرجات − مدخلات', vat.netDueMinor, vat.outputVatMinor - vat.inputVatMinor)
eq('المتبقي = الصافي − المسدد', vat.remainingMinor, vat.netDueMinor - vat.settledMinor)
eq('رصيد 2102 في الدفتر = المتبقي في الإقرار', -balanceOf(journal, '2102'), vat.remainingMinor)

r.section('💰 التدفق النقدي: رصيد النهاية = مجموع الخزائن')
const cashCodes = st().treasuries.map((t) => t.code)
const cash = cashFlowReport(journal, cashCodes, period)
const treasuryBook = st().treasuries.reduce((sum, t) => sum + balanceOf(journal, t.code), 0)
eq('رصيد نهاية التدفق النقدي = أرصدة الخزائن', cash.closingCashMinor, treasuryBook)
eq('صافي التغير = داخل − خارج', cash.netChangeMinor, cash.totalInMinor - cash.totalOutMinor)
eq('مجموع الأنشطة = صافي التغير', cash.operatingNetMinor + cash.investingNetMinor + cash.financingNetMinor, cash.netChangeMinor)

r.section('👥 كشوف الأطراف = حساب الدفتر')
eq('مجموع كشوف العملاء = 1104', st().customers.reduce((sum, row) => sum + st().getCustomerBalance(row.id), 0), balanceOf(journal, '1104'))
eq('مجموع كشوف الموردين = 2101', st().suppliers.reduce((sum, row) => sum + st().getSupplierBalance(row.id), 0), -balanceOf(journal, '2101'))
const customerRows = st().getCustomerStatementRows(customer.id, period)
eq('مجموع حركات كشف العميل = رصيده', customerRows.reduce((sum, row) => sum + (row.debitMinor ?? 0) - (row.creditMinor ?? 0), 0), st().getCustomerBalance(customer.id))

r.section('📦 تقييم المخزون = 1103 بالقرش')
eq('مجموع قيم الأصناف = 1103', valueSum(st), balanceOf(journal, '1103'))
if (typeof st().getInventoryValuation === 'function') eq('تقرير تقييم المخزون = 1103', st().getInventoryValuation?.().totalMinor ?? valueSum(st), balanceOf(journal, '1103'))

r.done()
