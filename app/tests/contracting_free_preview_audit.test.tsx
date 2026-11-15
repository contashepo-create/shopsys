import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ContractingInvoicesPage } from '../src/ui/pages/ContractingInvoicesPage.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useToast } from '../src/ui/components/ui.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const control = vi.hoisted(() => ({ before: null as null | (() => void), failAfter: false, hold: false, release: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (control.hold) await new Promise<void>(resolve => { control.release = resolve })
 control.before?.(); const result = commit(); if (control.failAfter) throw new Error('flush failed'); return result
} }))
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const text = () => new DOMParser().parseFromString(usePrintPreview.getState().handle?.html ?? '', 'text/html').body.textContent ?? ''
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG' as const, activityId: 'contracting' as const, requireOpenShiftForSales: false, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], receipt: { ...app.receipt, silentPrint: false } })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [], customers: [], projects: [], projectExtracts: [], boqItems: [], items: [], sales: [], journal: [] })
 control.before = null; control.failAfter = false; control.hold = false; control.release = null
 useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function setupEditor() {
 render(<MemoryRouter><ContractingInvoicesPage /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /فاتورة مقاولات ببنود حرة/ }))
 const editor = document.querySelector('[data-contracting-free-editor]') as HTMLElement
 fireEvent.change(within(editor).getByPlaceholderText('أعمال حفر وردم وتسوية…'), { target: { value: 'أعمال اختبار' } })
 const line = within(editor).getByPlaceholderText('أعمال حفر وردم وتسوية…').closest('tr')!
 const inputs = within(line).getAllByRole('spinbutton') as HTMLInputElement[]
 fireEvent.change(inputs[1], { target: { value: '100' } })
 return { editor, inputs }
}
it('معاينة مسودة المقاولات حية وتتبع الكمية وتمنع الطباعة بعد حذف البنود', () => {
 const { editor, inputs } = setupEditor()
 fireEvent.click(within(editor).getByRole('button', { name: /معاينة/ }))
 expect(text()).toContain('أعمال اختبار'); expect(text()).toContain('مسودة')
 fireEvent.change(inputs[0], { target: { value: '7' } }); expect(text()).toMatch(/\b7\b/)
 fireEvent.click(within(editor).getByRole('button', { name: 'حذف البند' }))
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
it('المعاينة تستخدم مبلغ التحصيل الفعلي وترفض مبلغاً يتجاوز الإجمالي', () => {
 const { editor } = setupEditor()
 const paid = within(editor).getByText(/المحصل \(/).closest('label')?.querySelector('input') ?? Array.from(editor.querySelectorAll('input')).find(input => input.inputMode === 'decimal' && input.type !== 'number')
 expect(paid).toBeTruthy(); fireEvent.change(paid!, { target: { value: '30' } })
 fireEvent.click(within(editor).getByRole('button', { name: /معاينة/ }))
 expect(text()).toMatch(/30[.,]00/)
 fireEvent.change(paid!, { target: { value: '200' } })
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
it('يرفض الترحيل عند تغيير الفرع قبل القفل ولا ينشئ فاتورة أو أصناف خدمة', async () => {
 const { editor } = setupEditor(); control.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }
 await act(async () => { fireEvent.click(within(editor).getByRole('button', { name: /حفظ وترحيل/ })) })
 expect(useRawDataStore.getState().sales).toHaveLength(0); expect(useRawDataStore.getState().items).toHaveLength(0)
 expect(useToast.getState().msg).toContain('تغيرت بيانات الفاتورة')
})
it('ينبه عند فشل تأكيد حفظ الفاتورة ويغلق المسودة بعد تسجيلها محلياً', async () => {
 const { editor } = setupEditor(); control.failAfter = true
 await act(async () => { fireEvent.click(within(editor).getByRole('button', { name: /حفظ وترحيل/ })) })
 await waitFor(() => expect(useRawDataStore.getState().sales).toHaveLength(1))
 expect(useRawDataStore.getState().sales[0].sourceDraftId).toBeTruthy()
 expect(useToast.getState().msg).toContain('تعذر تأكيد الحفظ')
 expect(document.querySelector('[data-contracting-free-editor]')).toBeNull()
})
it('معاينة فاتورة مقاولات مرحّلة تتحدث عند تعديل السجل وتُمنع عند فقده', () => {
 const state = useRawDataStore.getState()
 const itemId = state.ensureServiceItemForFreeLine({ nameAr: 'خدمة محفوظة', unitAr: 'عدد', priceMinor: 10000 })
 const sale = useRawDataStore.getState().postSale({ lines: [{ itemId, nameAr: 'خدمة محفوظة', qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 render(<MemoryRouter><ContractingInvoicesPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة A4'))
 expect(text()).toContain('خدمة محفوظة')
 act(() => { useRawDataStore.setState({ sales: [{ ...sale, lines: sale.lines.map(l => ({ ...l, nameAr: 'خدمة معدلة' })) }] }) })
 expect(text()).toContain('خدمة معدلة')
 act(() => { useRawDataStore.setState({ sales: [] }) })
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
it('لا يتجاهل بنداً غير صالح ولا ينشئ خدمة أو فاتورة لكمية بدقة غير مدعومة', () => {
 const { editor, inputs } = setupEditor()
 fireEvent.change(inputs[0], { target: { value: '0.0001' } })
 fireEvent.click(within(editor).getByRole('button', { name: /معاينة/ }))
 expect(usePrintPreview.getState().open).toBe(false)
 expect(useToast.getState().msg).toContain('ثلاث خانات')
 fireEvent.click(within(editor).getByRole('button', { name: /حفظ وترحيل/ }))
 expect(useRawDataStore.getState().sales).toHaveLength(0)
 expect(useRawDataStore.getState().items).toHaveLength(0)
})
