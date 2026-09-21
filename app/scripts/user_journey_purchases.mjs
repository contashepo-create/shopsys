/**
 * رحلة مستخدم حقيقي — المشتريات عبر الأنشطة (طلب المالك: «راجع كأنك مستخدم حقيقي»):
 * م1) بقالة: شراء بمصاريف شحن + دفع جزئي ⇒ سداد المورد بسند صرف ⇒ كشف حسابه يصفر
 * م2) صيدلية: شراء بدفعات صلاحية ⇒ البيع يخصم FEFO من دفعة الشراء
 * م3) موبايلات: شراء بسيريالات ⇒ رفض عدد غير مطابق ⇒ بيع بسيريال ⇒ مرتجع شراء يرفض ما بيع
 * م4) مقاولات: فاتورة مشروع 5110 (لا مخزون) + شراء بمصروف من عهدة موظف
 * م5) مصروف لاحق (نولون وصل متأخراً) على فاتورة قائمة — التكلفة ترتفع
 * م6) مرتجع شراء نقدي واسترداد من مورد + أثره على المخزون والمتوسط
 * م7) تعديل فاتورة (كمية خاطئة) قبل أي حركة عليها — عكس وإعادة ترحيل
 * م8) تأثير المشتريات على الأقسام: ميزان المراجعة متزن، بطاقة الصنف مطابقة، كشف المورد صحيح
 */
import assert from 'node:assert/strict'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { supplierStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { computeTrialBalance } = await import(join(root, 'src/core/accounting.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

const item = (nameAr, extra = {}) => {
  st().addItem({ nameAr, barcode: '', categoryId: null, unit: 'قطعة', costMinor: 0, priceMinor: 10000, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra })
  return st().items.at(-1)
}

console.log('\n— م1) بقالة: شراء بشحن + دفع جزئي ثم سداد المورد —')
{
  st().addSupplier({ nameAr: 'شركة الأغذية', phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  const zeit = item('زيت عباد')
  // 100 زجاجة ×20 + شحن 100 على حساب المورد، مدفوع 1500
  const inv = st().postPurchase({
    supplierId: sup.id, date: '2026-09-17',
    lines: [{ itemId: zeit.id, qty: 100, unitPriceMinor: 2000 }],
    expenses: [{ nameAr: 'شحن', amountMinor: 10000, method: 'value', paidBy: 'supplier' }],
    paidMinor: 150000, treasury: '1101', notes: '',
  })
  assert.equal(inv.supplierDueMinor, 210000)
  // كشف المورد: عليه 2100 − 1500 = 600
  const stmt = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(stmt), 60000) // كشف المورد: الموجب = له (دائن)
  ok('كشف المورد بعد الشراء: له 600 (2100 مستحق − 1500 مدفوع)')
  // سند صرف 600 يصفّر
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 60000, description: 'سداد رصيد', partyKind: 'supplier', partyId: sup.id })
  const stmt2 = supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques })
  assert.equal(statementBalance(stmt2), 0)
  assert.equal(bal('2101'), 0)
  ok('سند الصرف صفّر كشف المورد وحساب 2101 معاً — الترابط سليم')
  // تكلفة الزجاجة = (2000+100)/100 = 21
  assert.equal(st().items.find((i) => i.id === zeit.id).costMinor, 2100)
  ok('تكلفة الزجاجة 21 بالشحن الموزع — «التكلفة لا تُدخل يدوياً» (قاعدة المالك)')
}

