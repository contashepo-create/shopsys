/**
 * التحقق من دفعة «سد فجوات الأنشطة ج1» (المراجعة الشاملة للأنشطة):
 * ① نقاط الولاء (نمط Lightspeed): كسب تلقائي من البيع (تقريب لأسفل) + استبدال بقيد 5115/1104 متوازن + رفض ما دون الحد
 * ② عربون الصيانة (نمط RepairShopr): قبض عند الاستلام (خزينة/2109) + تصفية عند التسليم + الآجل الحقيقي + رد عند الإلغاء
 * ③ صنف الخدمة (نمط Square): يباع بلا مخزون ولا تكلفة — ولا يمس stockQty
 * ④ النشاطان الجديدان salon/bakery: قالب + لوحة ألوان + ثيم + شروحات
 * ⑤ إشعار المخزون المنخفض: يظهر danger عند النفاد وwarning عند الوصول للحد
 * ⑥ رقم الرف بالمغسلة: يُحفظ عند الفتح ويُعدل ويُرفض بعد التسليم
 * تشغيل: node --experimental-strip-types scripts/verify_activity_gaps_batch1.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

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

let pass = 0
const ok = (msg) => { pass++; console.log(`✅ ${msg}`) }

const { ACTIVITY_TEMPLATES, getActivity } = await import(join(root, 'src/core/activities.ts'))
const { ACTIVITY_ACCENTS } = await import(join(root, 'src/core/appearance.ts'))
const { themeForActivity } = await import(join(root, 'src/core/activityTheme.ts'))
const { guidesForActivity, ACTIVITY_GUIDES } = await import(join(root, 'src/core/guides.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const loyaltyCore = await import(join(root, 'src/core/loyalty.ts'))
const { collectNotifications } = await import(join(root, 'src/core/notifications.ts'))

const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const appState = (activityId, loyalty) => JSON.stringify({
  state: {
    setup: { done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true, requireOpenShiftForSales: false },
    license: { plan: 'pro' },
    ...(loyalty ? { loyalty } : {}),
  },
  version: 0,
})
const balanced = (lines) => { assertBalanced(lines); return true }
const baseItem = (over = {}) => ({
  nameAr: 'صنف', sku: 'G1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 100_00, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

/* ═══════════ ① نقاط الولاء ═══════════ */
{
  // النواة أولاً
  const s = { enabled: true, pointsPerUnit: 1, redeemValueMinor: 5, minRedeemPoints: 100 }
  assert.equal(loyaltyCore.earnedPoints(250_75, 2, s), 250) // تقريب لأسفل — لا أنصاف نقاط
  assert.equal(loyaltyCore.earnedPoints(250_75, 2, { ...s, enabled: false }), 0)
  assert.equal(loyaltyCore.redeemValue(200, s), 1000)
  ok('النواة: 250.75 ج ← 250 نقطة (تقريب لأسفل) — معطّل = 0 — استبدال 200 نقطة = 10.00 ج')

  mem.clear()
  mem.set('shopsys-app', appState('grocery', s))
  const { useDataStore } = await import(`${repoUrl}?g1=loyalty`)
  const st = () => useDataStore.getState()
  st().addCustomer({ nameAr: 'عميل الولاء', phone: '0100', creditLimitMinor: 0, notes: '' })
  const cust = st().customers.at(-1)
  st().addItem(baseItem({ nameAr: 'أرز', stockQty: 50, costMinor: 60_00, priceMinor: 125_00 }))
  const item = st().items.at(-1)
  const line = { itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 125_00, unitCostMinor: 60_00, discountPercent: 0, soldByWeight: false }

  st().postSale({ lines: [line], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(st().customers.find((c) => c.id === cust.id).loyaltyPoints, 250)
  ok('الكسب التلقائي: فاتورة 250 ج لعميل مسجل ← 250 نقطة على حسابه')

  st().postSale({ lines: [{ ...line, qty: 1 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(st().customers.find((c) => c.id === cust.id).loyaltyPoints, 250)
  ok('العميل النقدي لا يكسب نقاطاً')

  assert.throws(() => st().redeemLoyaltyPoints(cust.id, 50), /أدنى استبدال/)
  assert.throws(() => st().redeemLoyaltyPoints(cust.id, 999), /رصيد العميل/)
  ok('الاستبدال يرفض: دون الحد الأدنى (100) أو فوق رصيد العميل')

  const before = st().journal.length
  const r = st().redeemLoyaltyPoints(cust.id, 200)
  assert.equal(r.valueMinor, 1000)
  const entry = st().journal.at(-1)
  assert.equal(st().journal.length, before + 1)
  assert.ok(balanced(entry.lines))
  assert.ok(entry.lines.some((l) => l.accountCode === '5115' && l.debit === 1000))
  assert.ok(entry.lines.some((l) => l.accountCode === '1104' && l.credit === 1000))
  assert.equal(st().customers.find((c) => c.id === cust.id).loyaltyPoints, 50)
  ok('الاستبدال: 200 نقطة ← قيد متوازن 5115 مدين 10.00 / 1104 دائن 10.00 — الرصيد 50 نقطة')

  const bal = st().getCustomerBalance(cust.id)
  assert.equal(bal, -1000)
  ok('رصيد العميل بعد الاستبدال: له 10.00 ج (رصيد دائن يخصم من مشترياته القادمة)')
}

/* ═══════════ ② عربون الصيانة ═══════════ */
{
  mem.clear()
  mem.set('shopsys-app', appState('mobile'))
  const { useDataStore } = await import(`${repoUrl}?g1=maint`)
  const st = () => useDataStore.getState()
  st().addCustomer({ nameAr: 'صاحب الجهاز', phone: '0111', creditLimitMinor: 0, notes: '' })
  const cust = st().customers.at(-1)

  // فتح بعربون 50.00
  const t1 = st().openTicket({ customerId: cust.id, customerName: '', customerPhone: '', deviceName: 'آيفون 13', deviceSerial: 'IMEI-352094', deviceCondition: 'خدش بالإطار', issue: 'شاشة مكسورة', estimateMinor: 200_00, prepaidMinor: 50_00, notes: '' })
  assert.equal(t1.prepaidMinor, 50_00)
  assert.equal(t1.deviceSerial, 'IMEI-352094')
  const pe = st().journal.find((e) => e.id === t1.prepaidEntryId)
  assert.ok(balanced(pe.lines))
  assert.ok(pe.lines.some((l) => l.accountCode === '1101' && l.debit === 50_00))
  assert.ok(pe.lines.some((l) => l.accountCode === '2109' && l.credit === 50_00))
  ok('الاستلام: سيريال + حالة + عربون 50 ← قيد فوري خزينة 50 مدين / 2109 دائن 50')

  // تسليم كامل نقدي: أجرة 200 — المدفوع الكلي 200 (منه 50 عربون)
  st().setTicketStatus(t1.id, 'ready')
  const d1 = st().deliverTicket(t1.id, { laborMinor: 200_00, parts: [], payment: 'cash', vatPercent: 0 })
  const de = st().journal.find((e) => e.id === d1.journalEntryId)
  assert.ok(balanced(de.lines))
  assert.ok(de.lines.some((l) => l.accountCode === '2109' && l.debit === 50_00))
  assert.ok(de.lines.some((l) => l.accountCode === '1101' && l.debit === 150_00))
  assert.ok(de.lines.some((l) => l.accountCode === '4103' && l.credit === 200_00))
  ok('التسليم النقدي: تصفية العربون (2109 مدين 50) + خزينة 150 فقط + إيراد 200 — لا تحصيل مزدوج')

  // تسليم جزئي: أجرة 200، مدفوع كلي 100 (منه 50 عربون) ← خزينة 50 وآجل 100
  const t2 = st().openTicket({ customerId: cust.id, customerName: '', customerPhone: '', deviceName: 'سامسونج S22', issue: 'بطارية', estimateMinor: 0, prepaidMinor: 50_00, notes: '' })
  st().setTicketStatus(t2.id, 'ready')
  const d2 = st().deliverTicket(t2.id, { laborMinor: 200_00, parts: [], payment: 'cash', paidMinor: 100_00, vatPercent: 0 })
  const de2 = st().journal.find((e) => e.id === d2.journalEntryId)
  assert.ok(balanced(de2.lines))
  assert.ok(de2.lines.some((l) => l.accountCode === '2109' && l.debit === 50_00))
  assert.ok(de2.lines.some((l) => l.accountCode === '1101' && l.debit === 50_00))
  assert.ok(de2.lines.some((l) => l.accountCode === '1104' && l.debit === 100_00))
  ok('التحصيل المجزأ مع عربون: عربون 50 + نقدي 50 + آجل حقيقي 100 (يراعي العربون في حد الائتمان)')

  // إلغاء تذكرة بعربون ← رد تلقائي
  const t3 = st().openTicket({ customerId: null, customerName: 'عابر', customerPhone: '', deviceName: 'لابتوب', issue: 'لا يقلع', estimateMinor: 0, prepaidMinor: 30_00, notes: '' })
  const jBefore = st().journal.length
  st().setTicketStatus(t3.id, 'cancelled')
  const ce = st().journal.at(-1)
  assert.equal(st().journal.length, jBefore + 1)
  assert.ok(balanced(ce.lines))
  assert.ok(ce.lines.some((l) => l.accountCode === '2109' && l.debit === 30_00))
  assert.ok(ce.lines.some((l) => l.accountCode === '1101' && l.credit === 30_00))
  ok('الإلغاء قبل التسليم: رد العربون تلقائياً بقيد 2109 مدين 30 / خزينة دائن 30')

  // إلغاء تذكرة بلا عربون ← لا قيد
  const t4 = st().openTicket({ customerId: null, customerName: 'آخر', customerPhone: '', deviceName: 'تابلت', issue: 'شاحن', estimateMinor: 0, notes: '' })
  const j2 = st().journal.length
  st().setTicketStatus(t4.id, 'cancelled')
  assert.equal(st().journal.length, j2)
  ok('إلغاء بلا عربون: لا قيد زائد')

  // عربون أكبر من الإجمالي يُرفض عند التسليم
  const t5 = st().openTicket({ customerId: null, customerName: 'ثالث', customerPhone: '', deviceName: 'ساعة', issue: 'زجاج', estimateMinor: 0, prepaidMinor: 500_00, notes: '' })
  st().setTicketStatus(t5.id, 'ready')
  assert.throws(() => st().deliverTicket(t5.id, { laborMinor: 100_00, parts: [], payment: 'cash', vatPercent: 0 }), /العربون المقبوض/)
  ok('عربون 500 على تذكرة 100: التسليم يُرفض بوضوح (رد الفارق بسند صرف)')
}

/* ═══════════ ③ صنف الخدمة ═══════════ */
{
  mem.clear()
  mem.set('shopsys-app', appState('salon'))
  const { useDataStore } = await import(`${repoUrl}?g1=service`)
  const st = () => useDataStore.getState()
  st().addItem(baseItem({ nameAr: 'قص شعر', isService: true, priceMinor: 80_00, stockQty: 0 }))
  const svc = st().items.at(-1)
  const line = { itemId: svc.id, nameAr: svc.nameAr, qty: 3, unitPriceMinor: 80_00, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(st().items.find((i) => i.id === svc.id).stockQty, 0)
  const entry = st().journal.find((e) => e.sourceType === 'sale' && e.sourceId === sale.id)
  assert.ok(balanced(entry.lines))
  assert.ok(!entry.lines.some((l) => l.accountCode === '5101'))
  assert.ok(!entry.lines.some((l) => l.accountCode === '1103'))
  assert.ok(entry.lines.some((l) => l.accountCode === '4101' && l.credit === 240_00))
  ok('صنف الخدمة: بيع 3 «قص شعر» برصيد صفر يمر — لا خصم مخزون ولا COGS (5101/1103) — الإيراد كامل')
}

/* ═══════════ ④ النشاطان الجديدان ═══════════ */
{
  assert.equal(ACTIVITY_TEMPLATES.length, 21)
  for (const id of ['salon', 'bakery']) {
    const a = getActivity(id)
    assert.ok(a, `${id} موجود`)
    assert.ok(a.modules.includes('pos') && a.modules.includes('inventory') && a.modules.includes('purchases'))
    assert.ok(ACTIVITY_ACCENTS[id], `${id}: لوحة ألوان`)
    const th = themeForActivity(id)
    assert.ok(th && th.posLayout, `${id}: ثيم كاشير`)
    assert.ok((ACTIVITY_GUIDES[id] ?? []).length >= 2, `${id}: موضوعا شرح على الأقل`)
    assert.ok(guidesForActivity(id).length > (ACTIVITY_GUIDES[id] ?? []).length, `${id}: يرث الشروحات العامة`)
  }
  assert.ok(getActivity('bakery').features.includes('expiry_batches') && getActivity('bakery').features.includes('weight_scale'))
  assert.ok(getActivity('bakery').modules.includes('recipes'))
  ok('20 نشاطاً: salon وbakery كاملان (وحدات + ألوان + ثيم + شروحات + خصائص المخبز: صلاحية/وزن/تصنيع)')
}

/* ═══════════ ⑤ إشعار المخزون المنخفض ═══════════ */
{
  const notifs = collectNotifications({
    batches: [], itemName: () => '', installmentPlans: [], customerName: () => '',
    cheques: [], fmt: (m) => String(m), todayIso: '2026-09-19',
    lowStockItems: [
      { id: 1, nameAr: 'أرز', stockQty: 0, minQty: 5 },
      { id: 2, nameAr: 'سكر', stockQty: 3, minQty: 5 },
    ],
  })
  const n1 = notifs.find((n) => n.id === 'low:1')
  const n2 = notifs.find((n) => n.id === 'low:2')
  assert.ok(n1 && n1.severity === 'danger')
  assert.ok(n2 && n2.severity === 'warn')
  assert.equal(n1.route, '/inventory/items')
  assert.equal(n1.perm, 'inv.view')
  ok('إشعارات المخزون: نافد = danger، منخفض = warn — بمسار شاشة الأصناف وصلاحية inv.view')
}

/* ═══════════ ⑥ رقم الرف بالمغسلة ═══════════ */
{
  mem.clear()
  mem.set('shopsys-app', appState('laundry'))
  const { useDataStore } = await import(`${repoUrl}?g1=rack`)
  const st = () => useDataStore.getState()
  const o = st().openLaundryOrder({ customerId: null, customerName: 'زبون', phone: '', promisedAt: '2026-09-21', rackNumber: 'A-12', lines: [{ desc: 'قميص', service: 'wash_iron', qty: 2, unitPriceMinor: 15_00 }], prepaidMinor: 0, notes: '' })
  assert.equal(st().laundryOrders.at(-1).rackNumber, 'A-12')
  st().setLaundryRack(o.id, 'B-07')
  assert.equal(st().laundryOrders.at(-1).rackNumber, 'B-07')
  st().setLaundryStatus(o.id, 'processing'); st().setLaundryStatus(o.id, 'ready')
  st().deliverLaundryOrder({ orderId: o.id })
  assert.throws(() => st().setLaundryRack(o.id, 'C-01'), /مغلق/)
  ok('رقم الرف: يُحفظ عند الفتح، يُعدل أثناء التشغيل، ويُرفض بعد التسليم')
}

console.log(`\n══════════════════\n${pass} فحوصات دفعة سد فجوات الأنشطة ج1 اجتازت كلها ✅`)
