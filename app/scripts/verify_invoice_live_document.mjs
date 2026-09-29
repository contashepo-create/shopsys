/**
 * المرحلة ⑨ (2026-09-28) — «نفّذ الفاتورة في الوضع الحي للتطبيق مطابقةً للتصميم المعتمد،
 * على كل النشاطات التي تحتاج فاتورة، وكذلك فاتورة الشراء والمرتجعات».
 *
 * هذه البوابة تُثبّت قرارات المالك السبعة التي اعتُمدت على النموذج الحي:
 *   ① زر ترحيل **واحد** أعلى المستند اسمه «حفظ وترحيل» — لا زر مكرر في الشريط السفلي.
 *   ② الشريط السفلي يحمل **سطر تدقيق واحد** (متى/من/لماذا) بلا إجمالي ولا متبقٍ.
 *   ③ رقاقة «القيد متزن» بجوار رقم المستند.
 *   ④ «إذن استلام مستودع» من داخل الفاتورة: كميات فقط بلا أي سعر + إعداداته في إعدادات الطباعة.
 *   ⑤ لا شريط بحث أصناف منفصل — البحث من خلية اسم الصنف، وسطور فارغة حقيقية (≥5).
 *   ⑥ التنقل بالأسهم داخل الجدول ودورة Enter (كمية ⇐ سعر ⇐ السطر التالي).
 *   ⑦ «النوافذ عادية»: بلا تعتيم ولا عزل ولا ظل، ولكل نافذة إغلاق وتصغير.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_live_document.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'
import { DEFAULT_WAREHOUSE_RECEIPT, buildWarehouseReceiptHtml } from '../src/core/warehouseReceipt.ts'

const R = reporter('فاتورة الوضع الحي — التصميم المعتمد على كل النشاطات')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(`${ROOT}/${relative}`, 'utf8')

const css = read('src/index.css')
const frame = read('src/ui/components/InvoicePOSFrame.tsx')
const table = read('src/ui/components/InvoiceLinesTable.tsx')
const ui = read('src/ui/components/ui.tsx')
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const receipt = read('src/core/warehouseReceipt.ts')
const audit = read('src/core/invoiceAudit.ts')
const repo = read('src/data/repo.ts')
const store = read('src/stores/app.store.ts')
const printSettings = read('src/ui/pages/PrintSettingsPage.tsx')
const PAGES = [['المبيعات', sales], ['المشتريات', purchase]]

/** جسم قاعدة CSS لمحدِّد (أول تطابق) */
const ruleOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `قاعدة مفقودة في index.css: ${selector}`)
  return match[2].replace(/\s+/g, ' ')
}

/* ① زر ترحيل واحد اسمه «حفظ وترحيل» */
{
  assert.ok(frame.includes('حفظ وترحيل'), 'زر الترحيل الأعلى لم يُسمَّ «حفظ وترحيل»')
  const actionbar = frame.slice(frame.indexOf('invoice-doc-actionbar'))
  assert.ok(!actionbar.includes('onPost'), 'عاد زر الترحيل المكرر إلى الشريط السفلي')
  assert.ok(!actionbar.includes('حفظ فقط') && !actionbar.includes('حفظ ومعاينة'), 'أزرار الحفظ المكررة ما زالت في الشريط السفلي')
  assert.equal((frame.match(/onClick=\{onPost\}/g) ?? []).length, 1, 'زر الترحيل ليس واحداً في المستند كله')
  R.ok('زر ترحيل واحد أعلى المستند اسمه «حفظ وترحيل» — لا تكرار في الشريط السفلي')
}

