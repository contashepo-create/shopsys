/**
 * ✂️ فحص تقسيم الحساب في المطعم (نمط فودكس/Toast):
 * S1 النواة splitOrderLines: فصل سليم، رفض الكل/لا شيء/فهرس باطل/مكرر
 * S2 الدورة في repo: أمر صالة → تقسيم → أمران يُفوتران مستقلين بمجموع صحيح
 * S3 الحواف: الطاولة تُحرر فقط بعد قفل أمرها الأصلي، المقسوم من دليفري يبقى دليفري،
 *    لا تقسيم لأمر مقفول، مجموع الفاتورتين = مجموع الأمر الأصلي بالقرش
 *
 * تشغيل: node --experimental-strip-types scripts/verify_split_bill.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'restaurant', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { splitOrderLines, occupiedTables } = await import(join(root, 'src/core/restaurant.ts'))

const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log(`  ✓ ${n}`) }

console.log('\n═══ S1) النواة splitOrderLines ═══')
{
  const L = (name, qty, price) => ({ itemId: 1, nameAr: name, qty, unitPriceMinor: price, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })
  const lines = [L('كباب', 2, 9000), L('كفتة', 1, 7000), L('عصير', 3, 2000)]
  const { moved, remaining } = splitOrderLines(lines, [0, 2])
  assert.equal(moved.length, 2); assert.equal(remaining.length, 1)
  assert.equal(moved[0].nameAr, 'كباب'); assert.equal(remaining[0].nameAr, 'كفتة')
  // المكرر يُوحَّد
  const dup = splitOrderLines(lines, [1, 1])
  assert.equal(dup.moved.length, 1)
  // الرفض: لا شيء / الكل / فهرس باطل
  assert.throws(() => splitOrderLines(lines, []), /اختر/)
  assert.throws(() => splitOrderLines(lines, [0, 1, 2]), /ليس تقسيماً/)
  assert.throws(() => splitOrderLines(lines, [5]), /غير موجود/)
  assert.throws(() => splitOrderLines(lines, [-1]), /غير موجود/)
  assert.throws(() => splitOrderLines(lines, [0.5]), /غير موجود/)
  ok('فصل سليم + توحيد المكرر + 5 أنواع رفض')
}

console.log('\n═══ S2) الدورة الكاملة: طاولة → تقسيم → فاتورتان مستقلتان ═══')
{
  st().addItem({ nameAr: 'مشويات', categoryId: null, unit: 'طبق', priceMinor: 15000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  st().addItem({ nameAr: 'سلطة', categoryId: null, unit: 'طبق', priceMinor: 3000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  st().addItem({ nameAr: 'مياه', categoryId: null, unit: 'زجاجة', priceMinor: 1000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const [grill, salad, water] = st().items
  // مخزون عبر الشراء
  st().addSupplier({ nameAr: 'مورد المطعم', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  st().postPurchase({
    supplierId: st().suppliers[0].id, date: '2026-09-18', treasury: '1101', notes: '', expenses: [], paidMinor: 20 * 5000 + 20 * 1000 + 20 * 300,
    lines: [
      { itemId: grill.id, qty: 20, unitPriceMinor: 5000 },
      { itemId: salad.id, qty: 20, unitPriceMinor: 1000 },
      { itemId: water.id, qty: 20, unitPriceMinor: 300 },
    ],
  })
  // أمر طاولة 5 بثلاثة سطور
  const order = st().openRestaurantOrder({ type: 'dine_in', tableName: '5' })
  const cl = (it, qty) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: it.priceMinor, unitCostMinor: st().items.find((x) => x.id === it.id).costMinor, discountPercent: 0, soldByWeight: false })
  st().setRestaurantOrderLines(order.id, [cl(grill, 2), cl(salad, 2), cl(water, 4)])
  const originalTotal = 2 * 15000 + 2 * 3000 + 4 * 1000 // 40000
  // تقسيم: الطرف الثاني يدفع سلطة + مياه
  const child = st().splitRestaurantOrder(order.id, [1, 2])
  assert.equal(child.type, 'takeaway', 'المفصول من صالة = تيك أواي (لا يصطدم بحارس الطاولة)')
  assert.ok(child.notes.includes(order.orderNumber) && child.notes.includes('طاولة 5'), 'التتبع في البيان')
  assert.equal(child.lines.length, 2)
  const parent = st().restaurantOrders.find((o) => o.id === order.id)
  assert.equal(parent.lines.length, 1)
  assert.equal(parent.status, 'open')
  // الطاولة ما زالت مشغولة بالأمر الأصلي
  assert.ok(occupiedTables(st().restaurantOrders).has('5'), 'الطاولة مشغولة حتى قفل أمرها')
  // فوترة الأمرين مستقلين
  const sale1 = st().settleRestaurantOrder({ orderId: order.id, payment: 'cash', treasury: '1101', taxPercent: 0, taxInclusive: true })
  const sale2 = st().settleRestaurantOrder({ orderId: child.id, payment: 'cash', treasury: '1101', taxPercent: 0, taxInclusive: true })
  assert.equal(sale1.totals.totalMinor + sale2.totals.totalMinor, originalTotal, 'مجموع الفاتورتين = الأمر الأصلي بالقرش')
  assert.equal(sale2.totals.totalMinor, 2 * 3000 + 4 * 1000)
  // الطاولة تحررت بعد القفل
  assert.ok(!occupiedTables(st().restaurantOrders).has('5'), 'الطاولة حرة بعد قفل أمرها')
  // المخزون خُصم مرة واحدة صحيحة عبر الفاتورتين
  assert.equal(st().items.find((i) => i.id === grill.id).stockQty, 18)
  assert.equal(st().items.find((i) => i.id === salad.id).stockQty, 18)
  assert.equal(st().items.find((i) => i.id === water.id).stockQty, 16)
  ok('تقسيم كامل: أمران وفاتورتان بمجموع مضبوط، الطاولة تُدار صحيحاً، المخزون سليم')
}

console.log('\n═══ S3) الحواف: مقفول/دليفري/سطر واحد ═══')
{
  // لا تقسيم لأمر مقفول
  const settled = st().restaurantOrders.find((o) => o.status === 'settled')
  assert.throws(() => st().splitRestaurantOrder(settled.id, [0]), /مفتوح/)
  // دليفري مقسوم يبقى دليفري (ببيانات التوصيل نفسها)
  const [grill, salad] = st().items
  const dOrder = st().openRestaurantOrder({ type: 'delivery', deliveryInfo: 'أحمد — 0100 — المعادي' })
  const cl = (it, qty) => ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: it.priceMinor, unitCostMinor: st().items.find((x) => x.id === it.id).costMinor, discountPercent: 0, soldByWeight: false })
  st().setRestaurantOrderLines(dOrder.id, [cl(grill, 1), cl(salad, 1)])
  const dChild = st().splitRestaurantOrder(dOrder.id, [1])
  assert.equal(dChild.type, 'delivery')
  assert.equal(dChild.deliveryInfo, 'أحمد — 0100 — المعادي')
  // فصل السطر الوحيد الباقي مرفوض (الكل)
  assert.throws(() => st().splitRestaurantOrder(dOrder.id, [0]), /ليس تقسيماً/)
  // أمر غير موجود
  assert.throws(() => st().splitRestaurantOrder(9999, [0]), /غير موجود/)
  ok('مقفول يُرفض، دليفري يورث بياناته، فصل الكل يُرفض، أمر شبح يُرفض')
}

console.log(`\n✅ تقسيم الحساب: ${pass} تحققات — كلها خضراء\n`)
