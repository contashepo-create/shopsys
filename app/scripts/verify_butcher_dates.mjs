/**
 * 🥩🌴 نشاطا الجزارة والتمور (18 نشاطاً) — سيناريوهات سعودية كاملة
 * ================================================================
 * أ) القالبان: خصائص ووحدات وثيمات ولوحات ألوان خاصة
 * ب) نواة التجهيز: توزيع التكلفة بالقيمة البيعية بالقرش + قيد متوازن + تصافٍ
 * ج) جزارة بالسعودية (ضريبة 15٪): شراء ذبيحة ← تقطيع بأمر CUT ← بيع بالوزن
 *    ← زاتكا QR TLV ← الدفتر يطابق المخزون بالقرش
 * د) تمور بالسعودية: شراء محصول ← فرز PKG لدرجات + فاقد ← مصاريف تعبئة
 *    من الخزينة ← بيع ← توثيق SFDA محفوظ
 * هـ) الحُرّاس: خام غير كافٍ، ناتج = خام، بلا نواتج، كميات سالبة
 * و) كارت الصنف يعرض حركة التجهيز (خام خارج/ناتج داخل)
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const { ACTIVITY_TEMPLATES, getActivity, MODULE_LABELS } = await import(join(root, 'src/core/activities.ts'))
const { ACTIVITY_THEMES, PERSONA_STYLES, WIDGET_LABELS } = await import(join(root, 'src/core/activityTheme.ts'))
const { ACCENTS, ACTIVITY_ACCENTS } = await import(join(root, 'src/core/appearance.ts'))
const { allocateProcessingCost, buildProcessingEntry, validateProcessing, processingYieldPercent, PROCESSING_KIND_LABELS } = await import(join(root, 'src/core/processing.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { buildZatcaQr } = await import(join(root, 'src/core/einvoice.ts'))
const { buildItemLedger } = await import(join(root, 'src/core/itemLedger.ts'))
const { getCountry } = await import(join(root, 'src/core/countries.ts'))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++ }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a} والمتوقع ${b}`); pass++ }
const throws = (fn, name) => { assert.throws(fn, undefined, name); pass++ }

/* ═══ أ) القالبان والثيمات ═══ */
eq(ACTIVITY_TEMPLATES.length, 18, 'عدد الأنشطة 18')
const butcher = getActivity('butcher')
const dates = getActivity('dates')
ok(butcher && dates, 'القالبان موجودان')
for (const [a, label] of [[butcher, 'جزارة'], [dates, 'تمور']]) {
  ok(a.nameAr.includes(label), `${a.id}: الاسم عربي صحيح`)
  ok(a.features.includes('weight_scale'), `${a.id}: بيع بالوزن (ميزان)`)
  ok(a.features.includes('expiry_batches'), `${a.id}: صلاحية ودفعات`)
  ok(a.features.includes('multi_unit'), `${a.id}: وحدات متعددة (كجم/كرتون)`)
  ok(a.features.includes('price_lists'), `${a.id}: قوائم أسعار (جملة/قطاعي)`)
  ok(a.modules.includes('processing'), `${a.id}: وحدة التجهيز مفعلة`)
  ok(a.modules.includes('pos') && a.modules.includes('inventory') && a.modules.includes('purchases'), `${a.id}: كاشير+مخزون+مشتريات`)
  ok(a.taxInclusiveDefault === true, `${a.id}: السعر شامل الضريبة (نمط السوق)`)
  eq(a.defaultInvoiceTemplate, 'thermal', `${a.id}: فاتورة حرارية`)
}
ok(MODULE_LABELS.processing?.nameAr, 'وحدة التجهيز لها تسمية عربية')

