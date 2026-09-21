#!/usr/bin/env node
/**
 * verify_barcode_fiscal — فحص باركود الميزان + السنوات المالية + تطبيع الأرقام العربية
 * node --experimental-strip-types scripts/verify_barcode_fiscal.mjs
 */
import { strict as assert } from 'node:assert'
import { parseScaleBarcode, buildScaleBarcode, matchScaleItem } from '../src/core/barcode.ts'
import { suggestFiscalYear, validateFiscalYear, dateInOpenYear, buildFiscalYearReport } from '../src/core/fiscal.ts'
import { toMinor, normalizeDigits } from '../src/core/money.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 فحص باركود الميزان (طلب المالك: بائع الأجبان)')

ok('تفسير 220004200750: الصنف 42 بوزن 0.750 كجم', () => {
  const r = parseScaleBarcode('220004200750')
  assert.equal(r.itemCode, '42')
  assert.equal(r.weightKg, 0.75)
})

ok('يقبل خانة تحقق EAN-13 (13 خانة)', () => {
  const r = parseScaleBarcode('2200042007509')
  assert.equal(r.itemCode, '42')
  assert.equal(r.weightKg, 0.75)
})

ok('يرفض باركوداً عادياً (ليس ميزاناً)', () => {
  assert.equal(parseScaleBarcode('6221001'), null) // قصير
  assert.equal(parseScaleBarcode('130004200750'), null) // بادئة غير 22
  assert.equal(parseScaleBarcode('ABC004200750'), null) // ليس أرقاماً
})

ok('يرفض وزناً صفرياً', () => {
  assert.equal(parseScaleBarcode('220004200000'), null)
})

ok('توليد باركود: الصنف 42 بوزن 1.250 كجم', () => {
  assert.equal(buildScaleBarcode(42, 1.25), '220004201250')
})

ok('دورة كاملة: توليد ← تفسير ← نفس القيم', () => {
  for (const [code, kg] of [[1, 0.005], [999, 2.345], [42, 0.75], [12345, 9.999]]) {
    const bc = buildScaleBarcode(code, kg)
    const r = parseScaleBarcode(bc)
    assert.equal(r.itemCode, String(code))
    assert.equal(r.weightKg, kg)
  }
})

const cheese = { id: 7, sku: 'ITM-1042', barcodes: ['42'], soldByWeight: true }
const milk = { id: 8, sku: 'ITM-1043', barcodes: ['6221001'], soldByWeight: false }

ok('مطابقة الصنف بالباركود المسجل', () => {
  assert.equal(matchScaleItem('42', [cheese, milk])?.id, 7)
})

ok('مطابقة الصنف برقم الـ SKU (بيع بالوزن فقط)', () => {
  assert.equal(matchScaleItem('1042', [cheese, milk])?.id, 7)
  assert.equal(matchScaleItem('1043', [cheese, milk]), undefined) // اللبن ليس وزنياً
})

console.log('🔍 فحص السنوات المالية (طلب المالك)')

ok('اقتراح سنة ميلادية كاملة', () => {
  const fy = suggestFiscalYear(2026)
  assert.equal(fy.startDate, '2026-01-01')
  assert.equal(fy.endDate, '2026-12-31')
})

ok('قبول سنة سليمة', () => {
  assert.equal(validateFiscalYear({ nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' }, []).length, 0)
})

ok('قبول سنة مالية غير ميلادية (يوليو←يونيو)', () => {
  assert.equal(validateFiscalYear({ nameAr: '2025-2026', startDate: '2025-07-01', endDate: '2026-06-30' }, []).length, 0)
})

ok('رفض نهاية قبل البداية', () => {
  assert.ok(validateFiscalYear({ nameAr: 'x', startDate: '2026-12-31', endDate: '2026-01-01' }, []).length > 0)
})

ok('رفض التداخل مع سنة موجودة', () => {
  const existing = [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }]
  const errs = validateFiscalYear({ nameAr: '2026ب', startDate: '2026-06-01', endDate: '2027-05-31' }, existing)
  assert.ok(errs.some((e) => e.includes('تتداخل')))
})

ok('سياسة «سنة مفتوحة واحدة»: فتح سنة وأخرى مفتوحة يُرفض', () => {
  const existing = [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }]
  const errs = validateFiscalYear({ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31' }, existing)
  assert.ok(errs.some((e) => e.includes('مفتوحة')))
})

ok('سنة سابقة منفصلة تُقبل بعد إقفال المفتوحة', () => {
  const existing = [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }]
  assert.equal(validateFiscalYear({ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31' }, existing).length, 0)
})

ok('تقرير السنة: رصيد أول السنة + الحركة + الختامي وملخص الربح', () => {
  const journal = [
    { id: 1, date: '2025-06-01', lines: [{ accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 1000 }] },
    { id: 2, date: '2026-02-01', lines: [{ accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '4101', debit: 0, credit: 500 }] },
    { id: 3, date: '2026-03-01', lines: [{ accountCode: '5101', debit: 200, credit: 0 }, { accountCode: '1101', debit: 0, credit: 200 }] },
  ]
  const rep = buildFiscalYearReport(journal, { startDate: '2026-01-01', endDate: '2026-12-31' })
  const cash = rep.rows.find((r) => r.accountCode === '1101')
  assert.equal(cash.openingMinor, 1000)
  assert.equal(cash.movementMinor, 300)
  assert.equal(cash.closingMinor, 1300)
  assert.equal(rep.totalRevenueMinor, 500)
  assert.equal(rep.totalExpenseMinor, 200)
  assert.equal(rep.netProfitMinor, 300)
})

ok('تقرير سنة مقفلة: قيد الإقفال مستثنى من ملخص الإيراد/المصروف', () => {
  const journal = [
    { id: 1, date: '2026-02-01', lines: [{ accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '4101', debit: 0, credit: 500 }] },
    { id: 9, date: '2026-12-31', lines: [{ accountCode: '4101', debit: 500, credit: 0 }, { accountCode: '3102', debit: 0, credit: 500 }] },
  ]
  const rep = buildFiscalYearReport(journal, { startDate: '2026-01-01', endDate: '2026-12-31' }, [9])
  assert.equal(rep.totalRevenueMinor, 500) // لم يتصفر بالقيد المستثنى
  // رصيد 4101 الختامي صفر بعد الإقفال ⇒ يُفلتر من الجدول (لا حركة صافية) — هذا مقصود
  const rev = rep.rows.find((r) => r.accountCode === '4101')
  assert.equal(rev, undefined)
})

ok('dateInOpenYear يجد السنة الصحيحة', () => {
  const years = [
    { id: 1, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' },
    { id: 2, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' },
  ]
  assert.equal(dateInOpenYear('2026-09-14', years)?.id, 2)
  assert.equal(dateInOpenYear('2025-05-01', years), null) // مقفلة
})

console.log('🔍 فحص تطبيع الأرقام العربية (سبب خطأ «السعر صفر»)')

ok('«١٣٠» تُقرأ 130 صحيحة', () => {
  assert.equal(toMinor('١٣٠', 2), 13000)
})

ok('«١٢٫٥» بالفاصلة العربية تُقرأ 12.5', () => {
  assert.equal(toMinor('١٢٫٥', 2), 1250)
})

ok('أرقام فارسية ۴۲ تُقرأ 42', () => {
  assert.equal(normalizeDigits('۴۲'), '42')
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
