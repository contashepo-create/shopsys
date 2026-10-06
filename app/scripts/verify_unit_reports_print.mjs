/**
 * بوابة مطبوعات تقارير الوحدات (§99 — تصدير PDF/Excel لكل تقارير الوحدات):
 * النواة الخالصة htmlTableHtml/escHtml فوق الغلاف الموحد renderReportShell —
 * كل جدول في مراكز تقارير المقاولات والمعدات والمطعم يُبنى منه مطبوع PDF.
 *
 * يفحص: تهريب قيم المستخدم (لا حقن HTML) · بنية الجدول (رؤوس/صفوف/إجمالي/
 * أعمدة رقمية) · سيناريو رقمي محسوب باليد يمر حرفياً للمطبوع · الغلاف يضم
 * الجدول بترويسته واتجاهه RTL وتذييله · وأن الصفحات الثلاث تستعمل النواة
 * بثلاثة أزرار طباقة لكل منها (تُمسح من المصدر فلا تشيخ).
 *
 * التشغيل: node --experimental-strip-types scripts/verify_unit_reports_print.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escHtml, htmlTableHtml, renderReportShell, DEFAULT_REPORT_PRINT } from '../src/core/reportPrint.ts'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

/* ═══ ① تهريب قيم المستخدم — لا حقن HTML في المطبوعات ═══ */
{
  assert.equal(escHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;', 'الوسوم تُهرَّب')
  assert.equal(escHtml('مقاول "الأمين" & شركاه'), 'مقاول &quot;الأمين&quot; &amp; شركاه'.replaceAll('&quot;', '"'), 'علامات الاقتباس والضم تبقى مقروءة والمضروب يُهرَّب')
  const table = htmlTableHtml({
    headers: ['العميل'],
    rows: [['<b>شركة <script>x</script></b>'], ['عادي']],
  })
  assert.ok(!table.includes('<script>'), 'لا وسم script خام في الجدول')
  assert.ok(table.includes('&lt;b&gt;'), 'قيمة المستخدم ظهرت مهربة لا كوسم')
  ok('escHtml يهرّب وسوم الحقن ويحفظ النص المقروء — الجدول يحمل القيمة مهربة')
}

/* ═══ ② بنية الجدول الموحد: رؤوس/صفوف/إجمالي/أعمدة رقمية ═══ */
{
  const html = htmlTableHtml({
    headers: ['المشروع', 'الإيراد', 'الربح'],
    numCols: [1, 2],
    rows: [['برج النيل', '1,000', '250'], ['فيلا الدلتا', '500', '90']],
    totalRow: ['الإجمالي', '1,500', '340'],
  })
  assert.ok(html.startsWith('<table><thead><tr><th>المشروع</th>'), 'رؤوس thead بالترتيب')
  assert.equal((html.match(/<tr>/g) ?? []).length, 3, 'رأس + صفان = ثلاثة <tr> صريحة (الإجمالي يحمل صنفه)')
  assert.equal((html.match(/<tr class="total">/g) ?? []).length, 1, 'صف الإجمالي واحد')
  assert.ok(html.includes('<tr class="total"><td>الإجمالي</td>'), 'صف الإجمالي مصفوف')
  assert.ok(html.includes('<td class="num">1,000</td>'), 'العمود الرقمي يحمل class="num"')
  assert.ok(!html.includes('<td class="num">برج النيل</td>'), 'عمود النص لا يحمل num')
  const noTotal = htmlTableHtml({ headers: ['أ'], rows: [['ب']] })
  assert.ok(!noTotal.includes('class="total"'), 'بلا totalRow لا صف إجمالي')
  const empty = htmlTableHtml({ headers: ['أ'], rows: [] })
  assert.ok(empty.includes('<thead><tr><th>أ</th></tr></thead><tbody></tbody>'), 'جدول فارغ سليم البنية (تقرير بلا بيانات لا يرمي)')
  ok('البنية: رؤوس → صفوف → إجمالي اختياري → أعمدة رقمية مميزة — والجدول الفارغ لا يكسر المطبوع')
}

/* ═══ ③ سيناريو رقمي محسوب باليد — الأرقام تمر حرفياً للمطبوع ═══ */
{
  /* بطاقة مشروع بالأرقام ذاتها من بوابة المقاولات: عقد مليون + معتمد 100 ألف،
     مستخلصات 700 ألف، تكاليف 300 ألف، ربح 400 ألف، هامش 57.1٪ */
  const card = htmlTableHtml({
    headers: ['البند', 'القيمة'],
    numCols: [1],
    rows: [['قيمة العقد الفعلية', '1,100,000'], ['قيمة الأعمال المستخلصة', '700,000'], ['التكاليف', '300,000'], ['الربح', '400,000'], ['الهامش ٪', '57.1٪']],
    totalRow: ['الربح', '400,000'],
  })
  for (const needle of ['1,100,000', '700,000', '300,000', '400,000', '57.1٪']) assert.ok(card.includes(needle), `الرقم ${needle} حرفياً في المطبوع`)
  ok('السيناريو المحسوب باليد (عقد 1.1م/مستخلصات 700أ/تكاليف 300أ/ربح 400أ/هامش 57.1٪) يظهر حرفياً')
}

/* ═══ ④ الغلاف الموحد يضم جدول الوحدة بترويسته وRTL وتذييله ═══ */
{
  const body = htmlTableHtml({ headers: ['المعدة', 'الإيراد'], numCols: [1], rows: [['حفار كاتربيلر', '12,000']], totalRow: ['الإجمالي', '12,000'] })
  const doc = renderReportShell({
    title: 'لوحة أسطول المعدات',
    subtitle: 'كل المعدات — <تجربة> تهريب',
    companyName: 'مؤسسة الفهد',
    bodyHtml: body,
    settings: { ...DEFAULT_REPORT_PRINT, showCompanyName: true, showPrintedAt: true },
  })
  assert.ok(doc.startsWith('<!doctype html><html dir="rtl"'), 'مستند RTL')
  assert.ok(doc.includes('<title>لوحة أسطول المعدات</title>'), 'العنوان في رأس المستند')
  assert.ok(doc.includes('مؤسسة الفهد'), 'اسم المنشأة بالترويسة')
  assert.ok(doc.includes('&lt;تجربة&gt;'), 'العنوان الفرعي من قيمة مستخدم يُهرَّب في الغلاف أيضاً')
  assert.ok(doc.includes('حفار كاتربيلر'), 'جسم الوحدة داخل الغلاف')
  assert.ok(doc.includes('TAHAKAM'), 'تذييل النظام')
  assert.ok(doc.includes('@page'), 'إعدادات الورق للطباعة/PDF')
  ok('renderReportShell: RTL + ترويسة المنشأة + تهريب العنوان الفرعي + الجسم + تذييل + @page')
}

/* ═══ ⑤ الصفحات الثلاث تستعمل النواة — 9 مطبوعات، لا تشيخ ═══ */
{
  const pages = [
    ['ContractingReportsPage.tsx', ['projects', 'project-card', 'dues'], 'لوحة مشاريع المقاولات'],
    ['EquipmentReportsPage.tsx', ['fleet', 'equipment-card', 'dues'], 'لوحة أسطول المعدات'],
    ['RestaurantReportsPage.tsx', ['dishes', 'orders', 'production'], 'أطباق المطعم وهوامشها'],
  ]
  for (const [file, buttons, title] of pages) {
    const src = readFileSync(join(here, '..', 'src', 'ui', 'pages', file), 'utf8')
    assert.ok(src.includes("from '../../core/reportPrint.ts'"), `${file} يستورد نواة المطبوعات`)
    assert.ok(src.includes("from '../print/printReceipt.ts'"), `${file} يستورد printHtml`)
    for (const btn of buttons) assert.ok(src.includes(`data-print="${btn}"`), `${file} فيه زر data-print="${btn}"`)
    assert.ok(src.includes(`'${title}'`), `${file} يبني مطبوعة «${title}»`)
    assert.ok((src.match(/طباعة \/ PDF/g) ?? []).length >= buttons.length, `${file} كل أزراره عربية`)
    assert.ok(!src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/(?<![\w.])prompt\s*\(/), `${file} بلا نوافذ أصلية`)
  }
  ok('الصفحات الثلاث × 3 أزرار طباعة عربية = 9 مطبوعات من النواة الموحدة، وبلا prompt أصلية')
}

console.log(`\n✅ مطبوعات تقارير الوحدات (PDF لكل جدول): ${pass} فحوصاً ناجحة`)
