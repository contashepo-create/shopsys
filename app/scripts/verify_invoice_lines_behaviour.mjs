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

console.log(`✅ سلوك جدول الأصناف — ${checks.length}/5`)
checks.forEach((name, i) => console.log(`   ${i + 1}. ${name}`))
