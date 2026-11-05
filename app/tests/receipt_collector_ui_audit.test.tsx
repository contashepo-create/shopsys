import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VouchersPage } from '../src/ui/pages/VouchersPage.tsx'
import { RepresentativeSalesTab } from '../src/ui/pages/RepresentativeSalesTab.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { localStorage.clear(); useAppStore.setState({ ...app, activeBranchContext: null, approvals: { ...app.approvals, enabled: false }, setup: { ...app.setup, countryCode: 'EG', activityId: 'general', modules: ['pos', 'inventory', 'purchases'] } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, employees: [], vouchers: [], journal: [] }) })
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); usePrintPreview.getState().closePreview(); localStorage.clear() })
it('تختار الواجهة محصل سند القبض وتستعيده من المسودة دون إضافته لسند الصرف', () => {
 const s = useDataStore.getState()
 s.addEmployee({ nameAr: 'المحصّل', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const employee = useDataStore.getState().employees[0]
 const view = render(<MemoryRouter><VouchersPage /></MemoryRouter>)
 fireEvent.click(view.getAllByText(/سند قبض/)[0].closest('button')!)
 const select = screen.getByLabelText('محصّل سند القبض') as HTMLSelectElement
 fireEvent.change(select, { target: { value: String(employee.id) } })
 expect(select.value).toBe(String(employee.id))
 const saveButton = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('حفظ مسودة'))
 expect(saveButton).toBeTruthy()
 fireEvent.click(saveButton!)
 const draft = JSON.parse(localStorage.getItem('shopsys.voucher-draft.receipt')!)
 expect(draft.receiptCollectorEmployeeId).toBe(employee.id)
 fireEvent.click(screen.getByLabelText('إغلاق'))
 fireEvent.click(view.getAllByText(/سند صرف/)[0].closest('button')!)
 expect(screen.queryByLabelText('محصّل سند القبض')).toBeNull()
 fireEvent.click(screen.getByLabelText('إغلاق'))
 fireEvent.click(view.getAllByText(/سند قبض/)[0].closest('button')!)
 expect((screen.getByLabelText('محصّل سند القبض') as HTMLSelectElement).value).toBe(String(employee.id))
})
it('يظهر القبض والعكس في دفتر منفصل ويحتفظان بحدود النطاق في المعاينة', () => {
 const s = useDataStore.getState()
 s.addEmployee({ nameAr: 'المحصّل', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const employee = useDataStore.getState().employees[0]
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل آخر', receiptCollectorEmployeeId: employee.id })
 s.reverseVoucher(voucher.id, 'تصحيح')
 const day = voucher.date.slice(0, 10)
 render(<RepresentativeSalesTab period={{ from: day, to: day }} cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} />)
 expect(screen.getByText('سندات القبض حسب المحصّل — منفصلة عن المبيعات')).toBeTruthy()
 expect(screen.getByText('عكس قبض')).toBeTruthy()
 expect(screen.getAllByText(voucher.voucherNumber)).toHaveLength(2)
 fireEvent.click(screen.getByRole('button', { name: /معاينة وطباعة/ }))
 const html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain('سندات القبض حسب المحصّل — منفصلة عن المبيعات')
 expect(html).toContain('لا يشمل التحصيلات الأخرى')
 expect(html).toContain('عكس قبض')
})
it('يظهر أصل عهدة الفاتورة منفصلاً عن سندات القبض وباسم حامل العهدة لا مندوب البيع', () => {
 const s = useDataStore.getState()
 s.addEmployee({ nameAr: 'مندوب المبيعات', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 s.addEmployee({ nameAr: 'حامل العهدة', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const employees = useDataStore.getState().employees, itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', paidMinor: 2000, treasury: '1101', paymentAllocations: [{ accountCode: '1107', employeeId: employees[1].id, amountMinor: 2000 }], invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, salesRepEmployeeId: employees[0].id })
 const day = sale.date.slice(0, 10)
 render(<RepresentativeSalesTab period={{ from: day, to: day }} cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} />)
 expect(screen.getByText('عهدة الموظف المسجلة عند البيع — ليست إثباتاً للمحصّل')).toBeTruthy()
 expect(screen.getAllByText('حامل العهدة').length).toBeGreaterThan(0)
 fireEvent.click(screen.getByRole('button', { name: /معاينة وطباعة/ }))
 const html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain('عهدة الموظف المسجلة عند البيع — ليست إثباتاً للمحصّل')
 expect(html).toContain('حامل العهدة')
 expect(html).toContain('ليست رصيداً حالياً')
})
