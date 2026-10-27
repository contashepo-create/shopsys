/**
 * بلاغ المالك 2026-10-27: «الانتقال من تاب لآخر يفقد بياناته» — يثبت أن
 * `<Activity>` داخل `TabRoutes` يُبقي كل تبويب مسار مركّباً، فتعود الفلاتر
 * كما كانت عند الرجوع، وأن إغلاق التاب يُفكّكه فعلاً (لا تسريب ذاكرة).
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const payloads = JSON.parse(readFileSync(join(here, '../demo-db/demo-payloads.json'), 'utf8')) as Record<string, unknown>
const payload = payloads.contracting

vi.stubGlobal('fetch', vi.fn(async (path: unknown) => {
  if (String(path).includes('/__demo/data')) return { ok: true, json: async () => payload } as unknown as Response
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
}))

beforeAll(() => { Element.prototype.scrollIntoView ||= () => {} })

let App: React.ComponentType
beforeAll(async () => {
  const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
  await loadDemoActivity('contracting')
  const { useAppStore } = await import('../src/stores/app.store.ts')
  useAppStore.getState().acceptLegal()
  const { useSessionAuthStore } = await import('../src/data/sessionAuth.ts')
  useSessionAuthStore.setState({ authenticated: true })
  ;({ default: App } = await import('../src/App.tsx'))
}, 60_000)

function installFakeDesktop() {
  const noop = vi.fn()
  const windows = {
    open: vi.fn(async () => ({ ok: true as const })), openSection: vi.fn(async () => ({ ok: true as const })),
    claim: vi.fn(async () => null), list: vi.fn(async () => [] as never[]), invokeProp: noop,
    closeSelf: noop, requestClose: noop, focus: noop, minimize: noop, toggleMaximize: noop,
    setTitle: noop, setDirty: noop, setRendererReady: noop, respondClose: noop,
    onPropInvoke: vi.fn(() => () => {}), onRegistry: vi.fn(() => () => {}),
    onRequestClose: vi.fn(() => () => {}), onNavigate: vi.fn(() => () => {}),
  }
  ;(window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop = { runtime: 'electron', windows }
}

beforeEach(async () => {
  window.location.hash = '#/'
  const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
  useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop
  window.location.hash = '#/'
})

describe('الحفاظ على حالة تبويبات المسار (Activity)', () => {
  it('① فلتر «اليوم» في مركز التقارير يبقى بعد الذهاب لتاب آخر والعودة بلا إغلاق', async () => {
    installFakeDesktop()
    window.location.hash = '#/reports'
    render(<App />)
    const todayBtn = await screen.findByRole('button', { name: 'اليوم' }, { timeout: 20_000 })
    fireEvent.click(todayBtn)
    await waitFor(() => expect(todayBtn.className).toContain('bg-sky-600'))

    const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
    await waitFor(() => expect(useWindowStore.getState().tabs.some((t) => t.path === '/reports')).toBe(true))

    window.location.hash = '#/reports/statements'
    await waitFor(() => expect(useWindowStore.getState().tabs.some((t) => t.path === '/reports/statements')).toBe(true), { timeout: 10_000 })

    const reportTab = document.querySelector('[data-window-tab="/reports"]') as HTMLElement | null
    expect(reportTab).not.toBeNull()
    fireEvent.click(reportTab!)
    await waitFor(() => expect(window.location.hash).toBe('#/reports'), { timeout: 10_000 })

    // الفلتر ما زال «اليوم» — التاب لم يُفكَّك
    const backBtn = await screen.findByRole('button', { name: 'اليوم' }, { timeout: 10_000 })
    expect(backBtn.className).toContain('bg-sky-600')
  })

  it('② كل تاب يحتفظ بنسخته المستقلة (تغيير تاب لا يغيّر الآخر)', async () => {
    installFakeDesktop()
    window.location.hash = '#/reports'
    render(<App />)
    const todayBtn = await screen.findByRole('button', { name: 'اليوم' }, { timeout: 20_000 })
    fireEvent.click(todayBtn)
    await waitFor(() => expect(todayBtn.className).toContain('bg-sky-600'))

    window.location.hash = '#/reports/statements'
    const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
    await waitFor(() => expect(useWindowStore.getState().tabs.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    // التاب الثاني له شجرة مستقلة بموقع صحيح (?kind/id لا تُقرأ من التاب الأول)
    const trees = document.querySelectorAll('[data-route-tree]')
    expect(trees.length).toBeGreaterThanOrEqual(2)
    expect([...trees].some((n) => n.getAttribute('data-route-tree') === '/reports')).toBe(true)
    expect([...trees].some((n) => n.getAttribute('data-route-tree') === '/reports/statements')).toBe(true)
  })

  it('③ إغلاق التاب يُفكّك شجرته (لا تبقى نسخة مخفية للأبد)', async () => {
    installFakeDesktop()
    window.location.hash = '#/reports'
    render(<App />)
    await screen.findByRole('button', { name: 'اليوم' }, { timeout: 20_000 })
    const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
    await waitFor(() => expect(useWindowStore.getState().tabs.some((t) => t.path === '/reports')).toBe(true))
    expect(document.querySelectorAll('[data-route-tree]').length).toBeGreaterThanOrEqual(1)

    const tab = useWindowStore.getState().tabs.find((t) => t.path === '/reports')!
    useWindowStore.getState().closeTabNow(tab.id)
    await waitFor(() => expect(document.querySelector('[data-route-tree="/reports"]')).toBeNull())
  })

  it('④ الويب بلا تبويبات: شجرة واحدة فقط (سلوك كما كان)', async () => {
    // بلا جسر سطح المكتب ⇒ isDesktopFreeWindows() خطأ
    window.location.hash = '#/reports'
    render(<App />)
    await screen.findByRole('button', { name: 'اليوم' }, { timeout: 20_000 })
    expect(document.querySelectorAll('[data-route-tree]')).toHaveLength(1)
  })
})
