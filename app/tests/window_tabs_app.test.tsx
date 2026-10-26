/**
 * أثر تبويبات النافذة الأم داخل التطبيق الفعلي <App/> (طلب المالك 2026-10-26 —
 * إعادة الفحص): يثبت قرارين لا يغطيهما اختبار المتجر وحده:
 *   • D5 «الفواتير حرة»: مسار مستند الفاتورة (/sales|purchases/invoices/new)
 *     لا يحجز تبويباً — يفتح نافذة الفاتورة الحرة ثم يعود للقائمة.
 *   • D1 ارتداد الحد الأقصى: عند10 تبويبات يفتح القسم نافذة حرة ويرتد
 *     محتوى الرئيسية للوحة التحكم حتى لا يُعرض القسم مرتين (نافذة + صفحة).
 * يركّب <App/> ببيانات النشاط التجريبي كما في all_pages_render + جسر وهمي كامل.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
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
  /* بوابة الاتفاقية مفتوحة + جلسة مصادَقة — الشل يركّب كما بعد دخول فعلي */
  const { useAppStore } = await import('../src/stores/app.store.ts')
  useAppStore.getState().acceptLegal()
  const { useSessionAuthStore } = await import('../src/data/sessionAuth.ts')
  useSessionAuthStore.setState({ authenticated: true })
  ;({ default: App } = await import('../src/App.tsx'))
}, 60_000)

/** نفس جسر النوافذ الوهمي في window_tabs — واجهة DesktopWindowsBridge كاملة */
function installFakeDesktop() {
  const open = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const }))
  const openSection = vi.fn(async (_input: { path: string; title: string }) => ({ ok: true as const }))
  const requestClose = vi.fn()
  const windows = {
    open,
    openSection,
    claim: vi.fn(async () => null),
    list: vi.fn(async () => [] as never[]),
    invokeProp: vi.fn(),
    closeSelf: vi.fn(),
    requestClose,
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
  return { open, openSection, requestClose }
}

async function clearStore() {
  const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
  useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
}

async function prefillTabs() {
  const { useWindowStore, MAX_WINDOW_TABS } = await import('../src/ui/windows/windowStore.ts')
  const tabs = Array.from({ length: MAX_WINDOW_TABS }, (_, index) => ({
    id: `prefill-${index}`,
    path: `/prefill-${index}`,
    kind: null,
    props: null,
    title: `قسم ${index}`,
    subtitle: '',
    dedupeKey: null,
    dirty: false,
    askMode: null,
    closePrompt: null,
  }))
  useWindowStore.setState({ tabs, viewActiveTabId: null, pendingPath: null, currentPath: '/' })
}

beforeEach(async () => {
  window.location.hash = '#/'
  await clearStore()
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop
  window.location.hash = '#/'
})

describe('أثر <App/> للتبويبات على سطح المكتب', () => {
  it('D5: مسار فاتورة جديدة لا يحجز تبويباً — تُفتح نافذة الفاتورة الحرة فقط', async () => {
    const { open, openSection } = installFakeDesktop()
    window.location.hash = '#/purchases/invoices/new'
    render(<App />)
    /* نافذة فاتورة حرة فُتحت فعلاً (لا تبويب يحل محلها) */
    await waitFor(() => expect(
      open.mock.calls.some((call) => call[0]?.kind === 'purchase-invoice'),
    ).toBe(true), { timeout: 10_000 })
    /* عاد للقائمة بفعل InvoiceDocumentRoute نفسه */
    await waitFor(() => expect(window.location.hash).toBe('#/purchases/invoices'), { timeout: 10_000 })
    const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
    /* ولا تبويب يحمل مسار المستند أبداً — الفواتير حرة */
    expect(useWindowStore.getState().tabs.some((tab) => (tab.path ?? '').includes('invoices/new'))).toBe(false)
    /* ومسار المستند لم يُفتح كنافذة قسم (openSection) أبداً */
    expect(openSection.mock.calls.some((call) => call[0].path.includes('invoices/new'))).toBe(false)
  })

  it('D1: عند10 تبويبات يفتح القسم نافذة حرة ويرتد محتوى الرئيسية للوحة (لا عرض مزدوج)', async () => {
    const { openSection } = installFakeDesktop()
    await prefillTabs()
    window.location.hash = '#/purchases/orders'
    render(<App />)
    await waitFor(() => expect(openSection).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/purchases/orders' }),
    ), { timeout: 10_000 })
    /* ارتداد: الرئيسية تعود للوحة التحكم بعد فتح النافذة الحرة */
    await waitFor(() => expect(window.location.hash).toBe('#/'), { timeout: 10_000 })
    const { useWindowStore, MAX_WINDOW_TABS } = await import('../src/ui/windows/windowStore.ts')
    /* لم يُحجز حادي عشر تبويب — ال10 كما هي */
    expect(useWindowStore.getState().tabs).toHaveLength(MAX_WINDOW_TABS)
    expect(useWindowStore.getState().tabs.some((tab) => tab.path === '/purchases/orders')).toBe(false)
  })

  it('D6: الاختصارات العالمية (F12 — دليل الاختصارات) تبقى حيّة أثناء عرض تبويب', async () => {
    installFakeDesktop()
    const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
    /* تبويب عرض نشط: المحتوى يُصوَّر مكان الراوتر (بلا نوع = لا شيء يُرسم،
       المهم أن الشفرة تدخل فرع viewActiveTab) */
    const tabId = useWindowStore.getState().openTab({ title: 'تبويب عرض' })
    expect(tabId).toBeTruthy()
    expect(useWindowStore.getState().viewActiveTabId).toBe(tabId)
    window.location.hash = '#/'
    render(<App />)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }))
    /* قبل الإصلاح كان KeyboardNavigation يُفكّ مع فرع التبويب فتموت الاختصارات */
    await waitFor(() => expect(document.querySelector('[data-shortcut-help]')).toBeTruthy(), { timeout: 5000 })
  })
})
