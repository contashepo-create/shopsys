import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { PurchasesPage } from '../src/ui/pages/PurchasesPage.tsx'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'

const lock = vi.hoisted(() => ({ failAfterCommit: true }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (refresh: () => Promise<unknown>, commit: () => unknown) => { await refresh(); const result = commit(); if (lock.failAfterCommit) { lock.failAfterCommit = false; throw new Error('فشل تأكيد الحفظ') } return result } }))
const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
let rehydrate: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  const setup = { ...app.setup, countryCode: 'EG', vatPercent: 0, taxRegistrationStatus: 'not_registered' as const }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'سكر', costMinor: 1000, priceMinor: 1500, stockQty: 10, isService: false }], purchases: [], purchaseReturns: [], journal: [], warehouses: [], batches: [], serials: [], variantStocks: [] })
  lock.failAfterCommit = true
  rehydrate = vi.spyOn(useRawDataStore.persist, 'rehydrate').mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); rehydrate.mockRestore(); useRawDataStore.setState(original); useAppStore.setState(app) })
const openAndFill = () => {
  render(<MemoryRouter><PurchasesPage /><ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /إدخال سريع/ }))
  const supplier = screen.getByLabelText('بحث المورد — اكتب أول حرف ثم Enter')
  fireEvent.change(supplier, { target: { value: 'مورد' } })
  fireEvent.click(document.querySelector('button[data-quick-option][data-value="7"]')!)
  fireEvent.change(screen.getByPlaceholderText('الكمية'), { target: { value: '1' } })
  fireEvent.change(screen.getByPlaceholderText('سعر الوحدة'), { target: { value: '10' } })
}
describe('إعادة محاولة الشراء السريع بعد تعذر تأكيد الحفظ', () => {
  it('لا تنشئ قيداً وفاتورة ومخزوناً مكرراً', async () => {
    openAndFill()
    fireEvent.click(screen.getByRole('button', { name: /ترحيل الفاتورة/ }))
    await waitFor(() => expect(useToast.getState().msg).toContain('فشل تأكيد الحفظ'))
    expect(S().purchases).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /ترحيل الفاتورة/ }))
    await waitFor(() => expect(screen.queryByText('فاتورة شراء جديدة')).toBeNull())
    expect(S().purchases).toHaveLength(1)
    expect(S().journal).toHaveLength(1)
    expect(S().items[0].stockQty).toBe(11)
  })
  it('لا يعرض نجاح التغييرات الجديدة على فاتورة رُحلت سابقاً عند إعادة المحاولة', async () => {
    openAndFill()
    fireEvent.click(screen.getByRole('button', { name: /ترحيل الفاتورة/ }))
    await waitFor(() => expect(useToast.getState().msg).toContain('فشل تأكيد الحفظ'))
    fireEvent.change(screen.getByPlaceholderText('الكمية'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /ترحيل الفاتورة/ }))
    await waitFor(() => expect(useToast.getState().msg).toContain('أعد القيم'))
    expect(S().purchases).toHaveLength(1)
    expect(S().purchases[0].lines[0].qty).toBe(1)
    expect(S().items[0].stockQty).toBe(11)
  })
})