console.log('\n— م2) صيدلية: دفعات صلاحية + FEFO —')
{
  st().addSupplier({ nameAr: 'مخازن الدواء', phone: '0101', notes: '' })
  const sup = st().suppliers.at(-1)
  const dawa = item('باراسيتامول', { trackExpiry: true })
  // دفعتان: قريبة الانتهاء ثم بعيدة
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: dawa.id, qty: 50, unitPriceMinor: 500, expiryDate: '2026-12-31' }], expenses: [], paidMinor: 25000, treasury: '1101', notes: '' })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: dawa.id, qty: 50, unitPriceMinor: 500, expiryDate: '2027-12-31' }], expenses: [], paidMinor: 25000, treasury: '1101', notes: '' })
  // بيع 10 يخصم من الدفعة الأقرب انتهاءً
  st().postSale({ lines: [{ itemId: dawa.id, nameAr: dawa.nameAr, qty: 10, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const near = st().batches.find((b) => b.itemId === dawa.id && b.expiryDate === '2026-12-31')
  const far = st().batches.find((b) => b.itemId === dawa.id && b.expiryDate === '2027-12-31')
  assert.equal(near.qty, 40)
  assert.equal(far.qty, 50)
  ok('البيع خصم من دفعة الشراء الأقرب انتهاءً (FEFO) — دورة شراء→بيع مترابطة')
}

console.log('\n— م3) موبايلات: سيريالات الشراء ودورتها —')
{
  st().addSupplier({ nameAr: 'موزع سامسونج', phone: '0102', notes: '' })
  const sup = st().suppliers.at(-1)
  const phone = item('جالاكسي A15', { trackSerial: true, warrantyMonths: 12 })
  // عدد سيريالات لا يطابق الكمية ⇒ رفض
  assert.throws(
    () => st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: phone.id, qty: 3, unitPriceMinor: 500000, serialsRaw: 'SN1001\nSN1002' }], expenses: [], paidMinor: 0, notes: '' }),
    /لا يطابق الكمية/,
  )
  ok('سيريالات أقل من الكمية — الفاتورة مرفوضة قبل أي كتابة')
  const inv = st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: phone.id, qty: 3, unitPriceMinor: 500000, serialsRaw: 'SN1001\nSN1002\nSN1003' }], expenses: [], paidMinor: 1500000, treasury: '1101', notes: '' })
  assert.equal(st().serials.filter((u) => u.purchaseId === inv.id && u.status === 'in_stock').length, 3)
  ok('3 وحدات سيريال دخلت المخزون مربوطة بالفاتورة')
  // سيريال مكرر في فاتورة لاحقة ⇒ رفض
  assert.throws(
    () => st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: phone.id, qty: 1, unitPriceMinor: 500000, serialsRaw: 'SN1002' }], expenses: [], paidMinor: 0, notes: '' }),
    /سيريالات/,
  )
  ok('سيريال مسجل من قبل يُرفض — لا ازدواج في تتبع الوحدات')
  // بيع وحدة SN1 ثم محاولة إرجاع 3 للمورد ⇒ يرفض (بيعت واحدة)
  st().postSale({ lines: [{ itemId: phone.id, nameAr: phone.nameAr, qty: 1, unitPriceMinor: 700000, unitCostMinor: 500000, discountPercent: 0, soldByWeight: false, serials: ['SN1001'] }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[phone.id, 3]]), refund: 'cash', reason: 'إلغاء' }),
    /المخزون الحالي/,
  )
  ok('إرجاع 3 للمورد بعد بيع واحدة — مرفوض «لا يمكن إرجاع بضاعة بيعت»')
  // إرجاع 2: السيريالات تُعلَّم returned_supplier
  st().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[phone.id, 2]]), refund: 'cash', reason: 'عيب مصنعي', approvedBy: 'المشرف' })
  assert.equal(st().serials.filter((u) => u.purchaseId === inv.id && u.status === 'returned_supplier').length, 2)
  ok('مرتجع الشراء علَّم وحدتي السيريال returned_supplier — لا تُعرض للبيع')
}

