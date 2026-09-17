/**
 * تحقق «حرية رد القيمة + قسم الشروحات» (طلب المالك):
 * 1) validateRefundAllocation: كل قواعد التحقق (مجموع/سقوف/عميل نقدي/سالب)
 * 2) allocationOf: تحويل الأنماط التقليدية لتوزيع رباعي مطابق للسلوك القديم
 * 3) buildReturnEntryAlloc: تنازل → 4110 دائن، رصيد → 1104، قيد متوازن دائماً
 * 4) postSaleReturn refund='custom': مرتجع بلا رد (كله تنازلاً)، مزيج ثلاثي،
 *    رفض التجاوزات، التوافق الخلفي (cash/credit/store_credit كما كانت)
 * 5) core/guides: تغطية كل الأنشطة الستة عشر + البحث
 * 6) فحص UI نصي: SaleReturnsPage (توزيع حر) + GuidesPage + التوجيه والصلاحيات
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/* ─── بيئة صورية ─── */
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const {
  validateRefundAllocation, allocationOf, buildReturnEntryAlloc, splitRefund,
} = await import(join(root, 'src/core/returns.ts'))
const { guidesForActivity, searchGuides, COMMON_GUIDES, ACTIVITY_GUIDES } = await import(join(root, 'src/core/guides.ts'))
const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))

/* ═══ 1) validateRefundAllocation ═══ */
{
  // توزيع سليم: 100 نقدي + 150 ذمم + 30 رصيد + 20 تنازل = 300
  const errs = validateRefundAllocation(300, { cashMinor: 100, creditMinor: 150, storeCreditMinor: 30, waivedMinor: 20 }, 200, 100, true)
  assert.deepEqual(errs, [])
  ok('توزيع رباعي سليم يمر بلا أخطاء')

  assert.ok(validateRefundAllocation(300, { cashMinor: 100, creditMinor: 100, storeCreditMinor: 0, waivedMinor: 0 }, 200, 100, true).some((e) => e.includes('لا يساوي')))
  ok('مجموع ناقص يُرفض برسالة واضحة')

  assert.ok(validateRefundAllocation(300, { cashMinor: 150, creditMinor: 150, storeCreditMinor: 0, waivedMinor: 0 }, 200, 100, true).some((e) => e.includes('يتجاوز المُحصَّل')))
  ok('نقدي فوق المحصَّل فعلاً يُرفض')

  assert.ok(validateRefundAllocation(300, { cashMinor: 0, creditMinor: 300, storeCreditMinor: 0, waivedMinor: 0 }, 200, 100, true).some((e) => e.includes('يتجاوز دين الفاتورة')))
  ok('خصم ذمم فوق الدين المفتوح يُرفض')

  assert.ok(validateRefundAllocation(300, { cashMinor: 100, creditMinor: 0, storeCreditMinor: 200, waivedMinor: 0 }, 0, 300, false).some((e) => e.includes('عميل نقدي')))
  ok('رصيد لعميل نقدي (بلا حساب) يُرفض')

  assert.ok(validateRefundAllocation(300, { cashMinor: -50, creditMinor: 350, storeCreditMinor: 0, waivedMinor: 0 }, 400, 100, true).length > 0)
  ok('مبلغ سالب يُرفض')

  // مرتجع بلا رد: كله تنازلاً — يمر حتى بلا عميل وبلا محصَّل
  assert.deepEqual(validateRefundAllocation(300, { cashMinor: 0, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 300 }, 0, 0, false), [])
  ok('«مرتجع بلا رد» (كله تنازلاً) سليم حتى لعميل نقدي')
}

/* ═══ 2) allocationOf — التوافق مع splitRefund ═══ */
{
  const a = allocationOf(300, 'cash', 100, 250)
  const s = splitRefund(300, 'cash', 100, 250)
  assert.deepEqual(a, { cashMinor: s.cashMinor, creditMinor: s.creditMinor, storeCreditMinor: 0, waivedMinor: 0 })
  ok('allocationOf(cash) يطابق splitRefund بالضبط')

  const b = allocationOf(300, 'store_credit', 0, 0)
  assert.deepEqual(b, { cashMinor: 0, creditMinor: 0, storeCreditMinor: 300, waivedMinor: 0 })
  ok('allocationOf(store_credit) كله رصيداً')

  assert.throws(() => allocationOf(300, 'custom', 0, 0), /allocation/)
  ok('allocationOf(custom) يرمي — التوزيع الحر يتطلب allocation صريحاً')
}

