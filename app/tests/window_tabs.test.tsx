import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MAX_WINDOW_TABS, openSectionWindow, useWindowStore } from '../src/ui/windows/windowStore.ts'
import { WindowTabBar } from '../src/ui/windows/WindowTabs.tsx'

function installFakeDesktop() {
  const open = vi.fn(async () => ({ ok: true as const }))
  const openSection = vi.fn(async () => ({ ok: true as const }))
  const windows = {
    open,
    openSection,
    claim: vi.fn(async () => null),
    list: vi.fn(async () => [] as never[]),
    invokeProp: vi.fn(),
    closeSelf: vi.fn(),
    requestClose: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    setTitle: vi.fn(),
    setDirty: vi.fn(),
    setRendererReady: vi.fn(),
    respondClose: vi.fn(),
    onPropInvoke: vi.fn(() => () => {}),
    onRegistry: vi.fn(() => () => {}),
    onRequestClose: vi.fn(() => () => {}),
    onNavigate: vi.fn(() => () => {}),
  }
  ;(window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop = { runtime: 'electron', windows }
  return { open, openSection }
}

function resetStore() {
  useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  delete (window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop
  resetStore()
})

describe('تبويبات النافذة الأم', () => {
  it('القسم يفتح تبويباً داخل الرئيسية ولا ينادي فتح نافذة قسم', () => {
    const { openSection } = installFakeDesktop()
    const handled = openSectionWindow('/sales/invoices', 'فواتير البيع')
    expect(handled).toBe(true)
    expect(openSection).not.toHaveBeenCalled()
    const state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].path).toBe('/sales/invoices')
    expect(state.tabs[0].title).toBe('فواتير البيع')
    expect(state.pendingPath).toBe('/sales/invoices')
    expect(state.viewActiveTabId).toBeNull()
  })

  it('نفس المسار يركّز التبويب القائم ولا يكرره', () => {
    installFakeDesktop()
    openSectionWindow('/reports', 'التقارير')
    openSectionWindow('/reports', 'التقارير')
    const state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.pendingPath).toBe('/reports')
  })

  it('عند 10 تبويبات يعود القسم الحادي عشر نافذة قسم حرة (السلوك القديم)', () => {
    const { openSection } = installFakeDesktop()
    for (let index = 0; index < MAX_WINDOW_TABS; index += 1) {
      expect(openSectionWindow(`/path-${index}`, `قسم ${index}`)).toBe(true)
    }
    expect(useWindowStore.getState().tabs).toHaveLength(MAX_WINDOW_TABS)
    expect(openSectionWindow('/overflow', 'زائد')).toBe(true)
    expect(openSection).toHaveBeenCalledTimes(1)
    expect(openSection).toHaveBeenCalledWith({ path: '/overflow', title: 'زائد' })
    expect(useWindowStore.getState().tabs).toHaveLength(MAX_WINDOW_TABS)
  })

  it('فاتورة من الرئيسية تبقى نافذة حرة مستقلة — لا تبويب', () => {
    const { open } = installFakeDesktop()
    const id = useWindowStore.getState().openWindow({ kind: 'sales-invoice', title: 'فاتورة مبيعات جديدة' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(useWindowStore.getState().tabs).toHaveLength(0)
    expect(id).toMatch(/^win-/)
  })

  it('محرر بلا أب من الرئيسية يفتح تبويب عرض ويحفظ خصائصه (بلا IPC)', () => {
    const { open } = installFakeDesktop()
    const onPick = vi.fn()
    const id = useWindowStore.getState().openWindow({
      kind: 'item-editor',
      title: 'تعديل صنف',
      dedupeKey: 'item-editor:7',
      props: { editId: 7, onPick },
    })
    expect(open).not.toHaveBeenCalled()
    const state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].kind).toBe('item-editor')
    expect(state.viewActiveTabId).toBe(id)
    expect(state.tabs[0].props?.onPick).toBe(onPick)
    /* نفس الصنف مرة ثانية يركّز التبويب نفسه */
    useWindowStore.getState().openWindow({ kind: 'item-editor', title: 'تعديل صنف', dedupeKey: 'item-editor:7' })
    expect(useWindowStore.getState().tabs).toHaveLength(1)
  })

  it('نافذة ابنة (أبها قمر فعلي) تبقى نافذة حرة فوق الفاتورة', () => {
    const { open } = installFakeDesktop()
    useWindowStore.getState().openWindow({ kind: 'item-ledger', title: 'دفتر الصنف', parentId: 'win-child-parent' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(useWindowStore.getState().tabs).toHaveLength(0)
  })

  it('غلق تبويب مسار نشط ينتقل للجوار ثم للوحة التحكم عند آخر تبويب', () => {
    installFakeDesktop()
    openSectionWindow('/a', 'أ')
    openSectionWindow('/b', 'ب')
    const store = useWindowStore.getState()
    store.syncCurrentPath('/b')
    store.closeTabNow(store.tabs[1].id)
    let state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.pendingPath).toBe('/a')
    state.syncCurrentPath('/a')
    state.closeTabNow(state.tabs[0].id)
    state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(0)
    expect(state.pendingPath).toBe('/')
  })

  it('تبويب عرض متسخ: الإغلاق يسأل أولاً ويُلغى أو يؤكد', () => {
    installFakeDesktop()
    const id = useWindowStore.getState().openWindow({ kind: 'party-editor', title: 'محرر عميل', dedupeKey: 'party-editor:3' })
    const store = useWindowStore.getState()
    store.setWindowDirty(id, true)
    store.requestCloseTab(id)
    expect(useWindowStore.getState().tabs).toHaveLength(1)
    expect(useWindowStore.getState().tabs[0].askMode).toBe('close')
    useWindowStore.getState().cancelTabAsk()
    expect(useWindowStore.getState().tabs[0].askMode).toBeNull()
    expect(useWindowStore.getState().tabs).toHaveLength(1)
    useWindowStore.getState().requestCloseTab(id)
    useWindowStore.getState().confirmTabAsk()
    expect(useWindowStore.getState().tabs).toHaveLength(0)
  })

  it('حارس التبويب المتسخ يوقف تبديل التبويبات حتى تأكيد المغادرة', () => {
    installFakeDesktop()
    openSectionWindow('/settings/general', 'عام')
    useWindowStore.getState().setPendingPath(null)
    const viewId = useWindowStore.getState().openWindow({ kind: 'item-editor', title: 'محرر صنف', dedupeKey: 'item-editor:9' })
    useWindowStore.getState().setWindowDirty(viewId, true)
    render(<MemoryRouter><WindowTabBar /></MemoryRouter>)
    fireEvent.click(screen.getByText('عام'))
    /* الحارس يظهر حوار «مغادرة» ولا ينتقل شيء بعد */
    let state = useWindowStore.getState()
    expect(state.viewActiveTabId).toBe(viewId)
    expect(state.tabs.find((tab) => tab.id === viewId)?.askMode).toBe('switch')
    expect(state.pendingPath).toBeNull()
    expect(screen.getByRole('alertdialog', { name: 'مغادرة تبويب محرر صنف' })).toBeTruthy()
    useWindowStore.getState().confirmTabAsk()
    state = useWindowStore.getState()
    expect(state.viewActiveTabId).toBeNull()
    expect(state.pendingPath).toBe('/settings/general')
  })

  it('في الويب بلا جسر: الأقسام تنقل عادي والتبويبات لا تُفتح', () => {
    const handled = openSectionWindow('/reports', 'التقارير')
    expect(handled).toBe(false)
    expect(useWindowStore.getState().tabs).toHaveLength(0)
  })

  it('شريط التبويبات يعرض الأسماء وزر إغلاق بجانب كل اسم وينقّل بالنقر', () => {
    installFakeDesktop()
    openSectionWindow('/reports', 'التقارير')
    openSectionWindow('/parties/customers', 'العملاء')
    useWindowStore.getState().syncCurrentPath('/reports')
    render(<MemoryRouter><WindowTabBar /></MemoryRouter>)
    const bar = screen.getByRole('tablist', { name: 'التبويبات المفتوحة' })
    expect(bar).toBeTruthy()
    expect(screen.getByText('التقارير')).toBeTruthy()
    expect(screen.getByText('العملاء')).toBeTruthy()
    expect(screen.getByLabelText('إغلاق العملاء')).toBeTruthy()
    fireEvent.click(screen.getByText('العملاء'))
    expect(useWindowStore.getState().pendingPath).toBe('/parties/customers')
    fireEvent.click(screen.getByLabelText('إغلاق التقارير'))
    expect(useWindowStore.getState().tabs.map((tab) => tab.path)).toEqual(['/parties/customers'])
  })
})
