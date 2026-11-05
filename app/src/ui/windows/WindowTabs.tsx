/**
 * تبويبات النافذة الأم (طلب المالك 2026-10-26):
 *   • رأس علوي فوق المحتوى: كل قسم/عرض كان يفتح نافذة حرة يظهر تبويباً.
 *   • تنقّل بالنقر على اسم التبويب · زر إغلاق ✕ بجانب الاسم · حتى 10 تبويبات
 *     (الحادي عشر يعود نافذة حرة — سلوك النوافذ القديم كما هو).
 *   • الفواتير بجميع أنواعها تبقى نوافذ حرة مستقلة (لا تمر هنا أصلاً).
 *   • تبويب بتعديلات غير محفوظة: الإغلاق أو المغادرة يسأل أولاً (حوار بنفس
 *     طابع حوار إغلاق النوافذ) · حارس تنقل مسجّل يغطي الروابط الداخلية أيضاً.
 * يعمل فقط حيث تعمل النوافذ الحرة (سطح المكتب) ويختفي بلا تبويبات.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { OverlayPortal } from '../components/ui.tsx'
import { registerNavigationGuard } from '../components/navigationGuard.ts'
import { isDesktopFreeWindows } from '../../data/desktopBridge.ts'
import { useWindowStore, type AppWindowTab } from './windowStore.ts'
import { WindowHostProvider } from './WindowContext.tsx'
import { WindowViewContent } from './WindowHost.tsx'
import { FinancialDataReviewBoundary } from '../components/FinancialDataReviewBoundary.tsx'

const barCls = 'window-tab-bar flex items-center gap-1 px-2 pt-1 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/50 overflow-x-auto shrink-0'
const tabBase = 'group flex items-center gap-1.5 h-7 px-2.5 rounded-t-lg border border-b-0 cursor-pointer text-[11px] font-bold whitespace-nowrap transition-colors'

/** محتوى تبويب عرض: نفس مضيف النوافذ مع خصائصه — يُرسم مكان الراوتر */
export function ActiveViewTab({ tab }: { tab: AppWindowTab }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  /* تركيز أول حقل عند فتح/تبديل التبويب — نفس سلوك نافذة القمر عند فتحها */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      bodyRef.current?.querySelector<HTMLElement>('[data-window-autofocus], input:not([type="hidden"]):not([disabled]), select, textarea, button:not([data-window-button])')?.focus()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [tab.id])
  if (!tab.kind) return null
  return (
    <div ref={bodyRef} className="h-full min-h-0" data-view-tab={tab.id} data-view-tab-kind={tab.kind}>
      <WindowHostProvider windowId={tab.id} props={tab.props ?? {}}>
        <FinancialDataReviewBoundary><WindowViewContent kind={tab.kind} /></FinancialDataReviewBoundary>
      </WindowHostProvider>
    </div>
  )
}