console.log('\n— م4) مقاولات: فاتورة مشروع + مصروف من عهدة —')
{
  st().addSupplier({ nameAr: 'مواد بناء الدلتا', phone: '0103', notes: '' })
  const sup = st().suppliers.at(-1)
  const cement = item('أسمنت')
  st().addProject({ nameAr: 'فيلا المنزلة', clientName: 'عميل المشروع', clientId: null, contractValueMinor: 100000000, retentionPercent: 5, startDate: '2026-01-01', notes: '' })
  const project = st().projects.at(-1)
  const invBefore = bal('1103')
  const stockBefore = st().items.find((i) => i.id === cement.id).stockQty
  const inv = st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: cement.id, qty: 200, unitPriceMinor: 8000 }], expenses: [], paidMinor: 0, projectId: project.id, notes: '' })
  assert.equal(bal('1103'), invBefore) // لا مخزون
  assert.equal(st().items.find((i) => i.id === cement.id).stockQty, stockBefore)
  assert.equal(bal('5110'), 1600000)
  ok('فاتورة المشروع: 5110 تكاليف مشروعات لا 1103 — البضاعة للموقع لا للمتجر')
  assert.ok(st().projectCosts.some((c) => c.projectId === project.id && c.amountMinor === 1600000))
  ok('بند تكلفة «مواد» دخل ربحية المشروع تلقائياً')
  // مرتجع مخزني على فاتورة مشروع ⇒ مرفوض
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[cement.id, 10]]), refund: 'debt', reason: 'x' }),
    /مشروع/,
  )
  ok('مرتجع مخزني على فاتورة مشروع مرفوض — «سجّل التسوية بسند قبض»')
  // عهدة موظف تدفع مصروف نقل فاتورة عادية
  st().addEmployee({ nameAr: 'مندوب المشتريات', phone: '', jobTitle: 'مندوب', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
  const emp = st().employees.at(-1)
  st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'مشتريات', notes: '' })
  const file = st().custodyFiles.at(-1)
  st().fundCustodyFile({ fileId: file.id, amountMinor: 50000, treasury: '1101', description: 'تعزيز' })
  st().postPurchase({
    supplierId: sup.id, date: '2026-09-17',
    lines: [{ itemId: cement.id, qty: 10, unitPriceMinor: 8000 }],
    expenses: [{ nameAr: 'نقل', amountMinor: 20000, method: 'qty', paidBy: 'custody', custodyFileId: file.id }],
    paidMinor: 0, notes: '',
  })
  const summary = st().getCustodySummary(file.id)
  assert.equal(summary.remainingMinor, 30000)
  ok('مصروف النقل خُصم من عهدة المندوب (500−200=300) وظهر في ملفه')
  // تجاوز رصيد العهدة يُرفض
  assert.throws(
    () => st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: cement.id, qty: 1, unitPriceMinor: 8000 }], expenses: [{ nameAr: 'نقل', amountMinor: 99000, method: 'qty', paidBy: 'custody', custodyFileId: file.id }], paidMinor: 0, notes: '' }),
    /متبقيها/,
  )
  ok('مصروف أكبر من متبقي العهدة مرفوض قبل أي كتابة')
}

console.log('\n— م5) مصروف لاحق (نولون متأخر) —')
{
  const sup = st().suppliers.find((s) => s.nameAr === 'شركة الأغذية')
  const zeit = st().items.find((i) => i.nameAr === 'زيت عباد')
  const costBefore = zeit.costMinor
  const inv = st().purchases.find((p) => p.lines.some((l) => l.itemId === zeit.id))
  st().addLatePurchaseExpense({ purchaseId: inv.id, nameAr: 'نولون متأخر', amountMinor: 5000, method: 'value', paidBy: 'supplier', date: '2026-09-18' })
  const after = st().items.find((i) => i.id === zeit.id)
  assert.ok(after.costMinor > costBefore)
  ok(`النولون المتأخر رفع تكلفة الزيت من ${costBefore} إلى ${after.costMinor} — Landed Cost Voucher`)
  const updatedInv = st().purchases.find((p) => p.id === inv.id)
  assert.ok(updatedInv.expenses.some((e) => e.late === true))
  assert.equal(updatedInv.supplierDueMinor, 210000 + 5000)
  ok('المصروف أُلحق بالفاتورة (موسوم late) ورفع مستحق المورد لأنه على حسابه')
}

