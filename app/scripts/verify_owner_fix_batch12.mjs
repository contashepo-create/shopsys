/* بوابة بلاغات المالك ⑫:
   ① خطوط الإيصال الحراري واضحة (لا رمادي ولا أصغر من 10.5px)
   ② أزرار حذف المصروف/العمولة أهداف نقر مسمّاة تعمل
   ③ لا تحديد لنص المستند خارج الحقول
   ④ القوائم ≤١٠ بنود منسدلة أصلية لا حقل كتابة */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('بلاغات المالك ⑫ — الطباعة والحذف والتحديد والقوائم')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const receipt = read('ui/print/printReceipt.ts')
const css = read('index.css')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const expenses = read('ui/components/PurchaseExpenseManager.tsx')
const pickers = read('ui/components/KeyboardPickers.tsx')

/* ① الإيصال الحراري */
{
  const body = receipt.replace(/\/\*[\s\S]*?\*\//g, '')
  const sizes = [...body.matchAll(/font-size: \$\{wide \? '([\d.]+)px' : '([\d.]+)px'\}/g)].flatMap((m) => [Number(m[1]), Number(m[2])])
  assert.ok(sizes.length >= 10, 'مقاسات خطوط الإيصال غير متوقعة')
  const min = Math.min(...sizes)
  assert.ok(min >= 10.5, `أصغر خط في الإيصال ${min}px — لا يُطبع بوضوح على الطابعة الحرارية`)
  assert.ok(!/color: #333|color: #6[0-9a-f]{2}|color: #9[0-9a-f]{2}/.test(body), 'ما زال في الإيصال نص رمادي لا يُطبع بوضوح')
  assert.ok(/print-color-adjust: exact/.test(body) && /text-rendering: geometricPrecision/.test(body),
    'الإيصال بلا ضبط ألوان/حِدّة للطباعة')
  assert.ok(/font-weight: 600/.test(body), 'النص الأساسي في الإيصال خفيف الوزن')
  R.ok(`خطوط الإيصال الحراري كلها سوداء وأصغرها ${min}px`)
}
/* ② أزرار الحذف */
{
  assert.ok(/\.doc-row-delete \{[\s\S]{0,240}width: 1\.9rem; height: 1\.9rem/.test(css), 'زر حذف المصروف بلا هدف نقر مريح')
  const buttons = [...sales.matchAll(/className="doc-row-delete"[^>]*aria-label="([^"]+)"[^>]*title="([^"]+)"/g)]
  assert.ok(buttons.length >= 3, `أزرار الحذف المسمّاة في الفاتورة ${buttons.length} — المتوقع ٣ على الأقل`)
  assert.ok(/aria-label="حذف المصروف" title="[^"]+" className="doc-row-delete"/.test(expenses), 'زر حذف مصروف الشراء غير مسمّى أو بلا هدف نقر')
  assert.ok(/onChange\(expenses\.filter\(\(_, row\) => row !== index\)\); toast\.show/.test(expenses), 'حذف مصروف الشراء بلا تأكيد مرئي')
  assert.ok(/setCustomerCharges\(customerCharges\.filter\(\(_,i\) => i !== index\)\); toast\.show/.test(sales),
    'حذف مصروف العميل بلا تأكيد مرئي')
  R.ok('أزرار الحذف الثلاثة: هدف ١.٩rem + تسمية + تلميح + إشعار بعد الحذف')
}
/* ③ التحديد */
{
  assert.ok(/\.invoice-doc, \.invoice-editor, \.invoice-pos-document, \.invoice-shell \{\s*-webkit-user-select: none; user-select: none;/.test(css),
    'نص المستند ما زال قابلاً للتحديد كاملاً')
  assert.ok(/\.invoice-doc input, \.invoice-doc textarea, \.invoice-doc select[\s\S]{0,700}user-select: text/.test(css),
    'الحقول فقدت إمكانية تحديد نصها')
  R.ok('التحديد داخل الحقول فقط — لا تحديد لنص المستند')
}
/* ④ القوائم القصيرة */
{
  assert.ok(/if \(choices\.length > 0 && choices\.length <= 10\) \{/.test(pickers), 'لا تتحول القوائم القصيرة إلى منسدلة أصلية')
  assert.ok(/<select[\s\S]{0,400}quick-native-select[\s\S]{0,400}<\/select>/.test(pickers), 'القائمة القصيرة لا تستعمل <select> أصلي')
  assert.ok(/data-quick-native="true"/.test(pickers), 'القائمة الأصلية بلا سمة تعريف للاختبارات')
  assert.ok(/function nodeText\(node: ReactNode\): string/.test(pickers), 'نص الخيار قد يظهر [object Object] في القائمة الأصلية')
  assert.ok(/\.quick-native-select \{[\s\S]{0,180}appearance: none/.test(css) && /\.quick-native-arrow \{/.test(css),
    'القائمة الأصلية بلا سهم منسدل واضح')
  R.ok('القوائم ≤١٠ بنود منسدلة أصلية بسهم، والأطول تبقى بحثاً')
}
R.done()
