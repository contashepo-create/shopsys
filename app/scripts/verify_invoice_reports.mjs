/**
 * 📊 بوابة تقريرا فواتير المبيعات والمشتريات (طلب المالك 2026-11-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * «أريد تقريراً مهماً في قائمة التقارير لكل نشاط: تقرير مبيعات وتقرير مشتريات
 * يعرض كل الفواتير مع إمكانية فلترة الفواتير من تاريخ إلى تاريخ.»
 *
 * الفحص يثبت:
 *  ① التبويبان دائمان في سجل التقارير لكل نشاط (always) وموصولان بالصفحة.
 *  ② فلترة الفترة بنهايتين شاملتين، وترك حدٍّ فارغاً = بلا حد.
 *  ③ عرض كل فاتورة مفردة لا تجميعاً، مع حساب المدفوع/المتبقي/الحالة من المستند.
 *  ④ استثناء فواتير توثيق المشاريع من تقرير المبيعات (منع إيراد مزدوج).
 *  ⑤ البحث وحالة السداد، وتصدير CSV، وأدوات الطباعة/الفتح في الواجهة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_reports.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildPurchaseInvoiceReport, buildSalesInvoiceReport, invoiceInRange, invoiceRangeLabel,
  purchaseInvoiceReportCsv, salesInvoiceReportCsv,
} from '../src/core/invoiceReports.ts'
import { REPORT_TABS } from '../src/core/reportTabs.ts'

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

console.log('\n📊 تقريرا فواتير المبيعات والمشتريات\n')

/* ─── ① التبويبان في السجل لكل نشاط ─── */
for (const id of ['salesInvoices', 'purchaseInvoices']) {
  const tab = REPORT_TABS.find((item) => item.id === id)
  assert.ok(tab, `تبويب ${id} غير معرّف`)
  assert.equal(tab.always, true, `تبويب ${id} ليس تبويب نواة لكل نشاط`)
  assert.ok(tab.labelAr.includes('تقرير'), `عنوان ${id} لا يصرّح أنه تقرير`)
}
ok('تقريرا المبيعات والمشتريات تبويبان دائمان (لكل نشاط) في سجل التقارير')

const page = src('ui/pages/ReportsPage.tsx')
assert.ok(page.includes("case 'salesInvoices': return sales.length > 0"), 'حالة بيانات تقرير المبيعات غير موصولة')
assert.ok(page.includes("case 'purchaseInvoices': return purchases.length > 0"), 'حالة بيانات تقرير المشتريات غير موصولة')
assert.ok(page.includes('<SalesInvoicesReportTab') && page.includes('<PurchasesInvoicesReportTab'), 'التقريران غير مرسومين في الصفحة')
const tabs = src('ui/pages/InvoiceReportsTabs.tsx')
assert.ok(tabs.includes('data-invoice-from') && tabs.includes('data-invoice-to'), 'لا حقلي تاريخ (من/إلى) في التقريرين')
assert.ok(tabs.includes('type="date"'), 'فلترة التاريخ ليست حقول تاريخ حقيقية')
assert.ok(tabs.includes('data-invoice-search') && tabs.includes('data-invoice-status'), 'بحث/حالة السداد غير متاحين')
assert.ok(tabs.includes('data-open-sale') && tabs.includes('data-open-purchase'), 'لا زر فتح/مراجعة للفاتورة')
assert.ok(tabs.includes('renderReportShell') && tabs.includes('printHtml'), 'تقريرا الفواتير بلا طباعة موحّدة')
ok('الواجهة: حقلا من/إلى + بحث + حالة + طباعة + فتح الفاتورة (لكل تقرير)')

/* ─── ② فلترة الفترة ─── */
assert.equal(invoiceInRange('2026-10-01', { from: '2026-10-01', to: '2026-10-31' }), true, 'الحد الأدنى غير شامل')
assert.equal(invoiceInRange('2026-10-31', { from: '2026-10-01', to: '2026-10-31' }), true, 'الحد الأقصى غير شامل')
assert.equal(invoiceInRange('2026-09-30', { from: '2026-10-01', to: '2026-10-31' }), false, 'تاريخ قبل الفترة دخل ظلماً')
assert.equal(invoiceInRange('2026-11-01', { from: '2026-10-01', to: '2026-10-31' }), false, 'تاريخ بعد الفترة دخل ظلماً')
assert.equal(invoiceInRange('2020-01-01', {}), true, 'الفترة الفارغة لا تعني «بلا فلترة»')
assert.equal(invoiceInRange('2020-01-01', { from: '2026-01-01' }), false, 'الحد الأدنى وحده لا يُطبّق')
assert.equal(invoiceRangeLabel({ from: '2026-10-01', to: '2026-10-31' }), 'من 2026-10-01 إلى 2026-10-31')
assert.equal(invoiceRangeLabel({}), 'كل الفواتير (بلا فلترة تاريخ)')
ok('فلترة «من تاريخ إلى تاريخ» بنهايتين شاملتين + حدّ فارغ = بلا حد')

