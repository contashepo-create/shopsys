import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { computeTotals } from '../src/core/pos.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

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
