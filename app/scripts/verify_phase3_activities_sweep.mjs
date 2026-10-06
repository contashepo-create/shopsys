/**
 * المرحلة 3 من التدقيق — كل نشاط من الـ29 يُدقَّق وحده.
 *
 * لكل نشاط:
 *   ① قالبه: وحداته الفعّالة + شجرة حساباته المرئية متسقة (كل وحدة مفعّلة ترى حساباتها،
 *      ولا حساب ظاهر بلا وحدة تبرره) — هذا أساس «تركيب وحدة غير أصلية» في المرحلة 4.
 *   ② يومه المحاسبي بحسب وحداته: شراء ← بيع نقدي ← بيع آجل ← مرتجع ← تحصيل ← مصروف.
 *   ③ بعد كل خطوة: الثوابت الثمانية (توازن، نظافة سطر، مصدر، ترقيم، مخزون = تقييم،
 *      معادلة الميزانية، الأطراف = الدفتر، لا نقدية سالبة).
 *   ④ الختام: ميزان متزن + ميزانية متزنة + مجمل ربح منطقي + حساب الإيراد المستعمل مرئي في شجرة النشاط.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase3_activities_sweep.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, balanceOf, addSimpleItem, addParty, reporter, ACTIVITY_IDS } from './auditKit.mjs'
import { trialBalance, incomeStatement, balanceSheet } from '../src/core/financialReports.ts'
import { ACCOUNT_MODULE_MAP, coaForModules } from '../src/core/coaVisibility.ts'

const R = reporter('المرحلة 3 — الأنشطة التسعة والعشرون نشاطاً نشاطاً')
const ALL = { from: '0000-01-01', to: '2999-12-31' }
const bal = (c, code) => balanceOf(c.st().journal, code)

/** يوم محاسبي كامل مفصّل على وحدات النشاط — يعيد ملخصاً للتأكيد */
async function auditActivity(activityId) {
  const c = await freshCase({ activityId })
  const mods = new Set(c.modules)
  const visible = new Set(coaForModules(c.coa, c.modules).map((a) => a.code))
  const notes = []

  // ① اتساق الشجرة مع الوحدات
  for (const [code, needed] of Object.entries(ACCOUNT_MODULE_MAP)) {
    const shouldSee = needed.some((m) => mods.has(m))
    if (shouldSee) assert.ok(visible.has(code), `${activityId}: الوحدة مفعّلة والحساب ${code} مخفي`)
    else assert.ok(!visible.has(code), `${activityId}: الحساب ${code} ظاهر بلا وحدة تبرره`)
  }
  // الحسابات العامة حاضرة دائماً (لا نشاط بلا خزينة/عملاء/رأس مال/مصروف عام)
  for (const code of ['1101', '1104', '2101', '3101', '3102', '5108', '5102']) {
    assert.ok(visible.has(code), `${activityId}: الحساب العام ${code} غائب عن الشجرة`)
  }
  assertInvariants(`${activityId}: بعد التهيئة`, c)

  // ② مصروف تشغيلي — متاح لكل نشاط مهما كانت وحداته
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 50000, description: `مصروفات تشغيل — ${activityId}` })
  assert.equal(bal(c, '5108'), 50000)
  assertInvariants(`${activityId}: بعد المصروف`, c)
  notes.push('مصروف')

  // ③ طرفان + مستنداتهما
  const cust = addParty(c, 'customer', `عميل ${activityId}`)
  const sup = addParty(c, 'supplier', `مورد ${activityId}`)
  let revenueCode = null
  let soldMinor = 0

  if (mods.has('inventory') && mods.has('purchases')) {
    const item = addSimpleItem(c, { nameAr: `صنف ${activityId}`, priceMinor: 20000 })
    c.st().postPurchase({
      supplierId: sup.id, date: '2026-03-01',
      lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 10000, expiryDate: null }],
      expenses: [], paidMinor: 300000, treasury: '1101', notes: '',
    })
    assert.equal(bal(c, '1103'), 1000000, `${activityId}: المخزون بالتكلفة`)
    assert.equal(c.st().getSupplierBalance(sup.id), 700000, `${activityId}: باقي دين المورد في كشفه`)
    assertInvariants(`${activityId}: بعد الشراء`, c)
    notes.push('شراء')

    if (mods.has('pos')) {
      c.st().postSale({
        lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 30, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
        customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
      })
      const credit = c.st().postSale({
        lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 20, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
        customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
      })
      soldMinor = 1000000
      revenueCode = '4101'
      assert.equal(bal(c, '4101'), -soldMinor, `${activityId}: الإيراد`)
      assert.equal(bal(c, '5101'), 500000, `${activityId}: تكلفة المبيعات`)
      assert.equal(c.st().getCustomerBalance(cust.id), 400000, `${activityId}: ذمة العميل في كشفه`)
      assertInvariants(`${activityId}: بعد البيع`, c)
      notes.push('بيع نقدي وآجل')

      // مرتجع جزئي بردّ نقدي
      c.st().postSaleReturn({
        saleId: credit.id, qtyByItem: new Map([[item.id, 5]]),
        refund: { mode: 'customer_credit' }, reason: 'صنف غير مطابق',
      })
      assert.equal(c.st().getCustomerBalance(cust.id), 300000, `${activityId}: المرتجع خفّض الذمة`)
      assertInvariants(`${activityId}: بعد المرتجع`, c)
      notes.push('مرتجع')

      // تحصيل
      c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100000, description: 'تحصيل', partyKind: 'customer', partyId: cust.id })
      assert.equal(c.st().getCustomerBalance(cust.id), 200000, `${activityId}: التحصيل ظهر في الكشف`)
      assertInvariants(`${activityId}: بعد التحصيل`, c)
      notes.push('تحصيل')
    }
  }

  // ④ الختام: التقارير
  const tb = trialBalance(c.st().journal, ALL)
  assert.ok(tb.balanced, `${activityId}: ميزان المراجعة غير متزن`)
  const bs = balanceSheet(c.st().journal, '2999-12-31')
  assert.ok(bs.balanced, `${activityId}: الميزانية غير متزنة`)
  const is = incomeStatement(c.st().journal, ALL)
  if (revenueCode) {
    assert.ok(visible.has(revenueCode), `${activityId}: حساب الإيراد ${revenueCode} غير مرئي في شجرة النشاط`)
    assert.ok(is.grossProfitMinor > 0, `${activityId}: مجمل الربح غير منطقي`)
  }
  assert.equal(is.netProfitMinor, bs.retainedEarningsMinor, `${activityId}: صافي القائمة ≠ محتجز الميزانية`)
  assertInvariants(`${activityId}: الختام`, c)
  return { modules: [...mods], notes, netProfitMinor: is.netProfitMinor }
}

const summary = []
for (const activityId of ACTIVITY_IDS) {
  const res = await auditActivity(activityId)
  summary.push({ activityId, ...res })
  R.ok(`${activityId.padEnd(19)} — وحدات: ${res.modules.length} · ${res.notes.join(' ← ') || 'مصروف فقط'} · صافي ${(res.netProfitMinor / 100).toFixed(2)}`)
}

assert.equal(summary.length, 29, 'كل الأنشطة التسعة والعشرين دُقِّقت')
const withPos = summary.filter((s) => s.modules.includes('pos')).length
const withoutPos = summary.length - withPos
R.ok(`الحصيلة: ${summary.length} نشاطاً — ${withPos} ببيع كاشير و${withoutPos} بمحركات متخصصة، وكلها أنهت اليوم بميزان وميزانية متزنين`)

R.done('— كل نشاط بوحداته وشجرة حساباته ويومه المحاسبي: الثوابت الثمانية صامدة')
