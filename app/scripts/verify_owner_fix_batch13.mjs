/* بوابة دفعة المالك ⑬:
   ① لا تُكتب «معفى/معفي» ولا ما شابهها في أي فاتورة (شاشة أو طباعة)
   ② الإدخال الذكي بسطر واحد: أرز*3@65-5%
   ③ اختصارات السطر: Ctrl+D تكرار · Alt+↑↓ نقل · Ctrl+Delete حذف */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑬ — بلا «معفى» + الإدخال الذكي + اختصارات السطر')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const table = read('ui/components/InvoiceLinesTable.tsx')
const receiptTpl = read('ui/print/printReceipt.ts')
const a4 = read('ui/print/printInvoiceA4.ts')
const receiptModel = read('core/receipt.ts')
const pickers = read('ui/components/KeyboardPickers.tsx') + read('ui/components/smartEntry.ts')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')

/* ① لا كلمة إعفاء في الفاتورة */
{
  for (const [name, src] of [['جدول البنود', table], ['الإيصال الحراري', receiptTpl], ['فاتورة A4', a4], ['نموذج الإيصال', receiptModel]])
    assert.ok(!/['"`>]\s*معف[يى]/.test(strip(src)), `ما زالت كلمة «معفى» تُطبع في ${name}`)
  assert.ok(/vatPercent \?\? documentTaxPercent\) > 0 \? <span className="invoice-doc-taxchip">/.test(table),
    'شريحة الضريبة تظهر حتى بلا ضريبة')
  assert.ok(/r\.vatPercent != null && r\.vatPercent > 0 \? ` · ض\. \$\{r\.vatPercent\}٪` : ''/.test(receiptTpl),
    'الإيصال يطبع وصف ضريبة لسطر بلا ضريبة')
  assert.ok(/const vatLabel = vatSet\.filter\(\(p\) => p > 0\)/.test(receiptModel),
    'ملخص الضريبة يركّب نسباً صفرية')
  assert.ok(/totals\.taxMinor > 0 && vatLabel/.test(receiptModel), 'قد يُطبع سطر ضريبة بلا نسبة موجبة')
  R.ok('لا «معفى» ولا سطر ضريبة فارغ في الشاشة ولا في الطباعة')
}
/* ② الإدخال الذكي */
{
  assert.ok(/export function parseSmartEntry\(raw: string\): SmartEntry/.test(pickers), 'محلّل الإدخال الذكي مفقود')
  assert.ok(/const smart = useMemo\(\(\) => parseSmartEntry\(query\)/.test(pickers), 'لوحة البحث لا تستعمل الإدخال الذكي')
  assert.ok(/const pickSmart = \(id: number\) => onPick\(id,/.test(pickers), 'الاختيار لا يمرّر الكمية والسعر والخصم')
  for (const [name, src] of [['المبيعات', sales], ['المشتريات', purchase]])
    assert.ok(/addItem=\(id:number,smart\?:\{qty\?:number;price\?:number;discount\?:number\}\)/.test(src),
      `صفحة ${name} لا تطبّق الإدخال الذكي`)
  assert.ok(/qty:smart\?\.qty&&smart\.qty>0\?smart\.qty:1/.test(sales) && /discountPercent:smart\?\.discount\?\?0/.test(sales),
    'الكمية/الخصم من الإدخال الذكي لا تُطبَّق في المبيعات')
  R.ok('«أرز*3@65-5%» يملأ الصنف والكمية والسعر والخصم في البيع والشراء')
}
/* ③ اختصارات السطر */
{
  assert.ok(/event\.ctrlKey && event\.key\.toLowerCase\(\) === 'd'/.test(table), 'Ctrl+D لا يكرر السطر')
  assert.ok(/event\.ctrlKey && \(event\.key === 'Delete' \|\| event\.key === 'Backspace'\)/.test(table), 'Ctrl+Delete لا يحذف السطر')
  assert.ok(/event\.altKey && \(event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'\)/.test(table), 'Alt+↑↓ لا ينقل السطر')
  assert.ok(/data-line-key=\{line\.key\}/.test(table), 'صف الجدول بلا مفتاح يُعرف به السطر')
  for (const [name, src] of [['المبيعات', sales], ['المشتريات', purchase]])
    assert.ok(/onMoveLine=\{\(key, direction\) =>/.test(src), `صفحة ${name} لا تدعم نقل السطر`)
  R.ok('اختصارات السطر: تكرار ونقل وحذف من داخل الجدول')
}
R.done()
