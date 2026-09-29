import { lazy, Suspense } from 'react'
import { AppWindow as WindowIcon, FileText, PackageSearch, ReceiptText, UserRound, X } from 'lucide-react'
import { OverlayPortal } from '../components/ui.tsx'
import { useWindowStore, type AppWindow, type AppWindowKind } from './windowStore.ts'
import { WindowHostProvider } from './WindowContext.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import { ItemEditorWindowView, ItemLedgerWindowView, ItemPickerWindowView, ItemPricesWindowView, PartyEditorWindowView, PartyLedgerWindowView } from './windowViews.tsx'

/* الفواتير ثقيلة — تُحمَّل عند أول فتح نافذة فقط */
const SalesInvoiceWindowView = lazy(() => import('../pages/AdvancedSalesInvoicePage.tsx').then((mod) => ({ default: mod.AdvancedSalesInvoicePage })))
const PurchaseInvoiceWindowView = lazy(() => import('../pages/AdvancedPurchaseInvoicePage.tsx').then((mod) => ({ default: mod.AdvancedPurchaseInvoicePage })))

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
  if (windows.length === 0) return null
  const visible = windows.filter((win) => win.mode !== 'minimized')
  const topId = visible.reduce<AppWindow | null>((top, win) => (!top || win.z > top.z ? win : top), null)?.id ?? null

  return (
    <OverlayPortal>
      {visible.map((win) => (
        <FloatingWindow key={win.id} win={win}>
          <WindowHostProvider windowId={win.id} props={win.props}>
            <Suspense fallback={<div className="grid h-full place-items-center p-10 text-sm text-slate-500">جارٍ فتح النافذة…</div>}>
              <WindowContent win={win} />
            </Suspense>
          </WindowHostProvider>
        </FloatingWindow>
      ))}

      <div className="app-window-taskbar layer-window-bar" dir="rtl" data-window-taskbar>
        <span className="app-window-taskbar-label"><WindowIcon size={13} /> النوافذ المفتوحة ({windows.length})</span>
        {windows.map((win) => {
          const Icon = ICONS[win.kind] ?? FileText
          return (
            <span key={win.id} className={`app-window-task ${win.mode === 'minimized' ? 'is-minimized' : ''} ${win.id === topId ? 'is-active' : ''}`} data-window-task={win.id}>
              <button type="button" onClick={() => (win.mode === 'minimized' ? restoreWindow(win.id) : focusWindow(win.id))} title={win.title}>
                <Icon size={13} /> <span className="app-window-task-title">{win.title}</span>{win.dirty && <i className="app-window-dirty">●</i>}
              </button>
              <button type="button" className="app-window-task-close" aria-label={`إغلاق ${win.title}`} onClick={() => requestCloseWindow(win.id)}><X size={12} /></button>
            </span>
          )
        })}
      </div>
    </OverlayPortal>
  )
}
