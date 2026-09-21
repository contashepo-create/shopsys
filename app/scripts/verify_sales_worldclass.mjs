/**
 * تحقق «مراجعة المبيعات مقابل البرامج العالمية» (طلب المالك):
 * 1) حارس حد الائتمان (نمط SAP B1/أودو): exceedsCreditLimit + CreditLimitError
 *    في postSale — البيع الآجل فوق الحد يُرفض، والتجاوز باعتماد مسجل على الفاتورة
 * 2) صلاحية sales.credit.override معرفة وحساسة، والمالك يملكها تلقائياً
 * 3) تعديل الفاتورة محروس بـ sales.price.edit (اعتماد مشرف في SalesInvoicesPage)
 * 4) الفواتير المعلقة تنجو من الإغلاق (localStorage — نمط Square parked sales)
 * 5) سلامة postSale الأساسية: قيد متوازن، تثبيت التكلفة لحظة الترحيل،
 *    عميل إلزامي للجزء الآجل، paid > total مرفوض
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/* بيئة صورية */
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

/* ═══ 1) النواة الخالصة: exceedsCreditLimit ═══ */
{
  const { exceedsCreditLimit, CreditLimitError } = await import(join(root, 'src/core/pos.ts'))
  assert.equal(exceedsCreditLimit(50000, 60000, 100000), true)
  ok('رصيد 500 + آجل جديد 600 > حد 1000 ⇒ تجاوز')
  assert.equal(exceedsCreditLimit(50000, 50000, 100000), false)
  ok('رصيد 500 + آجل 500 = حد 1000 بالضبط ⇒ يمر (الحد شامل)')
  assert.equal(exceedsCreditLimit(999999, 1, 0), false)
  ok('حد = 0 يعني بلا حد — لا فحص مهما بلغ الرصيد')
  assert.equal(exceedsCreditLimit(999999, 0, 100), false)
  ok('لا جزء آجل جديد (بيع نقدي كامل) ⇒ لا فحص')
  const err = new CreditLimitError('أحمد', 50000, 60000, 100000)
  assert.ok(err.message.includes('أحمد') && err.message.includes('1000.00'))
  assert.equal(err.name, 'CreditLimitError')
  ok('CreditLimitError برسالة عربية كاملة (الاسم/الرصيد/الجديد/الحد)')
}

/* ═══ 2) الصلاحية الجديدة ═══ */
{
  const { PERMISSIONS, DEFAULT_ROLES, effectivePermissionsFor } = await import(join(root, 'src/core/permissions.ts'))
  const p = PERMISSIONS.find((x) => x.id === 'sales.credit.override')
  assert.ok(p, 'sales.credit.override معرفة')
  assert.equal(p.sensitive, true)
  ok('صلاحية sales.credit.override معرفة وحساسة')
  const ownerPerms = effectivePermissionsFor(null, DEFAULT_ROLES)
  assert.ok(ownerPerms.has('sales.credit.override'))
  ok('المالك يملكها تلقائياً (ALL)')
  const cashier = DEFAULT_ROLES.find((r) => r.id === 'cashier')
  assert.ok(!cashier.permissions.includes('sales.credit.override'))
  ok('الكاشير الافتراضي لا يملكها — يحتاج اعتماد مشرف')
}