/* ─── ③ تقرير المبيعات: كل فاتورة + الحالة ─── */
const totals = (totalMinor, taxMinor = 0) => ({
  grossMinor: totalMinor, discountMinor: 0, netMinor: totalMinor, taxBaseMinor: totalMinor,
  taxMinor, totalMinor, cogsMinor: 0,
})
const sales = [
  { id: 1, invoiceNumber: 'SAL-001', refCode: 'SAL-260101-00001C', date: '2026-10-01T10:00:00+03:00', customerId: 1, payment: 'cash', totals: totals(1000, 100), lines: [{}, {}], journalEntryId: 11 },
  { id: 2, invoiceNumber: 'SAL-002', refCode: 'SAL-260115-00002C', date: '2026-10-15T12:00:00+03:00', customerId: 2, payment: 'credit', paidMinor: 500, totals: totals(2000, 200), lines: [{}], journalEntryId: 12 },
  { id: 3, invoiceNumber: 'SAL-003', refCode: 'SAL-260101-00003C', date: '2026-10-31T09:00:00+03:00', customerId: null, payment: 'credit', totals: totals(3000, 300), lines: [{}], journalEntryId: 13 },
  { id: 4, invoiceNumber: 'SAL-004', refCode: 'SAL-260101-00004C', date: '2026-10-20T09:00:00+03:00', customerId: 1, payment: 'credit', totals: totals(5000), lines: [{}], projectBilling: 'documentation', journalEntryId: 14 },
  { id: 5, invoiceNumber: 'SAL-005', refCode: 'SAL-260901-00005C', date: '2026-09-20T09:00:00+03:00', customerId: 1, payment: 'cash', totals: totals(700), lines: [{}], journalEntryId: 15 },
]
const customers = [{ id: 1, nameAr: 'عميل الأثاث' }, { id: 2, nameAr: 'مؤسسة النور' }]
const salesReport = buildSalesInvoiceReport(sales, customers, { from: '2026-10-01', to: '2026-10-31' })
assert.equal(salesReport.rows.length, 3, 'تقرير المبيعات لا يعرض كل فواتير الفترة المفردة')
assert.deepEqual(salesReport.rows.map((row) => row.invoiceNumber), ['SAL-003', 'SAL-002', 'SAL-001'], 'ترتيب الفواتير ليس الأحدث أولاً')
assert.equal(salesReport.rows.find((row) => row.id === 1).status, 'paid', 'حالة الفاتورة النقدية خاطئة')
assert.equal(salesReport.rows.find((row) => row.id === 2).status, 'partial', 'حالة الدفع الجزئي خاطئة')
assert.equal(salesReport.rows.find((row) => row.id === 2).dueMinor, 1500, 'المتبقي على العميل خاطئ')
assert.equal(salesReport.rows.find((row) => row.id === 3).status, 'unpaid', 'حالة الآجل خاطئة')
assert.equal(salesReport.rows.find((row) => row.id === 1).partyName, 'عميل الأثاث', 'اسم الطرف غير مربوط بالعميل')
assert.equal(salesReport.rows.find((row) => row.id === 3).partyName, 'عميل نقدي', 'العميل النقدي لا يُسمّى «عميل نقدي»')
assert.equal(salesReport.summary.count, 3)
assert.equal(salesReport.summary.totalMinor, 6000, 'إجمالي المبيعات خاطئ')
assert.equal(salesReport.summary.paidMinor, 1500, 'المحصّل خاطئ')
assert.equal(salesReport.summary.dueMinor, 4500, 'المتبقي خاطئ')
assert.equal(salesReport.summary.taxMinor, 600, 'الضريبة خاطئة')
assert.equal(salesReport.summary.paidCount, 1)
assert.equal(salesReport.summary.partialCount, 1)
assert.equal(salesReport.summary.unpaidCount, 1)
ok('تقرير المبيعات: كل فاتورة مفردة + المدفوع/المتبقي/الحالة + استثناء توثيق المشاريع')

