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

console.log(`\n═══ النتيجة: نجح ${pass} — فشل ${fail} ═══`)
process.exit(fail ? 1 : 0)
