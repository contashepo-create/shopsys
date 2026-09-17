/**
 * فحص البيع بالأمانة (معارض السيارات): سيارة ملك الغير لا تدخل المخزون،
 * بيعها يولد التزاماً للمالك (2110) وعمولة معرض (4109)، وسداد المالك يطفئ
 * الالتزام — مع ضريبة على العمولة فقط، ورفض كل الحالات الشاذة.
 * تشغيل: node --experimental-strip-types scripts/verify_consignment.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('🤝 استلام سيارة أمانة — بلا قيد وبلا مخزون')
const journalBefore = S().journal.length
const cg = S().addConsignmentCar({ make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'س ن د 1234', ownerName: 'أ/ حسن', ownerPhone: '0100', ownerNetMinor: 80_000_000, askingPriceMinor: 85_000_000 })
ok('سُجلت معروضة', cg.status === 'available')
ok('لا قيد عند الاستلام', S().journal.length === journalBefore)
ok('1103 لم يتحرك (ليست مخزونك)', bal('1103') === 0)
throws('لوحة مكررة تُرفض', () => S().addConsignmentCar({ make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'س ن د 1234', ownerName: 'آخر', ownerNetMinor: 1, askingPriceMinor: 2 }), 'مسجلة بالفعل')
throws('بلا اسم مالك تُرفض', () => S().addConsignmentCar({ make: 'كيا', model: 'ريو', year: 2021, plateOrVin: 'ق ق ق 1', ownerName: ' ', ownerNetMinor: 1, askingPriceMinor: 2 }), 'المالك مطلوب')
throws('عرض أقل من صافي المالك يُرفض', () => S().addConsignmentCar({ make: 'كيا', model: 'ريو', year: 2021, plateOrVin: 'ق ق ق 2', ownerName: 'ب', ownerNetMinor: 100, askingPriceMinor: 50 }), 'لا يقل')

console.log('💰 بيع الأمانة نقداً')
const sold = S().sellConsignmentCar({ id: cg.id, salePriceMinor: 86_000_000, payment: 'cash', buyerName: 'م/ كريم', treasury: '1101' })
ok('الحالة sold وعمولة 60 ألف', sold.status === 'sold' && sold.commissionMinor === 6_000_000)
ok('الخزينة استلمت 860 ألف', bal('1101') === 86_000_000)
ok('التزام المالك 2110 = 800 ألف', bal('2110') === -80_000_000)
ok('عمولة المعرض 4109 = 60 ألف', bal('4109') === -6_000_000)
ok('لا مبيعات في 4101 (ليست بضاعتك)', bal('4101') === 0)
throws('بيع مرة ثانية يُرفض', () => S().sellConsignmentCar({ id: cg.id, salePriceMinor: 1, payment: 'cash' }), 'ليست معروضة')

console.log('🏦 سداد المالك')
S().payConsignmentOwner(cg.id, '1101')
ok('أُطفئ 2110', bal('2110') === 0)
ok('الخزينة صافيها العمولة فقط', bal('1101') === 6_000_000)
ok('الحالة paid', S().consignmentCars.find((c) => c.id === cg.id).status === 'paid')
throws('سداد مكرر يُرفض', () => S().payConsignmentOwner(cg.id), 'لا مستحق')

console.log('🧾 بيع آجل بضريبة على العمولة')
const cg2 = S().addConsignmentCar({ make: 'هيونداي', model: 'إلنترا', year: 2023, plateOrVin: 'م م م 99', ownerName: 'أ/ منى', ownerNetMinor: 90_000_000, askingPriceMinor: 100_000_000 })
// سياسة ربط المشتري (طلب المالك): الآجل يتطلب مشترياً من سجل العملاء — ذمته تُتتبع بكشفه
throws('الآجل بلا مشترٍ مسجل يُرفض', () => S().sellConsignmentCar({ id: cg2.id, salePriceMinor: 101_500_000, vatPercentOnCommission: 15, payment: 'credit', buyerName: 'شركة نقل' }), 'سجل العملاء')
S().addCustomer({ nameAr: 'شركة نقل', phone: '0100', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const buyerCo = S().customers.at(-1)
const sold2 = S().sellConsignmentCar({ id: cg2.id, salePriceMinor: 101_500_000, vatPercentOnCommission: 15, payment: 'credit', buyerCustomerId: buyerCo.id })
ok('المشتري مرتبط بسجل العملاء واسمه من السجل', sold2.buyerCustomerId === buyerCo.id && sold2.buyerName === 'شركة نقل')
ok('ذمة البيع في رصيد المشتري', S().getCustomerBalance(buyerCo.id) === 101_500_000)
// عمولة إجمالية 11.5م تشمل الضريبة: صافي 10م + ضريبة 1.5م
ok('العمولة الصافية 10م والضريبة 1.5م', sold2.commissionMinor === 10_000_000 && sold2.vatOnCommissionMinor === 1_500_000)
ok('العملاء مدينون بسعر البيع كاملاً', bal('1104') === 101_500_000)
ok('2102 على العمولة فقط', bal('2102') === -1_500_000)
throws('سعر أقل من صافي المالك يُرفض', () => {
  const c3 = S().addConsignmentCar({ make: 'فيات', model: 'تيبو', year: 2020, plateOrVin: 'ف ف 5', ownerName: 'ج', ownerNetMinor: 50_000_000, askingPriceMinor: 55_000_000 })
  S().sellConsignmentCar({ id: c3.id, salePriceMinor: 40_000_000, payment: 'cash' })
}, 'أقل من صافي')

console.log('↩️ رد الأمانة دون بيع')
const c4 = S().addConsignmentCar({ make: 'شيفروليه', model: 'أوبترا', year: 2019, plateOrVin: 'ش ش 7', ownerName: 'د', ownerNetMinor: 30_000_000, askingPriceMinor: 33_000_000 })
S().returnConsignmentCar(c4.id)
ok('رُدت returned بلا أي قيد', S().consignmentCars.find((c) => c.id === c4.id).status === 'returned')
throws('بيع سيارة مردودة يُرفض', () => S().sellConsignmentCar({ id: c4.id, salePriceMinor: 33_000_000, payment: 'cash' }), 'ليست معروضة')
throws('رد سيارة مباعة يُرفض', () => S().returnConsignmentCar(cg2.id), 'معروضة')
// اللوحة المردودة تُقبل من جديد (عادت لمالكها وقد تعود للعرض)
const c5 = S().addConsignmentCar({ make: 'شيفروليه', model: 'أوبترا', year: 2019, plateOrVin: 'ش ش 7', ownerName: 'د', ownerNetMinor: 30_000_000, askingPriceMinor: 32_000_000 })
ok('إعادة عرض سيارة مردودة بنفس اللوحة مقبولة', c5.status === 'available')

console.log('⚖️ الميزان')
ok('الدفتر متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 البيع بالأمانة كامل: لا مخزون للغير، عمولة 4109، التزام مالك 2110 يُطفأ بالسداد')
