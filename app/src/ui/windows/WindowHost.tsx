import { lazy, Suspense, useEffect } from 'react'
import { AppWindow as WindowIcon, FileText, PackageSearch, ReceiptText, UserRound, X } from 'lucide-react'
import { OverlayPortal, useToast } from '../components/ui.tsx'
import { useWindowStore, restoreWindowSession, watchWindowSession, type AppWindow, type AppWindowKind } from './windowStore.ts'
import { WindowHostProvider } from './WindowContext.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import { ItemEditorWindowView, ItemLedgerWindowView, ItemPickerWindowView, ItemPricesWindowView, PartyEditorWindowView, PartyLedgerWindowView } from './windowViews.tsx'

/* الفواتير ثقيلة — تُحمَّل عند أول فتح نافذة فقط */
const SalesInvoiceWindowView = lazy(() => import('../pages/AdvancedSalesInvoicePage.tsx').then((mod) => ({ default: mod.AdvancedSalesInvoicePage })))
const PurchaseInvoiceWindowView = lazy(() => import('../pages/AdvancedPurchaseInvoicePage.tsx').then((mod) => ({ default: mod.AdvancedPurchaseInvoicePage })))

/* بلاغ المالك: «فتح الفاتورة يأخذ وقتاً طويلاً ويكتب جارٍ الفتح».
   السبب أن وحدة الفاتورة ضخمة وتُحمَّل عند أول فتح. الآن نسحبها مسبقاً في وقت
   خمول المتصفح بعد إقلاع التطبيق، فتفتح النافذة فوراً بلا انتظار. */
let invoiceModulesWarmed = false
function warmInvoiceModules() {
  if (invoiceModulesWarmed) return
  invoiceModulesWarmed = true
  const warm = () => {
    void import('../pages/AdvancedSalesInvoicePage.tsx')
    void import('../pages/AdvancedPurchaseInvoicePage.tsx')
  }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (typeof idle === 'function') idle(warm, { timeout: 2500 })
  else setTimeout(warm, 1200)
}

const ICONS: Record<AppWindowKind, typeof FileText> = {
  'sales-invoice': ReceiptText,
  'purchase-invoice': FileText,
  'item-picker': PackageSearch,
  'item-prices': ReceiptText,
  'item-editor': PackageSearch,
  'item-ledger': PackageSearch,
  'party-editor': UserRound,
  'party-ledger': UserRound,
}

function WindowContent({ win }: { win: AppWindow }) {
  switch (win.kind) {
    case 'sales-invoice': return <SalesInvoiceWindowView />
    case 'purchase-invoice': return <PurchaseInvoiceWindowView />
    case 'item-picker': return <ItemPickerWindowView />
    case 'item-prices': return <ItemPricesWindowView />
    case 'item-editor': return <ItemEditorWindowView />
    case 'item-ledger': return <ItemLedgerWindowView />
    case 'party-editor': return <PartyEditorWindowView />
    case 'party-ledger': return <PartyLedgerWindowView />
    default: return null
  }
}

/**
 * مضيف النوافذ: يرسم كل النوافذ المفتوحة فوق التطبيق + شريط مهام للمصغَّرة.
 * مركَّب مرة واحدة في MainLayout، فكل الشاشات تستطيع فتح نوافذ.
 */