export function WindowTabBar() {
  const tabs = useWindowStore((s) => s.tabs)
  const viewActiveTabId = useWindowStore((s) => s.viewActiveTabId)
  const location = useLocation()
  /* حارس مغادرة لتبويب عرض متسخ: أي تنقل/تبديل/إغلاق يمر بـ guardNavigation
     يظهر حوار هذا التبويب أولاً — حتى لا تُفقد تعديلات محرر مفتوح صامتاً. */
  const activeViewDirty = !!viewActiveTabId && tabs.some((t) => t.id === viewActiveTabId && t.dirty)
  useEffect(() => {
    if (!activeViewDirty || !viewActiveTabId) return
    return registerNavigationGuard((continueNavigation) => {
      /* حارس قد يبقى مسجّلاً لحظة واحدة بعد مغادرة التبويب (أثر التحديث في
         نفس دفعة التأثيرات) — يتحقق من الحالة الحية فلا يضاعف الحوار. */
      const state = useWindowStore.getState()
      const stillActive = state.viewActiveTabId === viewActiveTabId
        && state.tabs.some((tab) => tab.id === viewActiveTabId && tab.dirty)
      if (!stillActive) { continueNavigation(); return }
      state.beginTabAsk(viewActiveTabId, 'switch', continueNavigation)
    })
  }, [activeViewDirty, viewActiveTabId])
  /* تنبيه إغلاق التطبيق نفسه أثناء وجود تبويب بتعديلات (بديل حارس النوافذ) */
  const anyDirty = tabs.some((t) => t.dirty)
  useEffect(() => {
    if (!anyDirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [anyDirty])

  if (!isDesktopFreeWindows() || !tabs.length) return null
  const current = `${location.pathname}${location.search}`
  const askingTab = tabs.find((t) => t.askMode) ?? null
  const prompt = askingTab?.closePrompt ?? null

  return (
    <>
      <div className={barCls} dir="rtl" role="tablist" aria-label="التبويبات المفتوحة" data-window-tab-bar>
        {tabs.map((tab) => {
          const active = tab.path ? !viewActiveTabId && current === tab.path : viewActiveTabId === tab.id
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              title={tab.subtitle || tab.title}
              data-window-tab={tab.path ?? tab.kind ?? tab.id}
              data-active={active || undefined}
              onClick={() => useWindowStore.getState().activateTab(tab.id)}
              className={`${tabBase} ${active
                ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800/60'}`}
            >
              {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-label="تغييرات غير محفوظة" title="تغييرات غير محفوظة" />}
              <span className="truncate max-w-[10.5rem]">{tab.title}</span>
              <button
                type="button"
                aria-label={`إغلاق ${tab.title}`}
                onClick={(event) => { event.stopPropagation(); useWindowStore.getState().requestCloseTab(tab.id) }}
                className="rounded p-0.5 opacity-55 group-hover:opacity-100 hover:!opacity-100 hover:bg-rose-500/10 hover:text-rose-600 transition-all"
              ><X size={12} /></button>
            </div>
          )
        })}
      </div>
      {askingTab && askingTab.askMode && (
        <OverlayPortal>
          <div className="app-window-ask layer-window-ask" data-window-close-confirm data-tab-close-confirm dir="rtl">
            <div className="app-window-ask-card" role="alertdialog" aria-label={askingTab.askMode === 'close' ? `إغلاق تبويب ${askingTab.title}` : `مغادرة تبويب ${askingTab.title}`}>
              <b>{askingTab.askMode === 'close' ? `إغلاق «${askingTab.title}»؟` : `مغادرة «${askingTab.title}»؟`}</b>
              <p>{prompt?.hint ?? 'هناك تعديلات غير محفوظة في هذا التبويب — المغادرة تفقدها، وبقية التبويبات تبقى كما هي.'}</p>
              <div className="app-window-ask-actions">
                <button type="button" className="is-keep" data-tab-close-cancel onClick={() => useWindowStore.getState().cancelTabAsk()}>متابعة العمل</button>
                {askingTab.askMode === 'close' && prompt?.onSave && (
                  <button type="button" className="is-save" data-tab-close-save onClick={() => {
                    /* الحفظ أولاً — إن فشل يبقى التبويب مفتوحاً حفاظاً على البيانات */
                    try { prompt.onSave?.() } catch { return }
                    useWindowStore.getState().confirmTabAsk()
                  }}>{prompt.saveLabel ?? 'حفظ ثم إغلاق'}</button>
                )}
                <button
                  type="button"
                  className="is-discard"
                  data-tab-close-confirm-yes
                  onClick={() => {
                    const closing = askingTab.askMode === 'close'
                    const cleanup = prompt?.onDiscard
                    /* التنظيف (حذف مسودة مثلاً) إن أخطأ لا يُبطل إغلاقاً مؤكداً */
                    if (closing) { try { cleanup?.() } catch { /* أفضلية */ } }
                    useWindowStore.getState().confirmTabAsk()
                  }}
                >{askingTab.askMode === 'close' ? (prompt?.discardLabel ?? 'إغلاق وفقد التغييرات') : 'مغادرة وفقد التغييرات'}</button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}
    </>
  )
}
