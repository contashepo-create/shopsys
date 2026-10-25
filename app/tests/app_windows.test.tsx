import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import React, { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useWindowStore, openSalesInvoiceWindow, openPurchaseInvoiceWindow, openItemEditorWindow, openPartyLedgerWindow, openItemLedgerWindow } = await import('../src/ui/windows/windowStore.ts')
const { WindowHost } = await import('../src/ui/windows/WindowHost.tsx')
const { Modal, Btn } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
const W = () => useWindowStore.getState()
const EMPTY = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

beforeEach(() => {
  useWindowStore.setState({ windows: [], topZ: 700 })
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'متجر', ownerName: 'مالك', allowNegativeTreasury: true } })
})
afterEach(() => cleanup())

describe('مسار الفاتورة يفتحها نافذة حرة (قرار المالك ⑩ي البند ⑮)', () => {
  it('الدخول على /sales/invoices/new يفتح نافذة فاتورة بدل صفحة مدمجة، ويمكن فتح ثانية فوقها', async () => {
    const { InvoiceDocumentRoute } = await import('../src/ui/pages/InvoiceDocumentRoute.tsx')
    render(<MemoryRouter initialEntries={['/sales/invoices/new']}><InvoiceDocumentRoute kind="sale"/></MemoryRouter>)
    await waitFor(() => expect(W().windows.filter((win) => win.kind === 'sales-invoice').length).toBe(1))
    cleanup()
    render(<MemoryRouter initialEntries={['/sales/invoices/new']}><InvoiceDocumentRoute kind="sale"/></MemoryRouter>)
    await waitFor(() => expect(W().windows.filter((win) => win.kind === 'sales-invoice').length).toBe(2))
    // النافذتان مستقلتان: تصغير الأولى لا يغلق الثانية
    const [first, second] = W().windows
    W().minimizeWindow(first.id)
    expect(W().windows.find((win) => win.id === first.id)!.mode).toBe('minimized')
    expect(W().windows.find((win) => win.id === second.id)!.mode).not.toBe('minimized')
  })

  it('فاتورة الشراء أيضاً نافذة حرة', async () => {
    const { InvoiceDocumentRoute } = await import('../src/ui/pages/InvoiceDocumentRoute.tsx')
    render(<MemoryRouter initialEntries={['/purchases/invoices/new']}><InvoiceDocumentRoute kind="purchase"/></MemoryRouter>)
    await waitFor(() => expect(W().windows.filter((win) => win.kind === 'purchase-invoice').length).toBe(1))
  })
})

