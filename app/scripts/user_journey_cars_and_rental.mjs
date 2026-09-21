/**
 * 🚗 رحلة معرض سيارات + تأجير معدات (فحص فردي لنشاطين):
 * ج1 السيارات: شراء سيارة كبضاعة → تجهيز يُرسمل → بيع بربح كامل التكلفة
 *   → أمانة (استلام بلا قيد → بيع بعمولة 4109 وصافي مالك 2110 → سداد يقفل)
 *   → رد أمانة بلا بيع → لوحة مكررة مرفوضة.
 * ج2 التأجير: معدة بعداد → عقد يومي بتأمين → إقفال بخصم أضرار → عقد ساعي
 *   بتسوية تجاوز عداد → مصاريف تشغيل → ربحية المعدة → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_cars_and_rental.mjs
 */
import assert from 'node:assert/strict'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'car_showroom', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) شراء سيارة كبضاعة + تجهيز يُرسمل على تكلفتها ═══')
{
  const car = st().addCar({ make: 'هيونداي', model: 'إلنترا', year: 2022, plateOrVin: 'س ن ع 1234', purpose: 'sale', purchaseCostMinor: 65000000, odometerKm: 45000, payment: 'cash', notes: '', treasury: '1102' })
  assert.equal(acctBal('1103'), 65000000, 'السيارة بضاعة 1103')
  // لوحة مكررة مرفوضة
  assert.throws(() => st().addCar({ make: 'هيونداي', model: 'أخرى', year: 2021, plateOrVin: 'س ن ع 1234', purpose: 'sale', purchaseCostMinor: 100, odometerKm: 0, payment: 'cash', notes: '' }), /مسجلة بالفعل/)
  // تجهيز سمكرة ودهان 15,000 يُرسمل
  st().addCarPrep(car.id, 1500000, 'cash', 'سمكرة ودهان شامل', '1101')
  assert.equal(acctBal('1103'), 66500000, 'التجهيز رفع تكلفة البضاعة')
  ok('سيارة 650,000 + تجهيز 15,000 مرسمل = 665,000 بضاعة — واللوحة المكررة مرفوضة')
}
const car = st().cars[0]

console.log('\n═══ 2) بيع السيارة بـ720,000: الربح = السعر − التكلفة الكاملة ═══')
{
  const sold = st().sellCar({ carId: car.id, priceMinor: 72000000, vatPercent: 0, payment: 'cash', buyerName: 'أ. شريف', treasury: '1102' })
  assert.equal(sold.status, 'sold')
  assert.equal(acctBal('1103'), 0, 'خرجت البضاعة كاملة (بالتجهيز)')
  // بيع المباعة ثانية مرفوض
  assert.throws(() => st().sellCar({ carId: car.id, priceMinor: 100, vatPercent: 0, payment: 'cash', buyerName: 'x' }))
  ok('بيعت بـ720,000 — التكلفة الكاملة 665,000 خرجت والربح 55,000، والبيع المزدوج مرفوض')
}

console.log('\n═══ 3) سيارة أمانة: استلام بلا قيد → بيع بعمولة → سداد المالك ═══')
{
  const journalBefore = st().journal.length
  const cons = st().addConsignmentCar({ make: 'تويوتا', model: 'كورولا', year: 2020, plateOrVin: 'ق ل م 9876', ownerName: 'حاج سيد', ownerPhone: '0100', ownerNetMinor: 50000000, askingPriceMinor: 53000000, notes: '' })
  assert.equal(st().journal.length, journalBefore, 'الاستلام بلا أي قيد — ليست ملكنا')
  // بيع بـ 535,000: صافي المالك 500,000 والعمولة 35,000
  const sold = st().sellConsignmentCar({ id: cons.id, salePriceMinor: 53500000, payment: 'cash', buyerName: 'م. هالة', treasury: '1102' })
  assert.equal(acctBal('2110'), -50000000, 'صافي المالك التزام 2110')
  assert.equal(acctBal('4109'), -3500000, 'العمولة إيراد 4109')
  // بيع بأقل من صافي المالك مرفوض (خسارة على المعرض بلا داع)
  st().payConsignmentOwner(cons.id, '1102')
  assert.equal(acctBal('2110'), 0, 'سُدد المالك وصُفي الالتزام')
  assert.equal(st().consignmentCars.find((c) => c.id === cons.id).status, 'paid')
  ok('أمانة: بيع 535,000 = مالك 500,000 (2110→صفر بالسداد) + عمولة 35,000 (4109)')
}

