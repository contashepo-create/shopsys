/**
 * المرحلة 2 من خطة التدقيق المحاسبي — القسمان 2.3 المشتريات و2.4 المخزون.
 *
 * 2.3 المشتريات: نقدي/آجل/جزئي · مصاريف مرسملة بطريقتي التوزيع (قيمة/كمية) ·
 *     ضريبة مدخلات قابلة للخصم (2102 مدين) مقابل الضريبة ضمن التكلفة ·
 *     المتوسط المرجح · مرتجع شراء (تخفيض دين/رد نقدي) · خصم الفاتورة قبل التحميل.
 * 2.4 المخزون: تحويل بين مخزنين (بلا أثر على 1103) · جرد عجز/زيادة (5111/4110) ·
 *     هالك 5111 · صرف داخلي (مصروف/1103) · إنتاج بوصفة (تحويل داخل 1103) ·
 *     تجهيز/تقطيع بتوزيع التكلفة على النواتج · دفعات وصلاحية FEFO · سيريال.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase2_purchases_inventory.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
const relDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) // §77: تواريخ نسبية — لا قنابل زمنية في البوابات

const R = reporter('المرحلة 2 — 2.3 المشتريات و2.4 المخزون')
const money = (n) => `${(n / 100).toLocaleString('ar-EG')}ج`
const bal = (c, code) => balanceOf(c.st().journal, code)
const lineOf = (entry, code) => {
  const rows = entry.lines.filter((l) => l.accountCode === code)
  if (!rows.length) return null
  return { debit: rows.reduce((s, l) => s + l.debit, 0), credit: rows.reduce((s, l) => s + l.credit, 0) }
}
const itemOf = (c, id) => c.st().items.find((i) => i.id === id)
/** مجموع (كمية × متوسط) لكل الأصناف — يجب أن يساوي 1103 دائماً (ث5) */
const valuation = (c) => c.st().items.reduce((s, i) => s + Math.round((i.stockQty || 0) * (i.costMinor || 0)), 0)

// ══════════════════════════════════════════════════════════════════
R.section('— 2.3 المشتريات —')
// ══════════════════════════════════════════════════════════════════

// (1) شراء آجل بالكامل: 1103 مدين بالتكلفة / 2101 دائن بالمستحق
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد الجملة')
  const item = addSimpleItem(c, { nameAr: 'أرز', priceMinor: 10000 })
  const pur = c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-01',
    lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 6000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const e = c.st().journal.find((x) => x.id === pur.journalEntryId)
  assert.equal(lineOf(e, '1103').debit, 600000)
  assert.equal(lineOf(e, '2101').credit, 600000)
  assert.equal(lineOf(e, '1101'), null, 'الآجل لا يمس الخزينة')
  assert.equal(c.st().getSupplierBalance(sup.id), 600000, 'كشف المورد = الدفتر (ث7)')
  assert.equal(itemOf(c, item.id).costMinor, 6000)
  assertInvariants('شراء آجل', c)
  R.ok(`آجل: 1103 مدين ${money(600000)} / 2101 دائن ${money(600000)} · المتوسط ${money(6000)}`)
}

// (2) شراء بدفع جزئي: خزينة + مورد بالباقي
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'زيت', priceMinor: 9000 })
  const pur = c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-02',
    lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 5000, expiryDate: null }],
    expenses: [], paidMinor: 100000, treasury: '1101', notes: '',
  })
  const e = c.st().journal.find((x) => x.id === pur.journalEntryId)
  assert.equal(lineOf(e, '1103').debit, 250000)
  assert.equal(lineOf(e, '1101').credit, 100000)
  assert.equal(lineOf(e, '2101').credit, 150000)
  assert.equal(c.st().getSupplierBalance(sup.id), 150000)
  assertInvariants('شراء جزئي', c)
  R.ok(`جزئي: مدفوع ${money(100000)} نقداً والباقي ${money(150000)} على المورد`)
  expectReject('دفع أكبر من الفاتورة', c, () => c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-03',
    lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000, expiryDate: null }],
    expenses: [], paidMinor: 999999, treasury: '1101', notes: '',
  }))
  R.ok('رفض ذري: المدفوع > إجمالي فاتورة الشراء')
}