describe('نظام النوافذ المستقلة', () => {
  it('يفتح أكثر من فاتورة في وقت واحد ولكل واحدة حالتها', () => {
    const first = openSalesInvoiceWindow()
    const second = openSalesInvoiceWindow()
    expect(W().windows.length).toBe(2)
    expect(first).not.toBe(second)
    // الثانية أعلى بصرياً، والتركيز يعيد ترتيب الطبقات
    expect(W().windows[1].z).toBeGreaterThan(W().windows[0].z)
    W().focusWindow(first)
    expect(W().windows.find((w) => w.id === first)!.z).toBeGreaterThan(W().windows.find((w) => w.id === second)!.z)
  })

  it('تعديل الصنف يفتح نافذة ابنة: إغلاقها لا يغلق الفاتورة، وإغلاق الفاتورة يغلق بناتها', () => {
    const invoice = openSalesInvoiceWindow()
    const child = openItemEditorWindow(7, invoice)
    expect(W().windows.length).toBe(2)
    W().closeWindow(child)
    expect(W().windows.map((w) => w.id)).toEqual([invoice])
    const child2 = openItemEditorWindow(9, invoice)
    expect(W().windows.length).toBe(2)
    W().closeWindow(invoice)
    expect(W().windows.length).toBe(0)
    expect(W().windows.find((w) => w.id === child2)).toBeUndefined()
  })

  it('فتح نفس الصنف مرتين يركّز النافذة القائمة بدل التكرار', () => {
    const a = openItemEditorWindow(5, null)
    const b = openItemEditorWindow(5, null)
    expect(a).toBe(b)
    expect(W().windows.length).toBe(1)
  })

  it('التصغير يبقيها في شريط المهام والاستعادة تعيدها', () => {
    S().addItem({ nameAr: 'علف بادئ', sku: 'F1', barcodes: [], categoryId: 0, baseUnit: 'كجم', costMinor: 1000, stockQty: 50, priceMinor: 1500, minQty: 5 } as never)
    const item = S().items.at(-1)!
    const id = openItemEditorWindow(item.id, null)
    const view = render(<MemoryRouter><WindowHost /></MemoryRouter>)
    expect(document.querySelector(`[data-app-window="${id}"]`)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-window-minimize]') as HTMLElement)
    // إصلاح بلاغ المالك: النافذة المصغَّرة تبقى في الشجرة (حالتها الداخلية
    // لا تُفقد) وتُخفى بصرياً فقط عبر data-window-mode="minimized"
    const minimizedEl = document.querySelector(`[data-app-window="${id}"]`)
    expect(minimizedEl).toBeTruthy()
    expect(minimizedEl!.getAttribute('data-window-mode')).toBe('minimized')
    expect(minimizedEl!.getAttribute('aria-hidden')).toBe('true')
    const task = document.querySelector(`[data-window-task="${id}"] button`) as HTMLElement
    expect(task).toBeTruthy()
    fireEvent.click(task)
    expect(document.querySelector(`[data-app-window="${id}"]`)).toBeTruthy()
    expect(document.querySelector(`[data-app-window="${id}"]`)!.getAttribute('data-window-mode')).not.toBe('minimized')
    // التكبير والاستعادة
    fireEvent.click(document.querySelector('[data-window-maximize]') as HTMLElement)
    expect(document.querySelector(`[data-app-window="${id}"]`)!.getAttribute('data-window-mode')).toBe('maximized')
    view.unmount()
  })

  it('بلاغ المالك: تصغير فاتورة بيع لا يفقد البنود والملاحظات المكتوبة بداخلها (لا يُفكَّك المحرر)', async () => {
    const id = openSalesInvoiceWindow()
    const view = render(<MemoryRouter><WindowHost /></MemoryRouter>)
    const notesField = await waitFor(() => {
      const el = document.querySelector('[aria-label="ملاحظات وشروط المستند"]') as HTMLTextAreaElement
      expect(el).toBeTruthy()
      return el
    })
    fireEvent.change(notesField, { target: { value: 'ملاحظة لم تُحفظ بعد — يجب ألا تضيع عند التصغير' } })
    expect((document.querySelector('[aria-label="ملاحظات وشروط المستند"]') as HTMLTextAreaElement).value)
      .toBe('ملاحظة لم تُحفظ بعد — يجب ألا تضيع عند التصغير')
    fireEvent.click(document.querySelector(`[data-app-window="${id}"] [data-window-minimize]`) as HTMLElement)
    expect(W().windows.find((w) => w.id === id)!.mode).toBe('minimized')
    // العنصر باقٍ في الشجرة (مخفي بصرياً فقط) — لم يُفكَّك محرر الفاتورة
    expect(document.querySelector('[aria-label="ملاحظات وشروط المستند"]')).toBeTruthy()
    const task = document.querySelector(`[data-window-task="${id}"] button`) as HTMLElement
    fireEvent.click(task)
    expect(W().windows.find((w) => w.id === id)!.mode).not.toBe('minimized')
    expect((document.querySelector('[aria-label="ملاحظات وشروط المستند"]') as HTMLTextAreaElement).value)
      .toBe('ملاحظة لم تُحفظ بعد — يجب ألا تضيع عند التصغير')
    view.unmount()
  })

  it('الإغلاق مع تعديلات غير محفوظة يسأل أولاً ولا يغلق إلا بالتأكيد', () => {
    S().addItem({ nameAr: 'ذرة صفراء', sku: 'F2', barcodes: [], categoryId: 0, baseUnit: 'كجم', costMinor: 800, stockQty: 10, priceMinor: 1200, minQty: 1 } as never)
    const item = S().items.at(-1)!
    const id = openItemEditorWindow(item.id, null)
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    const nameInput = document.querySelector('[aria-label="اسم الصنف"]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'ذرة صفراء مستوردة' } })
    expect(W().windows[0].dirty).toBe(true)
    fireEvent.click(document.querySelector('[data-window-close]') as HTMLElement)
    expect(document.querySelector('[data-window-close-confirm]')).toBeTruthy()
    expect(W().windows.length).toBe(1)
    fireEvent.click(document.querySelector('[data-window-close-cancel]') as HTMLElement)
    expect(W().windows.length).toBe(1)
    fireEvent.click(document.querySelector('[data-window-close]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-window-close-confirm-yes]') as HTMLElement)
    expect(W().windows.length).toBe(0)
  })

  it('فاتورة المبيعات نفسها تعمل داخل النافذة المستقلة وتُغلق بزرها', async () => {
    const id = openSalesInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })
    expect(document.querySelector(`[data-app-window="${id}"]`)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-window-close]') as HTMLElement)
    expect(W().windows.length).toBe(0)
  })

  /**
   * بلاغ المالك: «الفاتورة تسألني عند الإغلاق وأنا لم أكتب شيئاً».
   * السبب كان أن ملء المدفوع تلقائياً (نقدي = الإجمالي) يُحسب تعديلاً من المستخدم.
   * القاعدة: ما لم يلمسه المستخدم لا يُحسب تعديلاً — والفاتورة الفارغة تُغلق فوراً.
   */
  it('فاتورة فارغة تُغلق بلا سؤال، وبعد كتابة ملاحظة تسأل بثلاثة خيارات وتحفظ مسودة باسم العميل', async () => {
    const id = openSalesInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })
    expect(W().windows[0].dirty).toBe(false)

    // كتابة فعلية من المستخدم ⇒ النافذة صارت «فيها تعديلات»
    const notes = document.querySelector('[data-window-kind="sales-invoice"] textarea') as HTMLTextAreaElement
    expect(notes).toBeTruthy()
    fireEvent.change(notes, { target: { value: 'تسليم الفرع الثاني' } })
    await waitFor(() => expect(W().windows[0].dirty).toBe(true))

    fireEvent.click(document.querySelector('[data-window-close]') as HTMLElement)
    const ask = document.querySelector('[data-window-close-confirm]') as HTMLElement
    expect(ask).toBeTruthy()
    // الخيارات الثلاثة: متابعة العمل · حفظ كمسودة ثم الإغلاق · إغلاق وحذف المسودة
    expect(ask.querySelector('[data-window-close-cancel]')).toBeTruthy()
    expect(ask.querySelector('[data-window-close-save]')).toBeTruthy()
    expect(ask.querySelector('[data-window-close-confirm-yes]')).toBeTruthy()
    // الغطاء يخرج من النافذة إلى body حتى لا يغطيه رأس الجدول اللاصق
    expect(ask.closest('[data-app-window]')).toBeNull()

    const before = S().advancedInvoiceDrafts.length
    await act(async () => { fireEvent.click(ask.querySelector('[data-window-close-save]') as HTMLElement) })
    await waitFor(() => expect(W().windows.find((row) => row.id === id)).toBeFalsy())
    expect(S().advancedInvoiceDrafts.length).toBe(before + 1)
  })

  it('«إغلاق وحذف المسودة» ينفّذ تنظيف الصفحة ثم يغلق النافذة', async () => {
    const id = openSalesInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })
    const notes = document.querySelector('[data-window-kind="sales-invoice"] textarea') as HTMLTextAreaElement
    fireEvent.change(notes, { target: { value: 'ملاحظة تجريبية' } })
    await waitFor(() => expect(W().windows[0].dirty).toBe(true))
    fireEvent.click(document.querySelector('[data-window-close]') as HTMLElement)
    const before = S().advancedInvoiceDrafts.length
    await act(async () => { fireEvent.click(document.querySelector('[data-window-close-confirm-yes]') as HTMLElement) })
    await waitFor(() => expect(W().windows.find((row) => row.id === id)).toBeFalsy())
    expect(S().advancedInvoiceDrafts.length).toBe(before)
  })

  it('استعادة مسودة المبيعات تحفظ لاحقاً فوق نفس المسودة ولا تنشئ نسخة منفصلة', async () => {
    const draftId = 'sales-draft-roundtrip'
    const priorSalesDraftCount = S().advancedInvoiceDrafts.filter((draft) => draft.kind === 'sale' && !draft.isTemplate).length
    S().upsertAdvancedInvoiceDraft({
      id: draftId, kind: 'sale', name: 'مسودة اختبار العميل',
      payload: JSON.stringify({ notes: 'ملاحظة محفوظة سابقاً', lines: [], customerId: 0 }),
    })
    const id = openSalesInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })

    fireEvent.click([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('المسودات')) as HTMLElement)
    const row = await waitFor(() => {
      const element = document.querySelector(`[data-draft-row="${draftId}"]`)
      expect(element).toBeTruthy()
      return element as HTMLElement
    })
    fireEvent.click(row.querySelector('button') as HTMLElement)
    const notes = document.querySelector(`[data-app-window="${id}"] textarea`) as HTMLTextAreaElement
    await waitFor(() => expect(notes.value).toBe('ملاحظة محفوظة سابقاً'))
    fireEvent.change(notes, { target: { value: 'تعديل محفوظ على نفس المسودة' } })
    fireEvent.click([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('حفظ مسودة')) as HTMLElement)

    await waitFor(() => {
      const drafts = S().advancedInvoiceDrafts.filter((draft) => draft.kind === 'sale' && !draft.isTemplate)
      const restoredDrafts = drafts.filter((draft) => draft.id === draftId)
      expect(drafts).toHaveLength(priorSalesDraftCount + 1)
      expect(restoredDrafts).toHaveLength(1)
      expect(JSON.parse(restoredDrafts[0].payload).notes).toBe('تعديل محفوظ على نفس المسودة')
    })
  })

  it('إلغاء مسودة مشتريات مستعادة يغلق النافذة ويحذف المسودة المحددة لا معرّفاً مؤقتاً', async () => {
    const draftId = 'purchase-draft-discard'
    S().upsertAdvancedInvoiceDraft({
      id: draftId, kind: 'purchase', name: 'مسودة اختبار المورد',
      payload: JSON.stringify({ notes: 'مسودة مشتريات محفوظة', lines: [], supplierId: 0 }),
    })
    const id = openPurchaseInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-window-kind="purchase-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })

    fireEvent.click([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('المسودات')) as HTMLElement)
    const row = await waitFor(() => {
      const element = document.querySelector(`[data-draft-row="${draftId}"]`)
      expect(element).toBeTruthy()
      return element as HTMLElement
    })
    fireEvent.click(row.querySelector('button') as HTMLElement)
    const notes = document.querySelector(`[data-app-window="${id}"] textarea`) as HTMLTextAreaElement
    await waitFor(() => expect(notes.value).toBe('مسودة مشتريات محفوظة'))
    fireEvent.change(notes, { target: { value: 'تعديل مشتريات غير محفوظ' } })
    await waitFor(() => expect(W().windows.find((window) => window.id === id)?.dirty).toBe(true))

    fireEvent.click(document.querySelector(`[data-app-window="${id}"] [data-window-close]`) as HTMLElement)
    await act(async () => { fireEvent.click(document.querySelector('[data-window-close-confirm-yes]') as HTMLElement) })
    await waitFor(() => expect(W().windows.some((window) => window.id === id)).toBe(false))
    expect(S().advancedInvoiceDrafts.some((draft) => draft.id === draftId)).toBe(false)
  })

  it('القمر المستقل يغلق فاتورة نظيفة فوراً ويطلب تأكيداً بعد تحريرها', async () => {
    const previousDesktop = window.shopsysDesktop
    let requestClose: ((event: { token: string }) => void) | undefined
    const bridge = {
      onRequestClose: (listener: (event: { token: string }) => void) => { requestClose = listener; return () => { requestClose = undefined } },
      setRendererReady: vi.fn(),
      setDirty: vi.fn(),
      respondClose: vi.fn(),
      closeSelf: vi.fn(),
      setTitle: vi.fn(),
      invokeProp: vi.fn(),
    }
    window.shopsysDesktop = { runtime: 'electron', windows: bridge } as unknown as NonNullable<typeof window.shopsysDesktop>
    try {
      const { SatelliteViewRoot } = await import('../src/ui/windows/satellite.tsx')
      render(<MemoryRouter><SatelliteViewRoot descriptor={{ windowId: 'satellite-test', type: 'view', kind: 'sales-invoice', title: 'فاتورة اختبار' }} /></MemoryRouter>)
      await waitFor(() => expect(document.querySelector('[data-satellite-view="sales-invoice"] .invoice-pos-root')).toBeTruthy(), { timeout: 8000 })
      await waitFor(() => expect(requestClose).toBeTypeOf('function'))
      await act(async () => { requestClose?.({ token: 'clean-close' }) })
      expect(bridge.respondClose).toHaveBeenCalledWith('clean-close', true)
      expect(document.querySelector('[data-window-close-confirm]')).toBeNull()

      const notes = document.querySelector('[data-satellite-view="sales-invoice"] textarea') as HTMLTextAreaElement
      fireEvent.change(notes, { target: { value: 'تغيير غير محفوظ' } })
      await waitFor(() => expect(bridge.setDirty).toHaveBeenCalledWith(true))
      await act(async () => { requestClose?.({ token: 'dirty-close-cancel' }) })
      expect(document.querySelector('[data-window-close-confirm]')).toBeTruthy()
      expect(bridge.respondClose).not.toHaveBeenCalledWith('dirty-close-cancel', true)
      fireEvent.click(document.querySelector('[data-window-close-cancel]') as HTMLElement)
      expect(bridge.respondClose).toHaveBeenCalledWith('dirty-close-cancel', false)
      expect(document.querySelector('[data-window-close-confirm]')).toBeNull()
      expect(document.querySelector('[data-satellite-view="sales-invoice"] .invoice-pos-root')).toBeTruthy()

      await act(async () => { requestClose?.({ token: 'dirty-close-confirm' }) })
      expect(document.querySelector('[data-window-close-confirm]')).toBeTruthy()
      fireEvent.click(document.querySelector('[data-window-close-confirm-yes]') as HTMLElement)
      expect(bridge.respondClose).toHaveBeenCalledWith('dirty-close-confirm', true)
    } finally {
      if (previousDesktop) window.shopsysDesktop = previousDesktop
      else delete window.shopsysDesktop
    }
  })

  it('كشف حساب العميل يفتح كنافذة مستقلة بصفوف الحركة', () => {
    S().addCustomer({ ...EMPTY, nameAr: 'مزرعة الخير', phone: '', creditLimitMinor: 0, notes: '' } as never)
    const customer = S().customers.at(-1)!
    openPartyLedgerWindow('customer', customer.id, null)
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    expect(document.querySelector('[data-window-view="party-ledger"]')).toBeTruthy()
    expect(document.body.textContent).toContain('مزرعة الخير')
  })
})

