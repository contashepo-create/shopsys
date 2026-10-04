/**
 * 🛡️ رحلة نظام اعتماد المستندات قبل الترحيل (خطة ③):
 * كاشير يدخل مستندات خاضعة للنظام ⇒ تقف كلها بلا أي قيد أو مخزون،
 * والمالك يعتمد فتُرحَّل فعلياً بمراجعها، أو يرفضها بسبب مكتوب فلا أثر.
 *
 * تغطي: بوابة البيع/الشراء/سند القبض/مرتجع المبيعات · منع الكاشير من الاعتماد
 * · حد المبلغ · تجاوز docs.autoApproved · تضييق النطاق · تجاوز المالك
 * · تسلسل Map كميات المرتجع عبر الحمولة · ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_doc_approvals.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

let step = 0
const ok = (name) => { step++; console.log(`  ✓ [${String(step).padStart(2, '0')}] ${name}`) }

const { useDataStore } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const { useAppStore } = await import(pathToFileURL(join(root, 'src/stores/app.store.ts')).href)
const { trialBalance } = await import(pathToFileURL(join(root, 'src/core/financialReports.ts')).href)
const { pendingForUser } = await import(pathToFileURL(join(root, 'src/core/approvals.ts')).href)

const st = () => useDataStore.getState()
const app = () => useAppStore.getState()
const bal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n🛡️ رحلة نظام اعتماد المستندات — لا قيد قبل الاعتماد\n')

/* ═══ 0) التجهيز (النظام موقوف): مورد + صنف بمخزون + عميل + كاشير ═══ */
{
  st().addSupplier({ nameAr: 'مورد الجملة', phone: '0100', address: '', notes: '', openingMinor: 0 })
  st().addItem({
    nameAr: 'سخان كهربائي', sku: 'HT-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 0, stockQty: 0, priceMinor: 160000, minQty: 0,
    trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
    variantColors: [], variantSizes: [], isActive: true,
  })
  const item = st().items.at(-1)
  st().postPurchase({
    supplierId: 0, date: '2026-10-01',
    lines: [{ itemId: item.id, qty: 30, unitPriceMinor: 100000 }],
    expenses: [], paidMinor: 3000000, treasury: '1101', notes: 'تجهيز المخزون',
  })
  st().addCustomer({ nameAr: 'عميل النور', phone: '0100', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const customer = st().customers.at(-1)
  /* كاشير بدور نظامي بلا docs.approve ولا docs.autoApproved — يُزرع مباشرة
     (رحلة فحص لا واجهة) ثم يفعّل النظام بكل نطاقه */
  useDataStore.setState({
    appUsers: [{ id: 1, nameAr: 'كاشير محمد', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }],
    currentUserId: 1,
  })
  app().updateApprovals({ enabled: true, scope: ['sale', 'purchase', 'receipt', 'payment', 'sale_return', 'purchase_return'], thresholdMinor: 0 })
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, 30, 'المخزون جاهز')
  assert.equal(app().approvals.enabled, true, 'النظام مفعّل')
  ok(`التجهيز: صنف بمخزون 30 + عميل «${customer.nameAr}» + كاشير بدور نظامي`)
}

const item = st().items.at(-1)
const customer = st().customers.at(-1)
const saleArgs = () => ({
  lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 160000, unitCostMinor: 100000, discountPercent: 0, soldByWeight: false }],
  customerId: customer.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
})

/* ═══ 1) الكاشير يبيع ⇒ طلب اعتماد بلا قيد ولا مخزون ═══ */
{
  const before = { journal: st().journal.length, sales: st().sales.length, stock: item.stockQty, approvals: st().docApprovals.length }
  assert.throws(() => st().postSale(saleArgs()), /للاعتماد/)
  const after = { journal: st().journal.length, sales: st().sales.length, stock: st().items.find((row) => row.id === item.id).stockQty, approvals: st().docApprovals.length }
  assert.equal(after.journal, before.journal, 'لا قيد قبل الاعتماد')
  assert.equal(after.sales, before.sales, 'لا فاتورة قبل الاعتماد')
  assert.equal(after.stock, before.stock, 'لا حركة مخزون قبل الاعتماد')
  assert.equal(after.approvals, before.approvals + 1, 'طلب معلّق واحد')
  const request = st().docApprovals.at(-1)
  assert.equal(request.kind, 'sale')
  assert.equal(request.status, 'pending')
  assert.equal(request.requestedBy, 1)
  assert.equal(request.requestedByName, 'كاشير محمد')
  assert.equal(request.partyName, 'عميل النور')
  assert.equal(request.amountMinor, 320000, 'قيمة الطلب = قيمة الفاتورة')
  globalThis.__stockAtDefer = after.stock
  ok('بيع الكاشير وقف بطلب اعتماد — لا قيد ولا فاتورة ولا مخزون')
}

