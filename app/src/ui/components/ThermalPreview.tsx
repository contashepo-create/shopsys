/**
 * معاينة الإيصال الحراري قبل الطباعة (طلب المالك — كما في الوضع التجريبي):
 * نافذة صغيرة بعرض رول 80mm تعرض الإيصال الفعلي، وأسفلها ثلاثة أزرار:
 * **طباعة** · **إلغاء** · **تغيير الإعدادات**. تظهر فقط عندما تكون الطباعة
 * غير صامتة؛ أما مع مفتاح «طباعة مباشرة» فتُرسل للطابعة بلا معاينة.
 */
import { useEffect, useRef } from 'react'
import { Printer, Settings2, X } from 'lucide-react'
import { OverlayPortal } from './ui.tsx'

export function ThermalPreview({
  open, html, onClose, onPrint, onSettings,
}: {
  open: boolean
  html: string
  onClose: () => void
  onPrint: () => void
  onSettings: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (!open) return
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    doc.open(); doc.write(html); doc.close()
  }, [html, open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      else if (event.key === 'Enter') { event.stopPropagation(); onPrint() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onPrint, open])

  if (!open) return null
  return (
    <OverlayPortal>
      <div className="thermal-preview layer-modal" dir="rtl" role="dialog" aria-label="معاينة الإيصال الحراري" data-thermal-preview>
        <header>
          <b><Printer size={13} /> معاينة الإيصال الحراري</b>
          <small>رول 80mm — تأكد قبل الطباعة</small>
          <button type="button" onClick={onClose} aria-label="إغلاق المعاينة"><X size={13} /></button>
        </header>
        <div className="thermal-preview-paper">
          <iframe ref={frameRef} title="معاينة الإيصال" />
        </div>
        <footer>
          <button type="button" className="is-ghost" onClick={onSettings} data-thermal-settings><Settings2 size={12} /> تغيير الإعدادات</button>
          <span className="spacer" />
          <button type="button" className="is-ghost" onClick={onClose} data-thermal-cancel>إلغاء (Esc)</button>
          <button type="button" className="is-primary" onClick={onPrint} data-thermal-print><Printer size={12} /> طباعة (Enter)</button>
        </footer>
      </div>
    </OverlayPortal>
  )
}