describe('النوافذ المنبثقة المتداخلة', () => {
  function TwoModals() {
    const [first, setFirst] = useState(true)
    const [second, setSecond] = useState(true)
    return (
      <>
        <Modal open={first} onClose={() => setFirst(false)} title="النافذة الأولى">
          <div data-testid="first-body">محتوى الأولى</div>
          <Btn onClick={() => setSecond(true)}>افتح الثانية</Btn>
        </Modal>
        <Modal open={second} onClose={() => setSecond(false)} title="النافذة الثانية">
          <div data-testid="second-body">محتوى الثانية</div>
        </Modal>
      </>
    )
  }

  /* قاعدة المالك (2026-09-28): «لا نافذة تُعتّم الخلفية أو تعزلها أو تضع ظلاً» —
     فلا طبقة تعتيم أصلاً، والغلاف لا يلتقط الضغطات كي يبقى العمل خلف النافذة متاحاً. */
  it('لا طبقة تعتيم ولا عزل خلف النوافذ والعمل خلفها متاح', () => {
    render(<TwoModals />)
    expect(document.querySelectorAll('[data-modal-id]').length).toBe(2)
    expect(document.querySelectorAll('[data-modal-backdrop]').length).toBe(0)
    const shells = [...document.querySelectorAll('[data-modal-id]')] as HTMLElement[]
    shells.forEach((shell) => expect(shell.className).toContain('pointer-events-none'))
    shells.forEach((shell) => expect(shell.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).not.toBe('true'))
    expect(document.querySelectorAll('.shadow-2xl').length).toBe(0)
  })

  it('لكل نافذة زر تصغير يُبقيها مفتوحة بلا حجب', () => {
    render(<TwoModals />)
    const minimize = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'تصغير النافذة')
    expect(minimize).toBeTruthy()
    fireEvent.click(minimize!)
    expect(document.querySelector('[data-modal-minimized="true"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-modal-id]').length).toBe(2)
  })

  it('Escape يغلق النافذة العليا وحدها لا كل النوافذ', () => {
    render(<TwoModals />)
    const layers = Array.from(document.querySelectorAll('[data-modal-id]'))
    expect(layers.length).toBe(2)
    // العليا لها عمق أكبر فتظهر فوق الأولى
    expect(Number(layers[1].getAttribute('data-modal-depth'))).toBeGreaterThan(Number(layers[0].getAttribute('data-modal-depth')))
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(document.querySelectorAll('[data-modal-id]').length).toBe(1)
    expect(document.querySelector('[data-testid="first-body"]')).toBeTruthy()
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(document.querySelectorAll('[data-modal-id]').length).toBe(0)
  })
})

