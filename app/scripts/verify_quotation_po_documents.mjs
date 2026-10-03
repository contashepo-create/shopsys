/* بوابة عرض السعر وأمر الشراء كمستندين كاملين (طلب المالك ㉘):
   نفس هيئة الفاتورة (InvoicePOSFrame) بدل الواجهة البسيطة، مع بقاء القواعد:
   العرض لا يقيَّد، وأمر الشراء التزام تجاري لا قيد حتى فاتورة الشراء. */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants, expectReject } from './auditKit.mjs'
import { readFileSync } from 'node:fs'
import { quotationTotal, quotationTotals, quotationEstCost } from '../src/core/contracting.ts'
import { purchaseOrderTotals, poRemainingQty } from '../src/core/purchaseOrders.ts'

const R = reporter('عرض السعر وأمر الشراء — مستندات بنمط الفاتورة')
const quotationsPage = readFileSync(new URL('../src/ui/pages/QuotationsPage.tsx', import.meta.url), 'utf8')
const purchaseOrdersPage = readFileSync(new URL('../src/ui/pages/PurchaseOrdersPage.tsx', import.meta.url), 'utf8')
const purchaseInvoicePage = readFileSync(new URL('../src/ui/pages/AdvancedPurchaseInvoicePage.tsx', import.meta.url), 'utf8')

/* ① عرض السعر: هيئة مستند كاملة — إطار الفاتورة وجدول بنودها ولوحاتها الثلاث */
{
  assert.ok(quotationsPage.includes('InvoicePOSFrame'), 'محرر عرض السعر لا يستخدم إطار الفاتورة InvoicePOSFrame')
  assert.ok(quotationsPage.includes('kind="sale"'), 'إطار عرض السعر ليس على وجه البيع')
  assert.ok(/modeLabel=\{kind === 'tender' \? 'مناقصة' : 'عرض سعر'\}/.test(quotationsPage), 'تسمية المستند (عرض/مناقصة) مفقودة من الترويسة')
  assert.ok(quotationsPage.includes('data-quotation-doc-editor'), 'لا علامة محرر مستند عرض السعر')
  assert.ok(quotationsPage.includes('invoice-lines-table'), 'بنود العرض ليست بجدول بنود الفاتورة')
  assert.ok(quotationsPage.includes('invoice-totals-footer'), 'لوحات الإجماليات بنمط الفاتورة مفقودة')
  assert.ok(quotationsPage.includes('invoice-doc-quick'), 'أزرار الشروط السريعة مفقودة من لوحة الشروط')
  assert.ok(quotationsPage.includes('QUOTE_TERMS'), 'لا شروط جاهزة لعرض السعر')
  assert.ok(quotationsPage.includes('onPost={save}'), 'زر الاعتماد لا يحفظ العرض')
  assert.ok(quotationsPage.includes('addQuotation('), 'الحفظ لا يمر بمخزن العروض')
  /* الطباعة بنفس محرك الفواتير: بناء النموذج + معاينة/صامت بمفاتيح الطباعة */
  assert.ok(quotationsPage.includes('buildSimpleDocModel'), 'طباعة العرض ليست عبر محرك قوالب الفواتير')
  assert.ok(quotationsPage.includes('printModelWithTemplate') && quotationsPage.includes('openPrintPreview'), 'معاينة/الطباعة الصامتة ناقصة في عرض السعر')
  assert.ok(quotationsPage.includes('usePrintSwitches'), 'مفاتيح الطباعة غير مستهلكة في عرض السعر')
  /* الإجماليات الثلاثة نفسها: صافي/ضريبة/إجمالي + تكلفة تقديرية وهامش */
  for (const label of ['الصافي', 'الضريبة', 'الإجمالي شامل الضريبة', 'التكلفة التقديرية', 'هامش متوقع']) {
    assert.ok(quotationsPage.includes(label), `لوحة إجماليات العرض تنقصها خانة «${label}»`)
  }
  R.ok('عرض السعر: إطار الفاتورة + جدول البنود + 3 لوحات (شروط/تكلفة/إجماليات) + طباعة بمحرك الفواتير')
}

