/**
 * جولة المالك §81 — بقية نواة المخزون والأصناف بعمق:
 * items (الأصناف) + itemsCsv (الاستيراد/التصدير) + batches (دفعات FEFO)
 * + serials (السيريال والضمان) + variants (مصفوفة التركيبات)
 * + حراس المستودع الجديدة (addItem/updateItem).
 *
 * العيب المُصلح في هذه الجولة (مُقاس قبل الإصلاح):
 *   المستودع كان يقبل أي صنف بلا حراسة — الواجهة وحدها تفحص (validateItem)،
 *   ومسارات حية تتجاوزها: الإضافة السريعة في فاتورة الشراء (quickAdd) ونافذة
 *   التحرير السريعة. قيس: صنفان بنفس الباركود يمرّان والكاشير يبيع الأول دائماً،
 *   ومعامل وحدة 0.5 يمر (يخصم نصف وحدة بدل 12)، وسيريال+وزن معاً يمر.
 *   كما أن validateItem نفسها لم تكن تفحص باركود الوحدة الكبرى ولا تفرد SKU.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_items_core_depth.mjs
 */
const relDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const itemsCore = await import('../src/core/items.ts')
const { parseCsv, buildItemsCsv, parseItemsCsv } = await import('../src/core/itemsCsv.ts')
const batchesCore = await import('../src/core/batches.ts')
const serialsCore = await import('../src/core/serials.ts')
const variantsCore = await import('../src/core/variants.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const item = (over) => ({ nameAr: 'ص', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over })

/* ═══ ① حراس المستودع الجديدة — انحدار عيب §81 ═══ */
console.log('① حراس addItem/updateItem داخل المستودع (انحدار)')
{
  S().addItem(item({ nameAr: 'أصلي', barcodes: ['6221001'], priceMinor: 5000, costMinor: 2000, stockQty: 100 }))
  throws('صنف جديد بنفس باركود صنف قائم يُرفض (كان يمر — الكاشير يبيع الأول دائماً)', () => S().addItem(item({ nameAr: 'مقلد', barcodes: ['6221001'] })), 'مستخدم في صنف آخر')
  const orig = S().items[0]
  throws('updateItem بمعامل وحدة 0.5 يُرفض (كان يخصم نصف وحدة بدل 12)', () => S().updateItem(orig.id, { extraUnits: [{ nameAr: 'كرتونة فاسدة', factor: 0.5 }] }), 'أكبر من 1')
  throws('updateItem بسيريال+وزن معاً يُرفض', () => S().updateItem(orig.id, { trackSerial: true, soldByWeight: true }), 'السيريال مع البيع بالوزن')
  throws('updateItem بباركود وحدة كبرى مكرر (على الصنف نفسه — أدق رسالة) يُرفض', () => S().updateItem(orig.id, { extraUnits: [{ nameAr: 'كرتونة', factor: 12, barcode: '6221001' }] }), 'مكرر بين الصنف')
  throws('اسم صنف فارغ يُرفض', () => S().addItem(item({ nameAr: '   ' })), 'اسم الصنف مطلوب')
  throws('صنف خدمة بتتبع صلاحية يُرفض', () => S().addItem(item({ nameAr: 'خدمة مخالفة', isService: true, trackExpiry: true })), 'صنف الخدمة')
  throws('سعر سالب يُرفض', () => S().addItem(item({ nameAr: 'سالب', priceMinor: -5 })), 'سالبة')

  /* الشكل الجزئي القديم (اختبار العملات يمرره) ما زال يمر — توافق خلفي */
  S().addItem({ nameAr: 'صنف شكل قديم', categoryId: null, unit: 'قطعة', priceMinor: 500000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 200000, stockQty: 100 })
  ok('الشكل الجزئي القديم (بلا baseUnit/barcodes) يمر — التوافق الخلفي محفوظ', S().items.some((x) => x.nameAr === 'صنف شكل قديم'))
  /* تحذير سعر الصفر لا يمنع */
  S().addItem(item({ nameAr: 'بلا سعر بعد' }))
  ok('سعر البيع صفر تحذير شاشة لا رفض مستودع', S().items.some((x) => x.nameAr === 'بلا سعر بعد'))
  /* SKU مكرر يُرفض */
  S().addItem(item({ nameAr: 'بكود', sku: 'ITM-777' }))
  throws('SKU مكرر يُرفض', () => S().addItem(item({ nameAr: 'آخر بكود', sku: 'ITM-777' })), 'كود الصنف')
  /* الرصيد الافتتاحي ما زال يثبت القيد (AUDIT-005) مع الحرس الجديد */
  const jrn0 = S().journal.length
  S().addItem(item({ nameAr: 'بقيد افتتاحي', costMinor: 3000, stockQty: 10 }))
  ok('الرصيد الافتتاحي ما زال يولّد قيد 1103/3101 (AUDIT-005)', S().journal.length === jrn0 + 1)
  /* حراس الحذف الأصليون */
  const protectedItem = S().items[0]
  throws('حذف صنف يتطلب اعتماداً (حارس أصلي — لا انكسار)', () => S().removeItem(protectedItem.id), 'الرقم السري')
  console.log('  ✓ المستودع محروس من كل المتصلين — والشكل القديم ما زال يعمل')
}

/* ═══ ② نواة الأصناف الصرفة ═══ */
console.log('② نواة items الصرفة')
{
  const { validateItem, itemBlockers, priceFloorViolations, effectiveVatPercent, nextSku, sameIngredientAlternatives, itemMatchesPartQuery, normalizePartNumber, categoryPath, categoryDescendants } = itemsCore
  /* validateItem: الواجهة تفحص الاكتمال + التحذيرات لا قاتل */
  const v = validateItem(item({ priceMinor: 0 }), [])
  ok('validateItem: سعر صفر تحذير واسم مطلوب خطأ', v.some((e) => e.startsWith('تنبيه: سعر')) && v.includes('اسم الصنف مطلوب') === false)
  ok('itemBlockers: التحذيرات لا تعود قاتلة', itemBlockers(item({ priceMinor: 0 }), []).length === 0)
  /* priceFloor: السعر بالأساسية بعد الخصم وبالمعامل */
  const lines = [
    { itemId: 1, unitPriceMinor: 5000, unitFactor: 12, discountPercent: 0 }, /* 416.67/أساسية > تكلفة 300 ✓ */
    { itemId: 2, unitPriceMinor: 1100, discountPercent: 50, unitFactor: 1 }, /* 550 < تكلفة 600 ⇒ مخالف */
  ]
  const its = [
    { id: 1, nameAr: 'كرتونة', minSalePriceMinor: 0, costMinor: 300 },
    { id: 2, nameAr: 'مخفّض', minSalePriceMinor: 0, costMinor: 600 },
  ]
  ok('priceFloor: وحدة كبرى تُقيَّم بالأساسية وسطر مخفّض يُضبط', eq(priceFloorViolations(lines, its), ['مخفّض']))
  ok('priceFloor: الحد الأدنى اليدوي يسري', priceFloorViolations([{ itemId: 3, unitPriceMinor: 700, discountPercent: 0 }], [{ id: 3, nameAr: 'حد يدوي', minSalePriceMinor: 800, costMinor: 100 }]).includes('حد يدوي'))
  /* vat */
  ok('effectiveVat: تجاوز الصنف ثم العام', effectiveVatPercent({ vatOverride: 5 }, 14) === 5 && effectiveVatPercent({ vatOverride: null }, 14) === 14 && effectiveVatPercent({}, 14) === 14)
  /* nextSku تسلسل حتى مع أكواد فوضوية */
  ok('nextSku: أعلى رقم + 1 ويتجاهل غير الرقمي', nextSku([{ sku: 'ITM-1002' }, { sku: 'X' }, { sku: 'ITM-999' }]) === 'ITM-1003')
  /* بدائل الدواء بنفس المادة الفعالة */
  const all = [
    { id: 1, nameAr: 'أ', activeIngredient: '  باراسيتامول 500 ', isActive: true, stockQty: 5, priceMinor: 900 },
    { id: 2, nameAr: 'ب', activeIngredient: 'باراسيتامول 500', isActive: true, stockQty: 3, priceMinor: 700 },
    { id: 3, nameAr: 'ج', activeIngredient: 'باراسيتامول 500', isActive: true, stockQty: 0, priceMinor: 100 },
    { id: 4, nameAr: 'د', activeIngredient: 'باراسيتامول 500', isActive: false, stockQty: 9, priceMinor: 100 },
    { id: 5, nameAr: 'هـ', activeIngredient: 'أموكسيسيلين', isActive: true, stockQty: 9, priceMinor: 100 },
  ]
  const alts = sameIngredientAlternatives({ id: 9, activeIngredient: 'باراسيتامول 500' }, all)
  ok('بدائل الدواء: نفس المادة (تطبيع فراغات) نشط ومتوفر ومرتب بالسعر', eq(alts.map((a) => a.id), [2, 1]))
  /* بحث قطع الغيار */
  const part = { ...item({ nameAr: 'طلمبة مياه' }), sku: 'WP-11', barcodes: ['123'], oemNumbers: ['BOSCH-0986', '0 986 119 021'], fitment: 'تويوتا كورولا 2012' }
  ok('بحث القطع: OEM بلا حساسية شرطات وحالة', itemMatchesPartQuery(part, 'bosch 0986') && itemMatchesPartQuery(part, '0986119021'))
  ok('بحث القطع: أقل من 3 محارف OEM لا يبحث (ضجيج قصير)', !itemMatchesPartQuery({ ...part, nameAr: 'غير مطابق' }, '09'))
  ok('بحث القطع: الاسم والSKU والباركود والتوافق', itemMatchesPartQuery(part, 'طلمبة') && itemMatchesPartQuery(part, 'WP-11') && itemMatchesPartQuery(part, '123') && itemMatchesPartQuery(part, 'كورولا'))
  /* شجرة الأقسام */
  const cats = [{ id: 1, nameAr: 'أغذية', parentId: null, features: [] }, { id: 2, nameAr: 'ألبان', parentId: 1, features: [] }, { id: 3, nameAr: 'أجبان', parentId: 2, features: [] }]
  ok('categoryPath: المسار الكامل', categoryPath(cats[2], cats) === 'أغذية ← ألبان ← أجبان')
  ok('categoryDescendants: الجذر يجمع الشجرة', eq(categoryDescendants(1, cats), [1, 2, 3]))
  console.log('  ✓ أرضية السعر بالأساسية · VAT · SKU · بدائل الدواء · بحث القطع · شجرة الأقسام')
}

/* ═══ ③ نواة دفعات الصلاحية الصرفة ═══ */
console.log('③ نواة batches (FEFO)')
{
  const { sortFefo, planFefo, applyFefo, expiryAlerts, expiredQty, isValidExpiryDate } = batchesCore
  const today = '2026-10-02'
  const mk = (id, expiry, qty, receivedAt = '2026-01-01', warehouseId = null) => ({ id, itemId: 7, expiryDate: expiry, qty, purchaseId: null, receivedAt, warehouseId })
  const list = [mk(1, relDays(400), 5, '2026-03-01'), mk(2, null, 3), mk(3, relDays(10), 4), mk(4, relDays(-5), 2), mk(5, relDays(10), 1, '2026-02-01')]
  /* الترتيب: الأقرب انتهاءً أولاً، بلا تاريخ أخيراً، ثم الأقدم استلاماً */
  ok('sortFefo: المنتهي ثم الأقرب ثم الأقدم استلاماً وبلا تاريخ أخيراً', eq(sortFefo(list).map((b) => b.id), [4, 3, 5, 1, 2]))
  /* خطة الصرف: تغطية حتى الدفعات ثم untracked */
  const plan = planFefo(list, 7, 12, today)
  ok('planFefo: المخصصات بالترتيب وتتوقف عند تغطية الكمية (12 = 2+4+1+5)', eq(plan.allocations.map((a) => [a.batchId, a.qty]), [[4, 2], [3, 4], [5, 1], [1, 5]]))
  ok('planFefo: الكمية داخل تغطية الدفعات ⇒ صفر untracked ولمس المنتهي', plan.untrackedQty === 0 && plan.touchesExpired)
  ok('planFefo: ما فوق الدفعات untracked بلا اعتراض', planFefo(list, 7, 20, today).untrackedQty === 5)
  const plan2 = planFefo(list, 7, 6, today)
  ok('planFefo: 6 من الأقرب (2 منتهي + 4 القريب) بلا untracked', plan2.untrackedQty === 0 && eq(plan2.allocations.map((a) => a.qty), [2, 4]))
  ok('planFefo: الدفعات بلا مخزن (سجلات قديمة) تُصرف من أي مخزن — غير المقيد بما يفيض عن كل الدفعات', planFefo(list, 7, 100, today, 99).untrackedQty === 100 - 15)
  /* التطبيق: الخصم وحذف الصفرية */
  const applied = applyFefo(list, plan2)
  ok('applyFefo: خصم المخصصات وحذف الدفعات الصفرية', !applied.some((b) => b.id === 4 || b.id === 3) && applied.find((b) => b.id === 5).qty === 1)
  /* تنبيهات الصلاحية */
  const alerts = expiryAlerts(list, () => 'صنف', today, 30)
  ok('expiryAlerts: المنتهي أولاً ثم القريبان (10 أيام) والبعيد خارج الأفق', alerts.length === 3 && alerts[0].status === 'expired' && alerts[0].daysLeft < 0 && alerts.slice(1).every((a) => a.status === 'soon' && a.expiryDate === relDays(10)))
  ok('expiredQty: 2 فقط', expiredQty(list, 7, today) === 2)
  ok('isValidExpiryDate: صيغة وتقويم حقيقي', isValidExpiryDate('2026-10-15') && !isValidExpiryDate('2026-02-30') && !isValidExpiryDate('15/10/2026'))
  console.log('  ✓ ترتيب FEFO · خطة وتطبيق · untracked · تنبيهات · تقويم')
}

/* ═══ ④ نواة السيريال والضمان الصرفة ═══ */
console.log('④ نواة serials (السيريال والضمان)')
{
  const { parseSerialsInput, markSold, markReturned, markReturnedToSupplier, warrantyEndDate, warrantyLookup, availableSerials } = serialsCore
  /* الإدخال: أرقام عربية وفواصل عربية ومكررات */
  const parsed = parseSerialsInput('356789٠١٢٣٤٥٦٧٨, IMEI-1؛bad, 356789٠١٢٣٤٥٦٧٨, ok-12, exists-1', new Set(['EXISTS-1']))
  ok('parseSerialsInput: تطبيع الأرقام العربية وفصل الفواصل العربية', parsed.accepted.includes('356789012345678') && parsed.accepted.includes('IMEI-1') && parsed.accepted.includes('OK-12'))
  ok('parseSerialsInput: القصير مرفوض والمكرر داخل الإدخال والمسجل مسبقاً مرفوضة', parsed.errors.length === 3 && parsed.errors.some((e) => e.includes('مسجل من قبل')))
  /* البيع */
  const pool = [
    { id: 1, itemId: 1, serial: 'AAA-1', status: 'in_stock', purchaseId: 1, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01' },
    { id: 2, itemId: 1, serial: 'AAA-2', status: 'sold', purchaseId: 1, saleId: 9, soldAt: '2026-05-01', warrantyMonths: 12, receivedAt: '2026-01-01' },
    { id: 3, itemId: 2, serial: 'BBB-1', status: 'in_stock', purchaseId: 2, saleId: null, soldAt: null, warrantyMonths: 6, receivedAt: '2026-01-02' },
  ]
  throws('markSold: سيريال يخص صنفاً آخر يُرفض', () => markSold(pool, [{ itemId: 1, serial: 'BBB-1' }], 10, '2026-10-01'), 'صنفاً آخر')
  throws('markSold: مباع مسبقاً يُرفض', () => markSold(pool, [{ itemId: 1, serial: 'AAA-2' }], 10, '2026-10-01'), 'مباع بالفعل')
  throws('markSold: مكرر في نفس الفاتورة يُرفض (بعد التطبيع)', () => markSold(pool, [{ itemId: 1, serial: 'AAA-1' }, { itemId: 1, serial: 'aaa-1' }], 10, '2026-10-01'), 'مكرر')
  const sold = markSold(pool, [{ itemId: 1, serial: 'AAA-1' }], 10, '2026-10-01')
  ok('markSold: التعيين يسجل الفاتورة والتاريخ', sold.find((u) => u.serial === 'AAA-1').status === 'sold' && sold.find((u) => u.serial === 'AAA-1').saleId === 10)
  /* المرتجع: لا يعيد إلا مباع نفس الفاتورة */
  const ret = markReturned(pool, 9, ['AAA-2', 'AAA-1'])
  ok('markReturned: يعيد مباع هذه الفاتورة فقط (وغير المباع لا يُمس)', ret.find((u) => u.serial === 'AAA-2').status === 'in_stock' && ret.find((u) => u.serial === 'AAA-1').status === 'in_stock')
  /* مرتجع المورد: FIFO من نفس فاتورة الشراء فقط */
  const pool2 = [
    { id: 1, itemId: 1, serial: 'P1-A', status: 'in_stock', purchaseId: 1, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2026-01-02' },
    { id: 2, itemId: 1, serial: 'P1-B', status: 'in_stock', purchaseId: 1, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2026-01-01' },
    { id: 3, itemId: 1, serial: 'P2-A', status: 'in_stock', purchaseId: 2, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2025-12-01' },
    { id: 4, itemId: 1, serial: 'P1-S', status: 'sold', purchaseId: 1, saleId: 1, soldAt: '2026-01-05', warrantyMonths: 0, receivedAt: '2025-12-01' },
  ]
  const toSup = markReturnedToSupplier(pool2, 1, 1, 2)
  ok('markReturnedToSupplier: الأقدم استلاماً من نفس الفاتورة والمتاح فقط', toSup.find((u) => u.id === 2).status === 'returned_supplier' && toSup.find((u) => u.id === 1).status === 'returned_supplier' && toSup.find((u) => u.id === 3).status === 'in_stock' && toSup.find((u) => u.id === 4).status === 'sold')
  ok('availableSerials: كل متاح الصنف (أي فاتورة شراء) بالأقدم دخولاً', eq(availableSerials(pool2, 1).map((u) => u.id), [3, 2, 1]))
  /* الضمان: تشبع نهاية الشهر */
  ok('warrantyEndDate: 31/1 + شهر = 28/2 (تشبع الشهر)', warrantyEndDate('2026-01-31T10:00:00Z', 1) === '2026-02-28')
  ok('warrantyEndDate: 15/3 + 12 شهر = 15/3 القادم', warrantyEndDate('2026-03-15T00:00:00Z', 12) === '2027-03-15')
  const w = warrantyLookup(pool, 'aaa-2', '2026-10-02') /* مباع 2026-05-01 بضمان 12 */
  ok('warrantyLookup: نشط حتى 2027-05-01 وبحث بتطبيع الحالة', w?.active === true && w?.warrantyUntil === '2027-05-01')
  const w2 = warrantyLookup(pool, 'AAA-1', '2026-10-02')
  ok('warrantyLookup: غير المباع لا ضمان له', w2 === undefined)
  console.log('  ✓ إدخال/بيع/مرتجع مبيعات/مرتجع مورد/ضمان بحواف الشهور')
}

/* ═══ ⑤ نواة مصفوفة التركيبات الصرفة ═══ */
console.log('⑤ نواة variants (التركيبات)')
{
  const { variantKey, variantTotal, undistributedQty, hasVariantStock, validateVariantAssignment, planVariantDeduction } = variantsCore
  const stocks = [
    { itemId: 1, color: 'أحمر', size: 'L', qty: 5 },
    { itemId: 1, color: 'أزرق', size: 'M', qty: 3 },
  ]
  ok('variantTotal/undistributed: 8 موزعة من 10', variantTotal(stocks, 1) === 8 && undistributedQty(10, stocks, 1) === 2)
  ok('hasVariantStock: بالكمية لا بالوجود', hasVariantStock(stocks, 1) && !hasVariantStock([{ itemId: 1, color: 'أ', size: '', qty: 0 }], 1))
  ok('validateVariantAssignment: لون ليس من ألوان الصنف يُرفض', validateVariantAssignment({ color: 'أخضر', size: '', qty: 2, itemColors: ['أحمر'], itemSizes: [], itemStockQty: 10, currentStocks: stocks, itemId: 1 }).some((e) => e.includes('ليس من ألوان')))
  ok('validateVariantAssignment: تجاوز رصيد الصنف يُرفض', validateVariantAssignment({ color: 'أحمر', size: 'L', qty: 8, itemColors: ['أحمر'], itemSizes: ['L'], itemStockQty: 10, currentStocks: [{ itemId: 1, color: 'أزرق', size: 'M', qty: 3 }], itemId: 1 }).some((e) => e.includes('يتجاوز رصيد الصنف')))
  ok('validateVariantAssignment: الاستبدال لا يحسب التركيبة نفسها مرتين (7 الجديدة + 3 أزرق = 10 بالضبط)', validateVariantAssignment({ color: 'أحمر', size: 'L', qty: 7, itemColors: ['أحمر'], itemSizes: ['L'], itemStockQty: 10, currentStocks: stocks, itemId: 1 }).length === 0)
  throws('planVariantDeduction: نقص التركيبة يرمي بالعربية', () => planVariantDeduction(stocks, [{ itemId: 1, color: 'أحمر', size: 'L', qty: 6, itemName: 'قميص' }]), 'متاح 5 ومطلوب 6')
  const plan = planVariantDeduction(stocks, [
    { itemId: 1, color: 'أحمر', size: 'L', qty: 2, itemName: 'قميص' },
    { itemId: 1, color: 'أحمر', size: 'L', qty: 3, itemName: 'قميص' }, /* نفس التركيبة من سطر آخر تُجمع */
  ])
  ok('planVariantDeduction: تجميع سطور التركيبة نفسها', plan.get(`1⁞${variantKey('أحمر', 'L')}`) === 5)
  console.log('  ✓ قاعدة «المجموع ≤ الإجمالي» · الاستبدال · التخطيط بالتجميع')
}

/* ═══ ⑥ استيراد/تصدير CSV دورة كاملة ═══ */
console.log('⑥ itemsCsv — دورة التصدير/الاستيراد')
{
  const cur = { symbol: 'ج', decimals: 2, code: 'EGP' }
  const rows = [
    { nameAr: 'أرز', barcode: '6220001', categoryName: 'بقالة', baseUnit: 'كجم', priceMinor: 4500, costMinor: 3000, stockQty: 10, minQty: 2 },
    { nameAr: 'زيت, فاخر', barcode: '', categoryName: 'بقالة', baseUnit: 'زجاجة', priceMinor: 8000, costMinor: 6000, stockQty: 5, minQty: 1 },
  ]
  const csv = buildItemsCsv(rows, cur)
  /* دورة كاملة: التصدير يُعاد استيراده فيطابق */
  const rep = parseItemsCsv(csv, cur, { names: new Set(), barcodes: new Set() })
  ok('دورة كاملة: التصدير يُستورد بلا أخطاء وبنفس القيم (والاقتباس RFC 4180 يحفظ الفاصلة في الاسم)', rep.errors.length === 0 && rep.items.length === 2 && rep.items[1].nameAr === 'زيت, فاخر' && rep.items[0].priceMinor === 4500 && rep.items[0].stockQty === 10)
  /* المكرر ضد القائم وداخل الملف */
  const rep2 = parseItemsCsv(csv, cur, { names: new Set(['أرز']), barcodes: new Set() })
  ok('الاسم الموجود مسبقاً يُتخطى لا يُرفض', rep2.skippedDuplicates === 1 && rep2.items.length === 1)
  const dupCsv = 'الاسم,الباركود,القسم,الوحدة,سعر البيع,التكلفة الافتتاحية,الرصيد الافتتاحي,حد الطلب\r\nس,1,ق,قطعة,10,5,1,1\r\nس,2,ق,قطعة,10,5,1,1\r\nص,1,ق,قطعة,10,5,1,1'
  const rep3 = parseItemsCsv(dupCsv, cur, { names: new Set(), barcodes: new Set() })
  ok('التكرار داخل الملف (اسم ثم باركود) يتخطى', rep3.skippedDuplicates === 2 && rep3.items.length === 1)
  /* الرفض الصريح */
  const badCsv = 'الاسم,الباركود,القسم,الوحدة,سعر البيع,التكلفة الافتتاحية,الرصيد الافتتاحي,حد الطلب\r\n,1,ق,قطعة,10,5,1,1\r\nس,2,ق,قطعة,-10,5,1,1\r\nص,3,ق,قطعة,10,5,-1,1\r\nد,4,ق,قطعة,سعر!خاطئ,5,1,1'
  const rep4 = parseItemsCsv(badCsv, cur, { names: new Set(), barcodes: new Set() })
  ok('الصفوف المعيبة تُرفض بأرقامها (اسم/سالبان/سعر فاسد)', rep4.errors.length === 4 && rep4.errors[0].includes('صف 2'))
  ok('الترويسة الخاطئة ترفض الملف كله', parseItemsCsv('a,b,c,d,e', cur, { names: new Set(), barcodes: new Set() }).errors[0].includes('الترويسة'))
  /* أرقام عربية */
  const arCsv = 'الاسم,الباركود,القسم,الوحدة,سعر البيع,التكلفة الافتتاحية,الرصيد الافتتاحي,حد الطلب\r\nعربي,٦٢٢٠٠٠٩,ق,قطعة,١٢٫٥٠,٧,٣,١'
  const rep5 = parseItemsCsv(arCsv, cur, { names: new Set(), barcodes: new Set() })
  ok('الأرقام العربية تُقرأ والباركود يُطبَّع', rep5.items[0].priceMinor === 1250 && rep5.items[0].barcode === '6220009')
  ok('parseCsv: BOM يُزال والأسطر الفارغة تسقط', parseCsv('\uFEFFأ,ب\r\n\r\n1,2').length === 2)
  console.log('  ✓ دورة كاملة · اقتباس · مكررات · رفض بأرقام الصفوف · أرقام عربية')
}

/* ═══ ⑦ الختام الحي: القيود والثوابت ═══ */
console.log('⑦ الختام')
{
  let d = 0, c = 0
  for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }
  ok('الميزان متوازن ختامياً', d === c)
  const invBook = S().journal.reduce((v, e) => v + e.lines.reduce((s, l) => s + (l.accountCode === '1103' ? l.debit - l.credit : 0), 0), 0)
  const invReal = S().items.filter((x) => (x.stockQty ?? 0) > 0).reduce((a, x) => a + Math.round(x.stockQty * x.costMinor), 0)
  ok('1103 الدفتري = قيمة المخزون الفعلية', invBook === invReal, `دفتر ${invBook} / فعلي ${invReal}`)
}
console.log(`\n${fail === 0 ? '✅' : '❌'} جولة المالك §81 — نواة الأصناف والدفعات والسيريال والتركيبات: ${pass} ناجح — ${fail} فاشل`)
process.exit(fail === 0 ? 0 : 1)
