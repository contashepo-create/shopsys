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
import { safeLogoUrl } from '../../core/reportPrint.ts'
import {
  FORMAL_REPORT_CSS, renderFormalReportHtml, toneClass,
  type FormalReportModel, type FormalReportCell, type FormalReportSection,
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

/** نص الخلية كما يظهر في الطباعة: القيمة + قيمتها الثانوية (اسم المورد…) */
function cellText(node: string | FormalReportCell | undefined): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  return node.sub ? `${node.value} — ${node.sub}` : node.value
}

function cell(node: string | FormalReportCell, numeric: boolean) {
  const value = typeof node === 'string' ? node : node.value
  const sub = typeof node === 'string' ? undefined : node.sub
  const tone = typeof node === 'string' ? undefined : node.tone
  const cls = [numeric ? 'num' : '', tone ? toneClass[tone] : ''].filter(Boolean).join(' ')
  return <td className={cls}>{value}{sub && <span className="fr-cell-sub">{sub}</span>}</td>
}

export function FormalReport({ model, filename = 'report', allowExport = true, allowPrint = true, toolbar, showSignatures }: Props) {
  const { setup, receipt, reportPrint } = useAppStore()
  const toast = useToast()
  /* توحيد الترويسة: نفس بيانات الشاشة تُرسل للطباعة/المعاينة. كان الشعار
     واسم المُعِدّ يصلان للطباعة فقط إن ضبطهما بانِي التقرير، بينما تعرض
     الشاشة سطور الترويسة من الإعدادات ⇒ تقريران بترويسة مختلفة. */
  const resolved: FormalReportModel = {
    ...model,
    companyName: model.companyName || setup?.shopName || 'المنشأة',
    headerLines: model.headerLines ?? receipt?.headerLines ?? [],
    logoDataUrl: model.logoDataUrl ?? receipt?.logoDataUrl ?? undefined,
    printedBy: model.printedBy ?? (setup?.ownerName || undefined),
  }
  const buildHtml = () => {
    /* `rebuild` يُستدعى لاحقاً من نافذة المعاينة بعد تغيير الإعدادات؛ قراءة
       المتجر وقت الاستدعاء (لا وقت فتح المعاينة) هي ما يجعلها معاينة حيّة فعلية. */
    const live = useAppStore.getState()
    const settings = live.reportPrint ?? reportPrint
    const liveModel: FormalReportModel = {
      ...model,
      companyName: model.companyName || live.setup?.shopName || 'المنشأة',
      headerLines: model.headerLines ?? live.receipt?.headerLines ?? [],
      logoDataUrl: model.logoDataUrl ?? live.receipt?.logoDataUrl ?? undefined,
      printedBy: model.printedBy ?? (live.setup?.ownerName || undefined),
    }
    return renderFormalReportHtml(liveModel, settings)
  }

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
    /* الجولة السادسة: كان التصدير يُخرج سطور الأقسام وحدها — فيفقد الملف
       بيانات المستند والملخص المالي والتسوية والملاحظات وصفوف الإجمالي،
       أي أن «تصدير Excel» كان ناقصاً مقارنة بالتقرير الرسمي المعروض.
       كما كان يُسقط القيمة الثانوية (اسم المورد) ويضيف BOMاً ثانياً. */
    const rows: Record<string, string>[] = []
    const add = (section: string, label: string, value: string, detail = '') =>
      rows.push({ 'القسم': section, 'البيان': label, 'القيمة': value, 'التفاصيل': detail })
    add('التقرير', model.title, resolved.companyName, model.subtitle)
    for (const m of model.meta) add('بيانات المستند', m.label, m.value)
    for (const i of model.indicators ?? []) add('الملخص المالي', i.label, i.value)
    for (const section of model.sections) {
      for (const row of section.rows) {
        const record: Record<string, string> = { 'القسم': section.title }
        section.headers.forEach((h, i) => { record[h] = cellText(row.cells[i]) })
        rows.push(record)
      }
      if (section.totalRow) {
        const record: Record<string, string> = { 'القسم': `${section.title} — الإجمالي` }
        section.totalRow.forEach((c, i) => { record[section.headers[i] ?? `عمود ${i + 1}`] = cellText(c) })
        rows.push(record)
      }
    }
    for (const n of model.notes ?? []) add('ملاحظات المراجعة', n, '')
    for (const e of model.equation ?? []) add('التسوية الختامية', e.label, e.value)
    if (!rows.length) { toast.show('لا بيانات للتصدير', 'error'); return }
    /* toCsv يضيف BOM بنفسه — لا تُضفه مرة ثانية. */
    const csv = toCsv(rows)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`; a.click()
    /* تأجيل التحرير: بعض المتصفحات تُلغي التنزيل لو حُرِّر الرابط فور النقر. */
    setTimeout(() => URL.revokeObjectURL(url), 1000)
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
                {section.headers.map((_, ci) => <Fragment key={ci}>{cell(row.cells[ci] ?? '', !!section.numCols?.includes(ci))}</Fragment>)}
              </tr>
            ))}
            {section.totalRow && (
              <tr className="fr-em-total">
                {section.totalRow.map((c, ci) => <Fragment key={ci}>{cell(c, !!section.numCols?.includes(ci))}</Fragment>)}
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
            <div className="fr-co">{resolved.companyName}</div>
            {resolved.headerLines?.filter((l) => l.trim()).map((l, i) => <div className="fr-meta-sub" key={i}>{l}</div>)}
            {resolved.printedBy && <div className="fr-meta-sub">أعدّه: {resolved.printedBy}</div>}
          </div>
          {safeLogoUrl(resolved.logoDataUrl) && reportPrint?.showLogo !== false && (
            <img src={safeLogoUrl(resolved.logoDataUrl)} alt="" style={{ maxHeight: 48, maxWidth: 120, objectFit: 'contain' }} />
          )}
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
          <span>{new Date().toLocaleString('ar-EG')}{resolved.printedBy ? ` · ${resolved.printedBy}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

/** تُحقن مرة واحدة في كل صفحة تستخدم التقرير الرسمي.
 *  كان الاعتماد على راية وحدة محفوظة في الذاكرة يجعل التنسيق يختفي نهائياً
 *  إذا أُعيد بناء `document.head` (اختبارات/تنظيف DOM) لأن المتغيّر يبقى true.
 *  الفحص الحقيقي لوجود العنصر في DOM هو المصدر الوحيد للحقيقة. */
function FormalReportStyle() {
  if (typeof document !== 'undefined' && document.head && !document.head.querySelector('style[data-formal-report-css]')) {
    const el = document.createElement('style')
    el.setAttribute('data-formal-report-css', '')
    el.textContent = FORMAL_REPORT_CSS
    document.head.appendChild(el)
  }
  return null
}
