/**
 * 🎁 فحص العروض الترويجية/الباقات (سد فجوة السوق المصرية/السعودية):
 * ─────────────────────────────────────────────────────────────
 * P1 النواة: توزيع سعر الباقة بالقرش تماماً (باقي أكبر + شطر السطر)، سريان التواريخ، الوفر
 * P2 التحقق: رفض المكرر/السيريال/الوزن/المتغيرات/سعر صفري/كسر أرضية السعر/عرض قطعة واحدة
 * P3 الدورة الكاملة في repo: إنشاء → بيع باقة → خصم مخزون المكونات → إيراد بسعر الباقة → قيد متزن
 * P4 حواف: عرض خارج فترة السريان يُرفض، معطل يُرفض، الحذف والتعديل، count متعدد
 *
 * تشغيل: node --experimental-strip-types scripts/verify_promotions.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { promotionCartLines, promotionActiveOn, promotionRetailMinor, promotionSavingsMinor, validatePromotion } = await import(join(root, 'src/core/promotions.ts'))

const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log(`  ✓ ${n}`) }

console.log('\n═══ P1) النواة: توزيع السعر بالقرش + السريان ═══')
{
  const items = [
    { id: 1, nameAr: 'شامبو', priceMinor: 5000, costMinor: 3000, vatOverride: undefined },
    { id: 2, nameAr: 'صابونة', priceMinor: 1500, costMinor: 800, vatOverride: undefined },
    { id: 3, nameAr: 'معجون', priceMinor: 3333, costMinor: 2000, vatOverride: undefined },
  ]
  // باقة: 2 شامبو + 3 صابونة + 1 معجون = تجزئة 10000+4500+3333=17833 — بسعر 15999 (قسمة عسيرة عمداً)
  const promo = { nameAr: 'باقة النظافة', components: [{ itemId: 1, qty: 2 }, { itemId: 2, qty: 3 }, { itemId: 3, qty: 1 }], bundlePriceMinor: 15999 }
  for (const count of [1, 2, 3, 7]) {
    const lines = promotionCartLines(promo, count, items)
    const total = lines.reduce((s, l) => s + Math.round(l.unitPriceMinor * l.qty), 0)
    assert.equal(total, 15999 * count, `count=${count}: مجموع السطور ${total} ≠ ${15999 * count}`)
    for (const l of lines) {
      assert.ok(Number.isInteger(l.unitPriceMinor) && l.unitPriceMinor > 0, 'سعر سطر غير صحيح')
      assert.ok(Number.isInteger(l.qty) && l.qty > 0, 'كمية سطر غير صحيحة')
    }
    // كميات المكونات مجمعة صحيحة حتى مع شطر السطور
    const qtyOf = (id) => lines.filter((l) => l.itemId === id).reduce((s, l) => s + l.qty, 0)
    assert.equal(qtyOf(1), 2 * count); assert.equal(qtyOf(2), 3 * count); assert.equal(qtyOf(3), 1 * count)
  }
  // التجزئة والوفر
  assert.equal(promotionRetailMinor(promo, items), 17833)
  assert.equal(promotionSavingsMinor(promo, items), 17833 - 15999)
  // السريان: مفتوح / محدد / منتهٍ / لم يبدأ / معطل
  const day = '2026-09-20T12:00:00.000Z'
  assert.ok(promotionActiveOn({ isActive: true, startIso: '', endIso: '' }, day))
  assert.ok(promotionActiveOn({ isActive: true, startIso: '2026-09-20', endIso: '2026-09-20' }, day), 'يوم البداية=النهاية=اليوم يسري')
  assert.ok(!promotionActiveOn({ isActive: true, startIso: '', endIso: '2026-09-19' }, day), 'منتهٍ أمس')
  assert.ok(!promotionActiveOn({ isActive: true, startIso: '2026-09-21', endIso: '' }, day), 'يبدأ غداً')
  assert.ok(!promotionActiveOn({ isActive: false, startIso: '', endIso: '' }, day), 'معطل')
  // count غير صحيح يرمي
  assert.throws(() => promotionCartLines(promo, 0, items))
  assert.throws(() => promotionCartLines(promo, 1.5, items))
  ok('توزيع بالقرش تماماً لـ4 أعداد باقات، كميات مجمعة سليمة، سريان التواريخ بكل حالاته')
}

console.log('\n═══ P2) التحقق: كل أنواع الرفض ═══')
{
  const items = [
    { id: 1, nameAr: 'عادي', priceMinor: 5000, costMinor: 3000, isActive: true, isService: false, trackSerial: false, soldByWeight: false, vatOverride: undefined, minSalePriceMinor: 0 },
    { id: 2, nameAr: 'موبايل', priceMinor: 900000, costMinor: 700000, isActive: true, isService: false, trackSerial: true, soldByWeight: false, vatOverride: undefined, minSalePriceMinor: 0 },
    { id: 3, nameAr: 'لحم', priceMinor: 30000, costMinor: 20000, isActive: true, isService: false, trackSerial: false, soldByWeight: true, vatOverride: undefined, minSalePriceMinor: 0 },
    { id: 4, nameAr: 'قميص', priceMinor: 20000, costMinor: 10000, isActive: true, isService: false, trackSerial: false, soldByWeight: false, vatOverride: undefined, minSalePriceMinor: 0 },
    { id: 5, nameAr: 'معطل', priceMinor: 1000, costMinor: 500, isActive: false, isService: false, trackSerial: false, soldByWeight: false, vatOverride: undefined, minSalePriceMinor: 0 },
    { id: 6, nameAr: 'محمي', priceMinor: 10000, costMinor: 6000, isActive: true, isService: false, trackSerial: false, soldByWeight: false, vatOverride: undefined, minSalePriceMinor: 9000 },
  ]
  const hasVar = (id) => id === 4
  const base = { nameAr: 'ع', bundlePriceMinor: 1000, startIso: '', endIso: '', isActive: true }
  const v = (patch) => validatePromotion({ ...base, ...patch }, [], items, hasVar)
  assert.ok(v({ components: [] }).length, 'بلا مكونات مرفوض')
  assert.ok(v({ components: [{ itemId: 1, qty: 1 }, { itemId: 1, qty: 2 }] }).some((e) => e.includes('مكرر')), 'المكرر مرفوض')
  assert.ok(v({ components: [{ itemId: 2, qty: 1 }, { itemId: 1, qty: 1 }] }).some((e) => e.includes('السيريال')), 'السيريال مرفوض')
  assert.ok(v({ components: [{ itemId: 3, qty: 1 }, { itemId: 1, qty: 1 }] }).some((e) => e.includes('بالوزن')), 'الوزن مرفوض')
  assert.ok(v({ components: [{ itemId: 4, qty: 1 }, { itemId: 1, qty: 1 }] }).some((e) => e.includes('تركيبات')), 'المتغيرات مرفوضة')
  assert.ok(v({ components: [{ itemId: 5, qty: 1 }, { itemId: 1, qty: 1 }] }).some((e) => e.includes('معطل')), 'الصنف المعطل مرفوض')
  assert.ok(v({ components: [{ itemId: 1, qty: 0.5 }] }).length, 'كمية كسرية مرفوضة')
  assert.ok(v({ components: [{ itemId: 1, qty: 2 }], bundlePriceMinor: 0 }).length, 'سعر صفري مرفوض')
  assert.ok(v({ components: [{ itemId: 1, qty: 1 }] }).some((e) => e.includes('قوائم الأسعار')), 'قطعة واحدة = سعر خاص لا عرض')
  assert.ok(v({ components: [{ itemId: 1, qty: 2 }], startIso: '2026-09-20', endIso: '2026-09-19' }).some((e) => e.includes('قبل بدايته')), 'نهاية قبل بداية مرفوضة')
  assert.ok(v({ components: [{ itemId: 99, qty: 1 }] }).length, 'مكوّن غير موجود مرفوض')
  // كسر أرضية السعر: «محمي» حده 9000 وسعر الباقة يهبط به تحته
  const floorErrs = v({ components: [{ itemId: 6, qty: 1 }, { itemId: 1, qty: 1 }], bundlePriceMinor: 6000 })
  assert.ok(floorErrs.some((e) => e.includes('حده الأدنى')), 'كسر أرضية السعر مرفوض: ' + floorErrs.join('،'))
  // عرض سليم يمر — وبنفس الاسم لعرض قائم مرفوض
  assert.equal(v({ components: [{ itemId: 1, qty: 2 }, { itemId: 6, qty: 1 }], bundlePriceMinor: 19000 }).length, 0, 'العرض السليم يمر')
  assert.ok(validatePromotion({ ...base, nameAr: 'قائم', components: [{ itemId: 1, qty: 2 }] }, [{ id: 7, nameAr: 'قائم' }], items, hasVar).some((e) => e.includes('بهذا الاسم')))
  ok('13 نوع رفض + العرض السليم يمر + تفرد الاسم')
}

console.log('\n═══ P3) الدورة الكاملة في repo: بيع باقة يخصم المكونات ويوازن القيد ═══')
{
  st().addItem({ nameAr: 'شاي العرض', categoryId: null, unit: 'قطعة', priceMinor: 4000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  st().addItem({ nameAr: 'سكر العرض', categoryId: null, unit: 'قطعة', priceMinor: 2500, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const tea = st().items.find((i) => i.nameAr === 'شاي العرض')
  const sugar = st().items.find((i) => i.nameAr === 'سكر العرض')
  // شراء لتكوين مخزون وتكلفة (postPurchase يتطلب مورداً مسجلاً وسطوراً بـunitPriceMinor)
  st().addSupplier({ nameAr: 'مورد العروض', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  const sup = st().suppliers.find((s) => s.nameAr === 'مورد العروض')
  st().postPurchase({
    supplierId: sup.id, date: '2026-09-18', treasury: '1101', notes: '', expenses: [],
    paidMinor: 10 * 2000 + 10 * 1200,
    lines: [
      { itemId: tea.id, qty: 10, unitPriceMinor: 2000 },
      { itemId: sugar.id, qty: 10, unitPriceMinor: 1200 },
    ],
  })
  // إنشاء العرض: 2 شاي + 3 سكر (تجزئة 8000+7500=15500) بسعر 13999
  const promo = st().addPromotion({
    nameAr: 'باقة الضيافة',
    components: [{ itemId: tea.id, qty: 2 }, { itemId: sugar.id, qty: 3 }],
    bundlePriceMinor: 13999, startIso: '', endIso: '', isActive: true,
  })
  assert.ok(promo.id > 0)
  // اسم مكرر مرفوض من repo
  assert.throws(() => st().addPromotion({ nameAr: 'باقة الضيافة', components: [{ itemId: tea.id, qty: 2 }], bundlePriceMinor: 5000, startIso: '', endIso: '', isActive: true }))
  // التفكيك وبيعه
  const lines = st().getPromotionCartLines(promo.id, 1)
  const linesTotal = lines.reduce((s, l) => s + Math.round(l.unitPriceMinor * l.qty), 0)
  assert.equal(linesTotal, 13999, 'مجموع سطور الباقة = سعرها بالقرش')
  assert.ok(lines.every((l) => l.nameAr.includes('باقة الضيافة')), 'اسم العرض ظاهر على السطور')
  const teaBefore = st().items.find((i) => i.id === tea.id).stockQty
  const sugarBefore = st().items.find((i) => i.id === sugar.id).stockQty
  const entriesBefore = st().journal.length
  const sale = st().postSale({ lines, payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false })
  assert.equal(sale.totals.totalMinor, 13999, 'إجمالي الفاتورة = سعر الباقة')
  assert.equal(st().items.find((i) => i.id === tea.id).stockQty, teaBefore - 2, 'خُصم 2 شاي')
  assert.equal(st().items.find((i) => i.id === sugar.id).stockQty, sugarBefore - 3, 'خُصم 3 سكر')
  // القيد متزن وتكلفة البضاعة بالمتوسط المرجح (2×2000 + 3×1200 = 7600)
  const newEntries = st().journal.slice(entriesBefore)
  for (const e of newEntries) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0)
    const c = e.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, 'قيد غير متزن!')
  }
  const cogs = newEntries.flatMap((e) => e.lines).filter((l) => l.accountCode === '5101').reduce((s, l) => s + l.debit, 0)
  assert.equal(cogs, 2 * 2000 + 3 * 1200, 'تكلفة البضاعة المباعة = تكلفة المكونات الحقيقية')
  ok('بيع الباقة: إجمالي مضبوط، مخزون المكونات مخصوم، القيد متزن، COGS بالمتوسط المرجح')
}

console.log('\n═══ P4) الحواف: السريان والتعطيل والتعديل والحذف وcount متعدد ═══')
{
  const tea = st().items.find((i) => i.nameAr === 'شاي العرض')
  const sugar = st().items.find((i) => i.nameAr === 'سكر العرض')
  const promo = st().promotions.find((p) => p.nameAr === 'باقة الضيافة')
  // عرض منتهي السريان يُرفض تفكيكه
  st().updatePromotion(promo.id, { nameAr: 'باقة الضيافة', components: promo.components, bundlePriceMinor: 13999, startIso: '2020-01-01', endIso: '2020-12-31', isActive: true })
  assert.throws(() => st().getPromotionCartLines(promo.id, 1), /غير سارٍ/, 'المنتهي يُرفض')
  // إعادة فتحه ثم تعطيله
  st().updatePromotion(promo.id, { nameAr: 'باقة الضيافة', components: promo.components, bundlePriceMinor: 13999, startIso: '', endIso: '', isActive: true })
  st().togglePromotion(promo.id)
  assert.throws(() => st().getPromotionCartLines(promo.id, 1), /غير سارٍ/, 'المعطل يُرفض')
  st().togglePromotion(promo.id)
  // count=3: المخزون يُخصم ثلاثة أضعاف
  const lines3 = st().getPromotionCartLines(promo.id, 3)
  assert.equal(lines3.reduce((s, l) => s + Math.round(l.unitPriceMinor * l.qty), 0), 13999 * 3)
  const teaBefore = st().items.find((i) => i.id === tea.id).stockQty
  st().postSale({ lines: lines3, payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: true })
  assert.equal(st().items.find((i) => i.id === tea.id).stockQty, teaBefore - 6, '3 باقات = 6 شاي')
  // تعديل باطل يُرفض ولا يفسد العرض
  assert.throws(() => st().updatePromotion(promo.id, { nameAr: 'باقة الضيافة', components: [], bundlePriceMinor: 13999, startIso: '', endIso: '', isActive: true }))
  assert.equal(st().promotions.find((p) => p.id === promo.id).components.length, 2, 'العرض سليم بعد التعديل المرفوض')
  // مخزون غير كافٍ: الباقة تحترم فحص المخزون العادي
  const bigLines = st().getPromotionCartLines(promo.id, 99)
  assert.throws(() => st().postSale({ lines: bigLines, payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false }), /مخزون غير كافٍ/)
  // الحذف
  st().removePromotion(promo.id)
  assert.ok(!st().promotions.some((p) => p.id === promo.id))
  assert.throws(() => st().getPromotionCartLines(promo.id, 1), /غير موجود/)
  ok('منتهٍ/معطل يُرفضان، count=3 يخصم ×3، تعديل باطل لا يفسد، مخزون غير كافٍ يمنع، الحذف نظيف')
}

console.log(`\n✅ العروض والباقات: ${pass} تحققات — كلها خضراء\n`)
