#!/usr/bin/env node
/**
 * بوابة فحص السنة المالية بمقاييس البرامج العالمية (v1.0.17) — تدقيق المالك:
 * «افحص بدقة فتح وإغلاق السنة وترحيل الأرصدة وراجع البرامج العالمية للفجوات».
 *
 * مرجع المقارنة (QuickBooks/Xero/Odoo/SAP):
 * • Closing entries: تصفير 4xxx/5xxx إلى أرباح مرحّلة — موجود (buildYearClosingLines).
 * • Closing date lock: لا قيود بأثر رجعي بفترة مقفلة — موجود (ledgerGuard + postManualEntry).
 * • الأرصدة تراكمية (لا قيود افتتاحية للميزانية) — نمط QuickBooks.
 * • Reopen books (الفجوة التي سدّتها هذه الجولة): إعادة فتح سنة مقفلة تعكس قيد
 *   الإقفال وتفتح الفترة للتصحيح — بالترتيب العكسي فقط (نمط Odoo).
 * • عدم تضاعف الأداء بعد (إقفال → إعادة فتح → إقفال جديد): قوائم الدخل والميزانية
 *   وتقرير السنة تستثني آلية الإقفال كاملة (قيودها وعواكسها) — إصلاح هذه الجولة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_year_close_worldclass_v117.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const { useAppStore } = await import(pathToFileURL(join(root, 'src/stores/app.store.ts')).href)
const { buildFiscalYearReport, closingMechanismIds } = await import(pathToFileURL(join(root, 'src/core/fiscal.ts')).href)
const { incomeStatement, balanceSheet } = await import(pathToFileURL(join(root, 'src/core/financialReports.ts')).href)

const st = () => useDataStore.getState()
const app = () => useAppStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }

const Y24 = { from: '2024-01-01', to: '2024-12-31' }
const Y25 = { from: '2025-01-01', to: '2025-12-31' }

console.log('بوابة السنة المالية بمقاييس عالمية (v1.0.17):')

console.log('═══ ① التجهيز: سنتان منتهيتان + حركة حقيقية ═══')
{
  app().addFiscalYear({ nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31' })
  app().addFiscalYear({ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31' })
  assert.equal(app().fiscalYears.length, 2)
  st().postManualEntry({ date: '2024-01-05', description: 'رأس مال نقدي', lines: [
    { accountCode: '1101', debit: 1_000_000, credit: 0, note: '' },
    { accountCode: '3101', debit: 0, credit: 1_000_000, note: '' },
  ] })
  st().postManualEntry({ date: '2024-03-01', description: 'إيراد 2024', lines: [
    { accountCode: '1101', debit: 200_000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 200_000, note: '' },
  ] })
  st().postManualEntry({ date: '2025-02-01', description: 'إيراد 2025', lines: [
    { accountCode: '1101', debit: 500_000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 500_000, note: '' },
  ] })
  st().postManualEntry({ date: '2025-03-01', description: 'مصروف 2025', lines: [
    { accountCode: '5101', debit: 200_000, credit: 0, note: '' },
    { accountCode: '1101', debit: 0, credit: 200_000, note: '' },
  ] })
  ok('سنتان (2024/2025) ورأس مال وإيرادا سنتين ومصروف — 4 قيود مرحّلة')
}

const fy = (name) => app().fiscalYears.find((y) => y.nameAr === name)

console.log('═══ ② الإقفال المتسلسل: 2024 ثم 2025 (نمط Closing Entries العالمي) ═══')
{
  assert.throws(() => st().closeFiscalYear(fy('2025'), app().fiscalYears), /الترتيب/, 'لا يُقفل الأحدث قبل الأقدم')
  const r24 = st().closeFiscalYear(fy('2024'), app().fiscalYears)
  assert.equal(r24.netProfitMinor, 200_000, 'صافي 2024')
  app().markFiscalYearClosed(fy('2024').id)
  const closing24 = st().journal.find((e) => e.sourceType === 'year_closing' && e.sourceId === fy('2024').id)
  assert.equal(closing24.date, '2024-12-31', 'قيد الإقفال بآخر يوم بالسنة')
  const d = closing24.lines.reduce((a, l) => a + l.debit, 0)
  const c = closing24.lines.reduce((a, l) => a + l.credit, 0)
  assert.equal(d, c, 'قيد الإقفال متوازن بنائياً')
  ok('إقفال 2024: صافي 200,000 بقيد متوازن بتاريخ آخر يوم')

  const r25 = st().closeFiscalYear(fy('2025'), app().fiscalYears)
  assert.equal(r25.netProfitMinor, 300_000, 'صافي 2025')
  app().markFiscalYearClosed(fy('2025').id)
  const bs = balanceSheet(st().journal, '2025-12-31')
  assert.equal(bs.balanced, true, 'الميزانية متزنة بعد الإقفالين')
  const re = bs.equity.find((r) => r.code === '3102')
  assert.equal(re.amountMinor, 500_000, 'الأرباح المرحلة تحمل صافي السنتين')
  ok('إقفال 2025: صافي 300,000 والأرباح المرحلة 500,000 والميزانية متزنة')
}

console.log('═══ ③ حصانة الفترات المقفلة (Closing date lock) ═══')
{
  assert.throws(() => st().postManualEntry({ date: '2025-06-01', description: 'أثر رجعي ممنوع', lines: [
    { accountCode: '1101', debit: 1_000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 1_000, note: '' },
  ] }), /مقفلة/, 'قيد بتاريخ 2025 يجب أن يُرفض')
  assert.throws(() => st().closeFiscalYear(fy('2025'), app().fiscalYears), /بالفعل/, 'لا إقفال مزدوج')
  ok('القيد بأثر رجعي مرفوض والإقفال المزدوج مرفوض')
}

console.log('═══ ④ إعادة الفتح بالترتيب العكسي (نمط Odoo — الفجوة المسدودة) ═══')
{
  assert.throws(() => st().reopenFiscalYear(fy('2024'), app().fiscalYears), /أولاً/, 'لا إعادة فتح 2024 و2025 مقفلة أحدث')
  ok('رفض إعادة فتح 2024 قبل 2025 (الترتيب العكسي محكوم)')
  const r = st().reopenFiscalYear(fy('2025'), app().fiscalYears)
  assert.ok(r.reversedEntryId, 'قيد عاكس أُنشئ')
  const reversal = st().journal.find((e) => e.id === r.reversedEntryId)
  const closing25 = st().journal.find((e) => e.sourceType === 'year_closing' && e.sourceId === fy('2025').id)
  assert.equal(reversal.reversesEntryId, closing25.id, 'العاكس يشير لقيد الإقفال')
  assert.equal(closing25.reversedByEntryId, reversal.id, 'قيد الإقفال موسوم معكوساً')
  for (const l of reversal.lines) {
    const orig = closing25.lines.find((x) => x.accountCode === l.accountCode)
    assert.equal(l.debit, orig.credit, `عكس السطر ${l.accountCode} مدين`)
    assert.equal(l.credit, orig.debit, `عكس السطر ${l.accountCode} دائن`)
  }
  assert.equal(fy('2025').status, 'open', 'السنة عادت مفتوحة')
  ok('إعادة فتح 2025: عكس كامل بالمرايا + الحالة مفتوحة')
}

console.log('═══ ⑤ لا تضاعف بعد إعادة الفتح (إصلاح آلية العرض — الفجوة الخفية) ═══')
{
  const inc = incomeStatement(st().journal, Y25)
  assert.equal(inc.netProfitMinor, 300_000, `قائمة دخل 2025 = الأداء الحقيقي (وجدها ${inc.netProfitMinor})`)
  const bs = balanceSheet(st().journal, '2025-12-31')
  assert.equal(bs.balanced, true, 'الميزانية متزنة والسنة مفتوحة')
  const re = bs.equity.find((r) => r.code === '3102')
  assert.equal(re.amountMinor, 200_000, '3102 تحمل إقفال 2024 فقط — عكس 2025 ألغاه')
  ok('قائمة الدخل 300,000 (لا 600,000) و3102 = 200,000 (لا 500,000) — لا تضاعف')
}

console.log('═══ ⑥ التصحيح داخل الفترة المعاد فتحها ثم الإقفال الجديد ═══')
{
  st().postManualEntry({ date: '2025-07-01', description: 'إيراد إضافي اكتُشف متأخراً', lines: [
    { accountCode: '1101', debit: 50_000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 50_000, note: '' },
  ] })
  ok('قيد التصحيح بتاريخ 2025 مرّ — الفترة مفتوحة')
  const r = st().closeFiscalYear(fy('2025'), app().fiscalYears)
  assert.equal(r.netProfitMinor, 350_000, `الإقفال الثاني بالصافي المصحح 350,000 (وجده ${r.netProfitMinor})`)
  app().markFiscalYearClosed(fy('2025').id)
  const closings25 = st().journal.filter((e) => e.sourceType === 'year_closing' && e.sourceId === fy('2025').id)
  assert.equal(closings25.length, 2, 'قيدا إقفال للسنة (الأصلي + الجديد) — الشفافية الكاملة بالدفتر')
  ok('إقفال جديد نجا بعد التصحيح: صافي 350,000 وليس 650,000 — لا تصفير مزدوج')
}

console.log('═══ ⑦ الأداء الحقيقي محفوظ للأبد + الختام المتزن ═══')
{
  assert.equal(incomeStatement(st().journal, Y25).netProfitMinor, 350_000, 'دخل 2025 المصحح')
  assert.equal(incomeStatement(st().journal, Y24).netProfitMinor, 200_000, 'دخل 2024 لم يتأثر')
  const bs = balanceSheet(st().journal, '2025-12-31')
  assert.equal(bs.balanced, true, 'الميزانية النهائية متزنة')
  const re = bs.equity.find((r) => r.code === '3102')
  assert.equal(re.amountMinor, 550_000, '3102 = 200,000 + 350,000')
  ok('قوائم الدخل التاريخية صحيحة والميزانية متزنة و3102 = 550,000')
}

console.log('═══ ⑧ تقرير السنة المالية يستثني الآلية كاملة (قيود الإقفال وعواكسها) ═══')
{
  const closingIds = st().journal.filter((e) => e.sourceType === 'year_closing' && e.sourceId === fy('2025').id).map((e) => e.id)
  const rep = buildFiscalYearReport(st().journal, fy('2025'), closingIds)
  assert.equal(rep.netProfitMinor, 350_000, `ملخص تقرير 2025 بالصافي المصحح (وجده ${rep.netProfitMinor})`)
  const mech = closingMechanismIds(st().journal)
  assert.equal(mech.size, 4, 'آلية الإقفال: قيدا إقفال 2025 + عكسه + قيد إقفال 2024 = 4')
  const revRow = rep.rows.find((r) => r.accountCode === '4101')
  assert.equal(revRow?.movementMinor ?? 0, 0, 'حركة حساب الإيراد مصفّرة بالختام — الترحيل سليم')
  ok('تقرير السنة: صافي 350,000 وحركة الإيراد مصفّرة بالختام')
}

console.log('═══ ⑨ الحصانة النهائية بعد الإقفال الجديد ═══')
{
  assert.throws(() => st().postManualEntry({ date: '2025-08-01', description: 'أثر رجعي', lines: [
    { accountCode: '1101', debit: 1_000, credit: 0, note: '' },
    { accountCode: '4101', debit: 0, credit: 1_000, note: '' },
  ] }), /مقفلة/)
  assert.throws(() => st().reopenFiscalYear(fy('2024'), app().fiscalYears), /أولاً/, '2025 مقفلة أحدث من 2024')
  ok('الفترة أُقفلت مجدداً ومحصّنة — والترتيب العكسي مستمر')
}

console.log(`\n✅ بوابة السنة المالية العالمية v1.0.17: ${pass} فحصاً ناجحاً — فتح وإغلاق السنة وترحيل الأرصدة وإعادة الفتح بلا تضاعف وبحصانة الفترات`)