export function WindowHost() {
  const windows = useWindowStore((s) => s.windows)
  const restoreWindow = useWindowStore((s) => s.restoreWindow)
  const requestCloseWindow = useWindowStore((s) => s.requestCloseWindow)
  const focusWindow = useWindowStore((s) => s.focusWindow)
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow)
  const toggleMaximizeWindow = useWindowStore((s) => s.toggleMaximizeWindow)
  /* اختصارات إدارة النوافذ على طراز سطح المكتب — تعمل من أي مكان في التطبيق
     ولا تصطدم بمفاتيح المتصفح ولا باختصارات الفاتورة (F-keys):
     Ctrl+Alt+W تنقّل · Ctrl+Alt+1..9 قفز لنافذة · Ctrl+Alt+M تصغير ·
     Ctrl+Alt+↑ تكبير/استعادة · Ctrl+Alt+Q إغلاق النشطة. */
  useEffect(() => { warmInvoiceModules() }, [])
  /* استعادة جلسة النوافذ بعد التحديث (طلب المالك): ما كان مفتوحاً يعود بمقاسه
     وموضعه، ثم يُحفظ أي تغيير تلقائياً. */
  useEffect(() => {
    const restored = restoreWindowSession()
    if (restored > 0) useToast.getState().show(`استُعيدت ${restored} نافذة من جلستك السابقة`)
    return watchWindowSession()
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.metaKey) return
      const state = useWindowStore.getState()
      const open = state.windows
      if (open.length === 0) return
      const shown = open.filter((win) => win.mode !== 'minimized')
      const top = shown.reduce<AppWindow | null>((best, win) => (!best || win.z > best.z ? win : best), null)
      const key = event.key.toLowerCase()
      const digit = Number(event.key)
      if (key === 'w') {
        event.preventDefault()
        if (open.length < 2) return
        const order = [...open].sort((a, b) => a.z - b.z)
        const at = top ? order.findIndex((win) => win.id === top.id) : -1
        const next = order[(at + (event.shiftKey ? order.length - 1 : 1) + order.length) % order.length]
        if (next.mode === 'minimized') state.restoreWindow(next.id)
        else state.focusWindow(next.id)
      } else if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const target = open[digit - 1]
        if (!target) return
        event.preventDefault()
        if (target.mode === 'minimized') state.restoreWindow(target.id)
        else state.focusWindow(target.id)
      } else if (key === 'm' && top) {
        event.preventDefault()
        minimizeWindow(top.id)
      } else if (event.key === 'ArrowUp' && top) {
        event.preventDefault()
        toggleMaximizeWindow(top.id)
      } else if (key === 'q' && top) {
        event.preventDefault()
        requestCloseWindow(top.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [minimizeWindow, requestCloseWindow, toggleMaximizeWindow])

  if (windows.length === 0) return null
  const visible = windows.filter((win) => win.mode !== 'minimized')
  const topId = visible.reduce<AppWindow | null>((top, win) => (!top || win.z > top.z ? win : top), null)?.id ?? null

  return (
    <OverlayPortal>
      {visible.map((win) => (
        <FloatingWindow key={win.id} win={win} active={win.id === topId}>
          <WindowHostProvider windowId={win.id} props={win.props}>
            <Suspense fallback={<div className="grid h-full place-items-center p-10 text-sm text-slate-500">جارٍ فتح النافذة…</div>}>
              <WindowContent win={win} />
            </Suspense>
          </WindowHostProvider>
        </FloatingWindow>
      ))}

      <div className="app-window-taskbar layer-window-bar" dir="rtl" data-window-taskbar>
        <span className="app-window-taskbar-label" title="Ctrl+Alt+W للتنقل بين النوافذ · Ctrl+Alt+1..9 للقفز · Ctrl+Alt+M تصغير · Ctrl+Alt+↑ تكبير · Ctrl+Alt+Q إغلاق"><WindowIcon size={13} /> النوافذ المفتوحة ({windows.length})</span>
        {windows.map((win, index) => {
          const Icon = ICONS[win.kind] ?? FileText
          return (
            <span key={win.id} className={`app-window-task ${win.mode === 'minimized' ? 'is-minimized' : ''} ${win.id === topId ? 'is-active' : ''}`} data-window-task={win.id}>
              <button type="button" onClick={() => (win.mode === 'minimized' ? restoreWindow(win.id) : focusWindow(win.id))} title={`${win.title} — Ctrl+Alt+${index + 1}`}>
                <Icon size={13} /> <span className="app-window-task-title">{win.title}</span>{index < 9 && <kbd className="app-window-task-key">{index + 1}</kbd>}{win.dirty && <i className="app-window-dirty">●</i>}
              </button>
              <button type="button" className="app-window-task-close" aria-label={`إغلاق ${win.title}`} onClick={() => requestCloseWindow(win.id)}><X size={12} /></button>
            </span>
          )
        })}
      </div>
    </OverlayPortal>
  )
}
