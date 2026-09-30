/* بوابة: معاينة الطباعة نافذة حرة · زر طباعة في شريط الفاتورة ·
   مسير الرواتب منبثق ببحث موظف · المسميات الوظيفية حسب النشاط */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'
import { jobTitlesFor, jobTitleLabel } from '../src/core/jobTitles.ts'

const R = reporter('معاينة الطباعة · زر الطباعة · مسير منبثق · مسميات النشاط')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const preview = read('ui/components/ThermalPreview.tsx')
const frame = read('ui/components/InvoicePOSFrame.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const employees = read('ui/pages/EmployeesPage.tsx')
const css = read('index.css')

{
  assert.ok(/const width = paper \+ 28[\s\S]{0,200}window\.innerWidth - width\) \/ 2/.test(preview), 'المعاينة لا تفتح في منتصف الشاشة')
  assert.ok(/const startDrag = useCallback/.test(preview) && /data-thermal-drag/.test(preview), 'المعاينة لا تُسحب بحرية')
  assert.ok(/style=\{\{ width: '100%', maxWidth: paper \}\}/.test(preview), 'ورقة المعاينة قد تسبب تمريراً أفقياً')
  assert.ok(/overflow-x: hidden/.test(css.slice(css.indexOf('.thermal-preview-paper'), css.indexOf('.thermal-preview footer'))),
    'حاوية الورقة تسمح بالتمرير الأفقي')
  assert.ok(!/inset-inline-end: 1\.2rem; bottom: 3\.2rem/.test(css), 'المعاينة ما زالت درجاً جانبياً')
  R.ok('معاينة الطباعة نافذة حرة وسط الشاشة تُسحب بحرية وبلا تمرير أفقي')
}
{
  assert.ok(/onQuickPrint\?: \(\) => void/.test(frame) && /data-quick-print/.test(frame), 'لا زر طباعة في شريط الفاتورة')
  /* «المسودات» تظهر أولاً في شرح الخاصية أعلى الملف؛ نقيس المسافة من زر الطباعة
     إلى زر المسودات في نفس الشريط (آخر ظهور) */
  const printAt = frame.indexOf('data-quick-print')
  const draftsAt = frame.indexOf('onRestoreDraft} title=', printAt)
  assert.ok(draftsAt > printAt && draftsAt - printAt < 700, 'زر الطباعة ليس بجوار «المسودات» في الشريط')
  assert.ok(/onQuickPrint=\{\(\)=>printDraft\(printSwitches\.cashierPrint\?'thermal':'a4'\)\}/.test(sales),
    'زر الطباعة لا يتبع مفتاح الكاشير')
  assert.ok(/if\(!printSwitches\.silentPrint\)\{openPrintPreview\(\{/.test(sales), 'الطباعة غير الصامتة لا تعرض المعاينة أولاً')
  R.ok('زر «طباعة» بجوار المسودات يتبع مفاتيح الكاشير/الصامت ويعرض المعاينة أولاً')
}
{
  assert.ok(/<Modal open=\{slipDraftOpen\}[\s\S]{0,200}مسير رواتب/.test(employees), 'مسير الرواتب ليس نافذة منبثقة')
  assert.ok(/data-slip-search/.test(employees) && /const visibleSlipRows = slipRows\.filter/.test(employees),
    'لا بحث عن موظف داخل المسير')
  assert.ok(/slipScope === 'selected' && !row\.on/.test(employees), 'لا نطاق «المحدَّدون فقط» في المسير')
  R.ok('مسير الرواتب نافذة منبثقة ببحث موظف ونطاق اختيار')
}
{
  const supermarket = jobTitlesFor('supermarket')
  const contracting = jobTitlesFor('contracting')
  assert.ok(supermarket.includes('كاشير') && !supermarket.includes('مهندس موقع'), 'مسميات السوبرماركت غير صحيحة')
  assert.ok(contracting.includes('مهندس موقع') && contracting.includes('مساح كميات'), 'مسميات المقاولات ناقصة')
  assert.notDeepEqual(supermarket, contracting, 'المسميات لا تتغير بين الأنشطة')
  assert.equal(jobTitleLabel('contracting'), 'الوظيفة في الموقع', 'تسمية الحقل لا تتبع النشاط')
  assert.ok(/list="job-titles-by-activity"/.test(employees) && /jobTitlesFor\(setup\.activityId\)/.test(employees),
    'شاشة الموظف لا تستعمل مسميات النشاط')
  R.ok('المسميات الوظيفية تتغيّر من نشاط لآخر والحقل يبقى حراً')
}
{
  /* المعاينة الحية العالمية (طلب المالك): متجر عام + نافذة واحدة فوق المسارات،
     إعدادات سريعة فورية، وزر إعدادات إضافية يصغّرها ويفتح قسم الطباعة */
  const store = read('ui/components/printPreviewStore.ts')
  const app = read('App.tsx')
  assert.ok(/export const usePrintPreview/.test(store) && /openPreview:/.test(store), 'متجر المعاينة العامة مفقود')
  assert.ok(/rebuild\?\: \(\) => string/.test(store) && /refresh: \(\) => void/.test(store), 'المعاينة الحية بلا إعادة بناء')
  assert.ok(/openPrintPreview\(\{[\s\S]*rebuild:/.test(sales), 'فاتورة البيع تفتح المعاينة بلا إعادة بناء حية')
  assert.ok(app.includes('<ThermalPreview />'), 'المعاينة العامة لا تُرندر فوق كل المسارات')
  assert.ok(/data-thermal-quick/.test(preview) && /data-quick-paper/.test(preview), 'لا لوحة إعدادات سريعة داخل المعاينة')
  assert.ok(/data-thermal-extra-settings/.test(preview), 'لا زر «إعدادات إضافية»')
  assert.ok(/setMini\(true\); nav\('\/settings\/printing'\)/.test(preview), 'الإعدادات الإضافية لا تصغّر المعاينة وتفتح قسم الطباعة')
  assert.ok(/data-thermal-mini/.test(preview) && /data-thermal-expand/.test(preview), 'لا وضع مصغّر حي أسفل الشاشة')
  assert.ok(/receipt === receiptRef\.current\) return/.test(preview) && /refresh\(\)/.test(preview), 'المعاينة لا تتحدث فورياً مع إعدادات الطباعة')
  assert.ok(preview.includes('usePrintSwitches'), 'الطباعة من المعاينة لا تتبع مفاتيح الطباعة')
  for (const page of ['ui/pages/AdvancedPurchaseInvoicePage.tsx', 'ui/pages/PurchaseOrdersPage.tsx', 'ui/pages/QuotationsPage.tsx']) {
    assert.ok(/openPrintPreview\(\{\s*html:\s*buildModelHtml/.test(read(page)), `${page} لا يفتح المعاينة العامة بحمولة قابلة لإعادة البناء`)
  }
  R.ok('معاينة حية عالمية: متجر + نافذة فوق المسارات + إعدادات سريعة فورية + مصغّرة حية أثناء قسم الطباعة')
}
R.done()
