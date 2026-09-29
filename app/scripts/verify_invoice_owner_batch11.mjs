/**
 * بوابة دفعة المالك ⑪ — النوافذ والتجاوب:
 *  ① لوحة «التحصيل الآن» بلا تداخل ولا انضغاط (طريقتان في السطر + تسميات مختصرة)
 *  ② شريط ترويسة البنود لا يُقصّ ولا يختفي تحت رأس الجدول
 *  ③ الفاتورة نافذة حرة (لا ملتصقة ولا صفحة مدمجة)
 *  ④ إغلاق نافذة ابن لا يغلق نافذة اختيار الصنف الأم
 *  ⑤ «أسعار الصنف» تعرض بيانات فعلية
 *  ⑥ النقر مرتين على صنف في جدول البنود يفتح منتقي الصنف
 *  ⑦ الكمية موسَّطة و«خصم %» لا يتداخل مع «الإجمالي»
 *  ⑧⑨ كل قسم يتكيّف مع المقاس: أرضية للبنود وضغط الارتفاع الشحيح
 *  ⑩ لا يختفي قسم من الشريط العلوي — ما لا يتسع ينتقل إلى «المزيد»
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const css = read('src/index.css')
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const table = read('src/ui/components/InvoiceLinesTable.tsx')
const pickers = read('src/ui/components/KeyboardPickers.tsx')
const store = read('src/ui/windows/windowStore.ts')
const floating = read('src/ui/windows/FloatingWindow.tsx')
const views = read('src/ui/windows/windowViews.tsx')
const menubar = read('src/ui/layout/MenuBar.tsx')
const R = reporter('دفعة المالك ⑪ — النوافذ الحرة والتجاوب الكامل')

/* ① لوحة التحصيل: طريقتان في السطر وتسمية مختصرة وتفصيل في التلميح */
{
  const rows = css.match(/\.invoice-doc \.invoice-doc-payrows \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(rows),
    'صفوف التحصيل المتعدد ما زالت أربعة أسطر تُطيل اللوحة فتنضغط وتتداخل')
  assert.ok(/\.invoice-doc \.invoice-doc-payrows > \*:not\(\.invoice-doc-payrow\) \{ grid-column: 1 \/ -1/.test(css),
    'منتقي الخزينة داخل صفوف التحصيل لا يمتد على العمودين')
  assert.ok(/<label htmlFor="pay-cash" title=\{/.test(sales) && /<small> — \{treasuries\.find/.test(sales),
    'تسمية طريقة التحصيل بلا تلميح يحمل اسم الخزينة الكامل')
  assert.ok(/@media \(max-width: 1500px\) \{ \.invoice-doc \.invoice-doc-payrow label small \{ display: none/.test(css),
    'تفصيل الخزينة لا يُطوى عند ضيق اللوحة فيزاحم خانة المبلغ')
  R.ok('① التحصيل الآن: طريقتان في كل سطر، والتفصيل يظهر عند الاتساع فقط — بلا تداخل')
}

/* ② شريط ترويسة البنود: لا ينضغط ولا يُقصّ */
{
  assert.ok(/\.invoice-doc \.invoice-lines-toolbar \{ flex: 0 0 auto; min-height: max-content/.test(css),
    'شريط «الأصناف والكميات والأسعار» ما زال ينضغط فيُقصّ نصفه تحت رأس الجدول')
  assert.ok(/--doc-min-rows: 3;/.test(css) && /--doc-lines-min: calc\(var\(--doc-min-rows\) \* var\(--doc-row-h\) \+ var\(--doc-head-h\) \+ 2\.4rem\)/.test(css),
    'لا أرضية لارتفاع عمود البنود')
  assert.ok(/\.invoice-doc \.invoice-body-grid \{ grid-template-rows: minmax\(var\(--doc-lines-min\), auto\) minmax\(min-content, 1fr\); \}/.test(css),
    'شبكة جسم المستند لا تحترم أرضية البنود')
  assert.ok(/\.invoice-doc \.invoice-lines-panel \.overflow-x-auto \{ flex: 1 1 auto/.test(css),
    'صندوق السطور لا يتمدد ليملأ المساحة المتاحة')
  R.ok('② شريط البنود كامل دائماً، والجدول يتمدد من ثلاثة سطور إلى خمسة حسب الارتفاع')
}

/* ③ الفاتورة نافذة حرة */
{
  assert.ok(/mode: 'normal'/.test(store) && /function invoiceWindowSize\(\)/.test(store),
    'الفاتورة ما زالت تُفتح ملء الشاشة بدل نافذة حرة')
  for (const [label, fn] of [['المبيعات', 'openSalesInvoiceWindow'], ['المشتريات', 'openPurchaseInvoiceWindow']])
    assert.ok(new RegExp(`export function ${fn}`).test(store), `لا فتّاح نافذة لفاتورة ${label}`)
  assert.ok(/data-invoice-window-route/.test(read('src/ui/pages/InvoiceDocumentRoute.tsx')),
    'مسار الفاتورة لا يفتحها في مضيف النوافذ')
  R.ok('③ الفاتورة نافذة مستقلة: تُكبَّر وتُصغَّر وتتعدد بلا تعتيم للخلفية')
}

/* ④ إغلاق الابن لا يغلق الأم */
{
  assert.ok(/onKeyDown=\{/.test(floating) && /event\.key !== 'Escape'/.test(floating) && /event\.stopPropagation\(\)/.test(floating),
    'Escape داخل النافذة يصعد إلى الأم فيغلقها معها')
  assert.ok(/data-window-autofocus/.test(floating) && /else frame\.focus\(\)/.test(floating),
    'النافذة الجديدة لا تسحب التركيز فيظل المفتاح يصل إلى الأم')
  assert.ok(/requestCloseWindow\(win\.id\)/.test(floating), 'زر/مفتاح الإغلاق لا يغلق النافذة نفسها فقط')
  /* النافذة الابنة كانت تهبط تحت حافة الشاشة على 1024×680 فتختفي أزرار الحفظ */
  assert.ok(/const TASKBAR_H = 38/.test(store) && /vh - TOP_GUARD - TASKBAR_H/.test(store),
    'ارتفاع النافذة لا يُحدّ بمساحة العمل فوق شريط النوافذ')
  assert.ok(/const y = Math\.min\(Math\.max\(TOP_GUARD, rect\.y\), Math\.max\(TOP_GUARD, vh - TASKBAR_H - height\)\)/.test(store),
    'النافذة قد تهبط أسفل الشاشة فتضيع أزرارها')
  R.ok('④ كل نافذة تغلق نفسها فقط — منتقي الصنف يبقى بعد إغلاق «تعديل الصنف» أو «حركة الصنف»')
}

/* ⑤ أسعار الصنف ببيانات */
{
  assert.ok(/data-window-view="item-prices"/.test(views) && /data-item-prices-summary/.test(views),
    'نافذة أسعار الصنف فارغة')
  assert.ok(/resolvePrice\(/.test(views) && /priceSource\(/.test(views), 'جدول قوائم الأسعار لا يحسب السعر الفعلي')
  assert.ok(/openItemPricesWindow/.test(read('src/ui/pages/PurchasesPage.tsx')) && /openItemPricesWindow/.test(read('src/ui/pages/SalesInvoicesPage.tsx')),
    'زر «أسعار الصنف» في صفحات الفواتير ما زال ينقل إلى صفحة قوائم الأسعار')
  R.ok('⑤ «أسعار الصنف» نافذة ببيانات فعلية: تجزئة وتكلفة وهامش وقوائم — من كل مكان')
}

/* ⑥ نقرتان على اسم الصنف في الجدول تفتحان المنتقي */
{
  assert.ok(/data-line-name-cell/.test(table) && /onDoubleClick=\{\(\) => openReplacePicker\(/.test(table),
    'النقر المزدوج على صنف السطر لا يفتح نافذة اختيار الصنف')
  assert.ok(/onReplaceLine\?:/.test(table), 'جدول البنود بلا منفذ لاستبدال صنف السطر')
  for (const [label, src] of [['البيع', sales], ['الشراء', purchase]])
    assert.ok(/onReplaceLine=\{replaceLineItem\}/.test(src), `صفحة ${label} لا تنفّذ استبدال صنف السطر`)
  R.ok('⑥ نقرتان على اسم الصنف تفتحان المنتقي لاستبدال الصنف في نفس السطر')
}

/* ⑦ توسيط الكمية ومنع تداخل الخصم مع الإجمالي */
{
  assert.ok(/\.invoice-cell-input \{[^}]*width: 100% !important/.test(css) && /min-width: 0 !important/.test(css),
    'مدخلات خلايا الجدول بعرض حر فتتجاوز عمودها وتتداخل مع «الإجمالي»')
  assert.ok(/\.invoice-doc \.invoice-lines-table tbody td input:not\(\[type="checkbox"\]\),\s*\n\.invoice-doc \.invoice-lines-table tbody td select \{ padding-inline: \.25rem !important; \}/.test(css),
    'حشوة خلايا الجدول واسعة فيُقصّ الرقم في الأعمدة الضيقة')
  R.ok('⑦ الكمية موسَّطة داخل عمودها و«خصم %» لا يزاحم «الإجمالي»')
}

/* ⑧⑨ تكيّف كل الأقسام مع الارتفاع الشحيح */
{
  const tight = css.match(/@media \(max-height: 820px\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(tight.length > 0, 'لا ضبط للارتفاع الشحيح (شاشات 768 وأقل)')
  for (const sel of ['invoice-doc-panel-body', 'invoice-doc-panel-head', 'invoice-doc-panel-foot', 'invoice-doc-paynote'])
    assert.ok(tight.includes(sel), `ضبط الارتفاع الشحيح لا يشمل ${sel}`)
  assert.ok(/\.invoice-doc \.invoice-doc-payrow \{ display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) 6\.2rem/.test(css),
    'خانة مبلغ التحصيل أعرض من اللازم فتضغط التسمية')
  R.ok('⑧⑨ كل الأقسام تتكيّف: اللوحات الثلاث والبنود داخل النافذة بلا تمرير ولا قصّ حتى 1024×680')
}

/* ⑪ اسم الصنف محفوظ في الأنماط الأعلى من «بيع مباشر» (بلاغ المالك) */
{
  assert.ok(/const COLW = \{/.test(table) && /name: 15,/.test(table),
    'لا أرضية لعرض عمود «الصنف / الوصف» بالـrem')
  assert.ok(/const minTableRem = COLW\.index/.test(table) && /style=\{\{ minWidth: `\$\{minTableRem\}rem` \}\}/.test(table),
    'عرض الجدول الأدنى ثابت لا يتبع الأعمدة الظاهرة، فينسحق اسم الصنف عند إضافة التكلفة/الهامش/الضريبة')
  assert.ok(!/min-w-\[58rem\]/.test(table), 'ما زال الجدول يستعمل أدنى عرض ثابت 58rem')
  assert.ok(/name: 'w-\[15rem\] text-center'/.test(table),
    'عمود الاسم بلا عرض صريح — min-width لا تعمل في table-fixed')
  for (const key of ['index', 'code', 'name', 'warehouse', 'qty', 'price', 'percent', 'unit', 'tax', 'money', 'total', 'tools'])
    assert.ok(new RegExp(`${key}:`).test(table.slice(table.indexOf('const COLW'), table.indexOf('const COLW') + 260)),
      `عرض العمود ${key} غير معرَّف في COLW`)
  assert.ok(/input\[type="date"\] \{\s*box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%/.test(css),
    'حقل التاريخ يفيض على الحقل المجاور في شبكة الترويسة')
  R.ok('⑪ اسم الصنف لا ينسحق في «احترافي — ربحية/متقدم»: عرض الجدول يتبع أعمدته الظاهرة')
}

/* ⑩ لا يختفي قسم من الشريط العلوي */
{
  assert.ok(/data-menubar-more="true"/.test(menubar) && /hiddenSections/.test(menubar),
    'أقسام الشريط العلوي تختفي عند ضيق الشاشة بلا قائمة «المزيد»')
  assert.ok(/new ResizeObserver\(measure\)/.test(menubar) && /widthsRef/.test(menubar),
    'لا قياس ديناميكي لعرض عناوين الشريط')
  assert.ok(/data-menubar-menu="__more__"/.test(menubar) && /data-menubar-more-section/.test(menubar),
    'قائمة «المزيد» لا تعرض الأقسام المخفية وبنودها')
  assert.ok(/overflow-hidden/.test(menubar) && !/menubar-scroll flex min-w-0 flex-1 items-center gap-0\.5 overflow-x-auto/.test(menubar),
    'الشريط ما زال يعتمد التمرير الأفقي الخفي بدل قائمة «المزيد»')
  R.ok('⑩ الشريط العلوي: ما لا يتسع ينتقل إلى «المزيد» — لا قسم يختفي في أي مقاس')
}

R.done()
