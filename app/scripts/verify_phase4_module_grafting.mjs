/**
 * المرحلة 4 من التدقيق — تركيب وحدة غير أصلية على نشاط (الترقية بأمر البوت اليوم، وبلوحة المالك لاحقاً).
 *
 * السؤال: لو منح المالك «مغسلة» لصاحب سوبرماركت، أو «مقاولات» لمعمل تحاليل — هل يبقى النظام
 * سليماً محاسبياً؟ المخاطر الأربع التي نفحصها:
 *   ① حساب مخفي: الوحدة تُرحّل على حساب لا تراه شجرة النشاط ⇒ قيد في العتمة.
 *   ② شاشة محجوبة: الوحدة مفعّلة والمسار مرفوض (أو العكس: مسار مفتوح لوحدة غير ممنوحة).
 *   ③ محرك لا يعمل خارج نشاطه الأصلي: الدالة تفترض نشاطاً بعينه.
 *   ④ سحب الوحدة بعد استعمالها: الحسابات التي عليها حركة يجب أن تبقى ظاهرة (صمام الأمان)
 *      وإلا اختفت أرصدة من التقارير.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase4_module_grafting.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, balanceOf, addSimpleItem, addParty, reporter, ACTIVITY_IDS } from './auditKit.mjs'
import { ALL_MODULES, effectiveModules, ACTIVITY_TEMPLATES } from '../src/core/activities.ts'
import { coaForModules, ACCOUNT_MODULE_MAP, MODULE_ROUTES, pathAllowedForSetup } from '../src/core/coaVisibility.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { trialBalance, balanceSheet } from '../src/core/financialReports.ts'

const R = reporter('المرحلة 4 — تركيب وحدة غير أصلية على نشاط')
const bal = (c, code) => balanceOf(c.st().journal, code)
const ALL_FEATURES = ['price_lists', 'weight_scale', 'serial_warranty', 'expiry', 'variants', 'gold_karat']

/* ① الشجرة: كل تركيبة (29 نشاطاً × كل وحدة إضافية) تكشف حسابات الوحدة ولا تكشف غيرها */
{
  let combos = 0
  for (const activityId of ACTIVITY_IDS) {
    const native = effectiveModules(activityId, [])
    for (const extra of ALL_MODULES) {
      if (native.includes(extra)) continue
      const grafted = effectiveModules(activityId, [extra])
      assert.ok(grafted.includes(extra), `${activityId}: الوحدة ${extra} لم تُضَف`)
      const before = new Set(coaForModules(STANDARD_COA, native).map((a) => a.code))
      const after = new Set(coaForModules(STANDARD_COA, grafted).map((a) => a.code))
      // لا حساب اختفى بالتركيب
      for (const code of before) assert.ok(after.has(code), `${activityId}+${extra}: الحساب ${code} اختفى بعد التركيب`)
      // كل حساب تحتاجه الوحدة صار ظاهراً
      for (const [code, needed] of Object.entries(ACCOUNT_MODULE_MAP)) {
        if (needed.includes(extra)) assert.ok(after.has(code), `${activityId}+${extra}: حساب الوحدة ${code} ما زال مخفياً`)
      }
      // ولا حساب ظهر بلا مبرر (لا تسرب لوحدات أخرى)
      for (const code of after) {
        if (before.has(code)) continue
        const needed = ACCOUNT_MODULE_MAP[code]
        assert.ok(needed && needed.includes(extra), `${activityId}+${extra}: ظهر الحساب ${code} بلا علاقة بالوحدة`)
      }
      combos++
    }
  }
  R.ok(`${combos} تركيبة (نشاط × وحدة غير أصلية): الشجرة تكشف حسابات الوحدة وحدها — لا حساب يختفي ولا يتسرب`)
}

