/**
 * فحص دفعة الأوامر الـ25 — الجزء الأول (الأساسات):
 * 1) الوردية: تحصيل بنكي لا يدخل عدّ الدرج + الدفع المجزأ يقسم الفاتورة
 * 2) تقرير مديونيات العملاء: الجزء المحصل وقت البيع ليس ديناً
 * 3) الإيصال المطبوع: المدفوع/المتبقي في نموذج الطباعة
 * 4) تسوية فرق الوردية: مصروف/إيراد أو سلفة على الموظف (قيود متوازنة)
 * 5) رسوم التحويل بين الخزائن (قيد 5108)
 * 6) منع الرصيد السالب في الخزائن (الحارس المركزي) + السماح به بالإعداد
 * 7) الحقول الاحترافية للخزائن/البنوك
 * تشغيل: node --experimental-strip-types scripts/verify_batch25_core.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
// نبدأ بالوضع الافتراضي: الرصيد السالب ممنوع — سنموّل الخزينة أولاً
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: false } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { summarizeShift, buildVarianceExpenseEntry, buildVarianceAdvanceEntry } = await import('../src/core/shifts.ts')
const { customerBalances, salesSummary, salePaidMinor } = await import('../src/core/reports.ts')
const { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } = await import('../src/core/receipt.ts')
const { buildTransferEntry } = await import('../src/core/accounting.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cartLine = (itemId, qty, price, cost) => ({ itemId, nameAr: 'صنف', qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: 0, soldByWeight: false })

console.log('🏗️ التأسيس: عميل + موظف + صنف برصيد + تمويل الخزينة برأس مال')
S().addCustomer({ ...party('عميل الاختبار'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)
S().addEmployee({ ...party('كاشير الوردية'), jobTitle: 'كاشير', hireDate: '2025-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true })
const emp = S().employees.at(-1)
S().addItem(item({ nameAr: 'سلعة', stockQty: 100, costMinor: 1000, priceMinor: 2000 }))
const it = S().items.at(-1)
// تمويل الخزينة (قيد يدوي: 1101 / 3101 رأس مال) حتى تمر السيناريوهات مع منع السالب
S().postManualEntry({ description: 'رأس مال افتتاحي', lines: [
  { accountCode: '1101', debit: 10_000_000, credit: 0, note: '' },
  { accountCode: '3101', debit: 0, credit: 10_000_000, note: '' },
] })

console.log('\n1️⃣ الوردية: بنكي لا يدخل الدرج + مجزأ يقسم الفاتورة')
const shift = S().openShift('كاشير الوردية', 50000)
// بيع نقدي كامل للدرج 300
S().postSale({ lines: [cartLine(it.id, 1, 30000, 1000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 30000 })
// بيع محصل بالكامل على البنك 500 — يجب ألا يدخل عدّ الدرج (بلاغ المالك)
S().postSale({ lines: [cartLine(it.id, 1, 50000, 1000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102', paidMinor: 50000 })
// بيع مجزأ: 700 منها 400 نقداً للدرج والباقي آجل (بلاغ المالك: كان يُسجل كله آجلاً)
S().postSale({ lines: [cartLine(it.id, 1, 70000, 1000)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 40000 })
// بيع آجل كامل 200
S().postSale({ lines: [cartLine(it.id, 1, 20000, 1000)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })

const kindOf = (code) => S().treasuries.find((t) => t.code === (code ?? '1101'))?.kind ?? 'cash'
const saleDocs = () => S().sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf(s.treasury) }))
const returnDocs = () => S().saleReturns.map((r) => ({ shiftId: r.shiftId, payment: r.refund, totalMinor: r.totals.totalMinor, treasuryKind: kindOf(S().sales.find((s) => s.id === r.saleId)?.treasury) }))

{
  const sum = summarizeShift(S().shifts.find((s) => s.id === shift.id), saleDocs(), returnDocs())
  ok('محصل الدرج = نقدي 300 + جزء المجزأ 400 = 700', sum.cashSalesMinor === 70000, sum.cashSalesMinor)
  ok('محصل البنوك 500 منفصل ولا يدخل الدرج', sum.bankSalesMinor === 50000, sum.bankSalesMinor)
  ok('الآجل = جزء المجزأ 300 + الآجل الكامل 200 = 500', sum.creditSalesMinor === 50000, sum.creditSalesMinor)
  ok('المتوقع بالدرج = افتتاحي 500 + 700 = 1200', sum.expectedCashMinor === 120000, sum.expectedCashMinor)
}

console.log('\n2️⃣ تقرير المديونيات: المحصل وقت البيع ليس ديناً (بلاغ المالك الحرج)')
{
  const rows = customerBalances(S().sales, S().saleReturns, [])
  const row = rows.find((r) => r.customerId === cust.id)
  ok('دين العميل = 300 (باقي المجزأ) + 200 (الآجل) = 500 لا 900', row?.invoicedMinor === 50000, row?.invoicedMinor)
  const sum = salesSummary(S().sales, S().saleReturns, { from: '2000-01-01', to: '2100-01-01' })
  ok('ملخص المبيعات: كاش = المحصل فعلاً 1200', sum.cashMinor === 120000, sum.cashMinor)
  ok('ملخص المبيعات: آجل = 500 فقط', sum.creditMinor === 50000, sum.creditMinor)
  const split = S().sales.find((s) => s.paidMinor === 40000)
  ok('salePaidMinor للمجزأ = 400', salePaidMinor(split) === 40000)
}

console.log('\n3️⃣ نموذج الإيصال: المدفوع/المتبقي (بلاغ المالك: الطباعة كانت تظهر الإجمالي فقط)')
{
  const split = S().sales.find((s) => s.paidMinor === 40000)
  const model = buildReceiptModel({
    invoiceNumber: split.invoiceNumber, dateIso: split.date, lines: split.lines, totals: split.totals,
    payment: split.payment, paidMinor: split.paidMinor, customerName: 'عميل الاختبار',
    taxPercent: 0, taxInclusive: true, settings: DEFAULT_RECEIPT_SETTINGS,
  })
  ok('paidMinor في النموذج = 400', model.paidMinor === 40000)
  ok('remainingMinor = 300', model.remainingMinor === 30000)
  ok('تسمية الدفع «مجزأ»', model.paymentLabel.includes('مجزأ'))
  const cashModel = buildReceiptModel({
    invoiceNumber: 'S-X', dateIso: split.date, lines: split.lines, totals: split.totals,
    payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings: DEFAULT_RECEIPT_SETTINGS,
  })
  ok('النقدي الكامل: متبقٍ صفر وتسميته نقدي', cashModel.remainingMinor === 0 && cashModel.paymentLabel === 'نقدي')
}

console.log('\n4️⃣ تسوية فرق الوردية (طلب المالك): مصروف أو سلفة')
// إقفال بعجز 100: متوقع 1200 معدود 1100
S().closeShift(110000)
{
  const closed = S().shifts.find((s) => s.id === shift.id)
  const sum = summarizeShift(closed, saleDocs(), returnDocs())
  ok('العجز = −100', sum.varianceMinor === -10000, sum.varianceMinor)
  // نواة القيود
  const expLines = buildVarianceExpenseEntry(-10000, '1101', 'وردية')
  ok('قيد العجز كمصروف: 5108 مدين / 1101 دائن', expLines[0].accountCode === '5108' && expLines[0].debit === 10000 && expLines[1].accountCode === '1101' && expLines[1].credit === 10000)
  const surLines = buildVarianceExpenseEntry(5000, '1101', 'وردية')
  ok('قيد الزيادة: 1101 مدين / 4110 دائن', surLines[0].accountCode === '1101' && surLines[1].accountCode === '4110')
  const advLines = buildVarianceAdvanceEntry(-10000, '1101', 'كاشير')
  ok('قيد السلفة: 1107 مدين / 1101 دائن', advLines[0].accountCode === '1107' && advLines[0].debit === 10000)
  throws('سلفة عن زيادة تُرفض', () => buildVarianceAdvanceEntry(5000, '1101', 'كاشير'), 'عجز فقط')

  // التسوية سلفة على الموظف عبر الـrepo
  const adv1107Before = bal('1107')
  const updated = S().settleShiftVariance({ shiftId: shift.id, mode: 'advance', employeeId: emp.id })
  ok('الوردية عُلّمت advance مع قيد وسلفة', updated.varianceSettledMode === 'advance' && updated.varianceEntryId != null && updated.varianceAdvanceId != null)
  ok('1107 زاد بقيمة العجز', bal('1107') - adv1107Before === 10000)
  const adv = S().employeeAdvances.find((a) => a.id === updated.varianceAdvanceId)
  ok('السلفة تظهر في سلف الموظف وتُخصم من رواتبه', adv?.employeeId === emp.id && adv.amountMinor === 10000 && adv.recoveredMinor === 0)
  throws('تسوية ثانية لنفس الوردية تُرفض', () => S().settleShiftVariance({ shiftId: shift.id, mode: 'expense' }), 'سُوّي بالفعل')
  ok('الدفتر متوازن بعد التسوية', balanced())
}

console.log('\n5️⃣ رسوم التحويل بين الخزائن (طلب المالك)')
{
  const lines = buildTransferEntry('1101', '1102', 100000, 'تحويل', 1500)
  ok('الوجهة تستلم 1000 فقط', lines.find((l) => l.accountCode === '1102')?.debit === 100000)
  ok('الرسوم 15 على 5108', lines.find((l) => l.accountCode === '5108')?.debit === 1500)
  ok('المصدر ينقص 1015', lines.find((l) => l.accountCode === '1101')?.credit === 101500)
  throws('رسوم سالبة تُرفض', () => buildTransferEntry('1101', '1102', 1000, 'x', -5), 'سالب')
  const b1101 = bal('1101'), b1102 = bal('1102'), b5108 = bal('5108')
  S().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 200000, description: 'تحويل برسوم', feeMinor: 3000 })
  ok('التحويل الفعلي: 1101 −2030، 1102 +2000، 5108 +30',
    bal('1101') - b1101 === -203000 && bal('1102') - b1102 === 200000 && bal('5108') - b5108 === 3000)
}

console.log('\n6️⃣ الحارس المركزي: منع الرصيد السالب في الخزائن')
{
  const cash = bal('1101')
  throws('صرف أكبر من رصيد الخزينة يُرفض بوضوح', () => S().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: cash + 100000, description: 'إيجار ضخم',
  }), 'سالباً')
  ok('لم يُكتب أي قيد بعد الرفض (الرصيد كما هو)', bal('1101') === cash)
  // تفعيل السماح — نفس العملية تمر
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  S().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: cash + 100000, description: 'إيجار ضخم' })
  ok('بعد تفعيل الإعداد تمر العملية ويصبح الرصيد سالباً', bal('1101') === -100000, bal('1101'))
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: false } } }))
}

console.log('\n7️⃣ الحقول الاحترافية للخزائن/البنوك (طلب المالك)')
{
  const t = S().addTreasury('بنك مصر — الرئيسي', 'bank', {
    aliasAr: 'NBE-01', accountNumber: '1234567890', iban: 'EG380019000500000000263180002',
    branch: 'فرع المنصورة', holderName: 'شركة الاختبار', swift: 'NBEGEGCX', notes: 'حساب المرتبات',
  })
  const saved = S().treasuries.find((x) => x.code === t.code)
  ok('كل الحقول محفوظة', saved.accountNumber === '1234567890' && saved.iban.startsWith('EG38') && saved.swift === 'NBEGEGCX' && saved.aliasAr === 'NBE-01')
  S().renameTreasury(t.code, 'بنك مصر', { branch: 'فرع طلخا' })
  const renamed = S().treasuries.find((x) => x.code === t.code)
  ok('التعديل يحدّث الاسم والفرع ويبقي الباقي', renamed.nameAr === 'بنك مصر' && renamed.branch === 'فرع طلخا')
}

ok('الدفتر متوازن ختاماً', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail) process.exit(1)
console.log('🎉 أساسات دفعة الأوامر الـ25 كلها تعمل: وردية دقيقة، مديونيات صحيحة، مدفوع/متبقٍ، تسوية فروق، رسوم تحويل، حارس الرصيد السالب، خزائن احترافية')
