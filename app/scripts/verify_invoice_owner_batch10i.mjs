/**
 * بوابة دفعة المالك ⑩ي على الفاتورة — الحزمة (أ): الجدول والتخطيط.
 *
 * البنود المحروسة هنا (بترقيم المالك):
 *  ① لا «تقسيمات»: مربعات الإدخال في السطور المملوءة بلا إطار ولا خلفية.
 *  ② كل بيانات الخلايا في المنتصف — لا يمين ولا يسار (يشمل اسم الصنف).
 *  ③ عمود الضريبة في الربحية والمتقدمة فقط، ومع تفعيل الضريبة.
 *  ④ ممنوع اختفاء أي جزء أسفل لوحات الإجمالي/التحصيل/الملاحظات.
 *  ⑤ بطاقة الطرف تطول بطول العمود المجاور بما فيه سطر الفئة.
 *  ⑥ لا سطر فرعي أسفل اسم الصنف — الاسم وحده.
 *  ⑨ الكمية فوق المتاح ⇒ تظليل أحمر فاتح.
 *  ⑩ السعر تحت الهامش ⇒ برتقالي، وتحت التكلفة ⇒ أحمر.
 *  ⑪ خلية الاسم خالية تماماً: بلا نص إرشادي وبلا أيقونة بحث.
 *  ⑫ نقرة واحدة لا تفتح البحث — نقرتان أو الكتابة أو Enter.
 *  ⑬ سلسلة Enter: صنف ⇒ كمية ⇒ سعر ⇒ السطر التالي ينتظر الكتابة.
 *  ⑭ الأسهم للتنقل بين الخلايا فقط.
 *  ⑮ الفاتورة نافذة حرة: مسار «فاتورة جديدة» يفتح نافذة لا صفحة مدمجة.
 *  ⑯ أزرار المصاريف ظاهرة داخل بوكس الشروط.
 *  ⑰ حذف زرَّي «تحصيل المبلغ كاملاً» و«بيع آجل بلا تحصيل».
 *  ⑧ خصم لكل فئة أصناف داخل نفس قائمة الأسعار (لنفس العميل).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { reporter } from './auditKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(`${ROOT}/${path}`, 'utf8')
const table = read('src/ui/components/InvoiceLinesTable.tsx')
const pickers = read('src/ui/components/KeyboardPickers.tsx')
const css = read('src/index.css')
const store = read('src/stores/app.store.ts')
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const route = read('src/ui/pages/InvoiceDocumentRoute.tsx')
const priceCore = read('src/core/priceLists.ts')
const priceListsPage = read('src/ui/pages/PriceListsPage.tsx')
const repo = read('src/data/repo.ts')
const R = reporter('دفعة المالك ⑩ي على الفاتورة — الجدول والتخطيط')

/* ① لا تقسيمات داخل السطور: الإطار يظهر عند التركيز فقط */
{
  const flat = css.match(/\.invoice-doc \.invoice-lines-table tbody td input:not\(\[type="checkbox"\]\),[\s\S]{0,320}?\}/)?.[0] ?? ''
  assert.ok(/border-color: transparent !important/.test(flat) && /background: transparent !important/.test(flat),
    'مربعات الإدخال في الجدول ما زالت مؤطَّرة (تقسيمات)')
  assert.ok(/\.invoice-doc \.invoice-lines-table tbody td input:not\(\[type="checkbox"\]\):focus/.test(css),
    'لا إطار عند التركيز — لن يعرف المستخدم موضع الكتابة')
  R.ok('① بلا تقسيمات: الإدخال بلا إطار ولا خلفية، والإطار عند التركيز فقط')
}

/* ② توسيط كل بيانات الجدول */
{
  assert.ok(/\.invoice-doc \.invoice-lines-table tbody td,\s*\n\.invoice-doc \.invoice-lines-table thead th \{ text-align: center; \}/.test(css),
    'خلايا الجدول (رأساً وجسماً) غير موسَّطة')
  assert.ok(/\.money-cell \{[^}]*text-align: center/.test(css) && /\.invoice-table-total \{[^}]*text-align: center/.test(css),
    'المبالغ ما زالت محاذاة لليسار')
  const col = table.slice(table.indexOf('const COL = {'), table.indexOf('} as const'))
  assert.ok(/name:\s*'[^']*text-center/.test(col) && !/text-start/.test(col), 'عمود اسم الصنف غير موسَّط')
  R.ok('② كل بيانات الجدول في منتصف الخلية — بما فيها اسم الصنف')
}