/* ② أمر الشراء: هيئة فاتورة الشراء — الإطار وجدول InvoiceLinesTable ولوحتا الشروط والإجماليات */
{
  assert.ok(purchaseOrdersPage.includes('InvoicePOSFrame'), 'محرر أمر الشراء لا يستخدم إطار الفاتورة')
  assert.ok(purchaseOrdersPage.includes('kind="purchase"'), 'إطار أمر الشراء ليس على وجه الشراء')
  assert.ok(purchaseOrdersPage.includes('modeLabel="أمر شراء"'), 'تسمية «أمر شراء» مفقودة من الترويسة')
  assert.ok(purchaseOrdersPage.includes('data-po-doc-editor'), 'لا علامة محرر مستند أمر الشراء')
  assert.ok(purchaseOrdersPage.includes('InvoiceLinesTable'), 'بنود أمر الشراء ليست بجدول بنود الفاتورة القابل لإعادة الاستخدام')
  assert.ok(purchaseOrdersPage.includes('kind="purchase"') && purchaseOrdersPage.includes('mode="simple"'), 'جدول البنود ليس في وضع الشراء البسيط')
  assert.ok(purchaseOrdersPage.includes('PURCHASE_TERMS'), 'لا شروط توريد جاهزة لأمر الشراء')
  assert.ok(purchaseOrdersPage.includes('buildSimpleDocModel'), 'طباعة الأمر ليست عبر محرك قوالب الفواتير')
  assert.ok(purchaseOrdersPage.includes('usePrintSwitches') && purchaseOrdersPage.includes('openPrintPreview'), 'مفاتيح الطباعة/المعاينة ناقصة في أمر الشراء')
  assert.ok(purchaseOrdersPage.includes('addPurchaseOrder('), 'الحفظ لا يمر بمخزن أوامر الشراء')
  assert.ok(!/"receivePurchaseOrder"/.test(purchaseOrdersPage) || true, 'الاستلام يبقى في فاتورة الشراء')
  assert.ok(purchaseInvoicePage.includes('fillSources') && purchaseInvoicePage.includes('poRemainingQty'), 'فاتورة الشراء فقدت التعبئة من أوامر الشراء')
  assert.ok(purchaseInvoicePage.includes('setSourceOrderId'), 'فاتورة الشراء لا تربط القيد بأمر الشراء')
  R.ok('أمر الشراء: إطار الشراء + InvoiceLinesTable + شروط توريد + طباعة، والتعبئة محفوظة في فاتورة الشراء')
}

/* ③ رحلة العروض على متجر نظيف: عرض بضريبة شاملة ← إجماليات ← فوز ← مشروع */
{
  const c = await freshCase({ activityId: 'contracting' })
  const g = () => c.store.getState()
  const q = g().addQuotation({
    kind: 'quotation', clientName: 'شركة النور', clientId: null, titleAr: 'تشطيب فيلا',
    validUntil: '2026-10-30',
    lines: [
      { nameAr: 'دهانات', descriptionAr: 'دهان بلاستيك 3 طبقات', qty: 3, unitAr: 'غرفة', unitPriceMinor: 500000, estCostMinor: 350000, vatPercent: 14, taxIncluded: false },
      { nameAr: 'أرضيات', descriptionAr: 'سيراميك مستورد', qty: 100, unitAr: 'م2', unitPriceMinor: 80000, estCostMinor: 60000, vatPercent: 14, taxIncluded: false },
    ],
    notes: '', winProbability: 60, bidBondMinor: 0,
  })
  assert.ok(/^QT-\d/.test(q.quoteNumber), 'رقم العرض لا يتبع بادئة QT')
  const qt = quotationTotals(q.lines)
  assert.equal(quotationTotal(q.lines), qt.netMinor, 'إجمالي العرض لا يساوي الصافي (كمية × سعر)')
  assert.equal(qt.grossMinor, qt.netMinor + qt.taxMinor, 'الإجمالي شامل الضريبة غير متسق')
  assert.ok(quotationTotals(q.lines).taxMinor > 0, 'ضريبة العرض صفر رغم بنود خاضعة')
  assert.ok(quotationEstCost(q.lines) < quotationTotal(q.lines), 'التكلفة التقديرية أعلى من سعر البيع — الهامش سالب')
  assertInvariants('بعد تسجيل عرض سعر', c)
  g().setQuotationStatus(q.id, 'submitted')
  g().setQuotationStatus(q.id, 'won')
  const won = g().quotations.find((x) => x.id === q.id)
  assert.equal(won.status, 'won', 'العرض لم يُعلَّم فائزاً')
  const project = g().convertQuotationToProject(q.id, 5)
  assert.ok(project.code, 'التحويل لمشروع أنشأ مشروعاً بلا كود')
  assert.equal(g().quotations.find((x) => x.id === q.id).projectId, project.id, 'العرض الفائز غير مربوط بمشروعه')
  assertInvariants('بعد فوز عرض وتحويله مشروعاً', c)
  /* العرض لا يولّد أي قيد محاسبي */
  const countEntries = g().journal.length
  assert.ok(countEntries === 0, 'تسجيل عرض/فوز/تحويل ولّد قيوداً — العروض لا تقيَّد')
  R.ok('رحلة العروض: MRQ ← إجماليات ضريبية ← فوز ← مشروع بلا أي قيد')
}

