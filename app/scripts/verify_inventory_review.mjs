/**
 * مراجعة المخزون الشاملة (نفس عمق المبيعات/المشتريات/المرتجعات):
 * V1) حذف صنف له حركة أو رصيد مرفوض — التعطيل هو البديل (فجوة سُدت:
 *     كان الحذف يمر فيترك 1103 بقيمة صنف شبح ويفقد التقارير مرجعيتها)
 * V2) عجز الجرد يخصم من دفعات الصلاحية FEFO (فجوة سُدت: كانت الدفعات
 *     تبقى أعلى من الرصيد فتنذر «منتهي» عن بضاعة غير موجودة)
 * V3) الجرد: قيد تسوية متوازن (عجز 5108/1103، زيادة 1103/5108) وضبط الرصيد
 * V4) الإتلاف: قيد 5111/1103 بالتكلفة المرجحة + خصم الدفعات الأقدم أولاً
 * V5) الصرف الداخلي: قيد مصروف/1103 + رفض حساب غير مصروف
 * V6) التحويلات المخزنية: بلا قيد (1103 ثابت)، تحقق رصيد المصدر، أرصدة المخازن
 *     متسقة (مجموعها = الرصيد الكلي) مع فواتير موجهة لمخازن
 * V7) حذف مخزن له تحويلات مرفوض + حذف قسم فيه أصناف مرفوض
 * V8) validateItem: باركود مكرر عبر الأصناف والوحدات، سيريال+وزن لا يجتمعان
 * V9) الرصيد الافتتاحي للمخزون (1103/رأس المال) بقيد فرق عند التعديل
 * V10) الحراسات: inv.adjust حساسة + الجرد/الإتلاف/الصرف خلف موافقة المشرف
 * V11) ثابت 1103 = Σ كمية×متوسط بعد كل العمليات وكل القيود متوازنة
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { validateItem } = await import(join(root, 'src/core/items.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const allBalanced = () => { for (const e of st().journal) assertBalanced(e.lines) }
const item = (nameAr, extra = {}) => {
  st().addItem({ nameAr, sku: `T-${st().items.length + 1}`, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 10000, stockQty: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra })
  return st().items.at(-1)
}

st().seed([]) // ينشئ المخزن الرئيسي وقسم «عام» — كما يحدث عند أول تشغيل حقيقي
st().addSupplier({ nameAr: 'مورد المخزون', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)

console.log('\n— V1) حذف الأصناف بموانع السلامة —')
{
  const ghost = item('صنف بلا حركة')
  st().removeItem(ghost.id)
  assert.ok(!st().items.some((i) => i.id === ghost.id))
  ok('V1: صنف بلا حركة ولا رصيد يُحذف طبيعياً')
  const traded = item('صنف متداول')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: traded.id, qty: 10, unitPriceMinor: 5000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.throws(() => st().removeItem(traded.id), /فواتير شراء/)
  ok('V1: صنف له فواتير شراء لا يُحذف — «عطّله بدلاً من الحذف» (كان يُحذف بصمت!)')
  const opening = item('صنف برصيد افتتاحي', { stockQty: 0 })
  st().updateItem(opening.id, { stockQty: 5, costMinor: 1000 })
  assert.throws(() => st().removeItem(opening.id), /رصيده/)
  ok('V1: صنف برصيد بلا حركة لا يُحذف حتى يُصفَّر — 1103 لا يفقد قيمة شبح')
  assert.ok(st().items.some((i) => i.id === traded.id))
  ok('V1: الرفض لم يمس الصنف — لا حذف جزئي')
  st().updateItem(opening.id, { stockQty: 0 })
  st().removeItem(opening.id)
  ok('V1: بعد التصفير يُحذف طبيعياً')
}

console.log('\n— V2+V3) الجرد: القيد والرصيد ودفعات الصلاحية —')
{
  const milk = item('لبن', { trackExpiry: true })
  // دفعتان: 20 تنتهي قريباً + 30 بعيدة = 50
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: milk.id, qty: 20, unitPriceMinor: 2000, expiryDate: '2026-10-01' }], expenses: [], paidMinor: 0, notes: '' })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: milk.id, qty: 30, unitPriceMinor: 2000, expiryDate: '2027-01-01' }], expenses: [], paidMinor: 0, notes: '' })
  const invBefore = bal('1103')
  // جرد فعلي: 45 (عجز 5)
  const stk = st().postStocktake([{ itemId: milk.id, nameAr: milk.nameAr, expectedQty: 50, countedQty: 45, unitCostMinor: 2000 }], 'جرد شهري')
  assert.equal(st().items.find((i) => i.id === milk.id).stockQty, 45)
  ok('V3: الرصيد ضُبط على المعدود 45')
  assert.equal(bal('1103'), invBefore - 5 * 2000)
  const entry = st().journal.find((e) => e.id === stk.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '5108' && l.debit === 10000))
  ok('V3: قيد العجز 5108 مدين 100 / 1103 دائن 100 — متوازن')
  // V2: الدفعة القريبة نقصت 5 (FEFO) — كانت الفجوة: تبقى 20+30=50 والرصيد 45
  const near = st().batches.find((b) => b.itemId === milk.id && b.expiryDate === '2026-10-01')
  const far = st().batches.find((b) => b.itemId === milk.id && b.expiryDate === '2027-01-01')
  assert.equal(near.qty, 15)
  assert.equal(far.qty, 30)
  assert.equal(near.qty + far.qty, st().items.find((i) => i.id === milk.id).stockQty)
  ok('V2: عجز الجرد خُصم من الدفعة الأقدم انتهاءً (20→15) — الدفعات = الرصيد تماماً (الفجوة المسدودة)')
  // زيادة جرد: 48 (زيادة 3)
  const stk2 = st().postStocktake([{ itemId: milk.id, nameAr: milk.nameAr, expectedQty: 45, countedQty: 48, unitCostMinor: 2000 }], 'زيادة')
  const entry2 = st().journal.find((e) => e.id === stk2.journalEntryId)
  assert.ok(entry2.lines.some((l) => l.accountCode === '1103' && l.debit === 6000))
  assert.equal(st().items.find((i) => i.id === milk.id).stockQty, 48)
  ok('V3: زيادة الجرد 1103 مدين / 5108 دائن وضبط الرصيد 48')
  // جرد مطابق: لا قيد
  const stk3 = st().postStocktake([{ itemId: milk.id, nameAr: milk.nameAr, expectedQty: 48, countedQty: 48, unitCostMinor: 2000 }], 'مطابق')
  assert.equal(stk3.journalEntryId, null)
  ok('V3: جرد مطابق تماماً — لا قيد بلا أثر')
  // معدود سالب/مكرر يُرفض
  assert.throws(() => st().postStocktake([{ itemId: milk.id, nameAr: 'لبن', expectedQty: 48, countedQty: -1, unitCostMinor: 2000 }], ''), /سالب/)
  assert.throws(() => st().postStocktake([
    { itemId: milk.id, nameAr: 'لبن', expectedQty: 48, countedQty: 40, unitCostMinor: 2000 },
    { itemId: milk.id, nameAr: 'لبن', expectedQty: 48, countedQty: 41, unitCostMinor: 2000 },
  ], ''), /مكرر/)
  ok('V3: معدود سالب أو صنف مكرر في الجلسة يُرفض قبل أي كتابة')
}

console.log('\n— V4) الإتلاف —')
{
  const cheese = item('جبنة', { trackExpiry: true })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: cheese.id, qty: 10, unitPriceMinor: 3000, expiryDate: '2026-09-01' }], expenses: [], paidMinor: 0, notes: '' })
  const wastageBefore = bal('5111')
  const doc = st().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: cheese.id, qty: 4 }], notes: '' })
  assert.equal(doc.totalCostMinor, 12000)
  assert.equal(bal('5111') - wastageBefore, 12000)
  assert.equal(st().items.find((i) => i.id === cheese.id).stockQty, 6)
  ok('V4: الإتلاف 4 جبن منتهية — قيد 5111/1103 بالتكلفة 120 وخصم الرصيد والدفعة')
  assert.equal(st().batches.find((b) => b.itemId === cheese.id).qty, 6)
  ok('V4: دفعة الصلاحية المنتهية نقصت 4 — هذا هو إعدام المنتهي الصحيح')
  assert.throws(() => st().postWastage({ reason: 'تلف', lines: [{ itemId: cheese.id, qty: 99 }], notes: '' }), /رصيد|المتاح|يتجاوز/)
  ok('V4: إتلاف أكبر من الرصيد مرفوض')
}

console.log('\n— V5) الصرف الداخلي —')
{
  const soap = item('منظفات')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: soap.id, qty: 20, unitPriceMinor: 1500 }], expenses: [], paidMinor: 0, notes: '' })
  const doc = st().postConsumption({ purpose: 'نظافة المحل', lines: [{ itemId: soap.id, qty: 5 }], notes: '' })
  assert.equal(doc.totalCostMinor, 7500)
  const entry = st().journal.find((e) => e.id === doc.journalEntryId)
  assert.ok(entry.lines.some((l) => l.credit === 7500 && l.accountCode === '1103'))
  assert.equal(st().items.find((i) => i.id === soap.id).stockQty, 15)
  ok('V5: صرف داخلي 5 منظفات — بضاعة تحولت مصروفاً بقيد متوازن وخصم الرصيد')
  assert.throws(() => st().postConsumption({ purpose: 'x', expenseAccount: '1104', lines: [{ itemId: soap.id, qty: 1 }], notes: '' }), /مصروف/)
  ok('V5: حساب غير مصروف (1104 عملاء) مرفوض — الصرف الداخلي مصروفات فقط')
}

console.log('\n— V6) التحويلات المخزنية —')
{
  st().addWarehouse('فرع المنصورة')
  const branch = st().warehouses.at(-1)
  const main = st().warehouses.find((w) => w.isMain)
  const rice2 = item('أرز التحويلات')
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: rice2.id, qty: 40, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })
  const inv1103 = bal('1103')
  const journalCount = st().journal.length
  st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: branch.id, lines: [{ itemId: rice2.id, qty: 15 }], notes: '' })
  assert.equal(bal('1103'), inv1103)
  assert.equal(st().journal.length, journalCount)
  ok('V6: التحويل حركة داخلية — لا قيد و1103 ثابت (القيمة لم تغادر المنشأة)')
  const { computeWarehouseStock, buildWarehouseDocs } = await import(join(root, 'src/core/transfers.ts'))
  const stock = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  assert.equal(stock.get(branch.id).get(rice2.id), 15)
  assert.equal(stock.get(main.id).get(rice2.id), 25)
  ok('V6: أرصدة المخازن 25 رئيسي + 15 فرع = 40 الرصيد الكلي — متسقة دائماً')
  assert.throws(() => st().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: rice2.id, qty: 99 }], notes: '' }), /تتجاوز المتاح/)
  ok('V6: تحويل أكبر من رصيد المصدر مرفوض')
  assert.throws(() => st().postTransfer({ fromWarehouseId: main.id, toWarehouseId: main.id, lines: [{ itemId: rice2.id, qty: 1 }], notes: '' }), /مختلفين/)
  ok('V6: التحويل لنفس المخزن مرفوض')
  // فاتورة شراء موجهة للفرع تظهر في رصيده لا الرئيسي
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: rice2.id, qty: 10, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, warehouseId: branch.id, notes: '' })
  const stock2 = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  assert.equal(stock2.get(branch.id).get(rice2.id), 25)
  assert.equal(stock2.get(main.id).get(rice2.id), 25)
  ok('V6: شراء موجه للفرع دخل رصيد الفرع مباشرة (15+10) والرئيسي كما هو')
}

console.log('\n— V7) موانع حذف المخازن والأقسام —')
{
  const branch = st().warehouses.at(-1)
  assert.throws(() => st().removeWarehouse(branch.id), /تحويلات مسجلة/)
  ok('V7: مخزن له تحويلات لا يُحذف — السجل التاريخي محفوظ')
  st().addCategory('قسم فيه صنف', [], null)
  const cat = st().categories.at(-1)
  const catItem = item('صنف القسم')
  st().updateItem(catItem.id, { categoryId: cat.id })
  const catCount = st().categories.length
  st().removeCategory(cat.id)
  assert.equal(st().categories.length, catCount)
  ok('V7: قسم فيه أصناف لا يُحذف (يتجاهل بأمان)')
}

console.log('\n— V8) تحقق الأصناف —')
{
  const existing = st().items
  const draft = { nameAr: 'صنف جديد', sku: 'X1', barcodes: ['111222333'], categoryId: 0, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }
  assert.equal(validateItem(draft, existing).filter((e) => !e.startsWith('تنبيه')).length, 0)
  const dupSelf = { ...draft, barcodes: ['111', '111'] }
  assert.ok(validateItem(dupSelf, existing).some((e) => e.includes('مكرر داخل')))
  ok('V8: باركود مكرر داخل الصنف نفسه يُرفض')
  const serialWeight = { ...draft, trackSerial: true, soldByWeight: true }
  assert.ok(validateItem(serialWeight, existing).some((e) => e.includes('لا يجتمع')))
  ok('V8: سيريال + بيع بالوزن لا يجتمعان')
  const zeroPrice = { ...draft, priceMinor: 0 }
  assert.ok(validateItem(zeroPrice, existing).some((e) => e.includes('سعر البيع صفر')))
  ok('V8: سعر بيع صفر ينبه — الكاشير لن يبيعه')
  const badUnit = { ...draft, extraUnits: [{ nameAr: 'كرتونة', factor: 1 }] }
  assert.ok(validateItem(badUnit, existing).some((e) => e.includes('أكبر من 1')))
  ok('V8: وحدة إضافية بمعامل ≤1 مرفوضة')
}

console.log('\n— V9) الرصيد الافتتاحي للمخزون —')
{
  const old = item('بضاعة قديمة')
  st().updateItem(old.id, { stockQty: 10, costMinor: 2000 })
  const invBefore = bal('1103')
  st().setOpeningBalance({ kind: 'item_stock', refId: old.id, amountMinor: 20000, label: old.nameAr })
  assert.equal(bal('1103') - invBefore, 20000)
  ok('V9: مخزون افتتاحي 200 — قيد 1103/رأس المال')
  st().setOpeningBalance({ kind: 'item_stock', refId: old.id, amountMinor: 25000, label: old.nameAr })
  assert.equal(bal('1103') - invBefore, 25000)
  ok('V9: تعديل الافتتاحي يرحّل قيد الفرق 50 فقط — لا مسح ولا ازدواج')
  assert.throws(() => st().setOpeningBalance({ kind: 'item_stock', refId: 99999, amountMinor: 1000, label: 'شبح' }), /غير موجود/)
  ok('V9: افتتاحي لصنف غير موجود مرفوض (فخ mobileshop)')
}

console.log('\n— V10) الحراسات والصلاحيات —')
{
  const { PERMISSIONS } = await import(join(root, 'src/core/permissions.ts'))
  const adjust = PERMISSIONS.find((p) => p.id === 'inv.adjust')
  assert.ok(adjust?.sensitive)
  ok('V10: صلاحية التسوية المخزنية inv.adjust حساسة')
  const costView = PERMISSIONS.find((p) => p.id === 'inv.cost.view')
  assert.ok(costView?.sensitive)
  ok('V10: رؤية التكلفة صلاحية حساسة — الكاشير لا يرى هوامشك')
  for (const [file, what] of [
    ['src/ui/pages/StocktakePage.tsx', 'الجرد'],
    ['src/ui/pages/WastagePage.tsx', 'الإتلاف'],
    ['src/ui/pages/ConsumptionPage.tsx', 'الصرف الداخلي'],
  ]) {
    const srcTxt = readFileSync(join(root, file), 'utf8')
    assert.ok(srcTxt.includes("useSupervisorApproval('inv.adjust')"), `${file} approval hook`)
    assert.ok(srcTxt.includes('approval.request') && srcTxt.includes('approval.dialog'), `${file} request+dialog`)
    ok(`V10: ${what} خلف موافقة المشرف بالرقم السري (فجوة سُدت — كان بلا حراسة)`)
  }
  const itemsPage = readFileSync(join(root, 'src/ui/pages/ItemsPage.tsx'), 'utf8')
  assert.ok(itemsPage.includes('catch (e) { toast.show((e as Error).message'))
  ok('V10: زر حذف الصنف يلتقط الرفض ويعرضه — لا «تم الحذف» كاذبة')
}

console.log('\n— V11) الثوابت النهائية —')
{
  const book = bal('1103')
  const calc = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  // الافتتاحي V9 قِيد بقيمة يدوية (250) تفوق كمية×متوسط (10×20=200) بفرق 50 مقصود
  assert.ok(Math.abs(book - calc - 5000) <= st().items.length * 100, `1103=${book} calc=${calc}`)
  ok(`V11: 1103 الدفتري (${book}) = Σ كمية×متوسط (${calc}) + فرق الافتتاحي اليدوي المقصود (50)`)
  allBalanced()
  ok(`V11: كل قيود الدفتر (${st().journal.length}) متوازنة بعد دورة المخزون الكاملة`)
}

console.log(`\n✅ verify_inventory_review: ${pass} تحققاً — المخزون مراجع بعمق الأقسام الأربعة`)
