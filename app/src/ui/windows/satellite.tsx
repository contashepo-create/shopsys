/**
 * جذر نافذة القمر الحر (قرار المالك 2026-10-22 — سطح المكتب):
 * كل قمر هو نافذة نظام حقيقية تُحمّل التطبيق نفسه. هنا نوعان:
 *  • SatelliteLayout: غلاف قسم كامل (مسار من مسارات التطبيق) بلا شريط
 *    جانبي/علوي — شريط تحكم نظام التشغيل هو شريط عنوانه.
 *  • SatelliteViewRoot: عرض نافذة (مستند/منتقٍ/محرر) يوفر WindowHostApi
 *    نفسها التي تعرفها الصفحات، لكن close/dirty/title عبر IPC، وخصائص
 *    ردود النداء أقزام ترسل الاستدعاء للنافذة الأم مالكة الطلب.
 * مصافحة الإغلاق: زر إغلاق النظام يصل هنا كـ request-close — إن وجد عمل
 * غير محفوظ يظهر نفس حوار التأكيد (حفظ/إغلاق وحذف/متابعة) قبل السماح.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { desktopWindowsBridge, type SatelliteDescriptor } from '../../data/desktopBridge.ts'
import { OverlayPortal } from '../components/ui.tsx'
import { hasUnsavedChangesInCurrentWindow } from '../components/unsavedChangeRegistry.ts'
import { WindowHostContext, type WindowHostApi } from './windowHostContext.ts'
import { useWindowStore, type AppWindowKind, type WindowClosePrompt } from './windowStore.ts'
import { WindowViewContent } from './WindowHost.tsx'

/** غلاف قسم داخل نافذة قمر: المحتوى وحده بملء النافذة */
export function SatelliteLayout({ children }: { title?: string; children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [closeTokens, setCloseTokens] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  /* روابط عميقة لقسم مفتوح أصلاً (?focus=…) تصل من العملية الرئيسية */
  useEffect(() => desktopWindowsBridge()?.onNavigate(({ path }) => navigate(path)), [navigate])
  /* تسجيل حالة القسم عند العملية الرئيسية لتظهر في حوار إغلاق الكل */
  useEffect(() => { desktopWindowsBridge()?.setDirty(dirty) }, [dirty])
  /* إغلاق نظام التشغيل يمر عبر تأكيد عند وجود تغييرات غير محفوظة. نعلن الجاهزية
     بعد تركيب المستمع؛ قبلها تتعامل العملية الرئيسية مع النافذة كإقلاع بلا واجهة عمل. */
  useEffect(() => {
    const bridge = desktopWindowsBridge()
    const off = bridge?.onRequestClose(({ token }) => {
      if (!hasUnsavedChangesInCurrentWindow()) {
        bridge?.respondClose(token, true)
        return
      }
      setCloseTokens((tokens) => tokens.includes(token) ? tokens : [...tokens, token])
    })
    bridge?.setRendererReady(true)
    return () => { bridge?.setRendererReady(false); off?.() }
  }, [])
  const isInvoiceWorkspace = /^\/(sales|purchases)\/invoices\/new$/.test(location.pathname)
  const answerClose = (allow: boolean) => {
    const pending = closeTokens
    setCloseTokens([])
    if (allow) setDirty(false)
    for (const token of pending) desktopWindowsBridge()?.respondClose(token, allow)
  }
  return (
    <div className={isInvoiceWorkspace ? 'invoice-embedded-layout' : 'min-h-screen'} dir="rtl" data-satellite-layout>
      <main className={isInvoiceWorkspace ? 'invoice-embedded-main' : 'p-4 lg:p-6'}>{children}</main>
      {closeTokens.length > 0 && (
        <OverlayPortal>
          <div className="app-window-ask layer-window-ask" data-window-close-confirm data-section-close-confirm dir="rtl">
            <div className="app-window-ask-card" role="alertdialog" aria-label="تأكيد إغلاق القسم">
              <b>إغلاق نافذة القسم؟</b>
              <p>توجد تغييرات لم تُحفظ في هذه الشاشة. إغلاق النافذة يفقدها.</p>
              <div className="app-window-ask-actions">
                <button type="button" className="is-keep" onClick={() => answerClose(false)}>متابعة العمل</button>
                <button type="button" className="is-discard" data-window-close-confirm-yes onClick={() => answerClose(true)}>إغلاق وفقد التغييرات</button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}
    </div>
  )
}

/** عرض نافذة (مستند/منتقٍ/محرر) داخل نافذة قمر — نفس عقد WindowHostApi */
export function SatelliteViewRoot({ descriptor }: { descriptor: SatelliteDescriptor }) {
  const bridge = desktopWindowsBridge()
  const dirtyRef = useRef(false)
  const promptRef = useRef<WindowClosePrompt | null>(null)
  const [prompt, setPrompt] = useState<WindowClosePrompt | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  /* طلبات إغلاق معلّقة: كل مصافحة من العملية الرئيسية لها توكنها — قد يصل
     طلب ثانٍ (إغلاق شامل) بينما حوار الأول مفتوح، فتُجمع التوكنات وتُجاب
     كلها معاً وإلا انتهت مهلة أحدهما وأُغلقت النافذة قسراً أثناء قراره */
  const [ask, setAsk] = useState<{ tokens: (string | null)[] } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const props = useMemo<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = { ...(descriptor.props ?? {}) }
    for (const name of descriptor.callbackNames ?? []) {
      base[name] = (...args: unknown[]) => bridge?.invokeProp({ requestId: descriptor.requestId ?? '', prop: name, args })
    }
    return base
  }, [descriptor, bridge])

  const api = useMemo<WindowHostApi>(() => ({
    windowId: descriptor.windowId,
    props,
    close: () => bridge?.closeSelf(),
    setDirty: (dirty: boolean) => { dirtyRef.current = dirty; bridge?.setDirty(dirty) },
    setTitle: (title: string) => bridge?.setTitle(title),
    openChild: (input) => useWindowStore.getState().openWindow({ ...input, parentId: descriptor.windowId }),
    setClosePrompt: (next: WindowClosePrompt | null) => { promptRef.current = next; setPrompt(next) },
  }), [descriptor, props, bridge])

  useEffect(() => {
    const off = bridge?.onRequestClose(({ token }) => {
      if (!dirtyRef.current) { bridge?.respondClose(token, true); return }
      setAsk((prev) => ({ tokens: [...(prev?.tokens ?? []), token] }))
    })
    bridge?.setRendererReady(true)
    return () => { bridge?.setRendererReady(false); off?.() }
  }, [bridge])

  /* تركيز أول حقل — نفس سلوك النافذة العائمة عند فتحها */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const first = bodyRef.current?.querySelector<HTMLElement>('[data-window-autofocus], input:not([type="hidden"]):not([disabled]), select, textarea, button:not([data-window-button])')
      first?.focus()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [])

  const answerClose = (allow: boolean, before?: () => void) => {
    const current = ask
    if (allow) {
      try { before?.() }
      catch (error) {
        setCloseError(error instanceof Error ? error.message : 'تعذّر إتمام الحفظ؛ بقيت النافذة مفتوحة حفاظاً على البيانات.')
        return
      }
    }
    setCloseError(null)
    setAsk(null)
    if (!current) return
    let localOnly = true
    for (const token of current.tokens) {
      if (token) { localOnly = false; bridge?.respondClose(token, allow) }
    }
    if (localOnly && allow) bridge?.closeSelf()
  }

  const kind = descriptor.kind as AppWindowKind | undefined
  return (
    <WindowHostContext.Provider value={api}>
      <div
        ref={bodyRef}
        dir="rtl"
        data-satellite-view={kind ?? ''}
        className="flex h-screen min-h-0 flex-col"
        onKeyDown={(event) => {
          /* Escape يغلق هذه النافذة وحدها (قاعدة المالك) ما لم يعالجه عنصر داخلها */
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.stopPropagation()
          if (!dirtyRef.current) bridge?.closeSelf()
          else setAsk((prev) => ({ tokens: [...(prev?.tokens ?? []), null] }))
        }}
      >
        <div className="app-window-body">
          <Suspense fallback={<div className="grid h-full place-items-center p-10 text-sm text-slate-500">جارٍ فتح النافذة…</div>}>
            {kind ? <WindowViewContent kind={kind} /> : <div className="p-6 text-sm text-slate-500">عرض نافذة غير معروف.</div>}
          </Suspense>
        </div>

        {ask && (
          <OverlayPortal>
            <div className="app-window-ask layer-window-ask" data-window-close-confirm dir="rtl">
              <div className="app-window-ask-card" role="alertdialog" aria-label={`تأكيد إغلاق ${descriptor.title}`}>
                <b>إغلاق «{descriptor.title}»؟</b>
                <p>{prompt?.hint ?? 'هناك بيانات لم تُحفظ في هذه النافذة. الإغلاق يفقدها — والنوافذ الأخرى تبقى كما هي.'}</p>
                {closeError && <p role="alert" className="text-rose-600">{closeError}</p>}
                <div className="app-window-ask-actions">
                  <button type="button" className="is-keep" data-window-close-cancel onClick={() => answerClose(false)}>متابعة العمل</button>
                  {prompt?.onSave && (
                    <button type="button" className="is-save" data-window-close-save onClick={() => answerClose(true, () => prompt.onSave?.())}>
                      {prompt.saveLabel ?? 'حفظ ثم إغلاق'}
                    </button>
                  )}
                  <button type="button" className="is-discard" data-window-close-confirm-yes onClick={() => answerClose(true, () => prompt?.onDiscard?.())}>
                    {prompt?.discardLabel ?? 'إغلاق وفقد البيانات'}
                  </button>
                </div>
              </div>
            </div>
          </OverlayPortal>
        )}
      </div>
    </WindowHostContext.Provider>
  )
}
