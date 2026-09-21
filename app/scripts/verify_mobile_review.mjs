/**
 * فحص جولة مراجعة نشاط الموبايلات (الطلبات 6–9 — الجولة الثانية):
 * ① الأرصدة الافتتاحية: قيد متوازن مقابل رأس المال 3101 + التعديل يرحّل الفرق فقط + رفض معرّف شبح
 * ② التسويات الشاملة: الفرق يضرب 5112 إجبارياً (درس عجز الـ5,000 المتبخر) + رفض العدّ السالب للخزائن فقط
 * ③ تكامل الكشوف: الرصيد الافتتاحي وصفوف التسوية تدخل كشف الحساب
 * تشغيل: node --experimental-strip-types scripts/verify_mobile_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { validateOpening, buildOpeningDeltaEntry, openingKey } = await import('../src/core/openingBalances.ts')
const { validateSettlement, buildSettlementEntry, settlementVariance } = await import('../src/core/settlement.ts')
const { customerStatement, supplierStatement, statementBalance } = await import('../src/core/statements.ts')
const { STANDARD_COA } = await import('../src/core/ledger.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const balanced = (lines) => lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0
const sumAcc = (code) => S().journal.reduce((a, e) => a + e.lines.reduce((x, l) => x + (l.accountCode === code ? l.debit - l.credit : 0), 0), 0)

console.log('\n1️⃣ نواة الأرصدة الافتتاحية')
ok('رفض مبلغ سالب', validateOpening('customer', -100).length > 0)
ok('رفض مبلغ كسري', validateOpening('customer', 10.5).length > 0)
ok('قبول صفر (تصفير)', validateOpening('supplier', 0).length === 0)
const cLines = buildOpeningDeltaEntry('customer', 50_000, 'عميل')
ok('قيد عميل: 1104 مدين / 3101 دائن ومتوازن', balanced(cLines) && cLines[0].accountCode === '1104' && cLines[1].accountCode === '3101')
const cDown = buildOpeningDeltaEntry('customer', -20_000, 'تخفيض')
ok('تخفيض رصيد عميل يعكس الاتجاه', balanced(cDown) && cDown[0].accountCode === '3101' && cDown[1].accountCode === '1104')
const sLines = buildOpeningDeltaEntry('supplier', 30_000, 'مورد')
ok('قيد مورد: 3101 مدين / 2101 دائن', balanced(sLines) && sLines[0].accountCode === '3101' && sLines[1].accountCode === '2101')
const tLines = buildOpeningDeltaEntry('treasury', 80_000, 'خزينة', '1101')
ok('قيد خزينة: كود الخزينة مدين / 3101 دائن', balanced(tLines) && tLines[0].accountCode === '1101' && tLines[1].accountCode === '3101')
ok('فرق صفر = لا قيد', buildOpeningDeltaEntry('customer', 0, 'x').length === 0)
throws('خزينة بلا كود تُرفض', () => buildOpeningDeltaEntry('treasury', 100, 'x'), 'كود')

console.log('\n2️⃣ الأرصدة الافتتاحية في المخزن (repo)')
S().addCustomer({ nameAr: 'عميل قديم', phone: '', creditLimitMinor: 0, notes: '' })
S().addSupplier({ nameAr: 'مورد قديم', phone: '', notes: '' })
const cust = S().customers.at(-1), sup = S().suppliers.at(-1)
S().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 50_000, label: cust.nameAr })
ok('رصيد العميل الافتتاحي سُجّل', S().openingBalances[openingKey('customer', cust.id)] === 50_000)
ok('1104 زاد 50,000', sumAcc('1104') === 50_000)
const capAfterFirst = sumAcc('3101')
S().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 30_000, label: cust.nameAr })
ok('التعديل رحّل الفرق فقط: 1104 صار 30,000', sumAcc('1104') === 30_000)
ok('قيدا إثبات + تعديل (لا مسح قيود)', S().journal.filter((e) => e.description.includes('رصيد افتتاحي')).length === 2)
ok('رأس المال تحرك بالفرق −20,000', sumAcc('3101') === capAfterFirst + 20_000) // 3101 دائن: التخفيض مدين
const jBefore = S().journal.length
S().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 30_000, label: cust.nameAr })
ok('نفس الرصيد = لا قيد جديد', S().journal.length === jBefore)
throws('معرّف شبح يُرفض (درس mobileshop)', () => S().setOpeningBalance({ kind: 'customer', refId: 9999, amountMinor: 100, label: 'x' }), 'غير موجود')
S().setOpeningBalance({ kind: 'supplier', refId: sup.id, amountMinor: 40_000, label: sup.nameAr })
ok('مورد افتتاحي: 2101 دائن 40,000', sumAcc('2101') === -40_000)
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 100_000, label: 'الخزينة' })
ok('خزينة افتتاحية: 1101 زاد 100,000', sumAcc('1101') === 100_000)

console.log('\n3️⃣ نواة التسويات الشاملة')
ok('عدّ خزينة سالب يُرفض', validateSettlement({ section: 'treasury', bookMinor: 0, actualMinor: -1, treasuryCode: '1101', reason: 'x' }).some((e) => e.includes('سالبة')))
ok('رصيد عميل سالب مقبول (دفعة مقدمة)', validateSettlement({ section: 'customer', bookMinor: 0, actualMinor: -5_000, reason: 'مقدم' }).length === 0)
ok('بلا سبب يُرفض', validateSettlement({ section: 'treasury', bookMinor: 0, actualMinor: 0, treasuryCode: '1101', reason: ' ' }).some((e) => e.includes('سبب')))
const shortage = { section: 'treasury', bookMinor: 100_000, actualMinor: 95_000, treasuryCode: '1101', reason: 'جرد' }
ok('الفرق = −5,000', settlementVariance(shortage) === -5_000)
const shLines = buildSettlementEntry(shortage)
ok('عجز الخزينة يضرب 5112 مديناً (لا يتبخر)', balanced(shLines) && shLines[0].accountCode === '5112' && shLines[0].debit === 5_000 && shLines[1].accountCode === '1101')
const over = buildSettlementEntry({ section: 'treasury', bookMinor: 100_000, actualMinor: 102_000, treasuryCode: '1101', reason: 'زيادة' })
ok('زيادة الخزينة: الخزينة مدينة و5112 دائن', balanced(over) && over[0].accountCode === '1101' && over[1].accountCode === '5112')
const writeOff = buildSettlementEntry({ section: 'customer', bookMinor: 30_000, actualMinor: 25_000, reason: 'إعدام' })
ok('إعدام دين عميل: 5112 مدين / 1104 دائن', balanced(writeOff) && writeOff[0].accountCode === '5112' && writeOff[1].accountCode === '1104')
const supUp = buildSettlementEntry({ section: 'supplier', bookMinor: 40_000, actualMinor: 45_000, reason: 'فرق مكتشف' })
ok('زيادة دين مورد: 5112 مدين / 2101 دائن', balanced(supUp) && supUp[0].accountCode === '5112' && supUp[1].accountCode === '2101')
ok('لا فرق = لا قيد', buildSettlementEntry({ section: 'customer', bookMinor: 10, actualMinor: 10, reason: 'x' }).length === 0)
ok('حساب 5112 موجود بالشجرة', STANDARD_COA.some((a) => a.code === '5112' && a.systemKey === 'settlement_variance'))

console.log('\n4️⃣ التسويات في المخزن (repo)')
const doc1 = S().applySettlement({ section: 'treasury', refId: '1101', actualMinor: 95_000, reason: 'جرد نهاية الشهر' })
ok('مستند SET-0001 والفرق −5,000', doc1.settlementNumber === 'SET-0001' && doc1.varianceMinor === -5_000)
ok('رصيد 1101 الدفتري صار 95,000', sumAcc('1101') === 95_000)
ok('5112 تحمّل العجز 5,000', sumAcc('5112') === 5_000)
ok('القيد مربوط بالمستند', S().journal.some((e) => e.id === doc1.journalEntryId && e.sourceType === 'adjustment' && e.sourceId === doc1.id))
throws('عدّ سالب يُرفض في repo', () => S().applySettlement({ section: 'treasury', refId: '1101', actualMinor: -1, reason: 'x' }), 'سالبة')
throws('خزينة شبح تُرفض', () => S().applySettlement({ section: 'treasury', refId: '9999', actualMinor: 0, reason: 'x' }), 'غير موجود')
const doc2 = S().applySettlement({ section: 'customer', refId: cust.id, actualMinor: 25_000, reason: 'اتفاق خصم' })
ok('تسوية عميل: دفتري 30,000 → فعلي 25,000', doc2.bookMinor === 30_000 && doc2.varianceMinor === -5_000)
ok('1104 صار 25,000', sumAcc('1104') === 25_000)
const doc3 = S().applySettlement({ section: 'supplier', refId: sup.id, actualMinor: 45_000, reason: 'فرق فاتورة قديمة' })
ok('تسوية مورد: 2101 صار 45,000 دائناً', doc3.varianceMinor === 5_000 && sumAcc('2101') === -45_000)
const match = S().applySettlement({ section: 'customer', refId: cust.id, actualMinor: 25_000, reason: 'مطابقة دورية' })
ok('مطابقة تامة = مستند بلا قيد', match.varianceMinor === 0 && match.journalEntryId === null)
ok('التسوية التالية ترى أثر السابقة (لا تراكم مضاعف)', match.bookMinor === 25_000)

console.log('\n5️⃣ تكامل الكشوف')
const custRows = customerStatement({
  customerId: cust.id, openingMinor: 30_000,
  sales: [], saleReturns: [], allSales: [], vouchers: [], cheques: [],
  adjustments: [{ docLabel: 'تسوية SET-0002', date: '2026-09-15', debitMinor: 0, creditMinor: 5_000 }],
})
ok('كشف العميل: افتتاحي + تسوية = رصيد 25,000', statementBalance(custRows) === 25_000)
ok('أول صف بالكشف هو الافتتاحي', custRows[0].docLabel === 'رصيد افتتاحي' && custRows[0].debitMinor === 30_000)
const supRows = supplierStatement({
  supplierId: sup.id, openingMinor: 40_000,
  purchases: [], purchaseReturns: [], allPurchases: [], vouchers: [], cheques: [],
  adjustments: [{ docLabel: 'تسوية SET-0003', date: '2026-09-15', debitMinor: 0, creditMinor: 5_000 }],
})
ok('كشف المورد: افتتاحي 40,000 + تسوية 5,000 = 45,000 دائن', statementBalance(supRows) === -45_000 || statementBalance(supRows) === 45_000)
// ميزان متزن إجمالاً
const totals = S().journal.flatMap((e) => e.lines).reduce((a, l) => a + l.debit - l.credit, 0)
ok('كل القيود متوازنة إجمالاً', totals === 0)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
