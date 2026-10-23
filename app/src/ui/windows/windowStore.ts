import { create } from 'zustand'
import type { SmartEntry } from '../components/smartEntry.ts'
import { desktopWindowsBridge, type DesktopWindowsBridge, type SatelliteRegistryEntry } from '../../data/desktopBridge.ts'
import { getSelfWindowId } from './satelliteState.ts'

/**
 * نظام النوافذ المستقلة (طلب المالك):
 * ────────────────────────────────────
 * ① فاتورة البيع/الشراء تُفتح كنافذة حرة فوق الشاشة الرئيسية: تُحرَّك وتُصغَّر وتُكبَّر
 *   ولا تُغلق بالضغط في مكان فارغ — تُغلق يدوياً أو بعد الحفظ فقط.
 * ② يمكن فتح أكثر من فاتورة في وقت واحد (لكل نافذة حالتها المستقلة تماماً).
 * ③ تعديل صنف/عميل أو عرض حركته من داخل الفاتورة يفتح نافذة أخرى فوقها (ابنة)
 *   ولا يُغلق الفاتورة؛ وإغلاق الابنة يغلقها وحدها.
 */

export type AppWindowKind =
  | 'sales-invoice'
  | 'purchase-invoice'
  | 'item-picker'
  | 'item-prices'
  | 'item-editor'
  | 'item-ledger'
  | 'party-editor'
  | 'party-ledger'
  | 'project-expense'
  | 'entity-picker'
  | 'project-editor'
  | 'employee-editor'

export type AppWindowMode = 'normal' | 'maximized' | 'minimized'

export interface WindowRect { x: number; y: number; w: number; h: number }

/**
 * ما تعرضه نافذة تأكيد الإغلاق (بلاغ المالك: «لو اخترت تراجع عن التعديل أغلقها،
 * ونبّهني أن المسودة ستُحذف»). المحتوى تسجّله الصفحة نفسها لأنها وحدها تعرف
 * ماذا يُفقد: مسودة فاتورة، سطور غير محفوظة، أو تعديل على مستند مرحّل.
 */
export interface WindowClosePrompt {
  /** سطر التحذير الصريح: ماذا يُفقد بالضبط عند الإغلاق */
  hint?: string
  /** زر «احفظ ثم أغلق» — يظهر فقط إذا وفّرت الصفحة إجراء حفظ */
  saveLabel?: string
  onSave?: () => void
  /** تنظيف ما بعد الإغلاق بلا حفظ (حذف المسودة المؤقتة مثلاً) */
  onDiscard?: () => void
  /** نص زر الإغلاق بلا حفظ */
  discardLabel?: string
}

export interface AppWindow {
  id: string
  kind: AppWindowKind
  title: string
  subtitle: string
  props: Record<string, unknown>
  mode: AppWindowMode
  rect: WindowRect
  /** آخر مقاس قبل التكبير/التصغير — للعودة إليه */
  lastRect: WindowRect
  z: number
  /** فيها تعديلات غير محفوظة — الإغلاق يسأل أولاً */
  dirty: boolean
  /** النافذة الأم: إغلاق الأم يغلق بناتها، وإغلاق الابنة لا يمس الأم */
  parentId: string | null
  /** مفتاح منع التكرار: فتح نفس الصنف مرتين يركّز النافذة القائمة */
  dedupeKey: string | null
  /** حوار تأكيد الإغلاق مفتوح داخل النافذة */
  askingClose: boolean
  /** ماذا يُفقد عند الإغلاق وكيف يُحفظ — تسجّله الصفحة عبر host.setClosePrompt */
  closePrompt: WindowClosePrompt | null
}

export interface OpenWindowInput {
  /** فتح النافذة مكبَّرة من أول لحظة — الفواتير تفتح كمستند ملء الشاشة */
  mode?: AppWindowMode
  kind: AppWindowKind
  title: string
  subtitle?: string
  props?: Record<string, unknown>
  parentId?: string | null
  dedupeKey?: string | null
  width?: number
  height?: number
  /** موضع محفوظ (استعادة جلسة النوافذ) — بلا قيمة يُحسب بالتتالي */
  x?: number
  y?: number
}

