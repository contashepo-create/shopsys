/**
 * بوابة سلوك جدول الأصناف في الفاتورة (المرحلة ⑩و).
 *
 * الأعطال التي تحرسها — رُصدت بالقيادة الآلية للمتصفح لا بالقراءة:
 *  ① بعد اختيار الصنف كان التركيز يسقط على body فتضيع الكمية والسعر اللذان
 *    يكتبهما البائع؛ الآن ينتقل تلقائياً إلى خلية كمية السطر الجديد.
 *  ② قائمة نتائج البحث كانت نافذة تُعتّم الشاشة وتطمسها وتضع ظلاً ثقيلاً —
 *    وهذا مخالف لقاعدة المالك: لا منبثقة تعزل الخلفية. صارت منسدلة ملتصقة
 *    بخلية الاسم وبغلاف شفاف.
 *  ③ النتائج بلا أدوار ARIA فلا يعلن قارئ الشاشة القائمة ولا العنصر النشط.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pickers = readFileSync(join(root, 'src/ui/components/KeyboardPickers.tsx'), 'utf8')
const table = readFileSync(join(root, 'src/ui/components/InvoiceLinesTable.tsx'), 'utf8')
const css = readFileSync(join(root, 'src/index.css'), 'utf8')
const checks = []
const check = (name, fn) => { fn(); checks.push(name) }

check('التركيز ينتقل إلى كمية السطر الجديد بعد اختيار الصنف', () => {
  const block = table.slice(table.indexOf('const lineCountRef'), table.indexOf('const draftValue'))
  assert.ok(/lines\.length > lineCountRef\.current/.test(block), 'لا رصد لنمو عدد البنود')
  assert.ok(/td\.num-cell input:not\(\[readonly\]\)/.test(block), 'لا استهداف لخلية الكمية الحقيقية')
  assert.ok(/cell\.focus\(\)/.test(block) && /cell\.select\(\)/.test(block), 'لا تركيز/تحديد للكمية')
  assert.ok(/\[lines\.length\]/.test(block), 'التأثير لا يعتمد على عدد البنود')
})

check('قائمة البحث منسدلة ملتصقة بالحقل لا نافذة مركزية', () => {
  assert.ok(/function anchoredPanelStyle/.test(pickers), 'لا دالة لموضع القائمة تحت الحقل')
  assert.ok(/getBoundingClientRect\(\)/.test(pickers), 'الموضع لا يُقاس من الحقل')
  assert.equal(pickers.match(/style=\{panelStyle\}/g)?.length, 2, 'منتقيا الأصناف والأطراف لا يستخدمان الموضع الملتصق')
  assert.ok(!/mt-\[8vh\]/.test(pickers), 'ما زالت القائمة تُفتح في منتصف الشاشة')
})

check('غلاف القائمة شفاف بلا تعتيم ولا طمس ولا ظل', () => {
  assert.ok(!/bg-slate-950\/35/.test(pickers), 'ما زال غلاف القائمة يُعتّم الخلفية')
  assert.ok(!/invoice-search-dialog[^"]*shadow-2xl/.test(pickers), 'ما زال للقائمة ظل عازل')
  const overlay = css.match(/\.invoice-search-overlay\s*\{[^}]*\}/)?.[0] ?? ''
  assert.ok(/background:\s*transparent/.test(overlay), `غلاف القائمة غير شفاف: ${overlay}`)
  assert.ok(/backdrop-filter:\s*none/.test(overlay), 'ما زال الطمس مفعّلاً خلف القائمة')
  const dialog = css.match(/\.invoice-search-dialog\s*\{[^}]*\}/)?.[0] ?? ''
  assert.ok(/box-shadow:\s*none/.test(dialog), `ما زال للوحة النتائج ظل: ${dialog}`)
})

check('نتائج البحث معلنة لقارئ الشاشة', () => {
  assert.ok(/role="combobox"/.test(pickers), 'حقل البحث لا يعلن أنه صندوق تحرير وسرد')
  assert.equal(pickers.match(/role="listbox"/g)?.length, 2, 'قائمتا الأصناف والأطراف لا تحملان role=listbox')
  assert.ok(/role="option"/.test(pickers) && /aria-selected=\{row === index\}/.test(pickers), 'النتائج بلا role=option/aria-selected')
  assert.ok(/aria-activedescendant=\{matches\[index\]/.test(pickers), 'لا إعلان للعنصر النشط أثناء التنقل بالأسهم')
})

check('سلسلة الإدخال بلا فأرة محفوظة في الجدول', () => {
  assert.ok(/gridArrowNavigation/.test(table), 'لا تنقّل بالأسهم داخل الجدول')
  assert.ok(/data-enter-native="true"/.test(pickers), 'Enter العام لا يُترك ينقل التركيز بعد الاختيار')
})

check('خمسة سطور نظيفة والمساحة الباقية للوحات الثلاث (⑩ح)', () => {
  assert.ok(/const VISIBLE_ROWS = Math\.max\(MIN_VISIBLE_ROWS, TARGET_VISIBLE_ROWS\)/.test(table) && /MIN_VISIBLE_ROWS = 5/.test(table),
    'عدد السطور الظاهرة ليس ستة')
  assert.ok(/rows\.reduce/.test(table) && /setBoxMaxHeight/.test(table), 'ارتفاع الجدول غير مقيس من ارتفاع السطور — قد يظهر نصف سطر')
  assert.ok(!/invoice-line-ghost-in/.test(table) && !/invoice-line-ghost-in/.test(css), 'عادت مربعات (تسطيرات) السطور الفارغة')
  /* قرار المالك ⑩ي: نقرة واحدة تُحدِّد الخلية فقط، والنقر المزدوج (أو الكتابة/Enter) يفتح البحث. */
  assert.ok(/ghostCell = \(label: string/.test(table) && /onClick=\{focusEntry\}/.test(table) && /onDoubleClick=\{openPicker\}/.test(table),
    'خلايا السطر الفارغ لا تتبع قاعدة «نقرة تحدّد ونقرتان تفتحان»')
  assert.ok(!/onMouseDown=\{\(event\) => \{ event\.preventDefault\(\); openPicker\(\) \}\}/.test(table),
    'عادت النقرة الواحدة تفتح بحث الصنف')
  const grid = css.match(/\.invoice-pos-document \.invoice-body-grid \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/grid-template-rows: minmax\(0, auto\) minmax\(min-content, 1fr\)/.test(grid),
    'صف اللوحات لا يتمدد لمحتواه — سيختفي جزء أسفل اللوحات')
  const panel = css.match(/\.invoice-pos-document \.invoice-doc-panel \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/min-height: min-content/.test(panel) && /max-height: none/.test(panel) && /height: 100%/.test(panel),
    'اللوحات الثلاث تُقصّ بدل أن تأخذ ارتفاع محتواها (قرار المالك ⑩ي: ممنوع اختفاء أي جزء)')
  const panelBody = css.match(/\.invoice-pos-document \.invoice-doc-panel-body \{[^}]*\}/)?.[0] ?? ''
  assert.ok(/overflow: visible/.test(panelBody), 'جسم اللوحة يُمرَّر داخلياً فيختفي أسفلها')
  assert.ok(/\.invoice-doc \.invoice-doc-amountfield \{ height: 2\.1rem; \}/.test(css), 'حقل المبلغ لم يكبر')
})

