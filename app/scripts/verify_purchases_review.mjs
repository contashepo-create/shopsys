/**
 * مراجعة المشتريات الشاملة (طلب المالك — نفس دقة المبيعات والمرتجعات):
 * P1) postPurchase يرفض مورداً غير مسجل / خزينة غير موجودة / صنفاً غير موجود (فجوات سُدت)
 * P2) مطابقة سطور الواجهة بالترتيب — سطران بنفس الصنف والكمية بصلاحيتين مختلفتين (فجوة سُدت)
 * P3) موافقة المشرف على مرتجع الشراء (approvedBy/requestedBy على المستند)
 * P4) صلاحية pur.invoice.edit حساسة معرفة + الحراسة النصية في الصفحة
 * P5) سلامة النواة: متوسط مرجح + توزيع مصاريف + مستحق المورد + ضريبة مدخلات
 * P6) مرتجع الشراء: G4 (المورد لا يرد مصاريفي) + N2 (عكس ضريبة المدخلات) + سقف دين الفاتورة
 * P7) المصروف اللاحق: توزيع 1103/5101 حسب المتبقي بالمخزون + رفع المتوسط
 * P8) editPurchase: موانع السلامة (مرتجعات/سيريالات/بيع من البضاعة) + N1 حفظ ضريبة المدخلات
 * P9) توازن كل القيود بعد كل العمليات
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
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

/* تجهيز */
st().addSupplier({ nameAr: 'مورد الاختبار', phone: '0100', notes: '' })
const sup = st().suppliers.at(-1)
st().addItem({ nameAr: 'أرز', barcode: '', categoryId: null, unit: 'كجم', costMinor: 0, priceMinor: 3000, stockQty: 0, minStock: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const rice = st().items.at(-1)
st().addItem({ nameAr: 'سكر', barcode: '', categoryId: null, unit: 'كجم', costMinor: 0, priceMinor: 2500, stockQty: 0, minStock: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const sugar = st().items.at(-1)

/* ═══ P1) فحوص ما قبل الكتابة الجديدة ═══ */
{
  assert.throws(
    () => st().postPurchase({ supplierId: 9999, date: '2026-09-17', lines: [{ itemId: rice.id, qty: 10, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' }),
    /المورد غير موجود/,
  )
  ok('P1: فاتورة بمورد غير مسجل تُرفض قبل أي كتابة (كانت تمر وتفسد كشوف الموردين)')
  assert.throws(
    () => st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: rice.id, qty: 10, unitPriceMinor: 1000 }], expenses: [], paidMinor: 5000, treasury: '9999', notes: '' }),
    /الخزينة/,
  )
  ok('P1: خزينة دفع غير موجودة تُرفض (كانت تُفحص لخزائن المصاريف فقط)')
  assert.throws(
    () => st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: 9999, qty: 10, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' }),
    /صنف غير موجود/,
  )
  ok('P1: صنف غير موجود يُرفض — لا مخزون شبحي')
  assert.equal(st().purchases.length, 0)
  assert.equal(st().journal.length, 0)
  ok('P1: كل الرفض قبل أي كتابة — لا فواتير ولا قيود يتيمة')
}

/* ═══ P5) فاتورة كاملة: مصاريف موزعة + ضريبة مدخلات + متوسط مرجح ═══ */
let inv1
{
  // 100كجم أرز ×10 + 50كجم سكر ×20 = 1000+1000=2000 بضاعة، شحن 200 بالقيمة (100/100)،
  // ضريبة مدخلات 280، مدفوع 1000 من الخزينة
  inv1 = st().postPurchase({
    supplierId: sup.id, date: '2026-09-17',
    lines: [
      { itemId: rice.id, qty: 100, unitPriceMinor: 1000, expiryDate: '2027-06-30' },
      { itemId: sugar.id, qty: 50, unitPriceMinor: 2000 },
    ],
    expenses: [{ nameAr: 'شحن', amountMinor: 20000, method: 'value', paidBy: 'supplier' }],
    paidMinor: 100000, treasury: '1101', inputVatMinor: 28000, notes: '',
  })
  assert.equal(inv1.goodsTotalMinor, 200000)
  assert.equal(inv1.grandTotalMinor, 220000)
  // مستحق المورد = 2200 + 280 ضريبة = 2480 (الشحن على حسابه)
  assert.equal(inv1.supplierDueMinor, 248000)
  ok('P5: الإجماليات — بضاعة 2000 + شحن 200 + ضريبة مدخلات 280 = مستحق مورد 2480')
  // التوزيع بالقيمة: كلاهما 1000 بضاعة ⇒ 100 لكل — أرز landed = (1000+100)/100 = 11/كجم
  const riceLine = inv1.lines.find((l) => l.itemId === rice.id)
  assert.equal(riceLine.landedUnitCostMinor, 1100)
  const sugarLine = inv1.lines.find((l) => l.itemId === sugar.id)
  assert.equal(sugarLine.landedUnitCostMinor, 2200)
  ok('P5: توزيع الشحن بالقيمة مناصفة — تكلفة محملة 11 و22 للكيلو')
  // المتوسط المرجح على الصنف + المخزون
  const riceNow = st().items.find((i) => i.id === rice.id)
  assert.equal(riceNow.costMinor, 1100)
  assert.equal(riceNow.stockQty, 100)
  ok('P5: تكلفة الصنف بالمتوسط المرجح والمخزون +100')
  // القيد: 1103 مدين 2200 / 2102 مدين 280 / 1101 دائن 1000 / 2101 دائن 1480
  assert.equal(bal('1103'), 220000)
  assert.equal(bal('2102'), 28000)
  assert.equal(bal('1101'), -100000)
  assert.equal(bal('2101'), -148000)
  ok('P5: القيد — 1103=2200 مدين، 2102=280 مدين (لا تدخل التكلفة)، 2101=1480 دائن')
  // دفعة صلاحية للأرز فقط
  assert.equal(st().batches.filter((b) => b.purchaseId === inv1.id).length, 1)
  ok('P5: دفعة FEFO فُتحت للأرز المتتبَّع فقط')
  // متوسط مرجح تراكمي: شراء ثانٍ 100كجم أرز ×13 بلا مصاريف ⇒ (110000+130000)/200 = 12/كجم
  st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 1300, expiryDate: '2027-03-31' }], expenses: [], paidMinor: 130000, treasury: '1101', notes: '' })
  assert.equal(st().items.find((i) => i.id === rice.id).costMinor, 1200)
  ok('P5: شراء ثانٍ بسعر أعلى — المتوسط المرجح 12 بالضبط')
}

