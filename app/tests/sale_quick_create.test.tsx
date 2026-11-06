import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { ACTIVITY_TEMPLATES } from '../src/core/activities.ts'
import { WindowHostContext, type WindowHostApi } from '../src/ui/windows/windowHostContext.ts'
import { useWindowStore } from '../src/ui/windows/windowStore.ts'
import { ItemPickerWindowView, PartyEditorWindowView } from '../src/ui/windows/windowViews.tsx'
import { EntityPickerWindowView } from '../src/ui/windows/EntityPickerWindows.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

const initialData = useRawDataStore.getState(), initialApp = useAppStore.getState()
const item = { ...draftFromCategory(undefined, 'OLD-1'), id: 1, nameAr: 'صنف موجود', priceMinor: 5000, stockQty: 5 }
const mount = () => render(<MemoryRouter><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
const openItems = () => fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
const saveDraft = () => {
  fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
  const draft = useRawDataStore.getState().advancedInvoiceDrafts.find(d => d.kind === 'sale')!
  return JSON.parse(draft.payload)
}
beforeEach(() => {
  useAppStore.getState().setActiveBranchContext(null)
  useAppStore.setState({ setup: { ...initialApp.setup, activityId: 'grocery', countryCode: 'EG' } })
  useRawDataStore.setState({ ...initialData, currentUserId: null, branches: [], activeBranchId: null, items: [item], customers: [], advancedInvoiceDrafts: [] })
})
afterEach(() => { cleanup(); useRawStoreReset() })
function useRawStoreReset() { useRawDataStore.setState(initialData); useAppStore.setState(initialApp) }

describe('إضافة سريعة داخل فاتورة البيع', () => {
  it('ينشئ صنفاً من البحث ويضيفه دون فقد بنود الفاتورة ودون قيد مخزون', () => {
    mount()
    openItems()
    fireEvent.doubleClick(screen.getByRole('option', { name: /صنف موجود/ }))
    openItems()
    fireEvent.change(screen.getByLabelText('بحث الصنف'), { target: { value: 'صنف جديد' } })
    fireEvent.click(screen.getByRole('button', { name: /صنف جديد/ }))
    expect((screen.getByLabelText('اسم الصنف الجديد') as HTMLInputElement).value).toBe('صنف جديد')
    fireEvent.change(screen.getByLabelText('سعر الصنف الجديد'), { target: { value: '75' } })
    const journal = useRawDataStore.getState().journal.length
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار الصنف/ }))
    const created = useRawDataStore.getState().items.find(row => row.nameAr === 'صنف جديد')!
    expect(created).toMatchObject({ priceMinor: 7500, stockQty: 0, costMinor: 0 })
    expect(useRawDataStore.getState().journal).toHaveLength(journal)
    expect(saveDraft().lines).toMatchObject([{ itemId: 1 }, { itemId: created.id, unitPriceMinor: 7500 }])
  })
  it('ينشئ عميلاً من نتائج البحث ويختاره دون فقد بنود الفاتورة', () => {
    mount(); openItems(); fireEvent.doubleClick(screen.getByRole('option', { name: /صنف موجود/ }))
    fireEvent.change(screen.getByLabelText('بحث العميل — F4'), { target: { value: 'عميل جديد' } })
    fireEvent.click(screen.getByRole('button', { name: '+ عميل جديد' }))
    expect((screen.getByLabelText('اسم العميل الجديد') as HTMLInputElement).value).toBe('عميل جديد')
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
    const created = useRawDataStore.getState().customers.find(c => c.nameAr === 'عميل جديد')!
    const payload = saveDraft()
    expect(payload.customerId).toBe(created.id)
    expect(payload.lines).toMatchObject([{ itemId: 1 }])
  })
  it('إنشاء عميل سريع لا يبدل سعر بند عدله المستخدم في الفاتورة', () => {
    mount(); openItems(); fireEvent.doubleClick(screen.getByRole('option', { name: /صنف موجود/ }))
    fireEvent.change(document.querySelector('[data-entry-row] .price-cell input')!, { target: { value: '73' } })
    fireEvent.click(screen.getByRole('button', { name: 'إضافة عميل جديد' }))
    fireEvent.change(screen.getByLabelText('اسم العميل الجديد'), { target: { value: 'عميل السعر الخاص' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
    expect(saveDraft().lines).toMatchObject([{ itemId: 1, unitPriceMinor: 7300 }])
  })
  it('إنشاء العميل من نافذة البحث يحفظ السعر المعدل في فاتورته الأم', () => {
    const base: WindowHostApi = { windowId: 'invoice-customer', props: {}, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() }
    render(<MemoryRouter><WindowHostContext.Provider value={base}><AdvancedSalesInvoicePage /><ToastHost /></WindowHostContext.Provider></MemoryRouter>)
    openItems()
    const itemWindow = useWindowStore.getState().windows.find(w => w.kind === 'item-picker')!
    const itemView = render(<WindowHostContext.Provider value={{ ...base, windowId: itemWindow.id, props: itemWindow.props }}><ItemPickerWindowView /></WindowHostContext.Provider>)
    fireEvent.doubleClick(screen.getByRole('option', { name: /صنف موجود/ }))
    itemView.unmount(); useWindowStore.getState().requestCloseWindow(itemWindow.id)
    fireEvent.change(document.querySelector('[data-entry-row] .price-cell input')!, { target: { value: '73' } })
    fireEvent.doubleClick(screen.getByLabelText('بحث العميل — F4'))
    const picker = useWindowStore.getState().windows.find(w => w.kind === 'entity-picker')!
    render(<WindowHostContext.Provider value={{ ...base, windowId: picker.id, props: picker.props }}><EntityPickerWindowView /></WindowHostContext.Provider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'بحث عميل' }), { target: { value: 'عميل نافذة' } })
    fireEvent.click(document.querySelector('[data-live-picker-create]')!)
    const editor = useWindowStore.getState().windows.find(w => w.kind === 'party-editor')!
    render(<WindowHostContext.Provider value={{ ...base, windowId: editor.id, props: editor.props }}><PartyEditorWindowView /></WindowHostContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب/ }))
    const created = useRawDataStore.getState().customers.find(c => c.nameAr === 'عميل نافذة')!
    const draft = saveDraft()
    expect(draft.customerId).toBe(created.id)
    expect(draft.lines).toMatchObject([{ itemId: 1, unitPriceMinor: 7300 }])
    useWindowStore.getState().requestCloseWindow(picker.id)
    useWindowStore.getState().requestCloseWindow(editor.id)
  })
  it('اختيار العميل بنقرة يحفظه ويعرض هاتفه في الفاتورة', () => {
    useRawDataStore.setState({ customers: [{ id: 10, nameAr: 'عميل مختار', phone: '0123456789', active: true, creditLimitMinor: 0 }] as never })
    mount()
    fireEvent.change(screen.getByLabelText('بحث العميل — F4'), { target: { value: 'عميل مختار' } })
    fireEvent.click(screen.getByRole('button', { name: /عميل مختار/ }))
    expect(screen.getByText('هاتف العميل')).toBeTruthy()
    expect(screen.getByText('0123456789')).toBeTruthy()
    expect(saveDraft().customerId).toBe(10)
  })
  it('يحفظ من منتقي النافذة الابنة ويعيد الصنف إلى الفاتورة الأصلية', () => {
    const base: WindowHostApi = { windowId: 'invoice-test', props: {}, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() }
    render(<MemoryRouter><WindowHostContext.Provider value={base}><AdvancedSalesInvoicePage /><ToastHost /></WindowHostContext.Provider></MemoryRouter>)
    openItems()
    const picker = useWindowStore.getState().windows.find(w => w.kind === 'item-picker')!
    expect(picker).toBeTruthy()
    const child = { ...base, windowId: picker.id, props: picker.props, close: vi.fn() }
    render(<WindowHostContext.Provider value={child}><ItemPickerWindowView /></WindowHostContext.Provider>)
    fireEvent.change(screen.getByLabelText('بحث الصنف'), { target: { value: 'صنف النافذة' } })
    fireEvent.click(screen.getByRole('button', { name: /صنف جديد/ }))
    expect(child.close).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText('سعر الصنف الجديد'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار الصنف/ }))
    const created = useRawDataStore.getState().items.find(row => row.nameAr === 'صنف النافذة')!
    expect(saveDraft().lines).toMatchObject([{ itemId: created.id, unitPriceMinor: 2000 }])
    useWindowStore.getState().requestCloseWindow(picker.id)
  })
  it('ينشئ صنفاً من منتقي الاستبدال ويستبدل السطر نفسه دون إضافة سطر', () => {
    const base: WindowHostApi = { windowId: 'invoice-replace', props: {}, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() }
    render(<MemoryRouter><WindowHostContext.Provider value={base}><AdvancedSalesInvoicePage /><ToastHost /></WindowHostContext.Provider></MemoryRouter>)
    openItems()
    let picker = useWindowStore.getState().windows.find(w => w.kind === 'item-picker')!
    let child = { ...base, windowId: picker.id, props: picker.props, close: vi.fn() }
    const firstView = render(<WindowHostContext.Provider value={child}><ItemPickerWindowView /></WindowHostContext.Provider>)
    fireEvent.doubleClick(screen.getByRole('option', { name: /صنف موجود/ }))
    firstView.unmount(); useWindowStore.getState().requestCloseWindow(picker.id)
    const cell = [...document.querySelectorAll('tbody td')].find(node => node.textContent?.includes('صنف موجود'))!
    fireEvent.doubleClick(cell)
    picker = useWindowStore.getState().windows.find(w => w.kind === 'item-picker')!
    expect(picker).toBeTruthy()
    child = { ...base, windowId: picker.id, props: picker.props, close: vi.fn() }
    render(<WindowHostContext.Provider value={child}><ItemPickerWindowView /></WindowHostContext.Provider>)
    fireEvent.change(screen.getByLabelText('بحث الصنف'), { target: { value: 'بديل جديد' } })
    fireEvent.click(screen.getByRole('button', { name: /صنف جديد/ }))
    fireEvent.change(screen.getByLabelText('سعر الصنف الجديد'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار الصنف/ }))
    const created = useRawDataStore.getState().items.find(row => row.nameAr === 'بديل جديد')!
    const lines = saveDraft().lines
    expect(lines).toMatchObject([{ itemId: created.id, unitPriceMinor: 2000 }])
    expect(lines).toHaveLength(1)
    useWindowStore.getState().requestCloseWindow(picker.id)
  })
  it('استبدال صنف من مسودة يمسح وحدة وسيريالات ومتغيرات وإعفاء الصنف القديم', () => {
    const base: WindowHostApi = { windowId: 'replace-draft', props: {}, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() }
    const second = { ...item, id: 2, nameAr: 'بديل موجود', priceMinor: 3000 }
    const line = { key: 'old-line', itemId: 1, nameAr: item.nameAr, qty: 2, unitPriceMinor: 5000, unitCostMinor: 0, discountPercent: 5, soldByWeight: false, warehouseId: null, warehouseSource: 'default', unitFactor: 10, unitLabel: 'علبة', serials: ['OLD'], variantColor: 'أحمر', variantSize: 'L', extendedWarrantyMonths: 12, extendedWarrantyProvider: 'قديم', vatExemptPerUnitMinor: 100, isServiceAtSale: true, notes: 'ملاحظة', vatPercentOverride: 15 }
    useRawDataStore.setState({ items: [item, second], advancedInvoiceDrafts: [{ id: 'replace', kind: 'sale', name: 'مسودة وحدات', createdAt: '2026-01-01', updatedAt: '2026-01-01', payload: JSON.stringify({ lines: [line] }) }] })
    render(<MemoryRouter><WindowHostContext.Provider value={base}><AdvancedSalesInvoicePage /><ToastHost /></WindowHostContext.Provider></MemoryRouter>)
    fireEvent.click(screen.getByTitle('فتح أي مسودة محفوظة باسم العميل'))
    fireEvent.click(within(document.querySelector('[data-draft-row="replace"]') as HTMLElement).getByRole('button', { name: /فتح/ }))
    const cell = [...document.querySelectorAll('tbody td')].find(node => node.textContent?.includes('صنف موجود'))!
    fireEvent.doubleClick(cell)
    const picker = useWindowStore.getState().windows.find(w => w.kind === 'item-picker')!
    act(() => (picker.props.onPick as (id: number) => void)(2))
    const replaced = saveDraft().lines[0]
    expect(replaced).toMatchObject({ itemId: 2, qty: 2, unitPriceMinor: 3000, discountPercent: 5, notes: 'ملاحظة', vatPercentOverride: 15 })
    for (const key of ['unitFactor', 'unitLabel', 'serials', 'variantColor', 'variantSize', 'extendedWarrantyMonths', 'extendedWarrantyProvider', 'vatExemptPerUnitMinor', 'isServiceAtSale']) expect(replaced[key]).toBeUndefined()
    useWindowStore.getState().requestCloseWindow(picker.id)
  })
  it('يعيد فحص الصلاحية عند الحفظ إذا تغير المستخدم أثناء فتح الدرج', () => {
    mount(); openItems(); fireEvent.click(screen.getByRole('button', { name: /صنف جديد/ }))
    fireEvent.change(screen.getByLabelText('اسم الصنف الجديد'), { target: { value: 'محظور' } })
    useRawDataStore.setState({ currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'none', active: true, pinHash: '' }] })
    fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار الصنف/ }))
    expect(screen.getByText(/تحتاج صلاحية إضافة الأصناف/)).toBeTruthy()
    expect(useRawDataStore.getState().items.some(i => i.nameAr === 'محظور')).toBe(false)
  })
  it.each(ACTIVITY_TEMPLATES)('تتوفر الإضافة في فاتورة نشاط $nameAr', activity => {
    useAppStore.setState(state => ({ setup: { ...state.setup, activityId: activity.id, modules: activity.modules } }))
    mount()
    expect(screen.getByRole('button', { name: 'إضافة عميل جديد' })).toBeTruthy()
    openItems()
    expect(document.querySelector('[data-item-picker-create]')).toBeTruthy()
  })
  it('لا يعرض إضافة الصنف والعميل لمن لا يملك الصلاحيتين', () => {
    useRawDataStore.setState({ currentUserId: 4, appUsers: [{ id: 4, nameAr: 'موظف', roleId: 'none', active: true, pinHash: '' }] })
    mount()
    expect(screen.queryByRole('button', { name: 'إضافة عميل جديد' })).toBeNull()
    openItems()
    expect(document.querySelector('[data-item-picker-create]')).toBeNull()
  })
})