const MIN_W = 360
const MIN_H = 240
const BASE_Z = 700
/**
 * سقف طبقة النوافذ. سلّم الطبقات في `index.css`:
 * نوافذ 700 < حوارات 1000 < منتقيات البحث 2000 < اعتماد المشرف 3000 < تنبيهات 4000.
 * `topZ` كان يتصاعد بلا حد مع كل فتح أو تركيز، فبعد مئات العمليات تتسلق النوافذ
 * فوق طبقة المنتقيات فتختفي نافذة بحث العميل خلف الفاتورة. نعيد الترقيم عند السقف.
 */
const MAX_WINDOW_Z = 899

/** إعادة ترقيم النوافذ بترتيب ارتفاعها الحالي داخل نطاق الطبقة، مع إبقاء `id` الأعلى فوق الكل */
function renumber(windows: AppWindow[], topId?: string): { windows: AppWindow[]; topZ: number } {
  const ordered = [...windows].sort((a, b) => (a.id === topId ? 1 : b.id === topId ? -1 : a.z - b.z))
  const renumbered = ordered.map((win, index) => ({ ...win, z: BASE_Z + 1 + index }))
  const topZ = BASE_Z + renumbered.length
  const byId = new Map(renumbered.map((win) => [win.id, win]))
  return { windows: windows.map((win) => byId.get(win.id) ?? win), topZ }
}

const viewport = () => ({
  w: typeof window === 'undefined' ? 1440 : window.innerWidth,
  h: typeof window === 'undefined' ? 900 : window.innerHeight,
})

/** مساحة العمل: أعلى الشاشة بهامش صغير، وأسفلها فوق شريط النوافذ المفتوحة */
const TOP_GUARD = 8
const TASKBAR_H = 38

export function clampRect(rect: WindowRect): WindowRect {
  const { w: vw, h: vh } = viewport()
  const maxW = Math.max(MIN_W, vw - 16)
  const maxH = Math.max(MIN_H, vh - TOP_GUARD - TASKBAR_H)
  const width = Math.max(MIN_W, Math.min(rect.w, maxW))
  const height = Math.max(MIN_H, Math.min(rect.h, maxH))
  /* النافذة تبقى كاملة داخل مساحة العمل: لا يهبط أسفلها تحت شريط النوافذ
     (كانت أزرار الحفظ في نوافذ «تعديل الصنف» تخرج من الشاشة على 1024×680). */
  const x = Math.min(Math.max(8, rect.x), Math.max(8, vw - 8 - width))
  const y = Math.min(Math.max(TOP_GUARD, rect.y), Math.max(TOP_GUARD, vh - TASKBAR_H - height))
  return { x, y, w: width, h: height }
}

function cascadeRect(count: number, width: number, height: number): WindowRect {
  const { w: vw, h: vh } = viewport()
  const w = Math.min(width, Math.max(MIN_W, vw - 32))
  const h = Math.min(height, Math.max(MIN_H, vh - 96))
  const step = 28 * (count % 6)
  return clampRect({ x: Math.max(16, (vw - w) / 2 + step - 40), y: Math.max(12, 56 + step), w, h })
}

export interface WindowStoreState {
  windows: AppWindow[]
  topZ: number
  openWindow: (input: OpenWindowInput) => string
  closeWindow: (id: string) => void
  requestCloseWindow: (id: string) => void
  cancelCloseWindow: (id: string) => void
  closeAll: () => void
  focusWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  toggleMaximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  moveWindow: (id: string, x: number, y: number) => void
  setWindowRect: (id: string, rect: WindowRect) => void
  setWindowDirty: (id: string, dirty: boolean) => void
  setWindowClosePrompt: (id: string, prompt: WindowClosePrompt | null) => void
  /** إغلاق بلا حفظ: ينفّذ تنظيف الصفحة (حذف المسودة) ثم يغلق */
  discardAndCloseWindow: (id: string) => void
  setWindowTitle: (id: string, title: string, subtitle?: string) => void
}