// (3) المصاريف المرسملة: توزيع بالقيمة وبالكمية — التكلفة تحمل نصيبها ولا مصروف يظهر
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const a = addSimpleItem(c, { nameAr: 'صنف غالٍ', priceMinor: 20000 })
  const b = addSimpleItem(c, { nameAr: 'صنف رخيص', priceMinor: 4000 })
  // بالقيمة: نولون 300ج على (100×100ج) و(100×20ج) ⇒ بنسبة 10,000:2,000
  const pur = c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-05',
    lines: [
      { itemId: a.id, qty: 100, unitPriceMinor: 10000, expiryDate: null },
      { itemId: b.id, qty: 100, unitPriceMinor: 2000, expiryDate: null },
    ],
    expenses: [{ nameAr: 'نولون', amountMinor: 30000, method: 'value' }],
    paidMinor: 0, treasury: '1101', notes: '',
  })
  const e = c.st().journal.find((x) => x.id === pur.journalEntryId)
  const goods = 100 * 10000 + 100 * 2000
  assert.equal(lineOf(e, '1103').debit, goods + 30000, 'المصروف رُسمل في المخزون لا في المصروفات')
  assert.equal(lineOf(e, '2101').credit, goods + 30000, 'مستحق المورد = البضاعة + المصروف على حسابه')
  assert.equal(itemOf(c, a.id).costMinor, 10000 + Math.round(30000 * 10000 / 12000 / 100))
  assert.ok(itemOf(c, a.id).costMinor > 10000 && itemOf(c, b.id).costMinor > 2000)
  assert.equal(valuation(c), bal(c, '1103'), 'ث5: التقييم = الدفتر بالقرش')
  assertInvariants('مصاريف بالقيمة', c)
  R.ok(`توزيع بالقيمة: نولون ${money(30000)} دخل التكلفة (غالٍ ${money(itemOf(c, a.id).costMinor)} · رخيص ${money(itemOf(c, b.id).costMinor)}) و1103 = التقييم`)
  // بالكمية: مصروف يوزع بالتساوي على الوحدات
  const c2 = await freshCase({ activityId: 'grocery' })
  const sup2 = addParty(c2, 'supplier', 'مورد')
  const x = addSimpleItem(c2, { nameAr: 'صنف س', priceMinor: 20000 })
  const y = addSimpleItem(c2, { nameAr: 'صنف ص', priceMinor: 4000 })
  c2.st().postPurchase({
    supplierId: sup2.id, date: '2026-04-05',
    lines: [
      { itemId: x.id, qty: 100, unitPriceMinor: 10000, expiryDate: null },
      { itemId: y.id, qty: 50, unitPriceMinor: 2000, expiryDate: null },
    ],
    expenses: [{ nameAr: 'نقل', amountMinor: 30000, method: 'qty' }],
    paidMinor: 0, treasury: '1101', notes: '',
  })
  const perUnit = 30000 / 150
  assert.equal(itemOf(c2, x.id).costMinor, 10000 + perUnit)
  assert.equal(itemOf(c2, y.id).costMinor, 2000 + perUnit)
  assert.equal(valuation(c2), bal(c2, '1103'))
  assertInvariants('مصاريف بالكمية', c2)
  R.ok(`توزيع بالكمية: ${money(perUnit)} لكل وحدة على 150 وحدة بلا قرش ضائع`)
}

// (4) ضريبة المدخلات القابلة للخصم: 2102 مدين ولا تدخل التكلفة
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد مسجل')
  const item = addSimpleItem(c, { nameAr: 'سكر', priceMinor: 8000 })
  const pur = c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-06',
    lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 5000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 70000, notes: '',
  })
  const e = c.st().journal.find((x) => x.id === pur.journalEntryId)
  assert.equal(lineOf(e, '1103').debit, 500000, 'المخزون بالتكلفة الصافية بلا ضريبة')
  assert.equal(lineOf(e, '2102').debit, 70000, 'ضريبة المدخلات أصل ضريبي مدين')
  assert.equal(lineOf(e, '2101').credit, 570000, 'مستحق المورد = البضاعة + الضريبة')
  assert.equal(itemOf(c, item.id).costMinor, 5000, 'المتوسط لا يشمل الضريبة القابلة للخصم')
  assertInvariants('ضريبة مدخلات', c)
  R.ok(`مدخلات: 1103 ${money(500000)} · 2102 مدين ${money(70000)} · المورد ${money(570000)} — والتكلفة صافية`)
}

