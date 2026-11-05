/**
 * تقريرا فواتير المبيعات والمشتريات — مركز التقارير (طلب المالك 2026-11-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * «أريد تقريراً مهماً في قائمة التقارير لكل نشاط: تقرير مبيعات وتقرير مشتريات
 * يعرض كل الفواتير مع إمكانية فلترة الفواتير من تاريخ إلى تاريخ.»
 *
 * منطق خالص (بلا React وبلا مخزن) حتى يُختبر ويُستخدم في الشاشة والطباعة وCSV:
 *  · يعرض **كل** فواتير البيع/الشراء المفردة لا تجميعات شهرية.
 *  · فلترة فترة صريحة (من/إلى) بنهايتين شاملتين، ويمكن ترك حدٍّ فارغاً (بلا حد).
 *  · بحث نصي (رقم الفاتورة/المرجع/الطرف/ملاحظات) وحالة سداد (مدفوع/جزئي/آجل).
 *  · كل مبلغ من المستند المرحّل نفسه — لا إعادة حساب ضريبة أو تكلفة.
 *
 * ملاحظة محاسبية: فواتير «توثيق المشاريع» (`projectBilling === 'documentation'`)
 * مستند ضريبي بلا إيراد جديد، تُستثنى من تقرير المبيعات حتى لا يُحتسب إيرادها
 * مرتين (نفس قاعدة `salesSummary`).
 */
import type { Minor } from './money.ts'
import type { CartLine, CartTotals, PaymentMethod } from './pos.ts'

export type InvoiceReportStatus = 'paid' | 'partial' | 'unpaid'

export interface InvoiceRange {
  /** YYYY-MM-DD شامل — فارغ = بلا حد أدنى */
  from?: string
  /** YYYY-MM-DD شامل — فارغ = بلا حد أقصى */
  to?: string
}

