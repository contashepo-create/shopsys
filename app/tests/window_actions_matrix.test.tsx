/**
 * مصفوفة السلوك الشاملة للنوافذ الحرة والتبويبات (المطلب 12 — فحص منهجي لا
 * عيّنة): كل مساعد فتح الـ14 بسياقيه (من الرئيسية / بأب / ويب)، وكل إجراء في
 * windowStore لم يكن له اختبار (حركة وتحجيم، تجديد الطبقات، مصغّرة تسأل،
 * استعادة الجلسة، beforeunload، closeAll، setTabTitle، ...)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  MAX_WINDOW_TABS,
  clampRect,
  openSectionWindow,
  openSalesInvoiceWindow,
  openPurchaseInvoiceWindow,
  openItemEditorWindow,
  openItemLedgerWindow,
  openItemPricesWindow,
  openPartyEditorWindow,
  openPartyLedgerWindow,
  openProjectEditorWindow,
  openEmployeeEditorWindow,
  openProjectExpenseWindow,
  openExtractWizardWindow,
  openItemPickerWindow,
  openEntityPickerWindow,
  restoreWindowSession,
  saveWindowSession,
  useWindowStore,
  watchWindowSession,
  type AppWindow,
  type AppWindowKind,
} from '../src/ui/windows/windowStore.ts'
import { WindowTabBar } from '../src/ui/windows/WindowTabs.tsx'
import { WindowHost } from '../src/ui/windows/WindowHost.tsx'
import { registerNavigationGuard } from '../src/ui/components/navigationGuard.ts'

const W = () => useWindowStore.getState()
const SESSION_KEY = 'shopsys-window-session-v1'

function installFakeDesktop() {
  const open = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const }))
  const openSection = vi.fn(async (_input: { path: string; title: string }) => ({ ok: true as const }))
  const requestClose = vi.fn()
  const focus = vi.fn()
  const minimize = vi.fn()
  const toggleMaximize = vi.fn()
  const windows = {
    open,
    openSection,
    claim: vi.fn(async () => null),
    list: vi.fn(async () => [] as never[]),
    invokeProp: vi.fn(),
    closeSelf: vi.fn(),
    requestClose,
    focus,
    minimize,
    toggleMaximize,
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
  return { open, openSection, requestClose, focus, minimize, toggleMaximize }
}

function removeDesktop() {
  delete (window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop
}

function resetStore() {
  useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  localStorage.removeItem(SESSION_KEY)
})
afterEach(() => cleanup())
afterAll(() => {
  removeDesktop()
  localStorage.removeItem(SESSION_KEY)
})

/* ── أ: جدول قرار الفتح — كل المساعِدات الـ14 من الرئيسية على سطح المكتب ── */
type Case = { name: string; kind: AppWindowKind; free: boolean; run: () => string }

const FROM_MAIN: Case[] = [
  { name: 'openSalesInvoiceWindow', kind: 'sales-invoice', free: true, run: () => openSalesInvoiceWindow() },
  { name: 'openPurchaseInvoiceWindow', kind: 'purchase-invoice', free: true, run: () => openPurchaseInvoiceWindow() },
  { name: 'openItemPickerWindow', kind: 'item-picker', free: true, run: () => openItemPickerWindow({ items: [], onPick: () => {} }) },
  { name: 'openEntityPickerWindow', kind: 'entity-picker', free: true, run: () => openEntityPickerWindow({ entity: 'customer', onPick: () => {} }) },
  { name: 'openItemEditorWindow', kind: 'item-editor', free: false, run: () => openItemEditorWindow(1) },
  { name: 'openItemLedgerWindow', kind: 'item-ledger', free: false, run: () => openItemLedgerWindow(1) },
  { name: 'openItemPricesWindow', kind: 'item-prices', free: false, run: () => openItemPricesWindow(1) },
  { name: 'openPartyEditorWindow', kind: 'party-editor', free: false, run: () => openPartyEditorWindow('customer', 1) },
  { name: 'openPartyLedgerWindow', kind: 'party-ledger', free: false, run: () => openPartyLedgerWindow('supplier', 1) },
  { name: 'openProjectEditorWindow', kind: 'project-editor', free: false, run: () => openProjectEditorWindow(1) },
  { name: 'openEmployeeEditorWindow', kind: 'employee-editor', free: false, run: () => openEmployeeEditorWindow(1) },
  { name: 'openProjectExpenseWindow', kind: 'project-expense', free: false, run: () => openProjectExpenseWindow() },
  { name: 'openExtractWizardWindow', kind: 'extract-wizard', free: false, run: () => openExtractWizardWindow() },
]

