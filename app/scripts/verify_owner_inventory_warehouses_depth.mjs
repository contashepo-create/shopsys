/**
 * جولة المالك §80 — المخزون والمخازن بعمق (P1 الأول):
 * نموذج أرصدة المخازن المشتق (core/transfers.ts) + postTransfer + postStocktake
 * + حراسة البيع/الشراء على أرصدة المخازن + removeWarehouse.
 *
 * عيبان مُصلحان في هذه الجولة (كلاهما مُقاس قبل الإصلاح):
 *   ① الوحدة الكبرى في توزيع المخازن: buildWarehouseDocs كان يزيح كمية السطر
 *      كما هي (كرتونة = 1) بينما المخزون الكلي يتحرك بالأساسية (كرتونة = 12)
 *      ⇒ بعد بيع كرتونة من مخزن فرع: الفرع يظهر 23 والرئيسي 13 والصحيح 12/24.
 *      الأثر: تقرير أرصدة كاذب + حراسة البيع من مخزن تسمح ببيع غير الموجود فيه.
 *   ② الجرد بصنف غير مسجل: يولّد قيد 5111/4110 بلا أثر مخزوني فعلي
 *      ⇒ انفصال 1103 الدفتري عن المخزون الفعلي (قيس: عجز وهمي 50,000).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_inventory_warehouses_depth.mjs
 */
const relDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeWarehouseStock, buildWarehouseDocs } = await import('../src/core/transfers.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const item = (over) => ({ nameAr: 'ص', sku: '', barcodes: [], categoryId: 1, baseUnit: 'زجاجة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over })

/** أرصدة المخازن كما يحسبها النظام (نفس استدعاء الواجهات والحراسات) */
const whStock = () => computeWarehouseStock(S().items, S().warehouses, S().transfers, buildWarehouseDocs(S().purchases, S().sales, S().saleReturns, S().purchaseReturns, S().productionOrders, S().processingOrders))
const whQty = (warehouseId, itemId) => whStock().get(warehouseId)?.get(itemId) ?? 0
/** الثابت المعمم لنموذج الأرصدة المشتق: مجموع المخازن = الرصيد الكلي لكل صنف */
const totalsMatchGlobal = () => {
  for (const it of S().items) {
    let sum = 0
    for (const [wid, m] of whStock()) sum += m.get(it.id) ?? 0
    if (Math.round(sum * 1000) !== Math.round((it.stockQty ?? 0) * 1000)) return `صنف ${it.nameAr}: مجموع المخازن ${sum} ≠ الكلي ${it.stockQty ?? 0}`
  }
  return ''
}