console.log('\n— م6) مرتجع نقدي: استرداد من المورد —')
{
  const sup = st().suppliers.find((s) => s.nameAr === 'مخازن الدواء')
  const dawa = st().items.find((i) => i.nameAr === 'باراسيتامول')
  const inv = st().purchases.filter((p) => p.supplierId === sup.id)[0]
  const cashBefore = bal('1101')
  const stockBefore = st().items.find((i) => i.id === dawa.id).stockQty
  const ret = st().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[dawa.id, 5]]), refund: 'cash', reason: 'عبوات مكسورة', approvedBy: 'المشرف' })
  assert.equal(bal('1101') - cashBefore, 2500)
  assert.equal(st().items.find((i) => i.id === dawa.id).stockQty, stockBefore - 5)
  ok('المرتجع النقدي: 25 دخلت الخزينة و5 عبوات خرجت من المخزون')
  const batch = st().batches.find((b) => b.purchaseId === inv.id)
  assert.equal(batch.qty, 35) // كانت 40 بعد بيع 10
  ok('دفعة صلاحية الفاتورة نقصت 5 — البضاعة المعادة خرجت من دفعتها')
}

console.log('\n— م7) تعديل فاتورة قبل أي حركة —')
{
  st().addSupplier({ nameAr: 'مورد التعديل', phone: '0104', notes: '' })
  const sup = st().suppliers.at(-1)
  const box = item('كرتونة تغليف')
  const inv = st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: box.id, qty: 100, unitPriceMinor: 300 }], expenses: [], paidMinor: 30000, treasury: '1101', notes: '' })
  // المستخدم اكتشف أن الوارد فعلياً 90
  const edited = st().editPurchase({ purchaseId: inv.id, lines: [{ itemId: box.id, qty: 90, unitPriceMinor: 300 }], expenses: [], paidMinor: 27000, treasury: '1101', reason: 'العدد الفعلي 90', einvoiceActive: false })
  assert.equal(st().items.find((i) => i.id === box.id).stockQty, 90)
  assert.equal(edited.grandTotalMinor, 27000)
  ok('التعديل ضبط المخزون على 90 والفاتورة على 270 — عكس + إعادة ترحيل')
  assert.equal(edited.editHistory.length, 1)
  ok('سجل تدقيق التعديل محفوظ على الفاتورة (السبب + القيد المعكوس)')
}

console.log('\n— م8) التأثير على كل الأقسام —')
{
  const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`كل قيود الدفتر (${st().journal.length}) متوازنة`)
  const tb = computeTrialBalance(st().journal, st().accounts ?? [])
  assert.equal(tb.totalDebit, tb.totalCredit)
  assert.ok(tb.balanced)
  ok(`ميزان المراجعة متزن: ${tb.totalDebit} = ${tb.totalCredit}`)
  // بطاقة الصنف = المخزون الفعلي (زيت: 100 شراء)
  const zeit = st().items.find((i) => i.nameAr === 'زيت عباد')
  assert.equal(zeit.stockQty, 100)
  // قيمة 1103 الدفترية = Σ كمية×متوسط لكل الأصناف المخزنية
  const bookInv = bal('1103')
  const calcInv = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  // فروق تقريب المتوسط المرجح مقبولة في حدود قروش لكل صنف
  assert.ok(Math.abs(bookInv - calcInv) <= st().items.length * 100, `1103=${bookInv} vs Σكمية×متوسط=${calcInv}`)
  ok(`قيمة المخزون الدفترية (1103=${bookInv}) ≈ مجموع كمية×متوسط (${calcInv}) — فرق تقريب مقبول`)
}

console.log(`\n✅ رحلة مشتريات المستخدم اكتملت: ${pass} تحققاً عبر 8 محاور وأنشطة متعددة`)