describe('جدول قرار الفتح — من الرئيسية على سطح المكتب (13 مساعد)', () => {
  beforeEach(() => installFakeDesktop())

  it.each(FROM_MAIN)('$name → ' + 'قرار صحيح', (c) => {
    const { open } = installFakeDesktop()
    const id = c.run()
    if (c.free) {
      expect(id).toMatch(/^win-/)
      expect(open).toHaveBeenCalledTimes(1)
      expect(open.mock.calls[0][0]).toMatchObject({ kind: c.kind })
      expect(W().tabs).toHaveLength(0)
      expect(W().windows).toHaveLength(0) /* الحرة نظامية — لا نافذة داخلية */
    } else {
      expect(id).toMatch(/^tab-/)
      expect(open).not.toHaveBeenCalled()
      expect(W().tabs).toHaveLength(1)
      expect(W().tabs[0]).toMatchObject({ kind: c.kind, dirty: false, askMode: null })
      expect(W().viewActiveTabId).toBe(id)
    }
  })

  it('openSectionWindow من الرئيسية يحجز تبويب مسار ولا ينادي فتح نافذة قسم', () => {
    const { openSection } = installFakeDesktop()
    expect(openSectionWindow('/inventory/warehouses', 'المخازن')).toBe(true)
    expect(openSection).not.toHaveBeenCalled()
    expect(W().tabs[0]).toMatchObject({ path: '/inventory/warehouses' })
    expect(W().tabs[0].kind).toBeUndefined()
  })
})

/* ── ب: كل المساعِدات ذات أب (قمر) — حتى تلك التي تصير تبويباً بلا أب ── */
const PARENTED: Case[] = [
  { name: 'sales-invoice بأب', kind: 'sales-invoice', free: true, run: () => openSalesInvoiceWindow() },
  { name: 'purchase-invoice بأب', kind: 'purchase-invoice', free: true, run: () => openPurchaseInvoiceWindow() },
  { name: 'item-picker بأب', kind: 'item-picker', free: true, run: () => openItemPickerWindow({ items: [], onPick: () => {}, parentId: 'win-p' }) },
  { name: 'entity-picker بأب', kind: 'entity-picker', free: true, run: () => openEntityPickerWindow({ entity: 'customer', onPick: () => {}, parentId: 'win-p' }) },
  { name: 'item-editor بأب', kind: 'item-editor', free: true, run: () => openItemEditorWindow(1, 'win-p') },
  { name: 'item-ledger بأب', kind: 'item-ledger', free: true, run: () => openItemLedgerWindow(1, 'win-p') },
  { name: 'item-prices بأب', kind: 'item-prices', free: true, run: () => openItemPricesWindow(1, 'win-p') },
  { name: 'party-editor بأب', kind: 'party-editor', free: true, run: () => openPartyEditorWindow('customer', 1, 'win-p') },
  { name: 'party-ledger بأب', kind: 'party-ledger', free: true, run: () => openPartyLedgerWindow('supplier', 1, 'win-p') },
  { name: 'project-editor بأب', kind: 'project-editor', free: true, run: () => openProjectEditorWindow(1, 'win-p') },
  { name: 'employee-editor بأب', kind: 'employee-editor', free: true, run: () => openEmployeeEditorWindow(1, 'win-p') },
  { name: 'project-expense بأب', kind: 'project-expense', free: true, run: () => openProjectExpenseWindow(undefined, 'win-p') },
  { name: 'extract-wizard بأب', kind: 'extract-wizard', free: true, run: () => openExtractWizardWindow({ parentId: 'win-p' }) },
]

