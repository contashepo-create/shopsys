/* بوابة أوامر الشراء وزر «تعبئة من» (طلب المالك) */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('أوامر الشراء وتعبئة الفاتورة من مستند')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const core = read('core/purchaseOrders.ts')
const repo = read('data/repo.ts')
const page = read('ui/pages/PurchaseOrdersPage.tsx')
const app = read('App.tsx')
const nav = read('ui/navCatalog.tsx')
const picker = read('ui/components/FillFromPicker.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')

{
  for (const rx of [/export interface PurchaseOrder\b/, /export interface PurchaseOrderLine/, /PURCHASE_ORDER_STATUS_AR/, /export function validatePurchaseOrder/, /export function derivePurchaseOrderStatus/])
    assert.ok(rx.test(core), 'نموذج أمر الشراء ناقص')
  assert.ok(/أمر الشراء \*\*التزام تجاري لا قيد محاسبي\*\*/.test(core), 'لم يوثَّق أن أمر الشراء بلا قيد محاسبي')
  R.ok('نموذج أمر الشراء: بنود بكميات وأسعار وضريبة وحالات — بلا قيد محاسبي')
}
{
  assert.ok(/purchaseOrders: PurchaseOrder\[\]/.test(repo) && /addPurchaseOrder: \(/.test(repo), 'المتجر بلا أوامر شراء')
  assert.ok(/receivePurchaseOrder: \(/.test(repo), 'لا تسجيل للمستلم من الأمر')
  assert.ok(/derivePurchaseOrderStatus\(next\)/.test(repo), 'حالة الأمر لا تُشتق من المستلم')
  /* لا يجوز أن ينشئ أمر الشراء قيداً */
  const block = repo.slice(repo.indexOf('addPurchaseOrder: (input)'), repo.indexOf('deletePurchaseOrder:'))
  assert.ok(!/postEntry|buildEntry|journal/i.test(block), 'أمر الشراء يجب ألا يُنشئ قيداً محاسبياً')
  R.ok('المتجر: إنشاء واستلام وحالات — وبلا أي قيد محاسبي')
}
{
  assert.ok(/data-po-list/.test(page) && /data-po-row/.test(page), 'صفحة أوامر الشراء بلا معرّفات فحص')
  assert.ok(/<Route path="\/purchases\/orders"/.test(app), 'المسار غير مسجَّل')
  assert.ok(/nameAr: 'أوامر الشراء', icon: ClipboardList, path: '\/purchases\/orders'/.test(nav), 'القسم غير مضاف لشريط القوائم')
  R.ok('قسم «أوامر الشراء» في القائمة وله صفحة كاملة')
}
{
  assert.ok(/data-fill-from-open/.test(picker) && /data-fill-from-panel/.test(picker), 'زر «تعبئة من» بلا معرّفات')
  assert.ok(/'أوامر الشراء' \| 'عروض الأسعار' \| 'المشاريع'/.test(picker), 'مصادر التعبئة ناقصة')
  assert.ok(/extra=\{<FillFromPicker sources=\{fillSources\}\/>\}/.test(purchase), 'فاتورة الشراء بلا زر تعبئة')
  assert.ok(/extra=\{<FillFromPicker sources=\{fillSources\}\/>\}/.test(sales), 'فاتورة البيع بلا زر تعبئة')
  assert.ok(/group:'عروض الأسعار'/.test(sales) && /group:'المشاريع'/.test(sales), 'فاتورة البيع لا تُعبَّأ من عرض سعر أو مشروع')
  assert.ok(/receivePurchaseOrder\(sourceOrderId/.test(purchase), 'ترحيل فاتورة الشراء لا يحدّث أمر الشراء')
  const css = read('index.css')
  assert.ok(/\.fillfrom-panel \{[\s\S]{0,300}position: absolute/.test(css) && !/\.fillfrom-panel[\s\S]{0,200}inset: 0/.test(css),
    'لوحة «تعبئة من» يجب أن تكون عائمة بلا تعتيم')
  R.ok('«تعبئة من»: أمر شراء للمشتريات · عرض سعر/مشروع للمبيعات — مع تحديث المستلم')
}
R.done()
