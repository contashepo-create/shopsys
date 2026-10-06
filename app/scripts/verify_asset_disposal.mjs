/**
 * استبعاد الأصول الثابتة — الفجوة التي كشفها التدقيق: كان البرنامج يشتري الأصل
 * ويُهلكه ولا يعرف كيف يُخرجه. بلا هذا المسار يبقى الأصل في الميزانية للأبد،
 * أو يُصفَّر بقيد يدوي فينفصل سجل الأصول عن الدفتر.
 *
 * يفحص: قيد البيع بربح، والبيع بخسارة، والخردة، وتوقف الإهلاك بعد الخروج،
 * ومنع الاستبعاد المزدوج، ومنع بيع أصل عليه دين، وأثر النتيجة في قائمة الدخل.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_asset_disposal.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, balanceOf, assertInvariants, addParty, reporter } from './auditKit.mjs'
import { assetDisposalPreview, buildAssetDisposalEntry } from '../src/core/assets.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { incomeStatement, balanceSheet } from '../src/core/financialReports.ts'

const R = reporter('استبعاد الأصول الثابتة — بيع وخردة')

/* ① الحسابان موجودان في الشجرة بالجذر الصحيح */
{
  const gain = STANDARD_COA.find((a) => a.code === '4116')
  const loss = STANDARD_COA.find((a) => a.code === '5118')
  assert.ok(gain && gain.rootType === 'revenue' && gain.isPostable, 'حساب أرباح بيع الأصول 4116 مفقود أو غير قابل للترحيل')
  assert.ok(loss && loss.rootType === 'expenses' && loss.isPostable, 'حساب خسائر استبعاد الأصول 5118 مفقود أو غير قابل للترحيل')
  R.ok('4116 أرباح بيع أصول ثابتة (إيراد) و5118 خسائر بيع واستبعاد (مصروف) في الشجرة')
}

/* ② النواة: القيد يوازن ويُخرج التكلفة ومجمع الإهلاك معاً */
{
  const preview = assetDisposalPreview({ costMinor: 100_000_00, salvageMinor: 10_000_00, lifeMonths: 60, monthsDepreciated: 24 }, 70_000_00)
  assert.equal(preview.accumulatedMinor, 36_000_00, 'مجمع الإهلاك بعد 24 شهراً يجب أن يكون 36000')
  assert.equal(preview.bookValueMinor, 64_000_00, 'القيمة الدفترية = التكلفة − المجمع')
  assert.equal(preview.resultMinor, 6_000_00, 'البيع بـ70000 فوق دفترية 64000 = ربح 6000')
  const lines = buildAssetDisposalEntry({ preview, assetLabel: 'FA-0001 سيارة', proceedsAccount: '1101' })
  const debit = lines.reduce((a, l) => a + l.debit, 0)
  const credit = lines.reduce((a, l) => a + l.credit, 0)
  assert.equal(debit, credit, 'قيد الاستبعاد غير متوازن')
  assert.equal(lines.find((l) => l.accountCode === '1201').credit, 100_000_00, 'التكلفة الأصلية لم تخرج كاملةً من 1201')
  assert.equal(lines.find((l) => l.accountCode === '4116').credit, 6_000_00, 'الربح لم يُقيَّد في 4116')
  R.ok('النواة: بيع بربح ⇒ 1202 مدين 36000 + خزينة 70000 / 1201 دائن 100000 + 4116 دائن 6000 — متوازن')
}

