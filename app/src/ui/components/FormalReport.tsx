/**
 * مكوّن «التقرير الرسمي» — التصميم ③ الدفتر التحليلي (طلب المالك 2026-10-27).
 * يعرض نفس نموذج النواة بشكل جداول نظامية بلا كروت، وكل زر طباعة يفتح
 * **معاينة** داخل التطبيق (openPrintPreview) تحمل زر طباعة وإعدادات حيّة.
 */
import { Fragment, type ReactNode } from 'react'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useToast } from './ui.tsx'
import { openPrintPreview } from './printPreviewStore.ts'
import { toCsv } from '../../core/security.ts'
import {
  FORMAL_REPORT_CSS, renderFormalReportHtml, toneClass,
  type FormalReportModel, type FormalReportRow, type FormalReportCell, type FormalReportSection,
} from '../../core/formalReport.ts'

interface Props {
  model: FormalReportModel
  /** اسم ملف التصدير */
  filename?: string
  /** هل يُعرض زر تصدير Excel؟ */
  allowExport?: boolean
  /** هل يُعرض زر الطباعة/المعاينة؟ */
  allowPrint?: boolean
  /** محتوى إضافي أسفل الترويسة (مثل أداة اختيار المشروع) */
  toolbar?: ReactNode
  /** هل تُعرض التوقيعات؟ (افتراضياً من إعدادات الطباعة) */
  showSignatures?: boolean
}

function cell(node: string | FormalReportCell, numeric: boolean, row: FormalReportRow) {
  const value = typeof node === 'string' ? node : node.value
  const sub = typeof node === 'string' ? undefined : node.sub
  const tone = typeof node === 'string' ? undefined : node.tone
  const cls = [numeric ? 'num' : '', tone ? toneClass[tone] : ''].filter(Boolean).join(' ')
  return <td className={cls}>{value}{sub && <span className="fr-cell-sub">{sub}</span>}{void row}</td>
}