/* ═══ P6) مرتجع الشراء: G4 + N2 + سقف الدين ═══ */
{
  // إرجاع 20كجم أرز من الفاتورة الأولى: قيمة دفترية 20×11=220، مستحق المورد 20×10=200
  // حصة الضريبة N2: 280 × (220/2200) = 28
  const ret = st().postPurchaseReturn({ purchaseId: inv1.id, qtyByItem: new Map([[rice.id, 20]]), refund: 'debt', reason: 'تالف جزئياً', approvedBy: 'المشرف كمال' })
  assert.equal(ret.totalMinor, 22000)
  assert.equal(ret.supplierValueMinor, 20000)
  assert.equal(ret.inputVatShareMinor, 2800)
  ok('P6: مرتجع 20كجم — دفتري 220، مستحق مورد 200 (G4: الشحن لا يُسترد)، عكس ضريبة 28 (N2)')
  assert.equal(ret.approvedBy, 'المشرف كمال')
  ok('P3: موافقة المشرف مسجلة على مستند مرتجع الشراء (قاعدة المالك المعممة)')
  // القيد: 2101 مدين 228 / 1103 دائن 220 / 5111 مدين 20 / 2102 دائن 28
  const entry = st().journal.find((e) => e.id === ret.journalEntryId)
  const get5111 = entry.lines.find((l) => l.accountCode === '5111')
  assert.equal(get5111.debit, 2000)
  ok('P6: نصيب الشحن غير المسترد 20 خسارة محققة 5111 (نمط QuickBooks/Odoo)')
  // لا إرجاع فوق المتبقي
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: inv1.id, qtyByItem: new Map([[rice.id, 81]]), refund: 'cash', reason: 'x' }),
    /المتبقي القابل للإرجاع/,
  )
  ok('P6: الإرجاع فوق المتبقي القابل للإرجاع (80) مرفوض تراكمياً')
  // سقف دين الفاتورة للمرتجع debt
  assert.throws(
    () => st().postPurchaseReturn({ purchaseId: inv1.id, qtyByItem: new Map([[rice.id, 80], [sugar.id, 50]]), refund: 'debt', reason: 'x' }),
    /دين الفاتورة المتبقي/,
  )
  ok('P6: مرتجع debt أكبر من دين الفاتورة المتبقي مرفوض — «اختر الاسترداد النقدي»')
}

