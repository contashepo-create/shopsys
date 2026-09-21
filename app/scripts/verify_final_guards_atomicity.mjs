/**
 * 🛡️ الفحص الختامي 2/3 — حراس المدخلات الفاسدة + ذرية الحالة:
 * منهجية مختلفة: كل محاولة فاشلة يجب أن تترك الحالة **بلا أي أثر** —
 * نلتقط بصمة الحالة قبل الهجوم ونطابقها بعده حرفياً.
 * 1) حارس الخزينة السالبة (الإعداد الافتراضي: ممنوع) — الرفض ذري.
 * 2) حارس حد الائتمان + حارس أرضية سعر البيع + مخزون غير كافٍ — كلها ذرية.
 * 3) مدخلات فاسدة: كميات سالبة/صفرية، مبالغ كسرية، خصم فوق 100.
 * 4) حارس السحب فوق المستحق في الشراء والتحصيل فوق الذمة.
 * 5) 3 عمليات سليمة وسط الهجمات تمر — الحراس لا يمنعون الشرعي.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_final_guards_atomicity.mjs
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
// ⚠️ هنا عمداً: allowNegativeTreasury غير مفعّل (الافتراضي ممنوع) لفحص الحارس المركزي
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'clothing', vatPercent: 14, taxInclusive: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

/** بصمة الحالة الكاملة: كل ما يتغير بالعمليات المالية */
const snapshot = () => JSON.stringify({
  journal: st().journal, items: st().items, sales: st().sales, purchases: st().purchases,
  customers: st().customers, suppliers: st().suppliers, vouchers: st().vouchers,
  batches: st().batches, cheques: st().cheques, installmentPlans: st().installmentPlans,
})
/** هجوم ذري: يجب أن يرمي، ويجب ألا يتغير أي شيء في الحالة */
const atomicAttack = (fn, pattern) => {
  const before = snapshot()
  if (pattern) assert.throws(fn, pattern)
  else assert.throws(fn)
  assert.equal(snapshot(), before, 'الهجوم الفاشل ترك أثراً في الحالة!')
}

console.log('\n═══ 1) حارس الخزينة السالبة الافتراضي — والرفض ذري ═══')
{
  // الخزينة صفر: أي صرف يجعلها سالبة يُرفض بالكامل
  atomicAttack(() => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: 50000, description: 'إيجار بلا رصيد' }), /سالباً/)
  // تمويل: 3000 في الخزينة
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 300000, description: 'رأس مال' })
  // صرف 3001 مرفوض، و2999 يمر
  atomicAttack(() => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: 300001, description: 'قرش فوق الرصيد' }), /سالباً/)
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: 299900, description: 'ضمن الرصيد' })
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 1000000, description: 'تمويل التشغيل' })
  ok('الحارس المركزي: قرش واحد فوق الرصيد يرفض العملية كاملة ذرياً — والضمن يمر')
}

// تجهيز أصناف وأطراف
st().addItem({ nameAr: 'قميص كلاسيك', categoryId: null, unit: 'قطعة', priceMinor: 30000, barcode: 'SH1', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 22000, costMinor: 0, stockQty: 0 })
st().addSupplier({ nameAr: 'مصنع النسيج', phone: '', notes: '', ...EXT })
st().addCustomer({ nameAr: 'محل الحي', phone: '', creditLimitMinor: 50000, notes: '', ...EXT })
const item = st().items[0]
const supplier = st().suppliers[0]
const customer = st().customers[0]
st().postPurchase({ supplierId: supplier.id, date: '2026-09-10', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 18000 }] })
const cost = st().items[0].costMinor

