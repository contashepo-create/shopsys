import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minus, Square, X, GripVertical } from 'lucide-react'
import { OverlayPortal } from '../components/ui.tsx'
import { useWindowStore, clampRect, type AppWindow } from './windowStore.ts'

type ResizeDir = 'e' | 'w' | 's' | 'se' | 'sw'

/**
 * إطار النافذة المستقلة: شريط عنوان يُسحب، أزرار تصغير/تكبير/إغلاق، ومقابض تحجيم.
 * لا توجد طبقة تعتيم ولا إغلاق بالضغط في مكان فارغ — تماماً كنوافذ برامج سطح المكتب.
 */
export function FloatingWindow({ win, children }: { win: AppWindow; children: ReactNode }) {
  const focusWindow = useWindowStore((s) => s.focusWindow)
  const moveWindow = useWindowStore((s) => s.moveWindow)
  const setWindowRect = useWindowStore((s) => s.setWindowRect)
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow)
  const toggleMaximizeWindow = useWindowStore((s) => s.toggleMaximizeWindow)
  const requestCloseWindow = useWindowStore((s) => s.requestCloseWindow)
  const cancelCloseWindow = useWindowStore((s) => s.cancelCloseWindow)
  const discardAndCloseWindow = useWindowStore((s) => s.discardAndCloseWindow)
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)

  /* النافذة المفتوحة حديثاً تأخذ التركيز: بلاغ المالك «Escape أغلق نافذة التعديل
     ومعها نافذة اختيار الصنف» — سببه بقاء التركيز في الأم فيصلها المفتاح هي. */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const timer = window.setTimeout(() => {
      if (frame.contains(document.activeElement)) return
      const first = frame.querySelector<HTMLElement>('[data-window-autofocus], input:not([type="hidden"]):not([disabled]), select, textarea, button:not([data-window-button])')
      if (first) first.focus()
      else frame.focus()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [win.id])

  /* إعادة ضبط الموضع عند تغيير مقاس المتصفح حتى لا تخرج النافذة عن الشاشة */
  useEffect(() => {
    const onResize = () => { const next = clampRect(win.rect); if (next.x !== win.rect.x || next.y !== win.rect.y || next.w !== win.rect.w || next.h !== win.rect.h) moveWindow(win.id, next.x, next.y) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [win.id, win.rect, moveWindow])

  const startDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-window-button]')) return
    focusWindow(win.id)
    if (win.mode === 'maximized') return
    const startX = event.clientX
    const startY = event.clientY
    const origin = { ...win.rect }
    setDragging(true)
    const move = (ev: PointerEvent) => moveWindow(win.id, origin.x + (ev.clientX - startX), origin.y + (ev.clientY - startY))
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [focusWindow, moveWindow, win.id, win.mode, win.rect])

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>, dir: ResizeDir) => {
    event.stopPropagation()
    if (win.mode === 'maximized') return
    focusWindow(win.id)
    const startX = event.clientX
    const startY = event.clientY
    const origin = { ...win.rect }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let { x, y, w, h } = origin
      if (dir.includes('e')) w = origin.w + dx
      if (dir.includes('s')) h = origin.h + dy
      if (dir.includes('w')) { w = origin.w - dx; x = origin.x + dx }
      setWindowRect(win.id, { x, y, w, h })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [focusWindow, setWindowRect, win.id, win.mode, win.rect])

  const maximized = win.mode === 'maximized'
  const style = maximized
    ? { left: 8, top: 8, width: 'calc(100vw - 16px)', height: 'calc(100vh - 64px)', zIndex: win.z }
    : { left: win.rect.x, top: win.rect.y, width: win.rect.w, height: win.rect.h, zIndex: win.z }

  return (
    <div
      ref={frameRef}
      data-app-window={win.id}
      data-window-kind={win.kind}
      data-window-mode={win.mode}
      className={`app-window layer-window ${dragging ? 'is-dragging' : ''} ${maximized ? 'is-maximized' : ''}`}
      style={style}
      dir="rtl"
      tabIndex={-1}
      onPointerDownCapture={() => focusWindow(win.id)}
      onKeyDown={(event) => {
        /* كل نافذة تستجيب لـEscape وتغلق نفسها وحدها (قاعدة المالك)؛ ولو عالجه
           عنصر بداخلها (منتقٍ مثلاً) فلا نغلق مرتين. */
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.stopPropagation()
        requestCloseWindow(win.id)
      }}
      role="dialog"
      aria-label={win.title}
    >
      <header className="app-window-bar" onPointerDown={startDrag} onDoubleClick={() => toggleMaximizeWindow(win.id)}>
        <span className="app-window-grip" aria-hidden="true"><GripVertical size={14} /></span>
        <div className="app-window-titles">
          <b>{win.title}{win.dirty && <span className="app-window-dirty" title="تعديلات غير محفوظة"> ●</span>}</b>
          {win.subtitle && <small>{win.subtitle}</small>}
        </div>
        <div className="app-window-buttons">
          <button type="button" data-window-button data-window-minimize aria-label="تصغير النافذة" title="تصغير" onClick={() => minimizeWindow(win.id)}><Minus size={15} /></button>
          <button type="button" data-window-button data-window-maximize aria-label={maximized ? 'استعادة حجم النافذة' : 'تكبير النافذة'} title={maximized ? 'استعادة' : 'تكبير'} onClick={() => toggleMaximizeWindow(win.id)}>{maximized ? <Square size={13} /> : <Maximize2 size={13} />}</button>
          <button type="button" data-window-button data-window-close className="is-close" aria-label="إغلاق النافذة" title="إغلاق" onClick={() => requestCloseWindow(win.id)}><X size={15} /></button>
        </div>
      </header>

      <div className="app-window-body">{children}</div>

      {/*
        بلاغ المالك: «رأس الجدول ما زال يغطي رسالة تأكيد الإغلاق».
        الغطاء كان يُرسم **داخل** النافذة، فيبقى رهينة سياق التكديس الذي حوله
        (رؤوس لاصقة، أشرطة، حاويات بـtransform). الحل الجذري: يخرج إلى <body>
        عبر بورتال بطبقة `layer-window-ask` فوق النوافذ والحوارات — فلا شيء
        داخل الصفحة يستطيع أن يعلوه مهما كان z-index الداخلي.
      */}
      {win.askingClose && (
        <OverlayPortal>
          <div className="app-window-ask layer-window-ask" data-window-close-confirm dir="rtl">
            <div className="app-window-ask-card" role="alertdialog" aria-label={`تأكيد إغلاق ${win.title}`}>
              <b>إغلاق «{win.title}»؟</b>
              <p>{win.closePrompt?.hint ?? 'هناك بيانات لم تُحفظ في هذه النافذة. الإغلاق يفقدها — والنوافذ الأخرى تبقى كما هي.'}</p>
              <div className="app-window-ask-actions">
                <button type="button" onClick={() => cancelCloseWindow(win.id)} className="is-keep" data-window-close-cancel>متابعة العمل</button>
                {win.closePrompt?.onSave && (
                  <button
                    type="button"
                    className="is-save"
                    data-window-close-save
                    onClick={() => { const prompt = win.closePrompt; cancelCloseWindow(win.id); prompt?.onSave?.() }}
                  >{win.closePrompt.saveLabel ?? 'حفظ ثم إغلاق'}</button>
                )}
                <button type="button" onClick={() => discardAndCloseWindow(win.id)} className="is-discard" data-window-close-confirm-yes>
                  {win.closePrompt?.discardLabel ?? 'إغلاق وفقد البيانات'}
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}

      {!maximized && <>
        <span className="app-window-resize is-e" onPointerDown={(e) => startResize(e, 'e')} />
        <span className="app-window-resize is-w" onPointerDown={(e) => startResize(e, 'w')} />
        <span className="app-window-resize is-s" onPointerDown={(e) => startResize(e, 's')} />
        <span className="app-window-resize is-se" onPointerDown={(e) => startResize(e, 'se')} />
        <span className="app-window-resize is-sw" onPointerDown={(e) => startResize(e, 'sw')} />
      </>}
    </div>
  )
}