/* ═══ P7) المصروف اللاحق: توزيع 1103/5101 ═══ */
{
  // بيع 30كجم سكر أولاً (يبقى 20 من 50)
  st().addCustomer({ nameAr: 'عميل', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  st().postSale({ lines: [{ itemId: sugar.id, nameAr: 'سكر', qty: 30, unitPriceMinor: 3000, unitCostMinor: 2200, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const cogsBefore = bal('5101')
  const invBefore = bal('1103')
  const sugarCostBefore = st().items.find((i) => i.id === sugar.id).costMinor
  // جمارك لاحقة 100 على الفاتورة الأولى بالقيمة (أرز 50 / سكر 50):
  // أرز: متبقي 80+80=160 ≥ 100 المشتراة كلها؟ stillInStock=min(stock,qty)=min(160,100)=100 ⇒ كله 1103
  // سكر: متبقي 20 من 50 ⇒ 50×20/50=20 إلى 1103 و30 إلى 5101
  st().addLatePurchaseExpense({ purchaseId: inv1.id, nameAr: 'جمارك', amountMinor: 10000, method: 'value', paidBy: 'treasury', payAccount: '1101', date: '2026-09-17' })
  const cogsAfter = bal('5101')
  const invAfter = bal('1103')
  assert.equal(cogsAfter - cogsBefore, 3000) // نصيب السكر المبيع 30/50 × 50
  assert.equal(invAfter - invBefore, 7000)
  ok('P7: المصروف اللاحق — 70 للمخزون المتبقي (1103) و30 لبضاعة بيعت (5101)')
  const sugarCostAfter = st().items.find((i) => i.id === sugar.id).costMinor
  assert.ok(sugarCostAfter > sugarCostBefore)
  ok('P7: متوسط تكلفة السكر ارتفع بنصيب المتبقي بالمخزون')
}

/* ═══ P8) editPurchase: موانع السلامة ═══ */
{
  // فاتورة عليها مرتجع لا تُعدل
  assert.throws(
    () => st().editPurchase({ purchaseId: inv1.id, lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'تصحيح', einvoiceActive: false }),
    /مرتجعات شراء/,
  )
  ok('P8: فاتورة عليها مرتجعات لا تُعدَّل — «صحّح بمرتجع إضافي»')
  // فاتورة نظيفة تُعدل ويُحفظ inputVat (N1)
  const inv3 = st().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: sugar.id, qty: 10, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, inputVatMinor: 2800, notes: '' })
  const edited = st().editPurchase({ purchaseId: inv3.id, lines: [{ itemId: sugar.id, qty: 12, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'كمية فعلية 12', einvoiceActive: false })
  assert.equal(edited.grandTotalMinor, 24000)
  assert.equal(edited.inputVatMinor, 2800)
  assert.equal(edited.supplierDueMinor, 24000 + 2800)
  ok('P8: التعديل أعاد الترحيل وحفظ ضريبة المدخلات في القيد الجديد (N1)')
  const reversal = st().journal.find((e) => e.reversesEntryId === inv3.journalEntryId)
  assert.ok(reversal, 'قيد العكس موجود')
  ok('P8: القيد القديم عُكس بقيد تدقيق — لا حذف أبداً')
  // e-invoice يمنع التعديل
  assert.throws(
    () => st().editPurchase({ purchaseId: inv3.id, lines: [{ itemId: sugar.id, qty: 1, unitPriceMinor: 2000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'x', einvoiceActive: true }),
    /الإلكترونية/,
  )
  ok('P8: الفاتورة الإلكترونية المفعلة تمنع التعديل — مرتجع أو فاتورة إضافية')
}

/* ═══ P9) توازن الدفتر ═══ */
{
  const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`P9: كل قيود الدفتر (${st().journal.length}) متوازنة بعد دورة المشتريات الكاملة`)
}

/* ═══ P2/P4) الفحوص النصية للواجهة والصلاحيات ═══ */
{
  const { PERMISSIONS, DEFAULT_ROLES, effectivePermissionsFor } = await import(join(root, 'src/core/permissions.ts'))
  const p = PERMISSIONS.find((x) => x.id === 'pur.invoice.edit')
  assert.ok(p && p.sensitive === true)
  ok('P4: صلاحية pur.invoice.edit معرفة وحساسة')
  assert.ok(effectivePermissionsFor(null, DEFAULT_ROLES).has('pur.invoice.edit'))
  ok('P4: المالك يملكها تلقائياً')

  const purchasesPage = readFileSync(join(root, 'src/ui/pages/PurchasesPage.tsx'), 'utf8')
  assert.ok(purchasesPage.includes("useSupervisorApproval('pur.invoice.edit')"))
  assert.ok(purchasesPage.includes('editApproval.request') && purchasesPage.includes('editApproval.dialog'))
  ok('P4: تعديل فاتورة الشراء محروس باعتماد مشرف في الصفحة')
  assert.ok(purchasesPage.includes('const enteredLines = lines.filter'))
  assert.ok(purchasesPage.includes('enteredLines[i]'))
  ok('P2: مطابقة سطور الترحيل بالترتيب لا بالبحث — سطران متطابقان لا يتشاركان صلاحية/سيريالات')

  const returnsPage = readFileSync(join(root, 'src/ui/pages/PurchaseReturnsPage.tsx'), 'utf8')
  assert.ok(returnsPage.includes('useSupervisorApproval()'))
  assert.ok(returnsPage.includes('approval.request') && returnsPage.includes('approval.dialog'))
  assert.ok(returnsPage.includes('approvedBy'))
  ok('P3: مرتجع الشراء خلف حوار موافقة المشرف ويمرر اسم المعتمد')
}

console.log(`\n✅ verify_purchases_review: ${pass} تحققاً — المشتريات مراجعة بعمق المبيعات والمرتجعات`)
