import assert from 'node:assert/strict'
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'pharmacy', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { ACTIVITY_TEMPLATES, getActivity, effectiveModules } = await import('/home/user/shopsys/app/src/core/activities.ts')
const { pathAllowedForSetup } = await import('/home/user/shopsys/app/src/core/coaVisibility.ts')
const { priceFloorViolations } = await import('/home/user/shopsys/app/src/core/items.ts')
const { promotionCartLines } = await import('/home/user/shopsys/app/src/core/promotions.ts')
const { stagnantItems } = await import('/home/user/shopsys/app/src/core/reports.ts')
const { useDataStore } = await import('/home/user/shopsys/app/src/data/repo.ts')
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }

// A1: عزل النشاط — /sales/promotions يظهر فقط لأنشطة price_lists
{
  let withF = 0, withoutF = 0
  for (const t of ACTIVITY_TEMPLATES) {
    const mods = effectiveModules ? effectiveModules(t) : t.modules
    const allowed = pathAllowedForSetup('/sales/promotions', mods, t.features, t.id)
    const hasF = t.features.includes('price_lists') && mods.includes('pos')
    assert.equal(allowed, hasF, `${t.id}: promotions ${allowed ? 'ظاهر' : 'محجوب'} خطأً`)
    hasF ? withF++ : withoutF++
  }
  ok(`عزل العروض عبر ${ACTIVITY_TEMPLATES.length} نشاطاً: ${withF} يرونها و${withoutF} محجوبون — الحدود مضبوطة`)
}

// A2: أرضية السعر مع وحدة أكبر (صيدلية: شريط 10 أقراص) — المقارنة بالوحدة الأساسية
{
  const items = [{ id: 1, nameAr: 'دواء', minSalePriceMinor: 500 }] // أرضية القرص 5 جنيه
  // شريط 10 أقراص بسعر 6000 = 600/قرص فوق الأرضية
  assert.equal(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6000, unitFactor: 10, discountPercent: 0 }], items).length, 0)
  // شريط بسعر 4000 = 400/قرص تحت الأرضية
  assert.equal(priceFloorViolations([{ itemId: 1, unitPriceMinor: 4000, unitFactor: 10, discountPercent: 0 }], items).length, 1)
  // شريط 6000 بخصم سطر 20% = 480/قرص — تحت
  assert.equal(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6000, unitFactor: 10, discountPercent: 20 }], items).length, 1)
  // بالضبط على الأرضية (500×10 بلا خصم) — يمر
  assert.equal(priceFloorViolations([{ itemId: 1, unitPriceMinor: 5000, unitFactor: 10, discountPercent: 0 }], items).length, 0)
  ok('أرضية السعر بالوحدات الكبرى: فوق/تحت/خصم-يُهبط/على-الحد بالضبط')
}

// A3: عرض بكميات كبيرة وقسمة عسيرة جداً — التوزيع لا ينكسر أبداً (فحص عشوائي 500 حالة)
{
  let worst = 0
  for (let t = 0; t < 500; t++) {
    const n = 1 + (t % 4)
    const comps = [], its = []
    for (let i = 0; i < n; i++) {
      const price = 1 + Math.floor(Math.abs(Math.sin(t * 7 + i * 13)) * 99999)
      const qty = 1 + Math.floor(Math.abs(Math.cos(t * 3 + i * 5)) * 7)
      its.push({ id: i + 1, nameAr: `ص${i}`, priceMinor: price, costMinor: 0, vatOverride: undefined })
      comps.push({ itemId: i + 1, qty })
    }
    const bundle = 1 + Math.floor(Math.abs(Math.sin(t * 11)) * 500000)
    const count = 1 + (t % 5)
    const lines = promotionCartLines({ nameAr: 'ع', components: comps, bundlePriceMinor: bundle }, count, its)
    const total = lines.reduce((s, l) => s + Math.round(l.unitPriceMinor * l.qty), 0)
    const diff = Math.abs(total - bundle * count)
    worst = Math.max(worst, diff)
    assert.equal(diff, 0, `t=${t}: انحراف ${diff} قرش`)
    for (const l of lines) assert.ok(Number.isInteger(l.unitPriceMinor) && l.unitPriceMinor >= 0 && Number.isInteger(l.qty) && l.qty > 0)
  }
  ok(`500 حالة عشوائية لتوزيع الباقات: انحراف أقصى ${worst} قرش (صفر دائماً)`)
}

// A4: الراكد عبر بيانات repo حقيقية (لا نواة معزولة): صنف بيع قديم + صنف لم يُبع
{
  st().addItem({ nameAr: 'سريع', categoryId: null, unit: 'ق', priceMinor: 1000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 500, stockQty: 10 })
  st().addItem({ nameAr: 'نائم', categoryId: null, unit: 'ق', priceMinor: 2000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 900, stockQty: 7 })
  const fast = st().items.find(i => i.nameAr === 'سريع')
  st().postSale({ lines: [{ itemId: fast.id, nameAr: 'سريع', qty: 1, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: true })
  const rows = stagnantItems(st().items, st().sales, new Date().toISOString(), 30)
  assert.ok(!rows.some(r => r.itemId === fast.id), 'المباع اليوم ليس راكداً')
  const sleepy = st().items.find(i => i.nameAr === 'نائم')
  const row = rows.find(r => r.itemId === sleepy.id)
  assert.ok(row, 'من لم يُبع قط راكد')
  assert.equal(row.idleDays, -1)
  assert.equal(row.stockValueMinor, 7 * 900, 'رأس المال المحبوس = رصيد×متوسط التكلفة')
  ok('الراكد ببيانات repo حية: المباع اليوم خارج، والنائم داخل بقيمة محبوسة مضبوطة')
}

console.log(`\n✅ الفحص التخريبي الثالث: ${pass} تحققات — كلها خضراء`)