console.log('\n═══ 2) حد الائتمان + أرضية السعر + المخزون — كلها ذرية ═══')
{
  const mkLine = (qty, price, disc = 0) => [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: disc, soldByWeight: false }]
  const base = { payment: 'credit', treasury: '1101', customerId: customer.id, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }
  // آجل 900 وحد العميل 500 — مرفوض ذرياً
  atomicAttack(() => st().postSale({ ...base, lines: mkLine(3, 30000) }))
  // بيع تحت الأرضية 220: سعر 200 مرفوض — وخصم يكسر الأرضية مرفوض أيضاً
  atomicAttack(() => st().postSale({ ...base, payment: 'cash', lines: mkLine(1, 20000) }))
  atomicAttack(() => st().postSale({ ...base, payment: 'cash', lines: mkLine(1, 30000, 30) }))
  // مخزون 50: بيع 51 مرفوض ذرياً
  atomicAttack(() => st().postSale({ ...base, payment: 'cash', lines: mkLine(51, 30000) }))
  // تجاوز الحد بموافقة مدير يمر (الصلاحية المعممة)
  st().postSale({ ...base, lines: mkLine(3, 30000), creditLimitOverrideBy: 'المدير العام' })
  ok('حد الائتمان وأرضية السعر (سعراً وخصماً) والمخزون: رفض ذري — والتجاوز بموافقة موثقة يمر')
}

console.log('\n═══ 3) مدخلات فاسدة: سوالب/أصفار/كسور/خصم فوق 100 ═══')
{
  const base = { payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }
  const mk = (qty, price, disc = 0) => [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: disc, soldByWeight: false }]
  atomicAttack(() => st().postSale({ ...base, lines: mk(-2, 30000) }))
  atomicAttack(() => st().postSale({ ...base, lines: mk(0, 30000) }))
  atomicAttack(() => st().postSale({ ...base, lines: mk(1, -500) }))
  atomicAttack(() => st().postSale({ ...base, lines: mk(1, 30000, 150) }))
  atomicAttack(() => st().postSale({ ...base, lines: [] }))
  // شراء فاسد: كمية سالبة وسعر كسري
  atomicAttack(() => st().postPurchase({ supplierId: supplier.id, date: '2026-09-11', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: -5, unitPriceMinor: 18000 }] }))
  atomicAttack(() => st().postPurchase({ supplierId: supplier.id, date: '2026-09-11', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 100.75 }] }))
  // سند بمبلغ سالب/صفري/كسري
  atomicAttack(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: -100, description: 'سالب' }))
  atomicAttack(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 0, description: 'صفر' }))
  atomicAttack(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 99.5, description: 'كسر' }))
  ok('10 هجمات مدخلات فاسدة (بيع/شراء/سند) — كلها مرفوضة ذرياً بلا أي أثر')
}

console.log('\n═══ 4) السحب فوق المستحق والتحصيل فوق الذمة ═══')
{
  // شراء 100 بسداد 150 — مرفوض
  atomicAttack(() => st().postPurchase({ supplierId: supplier.id, date: '2026-09-12', treasury: '1101', notes: '', paidMinor: 15000, expenses: [], lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 2000 }] }))
  // بيع نقدي بدفع مجزأ فوق الإجمالي — مرفوض
  atomicAttack(() => st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 30000, unitCostMinor: cost, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false, paidMinor: 40000 }))
  ok('سداد شراء فوق المستحق ودفع بيع فوق الإجمالي — مرفوضان ذرياً')
}

console.log('\n═══ 5) الشرعي يمر وسط الهجمات + سلامة ختامية ═══')
{
  const sale = st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 30000, unitCostMinor: cost, discountPercent: 10, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
  assert.ok(sale.totals.totalMinor > 0)
  st().postPurchase({ supplierId: supplier.id, date: '2026-09-13', treasury: '1101', notes: '', paidMinor: 50000, expenses: [], lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 19000 }] })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 30000, description: 'دفعة للمصنع', partyKind: 'supplier', partyId: supplier.id })
  // سلامة: كل قيد متوازن، أعداد صحيحة، الميزان صفر
  let d = 0, c = 0
  for (const e of st().journal) {
    for (const l of e.lines) {
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit) && l.debit >= 0 && l.credit >= 0)
      d += l.debit; c += l.credit
    }
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0))
  }
  assert.equal(d, c)
  // المخزون النهائي منطقي: 50 − 3 − 1×... تحقق فعلي
  const it = st().items[0]
  assert.equal(it.stockQty, 50 - 3 - 2 + 10, 'المخزون = المشتريات − المبيعات بدقة')
  ok(`3 عمليات شرعية مرت وسط 16 هجمة، ${st().journal.length} قيداً متزنة (${d})، والمخزون ${it.stockQty} مطابق`)
}

console.log(`\n✅ الفحص الختامي 2/3 (الحراس والذرية): ${pass} محطات — كلها خضراء\n`)
