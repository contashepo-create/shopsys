/**
 * بوابة §93 — منظومة خزائن العملات الأجنبية (طلب المالك):
 * ① أرصدة مشتقة من المستندات: تحصيل فاتورة بالدولار يدخل الرصيد بسعر
 *    التحصيل، وسداد الشراء بالعملة يخرجه — لكل خزينة على حدة (المكان).
 * ② تحويل عملة → دفتر: سعر تنفيذ + مصاريف (5108) + فرق العملة عن متوسط
 *    التكلفة ربحاً (4117) أو خسارة (5119) — بقيد متوازن ومستند FXC.
 * ③ شراء عملة من الدفتر: تكلفة شراء بلا أرباح وهمية.
 * ④ حارس الرصيد: لا تحويل فوق الموجود. ترتيب التدفقات بترتيب القيود.
 * ⑤ واجهة: تبويب «العملات» بمركز التقارير + نافذة التحويل + زر العملة
 *    الأجنبية في فاتورتي البيع والشراء يفتح نافذة منظمة لا حقولاً متداخلة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_fx_treasury.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshCase, addParty, addSimpleItem, assertInvariants, reporter } from './auditKit.mjs'

const R = reporter('منظومة العملات: أرصدة بالأماكن + تحويل بمصاريف وفروق')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

/* ═══ ① الرحلة الكاملة على متجر نظيف ═══ */
{
  const c = await freshCase({ activityId: 'general' })
  const g = () => c.store.getState()
  const cust = addParty(c, 'customer', 'عميل دولي')
  const item = addSimpleItem(c, { nameAr: 'خدمة تصدير', priceMinor: 480000, isService: true })

  /* فاتورة بيع محصلة 200$ بسعر 48 → رصيد مذكرة بخزينة الرئيسية */
  g().postSale({
    lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 480000, discountPercent: 0 }],
    customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', paidMinor: 960000, fx: { currencyCode: 'USD', amountMinor: 20000, ratePpm: 48_000_000, decimals: 2 },
    bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  let h = g().getFxHoldings().find((row) => row.currency === 'USD' && row.treasury === '1101')
  assert.ok(h && h.amountMinor === 20000 && h.bookValueMinor === 960000, 'رصيد الدولار لم يشتق من الفاتورة بسعر التحصيل')
  assert.equal(h.avgRatePpm, 48_000_000, 'متوسط التكلفة خاطئ')
  R.ok('تحصيل فاتورة بالدولار: رصيد 200$ بالخزينة الرئيسية بسعر التكلفة 48 — مشتق لا يدوي')

  /* تحويل 120$ → جنيه بسعر 50 و10 ج.م مصاريف: مستلم 5990 وربح فرق 240 */
  const doc = g().convertFx({
    fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 12000,
    toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101',
    fromRatePpm: 50_000_000, toRatePpm: 1_000_000, feeMinor: 1000,
  })
  assert.ok(/^FXC-/.test(doc.docNumber), 'رقم مستند التحويل بصيغة خاطئة')
  assert.equal(doc.toAmountMinor, 599000, 'المستلم بعد المصاريف خاطئ (120×50−10=5990)')
  assert.equal(doc.gainMinor, 24000, 'ربح فرق العملة خاطئ (50−48)×120=240')
  assert.equal(doc.lossMinor, 0, 'لا خسارة مع رفع السعر')
  const entry = g().journal.find((e) => e.id === doc.journalEntryId)
  assert.equal(entry.sourceType, 'fx_conversion', 'مصدر قيد التحويل خاطئ')
  assert.ok(entry.lines.some((l) => l.accountCode === '1101' && l.debit === 599000), 'الخزينة لم تستلم الصافي مديناً')
  assert.ok(entry.lines.some((l) => l.accountCode === '5108' && l.debit === 1000), 'المصاريف لم تُقيَّد على 5108')
  assert.ok(entry.lines.some((l) => l.accountCode === '4117' && l.credit === 24000), 'ربح فرق العملة لم يُقيَّد على 4117')
  assert.ok(entry.lines.some((l) => l.accountCode === '1101' && l.credit === 576000), 'القيمة الدفترية للدولار لم تُخرج دائنة')
  assertInvariants('بعد تحويل دولار إلى جنيه', c)

  /* المتبقي 80$ — الترتيب بالقيود لا أبجدياً */
  h = g().getFxHoldings().find((row) => row.currency === 'USD' && row.treasury === '1101')
  assert.equal(h.amountMinor, 8000, 'التحويل لم يخفض رصيد الدولار (خلل الترتيب القديم)')
  assert.equal(h.bookValueMinor, 384000, 'القيمة الدفترية المتبقية خاطئة (80×48)')
  R.ok('تحويل 120$ بسعر 50: مستلم 5990 · مصاريف 10 على 5108 · ربح فرق 240 على 4117 · المتبقي 80$')

  /* شراء 50$ من البنك بـ2455 ج.م (49/دولار + 5 مصاريف): لا أرباح عند الشراء */
  const doc2 = g().convertFx({
    fromCurrency: 'EGP', fromDecimals: 2, fromTreasury: '1102', fromAmountMinor: 245500,
    toCurrency: 'USD', toDecimals: 2, toTreasury: '1102',
    fromRatePpm: 1_000_000, toRatePpm: 49_000_000, feeMinor: 500,
  })
  assert.equal(doc2.toAmountMinor, 5000, 'الدولار المشترى خاطئ (2455−5)/49=50$')
  assert.equal(doc2.gainMinor, 0, 'ربح وهمي عند الشراء')
  assert.equal(doc2.lossMinor, 0, 'خسارة وهمية عند الشراء')
  const h2 = g().getFxHoldings().find((row) => row.currency === 'USD' && row.treasury === '1102')
  assert.equal(h2.amountMinor, 5000, 'رصيد الدولار بالبنك لم يشتق')
  assert.equal(h2.avgRatePpm, 49_000_000, 'تكلفة الشراء يجب أن تكون 49')
  assertInvariants('بعد شراء دولار من البنك', c)
  R.ok('شراء 50$ من البنك: 50$ بتكلفة 49 للدولار — بلا أرباح وهمية عند الشراء')

  /* حارس الرصيد + رفض العملة نفسها + رفض دفتر→دفتر */
  try {
    g().convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 99999, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 50_000_000, toRatePpm: 1_000_000, feeMinor: 0 })
    throw new Error('كان يجب رفض التحويل فوق الرصيد')
  } catch (e) { assert.ok(/لا يكفي/.test(String(e.message)), `حارس الرصيد رفض برسالة غريبة: ${e.message}`) }
  try {
    g().convertFx({ fromCurrency: 'EGP', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 1000, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1102', fromRatePpm: 1_000_000, toRatePpm: 1_000_000, feeMinor: 0 })
    throw new Error('كان يجب رفض دفتر→دفتر')
  } catch (e) { assert.ok(/تحويل خزينة/.test(String(e.message)), `رفض دفتر→دفتر برسالة غريبة: ${e.message}`) }
  try {
    g().convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 5000, toCurrency: 'USD', toDecimals: 2, toTreasury: '1101', fromRatePpm: 50_000_000, toRatePpm: 1_000_000, feeMinor: 0 })
    throw new Error('كان يجب رفض العملة ونفسها')
  } catch (e) { assert.ok(/نفسها/.test(String(e.message)), `رفض نفس العملة برسالة غريبة: ${e.message}`) }
  R.ok('الحراس: فوق الرصيد مرفوض · دفتر→دفتر يوجه لتحويل الخزينة · العملة ونفسها مرفوضة')
}

