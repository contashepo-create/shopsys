/**
 * بلاغ المالك: (١) حوار تأكيد الإغلاق لا يغلق النافذة المستهدفة،
 * (٢) لا إغلاق تلقائي بعد حفظ وترحيل الفاتورة.
 * تغطية مسارات سطح المكتب (نافذة قمر) غير المغطاة سابقاً: أزرار الحوار
 * الثلاثة، والترحيل → closeSelf، بالإضافة إلى ترحيل فاتورة الشراء في الويب.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')

const S = () => useDataStore.getState()
const W = () => useWindowStore.getState()
const EMPTY = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

let bridge: {
  onRequestClose: (listener: (event: { token: string }) => void) => () => void
  onPropInvoke: (listener: (e: unknown) => void) => () => void
  onNavigate: (listener: (e: unknown) => void) => () => void
  onRegistry: (listener: (e: unknown) => void) => () => void
  setRendererReady: ReturnType<typeof vi.fn>
  setDirty: ReturnType<typeof vi.fn>
  respondClose: ReturnType<typeof vi.fn>
  closeSelf: ReturnType<typeof vi.fn>
  setTitle: ReturnType<typeof vi.fn>
  invokeProp: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  openSection: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  requestClose: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  minimize: ReturnType<typeof vi.fn>
  toggleMaximize: ReturnType<typeof vi.fn>
}
let requestClose: ((event: { token: string }) => void) | undefined
let previousDesktop: typeof window.shopsysDesktop | undefined

beforeEach(() => {
  useWindowStore.setState({ windows: [], topZ: 700 })
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'متجر', ownerName: 'مالك', allowNegativeTreasury: true } })
  requestClose = undefined
  bridge = {
    onRequestClose: (listener) => { requestClose = listener; return () => { if (requestClose === listener) requestClose = undefined } },
    onPropInvoke: () => () => undefined,
    onNavigate: () => () => undefined,
    onRegistry: () => () => undefined,
    setRendererReady: vi.fn(),
    setDirty: vi.fn(),
    respondClose: vi.fn(),
    closeSelf: vi.fn(),
    setTitle: vi.fn(),
    invokeProp: vi.fn(),
    open: vi.fn(async () => ({ ok: true })),
    openSection: vi.fn(async () => ({ ok: true })),
    claim: vi.fn(async () => null),
    list: vi.fn(async () => []),
    requestClose: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
  }
  previousDesktop = window.shopsysDesktop
  window.shopsysDesktop = {
    runtime: 'electron',
    windows: bridge,
    invoiceCommit: { acquire: vi.fn(async () => 'commit-token'), release: vi.fn() },
  } as unknown as NonNullable<typeof window.shopsysDesktop>
})

afterEach(() => {
  if (previousDesktop) window.shopsysDesktop = previousDesktop
  else delete window.shopsysDesktop
  cleanup()
})

function seedSaleItem(sku = 'SAT-CLOSE-1') {
  S().addItem({
    nameAr: `صنف إغلاق ${sku}`, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 1000, stockQty: 10, priceMinor: 2500, minQty: 0, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  return S().items.at(-1)!
}

async function renderSatelliteInvoice(kind: 'sales-invoice' | 'purchase-invoice') {
  const { SatelliteViewRoot } = await import('../src/ui/windows/satellite.tsx')
  render(
    <MemoryRouter>
      <SatelliteViewRoot descriptor={{ windowId: 'satellite-repro', type: 'view', kind, title: 'فاتورة اختبار' }} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector(`[data-satellite-view="${kind}"] .invoice-pos-root`)).toBeTruthy(), { timeout: 8000 })
  await waitFor(() => expect(requestClose).toBeTypeOf('function'))
}

/** كتابة ملاحظة لتصنع حالة «تعديلات غير محفوظة» */
async function makeDirty(kind: 'sales-invoice' | 'purchase-invoice') {
  const notes = document.querySelector(`[data-satellite-view="${kind}"] textarea`) as HTMLTextAreaElement
  expect(notes).toBeTruthy()
  fireEvent.change(notes, { target: { value: 'ملاحظة غير محفوظة' } })
  await waitFor(() => expect(bridge.setDirty).toHaveBeenCalledWith(true))
}

