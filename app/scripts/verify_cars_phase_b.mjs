/**
 * تحقق سد فجوات تقرير النشاط #13 (معرض سيارات — بيع وإيجار — دفعة ب):
 * ① `endCarRentalLife`: سيارة في التأجير تعود لمخزون البيع فتصبح قابلة
 *    للبيع من جديد (Gap 1 — مسار مقطوع سابقاً).
 * ② `sellCar` بمقايضة: قبول سيارة العميل القديمة كجزء من الثمن يضيفها
 *    فوراً كسيارة جديدة بمخزون المعرض بقيد واحد متوازن (Gap 2).
 * ③ `agingInventoryCars`: سيارة بالمعرض تجاوزت 60 يوماً تظهر كمتقادمة،
 *    وتصل للجرس المركزي (Gap 3).
 * ④ لا كود ميت: التوصيل الفعلي بالواجهة (CarsPage.tsx + Header.tsx).
 * تشغيل: node --experimental-strip-types scripts/verify_cars_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { agingInventoryCars } = await import('../src/core/cars.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

const S = () => useDataStore.getState()
S().seed([])
const acctBal = (code) => S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((a, l) => a + l.credit - l.debit, 0)

console.log('— ① إنهاء حياة التأجير وإعادة السيارة لمخزون البيع —')
const car1 = S().addCar({ make: 'تويوتا', model: 'هايلكس', year: 2021, plateOrVin: 'ر ص د 111', purpose: 'sale', purchaseCostMinor: 100_000_00, odometerKm: 5000, payment: 'cash', notes: '' })
S().moveCarToRental(car1.id, 50000, 1_000_000)
const rentingCar = S().cars.find((c) => c.id === car1.id)
ok(rentingCar.status === 'renting' && rentingCar.rentalEquipmentId != null, 'السيارة تحولت للتأجير وربطت بمعدة')
let threwSell = false
try { S().sellCar({ carId: car1.id, priceMinor: 120_000_00, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ' }) } catch { threwSell = true }
ok(threwSell, 'بيع سيارة مؤجرة لا يزال مرفوضاً قبل إنهاء التأجير')

const contract = S().openRental({
  customerId: null, equipmentId: rentingCar.rentalEquipmentId, notes: '',
  input: { equipmentName: rentingCar.make, days: 3, dailyRateMinor: 50000, depositMinor: 0, payment: 'cash', vatPercent: 0 },
  treasury: '1101',
})
let threwActiveEnd = false
try { S().endCarRentalLife(car1.id) } catch { threwActiveEnd = true }
ok(threwActiveEnd, 'إنهاء التأجير مرفوض أثناء وجود عقد نشط')
S().closeRental(contract.id, 0, undefined, '1101')
S().endCarRentalLife(car1.id)
const backInStock = S().cars.find((c) => c.id === car1.id)
ok(backInStock.status === 'in_stock' && backInStock.rentalEquipmentId == null, 'بعد إقفال العقد: السيارة عادت in_stock وفُكت من المعدة')
const sold1 = S().sellCar({ carId: car1.id, priceMinor: 120_000_00, vatPercent: 0, payment: 'cash', buyerName: 'مشترٍ بعد التأجير' })
ok(sold1.status === 'sold' && sold1.saleProfitMinor === 20_000_00, 'السيارة التي عادت من التأجير تُباع الآن بربحية صحيحة')
let threwReuse = false
try { S().endCarRentalLife(car1.id) } catch { threwReuse = true }
ok(threwReuse, 'إنهاء تأجير سيارة مباعة بالفعل مرفوض (ليست renting)')

console.log('— ② بيع بمقايضة سيارة قديمة —')
const car2 = S().addCar({ make: 'هيونداي', model: 'النترا', year: 2022, plateOrVin: 'س ع ل 222', purpose: 'sale', purchaseCostMinor: 300_000_00, odometerKm: 1000, payment: 'cash', notes: '' })
const carsBeforeTrade = S().cars.length
const journalBeforeTrade = S().journal.length
const sold2 = S().sellCar({
  carId: car2.id, priceMinor: 400_000_00, vatPercent: 0, payment: 'mixed', paidMinor: 250_000_00, buyerName: 'عميل مقايضة',
  tradeIn: { make: 'كيا', model: 'سيراتو', year: 2017, plateOrVin: 'م ن س 333', odometerKm: 80000, valuationMinor: 150_000_00 },
})
ok(sold2.status === 'sold' && sold2.salePaidMinor === 250_000_00, 'بيع السيارة الأصلية نجح بالمحصل النقدي المحدد فقط')
ok(S().cars.length === carsBeforeTrade + 1, 'سيارة المقايضة أُضيفت تلقائياً كسيارة جديدة بالمخزون')
const tradedCar = S().cars.find((c) => c.plateOrVin === 'م ن س 333')
ok(!!tradedCar && tradedCar.status === 'in_stock' && tradedCar.purchaseCostMinor === 150_000_00, 'سيارة المقايضة in_stock بقيمتها التقديرية كتكلفة شراء')
ok(tradedCar.purchaseEntryId === sold2.saleEntryId, 'سيارة المقايضة وسيارة البيع الأصلية على نفس القيد المركّب')
const tradeEntry = S().journal.find((e) => e.id === sold2.saleEntryId)
const dSum = tradeEntry.lines.reduce((a, l) => a + l.debit, 0), cSum = tradeEntry.lines.reduce((a, l) => a + l.credit, 0)
ok(dSum === cSum, 'قيد البيع بالمقايضة متوازن')
ok(tradeEntry.lines.some((l) => l.accountCode === '1103' && l.debit === 150_000_00), 'سطر مدين 1103 بقيمة سيارة المقايضة 150,000')
ok(S().journal.length === journalBeforeTrade + 1, 'قيد واحد فقط للبيع والمقايضة معاً')
// المحصل + المقايضة يتجاوز إجمالي البيع → رفض
let threwOver = false
try {
  S().sellCar({
    carId: tradedCar.id, priceMinor: 100_000_00, vatPercent: 0, payment: 'mixed', paidMinor: 50_000_00, buyerName: 'آخر',
    tradeIn: { make: 'أ', model: 'ب', year: 2015, plateOrVin: 'ط ي ك 999', odometerKm: 1, valuationMinor: 60_000_00 },
  })
} catch { threwOver = true }
ok(threwOver, 'محصل + مقايضة أكبر من إجمالي البيع مرفوض')
// لوحة مكررة بين سيارة موجودة وسيارة المقايضة مرفوضة
let threwDupPlate = false
try {
  S().sellCar({
    carId: tradedCar.id, priceMinor: 200_000_00, vatPercent: 0, payment: 'cash', buyerName: 'ثالث',
    tradeIn: { make: 'شيفروليه', model: 'أفيو', year: 2016, plateOrVin: 'ر ص د 111', odometerKm: 1, valuationMinor: 10_000_00 },
  })
} catch { threwDupPlate = true }
ok(threwDupPlate, 'لوحة مقايضة مكررة مع سيارة موجودة بالفعل مرفوضة')

console.log('— ③ سيارات متقادمة بالمخزون (Aging Inventory) —')
const oldDate = new Date(Date.now() - 75 * 86_400_000).toISOString().slice(0, 10)
const journalWithOldDate = S().journal.map((e) => (e.id === car2.id ? e : e))
// نُعدّل تاريخ قيد شراء car2 (الآن مباعة) — نستخدم سيارة ثالثة بدلاً من ذلك لتبقى in_stock
const car3 = S().addCar({ make: 'ميتسوبيشي', model: 'لانسر', year: 2020, plateOrVin: 'ج ف ل 444', purpose: 'sale', purchaseCostMinor: 200_000_00, odometerKm: 2000, payment: 'cash', notes: '' })
const journalAged = S().journal.map((e) => (e.id === car3.purchaseEntryId ? { ...e, date: oldDate } : e))
const aging = agingInventoryCars(S().cars, (id) => journalAged.find((e) => e.id === id)?.date ?? null, new Date().toISOString(), 60)
ok(aging.some((a) => a.carId === car3.id && a.daysInStock >= 75), 'سيارة بالمعرض منذ 75 يوماً تظهر كمتقادمة (عتبة 60)')
const freshCar = S().cars.find((c) => c.id === tradedCar.id)
ok(!aging.some((a) => a.carId === freshCar.id), 'سيارة المقايضة المضافة اليوم لا تظهر كمتقادمة')
ok(!aging.some((a) => a.carId === sold1.id), 'سيارة مباعة لا تظهر ضمن المتقادمة حتى لو قديمة')

console.log('— ④ لا كود ميت: التوصيل الفعلي بالواجهة —')
const { readFileSync } = await import('node:fs')
const carsPage = readFileSync(new URL('../src/ui/pages/CarsPage.tsx', import.meta.url), 'utf8')
ok(carsPage.includes('endCarRentalLife'), 'شاشة السيارات تستدعي endCarRentalLife')
ok(carsPage.includes('tradeIn:') && carsPage.includes('tradeInOn'), 'شاشة السيارات تعرض نموذج المقايضة وتمرره لـ sellCar')
const header = readFileSync(new URL('../src/ui/layout/Header.tsx', import.meta.url), 'utf8')
ok(header.includes('agingInventoryCars') && header.includes('agingCars:'), 'الجرس المركزي يستقبل سيارات المخزون المتقادم')
const notif = readFileSync(new URL('../src/core/notifications.ts', import.meta.url), 'utf8')
ok(notif.includes('caraging:'), 'منطق الإشعارات يولّد بنداً لكل سيارة متقادمة')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