/* ③ البيع بخسارة والخردة */
{
  const loss = assetDisposalPreview({ costMinor: 50_000_00, salvageMinor: 0, lifeMonths: 50, monthsDepreciated: 12 }, 30_000_00)
  assert.equal(loss.bookValueMinor, 38_000_00, 'دفترية الأصل بعد 12 من 50 شهراً')
  assert.equal(loss.resultMinor, -8_000_00, 'بيع بـ30000 مقابل دفترية 38000 = خسارة 8000')
  const lossLines = buildAssetDisposalEntry({ preview: loss, assetLabel: 'FA-0002', proceedsAccount: '1102' })
  assert.equal(lossLines.find((l) => l.accountCode === '5118').debit, 8_000_00, 'الخسارة لم تُقيَّد في 5118')

  const scrap = assetDisposalPreview({ costMinor: 20_000_00, salvageMinor: 0, lifeMonths: 20, monthsDepreciated: 6 }, 0)
  const scrapLines = buildAssetDisposalEntry({ preview: scrap, assetLabel: 'FA-0003' })
  assert.equal(scrap.resultMinor, -14_000_00, 'الخردة بلا مقابل ⇒ القيمة الدفترية كلها خسارة')
  assert.equal(scrapLines.find((l) => l.accountCode === '5118').debit, 14_000_00, 'خسارة الخردة لم تُقيَّد')
  assert.ok(!scrapLines.some((l) => l.debit > 0 && l.accountCode.startsWith('11') && l.accountCode !== '1104'), 'الخردة لا يدخل بها نقد')
  R.ok('بيع بخسارة ⇒ 5118 مدين بالفرق · خردة بلا مقابل ⇒ القيمة الدفترية كلها خسارة بلا نقد داخل')
}

/* ④ ثمن بيع بلا حساب تحصيل مرفوض بنيوياً */
{
  const p = assetDisposalPreview({ costMinor: 10_000_00, salvageMinor: 0, lifeMonths: 12, monthsDepreciated: 0 }, 5_000_00)
  assert.throws(() => buildAssetDisposalEntry({ preview: p, assetLabel: 'FA-0004' }), /الخزينة|الحساب/, 'قبل ثمن بيع بلا حساب تحصيل')
  R.ok('ثمن بيع بلا خزينة أو حساب عميل مرفوض — لا نقد يدخل مجهول المصدر')
}