/* ═══ 3) buildReturnEntryAlloc — القيود ═══ */
{
  const totals = { taxBaseMinor: 300, taxMinor: 0, totalMinor: 300, netMinor: 300, cogsMinor: 180, subtotalMinor: 300, discountMinor: 0 }
  // تنازل كامل
  const e1 = buildReturnEntryAlloc(totals, { cashMinor: 0, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 300 }, '1101', 0)
  assert.ok(e1.some((l) => l.accountCode === '4110' && l.credit === 300))
  assert.ok(!e1.some((l) => l.accountCode === '1101'))
  const bal1 = e1.reduce((a, l) => a + l.debit - l.credit, 0)
  assert.equal(bal1, 0)
  ok('تنازل كامل: 4110 دائن 300، لا خزينة، قيد متوازن')

  // مزيج رباعي مع ضريبة وتالف
  const totals2 = { taxBaseMinor: 300, taxMinor: 42, totalMinor: 342, netMinor: 342, cogsMinor: 180, subtotalMinor: 342, discountMinor: 0 }
  const e2 = buildReturnEntryAlloc(totals2, { cashMinor: 100, creditMinor: 150, storeCreditMinor: 50, waivedMinor: 42 }, '1102', 60)
  assert.ok(e2.some((l) => l.accountCode === '1102' && l.credit === 100))
  const c1104 = e2.filter((l) => l.accountCode === '1104').reduce((a, l) => a + l.credit, 0)
  assert.equal(c1104, 200) // 150 خصم + 50 رصيد
  assert.ok(e2.some((l) => l.accountCode === '4110' && l.credit === 42))
  assert.ok(e2.some((l) => l.accountCode === '5111' && l.debit === 60))
  assert.ok(e2.some((l) => l.accountCode === '1103' && l.debit === 120))
  assert.equal(e2.reduce((a, l) => a + l.debit - l.credit, 0), 0)
  ok('مزيج رباعي + ضريبة + تالف: كل الأطراف صحيحة والقيد متوازن')

  assert.throws(() => buildReturnEntryAlloc(totals, { cashMinor: 100, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 100 }, '1101', 0), /لا يساوي/)
  ok('مجموع توزيع مخالف يرمي خطأ')
}

/* ═══ 4) postSaleReturn refund='custom' — تكامل ═══ */
const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const st = () => useDataStore.getState()

// صنف وعميل (توقيع Item الكامل — حقول ناقصة = مخزون صفري صامت)
st().addItem({
  nameAr: 'صنف حر', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 600, stockQty: 50, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
})
const item = st().items.at(-1)
st().addCustomer({ nameAr: 'عميل الحرية', phone: '', taxNumber: '', address: '', notes: '' })
const cust = st().customers.at(-1)
const line = (qty) => ({ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false })

/* 4-أ: فاتورة نقدية + مرتجع بلا رد (كله تنازلاً) */
{
  const sale = st().postSale({ lines: [line(4)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const stockBefore = st().items.find((i) => i.id === item.id).stockQty
  const ret = st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }],
    refund: 'custom', allocation: { cashMinor: 0, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 2000 },
    reason: 'عميل تنازل', reasonCode: 'other',
  })
  assert.equal(ret.waivedRefundMinor, 2000)
  assert.equal(ret.cashRefundMinor, 0)
  const entry = st().journal.find((e) => e.id === ret.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '4110' && l.credit === 2000))
  assert.ok(!entry.lines.some((l) => l.accountCode === '1101'))
  assert.equal(entry.lines.reduce((a, l) => a + l.debit - l.credit, 0), 0)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, stockBefore + 2)
  ok('تكامل: مرتجع بلا رد — 4110 دائن، لا نقدية، البضاعة عادت للمخزون')
}

/* 4-ب: دفع مجزأ + مزيج ثلاثي (نقدي + ذمم + تنازل) */
{
  const sale = st().postSale({ lines: [line(5)], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 2000 })
  // القيمة 5000: مدفوع 2000، مفتوح 3000. مرتجع 3 قطع = 3000
  const ret = st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'resellable' }],
    refund: 'custom', allocation: { cashMinor: 1000, creditMinor: 1500, storeCreditMinor: 0, waivedMinor: 500 },
    reason: 'تسوية ودية', reasonCode: 'price_dispute',
  })
  assert.equal(ret.cashRefundMinor, 1000)
  assert.equal(ret.creditRefundMinor, 1500)
  assert.equal(ret.waivedRefundMinor, 500)
  const entry = st().journal.find((e) => e.id === ret.journalEntryId)
  assert.ok(entry.lines.some((l) => l.accountCode === '1101' && l.credit === 1000))
  assert.ok(entry.lines.some((l) => l.accountCode === '1104' && l.credit === 1500))
  assert.ok(entry.lines.some((l) => l.accountCode === '4110' && l.credit === 500))
  ok('تكامل: مزيج نقدي+ذمم+تنازل على دفع مجزأ — القيد مفصل صحيح')

  // 4-ج: تجاوز السقوف يرمي — المحصَّل المتبقي 1000 فقط (دفع 2000 ورُدّ 1000 نقداً)
  assert.throws(() => st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }],
    refund: 'custom', allocation: { cashMinor: 2000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 },
    reason: 'تجاوز', reasonCode: 'other',
  }), /يتجاوز المُحصَّل/)
  ok('تكامل: نقدي 2000 فوق المحصَّل المتبقي (1000) يُرفض')

  assert.throws(() => st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'custom',
    reason: 'بلا توزيع', reasonCode: 'other',
  }), /allocation/)
  ok('تكامل: custom بلا allocation يُرفض')
}