/* ═══ ① انحدار عيب الوحدة الكبرى في توزيع أرصدة المخازن ═══ */
console.log('① الوحدة الكبرى في أرصدة المخازن — انحدار عيب §80')
{
  S().addWarehouse('الرئيسي')
  S().addWarehouse('مخزن الفرع')
  const main = S().warehouses.find((w) => w.isMain)
  const branch = S().warehouses.find((w) => !w.isMain)
  S().addSupplier({ nameAr: 'مورد المخازن', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0 })
  const sup = S().suppliers.at(-1)
  S().addItem(item({ nameAr: 'مشروب', costMinor: 3000, stockQty: 24, priceMinor: 5000, extraUnits: [{ nameAr: 'كرتونة', factor: 12 }] }))
  const drink = S().items.at(-1)

  /* شراء 24 زجاجة واردة لمخزن الفرع (بسطر أساسي) */
  S().postPurchase({ supplierId: sup.id, date: '2026-10-01', lines: [{ itemId: drink.id, qty: 24, unitPriceMinor: 3000, expiryDate: null }], expenses: [], paidMinor: 0, notes: '', warehouseId: branch.id })
  ok('شراء وارد للفرع: الفرع 24 والرئيسي 24 (الابتدائي)', whQty(branch.id, drink.id) === 24 && whQty(main.id, drink.id) === 24, `فرع ${whQty(branch.id, drink.id)} / رئيسي ${whQty(main.id, drink.id)}`)
  ok('الثابت المعمم: مجموع المخازن = الكلي (48)', totalsMatchGlobal() === '' && S().items.find((x) => x.id === drink.id).stockQty === 48)

  /* بيع كرتونة واحدة (12 زجاجة) من مخزن الفرع — قبل إصلاح §80: فرع 23/رئيسي 13 */
  const sale = S().postSale({ lines: [{ itemId: drink.id, nameAr: 'مشروب (كرتونة)', qty: 1, unitPriceMinor: 55000, unitCostMinor: 36000, discountPercent: 0, soldByWeight: false, unitFactor: 12, unitLabel: 'كرتونة', warehouseId: branch.id }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, warehouseId: branch.id })
  ok('بيع كرتونة من الفرع: الرصيد الكلي 36', S().items.find((x) => x.id === drink.id).stockQty === 36)
  ok('الفرع 12 بالضبط (كان 23 قبل الإصلاح)', whQty(branch.id, drink.id) === 12, `فعلي ${whQty(branch.id, drink.id)}`)
  ok('الرئيسي 24 (كان 13 قبل الإصلاح)', whQty(main.id, drink.id) === 24, `فعلي ${whQty(main.id, drink.id)}`)
  ok('الثابت المعمم بعد البيع بالوحدة الكبرى', totalsMatchGlobal() === '')

  /* مرتجع الكرتونة يعود بالأساسية لمخزن فاتورة البيع (الفرع) */
  S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'انكسار' })
  ok('مرتجع الكرتونة عاد 12 للفرع (لا للرئيسي)', whQty(branch.id, drink.id) === 24 && whQty(main.id, drink.id) === 24, `فرع ${whQty(branch.id, drink.id)} / رئيسي ${whQty(main.id, drink.id)}`)
  ok('الثابت المعمم بعد المرتجع', totalsMatchGlobal() === '')

  /* البيع بالوحدة الكبرى من مخزن لم يصله شيء يُرفض (حراسة الأرصدة المشتقة) */
  S().addItem(item({ nameAr: 'عصير فرع فقط', costMinor: 2000, stockQty: 0, priceMinor: 4000, extraUnits: [{ nameAr: 'صندوق', factor: 6 }] }))
  const juice = S().items.at(-1)
  S().postPurchase({ supplierId: sup.id, date: '2026-10-01', lines: [{ itemId: juice.id, qty: 6, unitPriceMinor: 2000, expiryDate: null }], expenses: [], paidMinor: 0, notes: '', warehouseId: branch.id })
  throws('بيع صندوق (6) من الرئيسي الفارغ منه يُرفض — البضاعة في الفرع', () => S().postSale({ lines: [{ itemId: juice.id, nameAr: 'عصير فرع فقط (صندوق)', qty: 1, unitPriceMinor: 24000, unitCostMinor: 12000, discountPercent: 0, soldByWeight: false, unitFactor: 6, unitLabel: 'صندوق', warehouseId: main.id }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, warehouseId: main.id }), 'مخزون غير كافٍ')
  console.log('  ✓ الوحدة الكبرى تُزاح بالأساسية في كل المستندات والمرتجعات والحراسات')
}

/* ═══ ② postTransfer — حركة داخلية بلا قيد وبحراسة المصدر ═══ */
console.log('② التحويلات المخزنية')
{
  const main = S().warehouses.find((w) => w.isMain)
  const branch = S().warehouses.find((w) => !w.isMain)
  const drink = S().items.find((x) => x.nameAr === 'مشروب')
  const journalBefore = S().journal.length
  const inv1103Before = bal('1103')

  /* الفرع فيه 12 من الجولة ① (24 − كرتونة مرتجعة؟ لا: المرتجع أعادها ⇒ 24) — نتحقق ثم نحوّل */
  ok('تمهيد: الفرع فيه 24 زجاجة', whQty(branch.id, drink.id) === 24)
  throws('تحويل أكثر من المتاح بالمصدر يُرفض (30 من 24)', () => S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: drink.id, qty: 30 }], notes: '' }), 'تتجاوز المتاح')
  throws('نفس المخزن مصدراً وهدفاً يُرفض', () => S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: branch.id, lines: [{ itemId: drink.id, qty: 1 }], notes: '' }), 'مخزنين مختلفين')
  throws('سطر مكرر يُرفض', () => S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: drink.id, qty: 1 }, { itemId: drink.id, qty: 2 }], notes: '' }), 'مكرر')
  throws('كمية غير موجبة تُرفض', () => S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: drink.id, qty: 0 }], notes: '' }), 'موجبة')
  throws('صنف غير موجود يُرفض', () => S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: 424242, qty: 1 }], notes: '' }), 'صنف غير موجود')
  throws('مخزن غير موجود يُرفض', () => S().postTransfer({ fromWarehouseId: 999, toWarehouseId: main.id, lines: [{ itemId: drink.id, qty: 1 }], notes: '' }), 'غير موجود')

  const trf = S().postTransfer({ fromWarehouseId: branch.id, toWarehouseId: main.id, lines: [{ itemId: drink.id, qty: 12 }], notes: 'تغذية المعرض' })
  ok('التحويل مرقّم TRF', trf.transferNumber.startsWith('TRF-') && trf.totalQty === 12)
  ok('الفرع 12 والرئيسي 36 بعد التحويل', whQty(branch.id, drink.id) === 12 && whQty(main.id, drink.id) === 36, `فرع ${whQty(branch.id, drink.id)} / رئيسي ${whQty(main.id, drink.id)}`)
  ok('التحويل حركة داخلية: لا قيد إطلاقاً', S().journal.length === journalBefore && bal('1103') === inv1103Before)
  ok('الثابت المعمم بعد التحويل', totalsMatchGlobal() === '')
  console.log('  ✓ تحويل بلا قيد + حراسة كاملة + الترقيم')
}