describe('جدول قرار الفتح — نافذة ابنية على سطح المكتب (13 مساعد)', () => {
  it.each(PARENTED)('$name → قمر حر لا تبويب', (c) => {
    const { open } = installFakeDesktop()
    const id = c.run()
    expect(id).toMatch(/^win-/)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatchObject({ kind: c.kind })
    expect(W().tabs).toHaveLength(0)
  })

  it('الحرة الابنية تحمل أباها في طلب الفتح (تُغلق مع أمها)', () => {
    const { open } = installFakeDesktop()
    openItemEditorWindow(5, 'win-invoice-1')
    expect(open.mock.calls[0][0]).toMatchObject({ parentId: 'win-invoice-1' })
  })
})

/* ── ج: الويب بلا جسر — كل المساعِدات تصير نافذة داخلية كما هو حرفياً ── */
describe('الويب (بلا جسر) — كل المساعِدات تفتح نافذة داخلية بنيتها الصحيحة', () => {
  beforeEach(() => removeDesktop())

  it.each([...FROM_MAIN, ...PARENTED])('$name → نافذة داخلية', (c) => {
    const id = c.run()
    expect(id).toMatch(/^win-/)
    expect(W().windows).toHaveLength(1)
    expect(W().windows[0].kind).toBe(c.kind)
    expect(W().tabs).toHaveLength(0)
  })

  it('في الويب: التكرار بالمفتاح يركّز النافذة القائمة ولا ينسخها', () => {
    const first = openItemEditorWindow(7)
    const second = openItemEditorWindow(7)
    expect(second).toBe(first)
    expect(W().windows).toHaveLength(1)
    /* وهي أعلى الطبقات أصلاً فلا رفع مكرر (بلا زحف) */
    expect(W().windows[0].z).toBe(W().topZ)
  })

  it('في الويب: openSectionWindow يرفض (لا سطح مكتب) والتبويبات لا تُفتح', () => {
    expect(openSectionWindow('/reports', 'تقارير')).toBe(false)
    expect(W().tabs).toHaveLength(0)
  })

  it('الحدود القصوى مطبّقة في الويب أيضاً: الحادي عشر تبويب مرفوض', () => {
    /* التبويبات ويب-محوراً لا تُفتح أصلاً — نُحقن الحد الأقصى ثم نجرب الفتح */
    useWindowStore.setState({
      tabs: Array.from({ length: MAX_WINDOW_TABS }, (_, index) => ({
        id: `t${index}`, path: `/p${index}`, kind: undefined, props: undefined,
        title: `ق${index}`, subtitle: '', dedupeKey: null, dirty: false, askMode: null, closePrompt: null,
      })),
    })
    expect(W().openTab({ path: '/p-extra', title: 'زائد' })).toBeNull()
  })
})

/* ── د: إجراءات التبويبات غير المختبَرة ── */
describe('إجراءات التبويبات — ما لم يُختبر من قبل', () => {
  beforeEach(() => installFakeDesktop())

  it('setTabTitle يحدّث العنوان والوصف معاً ولا يمس تبويباً غائباً', () => {
    openSectionWindow('/reports', 'التقارير')
    const id = W().tabs[0].id
    const before = W().tabs
    W().setTabTitle('غير-موجود', 'عنوان')
    expect(W().tabs).toBe(before) /* بلا تغيير = بلا إعادة رسم */
    W().setTabTitle(id, 'الميزانية', 'خلاصة سنوية')
    expect(W().tabs[0].title).toBe('الميزانية')
    expect(W().tabs[0].subtitle).toBe('خلاصة سنوية')
    W().setTabTitle(id, 'الميزانية فقط')
    expect(W().tabs[0].subtitle).toBe('خلاصة سنوية') /* الوصف يُحفظ بلا تمرير */
  })

  it('setTabDirty بالقيمة نفسها لا يُعيد بناء الحالة (حارس الرتابة)', () => {
    const id = W().openTab({ kind: 'item-editor', title: 'محرر', dedupeKey: 'item-editor:td' })!
    const before = W().tabs
    W().setTabDirty(id, false) /* بالقيمة نفسها */
    expect(W().tabs).toBe(before)
    W().setTabDirty(id, true)
    expect(W().tabs[0].dirty).toBe(true)
    const afterTrue = W().tabs
    W().setTabDirty(id, true)
    expect(W().tabs).toBe(afterTrue)
  })

  it('setTabClosePrompt بالموجّه نفسه لا يُعيد بناء الحالة', () => {
    const id = W().openTab({ kind: 'party-editor', title: 'محرر', dedupeKey: 'party-editor:cp' })!
    const prompt = { hint: 'تنبيه' }
    W().setTabClosePrompt(id, prompt)
    const after = W().tabs
    W().setTabClosePrompt(id, prompt)
    expect(W().tabs).toBe(after)
  })

  it('أفعال التنقل والإغلاق بمعرّفات غائبة كلها صامتة بلا انهيار', () => {
    openSectionWindow('/reports', 'التقارير')
    W().activateTab('tab-غير-موجود')
    W().requestCloseTab('tab-غير-موجود')
    W().closeTabNow('tab-غير-موجود')
    W().setTabDirty('tab-غير-موجود', true)
    expect(W().tabs).toHaveLength(1)
    expect(W().viewActiveTabId).toBeNull()
  })
})

