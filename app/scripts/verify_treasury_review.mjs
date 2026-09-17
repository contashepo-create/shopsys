/**
 * مراجعة الخزينة والنقدية الشاملة (نفس عمق الأقسام السابقة):
 * T1) postVoucher يرفض قبل الكتابة: خزينة شبح / حساب مقابل شبح / عميل أو مورد شبح
 *     (3 فجوات سُدت — كانت كلها تمر وتولد قيوداً على حسابات غير موجودة)
 * T2) سندات القبض/الصرف: قيود متوازنة بالاتجاه الصحيح وتنعكس في كشوف الأطراف
 * T3) التحويل بين الخزائن برسوم بنكية: 5108 والمصدر ينقص المبلغ+الرسوم
 * T4) حارس الرصيد السالب المركزي: سند صرف يكسر رصيد الخزينة يُرفض
 * T5) دورة الشيك الوارد كاملة: استلام→إيداع→تحصيل + ارتداد يعيد الدين
 * T6) دورة الشيك الصادر: تحرير→صرف + إلغاء قبل الصرف يعيد الالتزام
 * T7) آلة حالات الشيك: التحولات الممنوعة تُرفض (لا رجعة بعد نهائية)
 * T8) الورديات: فتح/منع ثانية/إقفال بعد بيع نقدي وبنكي وآجل — المتوقع بالقرش
 * T9) تسوية فرق الوردية: عجز كمصروف 5108 وعجز كسلفة 1107 على الموظف
 * T10) التسويات المالية: فرق خزينة يضرب 5112 بقيد وموافقة
 * T11) إدارة الخزائن: إضافة/حذف محمي (حركة/رئيسية) + تكرار اسم مرفوض
 * T12) الحراسات: trs.payment.approve حساسة + الصرف والتحويل والتسوية خلف الرقم السري
 * T13) الثوابت: كل القيود متوازنة وكل سند/شيك يشير لقيده
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
// ملاحظة: allowNegativeTreasury=false هنا عمداً لفحص الحارس المركزي (T4)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { customerStatement, supplierStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

/* تجهيز: رأس مال افتتاحي للخزينة كي لا يصطدم الحارس */
st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500000, label: 'الخزينة الرئيسية' })
st().setOpeningBalance({ kind: 'treasury', refId: '1102', amountMinor: 300000, label: 'البنك الرئيسي' })
st().addCustomer({ nameAr: 'عميل الخزينة', phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const cust = st().customers.at(-1)
st().addSupplier({ nameAr: 'مورد الخزينة', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)

console.log('\n— T1) فحوص ما قبل الكتابة (الفجوات المسدودة) —')
{
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '9999', counterAccountCode: '4110', amountMinor: 1000, description: 'x' }), /الخزينة\/البنك غير موجود/)
  ok('T1: سند بخزينة غير موجودة يُرفض (كان يمر ويولد قيداً على حساب شبح!)')
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '8888', amountMinor: 1000, description: 'x' }), /غير موجود في شجرة/)
  ok('T1: حساب مقابل خارج شجرة الحسابات يُرفض')
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'x', partyKind: 'customer', partyId: 777 }), /العميل غير موجود/)
  assert.throws(() => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 1000, description: 'x', partyKind: 'supplier', partyId: 777 }), /المورد غير موجود/)
  ok('T1: سند مربوط بعميل/مورد شبح يُرفض — الكشوف لا تفسد')
  assert.throws(() => st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '7777', amountMinor: 1000, description: 'x' }), /الوجهة غير موجودة/)
  ok('T1: تحويل لخزينة وجهة غير موجودة يُرفض')
  assert.equal(st().vouchers.length, 0)
  ok('T1: كل الرفض قبل أي كتابة — لا سندات يتيمة')
}

console.log('\n— T2) السندات وكشوف الأطراف —')
{
  // بيع آجل ليصبح على العميل دين 900
  st().addItem({ nameAr: 'صنف', sku: 'T-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 90000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 50000 }], expenses: [], paidMinor: 0, notes: '' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 90000, unitCostMinor: 50000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().getCustomerBalance(cust.id), 90000)
  // سند قبض 400 من العميل
  const rv = st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 40000, description: 'دفعة من الحساب', partyKind: 'customer', partyId: cust.id })
  assert.equal(st().getCustomerBalance(cust.id), 50000)
  const cs = customerStatement({ customerId: cust.id, openingMinor: 0, sales: st().sales, saleReturns: st().saleReturns, allSales: st().sales, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(cs), 50000)
  ok('T2: سند القبض خفض رصيد العميل 900→500 والكشف يطابق 1104 بالقرش')
  const entry = st().journal.find((e) => e.id === rv.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '1101' && l.debit === 40000))
  assert.ok(entry.lines.some((l) => l.accountCode === '1104' && l.credit === 40000))
  ok('T2: قيد القبض: الخزينة مدينة والعميل دائن — الاتجاه صحيح')
  // سند صرف للمورد 3000
  const pv = st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 300000, description: 'سداد جزئي', partyKind: 'supplier', partyId: sup.id })
  const ss = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(ss), 200000)
  ok('T2: سند الصرف خفض مستحق المورد 5000→2000 والكشف يطابق')
  const pentry = st().journal.find((e) => e.id === pv.journalEntryId)
  assert.ok(pentry.lines.some((l) => l.accountCode === '2101' && l.debit === 300000))
  ok('T2: قيد الصرف: المورد مدين والخزينة دائنة')
}

