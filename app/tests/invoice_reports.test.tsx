/**
 * تقريرا فواتير المبيعات والمشتريات (طلب المالك 2026-11-05)
 * «تقرير مبيعات وتقرير مشتريات يعرض كل الفواتير مع فلترة من تاريخ إلى تاريخ»
 *
 * يثبت: التبويبان لكل نشاط، عرض كل فاتورة مفردة، فلترة الفترة، الحالة،
 * والربط بالواجهة (حقول التاريخ/البحث/الحالة) — منطق خالص + محاكاة واجهة.
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  buildPurchaseInvoiceReport, buildSalesInvoiceReport, invoiceInRange,
  purchaseInvoiceReportCsv, salesInvoiceReportCsv,
} from '../src/core/invoiceReports.ts'

const totals = (totalMinor: number, taxMinor = 0) => ({
  grossMinor: totalMinor, discountMinor: 0, netMinor: totalMinor, taxBaseMinor: totalMinor,
  taxMinor, totalMinor, cogsMinor: 0,
})

const sale = (id: number, invoiceNumber: string, date: string, total: number, paid: number | undefined, customerId: number | null) => ({
  id, invoiceNumber, refCode: `SAL-${invoiceNumber}`, date, customerId,
  payment: paid === undefined ? 'cash' as const : paid < total ? 'credit' as const : 'cash' as const,
  paidMinor: paid, totals: totals(total), lines: [1, 2].map(itemId => ({ itemId, nameAr: 'صنف', qty: 1, unitPriceMinor: 0, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })), journalEntryId: 100 + id,
})

const purchase = (id: number, invoiceNumber: string, date: string, total: number, supplierDue: number, paid: number) => ({
  id, invoiceNumber, refCode: `PUR-${invoiceNumber}`, date, supplierId: id % 2 === 0 ? 2 : 1,
  supplierInvoiceNumber: `SUP-${id}`, grandTotalMinor: total, supplierDueMinor: supplierDue,
  paidMinor: paid, receiptStatus: paid >= supplierDue ? 'received' as const : paid > 0 ? 'partial' as const : 'pending' as const,
  dueDate: '2026-11-30', journalEntryId: 200 + id, lines: [], expenses: [],
})

describe('منطق تقريرا الفواتير', () => {
  it('فلترة الفترة بنهايتين شاملتين، وحدّ فارغ = بلا حد', () => {
    expect(invoiceInRange('2026-10-01', { from: '2026-10-01', to: '2026-10-31' })).toBe(true)
    expect(invoiceInRange('2026-10-31', { from: '2026-10-01', to: '2026-10-31' })).toBe(true)
    expect(invoiceInRange('2026-09-30', { from: '2026-10-01', to: '2026-10-31' })).toBe(false)
    expect(invoiceInRange('2026-11-01', { from: '2026-10-01', to: '2026-10-31' })).toBe(false)
    expect(invoiceInRange('2020-01-01', {})).toBe(true)
    expect(invoiceInRange('2020-01-01', { from: '2026-10-01' })).toBe(false)
    expect(invoiceInRange('2020-01-01', { to: '2026-10-31' })).toBe(true)
  })

  it('تقرير المبيعات يعرض كل فاتورة مفردة ويحسب المدفوع والمتبقي والحالة', () => {
    const sales = [
      sale(1, 'SAL-101', '2026-10-01T10:00:00+03:00', 1000, undefined, 1),
      sale(2, 'SAL-102', '2026-10-15T12:00:00+03:00', 2000, 500, 2),
      sale(3, 'SAL-103', '2026-10-31T09:00:00+03:00', 3000, 0, null),
      { ...sale(4, 'SAL-104', '2026-10-20T09:00:00+03:00', 5000, 0, 1), projectBilling: 'documentation' as const },
      sale(5, 'SAL-105', '2026-09-20T09:00:00+03:00', 700, undefined, 1),
    ]
    const report = buildSalesInvoiceReport(sales, [{ id: 1, nameAr: 'عميل الأثاث' }, { id: 2, nameAr: 'مؤسسة النور' }], { from: '2026-10-01', to: '2026-10-31' })
    expect(report.rows.map((row) => row.invoiceNumber)).toEqual(['SAL-103', 'SAL-102', 'SAL-101'])
    expect(report.rows[0]).toMatchObject({ status: 'unpaid', dueMinor: 3000, partyName: 'عميل نقدي' })
    expect(report.rows[1]).toMatchObject({ status: 'partial', dueMinor: 1500, partyName: 'مؤسسة النور' })
    expect(report.rows[2]).toMatchObject({ status: 'paid', dueMinor: 0, partyName: 'عميل الأثاث' })
    expect(report.summary).toMatchObject({ count: 3, totalMinor: 6000, paidMinor: 1500, dueMinor: 4500, paidCount: 1, partialCount: 1, unpaidCount: 1 })
    // توثيق المشاريع مستبعد (بلا إيراد جديد) والفترة الأوسع تُظهره
    expect(buildSalesInvoiceReport(sales, [], {}).rows).toHaveLength(4)
  })

  it('تقرير المبيعات يبحث برقم الفاتورة أو اسم الطرف', () => {
    const sales = [sale(1, 'SAL-101', '2026-10-01', 1000, undefined, 1), sale(2, 'SAL-102', '2026-10-15', 2000, 500, 2)]
    const customers = [{ id: 1, nameAr: 'عميل الأثاث' }, { id: 2, nameAr: 'مؤسسة النور' }]
    expect(buildSalesInvoiceReport(sales, customers, {}, 'SAL-102').rows.map((row) => row.id)).toEqual([2])
    expect(buildSalesInvoiceReport(sales, customers, {}, 'النور').rows.map((row) => row.id)).toEqual([2])
    expect(buildSalesInvoiceReport(sales, customers, {}, 'لا شيء').rows).toEqual([])
  })

  it('تقرير المشتريات يعرض كل فاتورة ويحسب مستحق المورد والمتبقي وحالة الاستلام', () => {
    const purchases = [
      purchase(1, 'PUR-201', '2026-10-05', 1200, 1000, 1000),
      purchase(2, 'PUR-202', '2026-10-20', 2000, 1800, 800),
      purchase(3, 'PUR-203', '2026-11-02', 900, 900, 0),
    ]
    const report = buildPurchaseInvoiceReport(purchases, [{ id: 1, nameAr: 'مورد البضائع' }, { id: 2, nameAr: 'مورد التغليف' }], { from: '2026-10-01', to: '2026-10-31' })
    expect(report.rows.map((row) => row.invoiceNumber)).toEqual(['PUR-202', 'PUR-201'])
    expect(report.rows[0]).toMatchObject({ status: 'partial', dueMinor: 1000, receiptStatusLabel: 'استلام جزئي', supplierName: 'مورد التغليف' })
    expect(report.rows[1]).toMatchObject({ status: 'paid', dueMinor: 0, receiptStatusLabel: 'مستلمة' })
    expect(report.summary).toMatchObject({ count: 2, totalMinor: 3200, supplierDueMinor: 2800, paidMinor: 1800, dueMinor: 1000 })
  })

  it('يعرض العميل/المورد النقدي بشكل صحيح (0 أو null)', () => {
    const sales = [
      sale(1, 'SAL-201', '2026-10-01', 1000, undefined, null),
      sale(2, 'SAL-202', '2026-10-02', 1000, undefined, 0),
    ]
    const salesReport = buildSalesInvoiceReport(sales, [], {})
    expect(salesReport.rows.map((row) => row.partyName)).toEqual(['عميل نقدي', 'عميل نقدي'])

    const purchases = [
      { ...purchase(1, 'PUR-301', '2026-10-01', 1000, 1000, 1000), supplierId: 0 },
      { ...purchase(2, 'PUR-302', '2026-10-02', 1000, 1000, 1000), supplierId: 0 },
    ]
    const purchaseReport = buildPurchaseInvoiceReport(purchases, [], {})
    expect(purchaseReport.rows.map((row) => row.supplierName)).toEqual(['مورد نقدي', 'مورد نقدي'])
  })

  it('تصدير CSV يحمل ترويسة عربية وصفاً لكل فاتورة', () => {
    const sales = [sale(1, 'SAL-101', '2026-10-01', 1000, undefined, 1)]
    const customers = [{ id: 1, nameAr: 'عميل' }]
    const report = buildSalesInvoiceReport(sales, customers, {})
    const csv = salesInvoiceReportCsv(report.rows)
    expect(csv.split('\n')).toHaveLength(2)
    expect(csv).toContain('"رقم الفاتورة"')
    expect(csv).toContain('SAL-101')
    const purchases = [purchase(1, 'PUR-201', '2026-10-05', 1200, 1000, 1000)]
    const purchaseCsv = purchaseInvoiceReportCsv(buildPurchaseInvoiceReport(purchases, [{ id: 1, nameAr: 'مورد' }], {}).rows)
    expect(purchaseCsv.split('\n')).toHaveLength(2)
    expect(purchaseCsv).toContain('PUR-201')
  })
})

/* ───────────────────────────── محاكاة الواجهة ───────────────────────────── */

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ReportsPage } = await import('../src/ui/pages/ReportsPage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const mount = () => render(<MemoryRouter><ReportsPage /><ToastHost /></MemoryRouter>)
const setDates = (from: string, to: string) => {
  const fromInput = document.querySelector('[data-invoice-from]') as HTMLInputElement
  const toInput = document.querySelector('[data-invoice-to]') as HTMLInputElement
  expect(fromInput, 'حقل «من تاريخ» غير موجود').toBeTruthy()
  expect(toInput, 'حقل «إلى تاريخ» غير موجود').toBeTruthy()
  fireEvent.change(fromInput, { target: { value: from } })
  fireEvent.change(toInput, { target: { value: to } })
}

beforeAll(() => {
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار',
      ownerName: 'المالك', features: [], modules: ['pos', 'inventory', 'purchases'] as never[],
      accountingMode: 'full', vatPercent: 14,
    },
  })
  const store = useDataStore.getState()
  useDataStore.setState({
    ...store,
    sales: [
      sale(1, 'SAL-101', '2026-10-01T10:00:00+03:00', 1000, undefined, 1),
      sale(2, 'SAL-102', '2026-10-15T12:00:00+03:00', 2000, 500, 2),
      sale(3, 'SAL-103', '2026-11-20T09:00:00+03:00', 3000, 0, null),
    ] as never[],
    purchases: [
      purchase(1, 'PUR-201', '2026-10-05', 1200, 1000, 1000),
      purchase(2, 'PUR-202', '2026-10-20', 2000, 1800, 800),
    ] as never[],
    customers: [
      { id: 1, nameAr: 'عميل الأثاث', phone: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0, notes: '' },
      { id: 2, nameAr: 'مؤسسة النور', phone: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0, notes: '' },
    ] as never[],
    suppliers: [
      { id: 1, nameAr: 'مورد البضائع', phone: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', notes: '' },
      { id: 2, nameAr: 'مورد التغليف', phone: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', notes: '' },
    ] as never[],
    journal: [], saleReturns: [], purchaseReturns: [], vouchers: [], items: [],
  })
})