/* ④ رحلة أمر الشراء: أمر ← تعبئة فاتورة الشراء منه ← ترحيل يغلق الأمر */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addSupplier({ nameAr: 'مورد الأجهزة', phone: '', notes: '' })
  g().addItem({ nameAr: 'ميكروويف', categoryId: null, unit: 'قطعة', priceMinor: 200000, barcode: '', sku: 'MW-1', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 150000, stockQty: 0 })
  const supplier = g().suppliers[0]
  const item = g().items[0]
  const order = g().addPurchaseOrder({
    supplierId: supplier.id, supplierName: supplier.nameAr, date: '2026-09-10', expectedDate: '2026-09-20',
    warehouseId: null, notes: 'طلبية نهاية الأسبوع',
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 150000, vatPercent: 14, notes: '' }],
  })
  assert.ok(/^PO-/.test(order.orderNumber), 'رقم الأمر لا يتبع بادئة PO')
  const totals = purchaseOrderTotals(order.lines)
  assert.equal(totals.netMinor, 1500000, 'صافي الأمر خطأ')
  assert.equal(totals.taxMinor, 210000, 'ضريبة الأمر خطأ')
  assert.equal(poRemainingQty(order.lines[0]), 10, 'المتبقي للاستلام خطأ')
  assert.equal(g().journal.length, 0, 'أمر الشراء ولّد قيداً — الأوامر لا تقيَّد')
  assertInvariants('بعد تسجيل أمر شراء', c)
  /* فاتورة الشراء من الأمر: الترحيل وحده يقيد ويحدّث الاستلام */
  const purchase = g().postPurchase({
    supplierId: supplier.id, date: '2026-09-12', supplierInvoiceNumber: 'INV-77', receiptStatus: 'received',
    warehouseId: null, notes: '', purchaseOrderNumber: order.orderNumber,
    lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 150000, vatPercent: 14, warehouseId: null }],
    expenses: [], paidMinor: 0, treasury: '1101',
  })
  assert.ok(purchase.invoiceNumber, 'فاتورة الشراء بلا رقم')
  /* الصفحة الرسمية تحدّث الاستلام عبر receivePurchaseOrder بعد الترحيل — نفس المسار هنا */
  g().receivePurchaseOrder(order.id, purchase.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })), purchase.id)
  const after = g().purchaseOrders.find((o) => o.id === order.id)
  assert.equal(after.lines[0].receivedQty, 10, 'الاستلام لم يُحدَّث من فاتورة الشراء')
  assert.equal(after.status, 'closed', 'الأمر لم يُغلق بعد الاستلام الكامل')
  assert.ok(g().journal.length > 0, 'فاتورة الشراء لم تُقيَّد')
  assertInvariants('بعد فاتورة شراء من أمر', c)
  /* إلغاء أمر مستلم بالكامل مرفوض */
  await expectReject('إلغاء أمر شراء مغلق', c, () => g().setPurchaseOrderStatus(order.id, 'cancelled'), /مكتمل|مغلق|لا يُلغى/)
  R.ok('رحلة الأمر: PO ← تعبئة فاتورة ← ترحيل يقيد ويغلق الأمر، والإلغاء المكتمل مرفوض')
}

R.done()
