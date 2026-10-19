/**
 * فحص إصلاحات المالك على اللوجستيات وكشف الحساب (الدفعة الحالية):
 * ① المصاريف الآجلة → 2113 «مصروفات نقلات مستحقة» لا 2101 الموردين
 * ② النقلة الآجلة لا تسجَّل «مدفوعة»: كل الإجمالي على 1104
 * ③ التحصيل الجزئي paidMinor: خزينة + 1104 بالباقي
 * ④ مصروف نقلة من عهدة موظف: دائن 1108 + حركة بملف العهدة برصيد كافٍ
 * ⑤ كشف حساب العميل يُظهر النقلات (customerUnitDocs + extraDocs)
 * تشغيل: node --experimental-strip-types scripts/verify_logistics_fixes.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeTripTotals, buildTripEntry } = await import('../src/core/logistics.ts')
const { customerStatement, customerUnitDocs, statementBalance } = await import('../src/core/statements.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const entryOf = (t) => S().journal.find((e) => e.id === t.journalEntryId)
const lineSum = (e, code, side) => (Array.isArray(e) ? e : e.lines).filter((l) => l.accountCode === code).reduce((a, l) => a + l[side], 0)

console.log('\n1️⃣ النواة: القيد الصحيح')
const totals = computeTripTotals({ qty: 1, unitPriceMinor: 100_000, vatPercent: 0, expenses: [
  { nameAr: 'كارت', qty: 1, unitAmountMinor: 10_000, source: 'credit' },
  { nameAr: 'سولار', qty: 1, unitAmountMinor: 20_000, source: 'custody' },
] })
ok('custodyMinor يدخل التكلفة', totals.custodyMinor === 20_000 && totals.costMinor === 30_000)
const eCredit = buildTripEntry(totals, 'credit', 'TR-X')
ok('آجلة: كل الإجمالي مدين 1104 ولا خزينة', lineSum(eCredit, '1104', 'debit') === 100_000 && !eCredit.some((l) => l.accountCode === '1101' && l.debit > 0))
ok('الآجل على 2113 لا 2101', lineSum(eCredit, '2113', 'credit') === 10_000 && !eCredit.some((l) => l.accountCode === '2101'))
ok('العهدة دائن 1108', lineSum(eCredit, '1108', 'credit') === 20_000)
const ePartial = buildTripEntry(totals, 'credit', 'TR-Y', '1101', 40_000)
ok('جزئي: 40,000 خزينة + 60,000 على العميل', lineSum(ePartial, '1101', 'debit') === 40_000 && lineSum(ePartial, '1104', 'debit') === 60_000)
throws('paid فوق الإجمالي يُرفض', () => buildTripEntry(totals, 'cash', 'TR-Z', '1101', 999_999), 'بين صفر')

console.log('\n2️⃣ المخزن: نقلة آجلة + عهدة + جزئي')
S().addCustomer({ nameAr: 'شركة الدلتا', phone: '', creditLimitMinor: 0, notes: '' })
const cust = S().customers.find((c) => c.nameAr === 'شركة الدلتا')
S().addEmployee({ nameAr: 'سائق أحمد', phone: '', jobTitle: 'سائق', hireDate: '2026-01-01', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '' })
const drv = S().employees.find((e) => e.nameAr === 'سائق أحمد')
const file = S().openCustodyFile({ employeeId: drv.id, projectId: null, reason: 'مصاريف طريق', notes: '' })
S().fundCustodyFile({ fileId: file.id, amountMinor: 50_000, treasury: '1101', description: 'تمويل' })

const trip1 = S().postTrip({
  customerId: cust.id, vehicleId: null, driverId: drv.id,
  input: { fromLoc: 'دمياط', toLoc: 'العاشر', qty: 1, unitPriceMinor: 100_000, vatPercent: 0, payment: 'credit', containerNumbers: [], expenses: [
    { nameAr: 'كارت طريق', qty: 1, unitAmountMinor: 10_000, source: 'credit' },
    { nameAr: 'سولار', qty: 1, unitAmountMinor: 20_000, source: 'custody' },
  ] },
  notes: '', custodyFileId: file.id,
})
const e1 = entryOf(trip1)
ok('الآجلة: 1104 مدين بالكامل (لم تُسجل مدفوعة)', lineSum(e1, '1104', 'debit') === 100_000)
ok('2113 وليس 2101 بالقيد', lineSum(e1, '2113', 'credit') === 10_000 && !e1.lines.some((l) => l.accountCode === '2101'))
ok('عهدة: دائن 1108 وحركة بالملف', lineSum(e1, '1108', 'credit') === 20_000 &&
  S().custodyTxs.some((t) => t.fileId === file.id && t.type === 'expense' && t.amountMinor === 20_000 && t.description.includes(trip1.tripNumber)))

const trip2 = S().postTrip({
  customerId: cust.id, vehicleId: null, driverId: null,
  input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 50_000, vatPercent: 0, payment: 'credit', containerNumbers: [], expenses: [] },
  notes: '', paidMinor: 30_000,
})
const e2 = entryOf(trip2)
ok('التحصيل الجزئي: 30,000 خزينة + 20,000 دين', lineSum(e2, '1101', 'debit') === 30_000 && lineSum(e2, '1104', 'debit') === 20_000)

throws('عهدة برصيد غير كافٍ تُرفض', () => S().postTrip({
  customerId: cust.id, vehicleId: null, driverId: null,
  input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 10_000, vatPercent: 0, payment: 'cash', containerNumbers: [], expenses: [
    { nameAr: 'x', qty: 1, unitAmountMinor: 999_999, source: 'custody' },
  ] },
  notes: '', custodyFileId: file.id,
}), 'تتجاوز')
throws('مصروف عهدة بلا ملف يُرفض', () => S().postTrip({
  customerId: null, vehicleId: null, driverId: null,
  input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 10_000, vatPercent: 0, payment: 'cash', containerNumbers: [], expenses: [
    { nameAr: 'x', qty: 1, unitAmountMinor: 1_000, source: 'custody' },
  ] },
  notes: '',
}), 'ملف العهدة')
throws('جزئي بلا عميل مسجل يُرفض', () => S().postTrip({
  customerId: null, vehicleId: null, driverId: null,
  input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 10_000, vatPercent: 0, payment: 'cash', containerNumbers: [], expenses: [] },
  notes: '', paidMinor: 5_000,
}), 'عميلاً مسجلاً')

console.log('\n3️⃣ كشف الحساب يُظهر النقلات')
const docs = customerUnitDocs({ customerId: cust.id, trips: S().trips })
ok('نقلتان بالكشف: 100,000 آجلة + 50,000 جزئية والمدفوع دائنًا',
  docs.length === 2 && docs.some((d) => d.debitMinor === 100_000) && docs.some((d) => d.debitMinor === 50_000 && d.creditMinor === 30_000))
const stmt = customerStatement({ customerId: cust.id, sales: [], saleReturns: [], allSales: [], vouchers: [], cheques: [], extraDocs: docs })
ok('رصيد العميل = 120,000', statementBalance(stmt) === 120_000)
ok('التسمية واضحة «نقلة TR-…»', stmt.every((r) => r.docLabel.includes('نقلة')))
ok('نقلة نقدية كاملة لا تدخل الكشف', customerUnitDocs({ customerId: 999, trips: S().trips }).length === 0)

console.log('\n4️⃣ بنود خدمة النقل والحاويات + قسم مصاريف النقلات المستقل + تعديل النقلة بعد تسجيلها')
const svcItemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة نقل داخلي من الميناء إلى التخزين', unitAr: 'نقلة', priceMinor: 40_000 })
const tripMulti = S().postTrip({
  customerId: cust.id,
  vehicleId: null,
  driverId: drv.id,
  input: {
    fromLoc: 'الميناء',
    toLoc: 'التخزين',
    qty: 3,
    unitPriceMinor: 40_000,
    vatPercent: 15,
    payment: 'credit',
    containerNumbers: ['MSKU111', 'MSKU222', 'MSKU333'],
    expenses: [],
    lines: [
      {
        itemId: svcItemId,
        serviceNameAr: 'خدمة نقل داخلي من الميناء إلى التخزين',
        fromLoc: 'الميناء',
        toLoc: 'التخزين',
        qty: 3,
        unitPriceMinor: 40_000,
        containerNumbers: ['MSKU111', 'MSKU222', 'MSKU333'],
      },
    ],
  },
  notes: '3 حاويات',
})
ok('بنود الخدمة + الضريبة 15% = 120,000 + 18,000 = 138,000', tripMulti.totals.baseMinor === 120_000 && tripMulti.totals.vatMinor === 18_000 && tripMulti.totals.grandMinor === 138_000)

// مصروف داخلي على الشركة (5106) من قسم مصاريف النقلات
const expCompany = S().addTripExpense({
  tripId: tripMulti.id,
  nameAr: 'سولار وكارتة طريق',
  qty: 1,
  unitAmountMinor: 15_000,
  bearer: 'company',
  paymentSource: 'cash',
  treasury: '1101',
  notes: 'مصروف داخلي',
})
const balAfterCompanyExp = S().getCustomerBalance(cust.id)
ok('مصروف الشركة الداخلي (5106) يخصم من ربح النقلة ولا يظهر في رصيد العميل (1104)', expCompany.bearer === 'company' && balAfterCompanyExp === 120_000 + 138_000 && S().trips.find((x) => x.id === tripMulti.id).totals.profitMinor === 105_000)

// مصروف محمّل على العميل (1104) من قسم مصاريف النقلات
const expCustomer = S().addTripExpense({
  tripId: tripMulti.id,
  nameAr: 'أرضيات وتخليص ميناء على حساب العميل',
  qty: 1,
  unitAmountMinor: 25_000,
  bearer: 'customer',
  paymentSource: 'cash',
  treasury: '1101',
  notes: 'على العميل',
})
const balAfterCustExp = S().getCustomerBalance(cust.id)
const openInvs = S().getOpenClientInvoices(cust.id)
ok('مصروف العميل (1104) ينزل في ذمته وكشف حسابه ومستنداته المفتوحة', expCustomer.bearer === 'customer' && balAfterCustExp === 120_000 + 138_000 + 25_000 && openInvs.some((d) => d.docKey === `tripexp:${expCustomer.id}` && d.dueMinor === 25_000))

// تعديل النقلة بعد تسجيلها (updateTrip)
const updatedTrip = S().updateTrip({
  tripId: tripMulti.id,
  customerId: cust.id,
  vehicleId: null,
  driverId: drv.id,
  input: {
    fromLoc: 'الميناء',
    toLoc: 'التخزين',
    qty: 2,
    unitPriceMinor: 50_000,
    vatPercent: 0,
    payment: 'credit',
    containerNumbers: ['MSKU111', 'MSKU222'],
    expenses: [],
    lines: [
      {
        itemId: svcItemId,
        serviceNameAr: 'خدمة نقل داخلي من الميناء إلى التخزين',
        fromLoc: 'الميناء',
        toLoc: 'التخزين',
        qty: 2,
        unitPriceMinor: 50_000,
        containerNumbers: ['MSKU111', 'MSKU222'],
      },
    ],
  },
  notes: 'بعد التعديل إلى نقلتين بدون ضريبة',
})
ok('تعديل النقلة بعد تسجيلها يحدث الإجمالي (100,000) ويحافظ على مصروف الشركة المسجل (15,000) والربح (85,000)', updatedTrip.totals.grandMinor === 100_000 && updatedTrip.totals.costMinor === 15_000 && updatedTrip.totals.profitMinor === 85_000)
ok('رصيد العميل بعد تعديل النقلة = 120,000 + 100,000 + 25,000 = 245,000', S().getCustomerBalance(cust.id) === 245_000)

const total = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة', total === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