/* ② سطر التدقيق في الشريط السفلي: سطر واحد بلا إجمالي ولا متبقٍ */
{
  assert.ok(frame.includes('auditLabel'), 'الإطار لا يستقبل سطر التدقيق')
  assert.ok(frame.includes('invoice-doc-audit'), 'سطر التدقيق بلا فئته في شريط الحالة')
  const rule = css.match(/\.invoice-doc-audit\s*\{([^}]*)\}/)
  assert.ok(rule, 'لا قاعدة CSS لسطر التدقيق')
  assert.ok(/white-space:\s*nowrap/.test(rule[1]) && /text-overflow:\s*ellipsis/.test(rule[1]), 'سطر التدقيق قد ينكسر لأكثر من سطر')
  const actionbar = frame.slice(frame.indexOf('invoice-doc-actionbar-info'), frame.indexOf('invoice-doc-actionbar-buttons'))
  for (const forbidden of ['الإجمالي', 'المتبقي', 'إجمالي الفاتورة']) {
    assert.ok(!actionbar.includes(forbidden), `«${forbidden}» عاد إلى شريط الحالة — مكانه لوحتا الإجماليات والتحصيل`)
  }
  assert.ok(audit.includes('عُدِّلت') && audit.includes('بواسطة') && audit.includes('السبب:'), 'صيغة سطر التدقيق ناقصة')
  assert.ok(!/\\n/.test(audit.slice(audit.indexOf('const parts'), audit.indexOf('return parts'))), 'سطر التدقيق يُبنى على أكثر من سطر')
  assert.ok(repo.includes('reversalEntryId: number; by?: string'), 'سجل التعديل بلا اسم من عدّل')
  assert.equal((repo.match(/by: activeUserName\(state\)/g) ?? []).length, 2, 'البيع والشراء لا يختمان اسم من عدّل في سجل التعديل')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('formatInvoiceAuditLine') && src.includes('auditLabel'), `${label}: الفاتورة المرحّلة بلا سطر تدقيق في الشريط السفلي`)
  }
  R.ok('الفاتورة المرحّلة تُعدَّل ويُكتب سطر واحد: متى عُدِّلت ومن عدّلها ولماذا — بلا إجمالي أو متبقٍ')
}

/* ③ رقاقة «القيد متزن» */
{
  assert.ok(frame.includes('invoice-doc-balanced') && frame.includes('القيد متزن'), 'رقاقة «القيد متزن» غير موجودة بجوار رقم المستند')
  assert.ok(css.includes('.invoice-doc-balanced'), 'لا قاعدة CSS لرقاقة «القيد متزن»')
  R.ok('رقاقة «القيد متزن» بجوار رقم المستند')
}

