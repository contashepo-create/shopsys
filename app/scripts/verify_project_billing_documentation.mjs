/**
 * 🧾 فحص دائم — فوترة المشاريع، النموذج (أ)، الشريحة أ-٢: «فاتورة التوثيق»
 * (قرار المالك: المستخلص هو الأصل المالي، وفاتورة التوثيق ورقته الضريبية):
 *  أ) ترحيل صامت: قيد تذكاري بلا سطور، وكل أرصدة الدفتر ورصيد العميل
 *     والمخزون ونقاط الولاء كما هي بالقرش قبل وبعد.
 *  ب) الحارس: «المتاح للتوثيق» ينقص بإجمالي الفاتورة، و«المتاح لإضافية»
 *     لا يتأثر بها (لا ازدواج فوترة فوق المستخلصات).
 *  ج) التجميعات: ملخص/يومية المبيعات وأرباح الأصناف وكشف العميل لا يرونها.
 *  د) الرفضات: فوق المستخلَص غير الموثَّق، بلا مستخلصات محددة، مستخلص
 *     مشروع آخر، عميل غير عميل المشروع، صنف مخزني، تحصيل/عمولة/مصروف،
 *     تعديل الفاتورة، واستبدالها.
 *  هـ) مرتجع التوثيق: تخفيض فقط، صامت دفترياً، يعيد المتاح للتوثيق.
 *  و) بعد التوثيق الكامل للمستخلص، «إضافية» بتمام سقف العقد ما زالت تمر.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_project_billing_documentation.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'contracting', countryCode: 'EG' }, license: { plan: 'pro' } } }))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}، المتوقع ${b}`); pass++; console.log('  ✓', name) }
const throws = (fn, re, name) => { assert.throws(fn, re, name); pass++; console.log('  ✓', name) }

const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?docbilling=1`)
const { salesSummary, dailySales, topItems } = await import(pathToFileURL(join(root, 'src/core/reports.ts')).href)
const S = () => useDataStore.getState()
const PERIOD = { from: '2000-01-01', to: '2100-01-01' }

/** بصمة الدفتر كاملة: رصيد كل حساب (مدين − دائن) من كل القيود */
const ledgerFingerprint = () => {
  const balances = {}
  for (const entry of S().journal) {
    for (const line of entry.lines) balances[line.accountCode] = (balances[line.accountCode] ?? 0) + line.debit - line.credit
  }
  return JSON.stringify(balances)
}