/* ─── نقل النوافذ الحرة لسطح المكتب (قرار المالك 2026-10-22) ───────────────
   على سطح المكتب فقط: openWindow لا يرسم نافذة عائمة داخلية بل يطلب من
   العملية الرئيسية نافذة نظام حرة (satelliteWindows.ts). الدوال في الخصائص
   (onPick/onSaved…) لا تعبر IPC — تُسجَّل هنا برقم الطلب، والقمر يستدعيها
   عبر قناة prop-invoke فتُنفَّذ عند أمّها كأنها محلية. في الويب لا جسر،
   فيبقى كل هذا خاملاً والمسار الداخلي كما هو حرفياً. */
type PropFn = (...args: unknown[]) => unknown
const pendingCallbacks = new Map<string, Record<string, PropFn>>() // requestId → ردود النداء
const satelliteByDedupe = new Map<string, string>() // dedupeKey → windowId
const satelliteIds = new Map<string, string | null>() // windowId → requestId
let transportInstalled = false

function syncSatelliteMirror(entries: SatelliteRegistryEntry[]): void {
  const alive = new Set<string>()
  satelliteByDedupe.clear()
  for (const entry of entries) {
    alive.add(entry.windowId)
    if (entry.dedupeKey) satelliteByDedupe.set(entry.dedupeKey, entry.windowId)
    if (!satelliteIds.has(entry.windowId)) satelliteIds.set(entry.windowId, null)
  }
  for (const [id, requestId] of [...satelliteIds]) {
    if (!alive.has(id)) {
      satelliteIds.delete(id)
      if (requestId) pendingCallbacks.delete(requestId)
    }
  }
}

function installDesktopTransport(bridge: DesktopWindowsBridge): void {
  if (transportInstalled) return
  transportInstalled = true
  bridge.onPropInvoke(({ requestId, prop, args }) => {
    const fn = pendingCallbacks.get(requestId)?.[prop]
    if (!fn) return
    try { fn(...(Array.isArray(args) ? args : [])) } catch { /* خطأ في رد النداء عند الصفحة لا يكسر القناة */ }
  })
  bridge.onRegistry(syncSatelliteMirror)
  void bridge.list().then(syncSatelliteMirror).catch(() => undefined)
}

function desktopBridge(): DesktopWindowsBridge | null {
  const bridge = desktopWindowsBridge()
  if (bridge) installDesktopTransport(bridge)
  return bridge
}

/** جسر صالح للتعامل مع هذا المعرّف كنافذة نظام (قمر معروف أو نافذتي نفسها) */
function satelliteBridgeFor(id: string): DesktopWindowsBridge | null {
  const bridge = desktopBridge()
  if (!bridge) return null
  return satelliteIds.has(id) || id === getSelfWindowId() ? bridge : null
}

