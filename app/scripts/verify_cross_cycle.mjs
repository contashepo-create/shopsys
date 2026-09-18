/**
 * الدورة التجارية المتقاطعة (إعادة الفحص الشاملة بطلب المالك):
 * الأقسام الأربعة معاً على نفس الأصناف والأطراف — شراء ← بيع ← مرتجع بيع ← مرتجع شراء
 * والتحقق أن كل قسم لا يفسد الآخر:
 * X1) شراء بمصاريف ⇒ البيع يستخدم التكلفة المحملة (هامش صحيح لا هامش مضخم)
 * X2) مرتجع البيع يعيد البضاعة للمخزون بتكلفتها ⇒ يمكن إرجاعها للمورد بعد ذلك
 * X3) سقف مرتجع الشراء يحترم المخزون الحالي بعد بيع ومرتجع بيع متتاليين
 * X4) كشوف العميل والمورد معاً صحيحة بعد الدورة الكاملة
 * X5) 1103 الدفتري = المخزون الفعلي × المتوسط بعد كل خطوة من الدورة
 * X6) قائمة الدخل: الإيراد − المرتجعات − التكلفة = الهامش المتوقع بالقرش
 * X7) دورة ثانية بسعر شراء مختلف — المتوسط الجديد يسري على البيع التالي فقط
 * X8) الميزان متزن بعد كل شيء
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { customerStatement, supplierStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const invariant1103 = (label) => {
  const book = bal('1103')
  const calc = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  assert.ok(Math.abs(book - calc) <= Math.max(1, st().items.length) * 100, `${label}: 1103=${book} vs Σ=${calc}`)
}

/* تجهيز: مورد + عميل + صنف واحد يمر بالدورة كلها */
st().addSupplier({ nameAr: 'المورد المتقاطع', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'العميل المتقاطع', phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const cust = st().customers.at(-1)
st().addItem({ nameAr: 'غسالة', barcode: '', categoryId: null, unit: 'قطعة', costMinor: 0, priceMinor: 900000, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const item = st().items.at(-1)

/* ═══ X1) شراء 10 غسالات ×6000 + شحن 200 ⇒ محملة 620/قطعة ═══ */
const purchase = st().postPurchase({
  supplierId: sup.id, date: '2026-09-17',
  lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 600000 }],
  expenses: [{ nameAr: 'شحن', amountMinor: 200000, method: 'qty', paidBy: 'supplier' }],
  paidMinor: 0, notes: '',
})
{
  assert.equal(st().items.find((i) => i.id === item.id).costMinor, 620000)
  invariant1103('بعد الشراء')
  // بيع 4 آجل للعميل — التكلفة يجب أن تكون المحملة 620 لا 600
  const sale = st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 4, unitPriceMinor: 900000, unitCostMinor: st().items.find((i) => i.id === item.id).costMinor, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
  })
  assert.equal(bal('5101'), 4 * 620000)
  ok('X1: البيع حمل التكلفة المحملة بالشحن (620×4=2480) لا سعر الشراء الخام — الهامش غير مضخم')
  invariant1103('بعد البيع')
  ok('X1: 1103 = 6×620 بعد البيع — المخزون الدفتري يطابق الفعلي')

  /* ═══ X2) مرتجع بيع: العميل أعاد 1 سليمة ⇒ ترجع للمخزون بتكلفتها ═══ */
  st().postSaleReturn({
    saleId: sale.id,
    lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'credit', reason: 'مقاس غير مناسب', reasonCode: 'other', approvedBy: 'المشرف',
  })
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 7)
  assert.equal(bal('5101'), 3 * 620000) // التكلفة انعكست للقطعة المعادة
  ok('X2: مرتجع البيع أعاد القطعة للمخزون (7) وعكس تكلفتها من 5101 (تبقى 3×620)')
  invariant1103('بعد مرتجع البيع')
  ok('X2: 1103 يطابق 7×620 — القطعة المعادة قُيّمت بمتوسطها لا بسعر بيعها')
}