describe('نافذة حركة الصنف بفلاترها (قرار المالك ⑩ي البند ⑦)', () => {
  it('تفتح فوق الفاتورة بفلتر فترة يبدأ من أول السنة المالية حتى اليوم + فلتر مخزن ونوع حركة', async () => {
    const app = useAppStore.getState()
    useAppStore.setState({ ...app, fiscalYears: [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
    act(() => { S().seed(['basic']) })
    act(() => {
      S().addItem({
        nameAr: 'زيت عباد', sku: 'OIL-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
        costMinor: 5000, stockQty: 40, priceMinor: 7000, minQty: 0, trackExpiry: false, trackSerial: false,
        warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
      })
    })
    const item = S().items.at(-1)!
    act(() => { openItemLedgerWindow(item.id, null) })
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    const filters = document.querySelector('[data-ledger-filters]') as HTMLElement
    expect(filters).toBeTruthy()
    const from = filters.querySelector('[data-ledger-from]') as HTMLInputElement
    const to = filters.querySelector('[data-ledger-to]') as HTMLInputElement
    expect(from.value).toBe('2026-01-01')
    expect(to.value).toBe(new Date().toISOString().slice(0, 10))
    expect(filters.querySelector('[data-ledger-warehouse]')).toBeTruthy()
    expect(filters.querySelector('[data-ledger-flow]')).toBeTruthy()
    expect(filters.querySelector('[data-ledger-doctype]')).toBeTruthy()
    // النافذة الأم (الفاتورة) لا تُفقد عند فتح حركة الصنف فوقها
    act(() => { openSalesInvoiceWindow(null) })
    act(() => { openItemLedgerWindow(item.id, null) })
    expect(W().windows.filter((win) => win.kind === 'sales-invoice').length).toBe(1)
    expect(W().windows.filter((win) => win.kind === 'item-ledger').length).toBe(1)
  })
})