function newWindowId(): string {
  return `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function openSatelliteWindow(bridge: DesktopWindowsBridge, input: OpenWindowInput): string {
  if (input.dedupeKey) {
    const existingId = satelliteByDedupe.get(input.dedupeKey)
    if (existingId) { bridge.focus(existingId); return existingId }
  }
  const id = newWindowId()
  const requestId = `req-${id}`
  const fns: Record<string, PropFn> = {}
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.props ?? {})) {
    if (typeof value === 'function') {
      /* itemMeta/amountLabel دوال عرض متزامنة تُستدعى أثناء الرسم — لا يمكن
         تمريرها عبر IPC؛ نافذة القمر تبني افتراضيات مكافئة من متجرها الحي */
      if (input.kind === 'item-picker' && (key === 'itemMeta' || key === 'amountLabel')) continue
      fns[key] = value as PropFn
    } else if (input.kind === 'item-picker' && key === 'items') {
      /* قائمة الأصناف ضخمة والقمر يملك المتجر كاملاً — علامة بدل النسخ */
      props.itemsFromStore = true
    } else {
      props[key] = value
    }
  }
  const hasCallbacks = Object.keys(fns).length > 0
  if (hasCallbacks) pendingCallbacks.set(requestId, fns)
  satelliteIds.set(id, hasCallbacks ? requestId : null)
  if (input.dedupeKey) satelliteByDedupe.set(input.dedupeKey, id)
  void bridge.open({
    windowId: id,
    kind: input.kind,
    title: input.title,
    subtitle: input.subtitle ?? '',
    props,
    callbackNames: Object.keys(fns),
    requestId,
    parentId: input.parentId ?? getSelfWindowId(),
    dedupeKey: input.dedupeKey ?? null,
    width: input.width ?? 1180,
    height: input.height ?? 760,
    mode: input.mode ?? 'normal',
  }).catch(() => { /* العملية الرئيسية تسجّل الفشل — لا حالة محلية تُفقد */ })
  return id
}

/**
 * فتح قسم كنافذة نظام حرة (نسخة واحدة لكل مسار — قرار المالك).
 * يعيد true إذا تولّى سطح المكتب الفتح؛ في الويب false فيتنقل المستدعي داخلياً.
 */
export function openSectionWindow(path: string, title: string): boolean {
  const bridge = desktopBridge()
  if (!bridge || !path || path === '/') return false
  void bridge.openSection({ path, title }).catch(() => undefined)
  return true
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: [],
  topZ: BASE_Z,
  openWindow: (input) => {
    const bridge = desktopBridge()
    if (bridge) return openSatelliteWindow(bridge, input)
    const state = get()
    if (input.dedupeKey) {
      const existing = state.windows.find((win) => win.dedupeKey === input.dedupeKey)
      if (existing) { get().focusWindow(existing.id); return existing.id }
    }
    const id = newWindowId()
    const rect = input.x != null && input.y != null
      ? clampRect({ x: input.x, y: input.y, w: input.width ?? 1180, h: input.height ?? 760 })
      : cascadeRect(state.windows.length, input.width ?? 1180, input.height ?? 760)
    const z = state.topZ + 1
    const win: AppWindow = {
      id,
      kind: input.kind,
      title: input.title,
      subtitle: input.subtitle ?? '',
      props: input.props ?? {},
      mode: input.mode ?? 'normal',
      rect,
      lastRect: rect,
      z,
      dirty: false,
      parentId: input.parentId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      askingClose: false,
      closePrompt: null,
    }
    const opened = [...state.windows, win]
    set(z > MAX_WINDOW_Z ? renumber(opened, id) : { windows: opened, topZ: z })
    return id
  },
  closeWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.requestClose(id); return }
    set((state) => {
      const doomed = new Set<string>([id])
      // إغلاق الأم يغلق بناتها فقط — لا شيء غيرها
      let grew = true
      while (grew) {
        grew = false
        for (const win of state.windows) {
          if (!doomed.has(win.id) && win.parentId && doomed.has(win.parentId)) { doomed.add(win.id); grew = true }
        }
      }
      return { windows: state.windows.filter((win) => !doomed.has(win.id)) }
    })
  },
  requestCloseWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.requestClose(id); return }
    const win = get().windows.find((row) => row.id === id)
    if (!win) return
    if (!win.dirty) { get().closeWindow(id); return }
    /* بلاغ المالك: إغلاق نافذة «مصغَّرة» من شريط المهام لم يكن يظهر حوار
       التأكيد لأن حوار الإغلاق يُرسم داخل النافذة نفسها — والمصغَّرة غير
       مرسومة أصلاً. الحل: تُستعاد النافذة أولاً (تُرفع للأمام وحدها ولا
       تُمس بقية النوافذ المفتوحة) ثم يظهر حوار تأكيدها فوقها مباشرة. */
    if (win.mode === 'minimized') get().focusWindow(id)
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, mode: row.mode === 'minimized' ? 'normal' : row.mode, askingClose: true } : row)) }))
  },
  setWindowClosePrompt: (id, prompt) => {
    set((state) => (state.windows.some((row) => row.id === id && row.closePrompt !== prompt)
      ? { windows: state.windows.map((row) => (row.id === id ? { ...row, closePrompt: prompt } : row)) }
      : state))
  },
  discardAndCloseWindow: (id) => {
    const win = get().windows.find((row) => row.id === id)
    win?.closePrompt?.onDiscard?.()
    get().closeWindow(id)
  },
  cancelCloseWindow: (id) => {
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, askingClose: false } : row)) }))
  },
  closeAll: () => set({ windows: [] }),
  focusWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.focus(id); return }
    const state = get()
    const win = state.windows.find((row) => row.id === id)
    if (!win) return
    if (win.z === state.topZ && win.mode !== 'minimized') return
    const z = state.topZ + 1
    const raised = state.windows.map((row) => (row.id === id ? { ...row, z, mode: row.mode === 'minimized' ? 'normal' : row.mode } : row))
    set(z > MAX_WINDOW_Z ? renumber(raised, id) : { topZ: z, windows: raised })
  },
  minimizeWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.minimize(id); return }
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, mode: 'minimized' } : row)) }))
  },
  toggleMaximizeWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.toggleMaximize(id); return }
    set((state) => ({
      windows: state.windows.map((row) => {
        if (row.id !== id) return row
        if (row.mode === 'maximized') return { ...row, mode: 'normal', rect: clampRect(row.lastRect) }
        return { ...row, mode: 'maximized', lastRect: row.rect }
      }),
    }))
  },
  restoreWindow: (id) => {
    const sat = satelliteBridgeFor(id)
    if (sat) { sat.focus(id); return }
    get().focusWindow(id)
    set((state) => ({ windows: state.windows.map((row) => (row.id === id && row.mode === 'minimized' ? { ...row, mode: 'normal' } : row)) }))
  },
  moveWindow: (id, x, y) => {
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, rect: clampRect({ ...row.rect, x, y }) } : row)) }))
  },
  setWindowRect: (id, rect) => {
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, rect: clampRect(rect), lastRect: clampRect(rect) } : row)) }))
  },
  setWindowDirty: (id, dirty) => {
    if (id === getSelfWindowId()) desktopBridge()?.setDirty(dirty)
    set((state) => (state.windows.some((row) => row.id === id && row.dirty !== dirty)
      ? { windows: state.windows.map((row) => (row.id === id ? { ...row, dirty } : row)) }
      : {}))
  },
  setWindowTitle: (id, title, subtitle) => {
    if (id === getSelfWindowId()) desktopBridge()?.setTitle(title)
    set((state) => ({ windows: state.windows.map((row) => (row.id === id ? { ...row, title, subtitle: subtitle ?? row.subtitle } : row)) }))
  },
}))

/* ─── مساعدات فتح جاهزة تُستعمل من أي شاشة ─── */

/** مقاس الفاتورة الحرة: تملأ الشاشة إلا هامشاً يُظهر أنها نافذة تُحرَّك وتُصغَّر */
function invoiceWindowSize() {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight
  return { width: Math.max(MIN_W, Math.round(vw * 0.94)), height: Math.max(MIN_H, Math.round(vh * 0.9)) }
}

/** تعبئة أولية لفاتورة بيع (طلب المالك ㉘): بيع أصناف منتهية الصلاحية من شاشة الإتلاف —
 *  §94: ربط المشروع والعميل مسبقاً من مركز فواتير المقاولات (lines تصبح اختيارية: فاتورة مشروع قد تبدأ فارغة) */
export interface SalesInvoicePrefill {
  lines?: { itemId: number; qty: number; unitPriceMinor?: number }[]
  notes?: string
  /** مشروع المقاولات الذي صُدرت الفاتورة من أجله — 0/undefined = بلا مشروع */
  projectId?: number
  /** عميل الفاتورة (يُشتق من عميل المشروع إن لم يُحدد) */
  customerId?: number
}

export function openSalesInvoiceWindow(editId?: number, prefill?: SalesInvoicePrefill) {
  return useWindowStore.getState().openWindow({
    kind: 'sales-invoice',
    title: editId ? `تعديل فاتورة مبيعات #${editId}` : prefill?.projectId ? 'فاتورة بيع مقاولات — مربوطة بمشروع' : prefill ? 'فاتورة مبيعات — أصناف محددة' : 'فاتورة مبيعات جديدة',
    subtitle: 'نافذة مستقلة — تبقى مفتوحة حتى تحفظها أو تغلقها',
    props: editId ? { editId } : prefill ? { prefill } : {},
    dedupeKey: editId ? `sales-invoice:${editId}` : null,
    /* نافذة حرة لا صفحة ملتصقة (بلاغ المالك): تفتح بإطار نافذة كامل يُحرَّك ويُكبَّر
       ويُصغَّر، ويمكن فتح فاتورة أخرى فوقها وحفظ الاثنتين. */
    mode: 'normal',
    ...invoiceWindowSize(),
  })
}

