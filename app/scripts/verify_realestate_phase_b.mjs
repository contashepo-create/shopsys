/**
 * تحقق سد فجوة تقرير النشاط #21 (عقارات وإدارة أملاك — دفعة ب):
 * وصف النشاط نفسه يَعِد بـ"مستلزمات صيانة الوحدات في المخزن (بلا كاشير)"
 * لكن قالب النشاط كان يمنح وحدة `realestate` فقط — بلا `inventory` ولا
 * `purchases` — فكانت أقسام المخزون والمشتريات مخفية تماماً من الشريط
 * الجانبي ولا يمكن للمستخدم تفعيلها بنفسه (تحتاج مفتاح دعم موقّع)، رغم
 * أن الوصف يَعِد بها صراحة. بالإضافة لذلك، صيانة الوحدة (`addUnitMaintenance`)
 * كانت مبلغاً نقدياً مكتوباً يدوياً فقط بلا أي ربط فعلي بمخزون حقيقي —
 * لا تُطابق "مستلزمات… في المخزن" التي يصفها النشاط.
 * الإصلاح: (1) إضافة inventory/purchases لقالب النشاط (بلا pos — بنفس
 * نمط contracting #11)، (2) تمديد addUnitMaintenance لقبول مستلزمات
 * فعلية تُسحب من المخزون بتكلفتها المرجحة وتُقيَّد على 1103.
 * تشغيل: node --experimental-strip-types scripts/verify_realestate_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { getActivity, effectiveModules } = await import('../src/core/activities.ts')
const S = () => useDataStore.getState()

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }
const throwsErr = (fn, msg, part) => {
  try { fn(); FAIL++; console.log(`  ✗ ${msg} (لم يرمِ خطأ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? PASS++ : FAIL++; console.log(`  ${good ? '✓' : '✗'} ${msg}${good ? '' : ' — ' + e.message}`) }
}

console.log('— ① بطاقة النشاط: عقارات تملك الآن inventory/purchases بلا pos —')
const re = getActivity('realestate')
ok(!!re && re.modules.includes('realestate'), 'الوحدة التخصصية realestate موجودة')
ok(!!re && re.modules.includes('inventory'), 'وحدة inventory مضافة — سد الفجوة المعمارية')
ok(!!re && re.modules.includes('purchases'), 'وحدة purchases مضافة — شراء مستلزمات الصيانة')
ok(!!re && !re.modules.includes('pos'), 'بلا كاشير (pos) — مطابق لوصف النشاط "بلا كاشير" بالحرف')
const effective = effectiveModules('realestate', undefined)
ok(effective.includes('inventory') && effective.includes('purchases'), 'effectiveModules (ما يُعرض فعلياً في الشريط الجانبي) يشمل المخزون والمشتريات الآن')

mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 15, activityId: 'realestate', countryCode: 'SA' } }, version: 0 }))
S().seed([])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000, label: 'خزينة' })
S().addItem({ nameAr: 'دهان بلاستيك 18 لتر', sku: 'RE-MAT-1', barcodes: [], categoryId: 1, baseUnit: 'عبوة', extraUnits: [], costMinor: 20000, priceMinor: 20000, minQty: 0, stockQty: 10, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false })
const paint = S().items.at(-1)
const managed = S().addProperty({ nameAr: 'عمارة الاختبار', kind: 'residential', ownership: 'managed', ownerName: 'مالك تجريبي', commissionPercent: 5, address: 'الرياض', costMinor: 0, notes: '', unitCodes: ['شقة 1'] })
const unit = S().propertyUnits.find((u) => u.propertyId === managed.id)
const owned = S().addProperty({ nameAr: 'عقار مملوك', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0, address: 'جدة', costMinor: 500_000, notes: '', unitCodes: ['شقة أ'], acquisitionPayment: 'cash', treasury: '1101' })
const ownedUnit = S().propertyUnits.find((u) => u.propertyId === owned.id)

console.log('— ② صيانة بمستلزمات حقيقية من المخزون (مصروف مكتب 5108) —')
const stockBefore = paint.stockQty
S().addUnitMaintenance({ unitId: ownedUnit.id, amountMinor: 0, bearer: 'office', description: 'دهان شقة', treasury: '1101', materials: [{ itemId: paint.id, qty: 2 }] })
const paintAfter = S().items.find((it) => it.id === paint.id)
ok(paintAfter.stockQty === stockBefore - 2, 'كمية الدهان خُصمت فعلياً من المخزون (2 عبوة)')
const maintEntry1 = S().journal.at(-1)
const debit5108 = maintEntry1.lines.filter((l) => l.accountCode === '5108').reduce((a, l) => a + l.debit, 0)
const credit1103 = maintEntry1.lines.filter((l) => l.accountCode === '1103').reduce((a, l) => a + l.credit, 0)
ok(debit5108 === 40000, 'مصروف 5108 مديناً = 2 × 20000 = 40000 بالضبط (تكلفة الدهام المستهلك)')
ok(credit1103 === 40000, 'المخزون 1103 دائناً بنفس القيمة — لا نقدية خرجت')
ok(maintEntry1.lines.reduce((a, l) => a + l.debit, 0) === maintEntry1.lines.reduce((a, l) => a + l.credit, 0), 'القيد متوازن تماماً')

console.log('— ③ صيانة مختلطة (نقدية + مستلزمات) على حساب المالك تخصم الإجمالي من 2115 —')
S().collectLeaseInstallment ? null : null // لا حاجة فعلياً — نضمن رصيداً كافياً عبر معاملة تحصيل بسيطة
// نمنح المالك رصيداً دائناً كافياً عبر تحصيل إيجار وهمي أولاً
const lease = S().addLease({ propertyId: managed.id, unitId: unit.id, tenantName: 'مستأجر تجريبي', startDate: '2026-01-01', months: 1, frequency: 'monthly', totalRentMinor: 100000, depositMinor: 0 })
S().collectLeaseInstallment({ leaseId: lease.id, seq: 1 })
const ownerBalanceBefore = S().getOwnerBalance(managed.id)
S().addUnitMaintenance({ unitId: unit.id, amountMinor: 5000, bearer: 'owner', description: 'سباكة + مستلزم', treasury: '1101', materials: [{ itemId: paint.id, qty: 1 }] })
const ownerBalanceAfter = S().getOwnerBalance(managed.id)
ok(ownerBalanceBefore - ownerBalanceAfter === 25000, 'رصيد المالك انخفض بإجمالي 5000 نقدي + 20000 مستلزم = 25000 بالضبط')
const maintEntry2 = S().journal.at(-1)
const debit2115 = maintEntry2.lines.filter((l) => l.accountCode === '2115').reduce((a, l) => a + l.debit, 0)
ok(debit2115 === 25000, 'قيد الصيانة: 2115 مديناً بالإجمالي 25000 (لا مصروف مكتب ظهر هنا)')
ok(maintEntry2.lines.some((l) => l.accountCode === '1101' && l.credit === 5000), 'الخزينة 1101 دائنة بالجزء النقدي فقط (5000)')
ok(maintEntry2.lines.some((l) => l.accountCode === '1103' && l.credit === 20000), 'المخزون 1103 دائن بقيمة المستلزم (20000)')

console.log('— ④ حُرّاس: كمية تتجاوز الرصيد وصنف غير موجود يُرفضان ذرياً —')
const stockNow = S().items.find((it) => it.id === paint.id).stockQty
throwsErr(() => S().addUnitMaintenance({ unitId: ownedUnit.id, amountMinor: 0, bearer: 'office', description: 'خطأ', treasury: '1101', materials: [{ itemId: paint.id, qty: 9999 }] }), 'يرفض كمية مستلزم تتجاوز الرصيد المتاح', 'المتاح')
ok(S().items.find((it) => it.id === paint.id).stockQty === stockNow, 'لا خصم جزئي بعد الرفض — رفض ذري كامل')
throwsErr(() => S().addUnitMaintenance({ unitId: ownedUnit.id, amountMinor: 0, bearer: 'office', description: 'خطأ', treasury: '1101', materials: [{ itemId: 999999, qty: 1 }] }), 'يرفض صنف مستلزم غير موجود')
throwsErr(() => S().addUnitMaintenance({ unitId: ownedUnit.id, amountMinor: 0, bearer: 'office', description: 'لا شيء', treasury: '1101' }), 'يرفض صيانة بلا نقدية ولا مستلزمات (قيمة صفرية)')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) { console.error('❌ فشل تحقق دفعة ب — عقارات وإدارة أملاك'); process.exit(1) }
console.log('🎉 نجح تحقق سد فجوة مستلزمات صيانة الوحدات من المخزون — نشاط العقارات (دفعة ب)')