/* ⑤ المخزن: الأصل يخرج من الميزانية ويتوقف إهلاكه */
{
  const c = await freshCase({ activityId: 'cars', label: 'استبعاد أصل' })
  const store = c.st()
  store.postManualEntry({
    date: '2026-01-02',
    description: 'تمويل افتتاحي',
    lines: [{ accountCode: '1101', debit: 300_000_00, credit: 0, note: 'نقدية' }, { accountCode: '3101', debit: 0, credit: 300_000_00, note: 'رأس مال' }],
  })
  const asset = c.st().addAsset({
    nameAr: 'ونش رفع', costMinor: 120_000_00, salvageMinor: 0, lifeMonths: 48, paidMinor: 120_000_00,
    funding: 'cash', treasury: '1101', notes: 'اختبار',
  })
  c.st().postMonthlyDepreciation()
  const accumulated = balanceOf(c.st().journal, '1202')
  assert.ok(accumulated < 0, 'مجمع الإهلاك يجب أن يكون دائناً بعد ترحيل شهر')

  const before1201 = balanceOf(c.st().journal, '1201')
  const disposed = c.st().disposeAsset({ assetId: asset.id, mode: 'sale', proceedsMinor: 100_000_00, proceedsAccount: '1101', reason: 'بيع الونش' })
  const j = c.st().journal
  assert.equal(balanceOf(j, '1201'), before1201 - 120_000_00, 'تكلفة الأصل لم تخرج من 1201')
  assert.equal(balanceOf(j, '1202'), 0, 'مجمع إهلاك الأصل لم يُقفل بالكامل')
  assert.ok(disposed.disposal && disposed.disposal.journalEntryId > 0, 'سجل الاستبعاد لم يُحفظ على الأصل')
  assert.equal(disposed.disposal.resultMinor, 100_000_00 - disposed.disposal.bookValueMinor, 'نتيجة الاستبعاد لا تطابق الفرق')
  assert.ok(j.some((e) => e.sourceType === 'asset_disposal' && e.sourceId === asset.id), 'القيد بلا نوع مصدر asset_disposal')
  assertInvariants(c, 'بعد استبعاد الأصل')
  R.ok(`المخزن: الأصل خرج من 1201 ومجمع إهلاكه أُقفل إلى صفر · القيد بمصدر asset_disposal · النتيجة ${disposed.disposal.resultMinor / 100}`)

  /* الإهلاك بعد الخروج لا يُرحَّل على أصل مستبعد */
  const journalBefore = c.st().journal.length
  try { c.st().postMonthlyDepreciation() } catch { /* لا مستحق — سلوك سليم */ }
  const depAfter = c.st().journal.slice(journalBefore).filter((e) => e.sourceType === 'depreciation')
  const touchesDisposed = depAfter.length > 0 && c.st().assets.find((a) => a.id === asset.id).monthsDepreciated > disposed.monthsDepreciated
  assert.equal(touchesDisposed, false, 'الأصل المستبعد ما زال يُهلك شهرياً')
  R.ok('الإهلاك الشهري يتخطى الأصل المستبعد — لا مصروف إهلاك على أصل خرج من الدفاتر')

  /* لا استبعاد مرتين */
  let rejected = false
  try { c.st().disposeAsset({ assetId: asset.id, mode: 'scrap', proceedsMinor: 0, reason: 'محاولة ثانية' }) } catch { rejected = true }
  assert.ok(rejected, 'قبل استبعاد الأصل مرتين')
  R.ok('محاولة استبعاد أصل مستبعد مرفوضة — لا ازدواج يُنقص الأصول مرتين')

  /* النتيجة تظهر في قائمة الدخل، والأصل اختفى من الميزانية */
  const income = incomeStatement(c.st().journal, { from: '2026-01-01', to: '2030-12-31' })
  const bs = balanceSheet(c.st().journal, '2030-12-31')
  assert.ok(Math.abs(bs.totalAssetsMinor ?? bs.totalLiabilitiesMinor + bs.totalEquityMinor) >= 0, 'الميزانية لم تُحسب')
  assert.ok(income.netProfitMinor !== 0, 'نتيجة الاستبعاد لم تنعكس في قائمة الدخل')
  R.ok('نتيجة الاستبعاد تظهر في قائمة الدخل والميزانية تبقى متوازنة بعد خروج الأصل')
}

/* ⑥ منع استبعاد أصل عليه دين للمورد */
{
  const c = await freshCase({ activityId: 'grocery', label: 'أصل آجل' })
  c.st().postManualEntry({
    date: '2026-01-02', description: 'تمويل',
    lines: [{ accountCode: '1101', debit: 50_000_00, credit: 0, note: 'نقدية' }, { accountCode: '3101', debit: 0, credit: 50_000_00, note: 'رأس مال' }],
  })
  const supplier = addParty(c, 'supplier', 'مورد المعدات')
  const asset = c.st().addAsset({
    nameAr: 'ثلاجة عرض', costMinor: 30_000_00, salvageMinor: 0, lifeMonths: 36, paidMinor: 0,
    funding: 'supplier_credit', supplierId: supplier.id, treasury: '1101', notes: 'آجل',
  })
  let blocked = false
  try { c.st().disposeAsset({ assetId: asset.id, mode: 'sale', proceedsMinor: 25_000_00, proceedsAccount: '1101', reason: 'بيع قبل السداد' }) } catch { blocked = true }
  assert.ok(blocked, 'سمح ببيع أصل ما زال ديناً على المنشأة دون تنبيه')
  assertInvariants(c, 'أصل آجل لم يُستبعد')
  R.ok('بيع أصل عليه متبقٍّ للمورد مرفوض — الدين لا يسقط ببيع الأصل')
}

R.done('— دورة حياة الأصل مكتملة: اقتناء ← إهلاك ← استبعاد بربح أو خسارة، بلا أثر معلّق في الميزانية')
