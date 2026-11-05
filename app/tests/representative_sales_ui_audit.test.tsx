import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RepresentativeSalesTab } from '../src/ui/pages/RepresentativeSalesTab.tsx'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); usePrintPreview.getState().closePreview() })
it('يعرض حدود الدفتر الجزئي ويسمح بالتصفية ويطبع معاينة مهربة', () => {
 useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, customers: [], items: [], employees: [], sales: [], saleReturns: [], journal: [] })
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 s.addEmployee({ nameAr: '<b>مندوب</b>', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const employee = useDataStore.getState().employees[0]
 const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, salesRepEmployeeId: employee.id })
 const day = sale.date.slice(0, 10)
 render(<RepresentativeSalesTab period={{ from: day, to: day }} cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} />)
 expect(screen.getByText(/لا يشمل التحصيلات الأخرى/)).toBeTruthy()
 expect(screen.getByText(sale.invoiceNumber)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('تصفية المندوب'), { target: { value: 'unassigned' } })
 expect(screen.queryByText(sale.invoiceNumber)).toBeNull()
 fireEvent.change(screen.getByLabelText('تصفية المندوب'), { target: { value: String(employee.id) } })
 fireEvent.click(screen.getByRole('button', { name: /معاينة وطباعة/ }))
 const html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain(sale.invoiceNumber)
 expect(html).toContain('&lt;b&gt;مندوب&lt;/b&gt;')
 expect(html).not.toContain('<b>مندوب</b>')
 expect(html).toContain('لا يشمل التحصيلات الأخرى')
})
it('تُعرض وتُطبع عكوس التعديل كعمود منفصل ويُحتسب الصافي بعده', () => {
 useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, customers: [], items: [], employees: [], sales: [], saleReturns: [], employeeAdvances: [], vouchers: [], journal: [] })
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 s.addEmployee({ nameAr: 'مندوب', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const { customers, employees } = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ lines: [line], customerId: customers[0].id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, documentDate: '2000-01-01', salesRepEmployeeId: employees[0].id })
 const edited = s.editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 3000 }], customerId: customers[0].id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })
 const day = edited.editHistory![0].at.slice(0, 10)
 render(<RepresentativeSalesTab period={{ from: day, to: day }} cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} />)
 expect(screen.getAllByText('عكس تعديل').length).toBeGreaterThan(0)
 expect(screen.getByText(/10\.00/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: /معاينة وطباعة/ }))
 const html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain('عكس تعديل')
 expect(html).toContain('الصافي: 10.00')
})