export function openPurchaseInvoiceWindow(editId?: number, prefill?: PurchaseInvoicePrefill) {
  return useWindowStore.getState().openWindow({
    kind: 'purchase-invoice',
    title: editId ? `تعديل فاتورة مشتريات #${editId}` : prefill ? 'فاتورة مشتريات — من أمر شراء' : 'فاتورة مشتريات جديدة',
    subtitle: 'نافذة مستقلة — تبقى مفتوحة حتى تحفظها أو تغلقها',
    props: editId ? { editId } : prefill ? { prefill } : {},
    dedupeKey: editId ? `purchase-invoice:${editId}` : null,
    mode: 'normal',
    ...invoiceWindowSize(),
  })
}

/**
 * تعبئة أولية لفاتورة مشتريات (مراجعة المالك 2026-10-01): زر «فاتورة استلام»
 * في شاشة أوامر الشراء يفتح الفاتورة معبَّأة من الأمر مباشرة بدل التنقل الفارغ.
 */
export interface PurchaseInvoicePrefill {
  purchaseOrderId: number
}

export function openItemEditorWindow(itemId: number, parentId?: string | null) {
  return useWindowStore.getState().openWindow({
    kind: 'item-editor', title: 'تعديل صنف', subtitle: 'يفتح فوق الفاتورة دون إغلاقها',
    props: { itemId }, parentId: parentId ?? null, dedupeKey: `item-editor:${itemId}`, width: 760, height: 620,
  })
}

