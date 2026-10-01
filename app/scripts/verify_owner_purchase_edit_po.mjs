/* بوابة مراجعة المالك للفواتير 2026-10-01 (تقرير العيبين):
   ① تعديل فاتورة الشراء كان يُرفض بذريعة «متعددة المخازن» لأي فاتورة لسطورها مخازن
     ولو كانت كلها بمخزن واحد — لأن الترحيل كان يفرغ رأس المخزن متى كان لأي سطر مخزن.
   ② أمر الشراء لم يكن يعبّئ الفاتورة عبئاً سليماً: ضريبته لا تحترم رقاقة الخضوع
     (حقل وهمي vatPercentOverride في الشراء)، ولا مرجع الأمر، والاستلام يجمع أول
     سطر فقط للصنف المكرر، وتعديل فاتورة الأمر لا يحدّث كميات المستلم.
   هذه البوابة تثبّت الإصلاحات وظيفياً على متجر حقيقي لا بمجرد فحص نصوص. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter, freshCase, assertInvariants, expectReject } from './auditKit.mjs'

const R = reporter('مراجعة المالك: تعديل فواتير الشراء وتعبئة أوامر الشراء')
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
const purchaseInvoicePage = readFileSync(new URL('../src/ui/pages/AdvancedPurchaseInvoicePage.tsx', import.meta.url), 'utf8')
const purchaseOrdersPage = readFileSync(new URL('../src/ui/pages/PurchaseOrdersPage.tsx', import.meta.url), 'utf8')
const windowStore = readFileSync(new URL('../src/ui/windows/windowStore.ts', import.meta.url), 'utf8')
const invoiceRoute = readFileSync(new URL('../src/ui/pages/InvoiceDocumentRoute.tsx', import.meta.url), 'utf8')

/* ① فحوص مصدرية: البنية الصحيحة موجودة حيث يجب */
{
  assert.ok(/distinctLineWarehouses\.length >= 2 \? null/.test(repo), 'تطبيع رأس المخزن في الترحيل مفقود — الرأس يُفرَّغ لغير توزيع فعلي')
  assert.ok(/distinctOldWarehouses\.length >= 2/.test(repo), 'حارس التعديل لا يزال يرفض بذريعة «متعددة المخازن» للمخزن الواحد')
  assert.ok(repo.includes('فاتورة شراء موزعة على أكثر من مخزن'), 'رسالة الحارس الدقيقة مفقودة')
  assert.ok(/vatPercent: args\.lines\[i\]\?\.vatPercent \?\? inv\.lines\[i\]\?\.vatPercent/.test(repo), 'تعديل الفاتورة يسقط ضريبة السطور أو مخازنها')
  assert.ok(/warehouseId: newLineWarehouses\[i\] \?\? newHeaderWarehouseId/.test(repo), 'تعديل الفاتورة لا يحفظ مخازن السطور')
  assert.ok(repo.includes('purchaseOrders: updatedPurchaseOrders'), 'تعديل فاتورة الأمر لا يحدّث كميات المستلم في المخزن')
  assert.ok(/args\.inputVatMinor \?\? inv\.inputVatMinor/.test(repo), 'ضريبة مدخلات التعديل لا تتبع كميات المحرر الجديدة')
  /* الصفحة: رقاقة الخضوع تكتب vatPercent لا الحقل الوهمي */
  assert.ok(/setLines\(previous=>previous\.map\(line=>\(\{\.\.\.line,vatPercent:enabled\?taxPolicy\.effectivePercent:0\}\)\)\)/.test(purchaseInvoicePage), 'رقابة الخضوع للضريبة في الشراء لا تعدّل ضريبة السطور الموجودة')
  assert.ok(!/vatPercentOverride:enabled/.test(purchaseInvoicePage), 'حقل vatPercentOverride الوهمي ما زال في فاتورة الشراء')
  assert.ok(purchaseInvoicePage.includes('applyPurchaseOrder'), 'دالة التعبئة من أمر الشراء مفقودة')
  assert.ok(purchaseInvoicePage.includes('setPurchaseOrderNumber(order.orderNumber)'), 'التعبئة لا تسجل رقم الأمر مرجعاً في الفاتورة')
  assert.ok(purchaseInvoicePage.includes('setApplyTax(true)'), 'التعبئة لا تفعّل رقاقة الخضوع لأمر فيه ضريبة')
  assert.ok(purchaseInvoicePage.includes('purchaseOrderId'), 'التعبئة المسبقة من زر «فاتورة استلام» غير موصولة بالصفحة')
  assert.ok(purchaseOrdersPage.includes('`/purchases/invoices/new?po=${order.id}`'), 'زر «فاتورة استلام» لا يمرر الأمر للفاتورة')
  assert.ok(windowStore.includes('PurchaseInvoicePrefill'), 'نافذة فاتورة الشراء لا تدعم التعبئة المسبقة')
  assert.ok(invoiceRoute.includes("searchParams.get('po')"), 'مسار الفاتورة لا يقرأ معامل الأمر po')
  R.ok('فحوص مصدرية: التطبيع والحارس الدقيق وتعبئة الأمر موصولة في كل الطبقات')
}

