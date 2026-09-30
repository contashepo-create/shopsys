/**
 * معاينة الطباعة — **نافذة حرة في منتصف الشاشة** لا درج جانبي (طلب المالك):
 * تُسحب من شريط عنوانها، وتعرض الورقة كاملة **بلا تمرير أفقي** (تُقاس ورقة
 * 80mm = 302px ويُضبط عرض النافذة عليها)، وأسفلها: طباعة · إلغاء · الإعدادات.
 * تظهر للطباعة غير الصامتة؛ ومع مفتاح «طباعة مباشرة» تُرسل فوراً بلا معاينة.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Printer, Settings2, X, GripVertical } from 'lucide-react'
import { OverlayPortal } from './ui.tsx'

const PAPER_PX = 302 // رول 80mm عند 96dpi
const A4_PX = 560 // عرض معاينة مريح للفاتورة الكبيرة

export function ThermalPreview({
  open, html, onClose, onPrint, onSettings, wide = false, title = 'معاينة الإيصال الحراري',
}: {
  open: boolean
  html: string
  onClose: () => void
  onPrint: () => void
  onSettings: () => void
  /** معاينة فاتورة كبيرة (A4) بدل رول الكاشير */
  wide?: boolean
  title?: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const paper = wide ? A4_PX : PAPER_PX
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    doc.open(); doc.write(html); doc.close()
  }, [html, open])

  /* الظهور في منتصف الشاشة أولاً، ثم يحرّكها المستخدم بحرية */
  useEffect(() => {
    if (!open) { setPos(null); return }
    const width = paper + 28
    setPos({ x: Math.max(12, Math.round((window.innerWidth - width) / 2)), y: Math.max(12, Math.round(window.innerHeight * 0.08)) })
  }, [open, paper])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      else if (event.key === 'Enter') { event.stopPropagation(); onPrint() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onPrint, open])

  const startDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    const box = (event.currentTarget.closest('[data-thermal-preview]') as HTMLElement)?.getBoundingClientRect()
    if (!box) return
    dragRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top }
    const move = (ev: PointerEvent) => {
      const state = dragRef.current
      if (!state) return
      setPos({
        x: Math.min(Math.max(4, ev.clientX - state.dx), window.innerWidth - 120),
        y: Math.min(Math.max(4, ev.clientY - state.dy), window.innerHeight - 80),
      })
    }
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  if (!open) return null
  return (
    <OverlayPortal>
      <div
        className="thermal-preview layer-modal"
        dir="rtl"
        role="dialog"
        aria-label={title}
        data-thermal-preview
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: paper + 28 }}
      >
        <header onPointerDown={startDrag} data-thermal-drag>
          <span className="thermal-grip" aria-hidden="true"><GripVertical size={13} /></span>
          <b><Printer size={13} /> {title}</b>
          <small>{wide ? 'فاتورة كبيرة — اسحب النافذة بحرية' : 'رول 80mm — اسحب النافذة بحرية'}</small>
          <button type="button" onClick={onClose} aria-label="إغلاق المعاينة"><X size={13} /></button>
        </header>
        <div className="thermal-preview-paper">
          {/* العرض نسبي حتى لا يظهر أي تمرير أفقي مهما اختلفت هوامش المتصفح */}
          <iframe ref={frameRef} title="معاينة المستند" style={{ width: '100%', maxWidth: paper }} />
        </div>
        <footer>
          <button type="button" className="is-ghost" onClick={onSettings} data-thermal-settings><Settings2 size={12} /> الإعدادات</button>
          <span className="spacer" />
          <button type="button" className="is-ghost" onClick={onClose} data-thermal-cancel>إلغاء</button>
          <button type="button" className="is-primary" onClick={onPrint} data-thermal-print><Printer size={12} /> طباعة</button>
        </footer>
      </div>
    </OverlayPortal>
  )
}