export function openItemLedgerWindow(itemId: number, parentId?: string | null) {
  return useWindowStore.getState().openWindow({
    kind: 'item-ledger', title: 'حركة صنف', subtitle: 'كارت الحركة بالوارد والمنصرف',
    props: { itemId }, parentId: parentId ?? null, dedupeKey: `item-ledger:${itemId}`, width: 880, height: 640,
  })
}

/**
 * نافذة اختيار الصنف: تُفتح من خلية اسم الصنف فتصير أماً لنوافذ التعديل/الحركة/
 * الأسعار، فإغلاق أي منها يعيدك إليها بدل أن يبتلعها (بلاغ المالك).
 */
export function openItemPickerWindow(input: {
  parentId?: string | null
  initialQuery?: string
  items: unknown
  itemMeta?: unknown
  categories?: unknown
  amountLabel?: unknown
  onCreate?: unknown
  onPick: (id: number, smart?: SmartEntry) => void
}) {
  return useWindowStore.getState().openWindow({
    kind: 'item-picker',
    title: 'اختيار صنف',
    subtitle: 'ابحث بالاسم أو الكود — التعديل والحركة والأسعار تفتح فوقها',
    props: {
      initialQuery: input.initialQuery ?? '',
      items: input.items,
      itemMeta: input.itemMeta,
      categories: input.categories,
      amountLabel: input.amountLabel,
      onCreate: input.onCreate,
      onPick: input.onPick,
    },
    parentId: input.parentId ?? null,
    dedupeKey: input.parentId ? `item-picker:${input.parentId}` : null,
    width: 860,
    height: 560,
  })
}

/** أسعار الصنف: القطاعي والتكلفة والهامش وقوائم الأسعار وخصومات الفئات وآخر شراء */
export function openItemPricesWindow(itemId: number, parentId?: string | null) {
  return useWindowStore.getState().openWindow({
    kind: 'item-prices', title: 'أسعار الصنف', subtitle: 'القطاعي والتكلفة والهامش وقوائم الأسعار',
    props: { itemId }, parentId: parentId ?? null, dedupeKey: `item-prices:${itemId}`, width: 820, height: 600,
  })
}