/** هل تاريخ المستند داخل الفترة؟ (مقارنة نصية آمنة لصيغة ISO) */
export function invoiceInRange(dateIso: string, range: InvoiceRange): boolean {
  const day = (dateIso ?? '').slice(0, 10)
  if (!day) return false
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

/** وصف عربي جاهز للترويسة والطباعة */
export function invoiceRangeLabel(range: InvoiceRange): string {
  if (range.from && range.to) return `من ${range.from} إلى ${range.to}`
  if (range.from) return `من ${range.from} بلا حد أقصى`
  if (range.to) return `حتى ${range.to}`
  return 'كل الفواتير (بلا فلترة تاريخ)'
}

export function invoiceStatusLabel(status: InvoiceReportStatus): string {
  return status === 'paid' ? 'مدفوعة' : status === 'partial' ? 'جزئية' : 'آجلة'
}

export function invoicePaymentLabel(payment: PaymentMethod): string {
  return payment === 'cash' ? 'نقدي' : 'آجل'
}

export function invoiceReceiptStatusLabel(status?: string): string {
  return status === 'received' ? 'مستلمة' : status === 'partial' ? 'استلام جزئي' : 'بانتظار الاستلام'
}

/* ─────────────────────────── فواتير المبيعات ─────────────────────────── */

export interface SalesInvoiceReportInput {
  id: number
  invoiceNumber: string
  refCode?: string
  date: string
  customerId: number | null
  /** §91: بيع لطرف آخر (مورد/موظف) — وإلا عميل */
  partyKind?: 'supplier' | 'employee' | null
  partyId?: number | null
  partyName?: string | null
  payment: PaymentMethod
  /** المحصل وقت البيع — undefined للفواتير القديمة = حسب payment */
  paidMinor?: Minor
  totals: CartTotals
  lines?: CartLine[]
  journalEntryId?: number | null
  projectId?: number | null
  projectBilling?: 'documentation' | 'extra'
  notes?: string
}

export interface SalesInvoiceReportRow {
  id: number
  invoiceNumber: string
  refCode: string
  date: string
  partyName: string
  partyKindLabel: string
  paymentLabel: string
  totalMinor: Minor
  paidMinor: Minor
  dueMinor: Minor
  taxMinor: Minor
  itemCount: number
  status: InvoiceReportStatus
  statusLabel: string
  journalEntryId: number | null
  projectId: number | null
  notes: string
}

export interface SalesInvoiceReportSummary {
  count: number
  totalMinor: Minor
  paidMinor: Minor
  dueMinor: Minor
  taxMinor: Minor
  paidCount: number
  partialCount: number
  unpaidCount: number
}

export interface InvoiceReportResult<T> {
  rows: T[]
  summary: InvoiceReportSummary
}

export interface InvoiceReportSummary {
  count: number
  totalMinor: Minor
  paidMinor: Minor
  dueMinor: Minor
  paidCount: number
  partialCount: number
  unpaidCount: number
}

/** المحصل فعلياً — نفس قاعدة `salePaidMinor` في مركز التقارير */
function salePaid(sale: Pick<SalesInvoiceReportInput, 'payment' | 'paidMinor' | 'totals'>): Minor {
  return sale.paidMinor ?? (sale.payment === 'cash' ? sale.totals.totalMinor : 0)
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function matchesSearch(haystack: (string | number | null | undefined)[], needle: string): boolean {
  if (!needle) return true
  return haystack.some((value) => String(value ?? '').toLowerCase().includes(needle))
}

/**
 * بناء تقرير فواتير المبيعات المفصّلة.
 * @param customers lookup للطرف (الاسم العربي)
 */
export function buildSalesInvoiceReport(
  sales: readonly SalesInvoiceReportInput[],
  customers: readonly { id: number; nameAr: string }[],
  range: InvoiceRange,
  search = '',
): InvoiceReportResult<SalesInvoiceReportRow> {
  const needle = normalizeSearch(search)
  const names = new Map(customers.map((customer) => [customer.id, customer.nameAr]))
  const rows: SalesInvoiceReportRow[] = []

  for (const sale of sales) {
    if (sale.projectBilling === 'documentation') continue
    if (!invoiceInRange(sale.date, range)) continue

    const paid = salePaid(sale)
    const total = sale.totals.totalMinor
    const due = Math.max(0, total - paid)
    const status: InvoiceReportStatus = due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const partyKindLabel = sale.partyKind === 'supplier' ? 'مورد' : sale.partyKind === 'employee' ? 'موظف' : 'عميل'
    /* 0/undefined = عميل نقدي (بعض السجلات القديمة تكتب 0 بدل null) */
    const customerId = sale.customerId != null && sale.customerId > 0 ? sale.customerId : null
    const partyName = customerId != null
      ? names.get(customerId) || `عميل #${customerId}`
      : sale.partyName?.trim() || (sale.partyKind ? `${partyKindLabel} #${sale.partyId ?? '—'}` : 'عميل نقدي')

    if (!matchesSearch([
      sale.invoiceNumber, sale.refCode, partyName, sale.notes, sale.partyName, sale.date,
    ], needle)) continue

    rows.push({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      refCode: sale.refCode ?? '',
      date: sale.date,
      partyName,
      partyKindLabel,
      paymentLabel: invoicePaymentLabel(sale.payment),
      totalMinor: total,
      paidMinor: paid,
      dueMinor: due,
      taxMinor: sale.totals.taxMinor,
      itemCount: sale.lines?.length ?? 0,
      status,
      statusLabel: invoiceStatusLabel(status),
      journalEntryId: sale.journalEntryId ?? null,
      projectId: sale.projectId ?? null,
      notes: sale.notes ?? '',
    })
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const summary = summarizeSalesInvoiceRows(rows)
  return { rows, summary }
}

export function summarizeSalesInvoiceRows(rows: readonly SalesInvoiceReportRow[]): SalesInvoiceReportSummary {
  const summary: SalesInvoiceReportSummary = {
    count: rows.length, totalMinor: 0, paidMinor: 0, dueMinor: 0, taxMinor: 0,
    paidCount: 0, partialCount: 0, unpaidCount: 0,
  }
  for (const row of rows) {
    summary.totalMinor += row.totalMinor
    summary.paidMinor += row.paidMinor
    summary.dueMinor += row.dueMinor
    summary.taxMinor += row.taxMinor
    if (row.status === 'paid') summary.paidCount++
    else if (row.status === 'partial') summary.partialCount++
    else summary.unpaidCount++
  }
  return summary
}

/* ─────────────────────────── فواتير المشتريات ─────────────────────────── */

export interface PurchaseInvoiceReportInput {
  id: number
  invoiceNumber: string
  refCode?: string
  date: string
  supplierId: number
  supplierInvoiceNumber?: string
  supplierName?: string
  grandTotalMinor: Minor
  /** مستحق المورد فقط (بضاعة + مصاريفه) — المصاريف المدفوعة مني لا تدخل دينه */
  supplierDueMinor?: Minor
  paidMinor: Minor
  receiptStatus?: 'pending' | 'partial' | 'received'
  dueDate?: string
  journalEntryId?: number | null
  notes?: string
}

export interface PurchaseInvoiceReportRow {
  id: number
  invoiceNumber: string
  refCode: string
  date: string
  supplierName: string
  supplierInvoiceNumber: string
  dueDate: string
  totalMinor: Minor
  supplierDueMinor: Minor
  paidMinor: Minor
  dueMinor: Minor
  receiptStatusLabel: string
  status: InvoiceReportStatus
  statusLabel: string
  journalEntryId: number | null
  notes: string
}

export interface PurchaseInvoiceReportSummary extends InvoiceReportSummary {
  supplierDueMinor: Minor
}

export function buildPurchaseInvoiceReport(
  purchases: readonly PurchaseInvoiceReportInput[],
  suppliers: readonly { id: number; nameAr: string }[],
  range: InvoiceRange,
  search = '',
): { rows: PurchaseInvoiceReportRow[]; summary: PurchaseInvoiceReportSummary } {
  const needle = normalizeSearch(search)
  const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.nameAr]))
  const rows: PurchaseInvoiceReportRow[] = []

  for (const purchase of purchases) {
    if (!invoiceInRange(purchase.date, range)) continue

    /* 0 = فاتورة شراء نقدية (المورد النقدي) — بعض السجلات القديمة تستخدم -1 */
    const isCashSupplier = purchase.supplierId === 0 || purchase.supplierId === -1
    const supplierName = purchase.supplierName?.trim()
      || (isCashSupplier ? 'مورد نقدي' : names.get(purchase.supplierId))
      || `مورد #${purchase.supplierId}`
    const supplierDue = Math.max(0, purchase.supplierDueMinor ?? purchase.grandTotalMinor)
    const paid = Math.max(0, purchase.paidMinor)
    const due = Math.max(0, supplierDue - paid)
    const status: InvoiceReportStatus = due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    if (!matchesSearch([
      purchase.invoiceNumber, purchase.refCode, supplierName, purchase.supplierInvoiceNumber,
      purchase.notes, purchase.date,
    ], needle)) continue

    rows.push({
      id: purchase.id,
      invoiceNumber: purchase.invoiceNumber,
      refCode: purchase.refCode ?? '',
      date: purchase.date,
      supplierName,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? '',
      dueDate: purchase.dueDate ?? '',
      totalMinor: purchase.grandTotalMinor,
      supplierDueMinor: supplierDue,
      paidMinor: paid,
      dueMinor: due,
      receiptStatusLabel: invoiceReceiptStatusLabel(purchase.receiptStatus),
      status,
      statusLabel: invoiceStatusLabel(status),
      journalEntryId: purchase.journalEntryId ?? null,
      notes: purchase.notes ?? '',
    })
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const summary = summarizePurchaseInvoiceRows(rows)
  return { rows, summary }
}

export function summarizePurchaseInvoiceRows(rows: readonly PurchaseInvoiceReportRow[]): PurchaseInvoiceReportSummary {
  const summary: PurchaseInvoiceReportSummary = {
    count: 0, totalMinor: 0, supplierDueMinor: 0, paidMinor: 0, dueMinor: 0,
    paidCount: 0, partialCount: 0, unpaidCount: 0,
  }
  for (const row of rows) {
    summary.count++
    summary.totalMinor += row.totalMinor
    summary.supplierDueMinor += row.supplierDueMinor
    summary.paidMinor += row.paidMinor
    summary.dueMinor += row.dueMinor
    if (row.status === 'paid') summary.paidCount++
    else if (row.status === 'partial') summary.partialCount++
    else summary.unpaidCount++
  }
  return summary
}

/* ─────────────────────────────── تصدير CSV ─────────────────────────────── */

const csvQuote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`

export function salesInvoiceReportCsv(rows: readonly SalesInvoiceReportRow[]): string {
  const header = ['التاريخ', 'رقم الفاتورة', 'المرجع', 'الطرف', 'نوع الطرف', 'الدفع', 'عدد البنود', 'الإجمالي', 'المدفوع', 'المتبقي', 'الضريبة', 'الحالة', 'القيد', 'ملاحظات']
  const body = rows.map((row) => [
    row.date.slice(0, 10), row.invoiceNumber, row.refCode, row.partyName, row.partyKindLabel,
    row.paymentLabel, row.itemCount, row.totalMinor, row.paidMinor, row.dueMinor, row.taxMinor,
    row.statusLabel, row.journalEntryId ?? '', row.notes,
  ].map(csvQuote).join(','))
  return [header.map(csvQuote).join(','), ...body].join('\n')
}

export function purchaseInvoiceReportCsv(rows: readonly PurchaseInvoiceReportRow[]): string {
  const header = ['التاريخ', 'رقم الفاتورة', 'المرجع', 'المورد', 'فاتورة المورد', 'الاستحقاق', 'حالة الاستلام', 'الإجمالي', 'مستحق المورد', 'المدفوع', 'المتبقي', 'الحالة', 'القيد', 'ملاحظات']
  const body = rows.map((row) => [
    row.date.slice(0, 10), row.invoiceNumber, row.refCode, row.supplierName, row.supplierInvoiceNumber,
    row.dueDate, row.receiptStatusLabel, row.totalMinor, row.supplierDueMinor, row.paidMinor,
    row.dueMinor, row.statusLabel, row.journalEntryId ?? '', row.notes,
  ].map(csvQuote).join(','))
  return [header.map(csvQuote).join(','), ...body].join('\n')
}