/* ═══ ② تحويل أجنبي بأجنبي عبر جسر الدفتر ═══ */
{
  const c = await freshCase({ activityId: 'general' })
  const g = () => c.store.getState()
  const cust = addParty(c, 'customer', 'مصدر أوروبي')
  const item = addSimpleItem(c, { nameAr: 'خدمة', priceMinor: 100000, isService: true })
  g().postSale({
    lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 100000, discountPercent: 0 }],
    customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', paidMinor: 1_000_000, fx: { currencyCode: 'EUR', amountMinor: 20000, ratePpm: 50_000_000, decimals: 2 },
    bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  /* يورو → دولار: 100€ بسعر 53 لل يورو و49 للدولار = 108.16$ تقريباً بعد بلا مصاريف */
  const doc = g().convertFx({
    fromCurrency: 'EUR', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 10000,
    toCurrency: 'USD', toDecimals: 2, toTreasury: '1102',
    fromRatePpm: 53_000_000, toRatePpm: 49_000_000, feeMinor: 0,
  })
  assert.equal(doc.fromAmountMinor, 10000)
  assert.ok(doc.toAmountMinor > 0, 'المستلم بالدولار صفر')
  const eur = g().getFxHoldings().find((row) => row.currency === 'EUR' && row.treasury === '1101')
  const usd = g().getFxHoldings().find((row) => row.currency === 'USD' && row.treasury === '1102')
  assert.equal(eur.amountMinor, 10000, 'اليورو المتبقي خاطئ')
  assert.equal(usd.amountMinor, doc.toAmountMinor, 'الدولار المستلم لم يدخل رصيد البنك')
  /* ربح فرق: اليورو خرج بتكلفة 50 واستُبدل بسعر 53 → ربح 300 ج.م */
  assert.equal(doc.gainMinor, 30000, 'ربح التحويل الأجنبي-بالأجنبي خاطئ (53−50)×100')
  assertInvariants('بعد يورو→دولار', c)
  R.ok('أجنبي بأجنبي (يورو→دولار): عبر جسر الدفتر بربح فرق صحيح 300 ج.م')
}