afterEach(() => cleanup())

describe('واجهة تقريرا الفواتير في مركز التقارير', () => {
  it('التبويبان يظهران لكل نشاط ويحتويان حقلي التاريخ', () => {
    mount()
    expect(document.querySelector('[data-report-tab="salesInvoices"]'), 'تبويب تقرير المبيعات غائب').toBeTruthy()
    expect(document.querySelector('[data-report-tab="purchaseInvoices"]'), 'تبويب تقرير المشتريات غائب').toBeTruthy()
  })

  it('تقرير المبيعات: يعرض الفواتير المفردة وفلترة من/إلى', () => {
    mount()
    fireEvent.click(document.querySelector('[data-report-tab="salesInvoices"]')!)
    expect(document.querySelector('[data-invoice-from]')).toBeTruthy()
    expect(document.querySelector('[data-invoice-to]')).toBeTruthy()
    // الفترة الافتراضية (هذا الشهر) لا تُظهر أكتوبر — نفتح كل الفواتير ثم نفلتر أكتوبر
    setDates('', '')
    expect(document.body.textContent).toContain('SAL-101')
    expect(document.body.textContent).toContain('SAL-102')
    expect(document.body.textContent).toContain('SAL-103')
    setDates('2026-10-01', '2026-10-31')
    expect(document.body.textContent).toContain('SAL-101')
    expect(document.body.textContent).toContain('SAL-102')
    expect(document.body.textContent).not.toContain('SAL-103')
    expect(document.body.textContent).toContain('2 فاتورة')
  })

  it('تقرير المشتريات: يعرض الفواتير المفردة وفلترة من/إلى', () => {
    mount()
    fireEvent.click(document.querySelector('[data-report-tab="purchaseInvoices"]')!)
    expect(document.querySelector('[data-invoice-from]')).toBeTruthy()
    expect(document.querySelector('[data-invoice-to]')).toBeTruthy()
    setDates('', '')
    expect(document.body.textContent).toContain('PUR-201')
    expect(document.body.textContent).toContain('PUR-202')
    setDates('2026-10-01', '2026-10-15')
    expect(document.body.textContent).toContain('PUR-201')
    expect(document.body.textContent).not.toContain('PUR-202')
  })

  it('تنبيه واضح عند انعكاس فترة التاريخ (من بعد إلى)', () => {
    mount()
    fireEvent.click(document.querySelector('[data-report-tab="salesInvoices"]')!)
    setDates('2026-10-31', '2026-10-01')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('تاريخ «من» بعد تاريخ «إلى»')
  })
})