/* ── هـ: إجراءات النوافذ — حركة وتحجيم وتجديد الطبقات وما لم يُختبر ── */
function makeWin(id: string, z: number, over: Partial<AppWindow> = {}): AppWindow {
  return {
    id, kind: 'party-editor', title: `ن${id}`, subtitle: '', props: {}, mode: 'normal',
    rect: { x: 40, y: 40, w: 600, h: 400 }, lastRect: { x: 40, y: 40, w: 600, h: 400 },
    z, dirty: false, parentId: null, dedupeKey: null, askingClose: false, closePrompt: null,
    ...over,
  }
}

describe('نوافذ داخلية (ويب) — حركة وتحجيم وتجديد الطبقات', () => {
  beforeEach(() => removeDesktop())

  it('moveWindow يحبس النافذة داخل حدود الشاشة من كل الجهات', () => {
    const id = W().openWindow({ kind: 'party-editor', title: 'ن' })
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = W().windows[0].rect.w
    const h = W().windows[0].rect.h
    W().moveWindow(id, vw + 5000, vh + 5000)
    let rect = W().windows[0].rect
    expect(rect.x).toBe(vw - 8 - w) /* الحافة اليمنى */
    expect(rect.y).toBe(vh - 38 - h) /* فوق شريط المهام */
    W().moveWindow(id, -9999, -9999)
    rect = W().windows[0].rect
    expect(rect.x).toBe(8)
    expect(rect.y).toBe(8) /* TOP_GUARD */
  })

  it('setWindowRect يفرض الحد الأدنى للمقاس والموضع', () => {
    const id = W().openWindow({ kind: 'party-editor', title: 'ن' })
    W().setWindowRect(id, { x: -50, y: -50, w: 10, h: 10 })
    const rect = W().windows[0].rect
    expect(rect.w).toBe(360)
    expect(rect.h).toBe(240)
    expect(rect.x).toBe(8)
    expect(rect.y).toBe(8)
    /* والحد الأقصى لا يتجاوز الشاشة */
    W().setWindowRect(id, { x: 0, y: 0, w: 99_999, h: 99_999 })
    expect(W().windows[0].rect.w).toBeLessThanOrEqual(window.innerWidth - 16)
  })

  it('focusWindow يرفع النافذة إلى قمة الطبقات', () => {
    const a = W().openWindow({ kind: 'party-editor', title: 'أ' })
    const b = W().openWindow({ kind: 'party-editor', title: 'ب' })
    expect(W().windows.find((win) => win.id === b)!.z).toBe(W().topZ)
    W().focusWindow(a)
    expect(W().windows.find((win) => win.id === a)!.z).toBe(W().topZ)
    expect(W().topZ).toBeGreaterThan(701)
  })

  it('تجاوز القمة (z > 899) يُعيد ترقيم كل الطبقات بلا فقدان الأسبقية', () => {
    const olds = Array.from({ length: 8 }, (_, index) => makeWin(`old${index}`, 892 + index))
    useWindowStore.setState({ windows: olds, topZ: 899 })
    const id = W().openWindow({ kind: 'party-editor', title: 'جديد' })
    const all = W().windows
    expect(all).toHaveLength(9)
    expect(all.every((win) => win.z >= 701 && win.z <= 899)).toBe(true)
    expect(W().topZ).toBe(709)
    expect(all.find((win) => win.id === id)!.z).toBe(709) /* الأحدث أعلى */
    /* الأقدم يبقى أقدم نسبياً: old0 z=701 ... old7 z=708 */
    expect(all.find((win) => win.id === 'old0')!.z).toBe(701)
    expect(all.find((win) => win.id === 'old7')!.z).toBe(708)
  })

  it('requestCloseWindow على مصغّرة متسخة: تستعاد أولاً ثم يظهر حوار التأكيد فوقها', () => {
    const id = W().openWindow({ kind: 'sales-invoice', title: 'فاتورة' })
    W().setWindowDirty(id, true)
    W().minimizeWindow(id)
    expect(W().windows[0].mode).toBe('minimized')
    W().requestCloseWindow(id)
    expect(W().windows[0].mode).toBe('normal') /* الاستعادة أولاً */
    expect(W().windows[0].askingClose).toBe(true)
    /* والإلغاء يُخمّد الحوار دون إغلاق */
    W().cancelCloseWindow(id)
    expect(W().windows[0].askingClose).toBe(false)
    expect(W().windows).toHaveLength(1)
  })

  it('discardAndCloseWindow ينفّذ تنظيف الصفحة ثم يغلق في كل الأحوال (لو فشل التنظيف)', () => {
    const id = W().openWindow({ kind: 'sales-invoice', title: 'فاتورة' })
    W().setWindowClosePrompt(id, { onDiscard: () => { throw new Error('قرص ممتلئ') } })
    W().discardAndCloseWindow(id)
    expect(W().windows).toHaveLength(0) /* الخطأ لا يُبطل الإغلاق المؤكد */
    const id2 = W().openWindow({ kind: 'sales-invoice', title: 'فاتورة2' })
    const cleanup = vi.fn()
    W().setWindowClosePrompt(id2, { onDiscard: cleanup })
    W().discardAndCloseWindow(id2)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(W().windows).toHaveLength(0)
  })

  it('closeAll يفرغ المخزن (إجراء الواجهة الكامل)', () => {
    W().openWindow({ kind: 'party-editor', title: 'أ' })
    W().openWindow({ kind: 'sales-invoice', title: 'ب' })
    expect(W().windows).toHaveLength(2)
    W().closeAll()
    expect(W().windows).toHaveLength(0)
  })

  it('minimize/toggleMaximize/restore على نوافذ داخلية متتابعة', () => {
    const id = W().openWindow({ kind: 'party-editor', title: 'ن' })
    W().minimizeWindow(id)
    expect(W().windows[0].mode).toBe('minimized')
    W().toggleMaximizeWindow(id)
    expect(W().windows[0].mode).toBe('maximized')
    W().toggleMaximizeWindow(id)
    expect(W().windows[0].mode).toBe('normal')
    W().restoreWindow(id)
    expect(W().windows[0].mode).toBe('normal')
    expect(W().windows[0].z).toBe(W().topZ)
  })

  it('clampRect مُصدَّر ومتسق مع دلوك الحركة', () => {
    const rect = clampRect({ x: -100, y: -100, w: 10, h: 10 })
    expect(rect).toEqual({ x: 8, y: 8, w: 360, h: 240 })
  })
})