/* ═══ 2) الكاشير لا يعتمد؛ المالك يعتمد ⇒ الترحيل الفعلي بمرجعه ═══ */
{
  const request = st().docApprovals.at(-1)
  /* صلاحية القرار: الكاشير يُرفض حتى لو حاول من المتجر مباشرة */
  assert.throws(() => st().decideDocApproval(request.id, { status: 'approved', by: 1, byName: 'كاشير محمد' }), /صلاحية/)
  assert.equal(request.status, 'pending', 'الطلب لم يتغيّر بعد محاولة الكاشير')
  const decided = st().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
  assert.equal(decided.status, 'approved')
  const sale = st().sales.find((row) => row.id === decided.postedDocumentId)
  assert.ok(sale, 'الفاتورة موجودة بعد الاعتماد')
  assert.equal(decided.postedDocumentRef, sale.invoiceNumber, 'مرجع الطلب = رقم الفاتورة')
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, globalThis.__stockAtDefer - 2, 'المخزون خُصم بعد الاعتماد فقط')
  assert.ok(st().journal.some((e) => e.sourceId === sale.id && e.sourceType === 'sale'), 'قيد البيع وُلد بالاعتماد')
  assert.equal(st().docApprovals.filter((row) => row.status === 'pending').length, 0)
  ok(`المالك اعتمد ⇒ رُحِّلت ${sale.invoiceNumber} بقيدها ومخزونها (${decided.postedDocumentRef})`)
}

/* ═══ 3) رفض شراء بسبب مكتوب ⇒ لا أثر محاسبي إطلاقاً ═══ */
{
  const before = { journal: st().journal.length, purchases: st().purchases.length }
  useDataStore.setState({ currentUserId: 1 })
  assert.throws(() => st().postPurchase({
    supplierId: st().suppliers[0].id, date: '2026-10-01',
    lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 90000 }],
    expenses: [], paidMinor: 0, notes: 'شراء آجل ينتظر اعتماداً',
  }), /للاعتماد/)
  const request = st().docApprovals.at(-1)
  assert.equal(request.kind, 'purchase')
  assert.throws(() => st().decideDocApproval(request.id, { status: 'rejected', by: null, byName: 'المالك' }), /سبب الرفض/, 'الرفض بلا سبب مرفوض')
  const decided = st().decideDocApproval(request.id, { status: 'rejected', by: null, byName: 'المالك', reason: 'السعر أعلى من المتفق عليه' })
  assert.equal(decided.status, 'rejected')
  assert.equal(decided.reason, 'السعر أعلى من المتفق عليه')
  assert.equal(st().journal.length, before.journal, 'الرفض لا يُنشئ قيداً')
  assert.equal(st().purchases.length, before.purchases, 'الرفض لا يُنشئ فاتورة')
  ok('رفض شراء بسبب مكتوب — لا قيد ولا فاتورة')
}

/* ═══ 4) سند قبض الكاشير ⇒ معلّق ثم معتمد يظهر بسجل السندات ═══ */
{
  const before = { vouchers: st().vouchers.length, treasury: bal('1101') }
  assert.throws(() => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 50000, description: 'دفعة من العميل', partyKind: 'customer', partyId: customer.id }), /للاعتماد/)
  assert.equal(bal('1101'), before.treasury, 'السند المعلّق لا يمسّ الخزينة')
  const request = st().docApprovals.at(-1)
  assert.equal(request.kind, 'receipt')
  assert.equal(request.partyName, 'عميل النور')
  const decided = st().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
  const voucher = st().vouchers.find((row) => row.id === decided.postedDocumentId)
  assert.ok(voucher, 'سند القبض وُلد بالاعتماد')
  assert.equal(decided.postedDocumentRef, voucher.voucherNumber)
  assert.equal(st().vouchers.length, before.vouchers + 1)
  assert.equal(bal('1101'), before.treasury + 50000, 'الخزينة حُقنت بمبلغ السند بالاعتماد')
  ok(`سند القبض اعتُمد ورُحِّل ${voucher.voucherNumber} — الخزينة +500 ج.م`)
}

/* ═══ 5) حد المبلغ: ما دونه يُرحَّل فوراً بلا انتظار ═══ */
{
  app().updateApprovals({ thresholdMinor: 10000000 })
  const before = st().docApprovals.length
  const sale = st().postSale(saleArgs())
  assert.ok(sale.invoiceNumber, 'تحت الحد يُرحَّل مباشرة')
  assert.equal(st().docApprovals.length, before, 'لا طلب جديد تحت الحد')
  app().updateApprovals({ thresholdMinor: 0 })
  ok('حد المبلغ 100,000 ج.م: فاتورة 3,200 ج.م عبرت مباشرة')
}

