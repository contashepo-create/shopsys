/**
 * مراجعة العملاء والموردين الشاملة (نفس عمق الأقسام السابقة):
 * P1) الفجوات المسدودة: حذف طرف عليه رصيد/معاملات كان يمر ويترك 1104/2101 يتيمة
 * P2) الفجوات المسدودة: اسم فارغ واسم مكرر كانا يمران من المستودع
 * P3) الرصيد الافتتاحي: قيد فعلي، تعديل بفرق، ورفض معرف شبح
 * P4) كشف العميل: فاتورة آجلة + دفع مجزأ + مرتجع + سند + شيك (وارتداده) = 1104
 * P5) كشف المورد: شراء آجل + مرتجع debt + سند + شيك (وإلغاؤه) = 2101
 * P6) حد الائتمان: بيع يتجاوز الحد يُرفض، override باسم معتمد يمرره ويرفع الرصيد
 * P7) أعمار الديون (الفجوة العالمية المسدودة): FIFO + شرائح 30/60/90 + افتتاحي قديم
 * P8) توحيد المصدر: getCustomerBalance = statementBalance(getCustomerStatementRows)
 * P9) التسويات على الأطراف تدخل الرصيد والكشف
 * P10) الحذف النظيف: طرف بلا أي أثر يُحذف طبيعياً
 * P11) الثوابت: قيود متوازنة، لا كشوف لأطراف محذوفة
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { agingFromStatement, supplierRowsForAging, statementBalance } = await import(join(root, 'src/core/statements.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const st = () => useDataStore.getState()
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

console.log('\n— P1) حذف طرف له رصيد/معاملات (الفجوة المسدودة) —')
{
  st().addCustomer({ nameAr: 'مدين قائم', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const c = st().customers.at(-1)
  st().setOpeningBalance({ kind: 'customer', refId: c.id, amountMinor: 70000, label: c.nameAr })
  assert.throws(() => st().removeCustomer(c.id), /رصيد قائم/)
  assert.ok(st().customers.some((x) => x.id === c.id))
  ok('P1: عميل عليه 700 لا يُحذف (كان يُحذف ويترك 1104 يتيمة!)')
  st().addSupplier({ nameAr: 'دائن قائم', phone: '', notes: '' })
  const sp = st().suppliers.at(-1)
  st().setOpeningBalance({ kind: 'supplier', refId: sp.id, amountMinor: 50000, label: sp.nameAr })
  assert.throws(() => st().removeSupplier(sp.id), /رصيد قائم/)
  ok('P1: مورد له 500 لا يُحذف')
  // عميل رصيده صفر لكن له فواتير: يُمنع أيضاً (سجل تدقيق)
  st().addCustomer({ nameAr: 'عميل بسجل', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const c2 = st().customers.at(-1)
  st().addItem({ nameAr: 'صنف الأطراف', sku: 'P-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 10000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  st().addSupplier({ nameAr: 'مورد التغذية', phone: '', notes: '' })
  const feeder = st().suppliers.at(-1)
  st().postPurchase({ supplierId: feeder.id, date: '2026-09-18', lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 5000 }], expenses: [], paidMinor: 250000, notes: '' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c2.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().getCustomerBalance(c2.id), 0)
  assert.throws(() => st().removeCustomer(c2.id), /معاملات مسجلة/)
  ok('P1: عميل رصيده صفر لكن له فواتير لا يُحذف — التاريخ لا يُمحى (عرف QuickBooks: make inactive)')
  assert.throws(() => st().removeSupplier(feeder.id), /رصيد قائم|معاملات مسجلة/)
  ok('P1: مورد له فواتير شراء لا يُحذف')
}

console.log('\n— P2) اسم فارغ ومكرر (الفجوة المسدودة) —')
{
  assert.throws(() => st().addCustomer({ nameAr: '   ', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 }), /مطلوب/)
  ok('P2: عميل باسم فارغ يُرفض (كان يمر!)')
  assert.throws(() => st().addCustomer({ nameAr: 'مدين قائم', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 }), /بنفس الاسم/)
  ok('P2: عميل باسم مكرر يُرفض (كان يمر — التباس في البيع الآجل والكشوف)')
  assert.throws(() => st().addSupplier({ nameAr: 'دائن قائم', phone: '', notes: '' }), /بنفس الاسم/)
  ok('P2: مورد باسم مكرر يُرفض')
  const c = st().customers.find((x) => x.nameAr === 'مدين قائم')
  const other = st().customers.find((x) => x.nameAr === 'عميل بسجل')
  assert.throws(() => st().updateCustomer(other.id, { nameAr: 'مدين قائم' }), /بنفس الاسم/)
  st().updateCustomer(c.id, { nameAr: 'مدين قائم' }) // نفس اسمه هو — مسموح
  ok('P2: التعديل لاسم عميل آخر مرفوض، ولاسمه نفسه مسموح')
}

console.log('\n— P3) الرصيد الافتتاحي —')
{
  const c = st().customers.find((x) => x.nameAr === 'مدين قائم')
  assert.equal(st().getCustomerBalance(c.id), 70000)
  assert.equal(bal('1104'), 70000)
  ok('P3: افتتاحي العميل 700 بقيد فعلي (1104/3101) والرصيد يطابق')
  st().setOpeningBalance({ kind: 'customer', refId: c.id, amountMinor: 90000, label: c.nameAr })
  assert.equal(st().getCustomerBalance(c.id), 90000)
  assert.equal(bal('1104'), 90000)
  ok('P3: تعديل الافتتاحي 700→900 بقيد فرق 200 لا بقيد مكرر')
  assert.throws(() => st().setOpeningBalance({ kind: 'customer', refId: 9876, amountMinor: 1000, label: 'شبح' }), /غير موجود/)
  ok('P3: افتتاحي لعميل شبح يُرفض (فخ mobileshop)')
}

console.log('\n— P4) كشف العميل الكامل —')
{
  st().addCustomer({ nameAr: 'عميل الكشف', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const c = st().customers.at(-1)
  const item = st().items.at(-1)
  // فاتورة آجلة 100 + دفع مجزأ (فاتورة 100 مدفوع 40)
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c.id, payment: 'credit', paidMinor: 4000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().getCustomerBalance(c.id), 16000)
  ok('P4: فاتورتان (آجلة 100 + مجزأة متبقيها 60) ⇒ ذمته 160 — الدفع المجزأ لا يضخم الدين')
  // سند قبض 50
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 5000, description: 'دفعة', partyKind: 'customer', partyId: c.id })
  // شيك وارد 60 ثم يرتد
  const chq = st().receiveCheque({ chequeNumber: 'PR-1', partyId: c.id, bankName: 'الأهلي', amountMinor: 6000, dueDate: '2026-10-01', notes: '' })
  assert.equal(st().getCustomerBalance(c.id), 5000)
  st().setChequeStatus(chq.id, 'bounced')
  assert.equal(st().getCustomerBalance(c.id), 11000)
  ok('P4: سند 50 وشيك 60 خفضا الدين لـ50، وارتداد الشيك أعاده لـ110')
  const rows = st().getCustomerStatementRows(c.id)
  assert.equal(statementBalance(rows), st().getCustomerBalance(c.id))
  assert.ok(rows.some((r) => r.docLabel.includes('ارتداد')))
  ok('P4: الكشف يحوي صف الارتداد ورصيده الختامي = رصيد الشاشات حرفياً')
}

console.log('\n— P5) كشف المورد الكامل —')
{
  st().addSupplier({ nameAr: 'مورد الكشف', phone: '', notes: '' })
  const sp = st().suppliers.at(-1)
  const item = st().items.at(-1)
  st().postPurchase({ supplierId: sp.id, date: '2026-09-18', lines: [{ itemId: item.id, qty: 20, unitPriceMinor: 5000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.equal(st().getSupplierBalance(sp.id), 100000)
  const purchase = st().purchases.at(-1)
  // مرتجع شراء على الحساب (debt)
  st().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 2]]), refund: 'debt', reason: 'فائض', approvedBy: 'المشرف' })
  assert.equal(st().getSupplierBalance(sp.id), 90000)
  ok('P5: شراء آجل 1000 − مرتجع 100 على الحساب = 900')
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 40000, description: 'سداد', partyKind: 'supplier', partyId: sp.id })
  const chq = st().issueCheque({ chequeNumber: 'PP-1', partyId: sp.id, bankName: 'CIB', amountMinor: 50000, dueDate: '2026-10-10', notes: '' })
  assert.equal(st().getSupplierBalance(sp.id), 0)
  st().setChequeStatus(chq.id, 'cancelled')
  assert.equal(st().getSupplierBalance(sp.id), 50000)
  ok('P5: سند 400 + شيك 500 صفّرا مستحقه، وإلغاء الشيك أعاد 500')
  const rows = st().getSupplierStatementRows(sp.id)
  assert.equal(statementBalance(rows), 50000)
  ok('P5: كشف المورد = رصيد الشاشات')
}

console.log('\n— P6) حد الائتمان —')
{
  st().addCustomer({ nameAr: 'محدود الائتمان', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 15000 })
  const c = st().customers.at(-1)
  const item = st().items.at(-1)
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.throws(
    () => st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
    /حد الائتمان|الائتمان/,
  )
  assert.equal(st().getCustomerBalance(c.id), 10000)
  ok('P6: بيع آجل ثانٍ يرفع ذمته 100→200 فوق حده 150 مرفوض')
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false }], customerId: c.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', creditLimitOverrideBy: 'المالك' })
  assert.equal(st().getCustomerBalance(c.id), 20000)
  ok('P6: تجاوز الحد باعتماد معتمد بالاسم يمر — نمط manager override العالمي')
}

console.log('\n— P7) أعمار الديون (الفجوة العالمية المسدودة) —')
{
  const today = '2026-09-18'
  // كشف صناعي: افتتاحي 100 + دين 200 (قديم 75ي) + دين 300 (45ي) + دين 400 (10ي) − سداد 250
  const rows = [
    { date: '0000-00-00', docLabel: 'رصيد افتتاحي', debitMinor: 10000, creditMinor: 0, balanceMinor: 0 },
    { date: '2026-07-05', docLabel: 'فاتورة قديمة', debitMinor: 20000, creditMinor: 0, balanceMinor: 0 },
    { date: '2026-08-04', docLabel: 'فاتورة وسط', debitMinor: 30000, creditMinor: 0, balanceMinor: 0 },
    { date: '2026-09-08', docLabel: 'فاتورة حديثة', debitMinor: 40000, creditMinor: 0, balanceMinor: 0 },
    { date: '2026-09-10', docLabel: 'سند قبض', debitMinor: 0, creditMinor: 25000, balanceMinor: 0 },
  ]
  const a = agingFromStatement(rows, today)
  // FIFO: السداد 250 يأكل الافتتاحي 100 + 150 من القديمة ⇒ يبقى قديمة 50 (75ي) + وسط 300 (45ي) + حديثة 400 (10ي)
  assert.equal(a.over90Minor, 0)
  assert.equal(a.d61_90Minor, 5000)
  assert.equal(a.d31_60Minor, 30000)
  assert.equal(a.currentMinor, 40000)
  assert.equal(a.totalMinor, 75000)
  ok('P7: تخصيص FIFO: السداد أكل الافتتاحي وجزء الأقدم — الشرائح 50/300/400 بالقرش')
  // افتتاحي وحده بلا سداد = +90
  const a2 = agingFromStatement([{ date: '0000-00-00', docLabel: 'افتتاحي', debitMinor: 7000, creditMinor: 0, balanceMinor: 0 }], today)
  assert.equal(a2.over90Minor, 7000)
  ok('P7: الرصيد الافتتاحي غير المسدد يقع في +90 تلقائياً')
  // التكامل الحي: مجموع أعمار كل عميل = رصيده
  for (const c of st().customers) {
    const balNow = st().getCustomerBalance(c.id)
    if (balNow <= 0) continue
    const live = agingFromStatement(st().getCustomerStatementRows(c.id), today)
    assert.equal(live.totalMinor, balNow, `أعمار ${c.nameAr}`)
  }
  ok('P7: مجموع شرائح كل عميل حي = رصيده الموحد — لا حساب موازٍ')
  // المورد بالقلب
  for (const sp of st().suppliers) {
    const balNow = st().getSupplierBalance(sp.id)
    if (balNow <= 0) continue
    const live = agingFromStatement(supplierRowsForAging(st().getSupplierStatementRows(sp.id)), today)
    assert.equal(live.totalMinor, balNow, `أعمار ${sp.nameAr}`)
  }
  ok('P7: أعمار الموردين (قلب الأعمدة) = أرصدتهم')
}

console.log('\n— P8) توحيد المصدر —')
{
  for (const c of st().customers) {
    assert.equal(st().getCustomerBalance(c.id), statementBalance(st().getCustomerStatementRows(c.id)))
  }
  for (const sp of st().suppliers) {
    assert.equal(st().getSupplierBalance(sp.id), statementBalance(st().getSupplierStatementRows(sp.id)))
  }
  ok('P8: الرصيد = ختام الكشف لكل الأطراف — دالة واحدة لا نسختان')
  const reports = readFileSync(join(root, 'src/ui/pages/ReportsPage.tsx'), 'utf8')
  assert.ok(reports.includes('agingFromStatement') && reports.includes('getCustomerStatementRows'))
  ok('P8: تقرير الأعمار في الشاشة يقرأ من نفس صفوف الكشف')
}

console.log('\n— P9) التسويات على الأطراف —')
{
  const c = st().customers.find((x) => x.nameAr === 'عميل الكشف')
  const before = st().getCustomerBalance(c.id)
  const doc = st().applySettlement({ section: 'customer', refId: String(c.id), actualMinor: before - 1000, reason: 'إعدام جزئي متفق عليه', approvedBy: 'المالك' })
  assert.equal(doc.varianceMinor, -1000)
  assert.equal(st().getCustomerBalance(c.id), before - 1000)
  assert.ok(st().getCustomerStatementRows(c.id).some((r) => r.docLabel.includes('تسوية')))
  ok('P9: تسوية −10 على العميل دخلت رصيده وكشفه بقيد 5112')
}

console.log('\n— P10) الحذف النظيف —')
{
  st().addCustomer({ nameAr: 'عابر بلا أثر', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const c = st().customers.at(-1)
  st().removeCustomer(c.id)
  assert.ok(!st().customers.some((x) => x.id === c.id))
  ok('P10: عميل بلا أي معاملة يُحذف طبيعياً')
  st().addSupplier({ nameAr: 'مورد عابر', phone: '', notes: '' })
  const sp = st().suppliers.at(-1)
  st().removeSupplier(sp.id)
  ok('P10: مورد بلا أثر يُحذف طبيعياً')
}

console.log('\n— P11) الثوابت —')
{
  for (const e of st().journal) assertBalanced(e.lines)
  ok(`P11: كل القيود (${st().journal.length}) متوازنة`)
  // 1104 في الدفتر = مجموع أرصدة العملاء الموجبة والسالبة معاً محسوبة من الكشوف
  const sumCust = st().customers.reduce((s, c) => s + st().getCustomerBalance(c.id), 0)
  assert.equal(bal('1104'), sumCust)
  ok('P11: 1104 بالدفتر = Σ أرصدة كل العملاء بالقرش')
  const sumSupp = st().suppliers.reduce((s, sp) => s + st().getSupplierBalance(sp.id), 0)
  assert.equal(-bal('2101'), sumSupp)
  ok('P11: 2101 بالدفتر = Σ مستحقات كل الموردين بالقرش')
}

console.log(`\n✅ verify_parties_review: ${pass} تحققاً — العملاء والموردون مراجعون بعمق الأقسام السابقة`)
