import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useAppStore } = await import('../src/stores/app.store.ts')
const { MenuBar } = await import('../src/ui/layout/MenuBar.tsx')
const { DEFAULT_APPEARANCE, sanitizeAppearance } = await import('../src/core/appearance.ts')

beforeAll(() => {
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'متجر تجريبي', ownerName: 'محمد', features: [], modules: ['sales', 'purchases', 'inventory', 'employees'], accountingMode: 'full' },
  })
})

const openBar = (onSwitch = () => {}) => render(<MemoryRouter><MenuBar onSwitchToSidebar={onSwitch} /></MemoryRouter>)
const titles = () => Array.from(document.querySelectorAll('[data-menubar-title]')) as HTMLButtonElement[]
const menu = () => document.querySelector('[data-menubar-menu]') as HTMLElement | null

describe('شريط القوائم العلوي (نمط ويندوز / VS Code)', () => {
  it('هو نمط التنقل الافتراضي، والشريط الجانبي يبقى خياراً محفوظاً', () => {
    expect(DEFAULT_APPEARANCE.navigationMode).toBe('topbar')
    expect(sanitizeAppearance({ navigationMode: 'sidebar' }).navigationMode).toBe('sidebar')
    expect(sanitizeAppearance({}).navigationMode).toBe('topbar')
    expect(sanitizeAppearance(undefined).navigationMode).toBe('topbar')
  })

  it('يعرض عناوين الأقسام في شريط واحد بلا قوائم مفتوحة', () => {
    openBar()
    expect(document.querySelector('[role="menubar"]')).toBeTruthy()
    expect(titles().length).toBeGreaterThan(3)
    expect(menu()).toBeNull()
  })

  it('النقر يفتح قائمة منسدلة مركّبة على body بطبقة عليا، والمرور بالفأرة يبدّل القوائم', () => {
    openBar()
    const [first, second] = titles()
    fireEvent.click(first)
    const dropdown = menu()!
    expect(dropdown).toBeTruthy()
    expect(dropdown.className).toContain('layer-picker')
    expect(dropdown.parentElement).toBe(document.body) // خارج أي عنصر يمكن أن يحجبها
    expect(dropdown.querySelectorAll('[data-menubar-item]').length).toBeGreaterThan(0)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    // بعد الفتح يكفي المرور بالفأرة لتبديل القائمة — سلوك شريط قوائم ويندوز
    fireEvent.mouseEnter(second)
    expect(menu()!.getAttribute('data-menubar-menu')).toBe(second.dataset.menubarTitle)
    expect(second.getAttribute('aria-expanded')).toBe('true')
  })

  it('Escape والأسهم تعمل كقائمة حقيقية، والنقر على بند يغلق القائمة', () => {
    openBar()
    const bar = document.querySelector('[role="menubar"]') as HTMLElement
    const [first] = titles()
    fireEvent.click(first)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(menu()!.getAttribute('data-menubar-menu')).toBe(titles()[1].dataset.menubarTitle)
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(menu()!.getAttribute('data-menubar-menu')).toBe(first.dataset.menubarTitle)
    fireEvent.keyDown(bar, { key: 'Escape' })
    expect(menu()).toBeNull()
    fireEvent.click(first)
    fireEvent.click(menu()!.querySelector('[data-menubar-item]') as HTMLElement)
    expect(menu()).toBeNull()
  })

  it('زر صغير في نهاية الشريط يحوّل التنقل إلى شريط جانبي', () => {
    const spy = vi.fn()
    const view = openBar(spy)
    const button = view.container.querySelector('[data-switch-to-sidebar]') as HTMLElement
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-label')).toBe('تحويل التنقل إلى شريط جانبي')
    fireEvent.click(button)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