/* ② رحلة التطبيع: فاتورة بمخزن واحد تُخزَّن برأسه ويُسمح بتعديلها (عطل المالك ①) */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addSupplier({ nameAr: 'مورد الأجهزة', phone: '', notes: '' })
  g().addItem({ nameAr: 'ميكروويف', categoryId: null, unit: 'قطعة', priceMinor: 200000, barcode: '', sku: 'MW-1', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 150000, stockQty: 0 })
  const supplier = g().suppliers[0]
  const item = g().items[0]
  if (!g().warehouses.some((w) => w.isMain)) g().addWarehouse('المخزن الرئيسي')
  g().addWarehouse('مخزن فرعي')
  const [mainWh, secondWh] = g().warehouses
  assert.ok(mainWh && secondWh, 'بيئة الاختبار بلا مخزنين')

  /* فاتورة كل سطورها بمخزن واحد: الرأس يحمل المخزن لا أن يُفرَّغ */
  const single = g().postPurchase({
    supplierId: supplier.id, date: '2026-10-01', receiptStatus: 'received', warehouseId: null,
    lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 100000, warehouseId: mainWh.id }],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 0,
  })
  assert.equal(single.warehouseId, mainWh.id, 'فاتورة بمخزن واحد خُزّنت برأس فارغ — عطل المالك ①')
  assert.equal(single.lines[0].warehouseId, mainWh.id, 'مخزن السطر ضاع في الترحيل')

  /* تعديلها مرفوض سابقاً بذريعة «متعددة المخازن» — الآن ينجح ويحفظ المخزن والضريبة */
  const edited = g().editPurchase({
    purchaseId: single.id, supplierId: supplier.id,
    lines: [{ itemId: item.id, qty: 4, unitPriceMinor: 110000, warehouseId: mainWh.id, vatPercent: 14 }],
    warehouseId: mainWh.id,
    expenses: [], paidMinor: 0, treasury: '1101', reason: 'تصحيح الكمية والسعر', einvoiceActive: false, inputVatMinor: Math.round(4 * 110000 * 0.14),
  })
  assert.equal(edited.warehouseId, mainWh.id, 'تعديل الفاتورة أفرغ رأس المخزن')
  assert.equal(edited.lines[0].warehouseId, mainWh.id, 'تعديل الفاتورة أسقط مخزن السطر')
  assert.equal(edited.lines[0].vatPercent, 14, 'تعديل الفاتورة أسقط ضريبة السطر')
  assert.equal(edited.supplierDueMinor, Math.round(4 * 110000 * 1.14), 'ضريبة مدخلات التعديل لم تتبع كميات المحرر')
  const newEntry = g().journal.find((e) => e.id === edited.journalEntryId)
  assert.ok(newEntry.lines.some((l) => l.accountCode === '2102' && l.debit === Math.round(4 * 110000 * 0.14)), 'قيد التعديل بلا مدين 2102 بضريبة السطور الجديدة')
  assertInvariants('بعد تعديل فاتورة بمخزن واحد', c)

  /* فاتورة موزعة فعلياً على مخزنين: الرأس فارغ والتعديل مرفوض (حارس دقيق) */
  const multi = g().postPurchase({
    supplierId: supplier.id, date: '2026-10-01', receiptStatus: 'received', warehouseId: null,
    lines: [
      { itemId: item.id, qty: 2, unitPriceMinor: 100000, warehouseId: mainWh.id },
      { itemId: item.id, qty: 3, unitPriceMinor: 100000, warehouseId: secondWh.id },
    ],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 0,
  })
  assert.equal(multi.warehouseId, null, 'فاتورة بتوزيع فعلي خُزّنت برأس مخزن — يجب أن يبقى فارغاً')
  await expectReject('تعديل فاتورة بتوزيع مخازن فعلي', c, () => g().editPurchase({
    purchaseId: multi.id, lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100000 }],
    expenses: [], paidMinor: 0, treasury: '1101', reason: 'محاولة تعديل موزعة', einvoiceActive: false,
  }), /موزعة على أكثر من مخزن/)
  R.ok('رحلة التطبيع: مخزن واحد ⇒ رأسه محفوظ وتعديله ينجح بضريبته، وتوزيع فعلي ⇒ تعديله مرفوض')
}

