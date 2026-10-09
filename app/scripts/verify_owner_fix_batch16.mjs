/* بوابة دفعة المالك ⑯: نبضات حية · شريط رأس الجدول · المسطرة · تحجيم الأعمدة ·
   زر تعديل الطرف · رقم المستند · تسخين وحدة الفاتورة. */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑯ — نبضات وتحجيم أعمدة وسرعة فتح')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const css = read('index.css')
const table = read('ui/components/InvoiceLinesTable.tsx')
const pickers = read('ui/components/KeyboardPickers.tsx')
const host = read('ui/windows/WindowHost.tsx')
const frame = read('ui/components/InvoicePOSFrame.tsx')

{
  assert.ok(/@keyframes livePulse/.test(css), 'لا حركة نبض معرَّفة')
  assert.ok(/\.invoice-doc-online i \{ animation: livePulse/.test(css), 'نقطة الاتصال لا تنبض')
  assert.ok(/\.invoice-doc-balanced i \{ animation: livePulse/.test(css), 'نقطة «القيد متزن» لا تنبض')
  assert.ok(/prefers-reduced-motion: reduce\) \{ \.invoice-doc-online i, \.invoice-doc-balanced i \{ animation: none/.test(css),
    'النبض لا يحترم تقليل الحركة')
  R.ok('نقطتا الاتصال والقيد المتزن تنبضان وتحترمان تقليل الحركة')
}
{
  assert.ok(!/invoice-lines-hint/.test(table), 'ما زالت التلميحات في شريط رأس الجدول')
  assert.ok(!/invoice-lines-value-label/.test(table), 'ما زالت «قيمة البنود» في الشريط')
  assert.ok(/invoice-lines-count.*بند/.test(table), 'عدد البنود اختفى من الشريط')
  assert.ok(/invoice-lines-weight/.test(table) && /const totalWeight = lines\.reduce/.test(table), 'الوزن الإجمالي غير معروض')
  R.ok('شريط رأس الجدول: عدد البنود + الوزن الإجمالي فقط')
}
{
  assert.ok(/event\.key === ' ' \|\| event\.code === 'Space'/.test(pickers), 'المسطرة لا تفتح منتقي الصنف')
  R.ok('المسطرة تفتح نافذة انتقاء الصنف مباشرة')
}
{
  assert.ok(/const columnPlan = useMemo/.test(table), 'لا خطة أعمدة موحَّدة')
  assert.ok(/<colgroup>\{columnPlan\.map/.test(table), 'الجدول بلا colgroup فلا يمكن تحجيم الأعمدة')
  assert.ok(/const headPointerDown = /.test(table) && /col-resize/.test(table), 'لا سحب لحواف رؤوس الأعمدة')
  assert.ok(/localStorage\.setItem\(widthsKey/.test(table), 'عرض الأعمدة لا يُحفظ')
  assert.ok(/resetColumnWidths/.test(table), 'لا استعادة للمقاسات الافتراضية')
  R.ok('أعمدة الجدول تُحجَّم بالسحب وتُحفظ، والنقر المزدوج يعيدها')
}
{
  assert.ok(/flex: 0 0 auto !important;\s*\n\s*min-height: 1\.25rem !important; width: 1\.25rem !important/.test(css),
    'زر تعديل الطرف ما زال يتمدد')
  assert.ok(/data-doc-number>\{documentNumber \|\| \(sale \? 'INV' : 'PUR'\)\}/.test(frame),
    '«مسودة جديدة» ما زالت مكرَّرة داخل المستند')
  R.ok('زر تعديل الطرف صغير ومميّز · رقم المستند بلا تكرار لعنوان النافذة')
}
{
  assert.ok(/function warmInvoiceModules/.test(host) && /requestIdleCallback/.test(host),
    'وحدة الفاتورة لا تُسخَّن مسبقاً فيبطؤ أول فتح')
  assert.ok(/useEffect\(\(\) => \{ warmInvoiceModules\(\) \}, \[\]\)/.test(host), 'التسخين غير مستدعى عند الإقلاع')
  /* درس 2026-10-08: التسخين «أطلق وانسَ» بلا catch ترك رفضاً غير معالَج حين
     فُكِّكت بيئة jsdom قبل اكتمال التحميل ⇒ EnvironmentTeardownError تُخرج
     التشغيل الكامل برمز 1 رغم نجاح كل الاختبارات. */
  assert.ok(host.includes("void import('../pages/AdvancedSalesInvoicePage.tsx').catch("),
    'تسخين فاتورة البيع بلا catch ⇒ رفض غير معالَج عند فشل التحميل')
  assert.ok(host.includes("void import('../pages/AdvancedPurchaseInvoicePage.tsx').catch("),
    'تسخين فاتورة الشراء بلا catch ⇒ رفض غير معالَج عند فشل التحميل')
  R.ok('وحدتا الفاتورة تُحمَّلان في وقت الخمول — الفتح فوري، وفشل التسخين لا يُسقط التطبيق ولا الاختبارات')
}
{
  assert.ok(/\.invoice-doc \.invoice-doc-fields > \.form-field:nth-child\(even\)/.test(css), 'لا تدريج بصري لصفوف الحقول')
  assert.ok(/\.invoice-doc \.invoice-doc-fields > \.form-field:focus-within/.test(css), 'الحقل النشط غير مميّز')
  R.ok('تدريج بصري لحقول الترويسة يخفّف الازدحام')
}
/* ⑧ توسيط خانة الإجمالي + فحوص الائتمان + قوالب الفواتير (دفعة ⑰) */
{
  assert.ok(/\.invoice-editor \.invoice-lines-table \.invoice-table-total \{[^}]*text-align: center/.test(css),
    'خانة الإجمالي ما زالت محاذية لليسار')
  const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
  assert.ok(/id:'credit-limit'/.test(sales) && /تجاوز حد الائتمان/.test(sales), 'لا فحص لتجاوز حد الائتمان قبل الترحيل')
  assert.ok(/id:'collect-short'/.test(sales), 'لا فحص لنقص التحصيل قبل الترحيل')
  assert.ok(/const allPrePostIssues=useMemo/.test(sales), 'الفحوص المالية غير مدمجة في لوحة المراجعة')
  assert.ok(/const saveAsTemplate=\(\)=>/.test(sales) && /const applyTemplate=/.test(sales), 'قوالب الفواتير غير منفَّذة')
  assert.ok(/isTemplate:true/.test(sales), 'القالب لا يُحفظ بعلم القالب')
  const modal = read('ui/components/InvoiceDraftsModal.tsx')
  assert.ok(/templatesOnly\?: boolean/.test(modal) && /draft\.isTemplate === true/.test(modal), 'نافذة القوالب لا تفصل القوالب عن المسودات')
  const repo = read('data/repo.ts')
  assert.ok(/isTemplate\?: boolean/.test(repo), 'نوع المسودة بلا علم القالب')
  R.ok('الإجمالي موسَّط · فحص الائتمان والتحصيل · قوالب فواتير كاملة')
}
R.done()