console.log('\n— T3) التحويل برسوم —')
{
  const cashBefore = bal('1101')
  const bankBefore = bal('1102')
  const feesBefore = bal('5108')
  st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 100000, description: 'إيداع بنكي', feeMinor: 500 })
  assert.equal(bal('1101'), cashBefore - 100500)
  assert.equal(bal('1102'), bankBefore + 100000)
  assert.equal(bal('5108'), feesBefore + 500)
  ok('T3: تحويل 1000 برسوم 5 — الخزينة نقصت 1005 والبنك زاد 1000 والرسوم 5108')
}

console.log('\n— T4) حارس الرصيد السالب المركزي —')
{
  const cashNow = bal('1101')
  assert.throws(
    () => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: cashNow + 100000, description: 'صرف يكسر الرصيد' }),
    /سالباً/,
  )
  ok(`T4: سند صرف أكبر من رصيد الخزينة (${cashNow}) مرفوض — الحارس المركزي يعمل`)
  assert.equal(bal('1101'), cashNow)
  ok('T4: الرصيد لم يُمس بعد الرفض')
}

console.log('\n— T5) دورة الشيك الوارد —')
{
  const custBalBefore = st().getCustomerBalance(cust.id)
  const chq = st().receiveCheque({ chequeNumber: 'CHK-100', partyId: cust.id, bankName: 'بنك مصر', amountMinor: 50000, dueDate: '2026-10-15', notes: '' })
  assert.equal(chq.status, 'held')
  assert.equal(st().getCustomerBalance(cust.id), custBalBefore - 50000)
  assert.equal(bal('1106'), 50000)
  ok('T5: استلام الشيك: 1106 أوراق قبض مدين والعميل دائن — دينه انخفض فوراً')
  st().setChequeStatus(chq.id, 'deposited')
  assert.equal(st().journal.filter((e) => e.sourceType === 'cheque_receive').length, 1)
  ok('T5: الإيداع تحول حالة فقط — لا قيد (الورقة ما زالت أصلاً)')
  const bankBefore = bal('1102')
  st().setChequeStatus(chq.id, 'collected', '1102')
  assert.equal(bal('1102'), bankBefore + 50000)
  assert.equal(bal('1106'), 0)
  ok('T5: التحصيل: البنك مدين و1106 صفر — الورقة تحولت نقداً')
  // شيك ثانٍ يرتد
  const chq2 = st().receiveCheque({ chequeNumber: 'CHK-101', partyId: cust.id, bankName: 'بنك مصر', amountMinor: 30000, dueDate: '2026-10-20', notes: '' })
  const balAfterReceive = st().getCustomerBalance(cust.id)
  st().setChequeStatus(chq2.id, 'bounced')
  assert.equal(st().getCustomerBalance(cust.id), balAfterReceive + 30000)
  ok('T5: الارتداد أعاد الدين على العميل بقيد عاكس موثق')
  const bounceEntry = st().journal.find((e) => e.sourceType === 'cheque_bounce')
  assert.equal(bounceEntry.reversesEntryId, chq2.receiveEntryId)
  ok('T5: قيد الارتداد يشير لقيد الاستلام المعكوس — سلسلة تدقيق كاملة')
  // تكرار رقم شيك من نفس البنك
  assert.throws(() => st().receiveCheque({ chequeNumber: 'CHK-100', partyId: cust.id, bankName: 'بنك مصر', amountMinor: 1000, dueDate: '2026-10-15', notes: '' }), /مسجل من قبل/)
  ok('T5: شيك بنفس الرقم والبنك مكرر يُرفض')
}

