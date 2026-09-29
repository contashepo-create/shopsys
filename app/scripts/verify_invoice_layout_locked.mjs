/* بوابة تثبيت تقسيم الفاتورة — قرار المالك: «لا تغيّر تقسيم الفاتورة فهي ممتازة».
   هذه البوابة تُفشل أي تعديل يعيد ترتيب مناطق المستند أو يحذف إحدى لوحاته
   أو يغيّر شبكة الحقول أو عدد سطور الجدول. التحسينات مسموحة **داخل** كل منطقة
   فقط، أما الهيكل فمقفل. */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('تثبيت تقسيم الفاتورة (قرار المالك)')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const css = read('index.css')

/* ① الهيكل العام: ترويسة المستند ⇐ شبكة الجسم (عمود البنود ثم اللوحات) */
{
  for (const [name, src] of [['المبيعات', sales], ['المشتريات', purchase]]) {
    assert.ok(/<div className="invoice-body-grid">/.test(src), `شبكة جسم الفاتورة مفقودة في صفحة ${name}`)
    assert.ok(/<div className="invoice-lines-column">/.test(src), `عمود البنود مفقود في صفحة ${name}`)
    const grid = src.indexOf('invoice-body-grid')
    const lines = src.indexOf('invoice-lines-column')
    assert.ok(grid > -1 && lines > grid, `ترتيب المناطق تغيّر في صفحة ${name}: البنود يجب أن تلي شبكة الجسم`)
  }
  assert.ok(/\.invoice-doc \.invoice-body-grid \{ grid-template-rows: minmax\(var\(--doc-lines-min\), auto\) minmax\(min-content, 1fr\); \}/.test(css),
    'صفّا شبكة الجسم (البنود ثم اللوحات) تغيّرا')
  R.ok('الهيكل: ترويسة ⇐ عمود البنود ⇐ صف اللوحات — كما أقرّه المالك')
}

/* ② اللوحات الثلاث بترتيبها: الملاحظات ⇐ التحصيل ⇐ الإجماليات */
{
  const notes = sales.indexOf('<b>الملاحظات وشروط التعامل</b>')
  const collect = sales.indexOf('<b>التحصيل الآن</b>')
  const totals = sales.indexOf('<b>إجمالي الفاتورة</b>')
  assert.ok(notes > -1, 'لوحة «الملاحظات وشروط التعامل» محذوفة')
  assert.ok(collect > notes, 'لوحة «التحصيل الآن» مفقودة أو سبقت لوحة الملاحظات')
  assert.ok(totals > collect, 'لوحة «إجمالي الفاتورة» مفقودة أو سبقت لوحة التحصيل')
  assert.ok(/صافي إجمالي الفاتورة/.test(sales), 'سطر «صافي إجمالي الفاتورة» محذوف من لوحة الإجماليات')
  R.ok('اللوحات الثلاث وترتيبها ثابت: الملاحظات ⇐ التحصيل ⇐ الإجماليات')
}

/* ③ شبكة حقول الترويسة ونِسَبها */
{
  assert.ok(/\.invoice-doc-fields \{ display: grid; grid-template-columns: 1\.95fr \.82fr \.82fr 1\.02fr \.92fr \.95fr;/.test(css),
    'نِسَب أعمدة حقول الترويسة تغيّرت')
  assert.ok(/\.invoice-doc-fields:has\(> :nth-child\(7\)\) \{ grid-template-columns: 2fr \.8fr \.8fr 1fr \.9fr \.92fr 1\.05fr; \}/.test(css),
    'شبكة الترويسة ذات السبعة حقول تغيّرت')
  assert.ok(/\.invoice-doc-side \{ display: grid;/.test(css), 'بطاقة الطرف الجانبية أزيلت من تخطيط الترويسة')
  R.ok('شبكة حقول الترويسة وبطاقة الطرف كما هي')
}

/* ④ جدول البنود: خمسة سطور وأرضية ثلاثة */
{
  assert.ok(/--doc-rows: 5;/.test(css), 'عدد سطور جدول البنود المعروضة تغيّر عن خمسة')
  assert.ok(/--doc-min-rows: 3;/.test(css), 'أرضية سطور البنود تغيّرت')
  assert.ok(/--doc-lines-min: calc\(var\(--doc-min-rows\) \* var\(--doc-row-h\) \+ var\(--doc-head-h\) \+ 2\.4rem\)/.test(css),
    'معادلة أدنى ارتفاع لعمود البنود تغيّرت')
  R.ok('جدول البنود: خمسة سطور معروضة وأرضية ثلاثة سطور')
}

/* ⑤ أزرار المستند في الترويسة فقط — لا تكرار أسفل الفاتورة (قرار المالك) */
{
  const bottomPost = /invoice-doc-footer[\s\S]{0,600}(حفظ وترحيل|ترحيل الفاتورة)/.test(sales)
  assert.ok(!bottomPost, 'عاد زر الترحيل المكرَّر أسفل الفاتورة — المالك طلب زر الأعلى فقط')
  R.ok('لا تكرار لزر الترحيل/التحصيل أسفل المستند')
}
R.done()