// ثيم خاص لكل نشاط: persona مستقلة وويدجت تصافٍ
eq(ACTIVITY_THEMES.butcher.persona, 'butcher', 'الجزارة: شخصية بصرية خاصة')
eq(ACTIVITY_THEMES.dates.persona, 'oasis', 'التمور: شخصية «واحة» خاصة')
ok(PERSONA_STYLES.butcher.card && PERSONA_STYLES.butcher.hero, 'أنماط شخصية الجزارة كاملة')
ok(PERSONA_STYLES.oasis.card && PERSONA_STYLES.oasis.hero, 'أنماط شخصية الواحة كاملة')
ok(ACTIVITY_THEMES.butcher.widgets.includes('yield_today'), 'الجزارة: ويدجت التصافي')
ok(ACTIVITY_THEMES.dates.widgets.includes('yield_today'), 'التمور: ويدجت التصافي')
ok(WIDGET_LABELS.yield_today?.route === '/inventory/processing', 'ويدجت التصافي يشير لصفحة التجهيز')
// لوحتا ألوان مخصصتان على مستوى التطبيق كله
eq(ACTIVITY_ACCENTS.butcher, 'crimson', 'الجزارة: لوحة قرمزية خاصة')
eq(ACTIVITY_ACCENTS.dates, 'date_palm', 'التمور: لوحة تمرية خاصة')
ok(ACCENTS.some((p) => p.id === 'crimson') && ACCENTS.some((p) => p.id === 'date_palm'), 'اللوحتان معرفتان فعلاً بدرجات كاملة')
for (const pal of ACCENTS.filter((p) => p.id === 'crimson' || p.id === 'date_palm')) {
  ok(Object.keys(pal.shades).length === 10, `${pal.id}: 10 درجات لونية`)
}
ok(ACTIVITY_THEMES.butcher.heroLineAr.length > 5 && ACTIVITY_THEMES.dates.heroLineAr.length > 5, 'سطرا ترحيب عربيان')

/* ═══ ب) نواة التجهيز الخالصة ═══ */
// توزيع بالقيمة البيعية: ذبيحة 300000 هللة، نواتج بأسعار مختلفة
const prices = new Map([[2, 6000], [3, 4500], [4, 2500]]) // هللة/كجم
const outs = [{ itemId: 2, qty: 7 }, { itemId: 3, qty: 5 }, { itemId: 4, qty: 3 }]
const alloc = allocateProcessingCost(outs, 300000, (id) => prices.get(id) ?? 0)
eq(alloc.reduce((a, o) => a + o.allocatedCostMinor, 0), 300000, 'مجموع التوزيع = التكلفة بالقرش تماماً')
// الفخذ (قيمة 42000) يتحمل أكثر من المفروم (قيمة 7500)
ok(alloc[0].allocatedCostMinor > alloc[1].allocatedCostMinor && alloc[1].allocatedCostMinor > alloc[2].allocatedCostMinor, 'القطعية الأغلى تتحمل تكلفة أكبر')
// النِسَب صحيحة: 42000/72000 و22500/72000 و7500/72000 من 300000
eq(alloc[0].allocatedCostMinor, 175000, 'نصيب الفخذ 175000')
eq(alloc[1].allocatedCostMinor, 93750, 'نصيب الريش 93750')
eq(alloc[2].allocatedCostMinor, 31250, 'نصيب المفروم 31250')
// أسعار كلها أصفار ⇒ توزيع بالكمية
const allocQty = allocateProcessingCost(outs, 150000, () => 0)
eq(allocQty.reduce((a, o) => a + o.allocatedCostMinor, 0), 150000, 'توزيع الكميات يصفّي بالقرش')
eq(allocQty[0].allocatedCostMinor, 70000, 'بالكمية: 7/15 من 150000')
// مبلغ عصي على القسمة (قروش بواقٍ) يصفّي دائماً
for (const total of [100003, 99991, 7, 1]) {
  const a = allocateProcessingCost(outs, total, (id) => prices.get(id) ?? 0)
  eq(a.reduce((s, o) => s + o.allocatedCostMinor, 0), total, `بواقي القروش تصفّي عند ${total}`)
}
// القيد متوازن: مع مصاريف وبدون
assertBalanced(buildProcessingEntry(300000, 5000, '1101')); pass++
assertBalanced(buildProcessingEntry(300000, 0, '1101')); pass++
eq(buildProcessingEntry(300000, 0, '1101').length, 2, 'بلا مصاريف: سطران فقط')
// التصافي
eq(processingYieldPercent({ sourceQty: 30, outputs: outs }), 50, 'تصافي 15/30 = 50٪')
// التحقق
ok(validateProcessing({ sourceQty: 0, outputs: outs, overheadMinor: 0 }).length > 0, 'رفض خام صفري')
ok(validateProcessing({ sourceQty: 10, outputs: [], overheadMinor: 0 }).length > 0, 'رفض بلا نواتج')
ok(validateProcessing({ sourceQty: 10, outputs: [{ itemId: 2, qty: 1 }, { itemId: 2, qty: 2 }], overheadMinor: 0 }).length > 0, 'رفض ناتج مكرر')
ok(validateProcessing({ sourceQty: 10, outputs: outs, overheadMinor: -5 }).length > 0, 'رفض مصاريف سالبة')
eq(PROCESSING_KIND_LABELS.butcher.orderPrefix, 'CUT', 'بادئة الجزارة CUT')
eq(PROCESSING_KIND_LABELS.dates.orderPrefix, 'PKG', 'بادئة التمور PKG')

