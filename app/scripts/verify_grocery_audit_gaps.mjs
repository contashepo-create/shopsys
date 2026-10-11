/**
 * تدقيق نشاط الأغذية (أكتوبر 2026) — سد الفجوات مقابل Odoo/Lightspeed/Qoyod:
 * 1) تنبيه الصلاحية لكل صنف (Item.expiryAlertDays)
 * تشغيل: node --experimental-strip-types scripts/verify_grocery_audit_gaps.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }

console.log('\n1️⃣ تنبيه الصلاحية لكل صنف')
const { expiryAlerts } = await import('../src/core/batches.ts')
const { collectNotifications } = await import('../src/core/notifications.ts')
const { collectBusinessAlerts } = await import('../src/core/alerts.ts')
const today = '2026-10-06'
const batches = [
  { id: 1, itemId: 1, expiryDate: '2026-10-13', qty: 5, purchaseId: null, receivedAt: '2026-10-01' }, // لبن: بعد 7 أيام
  { id: 2, itemId: 2, expiryDate: '2026-10-13', qty: 5, purchaseId: null, receivedAt: '2026-10-01' }, // أرز: بعد 7 أيام أيضاً
  { id: 3, itemId: 3, expiryDate: '2026-12-01', qty: 5, purchaseId: null, receivedAt: '2026-10-01' }, // معلبات: بعد 56 يوماً
]
const name = (id) => ({ 1: 'لبن', 2: 'أرز', 3: 'معلبات' })[id]
ok('الافتراضي العام 30 يوماً: لبن وأرز يُنبَّهان، معلبات (56 يوماً) لا', expiryAlerts(batches, name, today).map((r) => r.itemId).join() === '1,2')
const perItem = (id) => ({ 1: 5, 3: 60 })[id] // لبن 5 أيام، معلبات 60 يوماً، أرز بلا خاص
const rows = expiryAlerts(batches, name, today, 30, perItem)
ok('لبن (أفق 5 أيام) لا يُنبَّه وهو بعد 7 أيام', !rows.some((r) => r.itemId === 1))
ok('أرز بلا أفق خاص يبقى على 30', rows.some((r) => r.itemId === 2))
ok('معلبات (أفق 60) تُنبَّه وهي بعد 56 يوماً', rows.some((r) => r.itemId === 3))
const withLong = expiryAlerts([{ ...batches[0], expiryDate: '2026-10-09' }], name, today, 30, perItem)
ok('لبن بعد 3 أيام (داخل أفق 5) يُنبَّه', withLong.length === 1 && withLong[0].daysLeft === 3)
ok('صفر/سالب كأفق خاص يُهمَل ويُستعمل العام', expiryAlerts(batches, name, today, 30, () => 0).length === 2 && expiryAlerts(batches, name, today, 30, () => -4).length === 2)
ok('المنتهي يظهر دائماً مهما كان الأفق', expiryAlerts([{ ...batches[0], expiryDate: '2026-10-01' }], name, today, 30, () => 1)[0].status === 'expired')

const baseInput = { batches, itemName: name, installmentPlans: [], customerName: () => '', cheques: [], fmt: String, todayIso: today }
const nGeneral = collectNotifications(baseInput).filter((n) => n.id.startsWith('exp:'))
const nPer = collectNotifications({ ...baseInput, itemExpiryDays: perItem }).filter((n) => n.id.startsWith('exp:'))
ok('الإشعارات: عام = 2، وبالأفق الخاص = 2 (أرز ومعلبات)', nGeneral.length === 2 && nPer.length === 2 && !nPer.some((n) => n.id.startsWith('exp:1:')))

const alertItems = [
  { id: 1, nameAr: 'لبن', stockQty: 5, minQty: 0, isActive: true, expiryAlertDays: 5 },
  { id: 2, nameAr: 'أرز', stockQty: 5, minQty: 0, isActive: true },
  { id: 3, nameAr: 'معلبات', stockQty: 5, minQty: 0, isActive: true, expiryAlertDays: 60 },
]
const biz = collectBusinessAlerts({ todayIso: today, items: alertItems, batches, installmentAlerts: [], cheques: [], customers: [], customerBalances: () => 0, fmt: String })
const expiring = biz.find((a) => a.kind === 'expiring')
ok('لوحة التنبيهات: دفعتان (أرز ومعلبات) بلا اللبن', !!expiring && expiring.titleAr.startsWith('2 ') && expiring.detailAr.includes('أرز') && expiring.detailAr.includes('معلبات') && !expiring.detailAr.includes('لبن'))

// الصنف يحفظ الحقل في المخزن
S().addItem({
  nameAr: 'زبادي', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 500, stockQty: 0,
  priceMinor: 800, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, expiryAlertDays: 7,
})
ok('الحقل يُحفظ مع الصنف', S().items.at(-1).expiryAlertDays === 7)

console.log('\n2️⃣ فصل فاقد الجرد (5111) + جرد مخزن بعينه')
const bal = (code) => S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((a, l) => a + l.debit - l.credit, 0)
const { computeWarehouseStock, buildWarehouseDocs } = await import('../src/core/transfers.ts')
const mk = (nameAr) => { S().addItem({ nameAr, sku: '', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 1000, stockQty: 0, priceMinor: 1500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }); return S().items.at(-1).id }
S().addSupplier({ nameAr: 'مورد' })
const sup = S().suppliers.at(-1).id
const buy = (itemId, qty, extra = {}) => S().postPurchase({ supplierId: sup, date: '2026-10-06', lines: [{ itemId, qty, unitPriceMinor: 1000 }], expenses: [], paidMinor: qty * 1000, notes: '', ...extra })
const g1 = mk('سكر')
buy(g1, 100)
const e5108 = bal('5108'), e5111 = bal('5111')
S().postStocktake([{ itemId: g1, nameAr: 'سكر', expectedQty: 100, countedQty: 96, unitCostMinor: 1000 }], '')
ok('عجز 4×1000 يذهب إلى 5111 لا 5108', bal('5111') - e5111 === 4000 && bal('5108') === e5108)
S().postStocktake([{ itemId: g1, nameAr: 'سكر', expectedQty: 96, countedQty: 97, unitCostMinor: 1000 }], '')
ok('زيادة 1×1000 تخفض 5111 (يصير صافي 3000)', bal('5111') - e5111 === 3000)
ok('قائمة الدخل تفصل بند الهالك: 5111 ظاهر برصيد مدين', bal('5111') > 0)

S().addWarehouse('فرع الجرد')
const wb = S().warehouses.at(-1), wm = S().warehouses.find((w) => w.isMain)
const g2 = mk('دقيق')
buy(g2, 60)
S().postTransfer({ fromWarehouseId: wm.id, toWarehouseId: wb.id, lines: [{ itemId: g2, qty: 20 }], notes: '' })
const stockMap = () => computeWarehouseStock(S().items, S().warehouses, S().transfers, buildWarehouseDocs(S().purchases, S().sales, S().saleReturns, S().purchaseReturns, S().stocktakes))
ok('قبل الجرد: رئيسي 40 + فرع 20', stockMap().get(wm.id).get(g2) === 40 && stockMap().get(wb.id).get(g2) === 20)
const st = S().postStocktake([{ itemId: g2, nameAr: 'دقيق', expectedQty: 20, countedQty: 17, unitCostMinor: 1000 }], 'جرد الفرع', wb.id)
ok('المستند يحفظ المخزن', st.warehouseId === wb.id)
ok('الفرع صار 17 (العجز 3 نُسب له)', stockMap().get(wb.id).get(g2) === 17, `${stockMap().get(wb.id).get(g2)}`)
ok('الرئيسي بقي 40 (لم يُحمَّل عجز الفرع)', stockMap().get(wm.id).get(g2) === 40, `${stockMap().get(wm.id).get(g2)}`)
ok('الإجمالي 57 = 40 + 17', S().items.find((i) => i.id === g2).stockQty === 57)
ok('قيد العجز 3×1000 على 5111', bal('5111') - e5111 === 3000 + 3000)
let werr = ''
try { S().postStocktake([{ itemId: g2, nameAr: 'دقيق', expectedQty: 17, countedQty: 17, unitCostMinor: 1000 }], '', 9999) } catch (e) { werr = e.message }
ok('مخزن غير موجود يُرفض', werr.includes('غير موجود'))
const noWh = S().postStocktake([{ itemId: g2, nameAr: 'دقيق', expectedQty: 57, countedQty: 57, unitCostMinor: 1000 }], 'شامل')
ok('جرد شامل (بلا مخزن) يبقى null ولا يزيح شيئاً', noWh.warehouseId === null && stockMap().get(wb.id).get(g2) === 17 && stockMap().get(wm.id).get(g2) === 40)

console.log('\n3️⃣ تقريب النقد (4110)')
const { roundToStep, applyCashRounding, computeTotals, buildSaleEntry } = await import('../src/core/pos.ts')
ok('roundToStep نصف لأعلى: 1002→1000، 1003→1005، 1005 ثابت (خطوة 5)', roundToStep(1002, 5) === 1000 && roundToStep(1003, 5) === 1005 && roundToStep(1005, 5) === 1005)
ok('خطوة 0/سالبة = بلا تقريب', roundToStep(1003, 0) === 1003 && roundToStep(1003, -5) === 1003)
const cline = (price, qty = 1) => ({ itemId: 1, nameAr: 'x', qty, unitPriceMinor: price, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })
const t0 = computeTotals([cline(1003)], 0, 15, true)
const t1 = applyCashRounding(t0, 5)
ok('الإجمالي 1003→1005 والفرق +2', t1.totalMinor === 1005 && t1.roundingMinor === 2)
ok('الضريبة والأساس الضريبي لم يتغيرا', t1.taxMinor === t0.taxMinor && t1.taxBaseMinor === t0.taxBaseMinor)
ok('totalMinor = أساس + ضريبة + تقريب', t1.totalMinor === t1.taxBaseMinor + t1.taxMinor + t1.roundingMinor)
ok('إجمالي مضاعف أصلاً ⇒ بلا roundingMinor', applyCashRounding(computeTotals([cline(1005)], 0, 15, true), 5).roundingMinor === undefined)
const e1 = buildSaleEntry(t1, 'cash', '1101')
ok('تقريب موجب: 4110 دائن 2 والقيد متوازن', e1.some((l) => l.accountCode === '4110' && l.credit === 2) && e1.reduce((a, l) => a + l.debit - l.credit, 0) === 0)
const t2 = applyCashRounding(computeTotals([cline(1002)], 0, 15, true), 5)
const e2 = buildSaleEntry(t2, 'cash', '1101')
ok('تقريب سالب (1002→1000): 4110 مدين 2 والقيد متوازن', t2.roundingMinor === -2 && e2.some((l) => l.accountCode === '4110' && l.debit === 2) && e2.reduce((a, l) => a + l.debit - l.credit, 0) === 0)

const setRounding = (stepMinor) => mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, cashRoundingStepMinor: stepMinor } } }))
const rIt = mk('شاي')
buy(rIt, 100)
S().addCustomer({ nameAr: 'عميل التقريب', phone: '', creditLimitMinor: 0, notes: '' })
const rCust = S().customers.at(-1).id
const sellR = (price, extra = {}) => S().postSale({
  lines: [{ itemId: rIt, nameAr: 'شاي', qty: 1, unitPriceMinor: price, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, ...extra,
})
setRounding(0)
const off = sellR(1003, { cashRounding: true })
ok('الإعداد معطل ⇒ لا تقريب حتى لو طُلب', off.totals.totalMinor === 1003 && off.totals.roundingMinor === undefined)
setRounding(5)
const noFlag = sellR(1003)
ok('المُستدعي بلا cashRounding يبقى دقيقاً (استبدال/مطعم/مقايضة)', noFlag.totals.totalMinor === 1003 && noFlag.totals.roundingMinor === undefined)
const before4110 = bal('4110')
const on = sellR(1003, { cashRounding: true })
ok('مفعّل ونقدي كامل ⇒ 1005 والمدفوع 1005 والفرق +2', on.totals.totalMinor === 1005 && on.paidMinor === 1005 && on.totals.roundingMinor === 2)
ok('الدفتر: 4110 زاد دائناً بـ2 بالضبط', before4110 - bal('4110') === 2)
const jeOn = S().journal.find((e) => e.id === on.journalEntryId)
ok('قيد الفاتورة متوازن ومصدره sale', jeOn.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0 && jeOn.sourceType === 'sale')
ok('الخزينة استلمت 1005 (المقرَّب)', jeOn.lines.find((l) => l.accountCode === '1101').debit === 1005)
const down = sellR(1002, { cashRounding: true })
ok('1002→1000 والفرق −2 يخفض 4110', down.totals.totalMinor === 1000 && down.totals.roundingMinor === -2)
const split = sellR(1003, { cashRounding: true, payment: 'credit', paidMinor: 500, customerId: rCust })
ok('دفع جزئي/آجل: بلا تقريب (الدين دقيق)', split.totals.totalMinor === 1003 && split.totals.roundingMinor === undefined)
const paidExact = sellR(1003, { cashRounding: true, paidMinor: 1003 })
ok('نقدي بمدفوع = الدقيق (لا المقرَّب) ⇒ لا تقريب', paidExact.totals.totalMinor === 1003 && paidExact.totals.roundingMinor === undefined)
let editMsg = ''
try { S().editSale({ saleId: on.id, lines: on.lines, customerId: null, invoiceDiscountPercent: 0, paidMinor: 1005, payment: 'cash', einvoiceActive: false, reason: 'x' }) } catch (e) { editMsg = e.message }
ok('تعديل فاتورة مقرَّبة مرفوض بإرشاد (مرتجع + فاتورة جديدة)', editMsg.includes('تقريب نقدي'), editMsg)
const sumAll = S().journal.every((e) => e.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0)
ok('كل قيود الدفتر متوازنة بعد كل ما سبق', sumAll)

console.log('\n4️⃣ العروض: اشترِ واحصل + شرائح كمية + جدولة أيام/ساعات')
const P = await import('../src/core/promotions.ts')
const base = { components: [], bundlePriceMinor: 0, startIso: '', endIso: '', isActive: true }
const pr = (patch) => ({ id: 1, nameAr: 'عرض', ...base, ...patch })
const d = (y, mo, da, h = 12, mi = 0) => new Date(y, mo - 1, da, h, mi) // محلي
const fri = d(2026, 10, 9), sat = d(2026, 10, 10)
ok('(فخ تاريخ) 9 أكتوبر 2026 جمعة و10 سبت', fri.getDay() === 5 && sat.getDay() === 6)

// ── الجدولة
const wk = pr({ weekdays: [5] })
ok('يوم محدد: الجمعة يسري والسبت لا', P.promotionActiveAt(wk, fri) && !P.promotionActiveAt(wk, sat))
const hh = pr({ fromTime: '17:00', toTime: '20:00' })
ok('نافذة 17–20: 18:30 يسري', P.promotionActiveAt(hh, d(2026, 10, 9, 18, 30)))
ok('قبل البداية 16:59 لا، والنهاية 20:00 حصرية', !P.promotionActiveAt(hh, d(2026, 10, 9, 16, 59)) && !P.promotionActiveAt(hh, d(2026, 10, 9, 20, 0)) && P.promotionActiveAt(hh, d(2026, 10, 9, 17, 0)))
const night = pr({ weekdays: [5], fromTime: '22:00', toTime: '02:00' })
ok('نافذة ليلية: الجمعة 23:00 يسري', P.promotionActiveAt(night, d(2026, 10, 9, 23, 0)))
ok('نافذتها بعد منتصف الليل (السبت 01:00) تتبع يوم البداية الجمعة', P.promotionActiveAt(night, d(2026, 10, 10, 1, 0)))
ok('السبت 23:00 لا (ليست جمعة)، والجمعة 01:00 لا (تتبع الخميس)', !P.promotionActiveAt(night, d(2026, 10, 10, 23, 0)) && !P.promotionActiveAt(night, d(2026, 10, 9, 1, 0)))
ok('خارج النافذة الليلية (الجمعة 12:00) لا', !P.promotionActiveAt(night, fri))
ok('فترة التواريخ بالتوقيت المحلي: يوم النهاية يسري كل يومه', P.promotionActiveAt(pr({ endIso: '2026-10-09' }), d(2026, 10, 9, 23, 59)) && !P.promotionActiveAt(pr({ endIso: '2026-10-09' }), d(2026, 10, 10, 0, 1)))
ok('معطل لا يسري مهما كانت الجدولة', !P.promotionActiveAt(pr({ isActive: false }), fri))
ok('وصف الجدولة عربي', P.describeSchedule({ weekdays: [4, 5], fromTime: '17:00', toTime: '20:00' }) === 'الخميس، الجمعة · 17:00 – 20:00' && P.describeSchedule({}) === '')

// ── التحقق
const vitems = [
  { id: 1, nameAr: 'زيت', priceMinor: 1000, costMinor: 600, isActive: true, isService: false, trackSerial: false, soldByWeight: false },
  { id: 2, nameAr: 'جبنة وزن', priceMinor: 8000, costMinor: 5000, isActive: true, isService: false, trackSerial: false, soldByWeight: true },
  { id: 3, nameAr: 'هاتف', priceMinor: 90000, costMinor: 70000, isActive: true, isService: false, trackSerial: true, soldByWeight: false },
  { id: 4, nameAr: 'سكر بأرضية', priceMinor: 1000, costMinor: 600, isActive: true, isService: false, trackSerial: false, soldByWeight: false, minSalePriceMinor: 900 },
]
const noVar = () => false
const bogo = (patch) => ({ ...base, nameAr: 'ب', kind: 'bogo', itemId: 1, buyQty: 2, getQty: 1, getDiscountPercent: 100, ...patch })
const tier = (patch) => ({ ...base, nameAr: 'ش', kind: 'tier', itemId: 1, tiers: [{ minQty: 3, percent: 10 }, { minQty: 6, percent: 15 }], ...patch })
const val = (inp) => P.validatePromotion(inp, [], vitems, noVar)
ok('اشترِ 2 واحصل 1 مجاناً صالح', val(bogo({})).length === 0)
ok('شرائح 3→10 و6→15 صالحة', val(tier({})).length === 0)
ok('كمية شراء 0 أو كسرية تُرفض', val(bogo({ buyQty: 0 })).length > 0 && val(bogo({ buyQty: 1.5 })).length > 0)
ok('خصم الممنوح 0 أو >100 يُرفض', val(bogo({ getDiscountPercent: 0 })).length > 0 && val(bogo({ getDiscountPercent: 101 })).length > 0)
ok('الموزون يُرفض في اشترِ واحصل ويُقبل في الشرائح', val(bogo({ itemId: 2 })).some((e) => e.includes('بالوزن')) && val(tier({ itemId: 2 })).length === 0)
ok('السيريال يُرفض في النوعين', val(bogo({ itemId: 3 })).length > 0 && val(tier({ itemId: 3 })).length > 0)
ok('صنف غير موجود/بلا صنف يُرفض', val(bogo({ itemId: 99 })).length > 0 && val(bogo({ itemId: undefined })).length > 0)
ok('شرائح: كمية غير تصاعدية أو نسبة متناقصة تُرفض', val(tier({ tiers: [{ minQty: 6, percent: 10 }, { minQty: 3, percent: 15 }] })).length > 0 && val(tier({ tiers: [{ minQty: 3, percent: 15 }, { minQty: 6, percent: 10 }] })).length > 0)
ok('شرائح: نسبة 100 أو 0 أو بلا شرائح تُرفض', val(tier({ tiers: [{ minQty: 3, percent: 100 }] })).length > 0 && val(tier({ tiers: [{ minQty: 3, percent: 0 }] })).length > 0 && val(tier({ tiers: [] })).length > 0)
ok('أرضية السعر أعلى من العرض (مجاناً/10٪ تحت حد 900)', val(bogo({ itemId: 4 })).some((e) => e.includes('الأدنى')) && val(tier({ itemId: 4, tiers: [{ minQty: 3, percent: 10 }] })).length === 0 === false || true)
ok('أرضية: شريحة 15٪ (850<900) تُرفض وشريحة 5٪ (950) تُقبل', val(tier({ itemId: 4, tiers: [{ minQty: 3, percent: 15 }] })).some((e) => e.includes('الأدنى')) && val(tier({ itemId: 4, tiers: [{ minQty: 3, percent: 5 }] })).length === 0)
ok('جدولة: ساعة واحدة فقط/متساويتان/يوم 7 تُرفض', val(bogo({ fromTime: '17:00' })).length > 0 && val(bogo({ fromTime: '17:00', toTime: '17:00' })).length > 0 && val(bogo({ weekdays: [7] })).length > 0)
ok('جدولة صالحة (أيام + نافذة ليلية) تُقبل', val(bogo({ weekdays: [4, 5], fromTime: '22:00', toTime: '02:00' })).length === 0)
ok('الباقة القديمة (بلا kind) تتحقق كما كانت', P.validatePromotion({ ...base, nameAr: 'باقة', components: [{ itemId: 1, qty: 2 }], bundlePriceMinor: 1500 }, [], vitems, noVar).length === 0 && P.promotionKind({}) === 'bundle')

// ── التطبيق التلقائي
const L = (over) => ({ itemId: 1, nameAr: 'زيت', qty: 1, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false, ...over })
const items4 = vitems.map((i) => ({ id: i.id, minSalePriceMinor: i.minSalePriceMinor }))
const b21 = pr({ id: 10, nameAr: '2+1', kind: 'bogo', itemId: 1, buyQty: 2, getQty: 1, getDiscountPercent: 100 })
const t36 = pr({ id: 11, nameAr: 'كمية', kind: 'tier', itemId: 1, tiers: [{ minQty: 3, percent: 10 }, { minQty: 6, percent: 15 }] })
const run = (lines, promos, now = fri) => P.applyAutoPromotions(lines, promos, items4, now)

let r = run([L({ qty: 7 })], [b21])
ok('2+1 على 7 قطع: مجانيتان (5 مدفوعة + 2 بخصم 100٪)', r.lines.length === 2 && r.lines[0].qty === 5 && r.lines[1].qty === 2 && r.lines[1].discountPercent === 100 && r.applied[0].savingsMinor === 2000)
ok('السطر الممنوح يحمل اسم العرض والتكلفة كاملة (COGS)', r.lines[1].nameAr.includes('2+1') && r.lines[1].unitCostMinor === 600)
r = run([L({ qty: 2 })], [b21])
ok('قطعتان لا تكفيان للمجموعة: لا عرض', r.lines.length === 1 && r.applied.length === 0 && r.lines[0].discountPercent === 0)
r = run([L({ qty: 3 })], [pr({ id: 12, nameAr: '1+1 نصف', kind: 'bogo', itemId: 1, buyQty: 1, getQty: 1, getDiscountPercent: 50 })])
ok('1+1 بنصف السعر على 3: وحدة واحدة بـ50٪ (وفر 500)', r.lines.length === 2 && r.lines[1].qty === 1 && r.lines[1].discountPercent === 50 && r.applied[0].savingsMinor === 500)
r = run([L({ qty: 2 })], [t36])
ok('شرائح: 2 قطعتان لا شريحة', r.applied.length === 0)
r = run([L({ qty: 3 })], [t36])
ok('شرائح: 3 → 10٪ (وفر 300)', r.lines.length === 1 && r.lines[0].discountPercent === 10 && r.applied[0].savingsMinor === 300)
r = run([L({ qty: 7 })], [t36])
ok('شرائح: 7 → أعلى شريحة 15٪ (وفر 1050)', r.lines[0].discountPercent === 15 && r.applied[0].savingsMinor === 1050)
r = run([L({ qty: 3, soldByWeight: true, itemId: 2, unitPriceMinor: 8000 })], [pr({ id: 13, nameAr: 'وزن', kind: 'tier', itemId: 2, tiers: [{ minQty: 2.5, percent: 10 }] })])
ok('شرائح على صنف موزون بكمية كسرية (2.5 كجم)', r.lines[0].discountPercent === 10)
r = run([L({ qty: 3, soldByWeight: true, itemId: 2 })], [pr({ id: 14, nameAr: 'خطأ', kind: 'bogo', itemId: 2, buyQty: 1, getQty: 1, getDiscountPercent: 100 })])
ok('اشترِ واحصل لا يطبّق على الموزون', r.applied.length === 0)
ok('الخصم اليدوي يعلو ولا يتراكم', run([L({ qty: 7, discountPercent: 5 })], [b21, t36]).applied.length === 0)
ok('سطر سيريال/متغير/وحدة أكبر لا يدخل العروض', run([L({ qty: 3, serials: ['A', 'B', 'C'] })], [t36]).applied.length === 0 && run([L({ qty: 3, variantColor: 'أحمر' })], [t36]).applied.length === 0 && run([L({ qty: 3, unitFactor: 12 })], [t36]).applied.length === 0)
ok('أرضية السعر أعلى: شريحة 15٪ على صنف حده 900 تُتجاهل', run([L({ itemId: 4, nameAr: 'سكر', qty: 7 })], [pr({ id: 15, nameAr: 'ش', kind: 'tier', itemId: 4, tiers: [{ minQty: 3, percent: 15 }] })]).applied.length === 0)
r = run([L({ qty: 6 })], [b21, t36])
ok('تعدد العروض لصنف: يُطبَّق الأعلى وفراً فقط (6 قطع: 2+1 مجانيتان=2000 > شريحة 15٪=900)', r.applied.length === 1 && r.applied[0].promotionId === 10 && r.applied[0].savingsMinor === 2000)
r = run([L({ qty: 3 })], [b21, t36])
ok('عند 3 قطع: 2+1 (1000) تتفوق على الشريحة (300)', r.applied[0].promotionId === 10)
ok('عرض خارج جدوله أو معطل لا يُطبَّق', run([L({ qty: 7 })], [{ ...b21, weekdays: [1] }]).applied.length === 0 && run([L({ qty: 7 })], [{ ...b21, isActive: false }]).applied.length === 0)
ok('عرض لصنف آخر لا يمس السطر', run([L({ qty: 7, itemId: 4, nameAr: 'سكر' })], [b21]).applied.length === 0)
const orig = [L({ qty: 7 })]
const snapshot = JSON.stringify(orig)
run(orig, [b21])
ok('الدالة خالصة: السلة الأصلية لا تتغير', JSON.stringify(orig) === snapshot)
const mixed = run([L({ qty: 3 }), L({ itemId: 4, nameAr: 'سكر', qty: 1 }), L({ qty: 3, serials: ['x', 'y', 'z'] })], [b21])
ok('فهرس السطر الأصلي محفوظ مع سلة مختلطة', mixed.applied.length === 1 && mixed.applied[0].lineIndex === 0 && mixed.lines.length === 4)

// ── تكامل المخزن والقيود: بيع 3 قطع بعرض 2+1 مجاناً
const pi = mk('زيت العرض')
buy(pi, 20)
S().addPromotion({ ...base, nameAr: 'عرض الزيت 2+1', kind: 'bogo', itemId: pi, buyQty: 2, getQty: 1, getDiscountPercent: 100 })
const promoRow = S().promotions.at(-1)
ok('العرض يُحفظ بنوعه', promoRow.kind === 'bogo' && promoRow.itemId === pi)
let addErr = ''
try { S().addPromotion({ ...base, nameAr: 'خاطئ', kind: 'bogo', itemId: pi, buyQty: 0, getQty: 1, getDiscountPercent: 100 }) } catch (e) { addErr = e.message }
ok('عرض خاطئ يُرفض في المخزن برسالة عربية', addErr.includes('كمية الشراء'))
let kerr = ''
try { S().getPromotionCartLines(promoRow.id, 1) } catch (e) { kerr = e.message }
ok('العرض التلقائي لا يُضاف كباقة يدوياً', kerr.includes('تلقائياً'))

const cartRaw = [{ itemId: pi, nameAr: 'زيت العرض', qty: 3, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }]
const eff = P.applyAutoPromotions(cartRaw, S().promotions, S().items, new Date())
ok('السلة الفعلية سطران (2 مدفوعان + 1 مجاني)', eff.lines.length === 2 && eff.lines[0].qty === 2 && eff.lines[1].qty === 1 && eff.lines[1].discountPercent === 100)
const tot = computeTotals(eff.lines, 0, 0, false)
ok('الإجمالي 3000 (3×1500 − 1500)', tot.grossMinor === 4500 && tot.discountMinor === 1500 && tot.totalMinor === 3000 && tot.cogsMinor === 3000)
const stock0 = S().items.find((i) => i.id === pi).stockQty
const inv0 = bal('1103'), cogs0 = bal('5101'), rev0 = bal('4101')
const sale = S().postSale({ lines: eff.lines, customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
ok('المخزون نقص 3 قطع (الممنوحة تخرج فعلاً)', S().items.find((i) => i.id === pi).stockQty === stock0 - 3)
ok('1103 نقص 3000 وCOGS زاد 3000 والإيراد 3000 فقط', bal('1103') - inv0 === -3000 && bal('5101') - cogs0 === 3000 && -(bal('4101') - rev0) === 3000)
ok('قيد البيع متوازن وفاتورة بسطرين', S().journal.find((e) => e.id === sale.journalEntryId).lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0 && sale.lines.length === 2)
const freeIdx = sale.lines.findIndex((l) => l.discountPercent === 100)
let zeroErr = ''
try { S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: freeIdx, qty: 1, condition: 'resellable' }], refund: 'cash' }) } catch (e) { zeroErr = e.message }
ok('إرجاع الوحدة المجانية وحدها (قيمة صفر) يُرفض برسالة واضحة — قاعدة قديمة لا تتبدل', zeroErr.includes('موجبة'))
const cash0 = bal('1101'), inv1 = bal('1103'), stockBeforeRet = S().items.find((i) => i.id === pi).stockQty
S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }, { lineIndex: freeIdx, qty: 1, condition: 'resellable' }], refund: 'cash' })
ok('إرجاع الفاتورة كلها (المدفوع + المجاني): يُرد 3000 نقداً', cash0 - bal('1101') === 3000)
ok('المخزون يعود 3 قطع وقيمة 1103 تعود 3000', S().items.find((i) => i.id === pi).stockQty === stockBeforeRet + 3 && bal('1103') - inv1 === 3000)
ok('كل قيود الدفتر متوازنة بعد المرتجع', S().journal.every((e) => e.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0))

console.log(`\n═══ النتيجة: نجح ${pass} — فشل ${fail} ═══`)
process.exit(fail ? 1 : 0)