/* ④ إذن استلام المستودع: كميات فقط */
{
  assert.ok(frame.includes('onWarehouseReceipt') && frame.includes('إذن استلام مستودع'), 'زر إذن الاستلام غير موجود في المستند')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('buildWarehouseReceiptHtml') && src.includes('onWarehouseReceipt'), `${label}: زر إذن الاستلام بلا معالج حقيقي`)
  }
  assert.ok(!/Minor|formatMinor|currency/i.test(receipt.replace(/\/\*[\s\S]*?\*\//g, '')), 'وحدة إذن الاستلام تلمس المبالغ أصلاً')
  const printed = buildWarehouseReceiptHtml({
    title: 'إذن استلام من المستودع', docNumber: 'INV-0001', dateLabel: '2026-09-28',
    partyLabel: 'جهة', branchLabel: 'الفرع الرئيسي', companyName: 'منشأة', userLabel: 'المالك',
    lines: [{ nameAr: 'صنف', qty: 4, unit: 'قطعة', code: 'A-1', barcode: '1', location: 'رف', warehouseAr: 'رئيسي' }],
    settings: { ...DEFAULT_WAREHOUSE_RECEIPT, showBarcode: true, showLocation: true, showNotesColumn: true, groupByWarehouse: true, copies: 3 },
  })
  for (const forbidden of ['سعر', 'الإجمالي', 'ر.س', 'ج.م', 'المبلغ', 'الخصم', 'الضريبة']) {
    assert.ok(!printed.includes(forbidden), `مطبوعة إذن الاستلام تحمل «${forbidden}» — المطلوب كميات فقط`)
  }
  assert.ok(printed.includes('الكمية') && printed.includes('المستلم فعلياً') && printed.includes('نسخة 3 من 3'), 'مطبوعة الإذن ناقصة الأعمدة أو النسخ')
  assert.ok(store.includes('warehouseReceipt: DEFAULT_WAREHOUSE_RECEIPT') && store.includes('updateWarehouseReceipt'), 'إعدادات إذن الاستلام ليست في مخزن الحالة')
  assert.ok(printSettings.includes('WAREHOUSE_RECEIPT_LABELS') && printSettings.includes('معاينة الإذن'), 'إعدادات إذن الاستلام غير متاحة في «إعدادات الطباعة»')
  R.ok('إذن استلام المستودع: كميات فقط بلا أي سعر · يُفتح من الفاتورة ومن إعدادات الطباعة')
}

/* ⑤ لا شريط بحث منفصل + سطور فارغة حقيقية */
{
  assert.ok(!frame.includes('invoice-doc-entry'), 'عاد شريط البحث/الباركود المنفصل')
  assert.ok(table.includes('invoice-line-entry-cell'), 'مربع البحث ليس داخل خلية اسم الصنف')
  const min = table.match(/MIN_VISIBLE_ROWS\s*=\s*(\d+)/)
  assert.ok(min && Number(min[1]) === 5, 'عدد السطور الظاهرة في جدول الأصناف ليس خمسة')
  assert.ok(table.includes('invoice-line-ghost') && css.includes('.invoice-line-ghost'), 'السطور الفارغة الحقيقية غير موجودة')
  assert.ok(table.includes('مسح باركود'), 'زر مسح الباركود غير موجود في رأس جدول البنود')
  R.ok('لا شريط بحث منفصل — البحث من خلية الاسم، وخمسة سطور في الجدول وما زاد يُمرَّر')
}

/* ⑥ الأسهم ودورة Enter وتوسيط الأعمدة */
{
  /* صار معالج الجسم يلفّ gridArrowNavigation ليضيف اختصارات السطر (دفعة ⑬) */
  assert.ok(table.includes('gridArrowNavigation') && /<tbody onKeyDown=\{[\s\S]{0,900}gridArrowNavigation\(event\)/.test(table),
    'التنقل بالأسهم غير مربوط بجسم الجدول')
  assert.ok(table.includes("data-arrows-native"), 'الحقول ذات التنقل الأصلي غير مستثناة من الأسهم')
  assert.ok(table.includes('.price-cell input'), 'دورة Enter لا تنتقل من الكمية إلى السعر')
  const col = table.slice(table.indexOf('const COL = {'), table.indexOf('} as const'))
  for (const key of ['money', 'total', 'warehouse', 'qty', 'price']) {
    assert.ok(new RegExp(`${key}:\\s*'[^']*text-center`).test(col), `عمود ${key} غير موسَّط`)
  }
  assert.ok(/name:\s*'[^']*text-center/.test(col), 'عمود اسم الصنف غير موسَّط (قرار المالك ⑩ي)')
  R.ok('الأسهم تنقل التركيز · Enter كمية ⇐ سعر ⇐ السطر التالي · كل الأعمدة وسط عدا الاسم')
}

/* ⑦ قاعدة «النوافذ عادية»: بلا تعتيم ولا عزل ولا ظل + تصغير */
{
  assert.ok(!ui.includes('data-modal-backdrop'), 'عادت طبقة التعتيم خلف النوافذ')
  assert.ok(ui.includes('pointer-events-none') && ui.includes('pointer-events-auto'), 'غلاف النافذة ما زال يحجب العمل خلفه')
  assert.ok(ui.includes('تصغير النافذة') && ui.includes('data-modal-minimized'), 'النافذة بلا زر تصغير')
  assert.ok(ui.includes('إغلاق النافذة') && ui.includes("e.key !== 'Escape'"), 'النافذة بلا إغلاق يدوي أو بلا استجابة لـEscape')
  /* الفحص على أجسام النوافذ نفسها (لا على التنبيهات العابرة التي ليست نوافذ) */
  const shells = [
    ['المودال الموحد', ui.slice(ui.indexOf('export function Modal'), ui.indexOf('export function useUnsavedChangesGuard'))],
    ['حوار موافقة المشرف', read('src/ui/components/SupervisorPinDialog.tsx')],
    ['لوحة الاختصارات', read('src/ui/components/KeyboardNavigation.tsx')],
  ]
  for (const [label, src] of shells) {
    for (const forbidden of ['bg-slate-900/55', 'bg-black/50', 'bg-slate-950/60', 'backdrop-blur', 'shadow-2xl']) {
      assert.ok(!src.includes(forbidden), `${label}: «${forbidden}» يعتّم الخلفية أو يضع ظلاً`)
    }
  }
  R.ok('لا نافذة تعتّم الخلفية أو تعزلها أو تضع ظلاً — ولكل نافذة إغلاق وتصغير واستجابة لـEscape')
}

/* ⑧ المرتجعات بنفس لغة المستند */
{
  for (const [label, file] of [['مرتجع المبيعات', 'src/ui/pages/SaleReturnsPage.tsx'], ['مرتجع المشتريات', 'src/ui/pages/PurchaseReturnsPage.tsx']]) {
    const src = read(file)
    assert.ok(src.includes('invoice-lines-table'), `${label}: جدول البنود ليس بلغة جدول الفاتورة`)
    assert.ok(src.includes('text-center'), `${label}: أعمدة الكميات والمبالغ غير موسَّطة`)
    assert.ok(src.includes('<Modal'), `${label}: لا يستعمل النافذة الموحدة (بلا تعتيم وبزر تصغير)`)
  }
  R.ok('المرتجعات: جدول بنود بلغة الفاتورة وأعمدة موسَّطة داخل نافذة بلا تعتيم')
}

/* ⑨ تخطيط المستند الكامل: خمس مناطق في ارتفاع الشاشة — لا يختفي جزء ولا تُمرَّر الصفحة */
{
  const root = ruleOf('.invoice-doc.invoice-pos-root')
  assert.ok(/display: grid/.test(root) && /grid-template-rows: auto minmax\(0, 1fr\) auto/.test(root), 'سطح الفاتورة ليس شبكة ثلاث مناطق (شريط · جسم · شريط حالة)')
  assert.ok(/height: 100dvh/.test(root) && /overflow: hidden/.test(root), 'سطح الفاتورة لا يملأ ارتفاع الشاشة أو يسمح بتمرير الصفحة كلها')
  assert.ok(/height: 100%/.test(ruleOf('.app-window-body .invoice-doc.invoice-pos-root')), 'داخل النافذة المستقلة لا يأخذ المستند ارتفاع النافذة')
  const body = ruleOf('.invoice-doc-body')
  assert.ok(/grid-template-rows: auto minmax\(0, 1fr\)/.test(body) && /overflow: hidden/.test(body), 'جسم المستند لا يمنح البنود المساحة المتبقية')
  /* `.invoice-shell` صار display:contents، والمحدِّدات تُطابق شجرة DOM الحقيقية
     لا شجرة الصناديق — فالقاعدة وصفية لا بـ`>`، وإلا لم تُطبَّق أصلاً. */
  assert.ok(/display: contents/.test(ruleOf('.invoice-pos-document > .invoice-shell')), 'غلاف invoice-shell ما زال يقطع سلسلة الارتفاع')
  const docGrid = ruleOf('.invoice-pos-document .invoice-body-grid')
  /* قرار المالك ⑩ي: صف اللوحات يتمدد لمحتواه (min-content) فلا يختفي أسفلها شيء،
     ويملأ الباقي (1fr) حين تتسع الشاشة. */
  assert.ok(/grid-template-rows: minmax\(0, auto\) minmax\(min-content, 1fr\)/.test(docGrid) && /align-items: stretch/.test(docGrid),
    'صفّا الجسم ليسا: بنود بخمسة سطور ثم لوحات تأخذ محتواها كاملاً')
  const scroll = ruleOf('.invoice-editor .invoice-lines-panel .overflow-x-auto')
  assert.ok(/flex: 1/.test(scroll) && /max-height: none/.test(scroll) && /overflow: auto/.test(scroll), 'جدول البنود لا يُمرَّر داخلياً — سيدفع بقية الفاتورة خارج الشاشة')
  assert.ok(/repeat\(3, minmax\(0, 1fr\)\)/.test(ruleOf('.invoice-pos-document .invoice-totals-footer')), 'اللوحات الثلاث ليست في صف واحد كالنموذج')
  const panel = ruleOf('.invoice-pos-document .invoice-doc-panel')
  assert.ok(/max-height: none/.test(panel) && /min-height: min-content/.test(panel) && /overflow: visible/.test(panel),
    'اللوحات السفلية تُقصّ بدل أن تُظهر محتواها كاملاً (قرار المالك ⑩ي)')
  for (const narrow of ['820px', '620px']) {
    assert.ok(css.replace(/\s+/g, ' ').includes(`@media (max-width: ${narrow}) { .invoice-pos-document .invoice-totals-footer`), `لا تتكيف اللوحات مع مقاس ${narrow}`)
  }
  R.ok('خمس مناطق في ارتفاع الشاشة: شريط · ترويسة · بنود تتمدد وتُمرَّر داخلياً · ثلاث لوحات · شريط حالة')
}

/* ⑩ الترويسة ثلاثة صفوف: ستة حقول · شريط الصنف والمستخدم · شريط بيانات الطرف */
{
  assert.ok(frame.includes('invoice-doc-strip') && frame.includes('invoice-doc-strip-user'), 'شريط الصنف المحدد واسم المستخدم غير موجود في الترويسة')
  assert.ok(frame.includes('partyMeta'), 'الإطار لا يستقبل شريط بيانات الطرف (فئة · خصم · ملاحظة)')
  const side = frame.slice(frame.indexOf('<aside className="invoice-doc-side">'), frame.indexOf('</aside>'))
  assert.ok(side.includes('invoice-doc-party') && !side.includes('invoice-doc-itemcard'), 'بطاقة الصنف ما زالت في العمود الجانبي بدل شريط الترويسة')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('partyMeta') && src.includes('invoice-doc-partymeta'), `${label}: لا شريط لفئة الطرف وخصمه وملاحظته`)
  }
  assert.ok(css.includes('.invoice-doc-partymeta'), 'لا قاعدة CSS لشريط بيانات الطرف')
  R.ok('الترويسة ثلاثة صفوف: ستة حقول · شريط الصنف بجوار المستخدم · فئة الطرف وخصمه وملاحظته وزر تعديلها')
}