export function openPartyEditorWindow(kind: 'customer' | 'supplier', partyId: number, parentId?: string | null, onSaved?: (partyId: number) => void) {
  const isNew = partyId === 0
  return useWindowStore.getState().openWindow({
    kind: 'party-editor',
    title: isNew ? (kind === 'customer' ? 'عميل جديد' : 'مورد جديد') : (kind === 'customer' ? 'تعديل عميل' : 'تعديل مورد'),
    subtitle: isNew ? 'إضافة سريعة — تعود بك إلى نافذتك وتُختار تلقائياً' : 'تعديل سريع بلا مغادرة الفاتورة',
    props: { partyKind: kind, partyId, ...(onSaved ? { onSaved } : {}) }, parentId: parentId ?? null,
    dedupeKey: isNew ? null : `party-editor:${kind}:${partyId}`, width: 820, height: 640,
  })
}

export type EntityPickerKind = 'customer' | 'supplier' | 'employee' | 'project'

const ENTITY_PICKER_TITLES: Record<EntityPickerKind, string> = {
  customer: 'اختيار عميل',
  supplier: 'اختيار مورد / جهة',
  employee: 'اختيار موظف',
  project: 'اختيار مشروع',
}

/**
 * المنتقي الحي (طلب المالك — بند ٩): نافذة بحث حية بنفس تصميم منتقي الأصناف
 * للعملاء والموردين والموظفين والمشاريع — الإنشاء السريع والتعديل وكشف الحساب
 * تفتح بنوافذ ابنة فوقها وتعود إليها، والحفظ في الابنة يختار ويرجع بالأم.
 */
export function openEntityPickerWindow(input: {
  entity: EntityPickerKind
  parentId?: string | null
  initialQuery?: string
  onPick: (id: number) => void
}) {
  return useWindowStore.getState().openWindow({
    kind: 'entity-picker',
    title: ENTITY_PICKER_TITLES[input.entity],
    subtitle: 'بحث حي — إنشاء وتعديل في نوافذ ابنة بلا مغادرة مكانك',
    props: { entity: input.entity, initialQuery: input.initialQuery ?? '', onPick: input.onPick },
    parentId: input.parentId ?? null,
    dedupeKey: input.parentId ? `entity-picker:${input.parentId}:${input.entity}` : `entity-picker:${input.entity}`,
    width: 860,
    height: 560,
  })
}

/** مشروع جديد/تعديل سريع — نافذة ابنة للمنتقي أو لأي نافذة أم */
export function openProjectEditorWindow(projectId: number, parentId?: string | null, onSaved?: (projectId: number) => void) {
  const isNew = projectId === 0
  return useWindowStore.getState().openWindow({
    kind: 'project-editor',
    title: isNew ? 'مشروع جديد' : 'تعديل مشروع',
    subtitle: isNew ? 'إنشاء سريع — يعود بك إلى نافذتك ويُختار تلقائياً' : 'تعديل سريع بلا مغادرة فاتورتك',
    props: { projectId, ...(onSaved ? { onSaved } : {}) }, parentId: parentId ?? null,
    dedupeKey: isNew ? null : `project-editor:${projectId}`, width: 680, height: 600,
  })
}

/** موظف جديد/تعديل سريع — نافذة ابنة للمنتقي أو لأي نافذة أم */
export function openEmployeeEditorWindow(employeeId: number, parentId?: string | null, onSaved?: (employeeId: number) => void) {
  const isNew = employeeId === 0
  return useWindowStore.getState().openWindow({
    kind: 'employee-editor',
    title: isNew ? 'موظف جديد' : 'تعديل موظف',
    subtitle: isNew ? 'إنشاء سريع — تُستكمل بقية البيانات لاحقاً من صفحة الموظفين' : 'تعديل سريع بلا مغادرة فاتورتك',
    props: { employeeId, ...(onSaved ? { onSaved } : {}) }, parentId: parentId ?? null,
    dedupeKey: isNew ? null : `employee-editor:${employeeId}`, width: 680, height: 600,
  })
}