/* ═══ ③ واجهة ونواة: الأرصدة بالأماكن + النوافذ + الحسابات ═══ */
{
  const tab = read('ui/pages/FxTreasuryTab.tsx')
  const reports = read('ui/pages/ReportsPage.tsx')
  const core = read('core/fxTreasury.ts')
  const ledger = read('core/ledger.ts')
  const repo = read('data/repo.ts')

  assert.ok(reports.includes("setTab('currencies')") && reports.includes('العملات') && reports.includes('<FxTreasuryTab'), 'تبويب العملات غير موصول بمركز التقارير')
  assert.ok(tab.includes('data-fx-holdings') && tab.includes('المكان (الخزينة/البنك)'), 'جدول الأرصدة بلا عمود المكان')
  assert.ok(tab.includes('متوسط التكلفة') && tab.includes('غير محقق'), 'الأرصدة بلا متوسط تكلفة وفرق غير محقق')
  assert.ok(tab.includes('data-fx-convert-open') && tab.includes('data-fx-convert-modal') && tab.includes('data-fx-conv-preview'), 'نافذة التحويل أو معاينتها مفقودة')
  assert.ok(tab.includes('data-fx-conversions') && tab.includes('data-fx-flows'), 'سجل التحويلات أو التدفقات مفقود')
  assert.ok(tab.includes('data-fx-print'), 'زر طباعة تقرير العملات مفقود')
  assert.ok(core.includes('FX_GAIN_ACCOUNT') && core.includes('FX_LOSS_ACCOUNT') && core.includes('FX_CONVERSION_FEE_ACCOUNT'), 'ثوابت حسابات الفروق والمصاريف مفقودة')
  assert.ok(ledger.includes("code: '4117'") && ledger.includes('أرباح فروق عملة'), 'حساب أرباح فروق العملة 4117 مفقود من الشجرة')
  assert.ok(ledger.includes("code: '5119'") && ledger.includes('خسائر فروق عملة'), 'حساب خسائر فروق العملة 5119 مفقود من الشجرة')
  assert.ok(ledger.includes("'fx_conversion'"), 'نوع المصدر fx_conversion مفقود')
  assert.ok(repo.includes('fxConversions: FxConversionDoc[]') && repo.includes('convertFx: (args'), 'المستودع لا يعرف التحويلات')
  assert.ok(repo.includes('fxConversions: s.fxConversions ?? []'), 'التحويلات لا تستمر مع إعادة التحميل')
  assert.ok(core.includes('seq === b.seq') || core.includes('a.seq - b.seq'), 'التدفقات لا تُرتَّب بتسلسل القيود')
  R.ok('الواجهة والنواة: تبويب العملات بالأماكن + نافذة التحويل بمعاينة + حسابات 4117/5119 + استمرار الحالة')
}

console.log('\n✅ منظومة العملات §93: كل الفحوص ناجحة')
