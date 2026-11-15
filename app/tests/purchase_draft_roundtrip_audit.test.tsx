import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { PartyQuickEditModal } from '../src/ui/components/PartyQuickEditModal.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { AdvancedPurchaseInvoicePage } from '../src/ui/pages/AdvancedPurchaseInvoicePage.tsx'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'

const originalData = useRawDataStore.getState(), originalApp = useAppStore.getState()
const mount = (path = '/') => render(<MemoryRouter initialEntries={[path]}><AdvancedPurchaseInvoicePage /><ToastHost /></MemoryRouter>)
const restore = (id: string) => {
  fireEvent.click(screen.getByRole('button', { name: /المسودات/ }))
  fireEvent.click(within(document.querySelector(`[data-draft-row="${id}"]`) as HTMLElement).getByRole('button', { name: /فتح/ }))
}
beforeEach(() => {
  const setup = { ...originalApp.setup, countryCode: 'EG', activityId: 'grocery' }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...originalData, currentUserId: null, branches: [], activeBranchId: null, suppliers: [{ id: 7, nameAr: 'مورد الاختبار', phone: '', active: true }] as never, advancedInvoiceDrafts: [], purchases: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('استعادة مسودة الشراء دون تغيير السداد أو الأصل', () => {
  it('مسودة تعديل الشراء لا تُفتح كفاتورة جديدة أو فوق فاتورة أخرى', () => {
    const base = { date: '2026-01-01', supplierId: 7, lines: [], expenses: [], discountPercent: 0, paidMinor: 0, grandTotalMinor: 0, supplierDueMinor: 0 }
    useRawDataStore.setState({ purchases: [{ ...base, id: 44, invoiceNumber: 'P-44' }, { ...base, id: 45, invoiceNumber: 'P-45' }] as never })
    const view = mount('/?edit=44')
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const draft = useRawDataStore.getState().advancedInvoiceDrafts[0]
    expect(JSON.parse(draft.payload).editingPurchaseId).toBe(44)
    view.unmount(); const other = mount('/?edit=45'); restore(draft.id)
    expect(screen.getByText(/داخل الفاتورة الأصلية فقط/)).toBeTruthy()
    other.unmount(); mount(); restore(draft.id)
    expect(screen.getByText(/داخل الفاتورة الأصلية فقط/)).toBeTruthy()
  })
  it('المسودة القديمة برقم أمر بلا ارتباط تتطلب قراراً صريحاً قبل الترحيل', async () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [{ id: 'legacy', kind: 'purchase', name: 'قديمة', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ supplierId: 7, purchaseOrderNumber: 'PO-9', lines: [] }) }] })
    mount(); restore('legacy')
    expect(screen.getByRole('alert').textContent).toContain('مسودة قديمة')
    fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
    await waitFor(() => expect(useToast.getState().msg).toBe('راجع ارتباط أمر الشراء في المسودة القديمة قبل الترحيل'))
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الترحيل بلا ربط أمر' }))
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    expect(JSON.parse(useRawDataStore.getState().advancedInvoiceDrafts[0].payload)).toMatchObject({ sourceOrderId: null, sourceOrderNeedsReview: false })
  })
  it('لا يغيّر تعديل الشراء الدفع إلى عملة أجنبية دون توثيق ساق العملة', async () => {
    const line = { itemId: 1, qty: 1, unitPriceMinor: 10000, vatPercent: 0 }
    const sale = { id: 44, invoiceNumber: 'P-44', date: '2026-01-01', supplierId: 7, lines: [line], expenses: [], discountPercent: 0, paidMinor: 0, grandTotalMinor: 10000, supplierDueMinor: 10000 }
    const edit = vi.fn().mockImplementation(() => sale)
    const rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
    try {
      useRawDataStore.setState({ purchases: [sale] as never, items: [{ id: 1, nameAr: 'صنف', sku: 'X', stockQty: 10, costMinor: 10000, priceMinor: 12000, minQty: 0, isActive: true }] as never, editPurchase: edit as never, advancedInvoiceDrafts: [{ id: 'fx-edit', kind: 'purchase', name: 'قديمة', createdAt: '2026', updatedAt: '2026', payload: JSON.stringify({ editingPurchaseId: 44, sourceOrderId: null, supplierId: 7, lines: [line], mode: 'advanced', fxOn: true, fxCode: 'USD', fxAmount: '10', fxRate: '5' }) }] })
      mount('/?edit=44')
      expect(document.querySelector('[data-fx-open]')).toBeNull()
      restore('fx-edit')
      fireEvent.change(screen.getByLabelText('سبب تعديل المستند'), { target: { value: 'تصحيح' } })
      expect(document.querySelector('[data-fx-clear]')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
      await waitFor(() => expect(useToast.getState().msg).toContain('لا يمكن إدخال سداد أجنبي عند تعديل الفاتورة'))
      expect(edit).not.toHaveBeenCalled()
    } finally { rehydrate.mockRestore() }
  })
  it('رصيد المورد المتوقع يستبعد أثر الفاتورة الأصلية عند تعديلها', () => {
    const line = { itemId: 1, qty: 1, unitPriceMinor: 10000, vatPercent: 0 }
    const purchase = { id: 44, invoiceNumber: 'P-44', date: '2026-01-01', supplierId: 7, lines: [line], expenses: [], discountPercent: 0, paidMinor: 0, grandTotalMinor: 10000, supplierDueMinor: 10000 }
    useRawDataStore.setState({ purchases: [purchase] as never, getSupplierBalance: () => 10000, items: [{ id: 1, nameAr: 'صنف', sku: 'X', stockQty: 10, costMinor: 10000, priceMinor: 12000, minQty: 0, isActive: true }] as never })
    mount('/?edit=44')
    expect(document.querySelector('.invoice-doc-party .invoice-doc-cardfoot')?.textContent).toContain('100.00')
  })
  it('فاتورة الشراء لا تسمح بتعديل المورد بعد سحب صلاحية إدارته', () => {
    useRawDataStore.setState({ currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', deniedPerms: ['pur.supplier.manage'] }] })
    mount()
    fireEvent.change(screen.getByLabelText('بحث المورد — F4'), { target: { value: 'مورد الاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: /مورد الاختبار/ }))
    expect((screen.getByTitle('تعديل بيانات المورد') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('نمط تحرير الفاتورة'), { target: { value: 'advanced' } })
    expect((screen.getByRole('button', { name: /تعديل التصنيف والبيانات/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('المحرر السريع يفحص صلاحية المورد لحظة الحفظ حتى بعد فتحه', () => {
    const supplier = { ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد الاختبار', phone: '', active: true }
    const update = vi.fn()
    useRawDataStore.setState({ suppliers: [supplier] as never, updateSupplier: update as never })
    render(<><PartyQuickEditModal open target={{ kind: 'supplier', party: supplier } as never} currencyDecimals={2} currencySymbol="ج.م" onClose={() => {}} /><ToastHost /></>)
    fireEvent.change(screen.getByDisplayValue('مورد الاختبار'), { target: { value: 'تغيير غير مصرح' } })
    act(() => { useRawDataStore.setState({ currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', deniedPerms: ['pur.supplier.manage'] }] }) })
    fireEvent.click(screen.getByRole('button', { name: /حفظ بيانات الطرف/ }))
    expect(update).not.toHaveBeenCalled()
    expect(useToast.getState().msg).toContain('تحتاج صلاحية إدارة الحساب')
  })
  it('يحفظ السداد الأجنبي وملاحظة المورد ويستعيدهما', () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('نمط تحرير الفاتورة'), { target: { value: 'advanced' } })
    fireEvent.change(screen.getByLabelText('ملاحظة تُحفظ في سجل ملاحظات المورد'), { target: { value: 'ملاحظة مسودة' } })
    fireEvent.click(document.querySelector('[data-fx-open]')!)
    fireEvent.change(screen.getByLabelText('المبلغ بالعملة الأجنبية'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('سعر الصرف'), { target: { value: '5' } })
    fireEvent.click(document.querySelector('[data-fx-apply]')!)
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const draft = useRawDataStore.getState().advancedInvoiceDrafts[0]
    expect(JSON.parse(draft.payload)).toMatchObject({ fxOn: true, fxCode: 'USD', fxAmount: '10', fxRate: '5', partyNote: 'ملاحظة مسودة' })
    view.unmount(); mount(); restore(draft.id)
    expect((screen.getByLabelText('ملاحظة تُحفظ في سجل ملاحظات المورد') as HTMLInputElement).value).toBe('ملاحظة مسودة')
    expect(document.querySelector('[data-fx-summary]')?.textContent).toContain('10 USD')
  })
})
