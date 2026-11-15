import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { MenuBar } from '../src/ui/layout/MenuBar.tsx'

const initialApp = useAppStore.getState(), initialData = useRawDataStore.getState()
let available = 720

beforeEach(() => {
  available = 720
  const setup = { ...initialApp.setup, activityId: 'contracting', modules: ['contracting', 'inventory', 'purchases'] as typeof initialApp.setup.modules }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...initialData, currentUserId: null, branches: [], activeBranchId: null, docApprovals: [] })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-menubar-title')) return 100
    if (this.hasAttribute('data-menubar-more')) return 74
    if (this.hasAttribute('data-approvals-alert')) return 88
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('menubar-scroll')) return 0
    const outsideAlert = this.parentElement?.querySelector('[data-approvals-alert]') && !this.querySelector('[data-approvals-alert]')
    return available - (outsideAlert ? 92 : 0)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useRawDataStore.setState(initialData); useAppStore.setState(initialApp) })

const mount = () => render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)

describe('عدم فقد الأقسام عند ضيق الشريط العلوي', () => {
  it('يحجز عرض تنبيه الاعتماد قبل حساب الأقسام وزر المزيد', () => {
    useRawDataStore.setState({ docApprovals: [{ id: 1, kind: 'sale', title: 'طلب', partyName: '', amountMinor: 100, payload: '{}', requestedBy: 1, requestedByName: 'موظف', requestedAt: '2026-11-06', status: 'pending' }] })
    mount()
    const count = document.querySelectorAll('[data-menubar-title]').length
    expect(document.querySelector('[data-approvals-alert]')).toBeTruthy()
    expect(document.querySelector('[data-menubar-more]')).toBeTruthy()
    expect(count * 102 + 76 + 92).toBeLessThanOrEqual(available)
  })

  it('الأسهم تنتقل بين العناوين الظاهرة وزر المزيد لا إلى عنوان مخفي', () => {
    available = 300
    mount()
    const titles = document.querySelectorAll<HTMLButtonElement>('[data-menubar-title]')
    expect(titles).toHaveLength(2)
    fireEvent.click(titles[1])
    fireEvent.keyDown(screen.getByRole('menubar'), { key: 'ArrowLeft' })
    const more = screen.getByRole('menuitem', { name: /المزيد/ })
    expect(document.activeElement).toBe(more)
    expect(screen.getByRole('menu', { name: 'أقسام إضافية' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menubar'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(titles[1])
  })

  it('في مساحة ضيقة جداً ينتقل حتى القسم الأول إلى المزيد ويمكن الوصول لعروض الأسعار', () => {
    available = 60
    mount()
    expect(document.querySelectorAll('[data-menubar-title]')).toHaveLength(0)
    const more = screen.getByRole('menuitem', { name: /المزيد/ })
    fireEvent.click(more)
    const overflow = screen.getByRole('menu', { name: 'أقسام إضافية' })
    expect(within(overflow).getAllByRole('menuitem', { name: 'عروض الأسعار والمناقصات' }).length).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByRole('menubar'), { key: 'ArrowLeft' })
    expect(screen.getByRole('menu', { name: 'أقسام إضافية' })).toBeTruthy()
    expect(document.activeElement).toBe(more)
  })
})
