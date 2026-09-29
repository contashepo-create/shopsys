/* بوابة لوحة الأوامر وخريطة الاختصارات (الموجة ① من خطة UX):
   موجودة · مربوطة بمصدر التنقل الموحَّد · بلا تعتيم للخلفية · لا تمسّ الفاتورة. */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('لوحة الأوامر وخريطة الاختصارات')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const palette = read('ui/components/CommandPalette.tsx')
const shortcuts = read('ui/shortcutMap.ts')
const layout = read('ui/layout/MainLayout.tsx')
const nav = read('ui/hooks/useNavSections.ts')
const css = read('index.css')

{
  assert.ok(/key === 'k'.*setOpen/s.test(palette), 'Ctrl+K لا يفتح اللوحة')
  assert.ok(/key === '\/' \|\| event\.key === '؟'/.test(palette), 'Ctrl+/ لا يفتح خريطة الاختصارات (ولا يدعم لوحة عربية)')
  assert.ok(/if \(!event\.ctrlKey \|\| event\.altKey \|\| event\.metaKey\) return/.test(palette),
    'الاختصار غير مقيَّد بـCtrl وحده فيصطدم باختصارات النوافذ')
  assert.ok(/<CommandPalette \/>/.test(layout), 'اللوحة غير مركَّبة في التخطيط الرئيسي')
  R.ok('Ctrl+K وCtrl+/ مفعَّلان ومركَّبان في كل الشاشات')
}
{
  assert.ok(/useNavSections/.test(palette) && /canAccessPath/.test(nav),
    'اللوحة لا تستعمل مصدر التنقل الموحَّد المراعي للصلاحيات')
  for (const rx of [/const customers = useDataStore/, /const suppliers = useDataStore/, /const items = useDataStore/])
    assert.ok(rx.test(palette), 'اللوحة لا تبحث في العملاء والموردين والأصناف')
  assert.ok(/openSalesInvoiceWindow\(\)/.test(palette) && /openPurchaseInvoiceWindow\(\)/.test(palette),
    'أوامر فتح الفواتير مفقودة من اللوحة')
  R.ok('تبحث في الشاشات المصرَّح بها والعملاء والموردين والأصناف والأوامر')
}
{
  assert.ok(/const norm = \(value: string\) => value\.replace\(\/\[أإآ\]\/g, 'ا'\)/.test(palette),
    'البحث لا يوحّد الهمزات والتاء المربوطة')
  assert.ok(/aria-label="لوحة الأوامر"/.test(palette) && /role="listbox"/.test(palette) && /role="option"/.test(palette),
    'اللوحة بلا أدوار وصول (ARIA)')
  R.ok('بحث عربي متسامح مع الهمزات + أدوار وصول كاملة')
}
{
  /* قاعدة المالك: لا تعتيم ولا عزل للخلفية */
  const block = css.slice(css.indexOf('.command-palette {'), css.indexOf('.shortcut-map {'))
  assert.ok(!/position: fixed;[\s\S]{0,200}inset: 0/.test(block), 'طبقة تعتيم خلف لوحة الأوامر — ممنوع')
  assert.ok(!/rgba?\(0, ?0, ?0, ?0?\.[3-9]/.test(block), 'خلفية معتمة خلف اللوحة — ممنوع')
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{ \.command-palette, \.shortcut-map/.test(css),
    'اللوحة لا تحترم تقليل الحركة')
  R.ok('بلا تعتيم للخلفية وتحترم تفضيل تقليل الحركة')
}
{
  const keys = shortcuts.match(/'(Ctrl [^']+|F\d|Esc|Enter|الأسهم|نقرتان[^']*)'/g) ?? []
  assert.ok(keys.length >= 12, `خريطة الاختصارات ناقصة (${keys.length})`)
  for (const key of ['Ctrl + K', 'Ctrl + Alt + W', 'Ctrl + Alt + 1..9', 'Ctrl + Alt + M', 'F9', 'F8', 'F6'])
    assert.ok(shortcuts.includes(key), `اختصار غير موثَّق: ${key}`)
  R.ok('خريطة الاختصارات توثّق مفاتيح العام والنوافذ والفاتورة')
}
{
  /* لا تمسّ تقسيم الفاتورة (قرار المالك) */
  assert.ok(!/invoice-doc|invoice-body-grid|invoice-lines-column/.test(palette),
    'لوحة الأوامر تعدّل بنية الفاتورة — ممنوع بقرار المالك')
  R.ok('لا مساس بتقسيم الفاتورة')
}
R.done()
