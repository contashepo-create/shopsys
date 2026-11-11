import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
import { AdvancedPurchaseInvoicePage } from '../src/ui/pages/AdvancedPurchaseInvoicePage.tsx'
import { PurchaseOrdersPage } from '../src/ui/pages/PurchaseOrdersPage.tsx'

const data = useRawDataStore.getState(), app = useAppStore.getState()
const text = () => new DOMParser().parseFromString(usePrintPreview.getState().handle?.html ?? '', 'text/html').body.textContent ?? ''
const printButton = () => screen.getByTitle('طباعة الفاتورة الآن دون إغلاقها — تتبع مفاتيح الطباعة الثلاثة أسفل المستند')
const warehouseButton = () => screen.getByTitle('إذن استلام من المستودع — كميات فقط بلا أسعار')
const qtyInput = () => document.querySelector<HTMLInputElement>('tbody tr td.num-cell input')!
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, receipt: { ...app.receipt, silentPrint: false, cashierPrint: false } })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], customers: [], suppliers: [{ id: 7, nameAr: 'مورد اختبار', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'LIVE'), id: 1, nameAr: 'صنف مباشر', priceMinor: 5000, costMinor: 3000, stockQty: 30 }], sales: [], purchases: [], purchaseOrders: [], journal: [], warehouses: [] })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(data); useAppStore.setState(app) })
it('معاينة فاتورة البيع وإذن المستودع تتبع تعديل الكمية وتمنع الطباعة عند حذف السطر', () => {
 render(<MemoryRouter><AdvancedSalesInvoicePage /></MemoryRouter>)
 fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
 fireEvent.doubleClick(screen.getByRole('option', { name: /صنف مباشر/ }))
 fireEvent.click(printButton()); expect(text()).toContain('صنف مباشر')
 fireEvent.change(qtyInput(), { target: { value: '7' } })
 expect(text()).toMatch(/\b7\b/)
 fireEvent.click(warehouseButton()); fireEvent.change(qtyInput(), { target: { value: '9' } })
 expect(text()).toMatch(/\b9\b/)
 fireEvent.click(screen.getByRole('button', { name: /حذف سطر صنف مباشر/ }))
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
it('معاينة فاتورة الشراء وإذنها تتبع الكمية في المحرر', () => {
 const order = useRawDataStore.getState().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد اختبار', date: '2026-01-01', expectedDate: '2026-01-02', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'صنف مباشر', qty: 2, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 3000, vatPercent: 0, notes: '' }] })
 render(<MemoryRouter initialEntries={[`/purchases/invoices/new?po=${order.id}`]}><AdvancedPurchaseInvoicePage /></MemoryRouter>)
 fireEvent.click(printButton()); expect(text()).toContain('صنف مباشر')
 fireEvent.change(qtyInput(), { target: { value: '8' } }); expect(text()).toMatch(/\b8\b/)
 fireEvent.click(warehouseButton()); fireEvent.change(qtyInput(), { target: { value: '11' } }); expect(text()).toMatch(/\b11\b/)
})
it('معاينة أمر الشراء وإذن المستودع تتبعان المسودة', () => {
 render(<MemoryRouter><PurchaseOrdersPage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /أمر شراء/ }))
 fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
 fireEvent.doubleClick(screen.getByRole('option', { name: /صنف مباشر/ }))
 fireEvent.click(printButton()); expect(text()).toContain('صنف مباشر')
 fireEvent.change(qtyInput(), { target: { value: '6' } }); expect(text()).toMatch(/\b6\b/)
 fireEvent.click(warehouseButton()); fireEvent.change(qtyInput(), { target: { value: '12' } }); expect(text()).toMatch(/\b12\b/)
 const row = qtyInput().closest('tr')!
 fireEvent.click(within(row).getByRole('button', { name: /حذف سطر/ }))
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})

it('كمية أمر الشراء المدخلة هي الكمية المسجلة، ولا تظهر حقول استلام قبل الفاتورة', () => {
 render(<MemoryRouter><PurchaseOrdersPage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /أمر شراء/ }))
 fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
 fireEvent.doubleClick(screen.getByRole('option', { name: /صنف مباشر/ }))
 expect(screen.queryByRole('columnheader', { name: 'المستلم' })).toBeNull()
 fireEvent.change(qtyInput(), { target: { value: '13' } })
 fireEvent.click(screen.getByRole('button', { name: /اعتماد أمر الشراء/ }))
 expect(useRawDataStore.getState().purchaseOrders[0].lines[0].qty).toBe(13)
 expect(useRawDataStore.getState().purchaseOrders[0].lines[0].receivedQty).toBe(0)
})
it('تعديل بيع مرحّل يعرض مسودة بلا رمز ضريبي قديم حتى لو تغيّرت الكمية', () => {
 useAppStore.setState({ setup: { ...useAppStore.getState().setup, requireOpenShiftForSales: false } })
 const sale = useRawDataStore.getState().postSale({ lines: [{ itemId: 1, nameAr: 'صنف مباشر', qty: 1, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, documentDate: '2026-01-01' })
 render(<MemoryRouter initialEntries={[`/sales/invoices/new?edit=${sale.id}`]}><AdvancedSalesInvoicePage /></MemoryRouter>)
 fireEvent.click(printButton())
 expect(text()).toContain(`مسودة تعديل ${sale.invoiceNumber}`)
 expect(usePrintPreview.getState().handle?.html).not.toContain('data:image/png;base64')
 fireEvent.change(qtyInput(), { target: { value: '17' } })
 expect(text()).toMatch(/\b17\b/)
 expect(usePrintPreview.getState().handle?.html).not.toContain('data:image/png;base64')
})

it('إرسال تعديل بيع عبر واتساب يوسمه مسودة ولا يستخدم الرمز الضريبي المجمد', () => {
 useAppStore.setState({ setup: { ...useAppStore.getState().setup, requireOpenShiftForSales: false } })
 const sale = useRawDataStore.getState().postSale({ lines: [{ itemId: 1, nameAr: 'صنف مباشر', qty: 1, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, documentDate: '2026-01-01' })
 useRawDataStore.setState({ sales: [{ ...sale, taxQrPayload: 'cHJpbnQtZmFrZS1wYXlsb2Fk' }] })
 const bridge = vi.fn().mockResolvedValue({ ok: true, copied: false })
 const context = globalThis as typeof globalThis & { shopsysPdfShare?: typeof bridge }
 const originalBridge = context.shopsysPdfShare; context.shopsysPdfShare = bridge
 try {
  render(<MemoryRouter initialEntries={[`/sales/invoices/new?edit=${sale.id}`]}><AdvancedSalesInvoicePage /></MemoryRouter>)
  fireEvent.change(qtyInput(), { target: { value: '17' } })
  fireEvent.click(screen.getByTitle('يولّد PDF ويفتح مجلد الملف ومحادثة واتساب — اسحب الملف للمحادثة'))
  expect(bridge).toHaveBeenCalledOnce()
  const html = bridge.mock.calls[0][0] as string
  expect(html).toContain(`مسودة تعديل ${sale.invoiceNumber}`)
  expect(html).not.toContain('data:image/png;base64')
  expect(new DOMParser().parseFromString(html, 'text/html').body.textContent).toMatch(/\b17\b/)
 } finally { context.shopsysPdfShare = originalBridge }
})