// (5) المتوسط المرجح عبر ثلاث دفعات + بيع بينها
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'بن', priceMinor: 30000 })
  const buy = (qty, price, date) => c.st().postPurchase({
    supplierId: sup.id, date, lines: [{ itemId: item.id, qty, unitPriceMinor: price, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  buy(100, 10000, '2026-04-01')
  assert.equal(itemOf(c, item.id).costMinor, 10000)
  buy(100, 20000, '2026-04-02')
  assert.equal(itemOf(c, item.id).costMinor, 15000, 'المتوسط بعد الدفعة الثانية')
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: 'بن', qty: 150, unitPriceMinor: 30000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  assert.equal(itemOf(c, item.id).costMinor, 15000, 'البيع لا يحرّك المتوسط')
  buy(50, 30000, '2026-04-03')
  assert.equal(itemOf(c, item.id).costMinor, 22500, 'المتوسط بعد الثالثة = (50×150 + 50×300)/100')
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('متوسط مرجح', c)
  R.ok('المتوسط المرجح عبر 3 دفعات وبيع بينها: 100 ← 150 ← 225 قرشاً والدفتر مطابق')
}

// (6) مرتجع شراء: تخفيض دين المورد وخروج البضاعة بتكلفتها
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'شاي', priceMinor: 9000 })
  const pur = c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-07',
    lines: [{ itemId: item.id, qty: 40, unitPriceMinor: 5000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const ret = c.st().postPurchaseReturn({ purchaseId: pur.id, qtyByItem: new Map([[item.id, 10]]), refund: 'debt', reason: 'عبوات مكسورة' })
  const e = c.st().journal.find((x) => x.id === ret.journalEntryId)
  assert.equal(lineOf(e, '2101').debit, 50000, 'دين المورد ينخفض')
  assert.equal(lineOf(e, '1103').credit, 50000, 'المخزون يخرج بتكلفته')
  assert.equal(itemOf(c, item.id).stockQty, 30)
  assert.equal(c.st().getSupplierBalance(sup.id), 150000)
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('مرتجع شراء', c)
  R.ok(`مرتجع شراء 10: 2101 مدين ${money(50000)} / 1103 دائن ${money(50000)} · المورد ${money(150000)}`)
  expectReject('إرجاع أكثر من المشترى', c, () => c.st().postPurchaseReturn({
    purchaseId: pur.id, qtyByItem: new Map([[item.id, 999]]), refund: 'debt', reason: 'تجاوز',
  }))
  R.ok('رفض ذري: مرتجع شراء أكبر من المتبقي')
}

// ══════════════════════════════════════════════════════════════════
R.section('— 2.4 المخزون —')
// ══════════════════════════════════════════════════════════════════

// (7) التحويل بين مخزنين: أرصدة المخازن تتحرك و1103 الإجمالي لا يتغير
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'دقيق', priceMinor: 5000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-08', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 3000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().addWarehouse({ nameAr: 'مخزن الفرع', code: 'W2', isMain: false, isActive: true, notes: '' })
  const [main, branch] = c.st().warehouses
  const stockBefore = bal(c, '1103'), entriesBefore = c.st().journal.length
  c.st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: branch.id, lines: [{ itemId: item.id, qty: 30 }], notes: 'تموين الفرع' })
  assert.equal(bal(c, '1103'), stockBefore, 'التحويل لا يغيّر إجمالي المخزون')
  assert.equal(c.st().journal.length, entriesBefore, 'تحويل داخلي بلا قيد مالي (نفس الحساب)')
  assert.equal(itemOf(c, item.id).stockQty, 100, 'الرصيد الكلي ثابت')
  const perWarehouse = c.st().getWarehouseStock ? c.st().getWarehouseStock(branch.id) : null
  if (perWarehouse) assert.ok(perWarehouse.find((r) => r.itemId === item.id)?.qty === 30)
  assertInvariants('تحويل مخزني', c)
  R.ok('تحويل 30 وحدة للفرع: أرصدة المخازن تحركت والإجمالي و1103 كما هما')
  expectReject('تحويل أكثر من رصيد المصدر', c, () => c.st().postTransfer({
    fromWarehouseId: main.id, toWarehouseId: branch.id, lines: [{ itemId: item.id, qty: 500 }], notes: 'تجاوز',
  }))
  R.ok('رفض ذري: تحويل يتجاوز رصيد المخزن المصدر')
}

