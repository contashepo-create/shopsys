/**
 * معاينة الطباعة — **نافذة حرة في منتصف الشاشة** لا درج جانبي (طلب المالك):
 * تُسحب من شريط عنوانها، وتعرض الورقة كاملة **بلا تمرير أفقي**، وتتضمن:
 *   • **إعدادات سريعة** داخل النافذة (ورق · لون · تذييل · مفاتيح إظهار) —
 *     كل تغيير ينعكس على المعاينة **فوراً** (معاينة حية) لأنها تُعاد بناؤها
 *     من نموذج المستند بالإعدادات الجديدة.
 *   • **إعدادات إضافية**: تُصغّر المعاينة إلى شريط أسفل الشاشة وتفتح قسم
 *     الطباعة كاملاً — والمعاينة المصغّرة تبقى حية تتحدث مع كل تغيير هناك.
 *   • أسفلها: طباعة (تتبع مفتاح «طباعة مباشرة») · إلغاء.
 * المكون يقرأ حالته من متجر المعاينة العام — يُرندر مرة واحدة في App فوق
 * كل المسارات، وأي صفحة تفتح المعاينة عبر openPrintPreview().
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Settings2, SlidersHorizontal, Maximize2, PanelBottomOpen, X, GripVertical } from 'lucide-react'
import { OverlayPortal } from './ui.tsx'
import { usePrintPreview } from './printPreviewStore.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { printHtml } from '../print/printReceipt.ts'
import { QuickPrintSettings } from './QuickPrintSettings.tsx'

const PAPER_PX = 302 // رول 80mm عند 96dpi
const PAPER_58_PX = 220 // رول 58mm
const A4_PX = 560 // عرض معاينة مريح للفاتورة الكبيرة

export function ThermalPreview() {
  const nav = useNavigate()
  const { open, handle, mini, closePreview, setMini, refresh } = usePrintPreview()
  const receipt = useAppStore((s) => s.receipt)
  const [quickOpen, setQuickOpen] = useState(false)

  const html = handle?.html ?? ''
  const wide = handle?.wide ?? false
  const title = handle?.title ?? (wide ? 'معاينة المستند قبل الطباعة' : 'معاينة الإيصال الحراري')
  const paper = wide ? A4_PX : receipt.paperWidth === '58' ? PAPER_58_PX : PAPER_PX
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    doc.open(); doc.write(html); doc.close()
  }, [html, open, mini])

  /* المعاينة الحية: أي تغيير في إعدادات الطباعة (من اللوحة السريعة هنا أو من
     قسم الطباعة الكامل) يعيد بناء HTML فوراً — بلا إغلاق ولا إعادة فتح. */
  const receiptRef = useRef(receipt)
  const firstReceipt = useRef(true)
  useEffect(() => {
    if (firstReceipt.current) { firstReceipt.current = false; receiptRef.current = receipt; return }
    if (receipt === receiptRef.current) return
    receiptRef.current = receipt
    if (usePrintPreview.getState().open) refresh()
  }, [receipt, refresh])

  /* الظهور في منتصف الشاشة عند **الفتح أو التكبير من الوضع المصغّر** فقط —
     تغيير عرض الورق (58↔80mm) من الإعدادات السريعة لا يعيد التمركز،
     فتبقى النافذة حيث سحبها المستخدم */
  const centeredRef = useRef(false)
  useEffect(() => {
    const active = open && !mini
    if (active && !centeredRef.current) {
      const width = paper + 28
      setPos({ x: Math.max(12, Math.round((window.innerWidth - width) / 2)), y: Math.max(12, Math.round(window.innerHeight * 0.08)) })
    }
    centeredRef.current = active
  }, [open, mini, paper])

  const doPrint = useCallback(() => {
    const current = usePrintPreview.getState().handle
    if (!current) return
    /* مفتاح الطباعة الصامتة يُقرأ لحظة الطباعة لا لحظة فتح المعاينة —
       لو بدّله المستخدم والمعاينة مفتوحة (أو من قسم الطباعة والمصغّرة معلقة)
       ننفّذ القيمة الجديدة */
    printHtml(current.html, { silent: useAppStore.getState().receipt.silentPrint ?? false })
    closePreview()
  }, [closePreview])

  /* اختصارات النافذة (Escape=إغلاق · Enter=طباعة) **في النافذة الكاملة فقط**:
     في الوضع المصغّر لا نلمس لوحة المفاتيح إطلاقاً — المستخدم يعمل في قسم
     إعدادات الطباعة (Enter يثبّت قيمة، Escape يغلق نافذة هناك) فلا نختطقها.
     وحتى في النافذة الكاملة نتجاهل المفاتيح الصادرة من حقول الإدخال والأزرار
     (كتابة التذييل مثلاً) فلا تطبع بالخطأ */
  useEffect(() => {
    if (!open || mini) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editable = !!target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))
      if (editable) return
      if (event.key === 'Escape') { event.stopPropagation(); closePreview() }
      else if (event.key === 'Enter') { event.stopPropagation(); doPrint() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closePreview, open, mini, doPrint])

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

  /* ── الوضع المصغّر: شريط حي أسفل الشاشة أثناء تعديل قسم الطباعة الكامل ── */
  if (mini) {
    const miniPaper = Math.round(paper * 0.62)
    return (
      <OverlayPortal>
        <div
          className="thermal-preview layer-modal thermal-preview-mini"
          dir="rtl"
          role="dialog"
          aria-label="معاينة مصغّرة حية"
          data-thermal-preview
          data-thermal-mini
          style={{ left: Math.max(12, Math.round((window.innerWidth - miniPaper - 24) / 2)), bottom: 12, width: miniPaper + 24 }}
        >
          <header className="thermal-preview-mini-head">
            <b><Printer size={12} /> معاينة حية</b>
            <span className="text-[10px] text-slate-400">تتحدث فوراً مع كل تغيير في إعدادات الطباعة</span>
            <span className="spacer" />
            <button type="button" onClick={() => setMini(false)} data-thermal-expand title="تكبير المعاينة وإرجاعها لوسط الشاشة"><Maximize2 size={13} /></button>
            <button type="button" onClick={closePreview} aria-label="إغلاق المعاينة"><X size={13} /></button>
          </header>
          <div className="thermal-preview-mini-paper" style={{ height: 190 }}>
            <div style={{ width: miniPaper, height: 190, overflow: 'hidden' }}>
              <iframe
                ref={frameRef}
                title="معاينة مصغّرة"
                style={{ width: paper, height: 306, transform: `scale(${miniPaper / paper})`, transformOrigin: 'top right' }}
              />
            </div>
          </div>
          <footer>
            <button type="button" className="is-primary" onClick={doPrint} data-thermal-print><Printer size={12} /> طباعة</button>
          </footer>
        </div>
      </OverlayPortal>
    )
  }

  return (
    <OverlayPortal>
      <div
        className="thermal-preview layer-modal"
        dir="rtl"
        role="dialog"
        aria-label={title}
        data-thermal-preview
        style={{ left: Math.min(pos?.x ?? 40, Math.max(8, window.innerWidth - paper - 36)), top: pos?.y ?? 40, width: paper + 28 }}
      >
        <header onPointerDown={startDrag} data-thermal-drag>
          <span className="thermal-grip" aria-hidden="true"><GripVertical size={13} /></span>
          <b><Printer size={13} /> {title}</b>
          <small>{wide ? 'فاتورة كبيرة — اسحب النافذة بحرية' : `رول ${receipt.paperWidth}mm — اسحب النافذة بحرية`}</small>
          <button type="button" onClick={closePreview} aria-label="إغلاق المعاينة"><X size={13} /></button>
        </header>

        {quickOpen && (
          <div className="thermal-preview-quick" data-thermal-quick dir="rtl">
            <div className="thermal-preview-quick-title">
              <SlidersHorizontal size={12} /> إعدادات سريعة — تنعكس على المعاينة فوراً
              <button type="button" onClick={() => setQuickOpen(false)} aria-label="إغلاق الإعدادات السريعة"><X size={12} /></button>
            </div>
            {/* نفس لوحة الإعدادات السريعة المشتركة (نافذة الفاتورة المنبثقة تستعملها أيضاً) */}
            <QuickPrintSettings wide={wide} />
            <button
              type="button"
              className="thermal-preview-quick-extra"
              onClick={() => { setMini(true); nav('/settings/printing') }}
              data-thermal-extra-settings
            >
              <PanelBottomOpen size={12} /> إعدادات إضافية — تصغير المعاينة وفتح قسم الطباعة (تتحدث المصغّرة فوراً)
            </button>
          </div>
        )}

        <div className="thermal-preview-paper">
          {/* العرض نسبي حتى لا يظهر أي تمرير أفقي مهما اختلفت هوامش المتصفح */}
          <iframe ref={frameRef} title="معاينة المستند" style={{ width: '100%', maxWidth: paper }} />
        </div>
        <footer>
          <button type="button" className="is-ghost" onClick={() => setQuickOpen((value) => !value)} data-thermal-settings><Settings2 size={12} /> إعدادات سريعة</button>
          <span className="spacer" />
          <button type="button" className="is-ghost" onClick={closePreview} data-thermal-cancel>إلغاء</button>
          <button type="button" className="is-primary" onClick={doPrint} data-thermal-print><Printer size={12} /> طباعة</button>
        </footer>
      </div>
    </OverlayPortal>
  )
}
