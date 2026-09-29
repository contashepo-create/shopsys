/**
 * لوحة «الأخطاء قبل الترحيل» (الموجة ① من خطة UX — لا تمسّ تقسيم الفاتورة).
 *
 * بدل أن يكتشف المستخدم المشكلة **بعد** ضغط الترحيل رسالةً واحدة، يرى هنا كل
 * الملاحظات مجموعة: مانعة (حمراء) وتحذيرية (كهرمانية)، وكل ملاحظة قابلة للنقر
 * تقفز إلى مصدرها في المستند. لوحة عائمة ملتصقة بزر الترحيل — بلا تعتيم ولا عزل.
 */
import { useEffect, useRef } from 'react'
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from 'lucide-react'

export type PrePostIssue = {
  id: string
  /** blocking = يمنع الترحيل · warning = يحتاج انتباهاً فقط */
  level: 'blocking' | 'warning'
  text: string
  hint?: string
  /** محدّد CSS للعنصر الذي يُقفز إليه ويُبرز */
  focus?: string
}

export function PrePostChecks({ issues, open, onClose }: { issues: PrePostIssue[]; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointer, true) }
  }, [onClose, open])
  if (!open) return null

  const blocking = issues.filter((issue) => issue.level === 'blocking')
  const jump = (issue: PrePostIssue) => {
    if (!issue.focus) return
    const target = document.querySelector<HTMLElement>(issue.focus)
    if (!target) return
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    target.focus?.()
    target.classList.add('prepost-flash')
    setTimeout(() => target.classList.remove('prepost-flash'), 900)
    onClose()
  }

  return (
    <div className="prepost-panel layer-picker" dir="rtl" ref={ref} data-prepost-panel role="dialog" aria-label="مراجعة قبل الترحيل">
      <div className="prepost-head">
        <b>{blocking.length ? <ShieldAlert size={13} /> : <CheckCircle2 size={13} />} مراجعة قبل الترحيل</b>
        <span className="prepost-count">{issues.length ? `${blocking.length} مانع · ${issues.length - blocking.length} تنبيه` : 'لا ملاحظات'}</span>
        <button type="button" onClick={onClose} aria-label="إغلاق المراجعة"><X size={13} /></button>
      </div>
      <div className="prepost-body">
        {issues.length === 0 && (
          <div className="prepost-ok"><CheckCircle2 size={22} /><b>الفاتورة جاهزة للترحيل</b><span>لا مخزون سالب ولا بيع تحت التكلفة ولا تجاوز لحد الائتمان.</span></div>
        )}
        {issues.map((issue) => (
          <button
            type="button"
            key={issue.id}
            className={`prepost-row is-${issue.level}${issue.focus ? ' is-jump' : ''}`}
            onClick={() => jump(issue)}
            data-prepost-issue={issue.level}
          >
            {issue.level === 'blocking' ? <ShieldAlert size={13} /> : <AlertTriangle size={13} />}
            <span className="prepost-text">{issue.text}{issue.hint && <small>{issue.hint}</small>}</span>
            {issue.focus && <span className="prepost-goto">اذهب</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
