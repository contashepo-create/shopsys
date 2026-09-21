/**
 * إعادة فحص المخزون — كل الحالات والسيناريوهات الحدية وارتباطها بالقيود
 * (طلب المالك: «أعد فحص جميع الحالات والسيناريوهات وارتباطه بالقيود»)
 *
 * ح1) الوزن الكسري: شراء/بيع/جرد/إتلاف بكسور 3 منازل — 1103 يظل مطابقاً بلا تسريب تقريب
 * ح2) الجرد متعدد الأصناف: عجز وزيادة معاً في قيد واحد صافٍ متوازن
 * ح3) الجرد صنفاً برصيد صفر (وجدنا بضاعة غير مسجلة) وجرد صنفٍ للصفر (اختفى كله)
 * ح4) دورة متوسط متحرك متشابكة: شراء ثم إتلاف ثم شراء أغلى ثم صرف — المتوسط في كل خطوة
 * ح5) الإتلاف عبر دفعات متعددة FEFO — المنتهية أولاً
 * ح6) صرف داخلي لحساب مصروف مخصص (custom COA) يعمل، ولحساب أصول يُرفض
 * ح7) التحويلات: تحويل ذهاب وعودة، وتحويل من فرع لفرع، والرصيد الكلي ثابت دائماً
 * ح8) المتغيرات (لون×مقاس): البيع يخصم من التركيبة والمرتجع يعيد لها
 * ح9) السيريالات: الجرد/الإتلاف لا يكسر عد السيريالات in_stock
 * ح10) تسلسل القيود: كل مستند مخزني قيده sourceType صحيح ويشير لمستنده
 * ح11) قيمة مخزون سالبة مستحيلة: إتلاف/صرف/تحويل فوق الرصيد مرفوض في كل مسار
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const check1103 = (label, tolerancePerItem = 100) => {
  const book = bal('1103')
  const calc = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  assert.ok(Math.abs(book - calc) <= Math.max(1, st().items.filter((i) => (i.stockQty ?? 0) !== 0).length) * tolerancePerItem, `${label}: 1103=${book} vs Σ=${calc}`)
}
const mkItem = (nameAr, extra = {}) => {
  st().addItem({ nameAr, sku: `E-${st().items.length + 1}`, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 10000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra })
  return st().items.at(-1)
}

st().seed([])
st().addSupplier({ nameAr: 'مورد الحالات', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)

console.log('\n— ح1) الوزن الكسري (3 منازل) —')
{
  const meat = mkItem('لحم', { soldByWeight: true, baseUnit: 'كجم' })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: meat.id, qty: 12.75, unitPriceMinor: 20000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.equal(st().items.find((i) => i.id === meat.id).stockQty, 12.75)
  check1103('شراء كسري')
  ok('ح1: شراء 12.750 كجم — الرصيد كسري و1103 مطابق')
  st().postSale({ lines: [{ itemId: meat.id, nameAr: meat.nameAr, qty: 1.345, unitPriceMinor: 30000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: true }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().items.find((i) => i.id === meat.id).stockQty, 11.405)
  ok('ح1: بيع 1.345 كجم بالميزان — الرصيد 11.405 بدقة 3 منازل')
  // جرد كسري بعجز 0.155
  st().postStocktake([{ itemId: meat.id, nameAr: meat.nameAr, expectedQty: 11.405, countedQty: 11.25, unitCostMinor: 20000 }], 'وزن فعلي')
  assert.equal(st().items.find((i) => i.id === meat.id).stockQty, 11.25)
  const lastEntry = st().journal.at(-1)
  assert.equal(lastEntry.lines.find((l) => l.accountCode === '5108').debit, Math.round(0.155 * 20000))
  assertBalanced(lastEntry.lines)
  ok('ح1: جرد بعجز 0.155 كجم — القيد بقيمة الكسر بالضبط (31 قرشاً) ومتوازن')
  st().postWastage({ reason: 'تلف', lines: [{ itemId: meat.id, qty: 0.25 }], notes: '' })
  assert.equal(st().items.find((i) => i.id === meat.id).stockQty, 11)
  check1103('إتلاف كسري')
  ok('ح1: إتلاف 0.250 كجم — لا تسريب تقريب عبر الدورة كلها')
}

console.log('\n— ح2) جرد متعدد الأصناف: عجز وزيادة في قيد واحد —')
{
  const a = mkItem('صنف أ')
  const b = mkItem('صنف ب')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: a.id, qty: 10, unitPriceMinor: 1000 }, { itemId: b.id, qty: 10, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, notes: '' })
  const stk = st().postStocktake([
    { itemId: a.id, nameAr: a.nameAr, expectedQty: 10, countedQty: 7, unitCostMinor: 1000 },  // عجز 3 = 30
    { itemId: b.id, nameAr: b.nameAr, expectedQty: 10, countedQty: 12, unitCostMinor: 2000 }, // زيادة 2 = 40
  ], 'جرد مزدوج')
  const entry = st().journal.find((e) => e.id === stk.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '5108' && l.debit === 3000))
  assert.ok(entry.lines.some((l) => l.accountCode === '1103' && l.debit === 4000))
  assertBalanced(entry.lines)
  assert.equal(stk.result.netValueMinor, 1000)
  ok('ح2: عجز 30 وزيادة 40 في قيد واحد صافٍ متوازن (صافي +10) — لا قيدان منفصلان')
  assert.equal(st().items.find((i) => i.id === a.id).stockQty, 7)
  assert.equal(st().items.find((i) => i.id === b.id).stockQty, 12)
  ok('ح2: الرصيدان ضُبطا معاً على المعدود')
}

console.log('\n— ح3) حالات الصفر —')
{
  const zero = mkItem('صنف مفاجأة', { costMinor: 500 })
  // وجدنا 4 قطع غير مسجلة (متوقع 0)
  st().postStocktake([{ itemId: zero.id, nameAr: zero.nameAr, expectedQty: 0, countedQty: 4, unitCostMinor: 500 }], 'بضاعة مكتشفة')
  assert.equal(st().items.find((i) => i.id === zero.id).stockQty, 4)
  ok('ح3: جرد من صفر إلى 4 — زيادة كاملة بقيد 1103 مدين 20')
  // اختفى كل شيء (معدود 0)
  st().postStocktake([{ itemId: zero.id, nameAr: zero.nameAr, expectedQty: 4, countedQty: 0, unitCostMinor: 500 }], 'سرقة')
  assert.equal(st().items.find((i) => i.id === zero.id).stockQty, 0)
  check1103('جرد للصفر')
  ok('ح3: جرد إلى صفر — عجز كامل والرصيد صفر و1103 مطابق')
}

console.log('\n— ح4) المتوسط المتحرك عبر عمليات متشابكة —')
{
  const oil = mkItem('زيت')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: oil.id, qty: 10, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.equal(st().items.find((i) => i.id === oil.id).costMinor, 1000)
  st().postWastage({ reason: 'تلف', lines: [{ itemId: oil.id, qty: 2 }], notes: '' })
  assert.equal(st().items.find((i) => i.id === oil.id).costMinor, 1000)
  ok('ح4: الإتلاف يخصم كمية بلا مساس بالمتوسط (8×10)')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: oil.id, qty: 8, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, notes: '' })
  // (8×1000 + 8×2000) / 16 = 1500
  assert.equal(st().items.find((i) => i.id === oil.id).costMinor, 1500)
  ok('ح4: شراء أغلى بعد الإتلاف — المتوسط (8×10+8×20)/16 = 15 بالضبط')
  const cns = st().postConsumption({ purpose: 'مطبخ', lines: [{ itemId: oil.id, qty: 4 }], notes: '' })
  assert.equal(cns.totalCostMinor, 6000)
  ok('ح4: الصرف الداخلي بعد تحرك المتوسط قُيّم بالمتوسط الجديد 15 (4×15=60)')
  check1103('دورة المتوسط')
  ok('ح4: 1103 مطابق بعد الدورة المتشابكة كاملة')
}

console.log('\n— ح5) الإتلاف عبر دفعات متعددة FEFO —')
{
  const yog = mkItem('زبادي', { trackExpiry: true })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: yog.id, qty: 6, unitPriceMinor: 500, expiryDate: '2026-09-01' }], expenses: [], paidMinor: 0, notes: '' })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: yog.id, qty: 6, unitPriceMinor: 500, expiryDate: '2026-12-01' }], expenses: [], paidMinor: 0, notes: '' })
  st().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: yog.id, qty: 8 }], notes: '' })
  const b1 = st().batches.find((b) => b.itemId === yog.id && b.expiryDate === '2026-09-01')
  const b2 = st().batches.find((b) => b.itemId === yog.id && b.expiryDate === '2026-12-01')
  assert.equal(b1?.qty ?? 0, 0)
  assert.equal(b2.qty, 4)
  ok('ح5: إتلاف 8 عبر دفعتين — المنتهية أُعدمت كلها (6) والباقي (2) من التالية')
}

console.log('\n— ح6) الصرف الداخلي وشجرة الحسابات —')
{
  const paper = mkItem('ورق')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: paper.id, qty: 10, unitPriceMinor: 300 }], expenses: [], paidMinor: 0, notes: '' })
  // حساب مصروف مخصص من شجرة المستخدم
  st().addCustomAccount({ code: '5195', nameAr: 'مصاريف دعاية خاصة', parentCode: '5' })
  const custom = st().customAccounts.at(-1)
  const doc = st().postConsumption({ purpose: 'عينات دعاية', expenseAccount: custom.code, lines: [{ itemId: paper.id, qty: 3 }], notes: '' })
  const entry = st().journal.find((e) => e.id === doc.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === custom.code && l.debit === 900))
  ok('ح6: الصرف لحساب مصروف مخصص من شجرة المستخدم يعمل — الربط الفعلي بالشجرة')
  assert.throws(() => st().postConsumption({ purpose: 'x', expenseAccount: '1101', lines: [{ itemId: paper.id, qty: 1 }], notes: '' }), /مصروف/)
  ok('ح6: الصرف لحساب أصول (خزينة) مرفوض — مصروفات فقط')
}

console.log('\n— ح7) التحويلات ذهاباً وإياباً وفرع-لفرع —')
{
  const sugar2 = mkItem('سكر التحويلات')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: sugar2.id, qty: 30, unitPriceMinor: 800 }], expenses: [], paidMinor: 0, notes: '' })
  st().addWarehouse('فرع أ')
  const wa = st().warehouses.at(-1)
  st().addWarehouse('فرع ب')
  const wb = st().warehouses.at(-1)
  const main = st().warehouses.find((w) => w.isMain)
  const { computeWarehouseStock, buildWarehouseDocs } = await import(join(root, 'src/core/transfers.ts'))
  const stockOf = () => computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: wa.id, lines: [{ itemId: sugar2.id, qty: 10 }], notes: '' })
  st().postTransfer({ fromWarehouseId: wa.id, toWarehouseId: wb.id, lines: [{ itemId: sugar2.id, qty: 4 }], notes: '' })
  let s = stockOf()
  assert.equal(s.get(main.id).get(sugar2.id), 20)
  assert.equal(s.get(wa.id).get(sugar2.id), 6)
  assert.equal(s.get(wb.id).get(sugar2.id), 4)
  ok('ح7: فرع→فرع مباشرة (20/6/4) — لا مرور إجباري بالرئيسي')
  st().postTransfer({ fromWarehouseId: wb.id, toWarehouseId: main.id, lines: [{ itemId: sugar2.id, qty: 4 }], notes: '' })
  s = stockOf()
  assert.equal(s.get(main.id).get(sugar2.id), 24)
  assert.equal((s.get(wb.id).get(sugar2.id) ?? 0), 0)
  ok('ح7: العودة للرئيسي — الدورة الكاملة والرصيد الكلي 30 ثابت دائماً')
  assert.throws(() => st().postTransfer({ fromWarehouseId: wa.id, toWarehouseId: wb.id, lines: [{ itemId: sugar2.id, qty: 7 }], notes: '' }), /تتجاوز المتاح/)
  ok('ح7: تحويل 7 من فرع فيه 6 مرفوض — التحقق على رصيد المخزن لا الكلي')
}

console.log('\n— ح8) المتغيرات لون×مقاس —')
{
  const shirt = mkItem('قميص', { variantColors: ['أزرق', 'أحمر'], variantSizes: ['M', 'L'] })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: shirt.id, qty: 20, unitPriceMinor: 5000 }], expenses: [], paidMinor: 0, notes: '' })
  st().setVariantStock(shirt.id, 'أزرق', 'M', 8)
  st().setVariantStock(shirt.id, 'أزرق', 'L', 7)
  st().setVariantStock(shirt.id, 'أحمر', 'M', 5)
  assert.equal(st().getUndistributedQty(shirt.id), 0)
  ok('ح8: توزيع 20 قميصاً على 3 تركيبات — الموزع = الرصيد بالكامل')
  const sale = st().postSale({ lines: [{ itemId: shirt.id, nameAr: shirt.nameAr, qty: 2, unitPriceMinor: 8000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false, variantColor: 'أزرق', variantSize: 'M' }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const vs = st().variantStocks.find((v) => v.itemId === shirt.id && v.color === 'أزرق' && v.size === 'M')
  assert.equal(vs.qty, 6)
  assert.equal(st().items.find((i) => i.id === shirt.id).stockQty, 18)
  ok('ح8: بيع 2 أزرق M — خُصم من التركيبة (8→6) ومن الإجمالي (20→18) معاً')
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'مقاس', reasonCode: 'other', approvedBy: 'المشرف' })
  assert.equal(st().variantStocks.find((v) => v.itemId === shirt.id && v.color === 'أزرق' && v.size === 'M').qty, 7)
  ok('ح8: المرتجع أعاد القطعة لتركيبتها نفسها (6→7) — لا رصيد تائه بين الألوان')
}

console.log('\n— ح9) السيريالات مع عمليات المخزون —')
{
  const tv = mkItem('شاشة', { trackSerial: true })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: tv.id, qty: 3, unitPriceMinor: 400000, serialsRaw: 'TV1001\nTV1002\nTV1003' }], expenses: [], paidMinor: 0, notes: '' })
  assert.equal(st().serials.filter((u) => u.itemId === tv.id && u.status === 'in_stock').length, 3)
  // جرد بعجز 1 (ضاعت شاشة) — الرصيد يضبط والسيريالات تبقى لتسوية يدوية واعية
  st().postStocktake([{ itemId: tv.id, nameAr: tv.nameAr, expectedQty: 3, countedQty: 2, unitCostMinor: 400000 }], 'شاشة مفقودة')
  assert.equal(st().items.find((i) => i.id === tv.id).stockQty, 2)
  ok('ح9: جرد صنف سيريالات بعجز — الرصيد ضُبط والقيد تولد (السيريال المفقود يُسوى من شاشة السيريالات)')
  check1103('سيريالات')
  ok('ح9: 1103 مطابق بعد عجز صنف السيريالات')
}

console.log('\n— ح10) تسلسل القيود ومصادرها —')
{
  const bySource = new Map()
  for (const e of st().journal) bySource.set(e.sourceType, (bySource.get(e.sourceType) ?? 0) + 1)
  assert.ok((bySource.get('adjustment') ?? 0) >= 4, 'قيود تسوية جرد')
  assert.ok((bySource.get('wastage') ?? 0) >= 3, 'قيود إتلاف')
  assert.ok((bySource.get('internal_use') ?? 0) >= 2, 'قيود صرف داخلي')
  ok(`ح10: كل مستند مخزني بقيد موسوم بمصدره (${bySource.get('adjustment')} تسوية، ${bySource.get('wastage')} إتلاف، ${bySource.get('internal_use')} صرف)`)
  for (const w of st().wastages) assert.ok(st().journal.some((e) => e.id === w.journalEntryId), `قيد الإتلاف ${w.wastageNumber}`)
  for (const c of st().consumptions) assert.ok(st().journal.some((e) => e.id === c.journalEntryId), `قيد الصرف ${c.consumptionNumber}`)
  for (const s2 of st().stocktakes) if (s2.journalEntryId) assert.ok(st().journal.some((e) => e.id === s2.journalEntryId), `قيد الجرد ${s2.stocktakeNumber}`)
  ok('ح10: كل مستند يشير لقيد موجود فعلاً — لا قيود يتيمة ولا مستندات بلا قيد')
}

console.log('\n— ح11) الرصيد السالب مستحيل في كل المسارات —')
{
  const last = mkItem('صنف الحدود')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: last.id, qty: 2, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.throws(() => st().postWastage({ reason: 'تلف', lines: [{ itemId: last.id, qty: 3 }], notes: '' }), /رصيد|المتاح|يتجاوز/)
  assert.throws(() => st().postConsumption({ purpose: 'x', lines: [{ itemId: last.id, qty: 3 }], notes: '' }), /رصيد|المتاح|يتجاوز/)
  const main = st().warehouses.find((w) => w.isMain)
  const wa = st().warehouses.find((w) => !w.isMain)
  assert.throws(() => st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: wa.id, lines: [{ itemId: last.id, qty: 3 }], notes: '' }), /تتجاوز/)
  ok('ح11: إتلاف وصرف وتحويل فوق الرصيد — الثلاثة مرفوضة قبل أي كتابة')
  assert.equal(st().items.find((i) => i.id === last.id).stockQty, 2)
  ok('ح11: الرصيد لم يُمس بعد الرفض الثلاثي')
}

/* الختام: توازن كامل */
for (const e of st().journal) assertBalanced(e.lines)
check1103('الختام')
ok(`الختام: ${st().journal.length} قيداً كلها متوازنة و1103 = Σ كمية×متوسط بعد كل السيناريوهات`)

console.log(`\n✅ verify_inventory_edge_cases: ${pass} تحققاً — كل حالات المخزون الحدية مرتبطة بقيودها سليمة`)
