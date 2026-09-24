#!/usr/bin/env node
/**
 * فحص سياسة الورديات بحسب الدور والسياق:
 * المالك تلميح فقط، الكاشير حسب مفتاحه، وبقية الأدوار ملزمة،
 * مع بقاء أنشطة «الفاتورة أولاً» خارج سياسة الوردية.
 * التشغيل: node --experimental-strip-types scripts/verify_shift_role_policy.mjs
 */
import assert from 'node:assert/strict'
import { salesShiftPolicy } from '../src/core/shifts.ts'
import { rolesWithOverrides } from '../src/core/permissions.ts'

let pass = 0
const ok = (message) => { pass++; console.log(`  ✓ ${message}`) }
const policy = (roleId, requireOpenShiftForSales, invoiceFirst = false) => salesShiftPolicy({
  roleId,
  isOwner: roleId === 'owner' || roleId == null,
  requireOpenShiftForSales,
  invoiceFirst,
})

console.log('\n═══ فحص سياسة الوردية بحسب الدور ═══')

const owner = policy('owner', true)
assert.equal(owner.required, false)
assert.equal(owner.hintOnly, true)
ok('المالك الرئيسي يحصل على تلميح فقط ولا يُمنع رغم تفعيل الإعداد')

const cashierOn = policy('cashier', true)
assert.equal(cashierOn.required, true)
assert.equal(cashierOn.hintOnly, false)
ok('الكاشير يُمنع بلا وردية عند تفعيل سياسة الكاشير')

const cashierOff = policy('cashier', false)
assert.equal(cashierOff.required, false)
assert.equal(cashierOff.hintOnly, true)
ok('الكاشير يتبع مفتاح سياسة الكاشير عند تعطيله')

for (const roleId of ['senior_seller', 'branch_manager', 'accountant', 'stylist', 'goldsmith']) {
  const result = policy(roleId, false)
  assert.equal(result.required, true, `${roleId}: الدور غير المالك ملزم حتى عند تعطيل مفتاح الكاشير`)
  assert.equal(result.hintOnly, false, `${roleId}: ليس تلميحاً فقط`)
}
ok('المدير والمحاسب وبقية الأدوار الموظفة ملزمون في سياق البيع')

const invoiceFirst = policy('branch_manager', true, true)
assert.equal(invoiceFirst.required, false)
assert.equal(invoiceFirst.hintOnly, false)
ok('استثناء أنشطة الفاتورة أولاً محفوظ ولا يفتح مساراً إجبارياً للوردية')

for (const [roleId, activityId] of [['accountant', null], ['stylist', 'salon'], ['goldsmith', 'jewelry']]) {
  const role = rolesWithOverrides({}, [], activityId).find((candidate) => candidate.id === roleId)
  assert.ok(role?.permissions.includes('sales.shift.close'), `${roleId}: يجب أن يستطيع فتح شاشة الورديات`)
}
ok('الأدوار التي قد تنفذ سياقاً يحتاج وردية تملك صلاحية شاشة الورديات')

// تحقق تكاملي صغير: القرار نفسه يحرس postSale في طبقة البيانات، لا الواجهة فقط.
const mem = new Map()
globalThis.localStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
  key: (index) => [...mem.keys()][index] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: true, done: true, countryCode: 'EG', activityId: 'grocery', allowNegativeTreasury: true } }, version: 0 }))
const { useDataStore } = await import('../src/data/repo.ts?shift-policy')
const S = () => useDataStore.getState()
S().seed([])
S().addItem({ nameAr: 'اختبار وردية', sku: 'SHIFT-POLICY', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 100_00, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
S().addSupplier({ nameAr: 'مورد اختبار', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = S().items.at(-1)
const supplier = S().suppliers.at(-1)
S().postPurchase({ supplierId: supplier.id, date: '2026-09-24', lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 50_00 }], expenses: [], paidMinor: 0, notes: '' })
const saleArgs = { lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 100_00, unitCostMinor: 50_00, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true }
useDataStore.setState({ appUsers: [{ id: 7, nameAr: 'كاشير الاختبار', roleId: 'cashier', pinHash: 'hash', active: true }], currentUserId: 7 })
assert.throws(() => S().postSale(saleArgs), /لا يمكن للكاشير/, 'طبقة البيانات تمنع الكاشير بلا وردية')
ok('postSale يطبق منع الكاشير فعلياً حتى عند الوصول المباشر للنواة')
const shift = S().openShift('كاشير الاختبار', 0)
const sale = S().postSale(saleArgs)
assert.equal(sale.shiftId, shift.id)
ok('postSale يربط بيع الكاشير بالوردية المفتوحة')
useDataStore.setState({ appUsers: [], currentUserId: null })
const ownerSale = S().postSale(saleArgs)
assert.equal(ownerSale.shiftId, shift.id)
ok('المالك لا يُمنع عند وجود وردية، والبيع يستفيد من ربطها تلقائياً')

console.log(`\n✅ سياسة الورديات: ${pass} محطات — خضراء\n`)
