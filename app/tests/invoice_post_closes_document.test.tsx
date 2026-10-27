/**
 * بلاغ المالك (2026-10-27): «عند الضغط على حفظ وترحيل يُرحّل الفاتورة لكنها
 * لا تُغلق بل تظل مفتوحة، إلا إذا ضغطت حفظ كمسودة أولاً».
 *
 * السبب: حارس «تعديلات غير محفوظة» في `useUnsavedChangesGuard` كان يظل
 * مسجّلاً بعد نجاح الترحيل؛ `finishDocument()` كان يكتفي بـ `setDirty(false)`
 * فيمرّ إغلاق التبويب على `guardNavigation` فيُفتح حوار ويُمنع الإغلاق.
 * «حفظ مسودة» كان يُنظّف الحارس عبر `markClean()` — ولهذا كان يعمل.
 *
 * هذه الاختبارات تُثبت: (١) ترحيل فاتورة متّسخة يغلق التبويب بلا حوار،
 * (٢) نافذة ويب حرة تُغلق كذلك، (٣) مسار «حفظ مسودة ثم ترحيل» باقٍ،
 * (٤) محرر متّسخ لم يُرحَّل ما زال يسأل قبل الإغلاق.
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

const EMPTY_PARTY = {
  taxNumber: '', commercialReg: '', email: '', address: '', city: '',
  postalCode: '', buildingNo: '', nationalId: '', phone: '', creditLimitMinor: 0, notes: '',
}

beforeEach(() => {
  delete (window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop
  useWindowStore.setState({ windows: [], tabs: [], topZ: 700, viewActiveTabId: null })
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'متجر', ownerName: 'مالك', allowNegativeTreasury: true },
  })
})
afterEach(() => cleanup())

let seq = 0
function seedItem(sku: string) {
  S().addItem({
    nameAr: `صنف ${sku}`, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 100, stockQty: 50, priceMinor: 500, minQty: 0, trackExpiry: false,
    trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  } as never)
  return S().items.at(-1)!
}

function seedCustomer(nameAr: string) {
  S().addCustomer({ ...EMPTY_PARTY, nameAr } as never)
  return S().customers.at(-1)!
}

/** فاتورة مقاولات/بضاعة محضّرة مسبقاً: البنود والعميل يُعبَّآن من الواصف كما في الواقع */
async function renderInvoice(kind: 'tab' | 'window') {
  seq += 1
  const item = seedItem(`${kind}-${seq}-${Date.now().toString(36)}`)
  const customer = seedCustomer(`عميل ${kind} ${seq} ${Date.now().toString(36)}`)
  const props = { prefill: { lines: [{ itemId: item.id, qty: 1 }] } }
  let id: string
  if (kind === 'tab') {
    const { ActiveViewTab, WindowTabBar } = await import('../src/ui/windows/WindowTabs.tsx')
    id = W().openTab({ kind: 'sales-invoice', title: 'فاتورة مبيعات', props })!
    expect(id).toBeTruthy()
    render(<MemoryRouter><ActiveViewTab tab={W().tabs[0]} /><WindowTabBar /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-view-tab] .invoice-pos-root')).toBeTruthy(), { timeout: 10_000 })
  } else {
    const { openSalesInvoiceWindow } = await import('../src/ui/windows/windowStore.ts')
    const { WindowHost } = await import('../src/ui/windows/WindowHost.tsx')
    id = openSalesInvoiceWindow()
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector(`[data-app-window="${id}"] .invoice-pos-root`)).toBeTruthy(), { timeout: 10_000 })
    /* في النافذة الحرة نضيف البند من منتقي الأصناف (نفس مسار المستخدم) */
    const entry = document.querySelector('.invoice-pos-root [aria-label="اسم الصنف — اكتب أو اضغط مرتين للبحث"]') as HTMLInputElement
    fireEvent.change(entry, { target: { value: item.nameAr } })
    const itemOption = await waitFor(() => {
      const el = document.querySelector(`#invoice-item-option-${item.id}`)
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.doubleClick(itemOption)
  }
  await waitFor(() => expect(document.querySelectorAll('[data-entry-row]').length).toBe(1), { timeout: 5000 })
  /* اختيار العميل (الفاتورة المعبأة مسبقاً آجلة) + كتابة ملاحظة ⇒ مستند متّسخ */
  const customerInput = document.querySelector('[aria-label="بحث العميل — F4"]') as HTMLInputElement
  fireEvent.change(customerInput, { target: { value: customer.nameAr } })
  const option = await waitFor(() => {
    const el = document.querySelector(`[data-quick-option][data-value="${customer.id}"]`)
    expect(el).toBeTruthy()
    return el as HTMLElement
  })
  fireEvent.click(option)
  await waitFor(() => expect(document.querySelectorAll('[data-entry-row]').length).toBe(1), { timeout: 5000 })
  const notes = document.querySelector('.invoice-pos-root textarea') as HTMLTextAreaElement
  fireEvent.change(notes, { target: { value: 'ملاحظة غير محفوظة' } })
  await waitFor(() => expect(
    kind === 'tab' ? W().tabs.find((t) => t.id === id)?.dirty : W().windows.find((w) => w.id === id)?.dirty,
  ).toBe(true))
  return id
}

const postButton = () => {
  const root = document.querySelector('.invoice-pos-root') as HTMLElement
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('حفظ وترحيل'))
  return button as HTMLButtonElement
}

const isOpen = (kind: 'tab' | 'window', id: string) => kind === 'tab'
  ? W().tabs.some((t) => t.id === id)
  : W().windows.some((w) => w.id === id)

describe('إغلاق مستند الفاتورة بعد «حفظ وترحيل»', () => {
  for (const kind of ['tab', 'window'] as const) {
    it(`${kind === 'tab' ? 'تبويب' : 'نافذة حرة'}: الترحيل يُغلق المستند المتّسخ فوراً بلا حوار`, async () => {
      const id = await renderInvoice(kind)
      const before = S().sales.length
      await act(async () => { fireEvent.click(postButton()) })
      await waitFor(() => expect(S().sales.length).toBe(before + 1), { timeout: 10_000 })
      await waitFor(() => expect(isOpen(kind, id)).toBe(false), { timeout: 4000 })
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
      expect(document.body.textContent).not.toContain('تعديلات غير محفوظة')
    })
  }

  it('حفظ مسودة قبل الترحيل يبقى يعمل ولا ينشئ فاتورتين', async () => {
    const id = await renderInvoice('tab')
    const draftButton = Array.from(document.querySelectorAll('.invoice-pos-root button'))
      .find((b) => b.textContent?.includes('حفظ مسودة')) as HTMLButtonElement
    expect(draftButton).toBeTruthy()
    await act(async () => { fireEvent.click(draftButton) })
    const before = S().sales.length
    await act(async () => { fireEvent.click(postButton()) })
    await waitFor(() => expect(S().sales.length).toBe(before + 1), { timeout: 10_000 })
    await waitFor(() => expect(isOpen('tab', id)).toBe(false), { timeout: 4000 })
  })

  it('المستند المتّسخ الذي لم يُرحَّل ما زال يُسأل عند الإغلاق', async () => {
    const id = await renderInvoice('tab')
    /* إغلاق صريح من شريط التبويب — لا علاقة له بالترحيل */
    await act(async () => { W().requestCloseTab(id) })
    expect(W().tabs.find((t) => t.id === id)?.askMode).toBe('close')
    expect(isOpen('tab', id)).toBe(true)
  })
})