export function FormalReport({ model, filename = 'report', allowExport = true, allowPrint = true, toolbar, showSignatures }: Props) {
  const { setup, receipt, reportPrint } = useAppStore()
  const toast = useToast()
  const buildHtml = () => renderFormalReportHtml(model, reportPrint)

  const print = () => {
    /* طلب المالك: «عند طلب طباعة أي تقرير أعطني معاينة لها وبها زر طباعة»
       ⇒ openPrintPreview يعرض النافذة الحرة التي تحمل زر طباعة فعلي،
       وrebuild يقرأ إعدادات الطباعة لحظة التغيير (معاينة حيّة). */
    openPrintPreview({
      html: buildHtml(),
      wide: true,
      title: `معاينة ${model.title} قبل الطباعة`,
      rebuild: buildHtml,
    })
  }

  const exportCsv = () => {
    const rows: Record<string, string>[] = []
    for (const section of model.sections) {
      for (const row of section.rows) {
        const record: Record<string, string> = { 'القسم': section.title }
        section.headers.forEach((h, i) => {
          const c = row.cells[i]
          record[h] = typeof c === 'string' ? c : c?.value ?? ''
        })
        rows.push(record)
      }
    }
    if (!rows.length) { toast.show('لا بيانات للتصدير', 'error'); return }
    const csv = toCsv(rows)
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`; a.click()
    URL.revokeObjectURL(url)
    toast.show('تم تصدير التقرير ✓')
  }

  const signatures = showSignatures ?? reportPrint.showSignatures

  const renderSection = (section: FormalReportSection, index: number) => (
    <div key={`${section.title}-${index}`}>
      <div className="fr-sec">{section.title}{section.note && <small> — {section.note}</small>}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="fr-table">
          <thead><tr>{section.headers.map((h, i) => <th key={i} className={section.numCols?.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
          <tbody>
            {section.rows.map((row, ri) => (
              <tr key={ri} className={row.emphasis ? `fr-em-${row.emphasis}` : ''}>
                {section.headers.map((_, ci) => <Fragment key={ci}>{cell(row.cells[ci] ?? '', !!section.numCols?.includes(ci), row)}</Fragment>)}
              </tr>
            ))}
            {section.totalRow && (
              <tr className="fr-em-total">
                {section.totalRow.map((c, ci) => <Fragment key={ci}>{cell(c, !!section.numCols?.includes(ci), { cells: [] })}</Fragment>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="fr-wrap" data-formal-report>
      <FormalReportStyle />
      <div className="fr-actions">
        {toolbar}
        {allowExport && <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300/60 text-emerald-700 dark:text-emerald-300 text-[12px] font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/20"><FileSpreadsheet size={14} /> تصدير Excel</button>}
        {allowPrint && <button type="button" onClick={print} data-print-formal className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-[12px] font-bold hover:bg-slate-900"><Printer size={14} /> معاينة وطباعة / PDF</button>}
      </div>
      <div className="fr-body">
        <div className="fr-head">
          <div>
            <div className="fr-co">{model.companyName || setup.shopName || 'المنشأة'}</div>
            {receipt.headerLines?.filter((l) => l.trim()).map((l, i) => <div className="fr-meta-sub" key={i}>{l}</div>)}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="fr-title" style={{ margin: 0 }}>{model.title}</div>
            <div className="fr-meta-sub">{model.period ?? model.subtitle}</div>
          </div>
        </div>
        <div className="fr-sub">{model.subtitle}</div>

        {model.meta.length > 0 && (
          <table className="fr-table" style={{ marginBottom: 12 }}>
            <tbody>
              {(() => {
                const pairs: { label: string; value: string }[][] = []
                for (let i = 0; i < model.meta.length; i += 2) pairs.push(model.meta.slice(i, i + 2))
                return pairs.map((pair, i) => (
                  <tr key={i}>
                    <td style={{ width: '16%', color: '#64748b', fontWeight: 700 }}>{pair[0]!.label}</td>
                    <td style={{ width: '34%', fontWeight: 700 }}>{pair[0]!.value}</td>
                    <td style={{ width: '16%', color: '#64748b', fontWeight: 700 }}>{pair[1]?.label ?? ''}</td>
                    <td style={{ width: '34%', fontWeight: 700 }}>{pair[1]?.value ?? ''}</td>
                  </tr>
                ))
              })()}
            </tbody>
          </table>
        )}

        {!!model.indicators?.length && (
          <>
            <div className="fr-sec">الملخص المالي</div>
            <table className="fr-table">
              <thead><tr><th>المؤشر</th><th className="num">القيمة</th></tr></thead>
              <tbody>
                {model.indicators.map((ind, i) => (
                  <tr key={i} className={ind.emphasis ? 'fr-em-highlight' : ''}>
                    <td>{ind.label}</td><td className="num">{ind.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {model.sections.map(renderSection)}

        {!!model.notes?.length && <div className="fr-notes">{model.notes.map((n, i) => <div key={i}>{n}</div>)}</div>}

        {!!model.equation?.length && (
          <>
            <div className="fr-sec">التسوية الختامية</div>
            <table className="fr-table">
              <thead><tr><th>البند</th><th className="num">القيمة</th></tr></thead>
              <tbody>
                {model.equation.map((e, i) => (
                  <tr key={i} className={e.emphasis ? 'fr-em-total' : ''}>
                    <td>{e.label}</td><td className="num">{e.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {signatures && (
          <div className="fr-sign">
            {['إعداد', 'مراجعة', 'اعتماد'].map((s) => <div key={s}>{s}<div className="line">الاسم والتوقيع</div></div>)}
          </div>
        )}
        <div className="fr-foot">
          <span>تَحَكَّم TAHAKAM ERP</span>
          <span>{new Date().toLocaleString('ar-EG')}{model.printedBy ? ` · ${model.printedBy}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

/** تُحقن مرة واحدة في كل صفحة تستخدم التقرير الرسمي */
let styleInjected = false
function FormalReportStyle() {
  if (!styleInjected) {
    const el = document.createElement('style')
    el.setAttribute('data-formal-report-css', '')
    el.textContent = FORMAL_REPORT_CSS
    document.head.appendChild(el)
    styleInjected = true
  }
  return null
}
