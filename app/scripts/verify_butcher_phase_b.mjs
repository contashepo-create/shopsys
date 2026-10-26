/**
 * تحقق سد فجوة تقرير النشاط #17 (جزارة ولحوم — دفعة ب):
 * ① سد فجوة «Batch & Lot Traceability» — أهم ميزة متفق عليها بإجماع في كل
 *    برامج الجزارة المتخصصة (CleanCloud/Cleaver/stockflowsystems… راجع البحث):
 *    postProcessing كانت تُدخل النواتج للمخزون بلا أي دفعة صلاحية أو رقم
 *    تشغيلة رغم تفعيل ميزة expiry_batches للنشاط — فتفشل تنبيهات «قارب على
 *    الانتهاء» وتضيع إمكانية تتبع أي بلاغ صحي/سحب منتج للمصدر (الذبيحة).
 * ② التصميم: تاريخ انتهاء لكل ناتج على حدة (المفروم صلاحيته أقصر من الريش
 *    رغم نفس الذبيحة ونفس يوم التقطيع) + رقم تشغيلة واحد مشترك لكل نواتج
 *    الأمر (كلها من نفس مصدر/ذبيحة واحدة) — بنفس عقد postProduction تماماً.
 * ③ الفجوة مشتركة فعلياً مع النشاط #18 (تمور) لأن postProcessing/processing.ts
 *    نواة واحدة بلا تفرع — الإصلاح هنا يسري تلقائياً هناك (مُثبت في
 *    verify_butcher_dates.mjs لقسم التمور).
 * ④ تحقق توافق الإصدارات القديمة: طلبات معالجة محفوظة قبل هذا التحديث
 *    (بلا lotNumber) تُرقَّى تلقائياً عند التحميل بلا فقد بيانات.
 * تشغيل: node --experimental-strip-types scripts/verify_butcher_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { validateProcessingOutputExpiry } = await import('../src/core/processing.ts')
const { planFefo } = await import('../src/core/batches.ts')
const { todayLocalIso } = await import('../src/core/time.ts')
const today = todayLocalIso()
const futureExpiry = todayLocalIso(new Date(Date.now() + 90 * 86_400_000))
const laterExpiry = todayLocalIso(new Date(Date.now() + 120 * 86_400_000))

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }
const throwsErr = (fn, msg) => { try { fn(); FAIL++; console.log(`  ✗ ${msg} (لم يرمِ خطأ)`) } catch { PASS++; console.log(`  ✓ ${msg}`) } }

console.log('— ① دالة التحقق الخالصة validateProcessingOutputExpiry —')
const trackOf = new Map([[1, true], [2, false]])
ok(validateProcessingOutputExpiry([{ itemId: 1, qty: 1 }], (id) => trackOf.get(id), '2026-10-19').length > 0, 'يرفض ناتج متتبع بلا تاريخ انتهاء إطلاقاً')
ok(validateProcessingOutputExpiry([{ itemId: 1, qty: 1, expiryDate: 'تاريخ-غير-صالح' }], (id) => trackOf.get(id), '2026-10-19').length > 0, 'يرفض تاريخاً بصيغة غير صالحة')
ok(validateProcessingOutputExpiry([{ itemId: 1, qty: 1, expiryDate: '2026-01-01' }], (id) => trackOf.get(id), '2026-10-19').length > 0, 'يرفض تاريخاً يسبق تاريخ أمر التجهيز')
ok(validateProcessingOutputExpiry([{ itemId: 1, qty: 1, expiryDate: '2026-10-19' }], (id) => trackOf.get(id), '2026-10-19').length === 0, 'يقبل تاريخاً يساوي تاريخ الأمر نفسه (نفس اليوم)')
ok(validateProcessingOutputExpiry([{ itemId: 2, qty: 1 }], (id) => trackOf.get(id), '2026-10-19').length === 0, 'صنف لا يتتبع الصلاحية لا يُطالَب بتاريخ')
ok(validateProcessingOutputExpiry([{ itemId: 1, qty: 1, expiryDate: '2027-01-01' }, { itemId: 2, qty: 1 }], (id) => trackOf.get(id), '2026-10-19').length === 0, 'مزيج أصناف متتبعة وغير متتبعة يمر لو كلها صحيحة')

mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'SA', activityId: 'butcher', vatPercent: 15, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
const S = () => useDataStore.getState()
S().seed([])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1000000, label: 'خزينة' })
const mkItem = (nameAr, priceMinor, trackExpiry) => {
  S().addItem({ nameAr, sku: nameAr, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, priceMinor, minQty: 0, stockQty: 0, trackExpiry, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  return S().items.at(-1)
}
const carcass = mkItem('ذبيحة خروف', 0, false)
const leg = mkItem('فخذ خروف', 7000, true)   // يتتبع الصلاحية — حرج
const bone = mkItem('عظم خروف', 1500, false) // لا يتتبع — يبقى كما هو
S().addSupplier({ nameAr: 'مسلخ تجريبي', phone: '', notes: '' })
const sup = S().suppliers.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-10-10', lines: [{ itemId: carcass.id, qty: 20, unitPriceMinor: 15000 }], expenses: [], paidMinor: 300000, notes: '' })

console.log('— ② postProcessing يرفض ناتج متتبع بلا تاريخ انتهاء —')
throwsErr(() => S().postProcessing({ kind: 'butcher', sourceItemId: carcass.id, sourceQty: 10, outputs: [{ itemId: leg.id, qty: 6 }, { itemId: bone.id, qty: 3 }], overheadMinor: 0 }), 'يرفض الترحيل بلا تاريخ انتهاء للفخذ المتتبع')
throwsErr(() => S().postProcessing({ kind: 'butcher', sourceItemId: carcass.id, sourceQty: 10, outputs: [{ itemId: leg.id, qty: 6, expiryDate: '2020-01-01' }, { itemId: bone.id, qty: 3 }], overheadMinor: 0 }), 'يرفض تاريخاً سابقاً لتاريخ أمر التجهيز')
ok(S().processingOrders.length === 0, 'لا أمر تجهيز تسرّب رغم محاولات الرفض (لا ترحيل جزئي)')
ok(S().batches.length === 0, 'لا دفعة تسرّبت رغم محاولات الرفض')

console.log('— ③ postProcessing ينشئ دفعة صلاحية صحيحة + رقم تشغيلة —')
const order = S().postProcessing({
  kind: 'butcher', sourceItemId: carcass.id, sourceQty: 10,
  outputs: [{ itemId: leg.id, qty: 6, expiryDate: futureExpiry }, { itemId: bone.id, qty: 3 }],
  overheadMinor: 0, wasteQty: 1, lotNumber: 'ذبيحة-2026-10-19-أ',
})
ok(order.lotNumber === 'ذبيحة-2026-10-19-أ', 'رقم التشغيلة المخصص محفوظ على الأمر')
const legBatch = S().batches.find((b) => b.itemId === leg.id)
ok(!!legBatch, 'دفعة صلاحية للفخذ أُنشئت فعلاً')
ok(legBatch?.expiryDate === futureExpiry, 'تاريخ انتهاء الدفعة مطابق لتاريخ الناتج المُدخَل')
ok(legBatch?.lotNumber === 'ذبيحة-2026-10-19-أ', 'الدفعة تحمل رقم تشغيلة الأمر نفسه')
ok(legBatch?.qty === 6, 'كمية الدفعة مطابقة لكمية الناتج')
ok(legBatch?.warehouseId != null, 'الدفعة مربوطة بمخزن استلام النواتج')
ok(!S().batches.some((b) => b.itemId === bone.id), 'العظم (لا يتتبع الصلاحية) لم يفتح دفعة — لا بيانات وهمية')

console.log('— ④ رقم التشغيلة الافتراضي ولا يتكرر بلا سبب —')
const order2 = S().postProcessing({ kind: 'butcher', sourceItemId: carcass.id, sourceQty: 5, outputs: [{ itemId: leg.id, qty: 3, expiryDate: laterExpiry }, { itemId: bone.id, qty: 1 }], overheadMinor: 0 })
ok(order2.lotNumber === order2.orderNumber, 'لوط افتراضي = رقم الأمر لو تُرك فارغاً')
ok(order2.lotNumber !== order.lotNumber, 'كل أمر تجهيز له لوط مستقل عن الآخر')

console.log('— ⑤ FEFO يلتقط دفعات النواتج الجديدة عند بيعها لاحقاً —')
const plan = planFefo(S().batches, leg.id, 4, today, order.outputWarehouseId)
const consumedQty = plan.allocations.reduce((a, p) => a + p.qty, 0)
ok(Math.abs(consumedQty - 4) < 1e-9, 'خطة FEFO تسحب 4كجم من دفعات الفخذ المُنشأة حديثاً')
ok(plan.allocations.some((p) => p.batchId === legBatch.id), 'الدفعة الأقرب انتهاءً (من order الأول) ضمن الخطة')
ok(plan.untrackedQty === 0, 'لا كمية «غير متتبعة» رغم أن المصدر جديد تماماً — كل الكمية مغطاة بدفعات')

console.log('— ⑥ ترقية بيانات قديمة: أمر محفوظ بلا lotNumber يُرقّى تلقائياً —')
{
  // processingOrders مخزَّنة فعلياً ضمن متجر البيانات shopsys-data (لا shopsys-app
  // الذي يحمل الإعداد والترخيص فقط) — المفتاح الصحيح ضروري ليُقرأ عند الاسترجاع.
  const persistedData = {
    state: {
      processingOrders: [{ id: 1, orderNumber: 'CUT-0001', refCode: 'X', date: '2026-01-01', kind: 'butcher', sourceItemId: 1, sourceQty: 1, outputs: [], wasteQty: 0, compliance: {}, journalEntryId: 1, notes: '' }],
    },
    version: 1,
  }
  mem.set('shopsys-data', JSON.stringify(persistedData))
  const { useDataStore: freshStore } = await import(`../src/data/repo.ts?phaseb=migrate`)
  // التخزين الفعلي (secureStorage/SQLite) غير متزامن — ننتظر اكتمال الاسترجاع
  // صراحةً بدل افتراض التزامن، كما يفعل التطبيق نفسه قبل عرض أي شاشة.
  await freshStore.persist.rehydrate()
  const migrated = freshStore.getState().processingOrders.find((o) => o.id === 1)
  ok(migrated?.lotNumber === 'CUT-0001', 'أمر قديم بلا lotNumber يأخذ رقم الأمر تلقائياً عند التحميل')
}

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) { console.error('❌ فشل تحقق دفعة ب — جزارة ولحوم'); process.exit(1) }
console.log('🎉 نجح تحقق سد فجوة تتبع الصلاحية/التشغيلة — نشاط الجزارة ولحوم (دفعة ب)')