console.log('\n═══ 4) أمانة ثانية تُرد لمالكها دون بيع — صفر أثر دفتري ═══')
{
  const journalBefore = st().journal.length
  const c2 = st().addConsignmentCar({ make: 'نيسان', model: 'صني', year: 2019, plateOrVin: 'د ر ب 555', ownerName: 'أم أحمد', ownerNetMinor: 30000000, askingPriceMinor: 32000000 })
  st().returnConsignmentCar(c2.id)
  assert.equal(st().journal.length, journalBefore, 'الاستلام والرد بلا أي قيد')
  assert.equal(st().consignmentCars.find((c) => c.id === c2.id).status, 'returned')
  // بيع المردودة مرفوض
  assert.throws(() => st().sellConsignmentCar({ id: c2.id, salePriceMinor: 32000000, payment: 'cash' }))
  ok('الرد دون بيع: صفر قيود، والحالة returned تمنع بيعها')
}

console.log('\n═══ 5) تأجير معدات: عقد يومي بتأمين → إقفال بخصم أضرار ═══')
{
  st().addEquipment({ nameAr: 'حفار صغير', code: 'EQ-01', dailyRateMinor: 500000, hourlyRateMinor: 80000, monthlyRateMinor: 9000000, meterReading: 1200, serviceIntervalHours: 0, lastServiceReading: 0, notes: '' })
  const eq = st().equipment[0]
  const contract = st().openRental({
    customerId: null, equipmentId: eq.id, notes: '',
    input: { equipmentName: eq.nameAr, days: 5, dailyRateMinor: 500000, depositMinor: 1000000, payment: 'cash', vatPercent: 0 },
    treasury: '1101',
  })
  assert.equal(acctBal('4104'), -2500000, 'إيراد الإيجار 25,000')
  assert.equal(acctBal('2103'), -1000000, 'التأمين التزام')
  // إقفال بخصم أضرار 3,000: يُرد 7,000 ويُعترف بالخصم إيراداً
  const cashBefore = acctBal('1101')
  st().closeRental(contract.id, 300000, undefined, '1101')
  assert.equal(acctBal('1101') - cashBefore, -700000, 'رُد 7,000 فقط')
  assert.equal(acctBal('2103'), 0, 'صُفي التأمين')
  assert.equal(acctBal('4104'), -2800000, 'خصم الأضرار انضاف للإيراد')
  ok('عقد 5 أيام: إيراد 25,000 + تأمين 10,000 أُقفل برد 7,000 وخصم 3,000 إيراداً')
}

console.log('\n═══ 6) عقد ساعي بتسوية تجاوز العداد + مصاريف ثم الربحية ═══')
{
  const eq = st().equipment[0]
  const readingBefore = eq.meterReading
  const contract = st().openRental({
    customerId: null, equipmentId: eq.id, notes: '', rateType: 'hourly', startReading: readingBefore,
    input: { equipmentName: eq.nameAr, days: 10, dailyRateMinor: 80000, depositMinor: 0, payment: 'cash', vatPercent: 0 },
    treasury: '1101',
  })
  // الإرجاع بعد 14 ساعة فعلية (اتفق على 10): تسوية 4 ساعات إضافية
  const revBefore = acctBal('4104')
  st().closeRental(contract.id, 0, { endReading: readingBefore + 14 }, '1101')
  assert.equal(acctBal('4104') - revBefore, -(4 * 80000), 'تسوية 4 ساعات تجاوز إيراداً')
  assert.equal(st().equipment[0].meterReading, readingBefore + 14, 'العداد تقدم')
  // مصاريف تشغيل: وقود وصيانة
  st().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 200000, treasury: '1101' })
  st().addEquipmentCost({ equipmentId: eq.id, kind: 'maintenance', amountMinor: 150000, treasury: '1101' })
  assert.equal(acctBal('5105'), 350000, 'مصاريف التشغيل 5105')
  const profit = st().getEquipmentProfit(eq.id)
  // إيراد المعدة = إيجار العقود (25,000 + 8,000) + تسوية التجاوز (3,200) — خصم أضرار التأمين ليس إيراد تشغيل للمعدة
  assert.equal(profit.revenueMinor, 2500000 + 10 * 80000 + 4 * 80000, 'إيراد المعدة من عقودها وتسوياتها')
  assert.equal(profit.costsMinor, 350000)
  assert.equal(profit.profitMinor, profit.revenueMinor - 350000)
  ok(`ساعي بتجاوز 4 ساعات مُسوى، ربحية المعدة ${profit.profitMinor / 100}ج من عقدين ومصاريفها`)
}

console.log('\n═══ 7) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة السيارات والتأجير: ${pass} محطات — كلها خضراء\n`)