/* 4-د: التوافق الخلفي — الأنماط الثلاثة القديمة كما هي */
{
  const sale = st().postSale({ lines: [line(2)], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const ret = st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'قديم', reasonCode: 'other' })
  assert.equal(ret.cashRefundMinor, 1000)
  assert.equal(ret.creditRefundMinor, 0)
  assert.equal(ret.waivedRefundMinor, undefined)
  ok('توافق خلفي: refund=cash يعمل كما كان بلا حقول جديدة')

  const ret2 = st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'store_credit', reason: 'رصيد', reasonCode: 'other' })
  assert.equal(ret2.creditRefundMinor, 1000)
  assert.equal(ret2.storeCreditRefundMinor, 1000)
  const entry2 = st().journal.find((e) => e.id === ret2.journalEntryId)
  assert.ok(entry2.lines.some((l) => l.accountCode === '1104' && l.credit === 1000))
  ok('توافق خلفي: store_credit → 1104 + الحقل الجديد storeCreditRefundMinor مفصّل')
}

/* ═══ 5) الشروحات ═══ */
{
  assert.ok(COMMON_GUIDES.length >= 8)
  ok(`الموضوعات العامة: ${COMMON_GUIDES.length} موضوعات (مرتجعات كاملة التغطية)`)

  for (const a of ACTIVITY_TEMPLATES) {
    const topics = guidesForActivity(a.id)
    assert.ok(topics.length >= COMMON_GUIDES.length, `نشاط ${a.id} بلا شروحات`)
  }
  ok(`كل الأنشطة (${ACTIVITY_TEMPLATES.length}) لها شروحات — العامة على الأقل`)

  const withOwn = Object.keys(ACTIVITY_GUIDES)
  assert.ok(withOwn.length >= 14, `أنشطة بموضوعات خاصة: ${withOwn.length}`)
  ok(`${withOwn.length} نشاطاً له موضوع مرتجعات خاص به`)

  const lab = guidesForActivity('lab')
  assert.equal(lab[0].id, 'lab_refunds') // موضوع النشاط أولاً
  ok('موضوع النشاط يتصدر القائمة قبل العامة')

  const hits = searchGuides(guidesForActivity('grocery'), 'تالف')
  assert.ok(hits.length >= 2)
  assert.equal(searchGuides(guidesForActivity('grocery'), 'كلمة-غير-موجودة-إطلاقاً').length, 0)
  ok('البحث في الشروحات يعمل (إيجاباً وسلباً)')

  // كل فقرة غير فارغة وكل موضوع له 2+ فقرات
  for (const t of [...COMMON_GUIDES, ...Object.values(ACTIVITY_GUIDES).flat()]) {
    assert.ok(t.paragraphsAr.length >= 2, `موضوع ${t.id} فقير`)
    assert.ok(t.paragraphsAr.every((p) => p.trim().length > 20), `فقرة قصيرة في ${t.id}`)
  }
  ok('كل الموضوعات غنية: فقرتان+ وكل فقرة شرح حقيقي')
}

/* ═══ 6) فحص UI نصي ═══ */
{
  const srp = readFileSync(join(root, 'src/ui/pages/SaleReturnsPage.tsx'), 'utf8')
  for (const marker of ["'custom'", 'توزيع حر', 'validateRefundAllocation', 'allocationOf', 'waivedMinor', 'مرتجع بلا رد', 'customWaived', 'allocErrors']) {
    assert.ok(srp.includes(marker), `SaleReturnsPage يفتقد: ${marker}`)
  }
  ok('SaleReturnsPage: خيار التوزيع الحر الرباعي كامل الأسلاك')

  const gp = readFileSync(join(root, 'src/ui/pages/GuidesPage.tsx'), 'utf8')
  for (const marker of ['guidesForActivity', 'searchGuides', 'setup.activityId']) {
    assert.ok(gp.includes(marker), `GuidesPage يفتقد: ${marker}`)
  }
  ok('GuidesPage موجودة وموصولة بنواة الشروحات وبنشاط الحساب')

  const nav = readFileSync(join(root, 'src/ui/navCatalog.tsx'), 'utf8')
  assert.ok(nav.includes('/settings/guides'))
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
  assert.ok(app.includes('GuidesPage') && app.includes('/settings/guides'))
  const perms = readFileSync(join(root, 'src/core/permissions.ts'), 'utf8')
  assert.ok(perms.includes("'/settings/guides', perm: null"))
  ok('التوجيه + القائمة + الصلاحيات (للجميع) موصولة للشروحات')
}

console.log(`\n✅ verify_refund_freedom_guides: ${pass}/${pass} فحصاً نجح`)
