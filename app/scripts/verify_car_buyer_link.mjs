/**
 * ربط مشتري السيارات بسجل العملاء (طلب المالك):
 * 1) بيع سيارة معرض آجلاً بلا مشترٍ مسجل ⇒ يُرفض (لا دين على مشترٍ غير مسجل)
 * 2) البيع الآجل لمشترٍ مسجل يمر — الذمة تظهر في كشف حسابه (getCustomerBalance)
 * 3) حد الائتمان يسري على بيع السيارة الآجل + التجاوز المعتمد
 * 4) بيع الأمانة الآجل: نفس القواعد + سداد المالك لا يتأثر
 * 5) النقدي يبقى حراً لمشترٍ عابر (buyerName حر بلا ربط)
 * 6) تحصيل دين السيارة بسند قبض يصفّر رصيد المشتري
 * 7) فحص نصي: CarsPage تعرض اختيار المشتري من السجل وتلتقط CreditLimitError
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'cars', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { CreditLimitError } = await import(join(root, 'src/core/pos.ts'))
const st = () => useDataStore.getState()

/* تجهيز: مشتريان — مقيد بحد 500 وحر */
st().addCustomer({ nameAr: 'مشترٍ مقيد', phone: '0100', address: '', notes: '', openingMinor: 0, creditLimitMinor: 50000 })
const bounded = st().customers.at(-1)
st().addCustomer({ nameAr: 'مشترٍ حر', phone: '0101', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const free = st().customers.at(-1)

/* سيارتا معرض بالنقد */
st().addCar({ make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'ق ن م 1234', purpose: 'sell', odometerKm: 50000, purchaseCostMinor: 40000, payment: 'cash', notes: '' })
const car1 = st().cars.at(-1)
st().addCar({ make: 'هيونداي', model: 'النترا', year: 2023, plateOrVin: 'س ص ع 5678', purpose: 'sell', odometerKm: 30000, purchaseCostMinor: 45000, payment: 'cash', notes: '' })
const car2 = st().cars.at(-1)

/* ═══ 1) الآجل بلا مشترٍ مسجل يُرفض ═══ */
assert.throws(
  () => st().sellCar({ carId: car1.id, priceMinor: 60000, vatPercent: 0, payment: 'credit', buyerName: 'شخص عابر' }),
  /سجل العملاء/,
)
ok('بيع سيارة آجل بلا مشترٍ من السجل — مرفوض برسالة واضحة (كان فجوة: دين بلا متابعة)')

/* ═══ 2) الآجل لمشترٍ مسجل: الذمة في كشفه ═══ */
{
  const balBefore = st().getCustomerBalance(free.id)
  const sold = st().sellCar({ carId: car1.id, priceMinor: 60000, vatPercent: 0, payment: 'credit', buyerName: '', buyerCustomerId: free.id })
  assert.equal(sold.buyerCustomerId, free.id)
  assert.equal(sold.buyerName, 'مشترٍ حر')
  ok('البيع الآجل لمشترٍ مسجل يمر — اسم المشتري يُؤخذ من السجل تلقائياً')
  const balAfter = st().getCustomerBalance(free.id)
  assert.equal(balAfter - balBefore, 60000)
  ok('ذمة السيارة 600 ظهرت في رصيد المشتري (كشف الحساب عبر customerUnitDocs)')
}

/* ═══ 3) حد الائتمان على بيع السيارة ═══ */
{
  assert.throws(
    () => st().sellCar({ carId: car2.id, priceMinor: 60000, vatPercent: 0, payment: 'credit', buyerName: '', buyerCustomerId: bounded.id }),
    (e) => e instanceof CreditLimitError,
  )
  ok('سيارة 600 آجلة لمشترٍ حده 500 — CreditLimitError')
  const sold = st().sellCar({ carId: car2.id, priceMinor: 60000, vatPercent: 0, payment: 'credit', buyerName: '', buyerCustomerId: bounded.id, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(sold.status, 'sold')
  ok('التجاوز المعتمد يبيع السيارة')
  // تحصيل الدين يصفّر الرصيد
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: 60000, treasury: '1101' })
  assert.equal(st().getCustomerBalance(bounded.id), 0)
  ok('سند قبض 600 يصفّر ذمة مشتري السيارة — الدورة كاملة')
}

/* ═══ 4) بيع الأمانة الآجل بنفس القواعد ═══ */
{
  st().addConsignmentCar({ make: 'كيا', model: 'سيراتو', year: 2021, plateOrVin: 'أ ب ج 9999', ownerName: 'صاحب الأمانة', ownerNetMinor: 50000, askingPriceMinor: 55000 })
  const cg = st().consignmentCars.at(-1)
  assert.throws(
    () => st().sellConsignmentCar({ id: cg.id, salePriceMinor: 55000, payment: 'credit' }),
    /سجل العملاء/,
  )
  ok('بيع أمانة آجل بلا مشترٍ مسجل — مرفوض')
  assert.throws(
    () => st().sellConsignmentCar({ id: cg.id, salePriceMinor: 55000, payment: 'credit', buyerCustomerId: bounded.id }),
    (e) => e instanceof CreditLimitError,
  )
  ok('أمانة 550 آجلة لمشترٍ حده 500 — CreditLimitError')
  const sold = st().sellConsignmentCar({ id: cg.id, salePriceMinor: 55000, payment: 'credit', buyerCustomerId: bounded.id, creditLimitOverrideBy: 'المدير سامي' })
  assert.equal(sold.buyerCustomerId, bounded.id)
  assert.equal(st().getCustomerBalance(bounded.id), 55000)
  ok('التجاوز المعتمد يبيع الأمانة والذمة 550 على المشتري في كشفه')
  // سداد صافي المالك لا يتأثر بربط المشتري
  st().payConsignmentOwner(cg.id)
  const paid = st().consignmentCars.find((c) => c.id === cg.id)
  assert.equal(paid.status, 'paid')
  ok('سداد صافي مالك الأمانة (2110 ← خزينة) سليم بعد الربط')
  st().receiveClientPayment({ customerId: bounded.id, amountMinor: 55000, treasury: '1101' })
}

/* ═══ 5) النقدي حر لمشترٍ عابر ═══ */
{
  st().addCar({ make: 'نيسان', model: 'صني', year: 2020, plateOrVin: 'د هـ و 1111', purpose: 'sell', odometerKm: 80000, purchaseCostMinor: 30000, payment: 'cash', notes: '' })
  const car3 = st().cars.at(-1)
  const sold = st().sellCar({ carId: car3.id, priceMinor: 99900000, vatPercent: 0, payment: 'cash', buyerName: 'عابر سبيل' })
  assert.equal(sold.buyerName, 'عابر سبيل')
  assert.equal(sold.buyerCustomerId, null)
  ok('البيع النقدي لمشترٍ عابر (اسم حر) يبقى حراً مهما بلغ — لا ذمة تنشأ')
}

/* ═══ 6) توازن الدفتر ═══ */
{
  const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`كل قيود الدفتر (${st().journal.length}) متوازنة بعد بيوع السيارات`)
}

/* ═══ 7) فحص نصي للواجهة والكشف ═══ */
{
  const page = readFileSync(join(root, 'src/ui/pages/CarsPage.tsx'), 'utf8')
  assert.ok(page.includes('buyerCustomerId') && page.includes('cgBuyerCustomerId'))
  assert.ok(page.includes("useSupervisorApproval('sales.credit.override')"))
  assert.ok(page.includes('CreditLimitError') && page.includes('creditApproval.dialog'))
  ok('CarsPage: اختيار المشتري من السجل (معرض + أمانة) + حوار تجاوز حد الائتمان')
  const stmts = readFileSync(join(root, 'src/core/statements.ts'), 'utf8')
  assert.ok(stmts.includes('بيع سيارة') && stmts.includes('بيع أمانة'))
  ok('customerUnitDocs: مستندا بيع السيارة والأمانة الآجلان في كشف حساب العميل')
  for (const f of ['src/ui/pages/StatementsPage.tsx', 'src/ui/pages/VouchersPage.tsx', 'src/ui/pages/SettlementsPage.tsx']) {
    assert.ok(readFileSync(join(root, f), 'utf8').includes('consignmentCars'), f)
  }
  ok('الكشوف الثلاثة (كشف حساب/سندات/تسويات) تمرر السيارات لكشف العميل')
}

console.log(`\n✅ verify_car_buyer_link: ${pass} تحققاً — مشتري السيارات عميل مسجل بذمة متتبعة وحد ائتمان سارٍ`)