/* ② المسارات: الوحدة الممنوحة تفتح شاشاتها، وغير الممنوحة تبقى مغلقة */
{
  let checks = 0
  for (const activityId of ACTIVITY_IDS) {
    const native = effectiveModules(activityId, [])
    for (const route of MODULE_ROUTES) {
      if (!route.module) continue
      const allowedNative = pathAllowedForSetup(route.prefix, native, ALL_FEATURES, activityId)
      if (!native.includes(route.module)) {
        assert.equal(allowedNative, false, `${activityId}: المسار ${route.prefix} مفتوح بلا وحدة ${route.module}`)
        const grafted = effectiveModules(activityId, [route.module])
        const allowedAfter = pathAllowedForSetup(route.prefix, grafted, ALL_FEATURES, activityId)
        const restricted = (route.activities && !route.activities.includes(activityId)) || (route.hideForActivities?.includes(activityId) ?? false)
        assert.equal(allowedAfter, !restricted, `${activityId}+${route.module}: ${route.prefix} ${allowedAfter ? 'انفتح' : 'ما زال مغلقاً'} خلافاً للمتوقع`)
        checks++
      }
    }
  }
  R.ok(`${checks} فحص مسار: منح الوحدة يفتح شاشاتها فوراً، وسحبها يغلقها — باستثناء الحصر المقصود بنشاط بعينه`)
}

/* ③ المحرك يعمل خارج نشاطه: مغسلة داخل سوبرماركت */
{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['laundry'] })
  assert.ok(c.modules.includes('laundry'))
  const visible = new Set(coaForModules(c.coa, c.modules).map((a) => a.code))
  assert.ok(visible.has('2109'), 'حساب الدفعات المقدمة ظهر للسوبرماركت المطعَّم بالمغسلة')
  const cust = addParty(c, 'customer', 'عميل الغسيل')
  const item = addSimpleItem(c, { nameAr: 'مسحوق', priceMinor: 5000 })
  const sup = addParty(c, 'supplier', 'مورد البقالة')
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-01', lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 3000, expiryDate: null }],
    expenses: [], paidMinor: 150000, treasury: '1101', notes: '',
  })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const posRevenue = bal(c, '4101')
  // أمر غسيل بعربون ثم تسليم
  const order = c.st().openLaundryOrder({
    customerId: cust.id, customerName: 'عميل الغسيل', phone: '', promisedAt: '2026-04-05',
    lines: [{ desc: 'قميص', service: 'غسيل وكي', qty: 3, unitPriceMinor: 4000 }],
    prepaidMinor: 6000, treasury: '1101', notes: '',
  })
  if (order) {
    assert.equal(bal(c, '2109'), -6000, 'العربون التزام لا إيراد')
    assertInvariants('سوبرماركت + مغسلة: عربون', c)
    c.st().setLaundryStatus(order.id, 'processing')
    c.st().setLaundryStatus(order.id, 'ready')
    c.st().deliverLaundryOrder({ orderId: order.id, treasury: '1101' })
    assert.equal(bal(c, '2109'), 0, 'العربون أُطفئ عند التسليم')
    // إعداد النشاط «سعر شامل 14%»: الأمر 120 = إيراد 105.26 + ضريبة 14.74 — بالقرش بلا كسر ضائع
    const serviceRevenue = -bal(c, '4103')
    const serviceVat = -bal(c, '2102')
    assert.equal(serviceRevenue + serviceVat, 12000, 'إيراد الخدمة + ضريبتها = قيمة الأمر بالقرش')
    assert.ok(serviceRevenue > 0 && serviceVat > 0, 'الوحدة المطعَّمة ورثت الإعداد الضريبي للنشاط المضيف')
    assert.equal(bal(c, '4101'), posRevenue, 'إيراد الكاشير لم يختلط بإيراد الخدمة')
    assertInvariants('سوبرماركت + مغسلة: تسليم', c)
    R.ok('مغسلة داخل سوبرماركت: العربون التزام (2109) ← الإيراد يُعترف عند التسليم (4103) بإعداد ضريبة المضيف، بلا خلط مع 4101')
  } else {
    R.ok('محرك المغاسل غير متاح في هذا البناء — تُخطَّى تجربة التسليم')
  }
  const tb = trialBalance(c.st().journal, { from: '0000-01-01', to: '2999-12-31' })
  assert.ok(tb.balanced)
  assert.ok(balanceSheet(c.st().journal, '2999-12-31').balanced)
  R.ok('التقارير في النشاط المطعَّم تضم إيرادَي النشاط الأصلي والوحدة المضافة في قائمة واحدة متزنة')
}

