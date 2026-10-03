/* بوابة إجراءات المنتهي الصلاحية (طلب المالك ㉘): لوحة فرز بثلاث مخارج
   (إتلاف 5111 / مرتجع للمورد من فاتورة الأصل / بيع تصريف بفاتورة مسبقة التعبئة)
   لا مجرد تنبيه يُقرأ ويُنسى. */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants } from './auditKit.mjs'
import { readFileSync } from 'node:fs'
import { expiryAlerts } from '../src/core/batches.ts'

const R = reporter('المنتهي الصلاحية — فرز بثلاثة إجراءات')
const wastagePage = readFileSync(new URL('../src/ui/pages/WastagePage.tsx', import.meta.url), 'utf8')
const returnsPage = readFileSync(new URL('../src/ui/pages/PurchaseReturnsPage.tsx', import.meta.url), 'utf8')
const salesInvoicePage = readFileSync(new URL('../src/ui/pages/AdvancedSalesInvoicePage.tsx', import.meta.url), 'utf8')
const windowStore = readFileSync(new URL('../src/ui/windows/windowStore.ts', import.meta.url), 'utf8')
const batches = readFileSync(new URL('../src/core/batches.ts', import.meta.url), 'utf8')

/* ① لوحة الفرز: جدول لكل صنف منتهٍ + أزرار الإجراءات الثلاثة */
{
  assert.ok(wastagePage.includes('data-expired-triage'), 'لوحة فرز المنتهي غير موجودة')
  for (const marker of ['إتلاف', 'مرتجع للمورد', 'بيع تصريف']) {
    assert.ok(wastagePage.includes(marker), `زر «${marker}» مفقود من لوحة الفرز`)
  }
  assert.ok(wastagePage.includes('انتهت في'), 'جدول الفرز بلا عمود تاريخ الانتهاء')
  assert.ok(/القيمة بالتكلفة|قيمة بالتكلفة|بالتكلفة/.test(wastagePage), 'جدول الفرز بلا قيمة بالتكلفة')
  /* مرتجع للمورد يعتمد وجود فاتورة شراء سابقة للصنف ويعطَّل بدونها */
  assert.ok(/purchases/.test(wastagePage) && /reverse\(\)\.find/.test(wastagePage), 'مصدر فاتورة الأصل (آخر شراء للصنف) غير مطلوب')
  assert.ok(/disabled/.test(wastagePage), 'زر المرتجع لا يُعطَّل عند غياب فاتورة الأصل')
  R.ok('اللوحة: جدول (كمية/تاريخ/قيمة) + 3 أزرار + تعطيل المرتجع بلا فاتورة أصل')
}

/* ② مسار المرتجع: رابط بprefill يختار الفاتورة ويملأ الكمية والمخزن والسبب */
{
  assert.ok(returnsPage.includes("searchParams.get('purchase')"), 'مرتجع الشراء لا يقرأ ?purchase=')
  assert.ok(returnsPage.includes("searchParams.get('item')") && returnsPage.includes("searchParams.get('qty')"), 'مرتجع الشراء لا يقرأ ?item/?qty')
  assert.ok(returnsPage.includes('انتهاء صلاحية — إرجاع للمورد'), 'سبب المرتجع المسبق مفقود')
  assert.ok(returnsPage.includes("setSearchParams({}, { replace: true })"), 'مسح معاملات الprefill بعد التعبئة مفقود')
  assert.ok(wastagePage.includes('/purchases/returns?purchase='), 'رابط الفرز إلى المرتجع غير مكتمل (purchase/item/qty)')
  R.ok('المرتجع: ?purchase&item&qty ← فاتورة مختارة + كمية ومخزن وسبب مملوءة ثم تُمسح')
}

