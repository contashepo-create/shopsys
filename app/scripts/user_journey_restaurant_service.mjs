/**
 * 🍽️ رحلة خدمة مطعم كاملة (الفحص الفردي لنشاط المطعم):
 * خامات → وصفة «عند الطلب» → طاولة تفتح أمراً (والمزدوج مرفوض) → أصناف تضاف
 * → تقسيم الحساب بين دافعَيْن → قفل بفاتورة برسوم خدمة 12% → خصم الخامات آلياً
 * → دليفري برسوم توصيل → أمر إنتاج مسبق (عصير) يرفع مخزون الناتج → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_restaurant_service.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'restaurant', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }

console.log('\n═══ 1) خامات + طبق بوصفة «عند الطلب» ═══')
{
  const mk = (nameAr, unit, price) => st().addItem({ nameAr, categoryId: null, unit, priceMinor: price, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  mk('فراخ نية', 'كجم', 0); mk('أرز خام', 'كجم', 0); mk('برتقال', 'كجم', 0)
  mk('طبق فراخ بالأرز', 'طبق', 12000); mk('عصير برتقال', 'كوب', 3000)
  const [chicken, rice, orange, dish, juice] = st().items
  st().addSupplier({ nameAr: 'مورد الخامات', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-19', treasury: '1101', notes: '', expenses: [], paidMinor: 0,
    lines: [{ itemId: chicken.id, qty: 20, unitPriceMinor: 12000 }, { itemId: rice.id, qty: 30, unitPriceMinor: 3000 }, { itemId: orange.id, qty: 25, unitPriceMinor: 2000 }] })
  // وصفة الطبق: 0.4 كجم فراخ + 0.25 كجم أرز = تكلفة 4800+750 = 5550
  st().addRecipe({ productItemId: dish.id, mode: 'made_to_order', yieldQty: 1, ingredients: [{ itemId: chicken.id, qty: 0.4 }, { itemId: rice.id, qty: 0.25 }], overheadMinor: 0, isActive: true, notes: '' })
  const unitCost = st().getRecipeUnitCost(st().recipes[0].id)
  assert.equal(unitCost, Math.round(0.4 * 12000 + 0.25 * 3000), 'تكلفة الطبق مشتقة من خاماته')
  ok(`وصفة الطبق: تكلفة آلية ${unitCost / 100}ج من الفراخ والأرز`)
}
const [chicken, rice, orange, dish, juice] = st().items

console.log('\n═══ 2) طاولة 3 تفتح أمراً — والمزدوج على نفس الطاولة مرفوض ═══')
{
  const order = st().openRestaurantOrder({ type: 'dine_in', tableName: '3' })
  assert.throws(() => st().openRestaurantOrder({ type: 'dine_in', tableName: '3' }), /مفتوح بالفعل/)
  // صالة بلا طاولة مرفوضة، ودليفري بلا بيانات مرفوض
  assert.throws(() => st().openRestaurantOrder({ type: 'dine_in', tableName: '' }), /حدد الطاولة/)
  assert.throws(() => st().openRestaurantOrder({ type: 'delivery', deliveryInfo: '' }), /التوصيل/)
  // 3 أطباق + 2 عصير على الأمر
  const cl = (it, qty) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: it.priceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })
  st().setRestaurantOrderLines(order.id, [cl(dish, 3), cl(juice, 2)])
  assert.equal(st().restaurantOrders[0].lines.length, 2)
  // قبل القفل: لا شيء لمس الدفاتر ولا المخزون
  assert.equal(st().sales.length, 0)
  assert.equal(st().items.find(i => i.id === chicken.id).stockQty, 20, 'الفراخ كاملة قبل الفوترة')
  ok('أمر الطاولة مفتوح بلا أي أثر دفتري، والحُراس الثلاثة يعملون')
}

console.log('\n═══ 3) تقسيم الحساب: صديق يدفع العصيرين منفرداً ═══')
{
  const order = st().restaurantOrders[0]
  const child = st().splitRestaurantOrder(order.id, [1]) // سطر العصير
  assert.equal(child.lines[0].nameAr, 'عصير برتقال')
  assert.equal(st().restaurantOrders.find(o => o.id === order.id).lines.length, 1, 'بقي الطبق فقط')
  // العصير بلا وصفة بعد — بيعه يحتاج مخزوناً؛ أمر إنتاج مسبق أولاً
  st().addRecipe({ productItemId: juice.id, mode: 'prepped', yieldQty: 10, ingredients: [{ itemId: orange.id, qty: 3 }], overheadMinor: 500, isActive: true, notes: 'تشغيلة عصير' })
  const prod = st().postProduction({ recipeId: st().recipes[1].id, batches: 1 })
  assert.equal(st().items.find(i => i.id === juice.id).stockQty, 10, 'الإنتاج أدخل 10 أكواب')
  assert.equal(st().items.find(i => i.id === orange.id).stockQty, 22, 'استهلك 3 كجم برتقال')
  const juiceCost = st().items.find(i => i.id === juice.id).costMinor
  assert.equal(juiceCost, Math.round((3 * 2000 + 500) / 10), 'تكلفة الكوب = (خامات+تشغيل)÷الناتج')
  // قفل فاتورة الصديق (العصيران)
  const sale = st().settleRestaurantOrder({ orderId: child.id, payment: 'cash', treasury: '1101', taxPercent: 14, taxInclusive: true })
  assert.equal(sale.totals.totalMinor, 6000, 'فاتورة الصديق = كوبان بـ60ج شاملة')
  assert.equal(st().items.find(i => i.id === juice.id).stockQty, 8, 'خُصم كوبان من الجاهز')
  ok(`تقسيم + إنتاج مسبق: كوب العصير بتكلفة ${juiceCost / 100}ج، وفاتورة الصديق 60ج`)
}

console.log('\n═══ 4) قفل الطاولة برسوم خدمة 12% — الخامات تُخصم آلياً ═══')
{
  const order = st().restaurantOrders[0]
  const chickenBefore = st().items.find(i => i.id === chicken.id).stockQty
  const sale = st().settleRestaurantOrder({ orderId: order.id, payment: 'cash', treasury: '1101', taxPercent: 14, taxInclusive: true, serviceChargePercent: 12 })
  // 3 أطباق × 120 = 360 + خدمة 12% = 43.2 ⇒ 403.2
  assert.equal(sale.totals.totalMinor, 36000 + Math.round(36000 * 0.12), 'الإجمالي مع رسوم الخدمة')
  assert.equal(st().items.find(i => i.id === chicken.id).stockQty, chickenBefore - 1.2, 'خُصم 1.2 كجم فراخ (3×0.4) لحظة الفوترة')
  assert.equal(st().items.find(i => i.id === rice.id).stockQty, 30 - 0.75, 'و0.75 كجم أرز')
  // الطاولة تحررت
  const { occupiedTables } = await import(join(root, 'src/core/restaurant.ts'))
  assert.ok(!occupiedTables(st().restaurantOrders).has('3'))
  ok('قفل الطاولة: 403.2ج برسوم خدمة، الخامات خُصمت بالوصفة لحظة الفوترة فقط')
}

console.log('\n═══ 5) دليفري برسوم توصيل + الميزان ═══')
{
  const d = st().openRestaurantOrder({ type: 'delivery', deliveryInfo: 'سارة — 0111 — مدينة نصر' })
  const cl = (it, qty) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: it.priceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })
  st().setRestaurantOrderLines(d.id, [cl(dish, 1)])
  const sale = st().settleRestaurantOrder({ orderId: d.id, payment: 'cash', treasury: '1101', taxPercent: 14, taxInclusive: true, deliveryFeeMinor: 2000 })
  assert.equal(sale.totals.totalMinor, 12000 + 2000, 'طبق + 20ج توصيل')
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`دليفري 140ج بتوصيله، ${st().journal.length} قيداً متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة المطعم الكاملة: ${pass} محطات — كلها خضراء\n`)