console.log('\n— T6) دورة الشيك الصادر —')
{
  const chq = st().issueCheque({ chequeNumber: 'OUT-500', partyId: sup.id, bankName: 'CIB', amountMinor: 100000, dueDate: '2026-10-01', notes: '' })
  assert.equal(bal('2106'), -100000)
  const ss = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(ss), 100000)
  ok('T6: تحرير الشيك: المورد انخفض دينه لـ1000 و2106 أوراق دفع دائن')
  const bankBefore = bal('1102')
  st().setChequeStatus(chq.id, 'cleared', '1102')
  assert.equal(bal('1102'), bankBefore - 100000)
  assert.equal(bal('2106'), 0)
  ok('T6: الصرف: البنك نقص و2106 صفر')
  // شيك صادر يلغى قبل الصرف
  const chq2 = st().issueCheque({ chequeNumber: 'OUT-501', partyId: sup.id, bankName: 'CIB', amountMinor: 50000, dueDate: '2026-11-01', notes: '' })
  const supBefore = statementBalance(supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques }))
  st().setChequeStatus(chq2.id, 'cancelled')
  const supAfter = statementBalance(supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques }))
  assert.equal(supAfter, supBefore + 50000)
  ok('T6: الإلغاء قبل الصرف أعاد الالتزام للمورد — الكشف يعكس الإلغاء')
}

console.log('\n— T7) آلة حالات الشيك —')
{
  const collected = st().cheques.find((c) => c.status === 'collected')
  assert.throws(() => st().setChequeStatus(collected.id, 'bounced'), /لا يمكن نقل/)
  ok('T7: شيك محصل لا يرتد — الحالة النهائية قفل')
  const cleared = st().cheques.find((c) => c.status === 'cleared')
  assert.throws(() => st().setChequeStatus(cleared.id, 'cancelled'), /لا يمكن نقل/)
  ok('T7: شيك مصروف لا يُلغى — التحولات الممنوعة كلها مرفوضة')
}

console.log('\n— T8) الورديات —')
{
  const shift = st().openShift('كاشير الاختبار', 20000)
  assert.throws(() => st().openShift('آخر', 0), /مفتوحة بالفعل/)
  ok('T8: لا ورديتان مفتوحتان معاً')
  const item = st().items.at(-1)
  // بيع نقدي 900 في الدرج + بيع بنكي 900 + بيع آجل
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 90000, unitCostMinor: 50000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 90000, unitCostMinor: 50000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 90000, unitCostMinor: 50000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const { summarizeShift } = await import(join(root, 'src/core/shifts.ts'))
  const kindOf = (code) => st().treasuries.find((t) => t.code === (code ?? '1101'))?.kind ?? 'cash'
  const docs = st().sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf(s.treasury) }))
  const summary = summarizeShift(shift, docs, [])
  assert.equal(summary.cashSalesMinor, 90000)
  assert.equal(summary.bankSalesMinor, 90000)
  assert.equal(summary.creditSalesMinor, 90000)
  assert.equal(summary.expectedCashMinor, 20000 + 90000)
  ok('T8: الملخص: نقدي بالدرج 900، بنكي 900 (لا يدخل العد)، آجل 900 — المتوقع 1100 بالقرش')
  // إقفال بعجز 100
  const closed = st().closeShift(100000)
  assert.equal(closed.status, 'closed')
  const summary2 = summarizeShift(closed, docs, [])
  assert.equal(summary2.varianceMinor, -10000)
  ok('T8: أُقفلت بعد عد 1000 — العجز 100 محسوب فوراً')
}