/* ═══ X3) مرتجع شراء بعد الدورة: السقف = المخزون الحالي ═══ */
{
  // المتبقي القابل للإرجاع من الفاتورة نظرياً 10، لكن بالمخزون 7 فقط (بيعت 3 صافي)
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 8]]), refund: 'debt', reason: 'x' }),
    /المخزون الحالي|القابل للإرجاع/,
  )
  ok('X3: إرجاع 8 للمورد مرفوض — بالمخزون 7 فقط بعد البيع ومرتجعه')
  const ret = st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 2]]), refund: 'debt', reason: 'فائض', approvedBy: 'المشرف' })
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 5)
  // G4: المورد يخصم من دينه سعر فاتورته 600×2 لا المحملة 620×2
  assert.equal(ret.supplierValueMinor, 2 * 600000)
  assert.equal(ret.totalMinor, 2 * 620000)
  ok('X3: مرتجع الشراء 2 — دين المورد نقص 1200 (سعره) والمخزون نقص 1240 (المحملة) والفرق 40 هالك 5111')
  invariant1103('بعد مرتجع الشراء')
  ok('X3: 1103 يطابق 5×620 بعد الدورة الكاملة')
}

/* ═══ X4) الكشوف بعد الدورة الكاملة ═══ */
{
  // العميل: اشترى 4×900=3600 آجل، أعاد 1×900 على الحساب ⇒ عليه 2700
  const cs = customerStatement({
    customerId: cust.id, openingMinor: 0,
    sales: st().sales, saleReturns: st().saleReturns, allSales: st().sales,
    vouchers: st().vouchers, cheques: st().cheques,
  })
  assert.equal(statementBalance(cs), 2700000)
  ok('X4: كشف العميل: عليه 2700 (3600 آجل − 900 مرتجع على الحساب)')
  // المورد: فاتورة 6200 آجلة − مرتجع debt بقيمة 1200 ⇒ له 5000
  const ss = supplierStatement({
    supplierId: sup.id, openingMinor: 0,
    purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases,
    vouchers: st().vouchers, cheques: st().cheques,
  })
  assert.equal(statementBalance(ss), 5000000)
  assert.equal(bal('2101'), -5000000)
  ok('X4: كشف المورد: له 5000 (6200 − مرتجع 1200) ويطابق حساب 2101 بالقرش')
  assert.equal(bal('1104'), 2700000)
  ok('X4: حساب العملاء 1104 = 2700 يطابق الكشف — القسمان مترابطان لا منفصلان')
}

/* ═══ X6) قائمة الدخل للدورة ═══ */
{
  // إيراد 4×900=3600 (4101)، مرتجعات 900 (4102 مدين)، تكلفة صافية 3×620=1860 (5101)، هالك 40 (5111)
  assert.equal(bal('4101'), -3600000)
  assert.equal(bal('4102'), 900000)
  assert.equal(bal('5101'), 1860000)
  assert.equal(bal('5111'), 40000)
  const netProfit = 3600000 - 900000 - 1860000 - 40000
  assert.equal(netProfit, 800000)
  ok('X6: قائمة الدخل: 3600 − 900 مرتجعات − 1860 تكلفة − 40 هالك = ربح 800 بالقرش')
}

/* ═══ X7) دورة ثانية بسعر مختلف — المتوسط يتحرك صحيحاً ═══ */
{
  // شراء 5 أخرى ×700 بلا مصاريف: المتوسط الجديد = (5×620 + 5×700)/10 = 660
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 700000 }], expenses: [], paidMinor: 0, notes: '' })
  const it = st().items.find((i) => i.id === item.id)
  assert.equal(it.costMinor, 660000)
  ok('X7: شراء ثانٍ ×700 — المتوسط (5×620+5×700)/10 = 660 بالضبط')
  // بيع 1 الآن يحمل 660
  const cogsBefore = bal('5101')
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 900000, unitCostMinor: it.costMinor, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(bal('5101') - cogsBefore, 660000)
  ok('X7: البيع بعد الشراء الثاني حمل المتوسط الجديد 660 — لا يلمس المبيعات السابقة')
  invariant1103('بعد الدورة الثانية')
  ok('X7: 1103 يطابق 9×660 — المخزون الدفتري سليم عبر الدورتين')
}

/* ═══ X8) توازن نهائي ═══ */
{
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`X8: كل قيود الدورة المتقاطعة (${st().journal.length}) متوازنة — لا قرش تائه بين الأقسام الأربعة`)
}

console.log(`\n✅ verify_cross_cycle: ${pass} تحققاً — شراء↔بيع↔مرتجعاتهما دورة واحدة مترابطة بلا تسريب`)