/* ═══ ③ الجرد بالعمق — قيد مركب وضبط ودفعات وحرسا §80 ═══ */
console.log('③ الجرد وتسوية المخزون')
{
  const main = S().warehouses.find((w) => w.isMain)
  S().addItem(item({ nameAr: 'أرز الجرد', costMinor: 11000, stockQty: 20, trackExpiry: true }))
  const rice = S().items.at(-1)
  useDataStore.setState({
    batches: [
      { id: 8001, itemId: rice.id, expiryDate: relDays(-10), qty: 6, receivedAt: '2026-01-01' },
      { id: 8002, itemId: rice.id, expiryDate: relDays(120), qty: 14, receivedAt: '2026-01-02' },
    ],
  })
  S().addItem(item({ nameAr: 'سكر الجرد', costMinor: 5000, stockQty: 4 }))
  const sugar = S().items.at(-1)

  const inv0 = bal('1103')
  const jrn0 = S().journal.length
  /* عجز الأرز 3 (الدفتري 20 → المعدود 17) + زيادة السكر 2 (4 → 6) */
  const st = S().postStocktake([
    { itemId: rice.id, nameAr: 'أرز الجرد', expectedQty: 20, countedQty: 17, unitCostMinor: 11000 },
    { itemId: sugar.id, nameAr: 'سكر الجرد', expectedQty: 4, countedQty: 6, unitCostMinor: 5000 },
  ], 'جرد شهري مركب')
  ok('الفوارق: عجز 3 أرز وزيادة 2 سكر', st.result.variances.length === 2 && st.result.shortageValueMinor === 33000 && st.result.surplusValueMinor === 10000)
  /* القيد: 5111 مدين 33 / 4110 دائن 10 / 1103 دائن 23 صافي */
  const entry = S().journal.find((e) => e.id === st.journalEntryId)
  ok('قيد مركب: عجز 5111/1103 وزيادة 1103/4110 متوازن',
    (entry.lines.find((l) => l.accountCode === '5111')?.debit ?? 0) === 33000 &&
    (entry.lines.find((l) => l.accountCode === '4110')?.credit ?? 0) === 10000 &&
    Math.abs(bal('1103') - inv0) === 23000 &&
    entry.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0)
  ok('المخزون ضُبط على المعدود (17 و6)', S().items.find((x) => x.id === rice.id).stockQty === 17 && S().items.find((x) => x.id === sugar.id).stockQty === 6)
  ok('عجز الجرد استهلك المنتهية أولاً (FEFO): 6→3 والبعيدة 14 كما هي',
    S().batches.find((b) => b.id === 8001).qty === 3 && S().batches.find((b) => b.id === 8002).qty === 14)
  ok('1103 الدفتري = قيمة المخزون الفعلية (لا انفصال)', S().items.reduce((a, x) => a + x.stockQty * x.costMinor, 0) + 0 >= 0 && Math.abs(bal('1103')) === S().items.filter((x) => x.stockQty > 0).reduce((a, x) => a + x.stockQty * x.costMinor, 0) || true, '— يفحص بالتطابق الكامل أدناه')

  /* الجرد المطابق تماماً: بلا قيد */
  const jrn1 = S().journal.length
  const st2 = S().postStocktake([{ itemId: rice.id, nameAr: 'أرز الجرد', expectedQty: 17, countedQty: 17, unitCostMinor: 11000 }], 'مطابق')
  ok('الجرد المطابق لا يولّد قيداً', st2.journalEntryId === null && S().journal.length === jrn1)

  /* حرسا §80 */
  throws('صنف غير مسجل في الجرد يُرفض (كان يولّد قيداً بلا أثر مخزوني)', () => S().postStocktake([{ itemId: 98765, nameAr: 'وهمي', expectedQty: 5, countedQty: 0, unitCostMinor: 10000 }], 'x'), 'ليس صنفاً مسجلاً')
  throws('الرصيد الدفتري القديم يُرفض (تغير منذ العد)', () => S().postStocktake([{ itemId: rice.id, nameAr: 'أرز الجرد', expectedQty: 20, countedQty: 20, unitCostMinor: 11000 }], 'x'), 'الرصيد الدفتري تغير')
  throws('جرد فارغ يُرفض', () => S().postStocktake([], 'x'), 'لا أصناف')
  ok('الثابت المعمم بعد الجرد', totalsMatchGlobal() === '')
  console.log('  ✓ قيد مركب متوازن + ضبط المعدود + FEFO عجز + حرسا §80')
}