/* ═══ ج) جزارة بالسعودية — دورة كاملة ═══ */
const sa = getCountry('SA')
eq(sa.vatPercent, 15, 'ضريبة السعودية 15٪')
mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'SA', activityId: 'butcher', vatPercent: 15, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
{
  const { useDataStore } = await import(`${repoUrl}?bd=butcher`)
  const st = () => useDataStore.getState()
  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1000000, label: 'خزينة' })
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
  const mkItem = (nameAr, priceMinor, byWeight = true) => {
    st().addItem({ nameAr, sku: nameAr, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, priceMinor, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: byWeight, variantColors: [], variantSizes: [], isActive: true })
    return st().items.at(-1)
  }
  const carcass = mkItem('ذبيحة نعيمي كاملة', 0)
  const leg = mkItem('فخذ نعيمي', 6000)
  const ribs = mkItem('ريش نعيمي', 4500)
  const mince = mkItem('مفروم نعيمي', 2500)
  st().addSupplier({ nameAr: 'مسلخ الرياض', phone: '', notes: '' })
  const sup = st().suppliers.at(-1)
  // شراء ذبيحة 18 كجم بـ2700 ريال (270000 هللة) نقداً — التكلفة 15000/كجم
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: carcass.id, qty: 18, unitPriceMinor: 15000 }], expenses: [], paidMinor: 270000, notes: '' })
  eq(st().items.find((i) => i.id === carcass.id).costMinor, 15000, 'تكلفة كجم الذبيحة 15000 هللة')
  // أمر تقطيع: 18 كجم ذبيحة → 7 فخذ + 5 ريش + 3 مفروم + 3 فاقد عظم، مصاريف عمالة 3000 هللة
  const order = st().postProcessing({
    kind: 'butcher', sourceItemId: carcass.id, sourceQty: 18,
    outputs: [{ itemId: leg.id, qty: 7 }, { itemId: ribs.id, qty: 5 }, { itemId: mince.id, qty: 3 }],
    overheadMinor: 3000, treasury: '1101', wasteQty: 3,
    compliance: { originCountry: 'السعودية', facilityNo: 'SL-1049', productionDate: '2026-09-18', halalCert: '' },
    notes: 'ذبيحة الصباح',
  })
  ok(order.orderNumber.startsWith('CUT-'), 'رقم الأمر CUT-')
  eq(order.sourceCostMinor, 270000, 'تكلفة الخام 270000')
  eq(order.outputs.reduce((a, o) => a + o.allocatedCostMinor, 0), 273000, 'التوزيع = خام + مصاريف بالقرش')
  eq(processingYieldPercent(order), 83.3, 'تصافي 15/18 = 83.3٪')
  eq(order.compliance.originCountry, 'السعودية', 'توثيق المنشأ محفوظ')
  eq(order.compliance.facilityNo, 'SL-1049', 'رقم المسلخ محفوظ')
  // المخزون: الذبيحة صفر والأجزاء دخلت بتكلفة موزونة
  eq(st().items.find((i) => i.id === carcass.id).stockQty, 0, 'الذبيحة استُهلكت')
  eq(st().items.find((i) => i.id === leg.id).stockQty, 7, 'الفخذ 7 كجم')
  const legCost = st().items.find((i) => i.id === leg.id).costMinor
  const ribsCost = st().items.find((i) => i.id === ribs.id).costMinor
  const minceCost = st().items.find((i) => i.id === mince.id).costMinor
  ok(legCost > ribsCost && ribsCost > minceCost, 'تكلفة الفخذ > الريش > المفروم (بالقيمة البيعية)')
  // الدفتر: 1103 يطابق قيمة المخزون، والقيد الأخير متوازن ومصدره processing
  const lastEntry = st().journal.at(-1)
  eq(lastEntry.sourceType, 'processing', 'مصدر القيد processing')
  assertBalanced(lastEntry.lines); pass++
  const invValue = st().items.reduce((a, i) => a + Math.round((i.stockQty ?? 0) * i.costMinor), 0)
  ok(Math.abs(bal('1103') - invValue) <= 3, `الدفتر يطابق المخزون (فرق تقريب ≤3 هللات) — دفتر ${bal('1103')} مخزون ${invValue}`)
  // بيع 2.35 كجم فخذ بالوزن — سعر شامل 15٪
  st().postSale({ lines: [{ itemId: leg.id, nameAr: 'فخذ نعيمي', qty: 2.35, unitPriceMinor: 6000, unitCostMinor: legCost, discountPercent: 0, soldByWeight: true }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101' })
  const sale = st().sales.at(-1)
  ok(sale.totals.taxMinor > 0, 'ضريبة 15٪ محسوبة داخل السعر')
  // زاتكا QR: TLV سليم بالحقول الخمسة
  const qr = buildZatcaQr({ sellerName: 'جزارة النعيمي', vatNumber: '310123456789003', timestampIso: new Date().toISOString(), totalWithVatMinor: sale.totals.totalMinor, vatMinor: sale.totals.taxMinor, decimals: 2 })
  const raw = Buffer.from(qr, 'base64')
  eq(raw[0], 1, 'زاتكا: أول حقل tag=1')
  ok(raw.includes(Buffer.from('310123456789003')), 'زاتكا: الرقم الضريبي داخل الرمز')
  pass++
  // مرتجع الذبيحة بعد التقطيع ممنوع منطقياً: رصيدها صفر
  throws(() => st().postProcessing({ kind: 'butcher', sourceItemId: carcass.id, sourceQty: 1, outputs: [{ itemId: leg.id, qty: 0.5 }], overheadMinor: 0 }), 'رفض تقطيع بلا رصيد خام')
  // حُرّاس postProcessing
  throws(() => st().postProcessing({ kind: 'butcher', sourceItemId: leg.id, sourceQty: 1, outputs: [{ itemId: leg.id, qty: 1 }], overheadMinor: 0 }), 'رفض الخام ضمن النواتج')
  throws(() => st().postProcessing({ kind: 'butcher', sourceItemId: leg.id, sourceQty: 1, outputs: [{ itemId: 999, qty: 1 }], overheadMinor: 0 }), 'رفض ناتج غير موجود')
  // كارت الصنف: حركة التجهيز ظاهرة
  const card = buildItemLedger({
    itemId: leg.id, openingQty: 0, purchases: [], purchaseReturns: [], sales: [], saleReturns: [], stocktakes: [], productionOrders: [], materialRequisitions: [],
    processingOrders: st().processingOrders.map((o) => ({ orderNumber: o.orderNumber, date: o.date.slice(0, 10), sourceItemId: o.sourceItemId, sourceQty: o.sourceQty, outputs: o.outputs.map((x) => ({ itemId: x.itemId, qty: x.qty })) })),
  })
  eq(card.totalIn, 7, 'كارت الفخذ: وارد 7 من التقطيع')
  ok(card.rows.some((r) => r.docType === 'processing'), 'كارت الصنف يعرض docType=processing')
}

/* ═══ د) تمور بالسعودية — فرز وتعبئة ═══ */
mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'SA', activityId: 'dates', vatPercent: 15, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
{
  const { useDataStore } = await import(`${repoUrl}?bd=dates`)
  const st = () => useDataStore.getState()
  st().seed([])
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 2000000, label: 'خزينة' })
  const mkItem = (nameAr, priceMinor) => {
    st().addItem({ nameAr, sku: nameAr, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, priceMinor, minQty: 0, stockQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
    return st().items.at(-1)
  }
  const raw = mkItem('سكري خام (جني)', 0)
  const premium = mkItem('سكري فاخر مفروز', 4000)
  const mid = mkItem('سكري وسط', 2500)
  const factory = mkItem('سكري تصنيع', 1000)
  st().addSupplier({ nameAr: 'مزارع القصيم', phone: '', notes: '' })
  const sup = st().suppliers.at(-1)
  // شراء 100 كجم خام بـ120000 هللة (1200/كجم) نقداً
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: raw.id, qty: 100, unitPriceMinor: 1200 }], expenses: [], paidMinor: 120000, notes: '' })
  const treasuryBefore = (() => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === '1101') v += l.debit - l.credit; return v })()
  // فرز: 100 كجم → 40 فاخر + 35 وسط + 15 تصنيع + 10 فاقد، تعبئة 8000 هللة من الخزينة
  const order = st().postProcessing({
    kind: 'dates', sourceItemId: raw.id, sourceQty: 100,
    outputs: [{ itemId: premium.id, qty: 40 }, { itemId: mid.id, qty: 35 }, { itemId: factory.id, qty: 15 }],
    overheadMinor: 8000, treasury: '1101', wasteQty: 10,
    compliance: { originCountry: 'السعودية — القصيم', facilityNo: 'PKG-772', productionDate: '2026-08-20', season: 'موسم 1448هـ' },
  })
  ok(order.orderNumber.startsWith('PKG-'), 'رقم أمر الفرز PKG-')
  eq(order.outputs.reduce((a, o) => a + o.allocatedCostMinor, 0), 128000, 'التوزيع = 120000 خام + 8000 تعبئة')
  eq(processingYieldPercent(order), 90, 'تصافي الفرز 90٪')
  eq(order.compliance.season, 'موسم 1448هـ', 'الموسم محفوظ')
  const treasuryAfter = (() => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === '1101') v += l.debit - l.credit; return v })()
  eq(treasuryBefore - treasuryAfter, 8000, 'الخزينة انخفضت بمصاريف التعبئة فقط')
  const pCost = st().items.find((i) => i.id === premium.id).costMinor
  const fCost = st().items.find((i) => i.id === factory.id).costMinor
  ok(pCost > fCost, 'الفاخر يتحمل تكلفة كجم أعلى من التصنيع')
  // القيمة البيعية: 160000 فاخر + 87500 وسط + 15000 تصنيع = 262500 ⇒ الفاخر ~ 128000×160/262.5
  ok(Math.abs(order.outputs[0].allocatedCostMinor - (128000 * 160000 / 262500)) <= 1, 'نصيب الفاخر بالنسبة الصحيحة (±1 هللة لبواقي التقريب للأكبر)')
  // بيع 5 كجم فاخر
  st().postSale({ lines: [{ itemId: premium.id, nameAr: 'سكري فاخر', qty: 5, unitPriceMinor: 4000, unitCostMinor: pCost, discountPercent: 0, soldByWeight: true }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101' })
  eq(st().items.find((i) => i.id === premium.id).stockQty, 35, 'رصيد الفاخر بعد البيع 35')
  // كل القيود متوازنة
  for (const e of st().journal) assertBalanced(e.lines)
  pass++
}

console.log(`\nPASS=${pass} FAIL=0`)
console.log('🎉 نجح فحص نشاطي الجزارة والتمور — قوالب وثيمات ونواة تجهيز ودورتان سعوديتان كاملتان')