/* ③ رحلة الأمر: التعبئة الصحيحة والاستلام المجمَّع والتعديل يعيد حساب المستلم (عطل المالك ②) */
{
  const c = await freshCase({ activityId: 'grocery' })
  const g = () => c.store.getState()
  g().addSupplier({ nameAr: 'مورد الخردوات', phone: '', notes: '' })
  g().addItem({ nameAr: 'مفك كهربائي', categoryId: null, unit: 'قطعة', priceMinor: 300000, barcode: '', sku: 'DR-1', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 200000, stockQty: 0 })
  const supplier = g().suppliers[0]
  const item = g().items[0]
  if (!g().warehouses.some((w) => w.isMain)) g().addWarehouse('المخزن الرئيسي')
  const wh = g().warehouses.find((w) => w.isMain)

  /* أمر بسطرين لنفس الصنف: الاستلام كان يحتسب أول سطر فقط */
  const order = g().addPurchaseOrder({
    supplierId: supplier.id, supplierName: supplier.nameAr, date: '2026-10-01', expectedDate: '2026-10-05',
    warehouseId: wh.id, notes: '',
    lines: [
      { itemId: item.id, nameAr: item.nameAr, qty: 5, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 200000, vatPercent: 0, notes: '' },
      { itemId: item.id, nameAr: item.nameAr, qty: 5, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 200000, vatPercent: 0, notes: '' },
    ],
  })
  /* فاتورة بسطرين لنفس الصنف (كميتا 4+4 = 8) — الحساب القديم يمنح 4 فقط */
  const inv = g().postPurchase({
    supplierId: supplier.id, date: '2026-10-02', receiptStatus: 'received', warehouseId: wh.id,
    lines: [
      { itemId: item.id, qty: 4, unitPriceMinor: 200000, warehouseId: wh.id },
      { itemId: item.id, qty: 4, unitPriceMinor: 200000, warehouseId: wh.id },
    ],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 0, purchaseOrderNumber: order.orderNumber,
  })
  g().receivePurchaseOrder(order.id, inv.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })), inv.id)
  const afterReceive = g().purchaseOrders.find((o) => o.id === order.id)
  assert.equal(afterReceive.lines[0].receivedQty, 5, 'التوزيع المتدرج لم يُشبع السطر الأول من الأمر')
  assert.equal(afterReceive.lines[1].receivedQty, 3, 'الاستلام المجمَّع أضاع كمية السطور المكررة')
  assert.equal(afterReceive.status, 'partial', 'حالة الأمر بعد استلام 8 من 10 ليست جزئياً')
  assertInvariants('بعد استلام مجمَّع من أمر بسطور مكررة', c)

  /* تعديل الفاتورة يعيد حساب المستلم في الأمر: من 8 إلى 6 */
  const edited = g().editPurchase({
    purchaseId: inv.id, lines: [{ itemId: item.id, qty: 6, unitPriceMinor: 200000, warehouseId: wh.id }],
    warehouseId: wh.id, expenses: [], paidMinor: 0, treasury: '1101', reason: 'مرتجع سطرين للمورد قبل الترحيل', einvoiceActive: false, inputVatMinor: 0,
  })
  const afterEdit = g().purchaseOrders.find((o) => o.id === order.id)
  assert.equal(afterEdit.lines[0].receivedQty + afterEdit.lines[1].receivedQty, 6, 'تعديل الفاتورة لم يعدّل كميات المستلم في الأمر')
  assert.equal(afterEdit.lines[0].receivedQty, 5, 'إعادة التوزيع أفسدت السطر الأول')
  assert.equal(afterEdit.status, 'partial', 'حالة الأمر بعد التعديل ليست جزئياً')

  /* فاتورة ثانية تُكمل الأمر ثم مرتجع من الأولى: الصافي هو المستلم */
  const inv2 = g().postPurchase({
    supplierId: supplier.id, date: '2026-10-03', receiptStatus: 'received', warehouseId: wh.id,
    lines: [{ itemId: item.id, qty: 4, unitPriceMinor: 200000, warehouseId: wh.id }],
    expenses: [], paidMinor: 0, treasury: '1101', inputVatMinor: 0, purchaseOrderNumber: order.orderNumber,
  })
  g().receivePurchaseOrder(order.id, inv2.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })), inv2.id)
  const closed = g().purchaseOrders.find((o) => o.id === order.id)
  assert.equal(closed.status, 'closed', 'الأمر لم يُغلق بعد استلام الكل')
  g().postPurchaseReturn({
    purchaseId: inv.id, refund: 'debt', date: '2026-10-04', reason: 'تالف',
    lineSpecs: [{ lineIndex: 0, qty: 2, warehouseId: wh.id }],
  })
  const afterReturn = g().purchaseOrders.find((o) => o.id === order.id)
  assert.equal(afterReturn.lines[0].receivedQty + afterReturn.lines[1].receivedQty, 8, 'مرتجع فاتورة الأمر لا يُخصم من المستلم الصافي')
  assert.equal(afterReturn.status, 'partial', 'الأمر عاد جزئياً بعد مرتجع من فاتورته — الاستلام الصافي 8 من 10')
  assertInvariants('بعد رحلة أمر كاملة باستلام وتعديل ومرتجع', c)
  R.ok('رحلة الأمر: استلام مجمَّع للسطور المكررة + تعديل يعيد حساب المستلم + المرتجع يخصم الصافي')
}

R.done()
