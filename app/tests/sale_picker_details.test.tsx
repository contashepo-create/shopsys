import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { draftFromCategory } from '../src/core/items.ts'
import { latestPurchasePrice, recordedAverageSalePrice } from '../src/core/salePickerMetrics.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ItemSearchPanel, PartyQuickPicker } from '../src/ui/components/KeyboardPickers.tsx'
import { SaleItemDetails } from '../src/ui/components/SalePickerDetails.tsx'
import { WindowHostContext, type WindowHostApi } from '../src/ui/windows/windowHostContext.ts'
import { ItemPickerWindowView, PartyEditorWindowView } from '../src/ui/windows/windowViews.tsx'
import { EntityPickerWindowView } from '../src/ui/windows/EntityPickerWindows.tsx'
import { useWindowStore } from '../src/ui/windows/windowStore.ts'
import { ToastHost } from '../src/ui/components/ui.tsx'

const initialData = useRawDataStore.getState(), initialApp = useAppStore.getState()
const first = { ...draftFromCategory(undefined, 'ONE'), id: 1, nameAr: 'الأول', priceMinor: 1500, costMinor: 700, stockQty: 3, categoryId: 1 }
const second = { ...draftFromCategory(undefined, 'TWO'), id: 2, nameAr: 'الثاني', priceMinor: 2500, costMinor: 800, stockQty: 7, categoryId: 2 }
const customers = [
  { id: 1, nameAr: 'أحمد', phone: '111', active: true, creditLimitMinor: 10000 },
  { id: 2, nameAr: 'خالد', phone: '222', active: true, creditLimitMinor: 20000 },
] as typeof initialData.customers
const deniedUser = { id: 44, nameAr: 'موظف', roleId: 'none', active: true, pinHash: '' }
const host = (props: Record<string, unknown> = {}): WindowHostApi => ({ windowId: 'parent-test', props, close: vi.fn(), setDirty: vi.fn(), setTitle: vi.fn(), setClosePrompt: vi.fn(), openChild: vi.fn() })
const withHost = (api: WindowHostApi, element: React.ReactNode) => <WindowHostContext.Provider value={api}>{element}<ToastHost /></WindowHostContext.Provider>