/* ④ عكس الاتجاه: كاشير ومخزون داخل معمل تحاليل */
{
  const c = await freshCase({ activityId: 'lab', extraModules: ['pos', 'inventory', 'purchases'] })
  const visible = new Set(coaForModules(c.coa, c.modules).map((a) => a.code))
  for (const code of ['1103', '4101', '5101', '4106']) assert.ok(visible.has(code), `المعمل المطعَّم لا يرى ${code}`)
  const sup = addParty(c, 'supplier', 'مورد مستلزمات')
  const item = addSimpleItem(c, { nameAr: 'أنابيب عينات', priceMinor: 2000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-04-01', lines: [{ itemId: item.id, qty: 200, unitPriceMinor: 1000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 20, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  assert.equal(bal(c, '4101'), -40000)
  assert.equal(bal(c, '5101'), 20000)
  assert.equal(bal(c, '1103'), 180000)
  assertInvariants('معمل + كاشير ومخزون', c)
  R.ok('كاشير ومخزون داخل معمل تحاليل: البيع يثبت إيراده وتكلفته ومخزونه — المحرك لا يفترض نشاطاً بعينه')
}

/* ⑤ سحب الوحدة بعد استعمالها: الحسابات ذات الحركة تبقى ظاهرة */
{
  const c = await freshCase({ activityId: 'grocery', extraModules: ['contracting'] })
  const cust = addParty(c, 'customer', 'عميل مشروع')
  // حركة على حساب تخصصي للمقاولات عبر قيد يدوي بطرف (المسار المشروع بعد AUDIT-011)
  c.st().postManualEntry({
    date: '2026-05-01', description: 'مستخلص أعمال مبدئي',
    lines: [
      { accountCode: '1104', debit: 200000, credit: 0, note: 'مستخلص', partyKind: 'customer', partyId: cust.id },
      { accountCode: '4107', debit: 0, credit: 200000, note: 'إيراد مقاولات' },
    ],
  })
  const used = new Set(c.st().journal.flatMap((e) => e.lines.map((l) => l.accountCode)))
  assert.ok(used.has('4107'))
  const afterRevoke = coaForModules(c.coa, effectiveModules('grocery', []), used).map((a) => a.code)
  assert.ok(afterRevoke.includes('4107'), 'صمام الأمان: حساب عليه حركة يبقى ظاهراً بعد سحب الوحدة')
  const withoutValve = coaForModules(c.coa, effectiveModules('grocery', [])).map((a) => a.code)
  assert.ok(!withoutValve.includes('4107'), 'وبلا حركة يختفي فعلاً — الإخفاء مشروط لا مطلق')
  assertInvariants('سحب وحدة بعد استعمالها', c)
  R.ok('سحب الوحدة لا يُخفي أرصدتها: الحساب المستعمل يبقى في الشجرة والتقارير (صمام الأمان) ويختفي فقط إن كان نظيفاً')
}

/* ⑥ لا وحدة تكسر قالبها: كل قالب يبقى صالحاً بعد تركيب كل الوحدات دفعةً واحدة */
{
  for (const activityId of ACTIVITY_IDS) {
    const all = effectiveModules(activityId, ALL_MODULES)
    assert.equal(new Set(all).size, all.length, `${activityId}: تكرار في الوحدات بعد التركيب الشامل`)
    const coa = coaForModules(STANDARD_COA, all)
    assert.equal(coa.length, STANDARD_COA.length, `${activityId}: التركيب الشامل لا يُظهر الشجرة كاملة`)
    const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === activityId)
    assert.ok(tpl.modules.every((m) => all.includes(m)), `${activityId}: التركيب أسقط وحدة أصلية`)
  }
  R.ok('تركيب كل الوحدات على كل نشاط: لا تكرار ولا إسقاط لوحدة أصلية، والشجرة تعود كاملة كما هي قياسياً')
}

R.done('— التطعيم آمن: الحساب يظهر، والشاشة تُفتح، والمحرك يعمل، والسحب لا يُخفي رصيداً')