/**
 * نافذة مصروف المشروع الحرة (اعتماد المالك لنموذج N-04 الحي 2026-10-22):
 * كل «تسجيل مصروف جديد» = نافذة مستقلة بمسودتها الخاصة (dedupeKey فارغ)،
 * فتتعدد مصروفات قيد الإدخال بلا تصادم — الترقيم PEX يُحسم عند الحفظ في المضيف.
 */
export function openProjectExpenseWindow(preselectProjectId?: number, parentId?: string | null) {
  return useWindowStore.getState().openWindow({
    kind: 'project-expense',
    title: 'تسجيل مصروف مشروع — جديد',
    subtitle: 'نافذة حرة · تصنيفات تنمو معك',
    props: preselectProjectId ? { preselectProjectId } : {},
    parentId: parentId ?? null,
    dedupeKey: null,
    width: 1060, height: 700,
  })
}

export function openPartyLedgerWindow(kind: 'customer' | 'supplier', partyId: number, parentId?: string | null) {
  return useWindowStore.getState().openWindow({
    kind: 'party-ledger', title: kind === 'customer' ? 'كشف حساب عميل' : 'كشف حساب مورد', subtitle: 'الحركة والرصيد الجاري',
    props: { partyKind: kind, partyId }, parentId: parentId ?? null, dedupeKey: `party-ledger:${kind}:${partyId}`, width: 900, height: 640,
  })
}

/* ═══════════════ استعادة جلسة النوافذ بعد التحديث (طلب المالك) ═══════════════
   عند إعادة تحميل الصفحة كانت كل النوافذ تضيع. الآن تُحفظ النوافذ **القابلة
   للاستعادة** (التي تُوصف ببيانات لا بدوال) وتُفتح تلقائياً عند الإقلاع بنفس
   مقاسها وموضعها. المنتقيات المعتمدة على ردود نداء (item-picker) لا تُحفظ. */
const SESSION_KEY = 'shopsys-window-session-v1'
const RESTORABLE: AppWindowKind[] = ['sales-invoice', 'purchase-invoice', 'item-editor', 'item-ledger', 'item-prices', 'party-editor']
type SessionWindow = { kind: AppWindowKind; title: string; subtitle: string; props: Record<string, unknown>; mode: AppWindowMode; rect: WindowRect }

export function saveWindowSession(): void {
  if (typeof localStorage === 'undefined') return
  if (desktopBridge()) { localStorage.removeItem(SESSION_KEY); return }
  const rows: SessionWindow[] = useWindowStore.getState().windows
    .filter((win) => RESTORABLE.includes(win.kind))
    .map((win) => ({ kind: win.kind, title: win.title, subtitle: win.subtitle, props: win.props, mode: win.mode, rect: win.rect }))
  if (rows.length) localStorage.setItem(SESSION_KEY, JSON.stringify(rows))
  else localStorage.removeItem(SESSION_KEY)
}

/** يُستدعى مرة عند الإقلاع — يعيد فتح ما كان مفتوحاً ويرجع عددها */
export function restoreWindowSession(): number {
  if (typeof localStorage === 'undefined') return 0
  if (desktopBridge()) return 0 /* الأقمار الحرة لا تُستعاد كنوافذ داخلية */
  let rows: SessionWindow[] = []
  try { rows = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '[]') as SessionWindow[] } catch { return 0 }
  if (!Array.isArray(rows) || !rows.length) return 0
  const store = useWindowStore.getState()
  if (store.windows.length) return 0
  let opened = 0
  for (const row of rows) {
    if (!RESTORABLE.includes(row.kind)) continue
    store.openWindow({
      kind: row.kind, title: row.title, subtitle: row.subtitle, props: row.props ?? {},
      mode: row.mode === 'minimized' ? 'normal' : row.mode,
      width: row.rect?.w, height: row.rect?.h, x: row.rect?.x, y: row.rect?.y,
    })
    opened += 1
  }
  return opened
}

/** يبدأ حفظ الجلسة تلقائياً مع كل تغيّر (نافذة تُفتح/تُغلق/تُحرَّك) */
export function watchWindowSession(): () => void {
  saveWindowSession()
  return useWindowStore.subscribe(() => saveWindowSession())
}