const searched = buildSalesInvoiceReport(sales, customers, { from: '2026-10-01', to: '2026-10-31' }, 'SAL-002')
assert.equal(searched.rows.length, 1)
assert.equal(searched.rows[0].id, 2)
const byParty = buildSalesInvoiceReport(sales, customers, { from: '2026-10-01', to: '2026-10-31' }, 'النور')
assert.equal(byParty.rows.length, 1)
assert.equal(byParty.rows[0].id, 2)
const allTime = buildSalesInvoiceReport(sales, customers, {})
assert.equal(allTime.rows.length, 4, 'بلا فترة يجب أن يعرض كل الفواتير (ما عدا التوثيق)')
ok('البحث بالرقم/المرجع/الطرف + «كل الفواتير» بلا فلترة تاريخ')

const salesCsv = salesInvoiceReportCsv(salesReport.rows)
assert.ok(salesCsv.startsWith('"التاريخ","رقم الفاتورة"'), 'ترويسة CSV العربية مفقودة')
assert.equal(salesCsv.split('\n').length, 4, 'صفوف CSV لا تطابق الفواتير')
ok('تصدير CSV لتقرير المبيعات (ترويسة عربية + صف لكل فاتورة)')

/* ─── ④ تقرير المشتريات ─── */
const purchases = [
  { id: 1, invoiceNumber: 'PUR-001', refCode: 'PUR-260101-00001C', date: '2026-10-05', supplierId: 1, supplierInvoiceNumber: 'SUP-88', grandTotalMinor: 1200, supplierDueMinor: 1000, paidMinor: 1000, receiptStatus: 'received', dueDate: '2026-10-20', journalEntryId: 21 },
  { id: 2, invoiceNumber: 'PUR-002', refCode: 'PUR-260102-00002C', date: '2026-10-20', supplierId: 2, supplierInvoiceNumber: 'SUP-99', grandTotalMinor: 2000, supplierDueMinor: 1800, paidMinor: 800, receiptStatus: 'partial', dueDate: '2026-11-05', journalEntryId: 22 },
  { id: 3, invoiceNumber: 'PUR-003', refCode: 'PUR-260103-00003C', date: '2026-11-02', supplierId: 1, grandTotalMinor: 900, supplierDueMinor: 900, paidMinor: 0, receiptStatus: 'pending', journalEntryId: 23 },
  { id: 4, invoiceNumber: 'PUR-004', refCode: 'PUR-260104-00004C', date: '2026-09-15', supplierId: 2, grandTotalMinor: 500, supplierDueMinor: 500, paidMinor: 0, journalEntryId: 24 },
]
const suppliers = [{ id: 1, nameAr: 'مورد البضائع' }, { id: 2, nameAr: 'مورد التغليف' }]
const purchaseReport = buildPurchaseInvoiceReport(purchases, suppliers, { from: '2026-10-01', to: '2026-10-31' })
assert.equal(purchaseReport.rows.length, 2, 'تقرير المشتريات لا يعرض كل فواتير الفترة')
assert.equal(purchaseReport.rows[0].supplierName, 'مورد التغليف', 'اسم المورد غير مربوط')
assert.equal(purchaseReport.rows[0].status, 'partial')
assert.equal(purchaseReport.rows[0].dueMinor, 1000, 'المتبقي على المورد خاطئ (مستحق المورد − المدفوع)')
assert.equal(purchaseReport.rows[1].status, 'paid')
assert.equal(purchaseReport.summary.count, 2)
assert.equal(purchaseReport.summary.totalMinor, 3200, 'إجمالي المشتريات خاطئ')
assert.equal(purchaseReport.summary.supplierDueMinor, 2800, 'مستحق الموردين خاطئ')
assert.equal(purchaseReport.summary.paidMinor, 1800, 'المسدد للموردين خاطئ')
assert.equal(purchaseReport.summary.dueMinor, 1000, 'المتبقي للموردين خاطئ')
assert.equal(purchaseReport.rows[0].receiptStatusLabel, 'استلام جزئي')
const purchaseCsv = purchaseInvoiceReportCsv(purchaseReport.rows)
assert.ok(purchaseCsv.startsWith('"التاريخ","رقم الفاتورة"'), 'ترويسة CSV للمشتريات مفقودة')
assert.equal(purchaseCsv.split('\n').length, 3)
ok('تقرير المشتريات: كل فاتورة + مستحق المورد/المدفوع/المتبقي + حالة الاستلام + CSV')

console.log(`\n✅ بوابة تقريرا الفواتير: ${pass} مجموعة تحقق — كلها خضراء\n`)