/* ═══ 3) التكامل: postSale مع حد الائتمان ═══ */
const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const st = () => useDataStore.getState()
const { CreditLimitError } = await import(join(root, 'src/core/pos.ts'))
{
  st().addItem({
    nameAr: 'صنف الائتمان', sku: 'CL-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 5000, stockQty: 100, priceMinor: 10000, minQty: 0,
    trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
    variantColors: [], variantSizes: [], isActive: true,
  })
  const item = st().items.at(-1)
  st().addCustomer({ nameAr: 'عميل محدود', phone: '0122', address: '', notes: '', openingMinor: 0, creditLimitMinor: 50000 })
  const cust = st().customers.at(-1)
  const line = (qty) => ({ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false })

  // بيع آجل 400 ≤ حد 500 يمر
  const s1 = st().postSale({ lines: [line(4)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  assert.equal(s1.totals.totalMinor, 40000)
  ok('بيع آجل 400 لعميل حده 500 — يمر (تحت الحد)')

  // بيع آجل إضافي 200: الرصيد 400 + 200 > 500 ⇒ CreditLimitError
  assert.throws(
    () => st().postSale({ lines: [line(2)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 }),
    (e) => e instanceof CreditLimitError && e.message.includes('عميل محدود'),
  )
  ok('بيع آجل إضافي 200 (المجموع 600 > 500) — CreditLimitError برسالة واضحة')

  // نفس البيع بتجاوز معتمد يمر ويُسجل المعتمد على الفاتورة
  const s2 = st().postSale({ lines: [line(2)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0, creditLimitOverrideBy: 'المدير أشرف' })
  assert.equal(s2.creditLimitOverrideBy, 'المدير أشرف')
  ok('التجاوز المعتمد يمر واسم المعتمد مسجل على الفاتورة')

  // الدفع المجزأ: الجزء الآجل فقط هو المفحوص — دفع كامل نقداً يمر رغم تخطي الحد
  const s3 = st().postSale({ lines: [line(3)], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(s3.paidMinor, s3.totals.totalMinor)
  ok('بيع نقدي كامل لنفس العميل يمر — الحارس يفحص الجزء الآجل فقط')

  // مرتجع على الحساب يحرر جزءاً من الحد ⇒ بيع آجل جديد يمر
  st().postSaleReturn({ saleId: s1.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'resellable' }], refund: 'credit', reason: 'إرجاع', reasonCode: 'other' })
  const s4 = st().postSale({ lines: [line(1)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  assert.equal(s4.totals.totalMinor, 10000)
  ok('مرتجع على الحساب حرر الحد — بيع آجل جديد يمر (تكامل المرتجعات مع الحارس)')

  // عميل بلا حد (0): لا فحص أبداً
  st().addCustomer({ nameAr: 'عميل مفتوح', phone: '0133', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const openCust = st().customers.at(-1)
  const s5 = st().postSale({ lines: [line(9)], customerId: openCust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 })
  assert.equal(s5.totals.totalMinor, 90000)
  ok('عميل بلا حد (0) — بيع آجل كبير يمر بلا فحص')
}

/* ═══ 4) فحص UI نصي ═══ */
{
  const pos = readFileSync(join(root, 'src/ui/pages/PosPage.tsx'), 'utf8')
  assert.ok(pos.includes('CreditLimitError') && pos.includes("useSupervisorApproval('sales.credit.override')"))
  ok('PosPage: حوار تجاوز حد الائتمان باعتماد مشرف')
  assert.ok(pos.includes('creditLimitOverrideBy'))
  ok('PosPage: يمرر اسم المعتمد للفاتورة')
  assert.ok(pos.includes('keptExpiry'))
  ok('PosPage: اعتماد الصلاحية المرافق لا يضيع عند اعتماد الائتمان (التجاوزان معاً)')
  assert.ok(pos.includes('shopsys-held-carts') && pos.includes('loadHeldCarts'))
  ok('PosPage: الفواتير المعلقة تنجو من الإغلاق (نمط Square parked sales)')

  const inv = readFileSync(join(root, 'src/ui/pages/SalesInvoicesPage.tsx'), 'utf8')
  assert.ok(inv.includes("useSupervisorApproval('sales.price.edit')") && inv.includes('editApproval.dialog'))
  ok('SalesInvoicesPage: تعديل الفاتورة محروس بصلاحية sales.price.edit / اعتماد مشرف')
}

/* ═══ 5) سلامة postSale الأساسية ═══ */
{
  const { buildSaleEntry, computeTotals } = await import(join(root, 'src/core/pos.ts'))
  const totals = computeTotals(
    [{ itemId: 1, nameAr: 'س', qty: 2, unitPriceMinor: 11400, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }],
    0, 14, true,
  )
  const lines = buildSaleEntry(totals, 'cash', '1101')
  const d = lines.reduce((a, l) => a + l.debit, 0)
  const c = lines.reduce((a, l) => a + l.credit, 0)
  assert.equal(d, c)
  ok('قيد البيع متوازن بنيوياً (شامل ض.ق.م 14٪ والتكلفة)')
  assert.throws(() => buildSaleEntry(totals, 'cash', '1101', totals.totalMinor + 1), /أكبر من إجمالي/)
  ok('مدفوع > الإجمالي مرفوض في النواة')
  // عميل إلزامي للجزء الآجل
  const item2 = st().items.at(-1)
  assert.throws(
    () => st().postSale({ lines: [{ itemId: item2.id, nameAr: item2.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 0 }),
    /عميل/,
  )
  ok('جزء آجل بلا عميل مرفوض — لا دين على «عميل نقدي»')
}

console.log(`\n✅ verify_sales_worldclass: ${pass}/${pass} فحصاً نجح`)
