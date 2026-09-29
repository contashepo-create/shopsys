/* بوابة دفعة المالك ⑭:
   ① التطبيق كله لا يُعامَل كنص (التحديد داخل الحقول فقط)
   ② لا كلمة «معفى» تُطبع في أي مستند أو شاشة بيع
   ③ عدّاد الأرقام الحي في إجماليات الفاتورتين */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑭ — بلا تحديد نص · بلا «معفى» · عدّاد حي')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const css = read('index.css')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const counter = read('ui/components/AnimatedMinor.tsx')

/* ① لا تحديد في أي شاشة */
{
  assert.ok(/html, body, #root \{\s*-webkit-user-select: none; user-select: none;/.test(css),
    'التطبيق ما زال يُعامَل كنص قابل للتحديد')
  assert.ok(/input, textarea, select, option,[\s\S]{0,220}user-select: text;/.test(css),
    'الحقول فقدت إمكانية تحديد نصها')
  assert.ok(/\[data-selectable\], \[data-selectable\] \*/.test(css), 'لا مخرج صريح لتحديد نص مسموح')
  assert.ok(/@media print \{ \* \{ -webkit-user-select: text !important/.test(css), 'الطباعة يجب أن تبقى نصاً كاملاً')
  R.ok('التحديد داخل الحقول فقط في كل التطبيق — والطباعة نص كامل')
}
/* ② لا «معفى» معروضة */
{
  const screens = ['ui/pages/PosPage.tsx', 'ui/pages/PurchasesPage.tsx', 'ui/pages/SalesInvoicesPage.tsx',
    'ui/components/InvoiceLinesTable.tsx', 'ui/print/printReceipt.ts', 'ui/print/printInvoiceA4.ts', 'core/receipt.ts']
  for (const file of screens) {
    const body = strip(read(file))
    assert.ok(!/[:?]\s*'معف[يى]'/.test(body) && !/>\s*معف[يى]\s*</.test(body) && !/`[^`]*معف[يى][^`]*`/.test(body),
      `ما زالت كلمة «معفى» تُعرض في ${file}`)
  }
  R.ok('لا كلمة «معفى» في الفواتير ولا الكاشير ولا الطباعة (تبقى في إعدادات الضريبة فقط)')
}
/* ③ العدّاد الحي */
{
  assert.ok(/export function useAnimatedMinor/.test(counter) && /export function AnimatedMinor/.test(counter), 'مكوّن العدّاد الحي مفقود')
  assert.ok(/prefers-reduced-motion: reduce/.test(counter), 'العدّاد لا يحترم تقليل الحركة')
  for (const [name, src] of [['المبيعات', sales], ['المشتريات', purchase]]) {
    assert.ok(/<AnimatedMinor value=\{v\} format=\{minor=>formatMinor\(minor,cur,false\)\}\/>/.test(src),
      `سطور ملخص ${name} بلا عدّاد حي`)
    assert.ok(/invoice-doc-grand[\s\S]{0,160}<AnimatedMinor/.test(src), `الإجمالي الكبير في ${name} بلا عدّاد حي`)
  }
  assert.ok(/\.money-counter \{[\s\S]{0,180}tabular-nums/.test(css), 'أرقام العدّاد غير ثابتة العرض فتهتزّ')
  R.ok('إجماليات الفاتورتين تعدّ حيّاً بنبضة خفيفة وبأرقام ثابتة العرض')
}
R.done()
