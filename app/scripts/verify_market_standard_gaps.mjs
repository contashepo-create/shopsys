/**
 * 🏪 فحص فجوات السوق (DEXEF/الأمين/فودكس — أشهر برامج مصر والسعودية):
 * ─────────────────────────────────────────────────────────────
 * G1 أرضية السعر: بيع تحت الحد الأدنى مرفوض، باعتماد مدير يمر، الوحدات الكبرى تقارن صحيحاً
 * G2 الراكد: صنف بمخزون بلا بيع 30+ يوماً يظهر، والمتحرك لا يظهر، والخدمي مستثنى
 * G3 عمولة على فاتورة بيع: استحقاق مربوط بالفاتورة يدخل مصروف الفترة
 * G4 عمولة على مشروع مقاولات وبيع سيارة: نفس الدورة
 *
 * تشغيل: node --experimental-strip-types scripts/verify_market_standard_gaps.mjs
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
const { PriceFloorError, priceFloorViolations } = await import(join(root, 'src/core/items.ts'))
const { stagnantItems } = await import(join(root, 'src/core/reports.ts'))
const { incomeStatement } = await import(join(root, 'src/core/financialReports.ts'))

const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log(`  ✓ ${n}`) }

console.log('\n═══ G1) أرضية السعر (DEXEF/الأمين) ═══')
{
  st().addItem({ nameAr: 'زيت عباد', sku: 'OIL-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 50_00, stockQty: 100, priceMinor: 70_00, minSalePriceMinor: 60_00, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const oil = st().items.at(-1)
  const mkLine = (price, extra = {}) => ({ itemId: oil.id, nameAr: oil.nameAr, qty: 1, unitPriceMinor: price, unitCostMinor: 50_00, discountPercent: 0, soldByWeight: false, ...extra })

  // بيع فوق الحد يمر
  const okSale = st().postSale({ lines: [mkLine(65_00)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.ok(okSale.id, 'بيع فوق الحد فشل!')
  ok('بيع بـ65 وحدّه 60: يمر عادي')

  // بيع تحت الحد يرفض بـPriceFloorError
  assert.throws(
    () => st().postSale({ lines: [mkLine(55_00)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true }),
    (e) => e instanceof PriceFloorError && e.itemNames.includes('زيت عباد'),
    'البيع تحت الحد مرّ بلا خطأ!',
  )
  ok('بيع بـ55 وحدّه 60: PriceFloorError باسم الصنف')

  // الخصم يُدخل السعر تحت الحد ⇒ يرفض أيضاً (65 بخصم 20% = 52)
  assert.throws(
    () => st().postSale({ lines: [mkLine(65_00, { discountPercent: 20 })], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true }),
    (e) => e instanceof PriceFloorError,
    'الخصم تحت الحد مرّ!',
  )
  ok('خصم سطر يهبط بالسعر تحت الحد: مرفوض أيضاً')

  // باعتماد مدير يمر ويقيد سليماً
  const forced = st().postSale({ lines: [mkLine(55_00)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, priceFloorOverrideBy: 'المدير أحمد' })
  assert.ok(forced.id, 'الاعتماد لم يمرر البيع!')
  ok('نفس البيع باعتماد «المدير أحمد»: يمر')

  // وحدة كبرى: كرتونة 12 قطعة بـ700 (58.33/قطعة تحت حد 60) ⇒ يرفض
  const v = priceFloorViolations(
    [{ itemId: oil.id, unitPriceMinor: 700_00, unitFactor: 12, discountPercent: 0 }],
    st().items,
  )
  assert.ok(v.includes('زيت عباد'), 'الوحدة الكبرى لم تقارن بالوحدة الأساسية!')
  const v2 = priceFloorViolations(
    [{ itemId: oil.id, unitPriceMinor: 750_00, unitFactor: 12, discountPercent: 0 }],
    st().items,
  )
  assert.equal(v2.length, 0, 'كرتونة بسعر سليم رُفضت!')
  ok('كرتونة 12: تقارن بسعر القطعة (700→رفض، 750→قبول)')

  // صنف بلا حد (0/undefined) لا يُفحص
  st().addItem({ nameAr: 'سكر', sku: 'SGR-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 20_00, stockQty: 50, priceMinor: 30_00, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const sugar = st().items.at(-1)
  const s2 = st().postSale({ lines: [{ itemId: sugar.id, nameAr: sugar.nameAr, qty: 1, unitPriceMinor: 1_00, unitCostMinor: 20_00, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.ok(s2.id)
  ok('صنف بلا حد أدنى: يباع بأي سعر (سلوك اختياري لا إجباري)')
}

console.log('\n═══ G2) الأصناف الراكدة ═══')
{
  const today = '2026-09-20T12:00:00.000Z'
  const items = [
    { id: 1, nameAr: 'راكد قديم', stockQty: 10, costMinor: 100_00, isActive: true },
    { id: 2, nameAr: 'متحرك', stockQty: 5, costMinor: 50_00, isActive: true },
    { id: 3, nameAr: 'لم يُبع قط', stockQty: 3, costMinor: 200_00, isActive: true },
    { id: 4, nameAr: 'خدمة', stockQty: 0, costMinor: 0, isActive: true, isService: true },
    { id: 5, nameAr: 'معطل', stockQty: 7, costMinor: 10_00, isActive: false },
    { id: 6, nameAr: 'رصيد صفر', stockQty: 0, costMinor: 30_00, isActive: true },
  ]
  const sales = [
    { date: '2026-07-01T10:00:00.000Z', lines: [{ itemId: 1 }] }, // 81 يوماً
    { date: '2026-09-15T10:00:00.000Z', lines: [{ itemId: 2 }] }, // 5 أيام
  ]
  const rows = stagnantItems(items, sales, today, 30)
  const ids = rows.map((r) => r.itemId)
  assert.ok(ids.includes(1), 'الراكد القديم لم يظهر!')
  assert.ok(ids.includes(3), 'الذي لم يُبع قط لم يظهر!')
  assert.ok(!ids.includes(2), 'المتحرك ظهر راكداً!')
  assert.ok(!ids.includes(4) && !ids.includes(5) && !ids.includes(6), 'خدمة/معطل/صفر ظهرت!')
  // الترتيب بقيمة المخزون: لم يُبع قط (600) قبل الراكد (1000)؟ لا — 1000 أولاً
  assert.equal(rows[0].itemId, 1, 'الترتيب ليس بقيمة المخزون المحبوس!')
  assert.equal(rows.find((r) => r.itemId === 1).idleDays, 81, 'حساب أيام الركود خاطئ!')
  assert.equal(rows.find((r) => r.itemId === 3).idleDays, -1, 'لم يُبع قط يجب أن يكون -1')
  ok('الراكد: يظهر القديم ولم-يُبع، يستثني المتحرك/الخدمة/المعطل/الصفري، ترتيب بالقيمة، أيام مضبوطة')
}

console.log('\n═══ G3) عمولة موظف على فاتورة بيع ═══')
{
  st().addEmployee({ nameAr: 'مندوب كريم', phone: '', jobTitle: 'بائع', salaryMinor: 3000_00, hireDate: '2026-01-01', notes: '', active: true })
  const emp = st().employees.at(-1)
  const sale = st().sales.at(-1)
  const before = incomeStatement(st().journal, { from: '2026-01-01', to: '2026-12-31' })
  const c = st().addStaffCommission({ employeeId: emp.id, source: 'sale', sourceId: sale.id, description: `عمولة بيع — فاتورة ${sale.invoiceNumber}`, amountMinor: 150_00 })
  assert.equal(c.source, 'sale')
  assert.equal(c.sourceId, sale.id)
  const after = incomeStatement(st().journal, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(after.totalExpenseMinor - before.totalExpenseMinor, 150_00, 'العمولة لم تدخل مصروف الفترة!')
  ok('عمولة 150 على فاتورة: مستند مربوط + مصروف الفترة +150 فوراً')
}

console.log('\n═══ G4) عمولة على مشروع وبيع سيارة (نفس النواة) ═══')
{
  const emp = st().employees.at(-1)
  const c1 = st().addStaffCommission({ employeeId: emp.id, source: 'project', sourceId: null, description: 'عمولة مشروع تجريبي', amountMinor: 500_00 })
  const c2 = st().addStaffCommission({ employeeId: emp.id, source: 'car_sale', sourceId: null, description: 'عمولة بيع سيارة تجريبية', amountMinor: 300_00 })
  assert.equal(c1.source, 'project')
  assert.equal(c2.source, 'car_sale')
  // الصرف المنفرد يصفي 2116
  const paid = st().payStaffCommission({ commissionId: c1.id, treasury: '1101' })
  assert.equal(paid.status, 'paid')
  assert.equal(paid.payoutMode, 'voucher')
  ok('عمولتا مشروع وسيارة تستحقان وتُصرف إحداهما منفردة — الدورة واحدة لكل المصادر')
}

console.log(`\n✅ فجوات السوق: ${pass} تحققاً — كلها خضراء\n`)
