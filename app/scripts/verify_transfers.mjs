// تحقق التحويلات المخزنية (استكمال المرحلة 3):
// computeWarehouseStock (اشتقاق أرصدة المخازن)، validateTransfer، transferTotalQty
// التشغيل: node --experimental-strip-types scripts/verify_transfers.mjs
import {
  computeWarehouseStock,
  validateTransfer,
  transferTotalQty,
} from '../src/core/transfers.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const items = [
  { id: 1, stockQty: 100 },
  { id: 2, stockQty: 5.5 }, // صنف وزني
]
const warehouses = [
  { id: 1, isMain: true },
  { id: 2, isMain: false },
  { id: 3, isMain: false },
]

console.log('— computeWarehouseStock —')
const s0 = computeWarehouseStock(items, warehouses, [])
check('بلا تحويلات: كل الرصيد في الرئيسي', s0.get(1).get(1) === 100 && s0.get(1).get(2) === 5.5)
check('بلا تحويلات: الفرعية صفرية', (s0.get(2).get(1) ?? 0) === 0 && (s0.get(3).get(1) ?? 0) === 0)

const transfers = [
  { fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 30 }] },
  { fromWarehouseId: 2, toWarehouseId: 3, lines: [{ itemId: 1, qty: 10 }] },
  { fromWarehouseId: 1, toWarehouseId: 3, lines: [{ itemId: 2, qty: 2.5 }] },
]
const s1 = computeWarehouseStock(items, warehouses, transfers)
check('الرئيسي بعد التحويلات: 100−30=70', s1.get(1).get(1) === 70)
check('فرعي 2: وارد 30 − صادر 10 = 20', s1.get(2).get(1) === 20)
check('فرعي 3: وارد 10', s1.get(3).get(1) === 10)
check('الوزني: الرئيسي 3 وفرعي 3 فيه 2.5', s1.get(1).get(2) === 3 && s1.get(3).get(2) === 2.5)
check('مجموع الأرصدة = الرصيد الكلي', [1, 2, 3].reduce((a, w) => a + (s1.get(w).get(1) ?? 0), 0) === 100)

// مخزن محذوف تاريخياً في السجل — يُتجاهل بأمان
const sGone = computeWarehouseStock(items, warehouses, [{ fromWarehouseId: 1, toWarehouseId: 99, lines: [{ itemId: 1, qty: 10 }] }])
check('تحويل لمخزن غير موجود يُتجاهل', sGone.get(1).get(1) === 100)
// لا مخزن رئيسي (حالة شاذة) — لا انهيار
const sNoMain = computeWarehouseStock(items, [{ id: 2, isMain: false }], transfers)
check('بلا مخزن رئيسي: خرائط فارغة بلا انهيار', (sNoMain.get(2)?.get(1) ?? 0) === 0)

console.log('— validateTransfer —')
const avail = (itemId) => s1.get(1).get(itemId) ?? 0 // المتاح في الرئيسي: صنف1=70، صنف2=3
const ok = { fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 50 }] }
check('تحويل سليم بلا أخطاء', validateTransfer(ok, avail).length === 0)
check('يرفض نفس المخزن', validateTransfer({ ...ok, toWarehouseId: 1 }, avail).some((e) => e.includes('مختلفين')))
check('يرفض بلا أسطر', validateTransfer({ ...ok, lines: [] }, avail).some((e) => e.includes('صنفاً')))
check('يرفض كمية صفرية', validateTransfer({ ...ok, lines: [{ itemId: 1, qty: 0 }] }, avail).length === 1)
check('يرفض كمية سالبة', validateTransfer({ ...ok, lines: [{ itemId: 1, qty: -3 }] }, avail).length === 1)
check('يرفض تجاوز المتاح', validateTransfer({ ...ok, lines: [{ itemId: 1, qty: 71 }] }, avail).some((e) => e.includes('تتجاوز')))
check('يقبل كامل المتاح بالضبط', validateTransfer({ ...ok, lines: [{ itemId: 1, qty: 70 }] }, avail).length === 0)
check('يقبل كسور الوزني ضمن المتاح', validateTransfer({ ...ok, lines: [{ itemId: 2, qty: 2.999 }] }, avail).length === 0)
check('يرفض تجاوز الوزني', validateTransfer({ ...ok, lines: [{ itemId: 2, qty: 3.001 }] }, avail).length === 1)
check('يرفض صنفاً مكرراً', validateTransfer({ ...ok, lines: [{ itemId: 1, qty: 10 }, { itemId: 1, qty: 5 }] }, avail).some((e) => e.includes('مكرر')))
// دقة عائمة: 0.1+0.2 مقابل متاح 0.3
check('لا خطأ دقة عائمة (0.1+0.2 ≤ 0.3)', validateTransfer({ ...ok, lines: [{ itemId: 9, qty: 0.1 + 0.2 }] }, () => 0.3).length === 0)

console.log('— transferTotalQty —')
check('مجموع القطع', transferTotalQty([{ itemId: 1, qty: 3 }, { itemId: 2, qty: 1.5 }]) === 4.5)
check('تقريب لثلاث منازل', transferTotalQty([{ itemId: 1, qty: 0.1 }, { itemId: 2, qty: 0.2 }]) === 0.3)

console.log(`\nالتحويلات: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