describe('نافذة قمر الفاتورة — حوار الإغلاق يغلق النافذة فعلاً', () => {
  it('بيع: «حفظ كمسودة ثم الإغلاق» يحفظ ويجيب التوكن ويُغلق النافذة', async () => {
    await renderSatelliteInvoice('sales-invoice')
    await makeDirty('sales-invoice')

    await act(async () => { requestClose?.({ token: 'save-close' }) })
    const ask = document.querySelector('[data-window-close-confirm]') as HTMLElement
    expect(ask).toBeTruthy()
    const saveBtn = ask.querySelector('[data-window-close-save]') as HTMLElement
    expect(saveBtn, 'زر «حفظ كمسودة ثم الإغلاق» يجب أن يظهر للصفحة المسجّلة').toBeTruthy()

    const draftsBefore = S().advancedInvoiceDrafts.length
    await act(async () => { fireEvent.click(saveBtn) })
    expect(bridge.respondClose).toHaveBeenCalledWith('save-close', true)
    expect(bridge.closeSelf).toHaveBeenCalled()
    expect(S().advancedInvoiceDrafts.length).toBe(draftsBefore + 1)
    expect(document.querySelector('[data-window-close-confirm]')).toBeNull()
  })

  it('بيع: «إغلاق وحذف المسودة» يجيب التوكن ويُغلق النافذة', async () => {
    await renderSatelliteInvoice('sales-invoice')
    await makeDirty('sales-invoice')

    await act(async () => { requestClose?.({ token: 'discard-close' }) })
    const ask = document.querySelector('[data-window-close-confirm]') as HTMLElement
    expect(ask).toBeTruthy()
    await act(async () => { fireEvent.click(ask.querySelector('[data-window-close-confirm-yes]') as HTMLElement) })
    expect(bridge.respondClose).toHaveBeenCalledWith('discard-close', true)
    /* الإغلاق مضمون حتى لو انتهت مهلة المصافحة في العملية الرئيسية */
    expect(bridge.closeSelf).toHaveBeenCalled()
    expect(document.querySelector('[data-window-close-confirm]')).toBeNull()
  })

  it('شراء: «حفظ كمسودة ثم الإغلاق» يحفظ ويجيب التوكن ويُغلق النافذة', async () => {
    await renderSatelliteInvoice('purchase-invoice')
    await makeDirty('purchase-invoice')

    await act(async () => { requestClose?.({ token: 'purchase-save-close' }) })
    const ask = document.querySelector('[data-window-close-confirm]') as HTMLElement
    expect(ask).toBeTruthy()
    const saveBtn = ask.querySelector('[data-window-close-save]') as HTMLElement
    expect(saveBtn).toBeTruthy()

    const draftsBefore = S().advancedInvoiceDrafts.length
    await act(async () => { fireEvent.click(saveBtn) })
    expect(bridge.respondClose).toHaveBeenCalledWith('purchase-save-close', true)
    expect(bridge.closeSelf).toHaveBeenCalled()
    expect(S().advancedInvoiceDrafts.length).toBe(draftsBefore + 1)
  })

  it('شراء: «إغلاق وحذف المسودة» يجيب التوكن ويُغلق النافذة', async () => {
    await renderSatelliteInvoice('purchase-invoice')
    await makeDirty('purchase-invoice')

    await act(async () => { requestClose?.({ token: 'purchase-discard-close' }) })
    const ask = document.querySelector('[data-window-close-confirm]') as HTMLElement
    await act(async () => { fireEvent.click(ask.querySelector('[data-window-close-confirm-yes]') as HTMLElement) })
    expect(bridge.respondClose).toHaveBeenCalledWith('purchase-discard-close', true)
    expect(bridge.closeSelf).toHaveBeenCalled()
    expect(document.querySelector('[data-window-close-confirm]')).toBeNull()
  })
})