/* ── و: beforeunload — تنبيه إغلاق التطبيق أثناء تبويب متسخ ── */
describe('beforeunload مع تبويب متسخ (سطح المكتب)', () => {
  it('التبويب المتسخ يمنع إغلاق الصفحة، ونزول العلامة يفك التنبيه', () => {
    installFakeDesktop()
    const id = W().openTab({ kind: 'item-editor', title: 'محرر', dedupeKey: 'item-editor:unload' })!
    W().setTabDirty(id, true)
    render(<MemoryRouter><WindowTabBar /></MemoryRouter>)
    const first = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    /* نزول العلامة: أثر التأثير يزيل المستمع */
    act(() => { W().setTabDirty(id, false) })
    const second = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it('بلا تبويبات متسخة لا يُسجَّل تنبيه أصلاً', () => {
    installFakeDesktop()
    W().openTab({ kind: 'item-editor', title: 'محرر', dedupeKey: 'item-editor:clean' })
    render(<MemoryRouter><WindowTabBar /></MemoryRouter>)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

/* ── ز: شريط المهام واختصارات إدارة النوافذ (ويب — نوافذ داخلية) ── */
describe('شريط المهام واختصارات Ctrl+Alt (نوافذ داخلية)', () => {
  beforeEach(() => removeDesktop())

  it('Ctrl+Alt+W يتنقل دورة بين النوافذ المفتوحة', () => {
    const a = W().openWindow({ kind: 'party-editor', title: 'أ' })
    const b = W().openWindow({ kind: 'sales-invoice', title: 'ب' })
    expect(W().windows.find((win) => win.id === b)!.z).toBe(W().topZ)
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'w' })
    expect(W().windows.find((win) => win.id === a)!.z).toBe(W().topZ) /* التالية في الدورة */
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'w' })
    expect(W().windows.find((win) => win.id === b)!.z).toBe(W().topZ)
  })

  it('Ctrl+Alt+2 يقفز للنافذة الثانية في الترتيب', () => {
    W().openWindow({ kind: 'party-editor', title: 'أ' })
    const b = W().openWindow({ kind: 'sales-invoice', title: 'ب' })
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: '2' })
    expect(W().windows.find((win) => win.id === b)!.z).toBe(W().topZ)
  })

  it('Ctrl+Alt+M يصغّر العليا وCtrl+Alt+↑ يعيد تكبيرها', () => {
    const id = W().openWindow({ kind: 'party-editor', title: 'ن' })
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'm' })
    expect(W().windows[0].mode).toBe('minimized')
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'ArrowUp' })
    /* المصغَّرة ليست «العليا» في الشريط المرئي — نستعيدها من المهمة ثم نكبّر */
    W().restoreWindow(id)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'ArrowUp' })
    expect(W().windows[0].mode).toBe('maximized')
  })

  it('Ctrl+Alt+Q: نظيفة تُغلق فوراً ومتسخة تسأل وتبقى', () => {
    W().openWindow({ kind: 'party-editor', title: 'نظيفة' })
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'q' })
    expect(W().windows).toHaveLength(0)
    const dirty = W().openWindow({ kind: 'sales-invoice', title: 'متسخة' })
    W().setWindowDirty(dirty, true)
    fireEvent.keyDown(document, { ctrlKey: true, altKey: true, key: 'q' })
    expect(W().windows).toHaveLength(1)
    expect(W().windows[0].askingClose).toBe(true)
  })

  it('شريط المهام: نقر المهمة تركّز/تستعيد، وزر ✕ يغلق أو يسأل', () => {
    const a = W().openWindow({ kind: 'party-editor', title: 'أ' })
    const b = W().openWindow({ kind: 'sales-invoice', title: 'ب' })
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    fireEvent.click(document.querySelector(`[data-window-task="${a}"] button`)!)
    expect(W().windows.find((win) => win.id === a)!.z).toBe(W().topZ)
    /* إغلاق نظيفة من الشريط */
    fireEvent.click(document.querySelector(`[data-window-task="${a}"] .app-window-task-close`)!)
    expect(W().windows.find((win) => win.id === a)).toBeUndefined()
    /* متسخة: يسأل ولا يغلق */
    W().setWindowDirty(b, true)
    fireEvent.click(document.querySelector(`[data-window-task="${b}"] .app-window-task-close`)!)
    expect(W().windows).toHaveLength(1)
    expect(W().windows[0].askingClose).toBe(true)
    expect(document.querySelector('[data-window-close-confirm]')).toBeTruthy()
  })

  it('حوار النافذة المصغَّرة يظهر فعلياً في DOM بعد الاستعادة', () => {
    const id = W().openWindow({ kind: 'sales-invoice', title: 'فاتورة' })
    W().setWindowDirty(id, true)
    W().minimizeWindow(id)
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    expect(document.querySelector('[data-window-close-confirm]')).toBeNull() /* المصغَّرة بلا حوار بعد */
    act(() => { W().requestCloseWindow(id) })
    expect(document.querySelector('[data-window-close-confirm]')).toBeTruthy()
  })
})

