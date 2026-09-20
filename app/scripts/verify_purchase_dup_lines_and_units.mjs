/**
 * 🧾 فحص دائم (تدقيق المالك — جولة الباركود والوحدات):
 * 1) فاتورة شراء بسطرين لنفس الصنف (سعران مختلفان) — كان السطر الثاني يضيع
 *    من المخزون والتكلفة (find بدل التجميع). الآن: الكمية تُجمع والتكلفة متوسط مرجح.
 * 2) مرتجع شراء من فاتورة بسطرين لنفس الصنف — التكلفة والسعر متوسط مرجح لا أول سطر.
 * 3) الشراء بوحدة كبرى (كرتونة ×12) بعد تحويلها للوحدة الأساسية + بيع بالقطعة
 *    وبالكرتونة (unitFactor) — المخزون بالقطعة دائماً وCOGS صحيح.
 * 4) الأرقام العشرية والعربية في toMinor.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_purchase_dup_lines_and_units.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { toMinor, normalizeDigits } = await import(join(root, 'src/core/money.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const ITEM = { categoryId: 1, minQty: 0, warrantyMonths: 0, variantColors: [], variantSizes: [], sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 }

console.log('\n═══ 1) سطران لنفس الصنف في فاتورة واحدة: يُجمعان لا يضيع ثانيهما ═══')
{
  st().addItem({ ...ITEM, nameAr: 'أرز مكرر', baseUnit: 'كيس', extraUnits: [], priceMinor: 1000, barcodes: ['R1'] })
  st().addSupplier({ nameAr: 'مورد', phone: '', notes: '', ...EXT })
  const it = st().items[0]
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-20', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [
    { itemId: it.id, qty: 10, unitPriceMinor: 500 },
    { itemId: it.id, qty: 20, unitPriceMinor: 600 },
  ] })
  const after = st().items[0]
  assert.equal(after.stockQty, 30, 'الكمية = مجموع السطرين')
  assert.equal(after.costMinor, Math.round((10 * 500 + 20 * 600) / 30), 'التكلفة = متوسط مرجح للسطرين')
  ok('شراء 10×5 + 20×6 لنفس الصنف: مخزون 30 وتكلفة 567 — لا سطر ضائع')
}

console.log('\n═══ 2) مرتجع من فاتورة بسطرين لنفس الصنف: بالمتوسط المرجح ═══')
{
  const it = st().items[0]
  const purchase = st().purchases[0]
  const stockBefore = st().items[0].stockQty
  const inv1103Before = st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '1103').reduce((s, l) => s + l.debit - l.credit, 0)
  st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[it.id, 6]]), refund: 'debt', reason: 'تالف', treasury: '1101' })
  assert.equal(st().items[0].stockQty, stockBefore - 6)
  const inv1103After = st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '1103').reduce((s, l) => s + l.debit - l.credit, 0)
  // خرج بالمتوسط 567×6 لا بسعر أول سطر 500×6
  assert.equal(inv1103Before - inv1103After, 6 * 567, 'المرتجع خرج بالمتوسط المرجح لا بسعر أول سطر')
  ok('مرتجع 6 من فاتورة بسعرين: خرج من 1103 بـ567×6 (المتوسط) لا 500×6')
}

console.log('\n═══ 3) الشراء بالكرتونة والبيع بالقطعة وبالكرتونة ═══')
{
  st().addItem({ ...ITEM, nameAr: 'مياه', baseUnit: 'زجاجة', extraUnits: [{ nameAr: 'كرتونة', factor: 12, barcode: '999000111', priceMinor: 5500 }], priceMinor: 500, barcodes: ['888000111'] })
  const it = st().items[1]
  // «5 كرتونة × 36ج» بعد تحويل الواجهة (toBaseLine): 60 زجاجة × 3ج
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-20', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: it.id, qty: 60, unitPriceMinor: 300 }] })
  assert.equal(st().items[1].stockQty, 60)
  assert.equal(st().items[1].costMinor, 300)
  // البحث بباركود الكرتونة (منطق الكاشير وشاشة الشراء)
  const found = st().items.find((x) => x.extraUnits.some((u) => u.barcode === '999000111'))
  assert.equal(found.id, it.id, 'باركود كرتونة المصنع يجد الصنف')
  // بيع زجاجة بباركود القطعة ثم كرتونة كاملة
  const cost = st().items[1].costMinor
  st().postSale({ lines: [{ itemId: it.id, nameAr: 'مياه', qty: 1, unitPriceMinor: 500, unitCostMinor: cost, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false })
  st().postSale({ lines: [{ itemId: it.id, nameAr: 'مياه كرتونة', qty: 1, unitPriceMinor: 5500, unitCostMinor: cost * 12, discountPercent: 0, soldByWeight: false, unitName: 'كرتونة', unitFactor: 12 }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false })
  assert.equal(st().items[1].stockQty, 60 - 1 - 12, 'المخزون بالقطعة: 47')
  const lastSale = st().sales.at(-1)
  const cogs = st().journal.find((e) => e.sourceType === 'sale' && e.sourceId === lastSale.id).lines.filter((l) => l.accountCode === '5101').reduce((s, l) => s + l.debit, 0)
  assert.equal(cogs, cost * 12, 'تكلفة الكرتونة بالقيد = 12×تكلفة الزجاجة')
  ok('شراء 5 كراتين مفكوكة (60×3ج) وبيع زجاجة + كرتونة: مخزون 47 وCOGS دقيق')
}

console.log('\n═══ 4) الأرقام العشرية والعربية ═══')
{
  assert.equal(toMinor('2.75', 2), 275)
  assert.equal(toMinor('٢٫٧٥', 2), 275, 'أرقام عربية وفاصلة عربية')
  assert.equal(toMinor('1,250.50', 2), 125050, 'فواصل آلاف')
  assert.equal(toMinor('1e5', 2), 10000000, 'ترميز علمي يُحوَّل بدقة')
  assert.equal(normalizeDigits('٣٤٥'), '345')
  assert.throws(() => toMinor('abc', 2), 'نص غير رقمي يُرفض')
  ok('toMinor: عشري/عربي/فواصل/علمي كلها دقيقة والنص الفاسد مرفوض')
}

console.log(`\n✅ فحص الشراء المكرر والوحدات: ${pass} محطات — كلها خضراء\n`)