/* ③ مسار بيع التصريف: نافذة فاتورة بيع مسبقة التعبئة بلا نقدي تلقائي */
{
  assert.ok(/SalesInvoicePrefill/.test(windowStore), 'نوع prefill مفقود من مخزن النوافذ')
  assert.ok(/openSalesInvoiceWindow\(undefined, \{/.test(wastagePage), 'بيع التصريف لا يفتح فاتورة بprefill')
  assert.ok(wastagePage.includes('lines: [{ itemId, qty: row.qty }'), 'prefill الفاتورة لا يحمل الصنف والكمية')
  assert.ok(salesInvoicePage.includes('prefill'), 'صفحة فاتورة البيع لا تستهلك prefill')
  assert.ok(salesInvoicePage.includes('paidTouched.current=true'), 'بيع التصريف يملأ النقدي تلقائياً — يجب أن يبقى فارعاً للمراجعة')
  assert.ok(/dedupeKey/.test(windowStore) && /prefill/.test(windowStore), 'نافذة الprefill بلا مفتاح منع تكرار')
  R.ok('بيع التصريف: openSalesInvoiceWindow(prefill{lines}) ← مسودة بند واحد بلا نقدي تلقائي')
}

/* ④ نواة التنبيهات: expiryAlerts تصنف بالحالة والكمية من الدفعات */
{
  assert.ok(/ExpiryAlertRow/.test(batches), 'نوع صف تنبيه الانتهاء مفقود')
  assert.ok(/expired|منتهي/.test(batches), 'لا تصنيف للحالة المنتهية')
  R.ok('نواة expiryAlerts موجودة بصفوف صنف/تاريخ/كمية/حالة')
}

/* ⑤ رحلة الإتلاف على متجر نظيف: شراء بدفعة منتهية ← تنبيه ← إتلاف يقيد 5111 ويُنقص المخزون */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addSupplier({ nameAr: 'مورد الألبان', phone: '', notes: '' })
  g().addItem({ nameAr: 'زبادي سائب', categoryId: null, unit: 'كرتونة', priceMinor: 30000, barcode: '', sku: 'ZB-1', isActive: true, trackExpiry: true, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 20000, stockQty: 0 })
  const supplier = g().suppliers[0]
  const item = g().items[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  g().postPurchase({
    supplierId: supplier.id, date: new Date().toISOString().slice(0, 10), receiptStatus: 'received',
    notes: 'دفعة قصيرة الصلاحية',
    lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 20000, vatPercent: 0, warehouseId: null, expiryDate: yesterday }],
    expenses: [], paidMinor: 100000, treasury: '1101',
  })
  assert.equal(g().items.find((x) => x.id === item.id).stockQty, 5, 'الشراء لم يرفع المخزون')
  const alerts = expiryAlerts(g().batches, (id) => g().items.find((x) => x.id === id)?.nameAr ?? '—', new Date().toISOString())
  const hit = alerts.find((row) => row.itemId === item.id)
  assert.ok(hit && hit.qty >= 5, 'التنبيه لا يرصد الدفعة المنتهية')
  /* الإتلاف */
  const doc = g().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: item.id, qty: 5 }], notes: 'فرز الهالك' })
  assert.ok(doc, 'سند الإتلاف لم يُنشأ')
  assert.equal(g().items.find((x) => x.id === item.id).stockQty, 0, 'الإتلاف لم يُنقص المخزون')
  const wastageEntry = g().journal.find((e) => e.sourceType === 'wastage' && e.sourceId === doc.id)
  assert.ok(wastageEntry, 'لا قيد للإتلاف')
  assert.ok(wastageEntry.lines.some((l) => l.accountCode === '5111' && l.debit > 0), 'الإتلاف لا يقيَّد على 5111 هالك')
  assert.ok(wastageEntry.lines.some((l) => l.accountCode === '1103' && l.credit > 0), 'الإتلاف لا يُخرج البضاعة من 1103 مخزون')
  assertInvariants('بعد إتلاف دفعة منتهية', c)
  R.ok('رحلة الإتلاف: تنبيه ← سند 5111/1103 متزن ونقص مخزون')
}

R.done()