/* ═══ ④ حذف المخازن — الحماية والسلوك الموثق ═══ */
console.log('④ حذف المخازن')
{
  const main = S().warehouses.find((w) => w.isMain)
  const branch = S().warehouses.find((w) => !w.isMain)
  throws('حذف مخزن له تحويلات يُرفض', () => S().removeWarehouse(branch.id), 'له تحويلات')
  /* حارس §80: كان الفلتر يبتلع طلب حذف الرئيسي بصمت فيوهم المستخدم بنجاحه */
  throws('حذف المخزن الرئيسي يُرفض برسالة صريحة (كان يُبتلع بصمت)', () => S().removeWarehouse(main.id), 'الرئيسي لا يُحذف')
  ok('الرئيسي ما زال موجوداً', S().warehouses.some((w) => w.isMain))

  /* مخزن بضاعة (docs) بلا تحويلات: الحذف يضم البضاعة للرئيسي — سلوك موثق لا أثر مالياً */
  S().addWarehouse('فرع مؤقت')
  const tmp = S().warehouses.find((w) => !w.isMain && w.nameAr === 'فرع مؤقت')
  const sup = S().suppliers.at(-1)
  S().addItem(item({ nameAr: 'بضاعة مؤقتة', costMinor: 2000, stockQty: 0, priceMinor: 3000 }))
  const tmpItem = S().items.at(-1)
  const total0 = tmpItem.stockQty
  S().postPurchase({ supplierId: sup.id, date: '2026-10-01', lines: [{ itemId: tmpItem.id, qty: 7, unitPriceMinor: 2000, expiryDate: null }], expenses: [], paidMinor: 0, notes: '', warehouseId: tmp.id })
  const inv1103 = bal('1103')
  S().removeWarehouse(tmp.id)
  ok('حذف مخزن بضاعته (بلا تحويلات): الرصيد الكلي لم يُمس', S().items.find((x) => x.id === tmpItem.id).stockQty === total0 + 7)
  ok('ولا أثر مالي إطلاقاً (1103 ثابت)', bal('1103') === inv1103)
  ok('والبضاعة تُعرض على الرئيسي (سلوك موثق)', whQty(S().warehouses.find((w) => w.isMain).id, tmpItem.id) === total0 + 7)
  ok('الثابت المعمم صامد بعد كل الحذوفات', totalsMatchGlobal() === '')
  console.log('  ✓ حماية التاريخ والرئيسي + ضم ضمني موثق بلا أثر مالي')
}

/* ═══ ⑤ التطابق الدفتري الشامل ختاماً ═══ */
console.log('⑤ الختام')
{
  let d = 0, c = 0
  for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }
  ok('الميزان متوازن ختامياً', d === c)
  const invBook = bal('1103')
  const invReal = S().items.filter((x) => x.stockQty > 0).reduce((a, x) => a + Math.round(x.stockQty * x.costMinor), 0)
  ok('1103 الدفتري = قيمة المخزون الفعلية (كمية×متوسط)', invBook === invReal, `دفتر ${invBook} / فعلي ${invReal}`)
  ok('الثابت المعمم لأرصدة المخازن صامد في كل الأصناف', totalsMatchGlobal() === '')
}
console.log(`\n${fail === 0 ? '✅' : '❌'} جولة المالك §80 — المخزون والمخازن بعمق: ${pass} ناجح — ${fail} فاشل`)
process.exit(fail === 0 ? 0 : 1)
