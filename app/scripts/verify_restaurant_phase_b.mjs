/**
 * تحقق سد فجوات تقرير النشاط #14 (مطعم/كافيه — دفعة ب):
 * ① `linesReduceExistingQty` + `markKitchenFired`: حذف/تقليل صنف بعد إرسال
 *    بون المطبخ مرفوض بلا سبب موثّق — ويمر بسبب ويُسجَّل بملاحظات الأمر.
 * ② `mergeRestaurantOrders` (عكس splitOrderLines): دمج أمرين مفتوحين في
 *    فاتورة واحدة — المصدر يُقفل بلا فاتورة والهدف يحمل كل الأصناف.
 * ③ `staleOpenOrders`: أمر مفتوح تجاوز عتبة الوقت يظهر في تنبيهات المطعم.
 * ④ لا تسريب صلاحية: وحدة «restaurant» الجديدة تُظهر `ops.activity.use` في
 *    شاشة الصلاحيات لمطعم/كافيه فقط — ولا تتسرب لبقالة رغم مشاركتها `recipes`.
 * تشغيل: node --experimental-strip-types scripts/verify_restaurant_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { staleOpenOrders, linesReduceExistingQty, mergeOrderLines } = await import('../src/core/restaurant.ts')
const { ACTIVITY_TEMPLATES, effectiveModules } = await import('../src/core/activities.ts')
const { permissionsForModules, PERMISSION_MODULE_MAP } = await import('../src/core/permissions.ts')
const { pathAllowedForSetup } = await import('../src/core/coaVisibility.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

const S = () => useDataStore.getState()
S().seed([])

console.log('— ① حذف/تقليل صنف بعد إرسال بون المطبخ يتطلب سبباً —')
const order = S().openRestaurantOrder({ type: 'dine_in', tableName: 'T1' })
ok(order.kitchenFiredAt === null, 'الأمر الجديد بلا طابع إرسال مطبخ')
const lineA = { itemId: 1, nameAr: 'كبسة', qty: 2, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }
S().setRestaurantOrderLines(order.id, [lineA])
// قبل الإرسال للمطبخ: تقليل الكمية حر بلا سبب
S().setRestaurantOrderLines(order.id, [{ ...lineA, qty: 1 }])
ok(S().restaurantOrders.find((o) => o.id === order.id).lines[0].qty === 1, 'تعديل حر قبل إرسال المطبخ')
S().setRestaurantOrderLines(order.id, [{ ...lineA, qty: 3 }])
S().markKitchenFired(order.id)
const fired = S().restaurantOrders.find((o) => o.id === order.id)
ok(fired.kitchenFiredAt != null, 'إرسال بون المطبخ يسجل الطابع الزمني')
const firedAtBefore = fired.kitchenFiredAt
S().markKitchenFired(order.id) // إرسال ثانٍ لا يغيّر الطابع
ok(S().restaurantOrders.find((o) => o.id === order.id).kitchenFiredAt === firedAtBefore, 'إرسال مكرر لا يحدّث الطابع')
ok(linesReduceExistingQty(fired.lines, [{ ...lineA, qty: 2 }]) === true, 'linesReduceExistingQty يكتشف تقليل الكمية')
ok(linesReduceExistingQty(fired.lines, [{ ...lineA, qty: 5 }]) === false, 'زيادة الكمية ليست حذفاً')
let threwNoReason = false
try { S().setRestaurantOrderLines(order.id, [{ ...lineA, qty: 2 }]) } catch { threwNoReason = true }
ok(threwNoReason, 'تقليل كمية بعد الإرسال بلا سبب مرفوض')
S().setRestaurantOrderLines(order.id, [{ ...lineA, qty: 2 }], 'العميل غيّر رأيه', 'المالك')
const afterVoid = S().restaurantOrders.find((o) => o.id === order.id)
ok(afterVoid.lines[0].qty === 2, 'بسبب موثّق: التعديل ينفذ')
ok(afterVoid.notes.includes('العميل غيّر رأيه') && afterVoid.notes.includes('المالك'), 'السبب والمعتمد يُسجَّلان بملاحظات الأمر')
// حذف صنف كاملاً بعد الإرسال أيضاً يُعامل كتقليل (Gap 1 يشمل الحذف لا التقليل فقط)
let threwRemoveNoReason = false
try { S().setRestaurantOrderLines(order.id, []) } catch { threwRemoveNoReason = true }
ok(threwRemoveNoReason, 'حذف صنف كاملاً بعد الإرسال بلا سبب مرفوض أيضاً')

console.log('— ② دمج أمرين مفتوحين (عكس التقسيم) —')
const orderB = S().openRestaurantOrder({ type: 'dine_in', tableName: 'T2' })
const orderC = S().openRestaurantOrder({ type: 'takeaway' })
S().setRestaurantOrderLines(orderB.id, [{ itemId: 10, nameAr: 'عصير', qty: 1, unitPriceMinor: 3000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }])
S().setRestaurantOrderLines(orderC.id, [
  { itemId: 10, nameAr: 'عصير', qty: 2, unitPriceMinor: 3000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false },
  { itemId: 20, nameAr: 'بطاطس', qty: 1, unitPriceMinor: 2500, unitCostMinor: 800, discountPercent: 0, soldByWeight: false },
])
let threwSameOrder = false
try { S().mergeRestaurantOrders(orderB.id, orderB.id) } catch { threwSameOrder = true }
ok(threwSameOrder, 'دمج أمر في نفسه مرفوض')
const merged = S().mergeRestaurantOrders(orderB.id, orderC.id)
ok(merged.lines.length === 2, 'الدمج يوحّد الصنف المشترك (عصير) بدل تكراره سطراً جديداً')
ok(merged.lines.find((l) => l.itemId === 10).qty === 3, 'كمية الصنف المشترك جُمعت: 1 + 2 = 3')
ok(merged.lines.find((l) => l.itemId === 20).qty === 1, 'الصنف غير المشترك انتقل كاملاً')
const sourceAfterMerge = S().restaurantOrders.find((o) => o.id === orderC.id)
ok(sourceAfterMerge.status === 'cancelled', 'الأمر المصدر أُقفل بعد الدمج بلا فاتورة منفصلة')
ok(merged.notes.includes(orderC.orderNumber), 'ملاحظة الدمج تذكر رقم الأمر المصدر')
let threwCancelledMerge = false
try { S().mergeRestaurantOrders(orderB.id, orderC.id) } catch { threwCancelledMerge = true }
ok(threwCancelledMerge, 'دمج أمر مصدر مُقفل بالفعل مرفوض')
ok(mergeOrderLines([{ itemId: 1, nameAr: 'أ', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 10, soldByWeight: false }], [{ itemId: 1, nameAr: 'أ', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 20, soldByWeight: false }]).length === 2,
  'اختلاف نسبة الخصم يمنع الدمج التلقائي للسطرين — يُضافان منفصلين')

console.log('— ③ تنبيه أوامر مفتوحة متأخرة —')
const now = new Date()
const mk = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60000).toISOString()
const stale1 = { id: 901, orderNumber: 'ORD-0901', type: 'dine_in', tableName: 'T9', deliveryInfo: '', lines: [], notes: '', status: 'open', openedAt: mk(100), settledAt: null, saleId: null, kitchenFiredAt: null }
const stale2 = { id: 902, orderNumber: 'ORD-0902', type: 'takeaway', tableName: '', deliveryInfo: '', lines: [], notes: '', status: 'open', openedAt: mk(50), settledAt: null, saleId: null, kitchenFiredAt: null }
const fresh = { id: 903, orderNumber: 'ORD-0903', type: 'dine_in', tableName: 'T3', deliveryInfo: '', lines: [], notes: '', status: 'open', openedAt: mk(5), settledAt: null, saleId: null, kitchenFiredAt: null }
const closed = { id: 904, orderNumber: 'ORD-0904', type: 'dine_in', tableName: 'T4', deliveryInfo: '', lines: [], notes: '', status: 'settled', openedAt: mk(200), settledAt: mk(1), saleId: 1, kitchenFiredAt: null }
const stale = staleOpenOrders([stale1, stale2, fresh, closed], now.toISOString(), 45)
ok(stale.length === 2, 'عتبة 45 دقيقة: أمران فقط متأخران (المُقفل والحديث مستبعدان)')
ok(stale[0].orderId === 901 && stale[0].minutesOpen >= 99, 'الأقدم أولاً (ترتيب تنازلي) وبدقائق صحيحة')
ok(stale[0].label === 'طاولة T9', 'تسمية طاولة الصالة من اسم الطاولة')
ok(stale[1].label.includes('تيك أواي') || stale[1].label.length > 0, 'تسمية غير الصالة من نوع الأمر')

console.log('— ④ صلاحية ops.activity.use: ظاهرة للمطعم وغير متسربة للبقالة —')
const restaurantModules = effectiveModules('restaurant', [])
const groceryModules = effectiveModules('grocery', [])
ok(restaurantModules.includes('restaurant'), 'نشاط المطعم يحمل وحدة restaurant الجديدة')
ok(!groceryModules.includes('restaurant') && groceryModules.includes('recipes'), 'البقالة تشارك recipes لكن بلا وحدة restaurant')
const restPerms = new Set(permissionsForModules(restaurantModules).map((p) => p.id))
const groPerms = new Set(permissionsForModules(groceryModules).map((p) => p.id))
ok(restPerms.has('ops.activity.use'), 'شاشة الصلاحيات تُظهر ops.activity.use لمطعم/كافيه')
ok(!groPerms.has('ops.activity.use'), 'لا تسريب لبقالة رغم مشاركة recipes (الفحص الذي كشف المشكلة أصلاً)')
ok(PERMISSION_MODULE_MAP['ops.activity.use'].includes('restaurant'), 'خريطة الصلاحية تربط ops.activity.use بوحدة restaurant')
ok(restPerms.has('sales.void.override'), 'صلاحية تجاوز حذف صنف بعد الإرسال مسجّلة ومتاحة للمطعم')

console.log('— ⑤ حراسة مسار /restaurant لا تسمح لنشاط آخر بالرابط المباشر —')
ok(pathAllowedForSetup('/restaurant/reports', restaurantModules, [], 'restaurant') === true, 'مطعم/كافيه يفتح مركز تقاريره')
const bakeryLikeModules = effectiveModules('bakery', [])
ok(pathAllowedForSetup('/restaurant/reports', bakeryLikeModules, [], 'bakery') === false, 'نشاط آخر (مخبز) بالرابط المباشر مرفوض رغم أي وحدات مشتركة')
ok(pathAllowedForSetup('/sales/restaurant-orders', restaurantModules, [], 'restaurant') === true, 'شاشة أوامر الطاولات مفتوحة للمطعم')

const allTemplatesHaveRestaurantRoleVisible = ACTIVITY_TEMPLATES.some((t) => t.id === 'restaurant')
ok(allTemplatesHaveRestaurantRoleVisible, 'نشاط مطعم/كافيه مسجَّل في قوالب الأنشطة')

console.log(`\n${FAIL === 0 ? '✅' : '❌'} سد فجوات تقرير النشاط #14: ${PASS} تحققاً نجح${FAIL ? ` — ${FAIL} فشل` : ''}\n`)
if (FAIL > 0) process.exit(1)