/* ⑪ مقياس النموذج: جذر متغير بالشاشة + سطور فارغة بصناديق إدخال + عدد سطور يملأ المساحة */
{
  /* السبب الجذري لعدم التطابق سابقاً: جذر التطبيق 16px بينما النموذج يربط كل
     مقاساته بـ clamp(17px, .72vw + .86vh, 32px) ≈ 20px على 1600×1000، فكانت
     الفاتورة تُرسم بنسبة 79% من النموذج. القاعدة تُطبَّق فقط ومستند الفاتورة مفتوح. */
  const scale = ruleOf('html:has(.invoice-doc.invoice-pos-root)')
  assert.ok(/clamp\(17px, calc\(\.72vw \+ \.86vh\), 32px\)/.test(scale), 'مقياس جذر النموذج غير مطبَّق — ستبقى الفاتورة أصغر من المعتمد')
  // السطور الفارغة في النموذج ورقة إكسل: مربعات إدخال مرئية في كل سطر لا فراغ
  // قرار المالك (⑩ز): السطور الفارغة نظيفة تماماً — لا مربعات ولا تسطيرات، والنقر عليها يفتح البحث
  assert.ok(!table.includes('invoice-line-ghost-in') && !css.includes('.invoice-line-ghost-in'), 'عادت مربعات الإدخال (التسطيرات) في السطور الفارغة')
  assert.ok(table.includes("ghostCell('qty'") && table.includes("ghostCell('price'"), 'خلايا السطر الفارغ غير مرسومة')
  /* قرار المالك ⑩ي: النقر المزدوج (لا المفرد) هو ما يفتح بحث الصنف من خلية فارغة. */
  assert.ok(/data-ghost-field=\{label\}/.test(table) && /onDoubleClick=\{openPicker\}/.test(table), 'النقر المزدوج على خلية فارغة لا يفتح بحث الصنف')
  assert.ok(!table.includes('colSpan={Math.max(1, columnCount'), 'عادت خلية colSpan العملاقة بدل خلايا السطر الحقيقية')

  // عدد السطور يملأ منطقة البنود: أحد عشر على شاشة المرجع، وأكثر/أقل بحسب الارتفاع
  assert.ok(table.includes('ResizeObserver') && table.includes('boxMaxHeight'), 'ارتفاع الجدول لا يُقاس من ارتفاع سطر حقيقي — قد يظهر نصف سطر مقطوع')
  assert.ok(/TARGET_VISIBLE_ROWS = 5/.test(table) && /MIN_VISIBLE_ROWS = 5/.test(table), 'عدد السطور الظاهرة ليس ستة')
  assert.ok(/Math\.max\(1, VISIBLE_ROWS - lines\.length\)/.test(table), 'لا يبقى سطر إدخال واحد على الأقل عند امتلاء الجدول')
  R.ok('مقياس النموذج: جذر يكبر مع الشاشة · خمسة سطور نظيفة بلا تسطيرات · ما زاد يُمرَّر داخلياً')
}

R.done()