beforeEach(() => {
  useAppStore.getState().setActiveBranchContext(null)
  useAppStore.setState({ setup: { ...initialApp.setup, activityId: 'grocery', countryCode: 'EG' } })
  useRawDataStore.setState({ ...initialData, currentUserId: null, branches: [], activeBranchId: null, items: [first, second], customers, sales: [], purchases: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initialData); useAppStore.setState(initialApp); useWindowStore.getState().closeAll() })

describe('حساب تفاصيل فاتورة البيع', () => {
  it('يوزن البيع بوحدات الأساس ويستبعد التوثيق والبيانات غير الصالحة', () => {
    expect(recordedAverageSalePrice(1, [
      { lines: [{ itemId: 1, qty: 2, unitPriceMinor: 1200, unitFactor: 6 }] },
      { lines: [{ itemId: 1, qty: 3, unitPriceMinor: 400 }] },
      { projectBilling: 'documentation', lines: [{ itemId: 1, qty: 99, unitPriceMinor: 9999 }] },
      { lines: [{ itemId: 1, qty: 0, unitPriceMinor: 10 }, { itemId: 2, qty: 1, unitPriceMinor: 1 }, { itemId: 1, qty: 1, unitPriceMinor: -1 }] },
    ])).toBe(240)
    expect(recordedAverageSalePrice(1, [])).toBeNull()
    expect(recordedAverageSalePrice(1, [{ lines: [{ itemId: 1, qty: 1, unitPriceMinor: 0 }] }])).toBe(0)
  })
  it('يختار آخر سعر شراء بالتاريخ ثم الرقم ويتجاهل التاريخ الفاسد', () => {
    expect(latestPurchasePrice(1, [
      { id: 4, date: '2026-05-01', lines: [{ itemId: 1, unitPriceMinor: 600 }] },
      { id: 2, date: '2026-05-02', lines: [{ itemId: 1, unitPriceMinor: 700 }] },
      { id: 3, date: '2026-05-02', lines: [{ itemId: 1, unitPriceMinor: 800 }] },
      { id: 99, date: '9999-99-99', lines: [{ itemId: 1, unitPriceMinor: 9999 }] },
    ])).toBe(800)
    expect(latestPurchasePrice(2, [])).toBeNull()
    expect(latestPurchasePrice(1, [
      { id: 1, date: '2024-02-29', lines: [{ itemId: 1, unitPriceMinor: 5 }] },
      { id: 2, date: '2025-02-29', lines: [{ itemId: 1, unitPriceMinor: 10 }] },
    ])).toBe(5)
  })
})

describe('لوحة اختيار الأصناف والعملاء', () => {
  it('النقرة تحدد الصنف وتعرض بياناته دون إضافته، وEnter يؤكد', () => {
    const onPick = vi.fn()
    render(<ItemSearchPanel items={[first, second]} onPick={onPick} saleDetails />)
    fireEvent.click(screen.getByRole('option', { name: /الثاني/ }))
    const details = screen.getByLabelText('تفاصيل الصنف المحدد')
    expect(within(details).getByText('الثاني')).toBeTruthy()
    expect(within(details).getByText(/7 /)).toBeTruthy()
    expect(within(details).getByText('آخر سعر شراء')).toBeTruthy()
    expect(within(details).getByText('متوسط التكلفة')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('بحث الصنف'), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(2, undefined)
  })
  it('يعرض الخدمة والمفقود دون اختلاق سعر ويعيد تنسيق العملة بثلاث منازل', () => {
    useAppStore.setState(state => ({ setup: { ...state.setup, countryCode: 'KW' } }))
    useRawDataStore.setState({ items: [{ ...first, isService: true, costMinor: undefined } as never] })
    render(<SaleItemDetails itemId={1} />)
    expect(screen.getByText('خدمة بلا مخزون')).toBeTruthy()
    expect(screen.getAllByText('لا توجد حركة')).toHaveLength(3)
    expect(screen.getByText(/1\.500/)).toBeTruthy()
  })
  it('لا يحوّل التكلفة المفقودة إلى صفر في قائمة نافذة البيع', () => {
    useRawDataStore.setState({ items: [{ ...first, costMinor: undefined } as never] })
    render(withHost(host({ saleDetails: true, itemsFromStore: true, onPick: vi.fn() }), <ItemPickerWindowView />))
    const cells = screen.getByRole('option', { name: /الأول/ }).querySelectorAll('span')
    expect(cells[cells.length - 1].textContent).toBe('')
  })
  it('يحترم العملة بلا منازل عشرية', () => {
    useAppStore.setState(state => ({ setup: { ...state.setup, countryCode: 'IQ' } }))
    render(<SaleItemDetails itemId={1} />)
    const details = screen.getByLabelText('تفاصيل الصنف المحدد')
    expect(within(details).getByText(/1,500 د\.ع/)).toBeTruthy()
  })
  it('يعرض تفاصيل العميل بالنقرة ويؤكد بالزر أو يختار النقدي', () => {
    function Picker() { const [value, setValue] = useState(0); return <><PartyQuickPicker parties={customers} value={value} onChange={setValue} cashLabel="عميل نقدي" label="بحث العميل" saleDetails commitOnClick={false} /><output>{value}</output></> }
    render(<Picker />)
    fireEvent.change(screen.getByLabelText('بحث العميل'), { target: { value: 'خ' } })
    fireEvent.click(screen.getByRole('button', { name: /خالد/ }))
    expect(within(screen.getByLabelText('تفاصيل العميل المحدد')).getByText('222')).toBeTruthy()
    expect(screen.getByText('2', { selector: 'output' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'اختيار العميل' }))
    expect(screen.getByText('2', { selector: 'output' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('بحث العميل'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'عميل نقدي' }))
    fireEvent.keyDown(screen.getByLabelText('بحث العميل'), { key: 'Enter' })
    expect(screen.getByText('0', { selector: 'output' })).toBeTruthy()
  })
  it('يخفي التكلفة وتفاصيل الرصيد فور تغير الصلاحية في منتقي النوافذ', () => {
    const api = host({ saleDetails: true, itemsFromStore: true, onPick: vi.fn() })
    const { unmount } = render(withHost(api, <ItemPickerWindowView />))
    expect(screen.getByText('آخر سعر شراء')).toBeTruthy()
    act(() => { useRawDataStore.setState({ currentUserId: 44, appUsers: [deniedUser] }) })
    expect(screen.queryByText('آخر سعر شراء')).toBeNull()
    expect(screen.queryByText('متوسط التكلفة')).toBeNull()
    expect((document.querySelector('[data-item-picker-edit]') as HTMLButtonElement).disabled).toBe(true)
    unmount()
    render(withHost(host({ entity: 'customer', saleDetails: true, onPick: vi.fn() }), <EntityPickerWindowView />))
    expect(screen.queryByText('حد الائتمان')).toBeNull()
    expect(document.querySelector('[data-live-picker-create]')).toBeNull()
    expect(document.querySelector('[data-live-picker-dues]')).toBeNull()
    expect((document.querySelector('[data-live-picker-ledger]') as HTMLButtonElement).disabled).toBe(true)
  })
  it('يزيل تفاصيل الرصيد ومرشح الذمم فور سحب الصلاحية من نافذة العميل', () => {
    render(withHost(host({ entity: 'customer', saleDetails: true, onPick: vi.fn() }), <EntityPickerWindowView />))
    expect(screen.getByText('حد الائتمان')).toBeTruthy()
    expect(document.querySelector('[data-live-picker-dues]')).toBeTruthy()
    act(() => { useRawDataStore.setState({ currentUserId: 44, appUsers: [deniedUser] }) })
    expect(screen.queryByText('حد الائتمان')).toBeNull()
    expect(document.querySelector('[data-live-picker-dues]')).toBeNull()
    expect(document.querySelector('[data-live-picker-create]')).toBeNull()
    expect((document.querySelector('[data-live-picker-ledger]') as HTMLButtonElement).disabled).toBe(true)
  })
  it('يبني قائمة القمر من المتجر مع الالتزام بالفئة والحالة', () => {
    useRawDataStore.setState({ items: [first, second, { ...first, id: 3, nameAr: 'موقوف', isActive: false }] })
    render(withHost(host({ saleDetails: true, itemsFromStore: true, saleCategoryId: 1, onPick: vi.fn() }), <ItemPickerWindowView />))
    expect(screen.getByRole('option', { name: /الأول/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /الثاني/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /موقوف/ })).toBeNull()
  })
  it('يحدّث بيانات القائمة المحلية ويزيل الصنف الذي لم يعد متاحاً في المتجر', () => {
    const api = host({ saleDetails: true, items: [first, second], onPick: vi.fn() })
    render(withHost(api, <ItemPickerWindowView />))
    act(() => { useRawDataStore.setState({ items: [{ ...first, stockQty: 42 }] }) })
    expect(screen.queryByRole('option', { name: /الثاني/ })).toBeNull()
    expect(within(screen.getByRole('option', { name: /الأول/ })).getByText('42')).toBeTruthy()
  })
  it('يحصر أسعار الحركات في الفرع الفعّال ولا يعرض حركات الفرع الآخر', () => {
    const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true, customModulesMode: 'all' as const, enabledModules: [] }
    useRawDataStore.setState({
      branches: [main, { ...main, id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2 }], activeBranchId: 1, warehouses: [],
      items: [{ ...first, branchId: 1 }],
      sales: [{ id: 1, branchId: 1, lines: [{ itemId: 1, qty: 1, unitPriceMinor: 2500 }] }, { id: 2, branchId: 2, lines: [{ itemId: 1, qty: 1, unitPriceMinor: 9900 }] }] as never,
      purchases: [{ id: 1, branchId: 1, date: '2026-01-01', lines: [{ itemId: 1, unitPriceMinor: 1200 }] }, { id: 2, branchId: 2, date: '2026-02-01', lines: [{ itemId: 1, unitPriceMinor: 9900 }] }] as never,
    })
    render(<SaleItemDetails itemId={1} />)
    const details = screen.getByLabelText('تفاصيل الصنف المحدد')
    expect(within(details).getByText(/25\.00/)).toBeTruthy()
    expect(within(details).getByText(/12\.00/)).toBeTruthy()
    expect(within(details).queryByText(/99\.00/)).toBeNull()
  })
  it('يختار النقدي من نافذة العميل المستقلة', () => {
    const onPick = vi.fn(), api = host({ entity: 'customer', saleDetails: true, onPick })
    render(withHost(api, <EntityPickerWindowView />))
    fireEvent.click(screen.getByRole('button', { name: 'اختيار عميل نقدي' }))
    expect(onPick).toHaveBeenCalledWith(0)
    expect(api.close).toHaveBeenCalledOnce()
  })
  it('يمرر اسم البحث لمحرر العميل ويعيد العميل المحفوظ عبر نافذة المنتقي', () => {
    const onPick = vi.fn(), api = host({ entity: 'customer', saleDetails: true, onPick })
    render(withHost(api, <EntityPickerWindowView />))
    fireEvent.change(screen.getByRole('textbox', { name: 'بحث عميل' }), { target: { value: 'عميل النافذة' } })
    fireEvent.click(screen.getByRole('button', { name: /عميل جديد/ }))
    const child = useWindowStore.getState().windows.find(w => w.kind === 'party-editor')!
    expect(child.props.initialName).toBe('عميل النافذة')
    expect(child.props.enforcePermission).toBe(true)
    const editorApi = { ...host(child.props), windowId: child.id }
    render(withHost(editorApi, <PartyEditorWindowView />))
    expect((screen.getByLabelText('اسم الحساب') as HTMLInputElement).value).toBe('عميل النافذة')
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب/ }))
    const created = useRawDataStore.getState().customers.find(c => c.nameAr === 'عميل النافذة')!
    expect(onPick).toHaveBeenCalledWith(created.id)
    expect(api.close).toHaveBeenCalledOnce()
  })
  it('يرفض حفظ العميل عند سحب الصلاحية أثناء فتح المحرر', () => {
    const onSaved = vi.fn(), api = host({ partyKind: 'customer', partyId: 0, initialName: 'ممنوع', enforcePermission: true, onSaved })
    render(withHost(api, <PartyEditorWindowView />))
    act(() => { useRawDataStore.setState({ currentUserId: 44, appUsers: [deniedUser] }) })
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب/ }))
    expect(useRawDataStore.getState().customers.some(c => c.nameAr === 'ممنوع')).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByText(/تحتاج صلاحية إدارة الحساب/)).toBeTruthy()
  })
})