/* ── ح: استعادة جلسة النوافذ (طلب المالك) ── */
describe('حفظ واستعادة جلسة النوافذ', () => {
  beforeEach(() => removeDesktop())

  it('المشترك يحفظ القابلة للاستعادة فقط ويستعيدها بنفس مقاسها وموضعها', () => {
    const stop = watchWindowSession()
    const inv = W().openWindow({ kind: 'sales-invoice', title: 'فاتورة بيع' })
    W().setWindowRect(inv, { x: 60, y: 70, w: 800, h: 500 })
    W().openWindow({ kind: 'item-editor', title: 'محرر صنف', props: { itemId: 9 } })
    W().minimizeWindow(inv)
    W().openWindow({ kind: 'entity-picker', title: 'منتقي' }) /* غير قابل للاستعادة */
    const rows = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '[]') as Array<{ kind: AppWindowKind }>
    expect(rows.map((row) => row.kind).sort()).toEqual(['item-editor', 'sales-invoice'])
    stop()
    resetStore()

    const restored = restoreWindowSession()
    expect(restored).toBe(2)
    const kinds = W().windows.map((win) => win.kind).sort()
    expect(kinds).toEqual(['item-editor', 'sales-invoice'])
    const restoredInv = W().windows.find((win) => win.kind === 'sales-invoice')!
    expect(restoredInv.mode).toBe('normal') /* المصغَّرة تعود ظاهرة */
    expect(restoredInv.rect).toEqual({ x: 60, y: 70, w: 800, h: 500 })
    expect(W().windows.find((win) => win.kind === 'item-editor')!.props).toMatchObject({ itemId: 9 })
  })

  it('حماية: مخزون غير فارغ لا يُضاعف · جسر سطح المكتب يرفض · JSON فاسد يعود 0', () => {
    W().openWindow({ kind: 'party-editor', title: 'موجودة' })
    saveWindowSession() /* صف واحد محفوظ */
    expect(restoreWindowSession()).toBe(0) /* المخزون غير فارغ */
    resetStore()
    installFakeDesktop()
    expect(restoreWindowSession()).toBe(0) /* سطح المكتب: الأقمار لا تُستعاد داخلية */
    removeDesktop()
    localStorage.setItem(SESSION_KEY, '{فاسد')
    expect(restoreWindowSession()).toBe(0)
    localStorage.setItem(SESSION_KEY, '[]')
    expect(restoreWindowSession()).toBe(0)
    localStorage.setItem(SESSION_KEY, JSON.stringify([{ kind: 'entity-picker', title: 'مستبعد' }]))
    expect(restoreWindowSession()).toBe(0) /* ليس من القابلة للاستعادة */
  })

  it('إيقاف المشاهد يوقف الحفظ التلقائي', () => {
    const stop = watchWindowSession()
    stop()
    W().openWindow({ kind: 'sales-invoice', title: 'بعدها' })
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

/* ── ط: إدارة نوافذ القمر عبر الجسر — تمر كلها للعملية الرئيسية ── */
describe('إدارة القمر عبر الجسر (سطح المكتب)', () => {
  it('تصغير/تكبير/تركيز/غلق قمر تصل مساراتها للعملية الرئيسية', () => {
    const { requestClose, focus, minimize, toggleMaximize } = installFakeDesktop()
    const id = openItemEditorWindow(3, 'win-invoice')
    expect(W().tabs).toHaveLength(0)
    W().minimizeWindow(id)
    expect(minimize).toHaveBeenCalledWith(id)
    W().toggleMaximizeWindow(id)
    expect(toggleMaximize).toHaveBeenCalledWith(id)
    W().focusWindow(id)
    expect(focus).toHaveBeenCalledWith(id)
    W().requestCloseWindow(id) /* نظيف = غلق مباشر عبر المصافحة */
    expect(requestClose).toHaveBeenCalledWith(id)
    expect(W().windows).toHaveLength(0) /* لا نافذة داخلية للقمر */
  })

  it('setWindowDirty على قمر لا يمس مخزن النوافذ الداخلية (حالته عند قمره)', () => {
    installFakeDesktop()
    const id = openItemEditorWindow(3, 'win-invoice')
    W().setWindowDirty(id, true)
    expect(W().windows).toHaveLength(0)
    expect(W().tabs).toHaveLength(0)
  })
})

/* ── ي: مسار العنوان — تبويب → setTabTitle · نافذة داخلية → صفها ── */
describe('setWindowTitle يوجّه حسب النوع', () => {
  it('عنوان تبويب يمر لـ setTabTitle وينتفي الوصف بلا تمرير', () => {
    installFakeDesktop()
    openSectionWindow('/reports', 'التقارير')
    const id = W().tabs[0].id
    W().setWindowTitle(id, 'الميزانية', 'جديد')
    expect(W().tabs[0].title).toBe('الميزانية')
    expect(W().tabs[0].subtitle).toBe('جديد')
    W().setWindowTitle(id, 'بلا وصف')
    expect(W().tabs[0].subtitle).toBe('جديد')
  })

  it('عنوان نافذة داخلية (ويب) يحدّث صفها مباشرة', () => {
    removeDesktop()
    const id = W().openWindow({ kind: 'party-editor', title: 'قبل' })
    W().setWindowTitle(id, 'بعد', 'وصف')
    expect(W().windows[0].title).toBe('بعد')
    expect(W().windows[0].subtitle).toBe('وصف')
  })
})

/* ── خ: إغلاق تبويب مسار عبر حارس الصفحة المسجّل ── */
describe('إغلاق تبويب مسار يمر بحارس الصفحة', () => {
  it('الحارس يُستدعى بمتابعة الإغلاق — تنفيذها يغلق والامتناع يُبقي', () => {
    installFakeDesktop()
    openSectionWindow('/reports', 'التقارير')
    const id = W().tabs[0].id
    const guard = vi.fn((_continueNavigation: () => void) => { /* ينتظر قرار المستخدم */ })
    const unregister = registerNavigationGuard(guard)
    W().requestCloseTab(id)
    expect(guard).toHaveBeenCalledTimes(1)
    expect(W().tabs).toHaveLength(1) /* لم يغلق بعد — الحارس ماسك */
    guard.mock.calls[0][0]() /* المستخدم وافق على المغادرة/الإغلاق */
    expect(W().tabs).toHaveLength(0)
    unregister()
    /* بعد الإلغاء: الإغلاق يمر مباشرة */
    openSectionWindow('/parties/customers', 'العملاء')
    W().requestCloseTab(W().tabs[0].id)
    expect(W().tabs).toHaveLength(0)
  })

  it('حوار سؤال الإغلاق لا يُسقطه Escape — يُغلق بأزراره فقط (بلا ضياع صامت)', () => {
    installFakeDesktop()
    const id = W().openTab({ kind: 'item-editor', title: 'محرر', dedupeKey: 'item-editor:escape-ask' })!
    W().setTabDirty(id, true)
    W().requestCloseTab(id)
    expect(W().tabs[0].askMode).toBe('close')
    render(<MemoryRouter><WindowTabBar /></MemoryRouter>)
    expect(document.querySelector('[data-tab-close-confirm]')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-tab-close-confirm]')).toBeTruthy()
    expect(W().tabs).toHaveLength(1)
    expect(W().tabs[0].askMode).toBe('close')
    /* والزرار الوحيد لإغلاق متسخ هو التأكيد الصريح */
    fireEvent.click(document.querySelector('[data-tab-close-confirm-yes]')!)
    expect(W().tabs).toHaveLength(0)
  })
})
