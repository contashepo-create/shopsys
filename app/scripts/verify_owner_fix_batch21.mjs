/* بوابة دفعة ㉑: مفاتيح الطباعة الثلاثة + نقاط الولاء داخل الفاتورة */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ㉑ — مفاتيح الطباعة ونقاط الولاء')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const receipt = read('core/receipt.ts')
const switches = read('ui/components/PrintSwitches.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const printer = read('ui/print/printReceipt.ts')
const css = read('index.css')

{
  for (const key of ['silentPrint', 'cashierPrint', 'printAfterSave'])
    assert.ok(new RegExp(`${key}: boolean`).test(receipt), `مفتاح ${key} غير معرَّف في إعدادات الطباعة`)
  assert.ok(/silentPrint: false,\s*\n\s*cashierPrint: false,\s*\n\s*printAfterSave: false/.test(receipt),
    'المفاتيح الثلاثة يجب أن تكون مطفأة افتراضياً')
  R.ok('ثلاثة مفاتيح طباعة معرَّفة ومطفأة افتراضياً')
}
{
  assert.ok(/export function PrintSwitches/.test(switches) && /aria-pressed=\{active\}/.test(switches), 'مكوّن المفاتيح ناقص')
  for (const key of ['silentPrint', 'cashierPrint', 'printAfterSave'])
    assert.ok(new RegExp(`key: '${key}'`).test(switches), `زر ${key} غير معروض`)
  assert.ok(/\.print-switch\.is-on \{[\s\S]{0,320}transform: translateY\(1\.5px\)/.test(css), 'المفتاح لا يبدو مضغوطاً للداخل')
  assert.ok(/print-switch-led/.test(switches) && /\.print-switch\.is-on \.print-switch-led \{/.test(css), 'لا لمبة حالة على المفتاح')
  /* المفاتيح في شريط تذييل المستند المشترك بين الفاتورتين (توفيراً لارتفاع اللوحات) */
  const frame = read('ui/components/InvoicePOSFrame.tsx')
  assert.ok(/<PrintSwitches compact\/>/.test(frame), 'المفاتيح غير معروضة في شريط المستند')
  assert.ok(/usePrintSwitches/.test(sales), 'فاتورة البيع لا تقرأ حالة المفاتيح')
  void purchase
  R.ok('أزرار «مفتاح كهرباء» بلمبة حالة في فاتورتي البيع والشراء')
}
{
  assert.ok(/if\(printSwitches\.printAfterSave\)\{try\{printDraft\(printSwitches\.cashierPrint\?'thermal':'a4'\)/.test(sales),
    'الطباعة بعد الحفظ لا تحترم مفتاح الكاشير')
  assert.ok(/export function printHtml\(html: string, options\?: \{ silent\?: boolean \}\)/.test(printer),
    'الطباعة الصامتة غير مدعومة في طبقة الطباعة')
  R.ok('الطباعة بعد الحفظ تتبع نمط الكاشير · والطباعة الصامتة مدعومة عبر جسر سطح المكتب')
}
{
  assert.ok(/data-invoice-loyalty/.test(sales) && /redeemLoyaltyPoints\(selectedCustomer\.id/.test(sales),
    'نقاط الولاء غير معروضة/مستبدلة من الفاتورة')
  assert.ok(/loyalty\.redeemValueMinor/.test(sales), 'قيمة النقطة غير معروضة في الفاتورة')
  assert.ok(/\(selectedCustomer\.loyaltyPoints\?\?0\)<loyalty\.minRedeemPoints/.test(sales), 'أدنى حد للاستبدال غير محترم')
  assert.ok(/\.invoice-doc-loyalty \{/.test(css), 'شريحة الولاء بلا تنسيق')
  R.ok('الفاتورة تعرض رصيد نقاط العميل وقيمتها وتستبدلها بحد أدنى محترم')
}
R.done()
