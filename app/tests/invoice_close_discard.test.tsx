/**
 * إغلاق فاتورة البيع/الشراء عبر «إغلاق وحذف المسودة» (بلاغ المالك 2026-11-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * كانت نافذة الفاتورة لا تُغلق عند اختيار «إغلاق وحذف المسودة»: الحذف كان
 * يمسح المسودة فقط، بينما «حفظ كمسودة ثم الإغلاق» كان يستدعي finishDocument
 * فيُغلق. الحل: مسار الحذف ينفّذ تنظيف الصفحة ثم finishDocument (release
 * للحارس + setDirty(false) + setClosePrompt(null) + host.close())، فيُغلق في
 * كل مسارات المضيف (نافذة حرة/تبويب/قمر سطح المكتب).
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useWindowStore } from '../src/ui/windows/windowStore.ts'
import { WindowHost } from '../src/ui/windows/WindowHost.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'
import { useAppStore } from '../src/stores/app.store.ts'

beforeAll(() => {
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting', shopName: 'اختبار',
      ownerName: 'المالك', modules: ['contracting'] as never[], accountingMode: 'full', vatPercent: 14,
    },
  })
})

afterEach(() => {
  cleanup()
  useWindowStore.setState({ windows: [], tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
})

const mount = () => render(<MemoryRouter><WindowHost /><ToastHost /></MemoryRouter>)

async function openInvoice(kind: 'sales-invoice' | 'purchase-invoice', title: string) {
  const id = useWindowStore.getState().openWindow({ kind, title, props: {}, mode: 'normal', width: 1000, height: 700 })
  mount()
  const notes = await screen.findByLabelText('ملاحظات وشروط المستند', {}, { timeout: 15000 })
  fireEvent.change(notes, { target: { value: 'تعديل' } })
  await waitFor(() => expect(useWindowStore.getState().windows.find((w) => w.id === id)?.dirty).toBe(true), { timeout: 5000 })
  return id
}

describe('إغلاق الفاتورة بـ«حذف المسودة والإغلاق»', () => {
  it('فاتورة البيع: زر «إغلاق وحذف المسودة» يُغلق النافذة فعلاً', async () => {
    const id = await openInvoice('sales-invoice', 'فاتورة بيع مقاولات')
    useWindowStore.getState().requestCloseWindow(id)
    await screen.findByText('إغلاق «فاتورة بيع مقاولات»؟', {}, { timeout: 5000 })
    fireEvent.click(document.querySelector('[data-window-close-confirm-yes]') as HTMLElement)
    await waitFor(() => expect(useWindowStore.getState().windows.find((w) => w.id === id)).toBeUndefined(), { timeout: 5000 })
  })

  it('فاتورة البيع: onDiscard وحده يُغلق النافذة (تنظيف + release + close)', async () => {
    const id = await openInvoice('sales-invoice', 'فاتورة بيع مقاولات')
    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.closePrompt?.onDiscard).toBeTruthy()
    win.closePrompt!.onDiscard!()
    await waitFor(() => expect(useWindowStore.getState().windows.find((w) => w.id === id)).toBeUndefined(), { timeout: 5000 })
  })

  it('فاتورة الشراء: onDiscard وحده يُغلق النافذة', async () => {
    const id = await openInvoice('purchase-invoice', 'فاتورة مشتريات جديدة')
    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.closePrompt?.onDiscard).toBeTruthy()
    win.closePrompt!.onDiscard!()
    await waitFor(() => expect(useWindowStore.getState().windows.find((w) => w.id === id)).toBeUndefined(), { timeout: 5000 })
  })
})