/* ═══ 6) تجاوز docs.autoApproved: مستندات الكاشير تُرحَّل فوراً ═══ */
{
  useDataStore.setState({ appUsers: [{ id: 1, nameAr: 'كاشير محمد', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, extraPerms: ['docs.autoApproved'] }] })
  const before = st().docApprovals.length
  const sale = st().postSale(saleArgs())
  assert.ok(sale.id > 0)
  assert.equal(st().docApprovals.length, before, 'المستخدم المعتمد تلقائياً لا يقف على البوابة')
  useDataStore.setState({ appUsers: [{ id: 1, nameAr: 'كاشير محمد', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }] })
  ok('صلاحية docs.autoApproved: بيع الكاشير رُحِّل فوراً')
}

/* ═══ 7) مرتجع مبيعات بالتجميع القديم (Map) ⇒ الحمولة تعبر وتُنفَّذ ═══ */
{
  const firstSale = st().sales.find((row) => row.invoiceNumber === st().docApprovals.find((r) => r.kind === 'sale' && r.status === 'approved')?.postedDocumentRef) ?? st().sales[0]
  const before = { stock: st().items.find((row) => row.id === item.id).stockQty, returns: st().saleReturns.length }
  assert.throws(() => st().postSaleReturn({ saleId: firstSale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', reason: 'اختبار بوابة المرتجع' }), /للاعتماد/)
  const request = st().docApprovals.at(-1)
  assert.equal(request.kind, 'sale_return')
  assert.ok(request.title.includes(firstSale.invoiceNumber), 'عنوان الطلب يذكر الفاتورة الأصلية')
  const decided = st().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
  const ret = st().saleReturns.find((row) => row.id === decided.postedDocumentId)
  assert.ok(ret, 'المرتجع وُلد بالاعتماد')
  assert.equal(decided.postedDocumentRef, ret.refCode)
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, before.stock + 1, 'الكمية عادت للمخزون بالاعتماد')
  assert.equal(st().saleReturns.length, before.returns + 1)
  ok(`مرتجع Map الكميات عبر الحمولة ورُحِّل ${ret.refCode}`)
}

/* ═══ 8) تضييق النطاق لشراء فقط ⇒ البيع يمر مباشرة ═══ */
{
  app().updateApprovals({ scope: ['purchase'] })
  const before = st().docApprovals.length
  const sale = st().postSale(saleArgs())
  assert.ok(sale.id > 0)
  assert.equal(st().docApprovals.length, before, 'البيع خارج النطاق لا يعلّق')
  app().updateApprovals({ scope: ['sale', 'purchase', 'receipt', 'payment', 'sale_return', 'purchase_return'] })
  ok('نطاق «شراء فقط»: بيع الكاشير رُحِّل مباشرة')
}

/* ═══ 9) المالك نفسه لا يقف على البوابة (كل الصلاحيات) ═══ */
{
  useDataStore.setState({ currentUserId: null })
  const before = st().docApprovals.length
  const sale = st().postSale(saleArgs())
  assert.ok(sale.id > 0)
  assert.equal(st().docApprovals.length, before, 'المالك بكل الصلاحيات يتجاوز تلقائياً')
  ok('بيع المالك رُحِّل مباشرة — docs.autoApproved ضمن كل صلاحياته')
}

/* ═══ 10) قوائم المعتمِد + إيقاف النظام + ميزان متزن ═══ */
{
  useDataStore.setState({ currentUserId: 1 })
  assert.throws(() => st().postSale(saleArgs()), /للاعتماد/)
  const pending = st().docApprovals.filter((row) => row.status === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pendingForUser(st().docApprovals, 1, false).length, 0, 'الكاشير لا يرى طلبه لنفسه')
  assert.equal(pendingForUser(st().docApprovals, null, true).length, 1, 'المالك يرى طلب الكاشير')
  app().updateApprovals({ enabled: false })
  const sale = st().postSale(saleArgs())
  assert.ok(sale.id > 0, 'إيقاف النظام يُرحّل كل شيء فوراً')
  app().updateApprovals({ enabled: true })
  ok('pendingForUser: طلب الكاشير له خفي، للمالك ظاهر — والإيقاف يُرحّل فوراً')

  const report = trialBalance(st().journal, { from: '2000-01-01', to: '2099-12-31' })
  const totalDebit = report.rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = report.rows.reduce((s, r) => s + r.credit, 0)
  assert.equal(totalDebit, totalCredit, 'ميزان المراجعة متزن')
  for (const entry of st().journal) {
    const d = entry.lines.reduce((s, l) => s + l.debit, 0)
    const c = entry.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, `قيد غير متوازن: #${entry.id}`)
  }
  ok(`ميزان المراجعة متزن (${st().journal.length} قيداً) بعد كل قرارات الاعتماد`)
}

console.log(`\n✅ اكتملت رحلة نظام الاعتماد — ${step} فحصاً ناجحاً\n`)
