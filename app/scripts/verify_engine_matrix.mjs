/**
 * verify_engine_matrix.mjs — بوابة المرحلة 0 + 1 من خطة التدقيق المحاسبي.
 *
 * تتحقق من أربعة أشياء لا يجوز أن تنكسر:
 *   1) **مصفوفة المحرك محدَّثة**: `docs/مصفوفة_المحرك_المحاسبي.md` مطابقة لما يولّده الكود الآن
 *      (أي مسار ترحيل جديد بلا تحديث المصفوفة = فشل).
 *   2) **تغطية أنواع المصادر والحسابات**: كل قيمة في اتحاد `SourceType` لها مسار فعلي (عدا المستثنى الموثق)،
 *      وكل كود حساب مستعمل موجود في الشجرة وقابل للترحيل.
 *   3) **الثوابت العشرة** (AGENTS.md §3.5) على دورات حقيقية في أنشطة مختلفة، بعد كل خطوة.
 *   4) **الثابت العاشر**: الرفض بنص عربي بلا أثر جزئي (سنة مقفلة، قيد غير متزن، بيع بلا رصيد، مبلغ سالب).
 */
import { readFileSync } from 'node:fs'
import { freshCase, assertInvariants, checkInvariants, expectReject, addSimpleItem, addParty, balanceOf, reporter, STANDARD_COA, useAppStore } from './auditKit.mjs'
import { buildMatrix, MATRIX_PATH } from './gen_engine_matrix.mjs'

const R = reporter('بوابة مصفوفة المحرك والثوابت العشرة')

// ————————————————————————————————————————————————
// 1) المصفوفة محدَّثة
// ————————————————————————————————————————————————
R.section('📐 مصفوفة المحرك المحاسبي')
const { md, rows, sources } = buildMatrix()
const onDisk = readFileSync(MATRIX_PATH, 'utf8')
if (onDisk !== md) {
  console.error('❌ مصفوفة المحرك غير محدَّثة — شغّل: node --experimental-strip-types scripts/gen_engine_matrix.mjs')
  process.exit(1)
}
R.ok(`المصفوفة مطابقة للكود: ${rows.length} مسار ترحيل`)
if (rows.length < 180) { console.error(`❌ عدد المسارات انهار إلى ${rows.length} — المستخرج معطوب`); process.exit(1) }