describe('إغلاق تلقائي بعد حفظ وترحيل الفاتورة', () => {
  it('بيع (سطح المكتب): بعد «حفظ وترحيل» تُغلق نافذة القمر تلقائياً (closeSelf)', async () => {
    const item = seedSaleItem()
    S().addCustomer({ ...EMPTY, nameAr: 'عميل نافذة القمر', phone: '', creditLimitMinor: 0, notes: '' } as never)
    const customer = S().customers.at(-1)!
    const { SatelliteViewRoot } = await import('../src/ui/windows/satellite.tsx')
    render(
      <MemoryRouter>
        <SatelliteViewRoot
          descriptor={{
            windowId: 'satellite-repro', type: 'view', kind: 'sales-invoice', title: 'فاتورة اختبار',
            props: { prefill: { lines: [{ itemId: item.id, qty: 1 }] } },
          }}
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('[data-satellite-view="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })

    /* الفاتورة المعبأة آجلة — نثبت عميلاً قبل الترحيل */
    const customerInput = document.querySelector('[aria-label="بحث العميل — F4"]') as HTMLInputElement
    expect(customerInput).toBeTruthy()
    fireEvent.change(customerInput, { target: { value: customer.nameAr } })
    const customerOption = await waitFor(() => {
      const option = document.querySelector(`[data-quick-option][data-value="${customer.id}"]`)
      expect(option).toBeTruthy()
      return option as HTMLElement
    })
    fireEvent.click(customerOption)

    const root = document.querySelector('[data-satellite-view="sales-invoice"]') as HTMLElement
    const postButton = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.includes('حفظ وترحيل')) as HTMLButtonElement
    expect(postButton).toBeTruthy()
    const salesBefore = S().sales.length
    await act(async () => { fireEvent.click(postButton) })

    await waitFor(() => expect(S().sales.length).toBe(salesBefore + 1), { timeout: 8000 })
    await waitFor(() => expect(bridge.closeSelf).toHaveBeenCalled(), { timeout: 8000 })
  })

  it('شراء (ويب): بعد «حفظ وترحيل» تُغلق نافذة المستند فوراً', async () => {
    S().addSupplier({ ...EMPTY, nameAr: 'مورد إغلاق الشراء', phone: '', creditLimitMinor: 0, notes: '' } as never)
    const supplier = S().suppliers.at(-1)!
    const item = seedSaleItem('WEB-PUR-1')

    delete (window as { shopsysDesktop?: unknown }).shopsysDesktop
    const { openPurchaseInvoiceWindow } = await import('../src/ui/windows/windowStore.ts')
    const { WindowHost } = await import('../src/ui/windows/WindowHost.tsx')
    const id = openPurchaseInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="purchase-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })

    const supplierInput = document.querySelector('[aria-label="بحث المورد — F4"]') as HTMLInputElement
    expect(supplierInput).toBeTruthy()
    fireEvent.change(supplierInput, { target: { value: supplier.nameAr } })
    const supplierOption = await waitFor(() => {
      const option = document.querySelector(`[data-quick-option][data-value="${supplier.id}"]`)
      expect(option).toBeTruthy()
      return option as HTMLElement
    })
    fireEvent.click(supplierOption)
    /* تحقّق ارتباط المورد فوراً — رسالة الفشل تُسمّي السبب بدل انتظار عدّاد الشراء بصمت */
    await waitFor(() => expect(supplierInput.value).toBe(supplier.nameAr))

    const itemInput = document.querySelector('[aria-label="اسم الصنف — اكتب أو اضغط مرتين للبحث"]') as HTMLInputElement
    fireEvent.change(itemInput, { target: { value: item.nameAr } })
    const itemOption = await waitFor(() => {
      const option = document.querySelector(`#invoice-item-option-${item.id}`)
      expect(option).toBeTruthy()
      return option as HTMLElement
    })
    fireEvent.doubleClick(itemOption)
    await waitFor(() => expect(document.querySelectorAll('[data-entry-row]').length).toBe(1))

    const invoiceWindow = document.querySelector(`[data-app-window="${id}"]`) as HTMLElement
    const postButton = Array.from(invoiceWindow.querySelectorAll('button')).find((button) => button.textContent?.includes('حفظ وترحيل')) as HTMLButtonElement
    expect(postButton).toBeTruthy()
    expect(postButton.disabled).toBe(false)
    const purchasesBefore = S().purchases.length
    await act(async () => { fireEvent.click(postButton) })

    await waitFor(() => expect(S().purchases.length).toBe(purchasesBefore + 1), { timeout: 8000 })
    await waitFor(() => expect(W().windows.some((window) => window.id === id)).toBe(false), { timeout: 8000 })
  })
})

describe('منع تكرار فاتورة الشراء عند إعادة المحاولة بعد ضياع رد الحفظ', () => {
  it('postPurchase بنفس sourceDraftId تعيد الفاتورة السابقة بلا قيد أو خصم مخزون مكرر', () => {
    const item = seedSaleItem('PUR-IDEM-1')
    const before = S().purchases.length
    const args = {
      sourceDraftId: 'purchase-draft-idem',
      supplierId: 0,
      date: new Date().toISOString(),
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 2500 }],
      expenses: [],
      paidMinor: 2500,
    } as never
    const first = S().postPurchase(args)
    const second = S().postPurchase(args)
    expect(second.id).toBe(first.id)
    expect(S().purchases.length).toBe(before + 1)
    expect(S().purchases.filter((row) => row.sourceDraftId === 'purchase-draft-idem')).toHaveLength(1)
  })
})
