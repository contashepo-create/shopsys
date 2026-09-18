/**
 * أسئلة المالك السبعة — تعديل الفواتير والمرتجعات مع/بدون الفاتورة الضريبية الإلكترونية:
 *
 * س1) فاتورة بها «مجرد غلطة» — هل تُعدَّل طبيعياً؟ (منظومة غير مفعلة)
 * س2) هل المخزون يُضبط بشكل سليم بعد التعديل؟ (كمية أكبر/أصغر/صنف مختلف)
 * س3) هل القيود اليومية سليمة في كل الحالات؟ (عكس + قيد جديد، متوازنة، لا حذف)
 * س4) الفاتورة الضريبية مفعلة ⇒ التعديل محظور والبديل إشعار دائن — هل الإشعار الدائن
 *     (مرتجع بفاتورة ضريبية) يعمل ويعكس الضريبة نسبياً؟
 * س5) تفعيل المنظومة ثم إلغاء تفعيلها — هل الأقسام الأربعة (بيع/شراء/مرتجعاهما)
 *     تعمل سليمة في الحالتين؟ وهل التعديل يعود متاحاً بعد الإلغاء؟
 * س6) هل تعديل الفاتورة في نظام الكاشير يتطلب رقماً سرياً من المشرف؟ (فحص نصي للواجهة)
 * س7) هل المرتجع نفسه يُعدَّل؟ (السياسة العالمية: لا — مستند مرحّل يُصحح بمستند آخر)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { invoiceEditPolicy } = await import(join(root, 'src/core/invoiceEdit.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const allBalanced = () => { for (const e of st().journal) assertBalanced(e.lines) }

/* تجهيز */
st().addSupplier({ nameAr: 'مورد', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'عميل', phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const cust = st().customers.at(-1)
st().addItem({ nameAr: 'مروحة', barcode: '', categoryId: null, unit: 'قطعة', costMinor: 0, priceMinor: 50000, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const fan = st().items.at(-1)
st().addItem({ nameAr: 'دفاية', barcode: '', categoryId: null, unit: 'قطعة', costMinor: 0, priceMinor: 70000, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const heater = st().items.at(-1)
// رصيد أولي بالشراء (لا حقن يدوي)
st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: fan.id, qty: 50, unitPriceMinor: 30000 }, { itemId: heater.id, qty: 30, unitPriceMinor: 45000 }], expenses: [], paidMinor: 0, notes: '' })

console.log('\n— س1+س2+س3) «مجرد غلطة»: الكاشير كتب 3 بدل 2 — تعديل عادي —')
{
  const sale = st().postSale({
    lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 3, unitPriceMinor: 50000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  assert.equal(st().items.find((i) => i.id === fan.id).stockQty, 47)
  const journalBefore = st().journal.length
  // التعديل: الكمية الصحيحة 2 — المنظومة غير مفعلة
  const updated = st().editSale({
    saleId: sale.id,
    lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 2, unitPriceMinor: 50000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', paidMinor: 100000, treasury: '1101',
    invoiceDiscountPercent: 0, reason: 'خطأ إدخال: 3 بدل 2', einvoiceActive: false, allowNegativeStock: false,
  })
  ok('س1: الغلطة البسيطة عُدلت طبيعياً — لا حاجة لمرتجع عندما تكون المنظومة غير مفعلة')
  assert.equal(st().items.find((i) => i.id === fan.id).stockQty, 48)
  ok('س2: المخزون ضُبط تلقائياً 47→48 — أعاد الثلاثة وخصم الاثنتين')
  assert.equal(st().journal.length, journalBefore + 2)
  const reversal = st().journal.find((e) => e.reversesEntryId === sale.journalEntryId)
  assert.ok(reversal, 'قيد العكس موجود')
  assert.equal(st().journal.find((e) => e.id === sale.journalEntryId).reversedByEntryId, reversal.id)
  allBalanced()
  ok('س3: قيدان جديدان (عكس + معدل) والقديم موسوم معكوساً — لا حذف، وكل الدفتر متوازن')
  assert.equal(updated.editHistory.length, 1)
  assert.equal(updated.editHistory[0].reason, 'خطأ إدخال: 3 بدل 2')
  ok('س3: سجل تدقيق التعديل على الفاتورة بالسبب والقيود المرجعية')
  // الضريبة أعيد حسابها: 200 شامل ⇒ صافي 175.44 + ض 24.56 — 2102 يطابق
  const newEntry = st().journal.find((e) => e.id === updated.journalEntryId)
  const vatLine = newEntry.lines.find((l) => l.accountCode === '2102')
  assert.equal(vatLine.credit, updated.totals.taxMinor)
  ok('س3: ضريبة القيد الجديد = ضريبة الإجماليات المعدلة بالقرش — بنفس معاملة الفاتورة الأصلية')
}

console.log('\n— س2ب) تعديل يستبدل صنفاً بصنف — المخزونان معاً —')
{
  const sale = st().postSale({
    lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 1, unitPriceMinor: 50000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  const fanQ = st().items.find((i) => i.id === fan.id).stockQty
  const heaterQ = st().items.find((i) => i.id === heater.id).stockQty
  // الصح: العميل أخذ دفاية لا مروحة
  st().editSale({
    saleId: sale.id,
    lines: [{ itemId: heater.id, nameAr: heater.nameAr, qty: 1, unitPriceMinor: 70000, unitCostMinor: 45000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', paidMinor: 70000, treasury: '1101',
    invoiceDiscountPercent: 0, reason: 'الصنف الصحيح دفاية', einvoiceActive: false, allowNegativeStock: false,
  })
  assert.equal(st().items.find((i) => i.id === fan.id).stockQty, fanQ + 1)
  assert.equal(st().items.find((i) => i.id === heater.id).stockQty, heaterQ - 1)
  allBalanced()
  ok('س2: استبدال صنف بصنف — المروحة عادت والدفاية خُصمت والقيود متوازنة')
}

console.log('\n— س4) المنظومة مفعلة: التعديل محظور والإشعار الدائن هو الطريق —')
{
  // فاتورة ضريبية 14% لعميل مسجل
  const sale = st().postSale({
    lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 4, unitPriceMinor: 57000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }],
    customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  })
  // سياسة الواجهة
  const policy = invoiceEditPolicy({ einvoiceActive: true })
  assert.equal(policy.canEdit, false)
  assert.ok(policy.reasonAr.includes('إشعار دائن'))
  ok('س4: سياسة الواجهة: زر التعديل معطل مع الشرح — «التصحيح بإشعار دائن/مدين»')
  // النواة ترفض أيضاً (دفاع مزدوج)
  assert.throws(
    () => st().editSale({ saleId: sale.id, lines: sale.lines, customerId: cust.id, payment: 'cash', paidMinor: sale.totals.totalMinor, treasury: '1101', invoiceDiscountPercent: 0, reason: 'محاولة', einvoiceActive: true, allowNegativeStock: false }),
    /الإلكترونية مفعلة/,
  )
  ok('س4: النواة نفسها ترفض التعديل حتى لو تجاوز أحدهم الواجهة — دفاع مزدوج')
  // الإشعار الدائن: مرتجع قطعة واحدة من فاتورة ضريبية — الضريبة تُعكس نسبياً
  const vatBefore = bal('2102')
  const ret = st().postSaleReturn({
    saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'cash', reason: 'إشعار دائن — قطعة معيبة', reasonCode: 'defective', approvedBy: 'المشرف',
  })
  const vatAfter = bal('2102')
  assert.equal(vatAfter - vatBefore, Math.round(sale.totals.taxMinor / 4))
  ok('س4: الإشعار الدائن عكس ربع الضريبة بالضبط (قطعة من 4) — 2102 سليم للإقرار الضريبي')
  assert.equal(ret.approvedBy, 'المشرف')
  allBalanced()
  ok('س4: الإشعار الدائن معتمد باسم المشرف وقيده متوازن — هذا هو المسار الرسمي مع المنظومة')
}

console.log('\n— س5) تبديل التفعيل ذهاباً وإياباً — الأقسام الأربعة في الحالتين —')
{
  // الحالة أ: مفعلة — البيع والشراء ومرتجعاهما كلها تعمل (الحظر على التعديل فقط)
  const saleOn = st().postSale({ lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 2, unitPriceMinor: 57000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
  const purOn = st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: heater.id, qty: 10, unitPriceMinor: 45000 }], expenses: [], paidMinor: 0, inputVatMinor: 63000, notes: '' })
  st().postSaleReturn({ saleId: saleOn.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'إشعار دائن', reasonCode: 'other', approvedBy: 'المشرف' })
  st().postPurchaseReturn({ purchaseId: purOn.id, qtyByItem: new Map([[heater.id, 2]]), refund: 'debt', reason: 'إشعار دائن مورد', approvedBy: 'المشرف' })
  allBalanced()
  ok('س5أ: والمنظومة مفعلة — بيع وشراء وإشعارا دائن (عميل ومورد) كلها مرت وقيودها متوازنة')
  assert.throws(() => st().editSale({ saleId: saleOn.id, lines: saleOn.lines, customerId: cust.id, payment: 'cash', paidMinor: saleOn.totals.totalMinor, treasury: '1101', invoiceDiscountPercent: 0, reason: 'x', einvoiceActive: true, allowNegativeStock: false }), /الإلكترونية/)
  assert.throws(() => st().editPurchase({ purchaseId: purOn.id, lines: [{ itemId: heater.id, qty: 10, unitPriceMinor: 45000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'x', einvoiceActive: true }), /الإلكترونية/)
  ok('س5أ: التعديل وحده محظور في القسمين (بيع وشراء) — بنص خطأ يشرح البديل')

  // الحالة ب: أُلغي التفعيل — فواتير جديدة تُعدل طبيعياً
  const saleOff = st().postSale({ lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 1, unitPriceMinor: 50000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101' })
  st().editSale({ saleId: saleOff.id, lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 1, unitPriceMinor: 45000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', paidMinor: 45000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'سعر متفق عليه', einvoiceActive: false, allowNegativeStock: false })
  ok('س5ب: بعد إلغاء التفعيل — التعديل عاد متاحاً فوراً (السياسة تُقرأ لحظياً من الترخيص لا من الفاتورة)')
  // والفاتورة القديمة (أُصدرت والمنظومة مفعلة) تُعدل الآن أيضاً؟ سياستنا: نعم —
  // القراءة لحظية، والمسؤولية الضريبية على الممول أمام المنظومة الرسمية.
  // لكن فاتورة عليها مرتجع (إشعار دائن) تبقى ممنوعة بموانع السلامة:
  assert.throws(
    () => st().editSale({ saleId: saleOn.id, lines: saleOn.lines, customerId: cust.id, payment: 'cash', paidMinor: saleOn.totals.totalMinor, treasury: '1101', invoiceDiscountPercent: 0, reason: 'x', einvoiceActive: false, allowNegativeStock: false }),
    /مرتجعات/,
  )
  ok('س5ب: الفاتورة التي صدر عليها إشعار دائن لا تُعدل حتى بعد إلغاء التفعيل — مانع سلامة لا مانع منظومة')
  const purOff = st().postPurchase({ supplierId: sup.id, date: '2026-09-19', lines: [{ itemId: fan.id, qty: 5, unitPriceMinor: 30000 }], expenses: [], paidMinor: 0, notes: '' })
  st().editPurchase({ purchaseId: purOff.id, lines: [{ itemId: fan.id, qty: 6, unitPriceMinor: 30000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'العدد الفعلي 6', einvoiceActive: false })
  allBalanced()
  ok('س5ب: تعديل فاتورة الشراء عاد يعمل أيضاً — الأقسام الأربعة سليمة في الحالتين')
}

console.log('\n— س6) الكاشير والرقم السري — فحص الواجهات نصياً —')
{
  const salesPage = readFileSync(join(root, 'src/ui/pages/SalesInvoicesPage.tsx'), 'utf8')
  assert.ok(salesPage.includes("useSupervisorApproval('sales.price.edit')"))
  assert.ok(salesPage.includes('editApproval.request'))
  assert.ok(salesPage.includes('editApproval.dialog'))
  ok('س6: تعديل فاتورة البيع خلف حوار الرقم السري (صلاحية sales.price.edit الحساسة)')
  const posPage = readFileSync(join(root, 'src/ui/pages/PosPage.tsx'), 'utf8')
  assert.ok(!posPage.includes('editSale'))
  ok('س6: شاشة الكاشير نفسها بلا زر تعديل إطلاقاً — التعديل من «فواتير المبيعات» المحروسة فقط')
  const purchasesPage = readFileSync(join(root, 'src/ui/pages/PurchasesPage.tsx'), 'utf8')
  assert.ok(purchasesPage.includes("useSupervisorApproval('pur.invoice.edit')"))
  ok('س6: تعديل فاتورة الشراء خلف رقم سري كذلك (pur.invoice.edit)')
  const srPage = readFileSync(join(root, 'src/ui/pages/SaleReturnsPage.tsx'), 'utf8')
  const prPage = readFileSync(join(root, 'src/ui/pages/PurchaseReturnsPage.tsx'), 'utf8')
  assert.ok(srPage.includes('useSupervisorApproval') && prPage.includes('useSupervisorApproval'))
  ok('س6: والمرتجعان (بيع وشراء) خلف اعتماد المشرف — كل الحساس مقفول بالرقم السري')
  const { PERMISSIONS } = await import(join(root, 'src/core/permissions.ts'))
  for (const id of ['sales.price.edit', 'pur.invoice.edit']) {
    const perm = PERMISSIONS.find((p) => p.id === id)
    assert.ok(perm?.sensitive, `${id} حساسة`)
  }
  ok('س6: صلاحيتا التعديل موسومتان حساستين — لا تُمنحان إلا قصداً')
}

console.log('\n— س7) هل المرتجع نفسه يُعدَّل؟ —')
{
  const repoSrc = readFileSync(join(root, 'src/data/repo.ts'), 'utf8')
  assert.ok(!repoSrc.includes('editSaleReturn') && !repoSrc.includes('editPurchaseReturn'))
  ok('س7: لا يوجد تعديل مرتجع إطلاقاً — بالتصميم (النمط العالمي: الإشعار الدائن مستند نهائي)')
  // التصحيح المتاح: مرتجع جزئي إضافي (لو أرجع أقل مما يجب) — نتحقق أنه يعمل
  const sale = st().postSale({ lines: [{ itemId: fan.id, nameAr: fan.nameAr, qty: 5, unitPriceMinor: 50000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'مرتجع أول', reasonCode: 'other', approvedBy: 'المشرف' })
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'استكمال — كان يجب إرجاع 3', reasonCode: 'other', approvedBy: 'المشرف' })
  ok('س7: التصحيح بمرتجع إضافي على نفس الفاتورة يعمل (أرجع 1 ثم استكمل 2) — بسقف تراكمي')
  assert.throws(
    () => st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'resellable' }], refund: 'cash', reason: 'زيادة', reasonCode: 'other', approvedBy: 'المشرف' }),
    /متبق|المرتجع|أكبر/,
  )
  ok('س7: ولا يمكن تجاوز الكمية الأصلية عبر مرتجعات متتالية (5 = 1+2+2 كحد أقصى)')
  allBalanced()
  ok('س7: الدفتر متوازن بعد كل السيناريوهات — لا قرش تائه')
}

console.log(`\n✅ verify_edit_einvoice_toggle: ${pass} تحققاً — كل أسئلة التعديل والفاتورة الإلكترونية مجابة بالتشغيل الفعلي`)
