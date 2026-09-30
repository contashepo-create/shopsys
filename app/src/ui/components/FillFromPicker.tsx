/**
 * زر «تعبئة من» فوق حقل الطرف مباشرة (طلب المالك):
 * فاتورة الشراء تُعبَّأ من **أمر شراء**، وفاتورة البيع من **عرض سعر** أو
 * **بنود مشروع (BOQ)** — لوحة عائمة ملتصقة بالزر بلا تعتيم للخلفية.
 */
import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, FolderKanban, ClipboardList } from 'lucide-react'

export type FillSource = {
  id: string
  group: 'أوامر الشراء' | 'عروض الأسعار' | 'المشاريع'
  title: string
  hint: string
  lineCount: number
  apply: () => void
}

export function FillFromPicker({ sources, disabled = false }: { sources: FillSource[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc, true) }
  }, [open])

  const groups = [...new Set(sources.map((source) => source.group))]
  const icon = (group: FillSource['group']) => group === 'أوامر الشراء' ? <ClipboardList size={11} /> : group === 'عروض الأسعار' ? <FileSpreadsheet size={11} /> : <FolderKanban size={11} />

  return (
    <div className="fillfrom" ref={ref} data-fill-from>
      <button
        type="button"
        className="fillfrom-btn"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="عبّئ بنود هذه الفاتورة من أمر شراء أو عرض سعر أو مشروع"
        data-fill-from-open
      >
        <Download size={10} /> تعبئة من{sources.length > 0 && <span className="fillfrom-count">{sources.length}</span>}
      </button>
      {open && (
        <div className="fillfrom-panel layer-picker" dir="rtl" data-fill-from-panel role="dialog" aria-label="تعبئة الفاتورة من مستند">
          {sources.length === 0 && <div className="fillfrom-empty">لا مستندات جاهزة للتعبئة — سجّل أمر شراء أو عرض سعر أولاً.</div>}
          {groups.map((group) => (
            <div key={group} className="fillfrom-group">
              <h5>{icon(group)} {group}</h5>
              {sources.filter((source) => source.group === group).map((source) => (
                <button type="button" key={source.id} className="fillfrom-row" data-fill-source={source.id}
                  onClick={() => { source.apply(); setOpen(false) }}>
                  <span className="fillfrom-title">{source.title}<small>{source.hint}</small></span>
                  <span className="fillfrom-lines">{source.lineCount} بند</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