console.log('\n— T9) تسوية فرق الوردية —')
{
  const shift = st().shifts.find((s) => s.status === 'closed')
  st().addEmployee({ nameAr: 'كاشير المسؤول', phone: '', jobTitle: 'كاشير', salaryMinor: 400000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  const advBefore = bal('1107')
  const settled = st().settleShiftVariance({ shiftId: shift.id, mode: 'advance', employeeId: emp.id })
  assert.equal(settled.varianceSettledMode, 'advance')
  assert.equal(bal('1107'), advBefore + 10000)
  assert.ok(st().employeeAdvances.some((a) => a.employeeId === emp.id && a.amountMinor === 10000))
  ok('T9: العجز 100 حُمّل سلفة على الكاشير (1107) وستُخصم من رواتبه')
  assert.throws(() => st().settleShiftVariance({ shiftId: shift.id, mode: 'expense' }), /سُوّي بالفعل/)
  ok('T9: لا تسوية مزدوجة لنفس الوردية')
}

console.log('\n— T10) التسويات المالية (جرد خزينة) —')
{
  const cashBook = bal('1101')
  const actual = cashBook - 2000 // عجز 20
  const doc = st().applySettlement({ section: 'treasury', refId: '1101', actualMinor: actual, reason: 'جرد مفاجئ للخزينة', approvedBy: 'المشرف' })
  assert.equal(doc.varianceMinor, -2000)
  assert.equal(bal('5112'), 2000)
  assert.equal(bal('1101'), actual)
  ok('T10: جرد الخزينة بعجز 20 — ضرب 5112 (درس عجز mobileshop المتبخر) وضبط الرصيد')
  assert.equal(doc.approvedBy, 'المشرف')
  ok('T10: اسم المعتمد على مستند التسوية')
}

console.log('\n— T11) إدارة الخزائن —')
{
  const t = st().addTreasury('محفظة فودافون', 'bank')
  assert.ok(t.code.startsWith('11'))
  ok(`T11: خزينة جديدة بحساب ${t.code} تلقائياً تحت النقدية`)
  assert.throws(() => st().addTreasury('محفظة فودافون', 'bank'), /بنفس الاسم|مستخدم|مكرر|موجود/)
  ok('T11: اسم خزينة مكرر مرفوض')
  assert.throws(() => st().removeTreasury('1101'), /لا يُحذفان/)
  ok('T11: الخزينة الرئيسية لا تُحذف')
  assert.throws(() => st().removeTreasury('1102'), /لا يُحذفان/)
  ok('T11: البنك الرئيسي لا يُحذف')
  st().removeTreasury(t.code)
  ok('T11: خزينة بلا حركة تُحذف طبيعياً')
  const t2 = st().addTreasury('خزينة بحركة', 'cash')
  st().setOpeningBalance({ kind: 'treasury', refId: t2.code, amountMinor: 1000, label: t2.nameAr })
  assert.throws(() => st().removeTreasury(t2.code), /حركة في اليومية/)
  ok('T11: خزينة عليها حركة لا تُحذف — التوازن محفوظ')
}

console.log('\n— T12) الحراسات —')
{
  const { PERMISSIONS } = await import(join(root, 'src/core/permissions.ts'))
  const perm = PERMISSIONS.find((p) => p.id === 'trs.payment.approve')
  assert.ok(perm?.sensitive)
  ok('T12: صلاحية اعتماد خروج النقدية trs.payment.approve معرفة وحساسة')
  const vouchersPage = readFileSync(join(root, 'src/ui/pages/VouchersPage.tsx'), 'utf8')
  assert.ok(vouchersPage.includes("useSupervisorApproval('trs.payment.approve')"))
  assert.ok(vouchersPage.includes("kind === 'payment'") && vouchersPage.includes('paymentApproval.request'))
  ok('T12: سند الصرف خلف الرقم السري — القبض (إدخال أموال) يمر مباشرة')
  const treasuryPage = readFileSync(join(root, 'src/ui/pages/TreasuryPage.tsx'), 'utf8')
  assert.ok(treasuryPage.includes("useSupervisorApproval('trs.payment.approve')") && treasuryPage.includes('transferApproval.request'))
  ok('T12: التحويل بين الخزائن خلف الرقم السري')
  const shiftsPage = readFileSync(join(root, 'src/ui/pages/ShiftsPage.tsx'), 'utf8')
  assert.ok(shiftsPage.includes("useSupervisorApproval('trs.payment.approve')") && shiftsPage.includes('settleApproval.request'))
  ok('T12: تسوية فرق الدرج خلف الرقم السري')
  const settlementsPage = readFileSync(join(root, 'src/ui/pages/SettlementsPage.tsx'), 'utf8')
  assert.ok(settlementsPage.includes('useSupervisorApproval'))
  ok('T12: التسويات المالية خلف اعتماد المشرف (كانت محروسة أصلاً)')
}

console.log('\n— T13) الثوابت —')
{
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`T13: كل قيود الدفتر (${st().journal.length}) متوازنة`)
  for (const v of st().vouchers) assert.ok(st().journal.some((e) => e.id === v.journalEntryId), `قيد السند ${v.voucherNumber}`)
  for (const c of st().cheques) {
    assert.ok(st().journal.some((e) => e.id === c.receiveEntryId), `قيد استلام/تحرير ${c.chequeNumber}`)
    if (c.settleEntryId) assert.ok(st().journal.some((e) => e.id === c.settleEntryId))
    if (c.reverseEntryId) assert.ok(st().journal.some((e) => e.id === c.reverseEntryId))
  }
  ok('T13: كل سند وشيك يشير لقيود موجودة فعلاً — لا وثائق بلا أثر محاسبي')
}

console.log(`\n✅ verify_treasury_review: ${pass} تحققاً — الخزينة والنقدية مراجعة بعمق الأقسام السابقة`)
