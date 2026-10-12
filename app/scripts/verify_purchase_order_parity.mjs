/**
 * 🧾 بوابة تكافؤ «تسهيلات الاستخدام» بين أمر الشراء وفاتورة الشراء
 * ─────────────────────────────────────────────────────────────────
 * بلاغ المالك (2026-10-12): «أمر الشراء لا يحمل جميع خصائص الفاتورة من تسهيلات
 * استخدام، ويمنعني أن أكتب في أول سطر في جدول الأصناف».
 *
 * السبب الجذري الأول (السطر الأول): كان المحرر يُفتح بسطر فارغ جاهز (بلا صنف)
 * فيحتجز أول صف بلا خانة بحث وينزل مربع البحث إلى السطر الثاني — بينما الفاتورة
 * تبدأ بلا سطور فيحمل أول صف خانة البحث/الباركود.
 *
 * السبب الجذري الثاني (الخصائص): أمر الشراء يقرأ **نفس** المكوّنات
 * (`InvoicePOSFrame` + `InvoiceLinesTable`) لكنه كان يمرّر لها مجموعة خصائص
 * أصغر — فتختفي أدوات موجودة في الفاتورة.
 *
 * تمنع البوابة الانحدار بالاتجاهين:
 *  ① مقارنة **آلية** لا قائمة يدوية: كل خاصية يمرّرها محرر فاتورة الشراء إلى
 *    `InvoiceLinesTable` أو `InvoicePOSFrame` يجب أن يمرّرها محرر أمر الشراء
 *    أيضاً (النقص = سقوط البوابة فوراً عند أي إضافة مستقبلية في الفاتورة).
 *  ② لا «سطر محتجز» في أول الجدول + اختبار واجهة يحرس الكتابة في أول سطر.
 *  ③ ما يبقى خاصاً بالفاتورة (مالية/محاسبية) مسجَّل صراحةً بسببه — لا نقص صامت.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_purchase_order_parity.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const po = src('ui/pages/PurchaseOrdersPage.tsx')
const purchaseInvoice = src('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const testPath = fileURLToPath(new URL('../tests/purchase_order_editor.test.tsx', import.meta.url))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

/**
 * يستخرج أسماء الخصائص المُمرَّرة إلى مكوّن داخل JSX من نص الصفحة.
 * يقبل الشكلين: `prop={...}` و`prop="نص"` — ويستثني خصائص المكوّنات المتداخلة
 * بتحديد نطاق الوسم حتى أول إغلاق `/>` في مستوى الوالد.
 */
function propsOf(page, component) {
  const start = page.indexOf(`<${component}`)
  assert.ok(start >= 0, `الصفحة لا تستعمل <${component}> إطلاقاً`)
  /* ماسح يوازن الأقواس: يقرأ أسماء الخصائص في مستوى الوالد فقط ويتجاهل محتوى
     `{...}` (فيه مكوّنات متداخلة ودوال) ونصوص القيم — فلا تتسرب أسماء داخلية. */
  let i = start + component.length + 1
  let depth = 0
  const region = []
  while (i < page.length) {
    const ch = page[i]
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') { depth--; i++; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < page.length && page[i] !== quote) { if (page[i] === '\\') i++; i++ }
      i++
      continue
    }
    if (depth === 0) {
      if (ch === '/' && page[i + 1] === '>') break
      if (ch === '>') break
      region.push(ch)
    }
    i++
  }
  const text = region.join('')
  const found = new Set()
  for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*=/g)) found.add(match[1])
  for (const token of text.split(/\s+/)) if (/^[A-Za-z][A-Za-z0-9]*$/.test(token)) found.add(token)
  return found
}

/* خصائص تمرّ في الفاتورة ولا تُنقل — كل سطر بسببه المحاسبي الصريح */
const INVOICE_ONLY = {
  /* مالية: لا وجود لها قبل الترحيل */
  onApply: 'تطبيق التوزيع — الفاتورة وحدها تحمل مصروفات الشراء', onClear: 'مسح التوزيع — بلا مصروفات في أمر بلا قيد',
  bookCurrency: 'عملة الدفتر والتحويل — يُثبَّت يوم الترحيل', costShares: 'توزيع التكلفة المحمَّلة على البنود — بلا مصروفات في الأمر فلا حِمل يُوزَّع',
  /* مرحَّلة: تحتاج مستنداً محاسبياً قائماً */
  open: 'حالة فتح مستند مرحَّل',
  /* بيع: لا معنى لها في الشراء */
  warnings: 'تنبيهات البيع (نقص مخزون/حد أدنى)', belowCostKeys: 'تحت التكلفة — عقوبة البيع لا الشراء',
  /* بحث السطور: الأمر يعرض الوسم كاملاً لأن أول سطر هو سطر الإدخال */
  className: 'تنسيق خارجي', onClick: 'مُعالج نقر خارجي', onClickCapture: 'مُعالج نقر خارجي',
  itemMetaJoined: 'وسيط داخلي', categoriesJoined: 'وسيط داخلي',
}

