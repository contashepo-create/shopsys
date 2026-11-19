/**
 * بوابة تسوية ماكينات الدفع — أول دليل تشغيلي على `recordPaymentTerminalSettlement`.
 *
 * الفجوة التي أغلقتها: العملية تُرحّل قيداً بنكياً (إيداع − عمولة − ضريبة عمولة − فرق)
 * وتُفرغ حساب التسوية المعلّق، لكنها لم تكن مذكورة في أي اختبار أو بوابة تحقق —
 * مسار نقود بلا دليل. هنا يُثبت الحساب بالأرقام: تحصيلان فعليان من بيع ببطاقة،
 * ثم تسوية بعمولة وضريبة **وعجز 50 قرشاً**، ثم رفض الحالات غير المشروعة.
 */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants, balanceOf } from './auditKit.mjs'

const R = reporter('تسوية ماكينات الدفع — القيد والفرق والرفض')
const c = await freshCase({ activityId: 'grocery', requireOpenShiftForSales: false })
const st = c.st

st().addPaymentTerminal({ id: 't1', code: 'TERM-0001', nameAr: 'ماكينة الكاشير', providerName: 'visanet', branchId: '', settlementAccountCode: '1102', terminalId: 'T1', status: 'active' })
st().addSupplier({ nameAr: 'مورد', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
st().addItem({ nameAr: 'صنف بطاقة', categoryId: null, unit: 'قطعة', priceMinor: 2500, barcode: '999', sku: 'TT-1', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
const item = st().items.find((row) => row.sku === 'TT-1')
st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-11-17', treasury: '1101', notes: '', expenses: [], paidMinor: 20000, lines: [{ itemId: item.id, qty: 20, unitPriceMinor: 1000 }] })
st().openShift('كاشير', 0)

const sell = (qty, reference) => st().postSale({
  lines: [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: 2500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', treasury: '1102', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
  terminalPayment: { terminalId: 't1', providerReference: reference },
})
sell(2, 'PR-1')   // 5000
sell(1, 'PR-2')   // 2500
assertInvariants('بعد البيع بالبطاقة', c)

const charges = st().paymentTerminalTransactions.filter((row) => row.terminalId === 't1' && row.kind === 'charge')
assert.equal(charges.length, 2, 'البيع بالبطاقة يجب أن يسجّل عمليتي تحصيل')
const gross = charges.reduce((sum, row) => sum + row.amountMinor, 0)
assert.equal(gross, 7500, 'إجمالي التحصيل')
assert.equal(balanceOf(st().journal, '1102'), 7500, 'حساب التسوية المعلّق يحمل التحصيل قبل التسوية')

/* ① تسوية بعمولة 100 + ضريبتها 15 + إيداع ناقص 50 (عجز) */
const settledAt = new Date(Date.now() + 60_000).toISOString()
const settlement = {
  id: 'set-1', terminalId: 't1', transactionIds: charges.map((row) => row.id),
  settledAt, grossMinor: gross, feeMinor: 100, feeTaxMinor: 15, depositedMinor: gross - 100 - 15 - 50, bankAccountCode: '1101',
}
st().recordPaymentTerminalSettlement(settlement)
assertInvariants('بعد تسوية الماكينة', c)

const saved = st().paymentTerminalSettlements.find((row) => row.id === 'set-1')
assert.ok(saved, 'التسوية لم تُحفظ')
assert.equal(saved.differenceMinor, -50, 'الفرق يجب أن يكون عجزاً 50 قرشاً')
assert.equal(saved.grossMinor, gross)
const entry = st().journal.find((row) => row.id === saved.journalEntryId)
assert.ok(entry, 'التسوية بلا قيد')
assert.equal(entry.lines.reduce((sum, line) => sum + line.debit, 0), entry.lines.reduce((sum, line) => sum + line.credit, 0), 'قيد التسوية متزن')
const side = (code) => entry.lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + line.debit - line.credit, 0)
assert.equal(-side('1102'), gross, 'حساب التسوية المعلّق يُقفل بكامل التحصيل')
assert.equal(side('1101'), gross - 115 - 50, 'الإيداع النقدي = الإجمالي − العمولة − ضريبتها − العجز')
assert.equal(side('5113'), 115, 'العمولة وضريبتها على 5113')
assert.equal(side('5112'), 50, 'العجز على 5112')
assert.equal(balanceOf(st().journal, '1102'), 0, 'حساب التسوية المعلّق صفر بعد تسوية كل التحصيلات')
R.ok(`تسوية ${gross} بعمولة 115 وعجز 50 — القيد متزن وحساب التسوية صفر`)

/* ② الرفض: لا تسوية مزدوجة، ولا إجمالي مخالف، ولا ماكينة أخرى، ولا تاريخ لاحق */
assert.throws(() => st().recordPaymentTerminalSettlement({ ...settlement, id: 'set-2', transactionIds: charges.map((row) => row.id) }), /مسواة|مسبقاً/, 'التسوية المزدوجة يجب أن تُرفض')
// عمليات جديدة غير مسواة لبقية حالات الرفض
const third = sell(1, 'PR-3')
const freshCharge = st().paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentId === String(third.id))
assert.ok(freshCharge, 'تحصيل ثالث لم يُسجل')
const before = st().journal.length
const base = { ...settlement, id: 'set-x', transactionIds: [freshCharge.id], grossMinor: freshCharge.amountMinor, depositedMinor: freshCharge.amountMinor - 115 }
assert.throws(() => st().recordPaymentTerminalSettlement({ ...base, id: 'set-3', grossMinor: freshCharge.amountMinor + 1 }), /لا يطابق/, 'الإجمالي المخالف يُرفض')
assert.throws(() => st().recordPaymentTerminalSettlement({ ...base, id: 'set-4', terminalId: 't-other' }), /الماكينة|غير موجودة/, 'ماكينة أخرى تُرفض')
const early = new Date(Date.now() - 86_400_000).toISOString()
assert.throws(() => st().recordPaymentTerminalSettlement({ ...base, id: 'set-5', settledAt: early }), /لاحق|تاريخ/, 'تاريخ دفعة قبل العملية يُرفض')
assert.equal(st().journal.length, before, 'الرفض يجب أن يترك الدفتر كما هو')
assert.equal(st().paymentTerminalSettlements.length, 1, 'لا تسوية إضافية بعد الرفض')
R.ok('أربعة رفوض صحيحة (مزدوجة/إجمالي/ماكينة/تاريخ) بلا أثر على الدفتر')
R.done()