/* ③ عمود الضريبة: ربحية/متقدمة + ضريبة مفعَّلة */
{
  assert.ok(/const showTaxColumn = columns\.tax && taxEnabled && \(mode === 'profit' \|\| mode === 'advanced'\)/.test(table),
    'شرط إظهار عمود الضريبة غير مطبَّق')
  assert.ok(!/\{columns\.tax &&/.test(table), 'ما زال هناك استخدام مباشر لـ columns.tax بلا شرط النمط')
  R.ok('③ عمود الضريبة يظهر في الربحية والمتقدمة فقط ومع تفعيل الضريبة')
}

/* ④ لا اختفاء أسفل اللوحات الثلاث */
{
  const grid = css.match(/\.invoice-pos-document \.invoice-body-grid \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/grid-template-rows: minmax\(0, auto\) minmax\(min-content, 1fr\)/.test(grid), 'صف اللوحات لا يتمدد لمحتواه')
  const panel = css.match(/\.invoice-pos-document \.invoice-doc-panel \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/min-height: min-content/.test(panel) && /max-height: none/.test(panel) && /overflow: visible/.test(panel),
    'اللوحة تُقصّ بدل أن تأخذ ارتفاع محتواها')
  const body = css.match(/\.invoice-pos-document \.invoice-doc-panel-body \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/overflow: visible/.test(body), 'جسم اللوحة يُمرَّر داخلياً فيختفي أسفله')
  R.ok('④ اللوحات الثلاث تُظهر محتواها كاملاً على كل مقاس')
}

/* ⑤ بطاقة الطرف بطول العمود المجاور */
{
  const side = css.match(/\.invoice-doc \.invoice-doc-side \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/align-content: stretch/.test(side), 'بطاقة الطرف ما زالت أقصر من الصف المجاور')
  assert.ok(/\.invoice-doc \.invoice-doc-side > \* \{ min-height: 100%; \}/.test(css), 'بطاقة الطرف لا تملأ ارتفاع عمودها')
  R.ok('⑤ بطاقة الطرف بطول عمود الحقول بما فيه سطر الفئة')
}

/* ⑥ لا سطر فرعي أسفل الاسم */
{
  assert.ok(!/invoice-doc-linesub/.test(table), 'عاد السطر الفرعي أسفل اسم الصنف')
  assert.ok(!/details: boolean/.test(store) && !/details: true/.test(store), 'ما زال تفضيل «تفاصيل الصنف أسفل الاسم» موجوداً')
  assert.ok(!/belowCostNotice/.test(table) && !/belowCostNotice/.test(sales), 'ما زال تنبيه «أقل من التكلفة» نصاً داخل خلية الاسم')
  R.ok('⑥ خلية الاسم تحمل اسم الصنف وحده')
}

/* ⑨⑩ تلوين الكمية والسعر داخل الخلية */
{
  assert.ok(/const stockShort = kind === 'sale' && !item\?\.isService && line\.qty > \(item\?\.stockQty \?\? 0\)/.test(table),
    'لا كشف لتجاوز الكمية المتاحة')
  assert.ok(/is-loss/.test(table) && /is-thin/.test(table) && /is-shortstock/.test(table), 'أصناف التلوين غير مربوطة بالخلايا')
  for (const cls of ['is-shortstock', 'is-thin', 'is-loss']) {
    assert.ok(new RegExp(`\\.invoice-doc \\.invoice-lines-table tbody tr td\\.${cls} \\{[^}]*background`).test(css), `لون ${cls} غير معرَّف`)
  }
  R.ok('⑨⑩ الكمية فوق المتاح حمراء، والسعر تحت الهامش برتقالي وتحت التكلفة أحمر')
}

/* ⑪⑫⑭ خلية الاسم: خالية · نقرتان · الأسهم للتنقل */
{
  const input = pickers.match(/<input ref=\{\(node\) => \{ inputRef\.current = node; setExternalRef\(node\) \}\}[^/]*\/>/)?.[0] ?? ''
  assert.ok(/placeholder=""/.test(input), 'خلية اسم الصنف ما زالت تحمل نصاً إرشادياً')
  assert.ok(/onDoubleClick=\{\(\) => \{ if \(!open\) openSearch\(\) \}\}/.test(input), 'النقر المزدوج لا يفتح البحث')
  assert.ok(!/{!open && <Search/.test(pickers), 'أيقونة البحث عادت داخل خلية الاسم')
  assert.ok(/else openSearch\(event\.target\.value\)/.test(input), 'الكتابة المباشرة لا تفتح البحث بأول حرف')
  const keys = pickers.slice(pickers.indexOf('const handleKeyDown'), pickers.indexOf('return <div ref={pickerRef}'))
  assert.ok(/if \(!open\) return/.test(keys), 'الأسهم ما زالت تفتح قائمة الأصناف بدل التنقل بين الخلايا')
  R.ok('⑪⑫⑭ خلية الاسم خالية، تفتح بنقرتين أو بالكتابة أو Enter، والأسهم للتنقل فقط')
}

/* ⑬ سلسلة Enter داخل السطر */
{
  assert.ok(/const priceCell = event\.currentTarget\.closest\('tr'\)\?\.querySelector<HTMLInputElement>\('\.price-cell input'\)/.test(table),
    'Enter من الكمية لا ينتقل إلى السعر')
  const priceEnter = table.slice(table.indexOf("const nextQty = nextRow?.querySelector"))
  assert.ok(/invoice-line-entry-cell input/.test(priceEnter) && !/shopsys:open-item'\)\) \}\}\/><\/td>/.test(priceEnter),
    'Enter من السعر لا ينزل للسطر التالي منتظراً الكتابة (أو ما زال يفتح البحث تلقائياً)')
  R.ok('⑬ سلسلة الإدخال: صنف ⇒ كمية ⇒ سعر ⇒ السطر التالي ينتظر الكتابة')
}

/* ⑯ أزرار المصاريف داخل بوكس الشروط */
{
  for (const [label, src] of [['البيع', sales], ['الشراء', purchase]]) {
    const terms = src.slice(src.indexOf('data-invoice-terms'), src.indexOf('invoice-doc-panel-foot'))
    assert.ok(/invoice-doc-addons/.test(terms), `${label}: أزرار المصاريف ليست داخل بوكس الشروط`)
  }
  R.ok('⑯ أزرار المصاريف داخل بوكس الشروط أسفل مربع الملاحظات')
}

/* ⑰ حذف زرَّي الملء السريع */
{
  assert.ok(!sales.includes('تحصيل المبلغ كاملاً') && !sales.includes('بيع آجل بلا تحصيل'), 'عاد زرّا التحصيل السريع')
  assert.ok(!purchase.includes('سداد المستحق كاملاً') && !purchase.includes('شراء آجل بلا سداد'), 'عاد زرّا السداد السريع')
  R.ok('⑰ لوحة التحصيل/السداد بلا أزرار الملء غير العملية')
}

/* ⑮ الفاتورة نافذة حرة لا صفحة مدمجة */
{
  assert.ok(/openSalesInvoiceWindow\(editId\)/.test(route) && /openPurchaseInvoiceWindow\(editId\)/.test(route),
    'مسار الفاتورة ما زال يرسم المستند مدمجاً بدل فتح نافذة حرة')
  assert.ok(!/AdvancedSalesInvoicePage/.test(route), 'المسار ما زال يستورد صفحة الفاتورة مباشرة (تضمين لا نافذة)')
  assert.ok(/dedupeKey: editId \? `sales-invoice:\$\{editId\}` : null/.test(read('src/ui/windows/windowStore.ts')),
    'لا يمكن فتح أكثر من فاتورة بيع جديدة في وقت واحد')
  R.ok('⑮ الفاتورة نافذة حرة: تُكبَّر وتُصغَّر وتتعدد بلا فقد النافذة الأم')
}

/* ⑧ خصم لكل فئة داخل قائمة الأسعار */
{
  assert.ok(/export interface PriceListCategoryRule/.test(priceCore), 'لا نموذج لخصم الفئة داخل القائمة')
  assert.ok(/const rule = categoryId == null \? undefined : categoryRules\.find/.test(priceCore),
    'خصم الفئة غير مطبَّق في تسعير الصنف')
  assert.ok(/priceListCategoryRules/.test(repo) && /setPriceListCategoryRule/.test(repo), 'المخزن بلا قواعد خصم الفئات')
  assert.ok(/state\.priceListCategoryRules, item\?\.categoryId \?\? null/.test(repo), 'getEffectivePrice لا يمرر فئة الصنف')
  assert.ok(/data-category-rules/.test(priceListsPage) && /خصم لكل فئة/.test(priceListsPage),
    'صفحة قوائم الأسعار بلا محرر خصم الفئات')
  R.ok('⑧ خصم مستقل لكل فئة أصناف داخل نفس القائمة — الأولوية: صنف ⇐ فئة ⇐ القائمة ⇐ التجزئة')
}

R.done()