check('لا نص يُبتر بثلاث نقاط في المستند (تكيّف كامل مع المقاس)', () => {
  for (const selector of ['.invoice-doc .invoice-doc-fields .field-head > label', '.invoice-doc .invoice-doc-identity > small, .invoice-doc .invoice-doc-identity small',
    '.invoice-doc .invoice-lines-hint', '.invoice-doc .invoice-doc-party .invoice-doc-metric > b']) {
    const head = selector.split(',')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rule = css.match(new RegExp(`${head}[^{]*\\{[^}]*\\}`))?.[0] ?? ''
    /* قرار المالك ⑩ح: تسميات حقول الترويسة لا تلتف (سطر واحد) — وما عداها يلتف.
       المشترك بينهما: لا بتر بثلاث نقاط أبداً. */
    const noWrapLabel = selector.includes('invoice-doc-fields')
    assert.ok(/text-overflow: clip/.test(rule), `ما زال يُبتر: ${selector}`)
    assert.ok(new RegExp(noWrapLabel ? 'white-space: nowrap' : 'white-space: normal').test(rule), noWrapLabel ? `تسمية الحقل عادت تلتف: ${selector}` : `النص لا يلتف بل يُقصّ: ${selector}`)
    if (noWrapLabel) assert.ok(/overflow: visible/.test(rule), `تسمية الحقل بلا التفاف يجب أن تبقى ظاهرة كاملة: ${selector}`)
  }
})

console.log(`✅ سلوك جدول الأصناف — ${checks.length}/7`)
checks.forEach((name, i) => console.log(`   ${i + 1}. ${name}`))