// ————————————————————————————————————————————————
// 2) تغطية أنواع المصادر والحسابات
// ————————————————————————————————————————————————
const ledgerSrc = readFileSync(new URL('../src/core/ledger.ts', import.meta.url), 'utf8')
const union = [...ledgerSrc.slice(ledgerSrc.indexOf('export type SourceType')).split('\n\n')[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
/** مستثنى موثق: قيمة محجوزة بلا مسار — الأرصدة الافتتاحية تُوسم adjustment اليوم (AUDIT-006) */
const DOCUMENTED_UNUSED = ['opening']
const missing = union.filter((u) => !sources.has(u) && !DOCUMENTED_UNUSED.includes(u))
if (missing.length) { console.error(`❌ أنواع مصدر بلا مسار ترحيل: ${missing.join(', ')}`); process.exit(1) }
R.ok(`تغطية أنواع المصدر: ${sources.size}/${union.length} (المستثنى الموثق: ${DOCUMENTED_UNUSED.join('، ')})`)

const codes = new Set(STANDARD_COA.map((a) => a.code))
const postable = new Set(STANDARD_COA.filter((a) => a.isPostable).map((a) => a.code))
const usedLiterals = new Set(rows.flatMap((r) => [...r.debits, ...r.credits]).filter((c) => /^\d{4}$/.test(c)))
for (const c of usedLiterals) {
  if (!codes.has(c)) { console.error(`❌ كود حساب مستعمل وغير موجود في الشجرة: ${c}`); process.exit(1) }
  if (!postable.has(c)) { console.error(`❌ ترحيل على حساب تجميعي: ${c}`); process.exit(1) }
}
R.ok(`${usedLiterals.size} كود حساب مستعمل — كلها موجودة وقابلة للترحيل`)

// ————————————————————————————————————————————————
// 3) الثوابت العشرة على دورات حقيقية
// ————————————————————————————————————————————————
R.section('⚖️ الثوابت العشرة على دورات حقيقية')

/** دورة تجارية كاملة: شراء آجل ← بيع نقدي ← بيع آجل ← تحصيل ← مصروف ← مرتجع */
async function tradingCycle(activityId, opts = {}) {
  const c = await freshCase({ activityId, ...opts })
  const item = addSimpleItem(c, { nameAr: 'صنف اختبار', priceMinor: 10000 })
  const sup = addParty(c, 'supplier', 'مورد التدقيق')
  const cust = addParty(c, 'customer', 'عميل التدقيق')

  c.st().postPurchase({ supplierId: sup.id, date: '2026-03-01', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 6000 }] })
  assertInvariants(`${activityId}: بعد الشراء الآجل`, c)

  const cost = c.st().items.find((i) => i.id === item.id).costMinor
  const line = (qty) => ({ itemId: item.id, nameAr: 'صنف اختبار', qty, unitPriceMinor: 10000, unitCostMinor: cost, discountPercent: 0, soldByWeight: false })
  c.st().postSale({ lines: [line(10)], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
  assertInvariants(`${activityId}: بعد البيع النقدي`, c)

  const credit = c.st().postSale({ lines: [line(20)], payment: 'credit', treasury: '1101', customerId: cust.id, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false })
  assertInvariants(`${activityId}: بعد البيع الآجل`, c)

  c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 50000, description: 'تحصيل من عميل', date: '2026-03-05', partyKind: 'customer', partyId: cust.id })
  assertInvariants(`${activityId}: بعد سند القبض`, c)

  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 7000, description: 'مصروف نظافة', date: '2026-03-06' })
  assertInvariants(`${activityId}: بعد سند الصرف`, c)

  c.st().postSaleReturn({ saleId: credit.id, qtyByItem: new Map([[item.id, 5]]), refund: 'credit', reason: 'مرتجع تدقيق', reasonCode: 'damaged' })
  assertInvariants(`${activityId}: بعد مرتجع المبيعات`, c)

  // ث9: قيود المستندات محمية من العكس المباشر، والقيد اليدوي يُصحَّح بعكسه
  expectReject(`${activityId}: عكس قيد فاتورة مباشرة`, c, () => c.st().reverseEntry(c.st().journal[0].id, 'محاولة'))
  const manual = c.st().postManualEntry({ date: '2026-03-07', description: 'قيد تسوية يدوي', lines: [
    { accountCode: '5108', debit: 3000, credit: 0 }, { accountCode: '1101', debit: 0, credit: 3000 },
  ] })
  c.st().reverseEntry(manual.id, 'اختبار التصحيح بالعكس')
  assertInvariants(`${activityId}: بعد عكس القيد اليدوي`, c)

  return c
}

for (const activityId of ['grocery', 'pharmacy', 'clothing', 'general', 'trading']) {
  const c = await tradingCycle(activityId)
  const { stats } = checkInvariants(c)
  R.ok(`${c.label}: دورة كاملة — ${stats.entries} قيداً، ${stats.accounts.length} حساباً، الثوابت العشرة سليمة`)
}

// نشاط خدمي بلا مخزون + ضريبة سعودية غير شاملة
{
  const c = await freshCase({ activityId: 'services', countryCode: 'SA', vatPercent: 15, taxInclusive: false })
  const svc = addSimpleItem(c, { nameAr: 'خدمة استشارة', priceMinor: 50000, isService: true })
  const cust = addParty(c, 'customer', 'عميل خدمات')
  c.st().postSale({ lines: [{ itemId: svc.id, nameAr: 'خدمة استشارة', qty: 2, unitPriceMinor: 50000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], payment: 'credit', treasury: '1101', customerId: cust.id, invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: false, allowNegativeStock: false })
  const s = assertInvariants('خدمات SA: بيع خدمة آجل بضريبة 15% غير شاملة', c)
  const vat = -balanceOf(c.st().journal, '2102')
  if (vat !== 15000) { console.error(`❌ ضريبة الخدمة المتوقعة 15000 والموجود ${vat}`); process.exit(1) }
  R.ok(`خدمات (SA 15% غير شاملة): ضريبة ${vat} على إيراد 100000 — ${s.entries} قيداً والثوابت سليمة`)
}

// الأرصدة الافتتاحية بالمسار الصحيح: قيد متوازن مقابل 3101
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل منقول')
  c.st().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 250000, label: 'رصيد افتتاحي' })
  assertInvariants('أرصدة افتتاحية: عميل مقابل رأس المال', c)
  if (balanceOf(c.st().journal, '1104') !== 250000 || balanceOf(c.st().journal, '3101') !== -250000) {
    console.error('❌ الرصيد الافتتاحي للعميل لم يُقيد 1104/3101'); process.exit(1)
  }
  R.ok('الرصيد الافتتاحي للعميل: 1104 مدين / 3101 دائن — ومطابقة الكشف سليمة (ث7)')
}

