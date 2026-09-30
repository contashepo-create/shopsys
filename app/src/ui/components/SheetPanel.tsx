/**
 * الدرج الجانبي (Slide-over Sheet) — من مختبر النوافذ إلى التطبيق بطلب المالك.
 *
 * بديل النافذة المنبثقة للإجراءات السريعة: ينزلق من جانب الشاشة، **تبقى الشاشة
 * خلفه ظاهرة وقابلة للعمل** (لا تعتيم ولا عزل — قاعدة المالك)، ويُغلق بزر أو
 * بـEscape أو بالنقر خارجه.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { OverlayPortal } from './ui.tsx'

export function SheetPanel({
  open, onClose, title, subtitle, icon, footer, width = 380, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: ReactNode
  footer?: ReactNode
  width?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (ref.current?.contains(target)) return
      if (target.closest('[data-sheet-keep-open]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    /* تأخير بسيط حتى لا تُغلق بالنقرة نفسها التي فتحتها */
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer, true), 80)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const first = ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea')
    setTimeout(() => first?.focus(), 60)
  }, [open])

  if (!open) return null
  return (
    <OverlayPortal>
      <aside
        ref={ref}
        className="app-sheet layer-modal"
        dir="rtl"
        role="dialog"
        aria-label={title}
        data-app-sheet
        style={{ width: `min(${width}px, 92vw)` }}
      >
        <header className="app-sheet-head">
          <b>{icon}{title}</b>
          {subtitle && <small>{subtitle}</small>}
          <button type="button" onClick={onClose} aria-label="إغلاق الدرج" title="إغلاق (Esc)"><X size={14} /></button>
        </header>
        <div className="app-sheet-body">{children}</div>
        {footer && <footer className="app-sheet-foot">{footer}</footer>}
      </aside>
    </OverlayPortal>
  )
}