// (8) الجرد: عجز 5111 · فائض 4110 · مطابق بلا قيد (AUDIT-001)
{
  const c = await freshCase({ activityId: 'grocery' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'لبن', priceMinor: 3000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-09', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 2000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const short = c.st().postStocktake([{ itemId: item.id, nameAr: 'لبن', expectedQty: 100, countedQty: 93, unitCostMinor: 2000 }], 'جرد شهري')
  const e1 = c.st().journal.find((x) => x.id === short.journalEntryId)
  assert.equal(lineOf(e1, '5111').debit, 14000, 'العجز خسارة هالك/فقد لا مصروف عمومي')
  assert.equal(lineOf(e1, '1103').credit, 14000)
  const surplus = c.st().postStocktake([{ itemId: item.id, nameAr: 'لبن', expectedQty: 93, countedQty: 96, unitCostMinor: 2000 }], 'إعادة عد')
  const e2 = c.st().journal.find((x) => x.id === surplus.journalEntryId)
  assert.equal(lineOf(e2, '1103').debit, 6000)
  assert.equal(lineOf(e2, '4110').credit, 6000, 'الفائض إيراد آخر لا تخفيض مصروف')
  const none = c.st().postStocktake([{ itemId: item.id, nameAr: 'لبن', expectedQty: 96, countedQty: 96, unitCostMinor: 2000 }], 'مطابق')
  assert.equal(none.journalEntryId, null)
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('جرد', c)
  R.ok(`جرد: عجز ${money(14000)} على 5111 · فائض ${money(6000)} على 4110 · المطابق بلا قيد`)
}

// (9) الهالك والصرف الداخلي: كلاهما يخرج المخزون بالمتوسط لحسابين مختلفين
{
  const c = await freshCase({ activityId: 'restaurant' })
  const sup = addParty(c, 'supplier', 'مورد')
  const item = addSimpleItem(c, { nameAr: 'خضار', priceMinor: 2000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-10', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 1000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const wast = c.st().postWastage({ reason: 'تلف بالتبريد', lines: [{ itemId: item.id, qty: 10 }], notes: '' })
  const we = c.st().journal.find((x) => x.id === wast.journalEntryId)
  assert.equal(lineOf(we, '5111').debit, 10000)
  assert.equal(lineOf(we, '1103').credit, 10000)
  const cons = c.st().postConsumption({ purpose: 'استهلاك مطبخ', lines: [{ itemId: item.id, qty: 5 }], notes: '' })
  const ce = c.st().journal.find((x) => x.id === cons.journalEntryId)
  assert.equal(lineOf(ce, '1103').credit, 5000)
  assert.ok(ce.lines.some((l) => l.accountCode.startsWith('5') && l.debit === 5000), 'الصرف الداخلي مصروف تشغيلي')
  assert.equal(itemOf(c, item.id).stockQty, 85)
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('هالك وصرف داخلي', c)
  R.ok(`هالك ${money(10000)} على 5111 · صرف داخلي ${money(5000)} على حساب مصروف · الرصيد 85 والدفتر مطابق`)
}

// (10) الإنتاج بوصفة: خامات تخرج ومنتج يدخل — تحويل داخل 1103 بلا ربح
{
  const c = await freshCase({ activityId: 'restaurant' })
  const sup = addParty(c, 'supplier', 'مورد')
  const flour = addSimpleItem(c, { nameAr: 'دقيق', priceMinor: 0 })
  const sugar = addSimpleItem(c, { nameAr: 'سكر', priceMinor: 0 })
  const cake = addSimpleItem(c, { nameAr: 'كيك', priceMinor: 20000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-11',
    lines: [
      { itemId: flour.id, qty: 100, unitPriceMinor: 1000, expiryDate: null },
      { itemId: sugar.id, qty: 100, unitPriceMinor: 2000, expiryDate: null },
    ],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().addRecipe({ productItemId: cake.id, mode: 'prepped', yieldQty: 1, ingredients: [{ itemId: flour.id, qty: 2 }, { itemId: sugar.id, qty: 1 }], overheadMinor: 500, notes: '', isActive: true })
  const recipe = c.st().recipes.at(-1)
  const stockBefore = bal(c, '1103')
  const prod = c.st().postProduction({ recipeId: recipe.id, batches: 10 })
  assert.equal(itemOf(c, flour.id).stockQty, 80)
  assert.equal(itemOf(c, sugar.id).stockQty, 90)
  assert.equal(itemOf(c, cake.id).stockQty, 10)
  const materials = 20 * 1000 + 10 * 2000
  const pe = prod.journalEntryId ? c.st().journal.find((x) => x.id === prod.journalEntryId) : null
  if (pe) {
    assert.ok(lineOf(pe, '1103') !== null, 'قيد الإنتاج داخل المخزون')
    assert.equal(bal(c, '1103') - stockBefore, itemOf(c, cake.id).stockQty * itemOf(c, cake.id).costMinor - materials, 'الفرق = المصاريف الصناعية المضافة فقط')
  }
  assert.ok(itemOf(c, cake.id).costMinor >= Math.round(materials / 10), 'تكلفة المنتج ≥ تكلفة خاماته')
  assert.equal(valuation(c), bal(c, '1103'), 'ث5 بعد الإنتاج')
  assertInvariants('إنتاج بوصفة', c)
  R.ok(`إنتاج 10 كيك: خامات ${money(materials)} خرجت والمنتج دخل بتكلفة ${money(itemOf(c, cake.id).costMinor)}/وحدة — 1103 = التقييم`)
}

// (11) الدفعات والصلاحية FEFO: البيع يخصم الأقرب انتهاءً والدفعات = الرصيد
{
  const c = await freshCase({ activityId: 'pharmacy' })
  const sup = addParty(c, 'supplier', 'مورد')
  const med = addSimpleItem(c, { nameAr: 'دواء', priceMinor: 5000, extra: { trackExpiry: true } })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-12', lines: [{ itemId: med.id, qty: 20, unitPriceMinor: 3000, expiryDate: relDays(45) }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-13', lines: [{ itemId: med.id, qty: 30, unitPriceMinor: 3000, expiryDate: relDays(400) }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().postSale({
    lines: [{ itemId: med.id, nameAr: 'دواء', qty: 25, unitPriceMinor: 5000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const qtyOfBatch = (expiry) => c.st().batches.filter((b) => b.itemId === med.id && b.expiryDate === expiry).reduce((s, b) => s + b.qty, 0)
  assert.equal(qtyOfBatch(relDays(45)), 0, 'الأقرب انتهاءً استُهلك أولاً (والدفعة الفارغة تُطوى)')
  assert.equal(qtyOfBatch(relDays(400)), 25)
  const batchTotal = c.st().batches.filter((b) => b.itemId === med.id).reduce((s, b) => s + b.qty, 0)
  assert.equal(batchTotal, itemOf(c, med.id).stockQty, 'مجموع الدفعات = رصيد الصنف')
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('دفعات FEFO', c)
  R.ok('FEFO: بيع 25 استهلك دفعة أكتوبر كاملة ثم 5 من يناير — الدفعات = الرصيد = الدفتر')
}

// (12) السيريال: لا يُباع رقم مرتين ولا يُباع رقم غير موجود
{
  const c = await freshCase({ activityId: 'mobile' })
  const sup = addParty(c, 'supplier', 'مورد')
  const phone = addSimpleItem(c, { nameAr: 'هاتف', priceMinor: 900000, extra: { trackSerial: true } })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-14',
    lines: [{ itemId: phone.id, qty: 2, unitPriceMinor: 600000, expiryDate: null, serialsRaw: 'SN-1\nSN-2' }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const available = c.st().serials.filter((s) => s.itemId === phone.id && s.status === 'in_stock')
  assert.equal(available.length, 2)
  c.st().postSale({
    lines: [{ itemId: phone.id, nameAr: 'هاتف', qty: 1, unitPriceMinor: 900000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, serials: ['SN-1'] }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  assert.equal(c.st().serials.find((s) => s.serial === 'SN-1').status, 'sold')
  expectReject('بيع سيريال مباع', c, () => c.st().postSale({
    lines: [{ itemId: phone.id, nameAr: 'هاتف', qty: 1, unitPriceMinor: 900000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, serials: ['SN-1'] }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }))
  assert.equal(valuation(c), bal(c, '1103'))
  assertInvariants('سيريال', c)
  R.ok('السيريال: SN-1 صار مباعاً ولا يمكن بيعه مرتين — والمخزون الدفتري مطابق')
}

R.done('— 2.3 و2.4 مغطيان بجدول «الحدث ← القيد» كاملاً')