// ————————————————————————————————————————————————
// 4) الثابت العاشر — الرفض الذري بنص عربي
// ————————————————————————————————————————————————
R.section('🛡️ ث10: الرفض الذري بنص عربي')
{
  const c = await freshCase({ activityId: 'general', allowNegativeTreasury: false })
  const item = addSimpleItem(c, { nameAr: 'صنف', priceMinor: 5000 })
  const sup = addParty(c, 'supplier', 'مورد')
  c.st().postPurchase({ supplierId: sup.id, date: '2026-02-01', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 3000 }] })

  expectReject('بيع كمية أكبر من الرصيد', c, () => c.st().postSale({
    lines: [{ itemId: item.id, nameAr: 'صنف', qty: 99, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
    payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false,
  }))
  R.ok('بيع بلا رصيد مخزون: مرفوض بلا أثر')

  expectReject('قيد يدوي غير متزن', c, () => c.st().postManualEntry({ date: '2026-02-02', description: 'قيد مختل', lines: [
    { accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900 },
  ] }))
  R.ok('قيد يدوي غير متزن: مرفوض بلا أثر')

  expectReject('قيد يدوي على حساب تجميعي', c, () => c.st().postManualEntry({ date: '2026-02-02', description: 'ترحيل على تجميعي', lines: [
    { accountCode: '11', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1000 },
  ] }))
  R.ok('ترحيل على حساب تجميعي: مرفوض بلا أثر')

  expectReject('سطر مدين ودائن معاً', c, () => c.st().postManualEntry({ date: '2026-02-02', description: 'سطر بجانبين', lines: [
    { accountCode: '1101', debit: 500, credit: 500 }, { accountCode: '4101', debit: 0, credit: 500 }, { accountCode: '5108', debit: 500, credit: 0 },
  ] }))
  R.ok('سطر مدين ودائن معاً: مرفوض بلا أثر')

  expectReject('مبلغ سالب في القيد', c, () => c.st().postManualEntry({ date: '2026-02-02', description: 'مبلغ سالب', lines: [
    { accountCode: '1101', debit: -1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: -1000 },
  ] }))
  R.ok('مبلغ سالب: مرفوض بلا أثر')

  // سنة مالية مقفلة
  useAppStore.setState({ fiscalYears: [{ id: 9, nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }, { id: 10, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
  expectReject('قيد داخل سنة مقفلة', c, () => c.st().postManualEntry({ date: '2025-06-01', description: 'قيد في سنة مقفلة', lines: [
    { accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1000 },
  ] }), /مقفلة/)
  R.ok('قيد داخل سنة مالية مقفلة: مرفوض بلا أثر')

  expectReject('صرف أكبر من رصيد الخزينة مع منع السالب', c, () => c.st().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 9_000_000, description: 'صرف ضخم', date: '2026-03-01',
  }))
  R.ok('صرف أكبر من رصيد الخزينة (السالب ممنوع): مرفوض بلا أثر')

  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
  assertInvariants('بعد كل حالات الرفض', c)
  R.ok('الدفتر سليم تماماً بعد سبع محاولات مرفوضة')
}

R.done(`· ${rows.length} مسار ترحيل موثق · ${sources.size} نوع مصدر`)