console.log('\n═══ تجهيز: عميل + مشروع عقد 1,000,000 + مستخلص أعمال 600,000 (+14٪) ═══')
S().seed([])
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
S().addCustomer({ nameAr: 'المالك العقاري', phone: '0100', notes: '', creditLimitMinor: 0, ...EXT })
S().addCustomer({ nameAr: 'عميل آخر', phone: '0101', notes: '', creditLimitMinor: 0, ...EXT })
const client = S().customers.at(-2)
const stranger = S().customers.at(-1)
const prj = S().addProject({ nameAr: 'برج النيل', clientName: client.nameAr, clientId: client.id, contractValueMinor: 100_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
const prj2 = S().addProject({ nameAr: 'مشروع مجاور', clientName: client.nameAr, clientId: client.id, contractValueMinor: 10_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
S().addProjectExtract({ projectId: prj.id, grossMinor: 60_000_000, vatPercent: 14, payment: 'credit', description: 'مستخلص ١ — خرسانات' })
S().addProjectExtract({ projectId: prj2.id, grossMinor: 5_000_000, vatPercent: 14, payment: 'credit', description: 'مستخلص المشروع الآخر' })
const extract = S().projectExtracts.find((e) => e.projectId === prj.id)
const foreignExtract = S().projectExtracts.find((e) => e.projectId === prj2.id)
S().addItem({ nameAr: 'أعمال خرسانية', sku: 'SVC-CONC', barcodes: [], categoryId: 1, baseUnit: 'مقطوعية', extraUnits: [], costMinor: 0, priceMinor: 0, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: true })
const svc = S().items.at(-1)
S().addItem({ nameAr: 'أسمنت', sku: 'CEM-1', barcodes: [], categoryId: 1, baseUnit: 'شيكارة', extraUnits: [], costMinor: 5_000, priceMinor: 6_000, minQty: 0, stockQty: 100, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false })
const cement = S().items.at(-1)

const docArgs = (unitPriceMinor, extra = {}) => ({
  lines: [{ itemId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: client.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
  projectId: prj.id, projectBilling: 'documentation', extractIds: [extract.id], ...extra,
})

const g0 = S().getProjectBillingGuard(prj.id)
eq(g0.availableToDocumentGrossMinor, 68_400_000, 'المتاح للتوثيق = المستخلص شامل ضريبته')
eq(g0.extraRoomNetMinor, 40_000_000, 'المتاح لإضافية = العقد − المستخلص')

console.log('\n═══ أ+ب+ج) ترحيل صامت: لا دفتر ولا ذمة ولا تقارير تتغير ═══')
const ledgerBefore = ledgerFingerprint()
const journalLenBefore = S().journal.length
const balanceBefore = S().getCustomerBalance(client.id)
const summaryBefore = salesSummary(S().sales, S().saleReturns, PERIOD)
const dailyBefore = JSON.stringify(dailySales(S().sales, PERIOD))
const itemsBefore = JSON.stringify(topItems(S().sales, S().saleReturns, PERIOD, 50))
const stmtBefore = S().getCustomerStatementRows(client.id)

const doc = S().postSale(docArgs(34_200_000)) // 342,000 شامل الضريبة
eq(doc.projectBilling, 'documentation', 'طبيعة «توثيق» مختومة على المستند')
eq(doc.extractIds.join(','), String(extract.id), 'المستخلص الموثَّق مختوم على المستند')
eq(doc.paidMinor, 0, 'لا محصَّل على فاتورة التوثيق')
eq(S().journal.length, journalLenBefore + 1, 'وُلد قيد واحد فقط')
const memoEntry = S().journal.find((e) => e.id === doc.journalEntryId)
eq(memoEntry.lines.length, 0, 'القيد التذكاري بلا سطور (صفر أثر دفتري)')
ok(memoEntry.description.includes('توثيق'), 'وصف القيد يعلن طبيعته التوثيقية')
eq(ledgerFingerprint(), ledgerBefore, 'كل أرصدة الدفتر كما هي بالقرش')
eq(S().getCustomerBalance(client.id), balanceBefore, 'رصيد العميل لم يتغير (الذمة بالمستخلص فقط)')
eq(S().items.find((i) => i.id === cement.id).stockQty, 100, 'المخزون لم يُمس')
eq(S().customers.find((c) => c.id === client.id).loyaltyPoints ?? 0, 0, 'لا نقاط ولاء مكررة')

const g1 = S().getProjectBillingGuard(prj.id)
eq(g1.documentedGrossMinor, 34_200_000, 'الموثَّق = إجمالي فاتورة التوثيق')
eq(g1.availableToDocumentGrossMinor, 68_400_000 - 34_200_000, 'المتبقي للتوثيق نقص بمقدارها')
eq(g1.extraRoomNetMinor, 40_000_000, 'المتاح لإضافية لم يتأكل بالتوثيق (لا ازدواج)')

const summaryAfter = salesSummary(S().sales, S().saleReturns, PERIOD)
eq(summaryAfter.invoiceCount, summaryBefore.invoiceCount, 'ملخص المبيعات لا يعدّها فاتورة بيع')
eq(summaryAfter.totalMinor, summaryBefore.totalMinor, 'إجمالي المبيعات لم يتضخم بها')
eq(summaryAfter.taxMinor, summaryBefore.taxMinor, 'ضريبة المبيعات لم تتكرر بها')
eq(JSON.stringify(dailySales(S().sales, PERIOD)), dailyBefore, 'يومية المبيعات لا تراها')
eq(JSON.stringify(topItems(S().sales, S().saleReturns, PERIOD, 50)), itemsBefore, 'أرباح الأصناف لا تراها')
eq(S().getCustomerStatementRows(client.id).length, stmtBefore.length, 'كشف العميل بلا صف توثيق مضلّل')

console.log('\n═══ د) الرفضات: كل محاولة لفكّ صمت التوثيق تُصدّ ═══')
throws(() => S().postSale(docArgs(34_200_100)), /سقف توثيق المشروع/, 'توثيق فوق المستخلَص غير الموثَّق يُرفض')
throws(() => S().postSale(docArgs(100, { extractIds: [] })), /المستخلصات الموثَّقة/, 'توثيق بلا مستخلصات محددة يُرفض')
throws(() => S().postSale(docArgs(100, { extractIds: [foreignExtract.id] })), /لا يخص مشروع/, 'مستخلص مشروع آخر يُرفض')
throws(() => S().postSale(docArgs(100, { customerId: stranger.id })), /عميل المشروع نفسه/, 'توثيق لغير عميل المشروع يُرفض')
throws(() => S().postSale(docArgs(100, { lines: [{ itemId: cement.id, nameAr: cement.nameAr, qty: 1, unitPriceMinor: 100, unitCostMinor: 5_000, discountPercent: 0, soldByWeight: false }] })), /بنود خدمية/, 'صنف مخزني في توثيق يُرفض')
throws(() => S().postSale(docArgs(100, { paidMinor: 100 })), /لا تحصيل عليها/, 'تحصيل على توثيق يُرفض')
throws(() => S().postSale(docArgs(100, { internalExpenses: [{ label: 'نقل', amountMinor: 100, taxPercent: 0, taxTreatment: 'inclusive', settlement: 'paid_now' }] })), /بلا مصروفات داخلية/, 'مصروف داخلي على توثيق يُرفض')
throws(() => S().postSale(docArgs(100, { staffCommission: { employeeId: 1, amountMinor: 100 } })), /بلا عمولات/, 'عمولة على توثيق تُرفض')
throws(() => S().editSale({ saleId: doc.id, lines: doc.lines, reason: 'تصحيح', einvoiceActive: false }), /لا تُعدَّل/, 'تعديل فاتورة التوثيق ممنوع')
throws(() => S().postExchange({ originalSaleId: doc.id, returnQtyByItem: new Map([[svc.id, 1]]), newLines: doc.lines }), /لا تُستبدل/, 'استبدال فاتورة التوثيق ممنوع')

console.log('\n═══ هـ) مرتجع التوثيق: تخفيض صامت يعيد المتاح ═══')
throws(
  () => S().postSaleReturn({ saleId: doc.id, qtyByItem: new Map([[svc.id, 1]]), refund: 'cash', reason: 'خطأ بالمبلغ' }),
  /«تخفيضاً» فقط/,
  'رد نقدي لمرتجع توثيق يُرفض',
)
const ledgerBeforeReturn = ledgerFingerprint()
const ret = S().postSaleReturn({ saleId: doc.id, qtyByItem: new Map([[svc.id, 1]]), refund: 'credit', reason: 'أُصدرت بمبلغ خاطئ' })
eq(ret.projectBilling, 'documentation', 'ختم التوثيق على المرتجع نفسه')
eq(S().journal.find((e) => e.id === ret.journalEntryId).lines.length, 0, 'قيد مرتجع التوثيق تذكاري بلا سطور')
eq(ledgerFingerprint(), ledgerBeforeReturn, 'الدفتر ثابت بعد مرتجع التوثيق أيضاً')
eq(S().getCustomerBalance(client.id), balanceBefore, 'رصيد العميل ثابت بعد المرتجع')
const g2 = S().getProjectBillingGuard(prj.id)
eq(g2.documentedGrossMinor, 0, 'المرتجع صفّر الموثَّق')
eq(g2.availableToDocumentGrossMinor, 68_400_000, 'المتاح للتوثيق عاد كاملاً')

console.log('\n═══ و) التوثيق الكامل لا يأكل سقف العقد للإضافيات ═══')
S().postSale(docArgs(68_400_000)) // توثيق المستخلص كاملاً
eq(S().getProjectBillingGuard(prj.id).availableToDocumentGrossMinor, 0, 'المستخلص وُثّق بتمامه')
const extraArgs = {
  lines: [{ itemId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor: 40_000_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: client.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
  projectId: prj.id, projectBilling: 'extra',
}
const extra = S().postSale(extraArgs)
ok(extra.id > 0, 'إضافية بتمام المتاح الأصلي (400,000) تمرّ بعد توثيق شامل')
eq(S().getProjectBillingGuard(prj.id).extraRoomNetMinor, 0, 'والآن فقط أُقفل سقف العقد')

console.log('\n═══ ز) أسلاك الواجهة (أ-٢ب): الطبيعة إلزامية من فاتورة البيع ═══')
{
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(join(root, 'src/ui/pages/AdvancedSalesInvoicePage.tsx'), 'utf8')
  ok(page.includes("data-billing-nature=\"documentation\"") && page.includes("data-billing-nature=\"extra\""), 'محدد الطبيعة بفرعيه في فاتورة البيع')
  ok(page.includes('projectBilling:projectId>0?projectBilling:undefined'), 'الطبيعة تُرسل دائماً إذا اختير مشروع (انتهى المسار التاريخي الصامت من الواجهة)')
  ok(page.includes("projectBilling==='documentation'?docExtractIds:undefined"), 'المستخلصات المحددة ترافق التوثيق فقط')
  ok(page.includes('data-billing-guard') && page.includes('availableToDocumentGrossMinor') && page.includes('extraRoomNetMinor'), 'لوحة الحارس تعرض المتاحين (توثيق/إضافية)')
  ok(page.includes("id:'billing-doc-over'") && page.includes("id:'billing-extra-over'"), 'مراجعة قبل الترحيل تحذر من تجاوز السقفين')
  ok(page.includes('data-billing-autofill'), 'زر ملء سطور التوثيق من المستخلصات موجود')
}

console.log(`\n✅ verify_project_billing_documentation PASS=${pass}`)
