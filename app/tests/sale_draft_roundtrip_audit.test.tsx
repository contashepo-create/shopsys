import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { computeTotals, CreditLimitError } from '../src/core/pos.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'

const originalData = useRawDataStore.getState(), originalApp = useAppStore.getState()
const mount = () => render(<MemoryRouter><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
const restore = (id: string) => {
  fireEvent.click(screen.getByTitle('فتح أي مسودة محفوظة باسم العميل'))
  fireEvent.click(within(document.querySelector(`[data-draft-row="${id}"]`) as HTMLElement).getByRole('button', { name: /فتح/ }))
}
beforeEach(() => {
  const setup = { ...originalApp.setup, countryCode: 'EG', activityId: 'grocery', taxRegistrationStatus: 'registered' as const, vatPercent: 14 }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...originalData, currentUserId: null, branches: [], activeBranchId: null, customers: [], suppliers: [{ id: 7, nameAr: 'مورد الاختبار', phone: '', active: true }] as never, advancedInvoiceDrafts: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('استعادة مسودة فاتورة بيع دون تغيير الطرف والتحصيل والضريبة', () => {
  it('مسودة المورد تحفظ نوعه وتعيده لا عميلاً له رقم مطابق', () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('نوع طرف الفاتورة'), { target: { value: 'supplier' } })
    fireEvent.change(screen.getByLabelText('بحث المورد'), { target: { value: 'مورد الاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: /مورد الاختبار/ }))
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const draft = useRawDataStore.getState().advancedInvoiceDrafts[0]
    expect(JSON.parse(draft.payload)).toMatchObject({ partyKind: 'supplier', customerId: 7 })
    view.unmount()
    mount(); restore(draft.id)
    expect((screen.getByLabelText('نوع طرف الفاتورة') as HTMLSelectElement).value).toBe('supplier')
    expect((screen.getByLabelText('بحث المورد') as HTMLInputElement).value).toBe('مورد الاختبار')
  })
  it('يرحّل مسودة مورد مستعادة على حساب المورد لا العميل رغم تطابق الرقم', async () => {
    const rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback() } })
    try {
      useAppStore.setState({ setup: { ...useAppStore.getState().setup, requireOpenShiftForSales: false, vatPercent: 0, taxRegistrationStatus: 'unregistered' } })
      useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل موقوف', phone: '', creditLimitMinor: 1, active: false }], items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة الاختبار', isService: true, priceMinor: 5000 }], sales: [], journal: [], warehouses: [] })
      const view = mount()
      fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
      fireEvent.doubleClick(screen.getByRole('option', { name: /خدمة الاختبار/ }))
      fireEvent.change(screen.getByLabelText('نوع طرف الفاتورة'), { target: { value: 'supplier' } })
      fireEvent.change(screen.getByLabelText('بحث المورد'), { target: { value: 'مورد الاختبار' } })
      fireEvent.click(screen.getByRole('button', { name: /مورد الاختبار/ }))
      fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
      const draft = useRawDataStore.getState().advancedInvoiceDrafts[0]
      view.unmount(); mount(); restore(draft.id)
      fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
      await waitFor(() => expect(useRawDataStore.getState().sales).toHaveLength(1))
      const sale = useRawDataStore.getState().sales[0]
      expect(sale).toMatchObject({ partyKind: 'supplier', partyId: 7, customerId: null, paidMinor: 0 })
      const entry = useRawDataStore.getState().journal.find(e => e.id === sale.journalEntryId)!
      expect(entry.lines.find(line => line.accountCode === '2101')?.debit).toBe(5000)
      expect(entry.lines.some(line => line.accountCode === '1104')).toBe(false)
    } finally {
      rehydrate.mockRestore()
      if (locks) Object.defineProperty(navigator, 'locks', locks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })
  it('بطاقة الموظف تعرضه كطرف مسجل ولا تعرض بيانات العميل ذي الرقم نفسه', () => {
    useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل موقوف', phone: '', creditLimitMinor: 100, active: false }], employees: [{ id: 7, nameAr: 'موظف الاختبار', code: 'E7', role: 'driver', phone: '', active: true, hireDate: '2025-01-01', salaryBaseMinor: 0, notes: '' }] as never })
    mount()
    fireEvent.change(screen.getByLabelText('نوع طرف الفاتورة'), { target: { value: 'employee' } })
    fireEvent.change(document.querySelector('[data-live-picker-dblclick="employee"]')!, { target: { value: 'موظف الاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: /موظف الاختبار/ }))
    const text = document.querySelector('.invoice-doc-party')?.textContent
    expect(text).toContain('موظف الاختبار')
    expect(text).not.toContain('نقدي')
    expect(text).not.toContain('موقوف')
    expect(text).not.toContain('الحد الائتماني')
  })
  it('سحب صلاحية كشف العميل يخفي رصيده وحده وتفاصيل الائتمان في الفاتورة', () => {
    useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل خصوصي', phone: '', creditLimitMinor: 88888, active: true }], getCustomerBalance: () => 123456 })
    mount()
    fireEvent.change(screen.getByLabelText('بحث العميل — F4'), { target: { value: 'عميل خصوصي' } })
    fireEvent.click(screen.getByRole('button', { name: /عميل خصوصي/ }))
    expect(document.querySelector('.invoice-doc-party')?.textContent).toContain('1,234.56')
    act(() => { useRawDataStore.setState({ currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', deniedPerms: ['party.customer.statement'] }] }) })
    expect(document.querySelector('.invoice-doc-party')?.textContent).not.toContain('1,234.56')
    expect(document.querySelector('.invoice-doc-party')?.textContent).not.toContain('888.88')
    expect(document.querySelector('[data-invoice-paynote]')?.textContent).not.toContain('888.88')
    expect((screen.getByTitle('تعديل بيانات العميل') as HTMLButtonElement).disabled).toBe(true)
  })
  it('المورد لا يرث سعر أو حالة العميل الذي يحمل الرقم نفسه', () => {
    useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل موقوف', phone: '', creditLimitMinor: 1, priceListId: 1, active: false }], priceLists: [{ id: 1, nameAr: 'قائمة عميل', defaultDiscountPercent: 50, isActive: true }], priceListEntries: [], priceListCategoryRules: [], items: [{ ...draftFromCategory(undefined, 'X'), id: 1, nameAr: 'صنف بسعر', priceMinor: 5000, stockQty: 10 }] })
    mount()
    fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
    fireEvent.doubleClick(screen.getByRole('option', { name: /صنف بسعر/ }))
    fireEvent.change(screen.getByLabelText('نوع طرف الفاتورة'), { target: { value: 'supplier' } })
    fireEvent.change(screen.getByLabelText('بحث المورد'), { target: { value: 'مورد الاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: /مورد الاختبار/ }))
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    expect(JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload).lines[0].unitPriceMinor).toBe(5000)
    expect(screen.queryByText('موقوف — البيع الآجل ممنوع')).toBeNull()
    expect(document.querySelector('.invoice-doc-party')?.textContent).not.toContain('نقدي')
    expect(document.querySelector('.invoice-doc-party')?.textContent).toContain('مورد الاختبار')
  })
  it('يستعيد تاريخ الفاتورة والضريبة والتحصيل المجزأ وقيمه', () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('نمط تحرير الفاتورة'), { target: { value: 'advanced' } })
    fireEvent.change(screen.getByLabelText('تاريخ الفاتورة — يمكن إنشاء فاتورة بتاريخ سابق أو لاحق'), { target: { value: '2026-03-05' } })
    const tax = document.querySelector<HTMLInputElement>('[data-invoice-tax-toggle] input')!
    expect(tax.checked).toBe(true)
    fireEvent.click(tax)
    fireEvent.click(screen.getByLabelText(/تحصيل متعدد/))
    fireEvent.click(screen.getByTitle('أضف طريقة تحصيل أخرى لنفس الفاتورة'))
    const bank = document.querySelector<HTMLInputElement>('[data-pay-line="bank"] input')!
    fireEvent.change(bank, { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const draft = useRawDataStore.getState().advancedInvoiceDrafts[0]
    expect(JSON.parse(draft.payload)).toMatchObject({ invoiceDate: '2026-03-05', applyTax: false, multiPay: true, bankPaid: '20' })
    view.unmount(); mount(); restore(draft.id)
    expect((screen.getByLabelText('تاريخ الفاتورة — يمكن إنشاء فاتورة بتاريخ سابق أو لاحق') as HTMLInputElement).value).toBe('2026-03-05')
    expect(document.querySelector<HTMLInputElement>('[data-invoice-tax-toggle] input')?.checked).toBe(false)
    expect((screen.getByLabelText(/تحصيل متعدد/) as HTMLInputElement).checked).toBe(true)
    expect(document.querySelector<HTMLInputElement>('[data-pay-line="bank"] input')?.value).toBe('20')
  })
  it('المسودة القديمة بلا نوع الطرف تتطلب إعادة اختياره ولا تستنتجه من الرقم', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [{ id: 'legacy', kind: 'sale', name: 'قديمة', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ customerId: 7, lines: [] }) }] })
    mount(); restore('legacy')
    expect(screen.getByText(/مسودة قديمة لا تحفظ نوع الطرف/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const payload = JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload)
    expect(payload).toMatchObject({ customerId: 0, partyNeedsReview: true })
    fireEvent.change(screen.getByLabelText('نوع طرف الفاتورة'), { target: { value: 'supplier' } })
    fireEvent.change(screen.getByLabelText('بحث المورد'), { target: { value: 'مورد الاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: /مورد الاختبار/ }))
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    expect(JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload)).toMatchObject({ partyKind: 'supplier', customerId: 7, partyNeedsReview: false })
  })
  it('تقدير الائتمان عند التعديل يستبعد آجل الفاتورة القديمة قبل حساب الجديدة', () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 6000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: 7, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل الأصل', phone: '', creditLimitMinor: 10000, active: true }], getCustomerBalance: () => 6000, items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never })
    render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
    const card = document.querySelector('.invoice-doc-party')!
    expect(card.querySelector('.invoice-doc-cardfoot')?.textContent).toContain('60.00')
    expect(document.querySelector('[data-invoice-paynote]')?.textContent).not.toContain('يلزم تحصيل')
    fireEvent.click(document.querySelector('[data-prepost-open]')!)
    expect(screen.queryByText(/تجاوز حد الائتمان/)).toBeNull()
  })
  it('لا يغيّر تعديل البيع التحصيل إلى عملة أجنبية دون توثيق ساق العملة', async () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: 7, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    const edit = vi.fn().mockImplementation(() => sale)
    const rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
    try {
      useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل', phone: '', creditLimitMinor: 0, active: true }], items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never, editSale: edit as never })
      useRawDataStore.setState({ advancedInvoiceDrafts: [{ id: 'fx-edit', kind: 'sale', name: 'قديمة', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ editingSaleId: 44, partyKind: 'customer', customerId: 7, lines: [line], mode: 'advanced', fxOn: true, fxCode: 'USD', fxAmount: '10', fxRate: '5' }) }] })
      render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
      fireEvent.change(screen.getByLabelText('سبب تعديل المستند'), { target: { value: 'تصحيح' } })
      expect(document.querySelector('[data-fx-open]')).toBeNull()
      restore('fx-edit')
      fireEvent.change(screen.getByLabelText('سبب تعديل المستند'), { target: { value: 'تصحيح' } })
      expect(document.querySelector('[data-fx-clear]')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
      await waitFor(() => expect(useToast.getState().msg).toContain('لا يمكن إدخال تحصيل أجنبي عند تعديل الفاتورة'))
      expect(edit).not.toHaveBeenCalled()
    } finally { rehydrate.mockRestore() }
  })
  it('تعديل تجاوز ائتمان يعيد المحاولة باعتماد الائتمان بعد تحرير قفل الواجهة', async () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: 7, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    const edit = vi.fn().mockImplementationOnce(() => { throw new CreditLimitError('عميل الأصل', 1000, 1000, 1500) }).mockImplementation(() => sale)
    const rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback() } })
    try {
      useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل الأصل', phone: '', creditLimitMinor: 1500, active: true }], items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never, editSale: edit as never })
      render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
      fireEvent.change(screen.getByLabelText('سبب تعديل المستند'), { target: { value: 'تصحيح' } })
      fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(2))
      expect(edit.mock.calls[1][0].creditLimitOverrideBy).toBeTruthy()
      expect(edit.mock.calls[1][0].priceFloorOverrideBy).toBeNull()
    } finally {
      rehydrate.mockRestore()
      if (locks) Object.defineProperty(navigator, 'locks', locks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })
  it('تجاوز ائتمان التعديل يطلب صلاحية الائتمان لا صلاحية السعر', async () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: 7, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    const edit = vi.fn().mockImplementationOnce(() => { throw new CreditLimitError('عميل', 1000, 1000, 1500) }).mockImplementation(() => sale)
    const approve = vi.fn().mockResolvedValue({ approvedBy: 'مشرف الائتمان' })
    const rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback() } })
    try {
      useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل', phone: '', creditLimitMinor: 1500, active: true }], items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never, editSale: edit as never, approveByPin: approve as never, currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', deniedPerms: ['sales.credit.override'] }] })
      render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
      fireEvent.change(screen.getByLabelText('سبب تعديل المستند'), { target: { value: 'تصحيح' } })
      fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
      fireEvent.change(await screen.findByPlaceholderText('كلمة سر المشرف…'), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: /اعتماد/ }))
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(2))
      expect(approve).toHaveBeenCalledWith('123456', 'sales.credit.override')
      expect(edit.mock.calls[1][0].creditLimitOverrideBy).toBe('مشرف الائتمان')
      expect(edit.mock.calls[1][0].priceFloorOverrideBy).toBeNull()
    } finally {
      rehydrate.mockRestore()
      if (locks) Object.defineProperty(navigator, 'locks', locks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })
  it('تعديل فاتورة مستوردة تنص على نوع عميل يعيده من customerId لا من partyId الفارغ', () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: 7, partyKind: 'customer', partyId: null, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    useRawDataStore.setState({ customers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'عميل الأصل', phone: '', creditLimitMinor: 0, active: true }], items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never })
    render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    expect(JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload).customerId).toBe(7)
  })
  it('تعديل فاتورة مورد لا يوهم بإمكانية تغيير نوع الطرف أو هويته', () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: null, partyKind: 'supplier', partyId: 7, taxPercent: 0, taxInclusive: false, payment: 'credit', paidMinor: 0 }
    useRawDataStore.setState({ items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale] as never })
    render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
    expect((screen.getByLabelText('نوع طرف الفاتورة') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('بحث المورد') as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByLabelText('بحث المورد') as HTMLInputElement).value).toBe('مورد الاختبار')
  })
  it('مسودة التعديل لا تُفتح فوق فاتورة أخرى ويمكن استعادتها فوق الأصل', () => {
    const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
    const sale = { id: 44, invoiceNumber: 'S-44', date: '2026-01-01', lines: [line], totals: computeTotals([line], 0, 0, false), customerId: null, taxPercent: 0, taxInclusive: false, payment: 'cash', paidMinor: 1000 }
    const d = { id: 'edit', kind: 'sale' as const, name: 'تعديل الأصلي', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ editingSaleId: 44, partyKind: 'customer', lines: [{ ...line, key: 'line', warehouseId: null, warehouseSource: 'default', qty: 3 }] }) }
    useRawDataStore.setState({ items: [{ ...draftFromCategory(undefined, 'S1'), id: 1, nameAr: 'خدمة', isService: true }], sales: [sale, { ...sale, id: 45, invoiceNumber: 'S-45' }] as never, advancedInvoiceDrafts: [d] })
    const other = render(<MemoryRouter initialEntries={['/?edit=45']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
    restore('edit'); expect(screen.getByText(/افتح مسودة التعديل داخل الفاتورة الأصلية/)).toBeTruthy()
    other.unmount()
    render(<MemoryRouter initialEntries={['/?edit=44']}><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
    restore('edit')
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    expect(JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload)).toMatchObject({ editingSaleId: 44, lines: [{ qty: 3 }] })
  })
  it('يرفض فتح مسودة مرتبطة بفواتير أخرى في فاتورة جديدة', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [{ id: 'edit-other', kind: 'sale', name: 'تعديل', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ editingSaleId: 44, partyKind: 'customer', lines: [], invoiceDate: '2024-01-01' }) }] })
    mount(); const before = (screen.getByLabelText('تاريخ الفاتورة — يمكن إنشاء فاتورة بتاريخ سابق أو لاحق') as HTMLInputElement).value
    restore('edit-other')
    expect(screen.getByText(/افتح مسودة التعديل داخل الفاتورة الأصلية/)).toBeTruthy()
    expect((screen.getByLabelText('تاريخ الفاتورة — يمكن إنشاء فاتورة بتاريخ سابق أو لاحق') as HTMLInputElement).value).toBe(before)
  })
})
