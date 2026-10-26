/**
 * مبدأ «مثيل واحد لكل مفتاح» عبر تبويبات النافذة الأم ونوافذ القمر
 * (فحص عميق — المطلب 11): أربع طرق كانت تضاعف المحرر نفسه —
 *   A) قمر بنفس المفتاح قائم ← لا يُدَّخَل تبويب ثانٍ فوقه.
 *   B) نافذة قسم بنفس المسار بقيت من أيام الحد الأقصى ← التبويب الجديد يغلقها.
 *   C) تبويب بالمفتاح قائم ← طلب قمر بنفس المفتاح (أب سطح المكتب) يُفعِّل
 *      التبويب بدل فتح قمر ثانٍ.
 *   D) قمر فُتح من نافذة أخرى (عبر السجل الحي) وتحته تبويب قائم ← القمر
 *      يُغلق وتُصعَّد الأم على التبويب («التبويب يسبق القمر»).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SatelliteRegistryEntry } from '../src/data/desktopBridge.ts'

let useWindowStore: typeof import('../src/ui/windows/windowStore.ts')['useWindowStore']
let openItemEditorWindow: typeof import('../src/ui/windows/windowStore.ts')['openItemEditorWindow']
let openSectionWindow: typeof import('../src/ui/windows/windowStore.ts')['openSectionWindow']

const spies = {
  open: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const })),
  openSection: vi.fn(async (_input: { path: string; title: string }) => ({ ok: true as const })),
  requestClose: vi.fn(),
  focus: vi.fn(),
}
let registryListener: ((entries: SatelliteRegistryEntry[]) => void) | null = null

beforeAll(async () => {
  const store = await import('../src/ui/windows/windowStore.ts')
  useWindowStore = store.useWindowStore
  openItemEditorWindow = store.openItemEditorWindow
  openSectionWindow = store.openSectionWindow
  const windows = {
    open: spies.open,
    openSection: spies.openSection,
    claim: vi.fn(async () => null),
    list: vi.fn(async () => [] as SatelliteRegistryEntry[]),
    invokeProp: vi.fn(),
    closeSelf: vi.fn(),
    requestClose: spies.requestClose,
    focus: spies.focus,
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    setTitle: vi.fn(),
    setDirty: vi.fn(),
    setRendererReady: vi.fn(),
    respondClose: vi.fn(),
    onPropInvoke: vi.fn(() => () => {}),
    onRegistry: vi.fn((listener: (entries: SatelliteRegistryEntry[]) => void) => {
      registryListener = listener
      return () => {}
    }),
    onRequestClose: vi.fn(() => () => {}),
    onNavigate: vi.fn(() => () => {}),
  }
  ;(window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop = { runtime: 'electron', windows }
  /* أول مساس بالجسر يركّب النقل ويلتقط مستمع السجل — ثم نفرغ المجلة */
  useWindowStore.getState().closeWindow('غير-موجود')
  await new Promise((resolve) => setTimeout(resolve, 0))
  registryListener?.([])
})

function registryEntry(over: Partial<SatelliteRegistryEntry>): SatelliteRegistryEntry {
  return { windowId: 'win-x', type: 'view', kind: 'item-editor', sectionPath: null, title: '', dedupeKey: null, parentId: null, dirty: false, ...over }
}

function resetStore() {
  useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
  registryListener?.([])
  vi.clearAllMocks()
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

describe('A: قمر قائم بالمفتاح يمنع تبويباً ثانياً لنفس المحرر', () => {
  it('فتح صنف من الرئيسية والمحرر مفتوح كابنة في نافذة أخرى → تركيز القمر لا تبويب', () => {
    registryListener?.([registryEntry({ windowId: 'win-child', dedupeKey: 'item-editor:5', parentId: 'win-invoice' })])
    const id = openItemEditorWindow(5)
    expect(id).toBe('win-child')
    expect(spies.focus).toHaveBeenCalledWith('win-child')
    expect(spies.open).not.toHaveBeenCalled()
    expect(useWindowStore.getState().tabs).toHaveLength(0)
  })
})

describe('B: نافذة قسم بقيت بعد الحد الأقصى → التبويب الجديد يغلقها', () => {
  it('تبويب مسار جديد لنافذة قسم مسجلة في السجل يرسل طلب إغلاقاً لها ولا يفتح نافذة', () => {
    registryListener?.([registryEntry({ windowId: 'sec-old', type: 'section', kind: null, sectionPath: '/inventory/items', dedupeKey: 'section:/inventory/items', parentId: 'main' })])
    const handled = openSectionWindow('/inventory/items?tab=1', 'الأصناف')
    expect(handled).toBe(true)
    expect(spies.requestClose).toHaveBeenCalledWith('sec-old')
    expect(spies.openSection).not.toHaveBeenCalled()
    expect(spies.open).not.toHaveBeenCalled()
    const state = useWindowStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].path).toBe('/inventory/items?tab=1')
  })
})

describe('C: تبويب قائم بالمفتاح يمنع قمراً ثانياً من طلب أب', () => {
  it('محرر مفتوح تبويباً ثم فتحه من نافذة أخرى بطلب أب → تفعيل التبويب وصعود للأمام', () => {
    const tabId = openItemEditorWindow(7)
    expect(useWindowStore.getState().tabs).toHaveLength(1)
    spies.openSection.mockClear()
    const id = openItemEditorWindow(7, 'win-parent')
    expect(id).toBe(tabId)
    expect(spies.open).not.toHaveBeenCalled()
    expect(spies.openSection).toHaveBeenCalledWith({ path: '/', title: 'الرئيسية' })
    expect(useWindowStore.getState().tabs).toHaveLength(1)
    expect(useWindowStore.getState().viewActiveTabId).toBe(tabId)
  })
})

describe('D: قمر يظهر من نافذة أخرى تحت تبويب قائم → «التبويب يسبق القمر»', () => {
  it('ظهور قمر بنفس مفتاح تبويب في السجل يغلقه ويُفعِّل التبويب', () => {
    const tabId = openItemEditorWindow(9)
    expect(useWindowStore.getState().viewActiveTabId).toBe(tabId)
    useWindowStore.setState({ viewActiveTabId: null }) /* كأن المستخدم غادر التبويب */
    registryListener?.([registryEntry({ windowId: 'win-z', dedupeKey: 'item-editor:9', parentId: 'win-other' })])
    expect(spies.requestClose).toHaveBeenCalledWith('win-z')
    expect(spies.openSection).toHaveBeenCalledWith({ path: '/', title: 'الرئيسية' })
    expect(useWindowStore.getState().viewActiveTabId).toBe(tabId)
    expect(useWindowStore.getState().tabs).toHaveLength(1)
  })

  it('ظهور قمر بلا مفتاح تبويب مطابق لا يمس شيئاً', () => {
    openItemEditorWindow(9)
    spies.requestClose.mockClear()
    registryListener?.([registryEntry({ windowId: 'win-solo', dedupeKey: 'item-editor:41' })])
    expect(spies.requestClose).not.toHaveBeenCalled()
    expect(useWindowStore.getState().tabs).toHaveLength(1)
  })
})