function compare(label, component, extraAllowed = []) {
  const fromInvoice = propsOf(purchaseInvoice, component)
  const fromOrder = propsOf(po, component)
  const missing = [...fromInvoice].filter((prop) => !fromOrder.has(prop))
    .filter((prop) => !(prop in INVOICE_ONLY)).filter((prop) => !extraAllowed.includes(prop))
  assert.deepEqual(missing, [], `${label}: أمر الشراء لا يمرّر: ${missing.join(' · ')}`)
  ok(`${label}: ${fromInvoice.size} خاصية في الفاتورة — كلها مُمرَّرة في الأمر (الناقص=${missing.length})`)
  return { fromInvoice, fromOrder }
}

console.log('\n🧾 بوابة تكافؤ أمر الشراء مع فاتورة الشراء\n')

/* ① الخصائص: مقارنة آلية مع الفاتورة على المكوّنين المشتركين */
const table = compare('جدول البنود InvoiceLinesTable', 'InvoiceLinesTable')
const frame = compare('إطار المستند InvoicePOSFrame', 'InvoicePOSFrame')

/* خصائص موجودة في الأمر وراء إصلاح السطر الأول: يجب ألا تعود للفاتورة وحدها */
for (const prop of ['entry', 'entryFilter', 'onActiveItem', 'onDuplicate', 'onMoveLine', 'onReplaceLine'])
  assert.ok(table.fromOrder.has(prop), `أمر الشراء فقد تسهيل «${prop}» الموجود في جدول الفاتورة`)
ok('تسهيلات السطر: تصفية التصنيف · إفراغ/تكرار/نقل/استبدال البند — حاضرة')

/* ② السطر الأول: لا سطر محتجز، والجدول يبدأ فارغاً فيحمل أول صف خانة البحث */
assert.ok(/const \[lines, setLines\] = useState<DraftLine\[\]>\(\[\]\)/.test(po), 'أمر الشراء يبدأ بأسطر جاهزة — أول سطر بلا خانة بحث')
assert.ok(!/blankLine\(/.test(po), 'بقي مُولِّد سطر فارغ محتجز في محرر أمر الشراء')
const linesTable = src('ui/components/InvoiceLinesTable.tsx')
assert.ok(/ghostIndex === 0 && entry/.test(linesTable), 'جدول البنود لم يعد يضع منتقي الأصناف في أول صف فارغ')
assert.ok(existsSync(testPath), 'اختبار واجهة محرر أمر الشراء مفقود — إصلاح السطر الأول بلا حارس')
const uiTest = readFileSync(testPath, 'utf8')
for (const rx of [/invoice-line-entry-cell input/, /data-line-key/, /invoice-search-overlay/, /شروط التوريد/])
  assert.ok(rx.test(uiTest), `اختبار محرر الأمر لا يفحص «${rx}»`)
ok('السطر الأول: الجدول يبدأ بلا سطور · أول صف يحمل خانة البحث · اختبار واجهة يحرسه')

/* ③ مالية الفاتورة وحدها — مسجَّلة بلا نقص صامت */
assert.ok(Object.keys(INVOICE_ONLY).length >= 8, 'قائمة «خاص بالفاتورة» فُقدت سطورها')
console.log('     خاص بالفاتورة (بلا نقص في الأمر): ' + Object.entries(INVOICE_ONLY)
  .filter(([key]) => ['onApply', 'onClear', 'bookCurrency', 'costShares', 'open', 'warnings', 'belowCostKeys'].includes(key))
  .map(([key, why]) => `${key} (${why})`).join(' · '))
ok(`${Object.keys(INVOICE_ONLY).length} خاصية مالية/بيعية لا تُنقل إلى الأمر — مسجَّلة بلا لبس`)

/* ④ نداءات الفاتورة المشتركة: نفس المكوّنات ونفس جسر الأصناف/الأطراف */
for (const rx of [/InvoiceDraftsModal/, /PrintTemplateModal/, /PrintSettingsPopup/, /usePrintSwitches/, /useUnsavedChangesGuard/, /guardNavigation/, /buildSimpleDocModel/, /printModelWithTemplate/, /openPrintPreview/, /shareDocPdfViaWhatsapp/, /PartyNotesLog/])
  assert.ok(rx.test(po), `أمر الشراء فقد مكوّناً مشتركاً: ${rx}`)
ok('المكوّنات المشتركة: مسودات · قوالب طباعة · معاينة · واتساب · ملاحظات المورد · حراسة التغييرات')

console.log(`\n✅ تكافؤ أمر الشراء مع الفاتورة: ${pass} مجموعة تحقق — كلها خضراء\n`)
