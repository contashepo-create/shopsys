/**
 * «التقرير الرسمي المُوحَّد» — التصميم ③ الدفتر التحليلي (طلب المالك 2026-10-27).
 * ─────────────────────────────────────────────────────────────────────
 * المبدأ: **الشاشة هي الورقة**. نموذج واحد خالص يُبنى مرة، فيُرسَم على
 * الشاشة بجداول نظامية (بلا كروت) ويُرسَم للطباعة بنفس الترتيب تماماً،
 * ثم يُفتح في نافذة «معاينة قبل الطباعة» التي تحمل زر طباعة.
 *
 * خصائص التصميم ③:
 *  · عمود رصيد تراكمي للمصروفات، وعمود «المتبقي بعد كل تحصيل».
 *  · تسوية ختامية بالمعادلة (مستخلص − محصّل = متبقٍ …).
 *  · ترويسة منشأة + بيانات المستند + خانات توقيع رسمية.
 * نواة خالصة بلا React ولا DOM — قابلة للفحص بالبوابات والاختبارات.
 */
import { renderReportShell, htmlTableHtml, escHtml, type ReportPrintSettings } from './reportPrint.ts'

export interface FormalReportCell {
  value: string
  /** قيمة ثانوية صغيرة أسفل القيمة (مثل اسم المورد تحت البيان) */
  sub?: string
  /** لون دال: موجب/سالب/تنبيه */
  tone?: 'positive' | 'negative' | 'warning' | 'muted'
}

export interface FormalReportRow {
  cells: (string | FormalReportCell)[]
  /** صف إجمالي/تسوية — يُظلَّل ويُفصل بخط */
  emphasis?: 'total' | 'subtotal' | 'highlight'
}

export interface FormalReportSection {
  title: string
  /** ملاحظة على يسار عنوان القسم (مثل «5 مستندات») */
  note?: string
  headers: string[]
  /** فهارس الأعمدة الرقمية (تضبط محاذاة الأرقام) */
  numCols?: number[]
  rows: FormalReportRow[]
  /** صف أخير يُرسَم كإجمالي */
  totalRow?: (string | FormalReportCell)[]
}

export interface FormalReportModel {
  title: string
  subtitle: string
  /** بيانات المستند: اسم المشروع، الكود، العميل، الفترة… */
  meta: { label: string; value: string }[]
  /** مؤشرات مالية بصيغة جدول من عمودين (لا بطاقات) */
  indicators?: { label: string; value: string; emphasis?: boolean }[]
  sections: FormalReportSection[]
  /** ملاحظات أسفل الجداول (مثل ربط الشيكات) */
  notes?: string[]
  /** تسوية ختامية بالمعادلة */
  equation?: { label: string; value: string; emphasis?: boolean }[]
  companyName: string
  logoDataUrl?: string
  printedBy?: string
  period?: string
  /** خانات التوقيع (تُؤخذ من إعدادات الطباعة) */
  signatures?: boolean
}

const toneClass: Record<NonNullable<FormalReportCell['tone']>, string> = {
  positive: 'fr-pos', negative: 'fr-neg', warning: 'fr-warn', muted: 'fr-muted',
}

/** يحوّل صفاً إلى مصفوفة نصوص آمنة لـ htmlTableHtml (بدون HTML خام من المستخدم).
 *  القيمة الثانوية (اسم الطرف تحت البيان) تُرسل مع النص حتى لا يفقدها print. */
function rowToStrings(row: FormalReportRow): string[] {
  return row.cells.map((c) => typeof c === 'string' ? c : c.sub ? `${c.value} — ${c.sub}` : c.value)
}

/** HTML الجسم داخل الغلاف الموحد (نواة خالصة) */
export function formalReportBodyHtml(model: FormalReportModel): string {
  const parts: string[] = []
  /* بيانات المستند — جدول من عمودين */
  if (model.meta.length) {
    const rows: string[][] = []
    for (let i = 0; i < model.meta.length; i += 2) {
      const a = model.meta[i]!, b = model.meta[i + 1]
      rows.push([a.label, a.value, b?.label ?? '', b?.value ?? ''])
    }
    parts.push(htmlTableHtml({
      headers: ['البيان', 'القيمة', 'البيان', 'القيمة'],
      rows,
    }))
  }
  /* المؤشرات — جدول لا كروت */
  if (model.indicators?.length) {
    parts.push(`<p class="sec" style="margin:12px 0 4px;padding:6px 10px;font-weight:800">${escHtml('الملخص المالي')}</p>`)
    parts.push(htmlTableHtml({
      headers: ['المؤشر', 'القيمة'],
      numCols: [1],
      rows: model.indicators.map((i) => [i.label, i.value]),
    }))
  }
  /* الأقسام التفصيلية */
  for (const section of model.sections) {
    parts.push(`<p class="sec" style="margin:14px 0 4px;padding:6px 10px;font-weight:800">${escHtml(section.title)}${section.note ? ` <small style="font-weight:500;color:#64748b">— ${escHtml(section.note)}</small>` : ''}</p>`)
    parts.push(htmlTableHtml({
      headers: section.headers,
      numCols: section.numCols,
      rows: section.rows.map(rowToStrings),
      totalRow: section.totalRow?.map((c) => typeof c === 'string' ? c : c.value),
    }))
  }
  if (model.notes?.length) {
    parts.push(`<div style="margin-top:10px">${model.notes.map((n) => `<p style="font-size:10.5px;color:#64748b;margin:4px 0">${escHtml(n)}</p>`).join('')}</div>`)
  }
  if (model.equation?.length) {
    parts.push(`<p class="sec" style="margin:14px 0 4px;padding:6px 10px;font-weight:800">${escHtml('التسوية الختامية')}</p>`)
    parts.push(htmlTableHtml({
      headers: ['البند', 'القيمة'],
      numCols: [1],
      rows: model.equation.map((e) => [e.label, e.value]),
    }))
  }
  return parts.join('')
}

/** HTML كامل للطباعة/المعاينة */
export function renderFormalReportHtml(model: FormalReportModel, settings: ReportPrintSettings): string {
  return renderReportShell({
    title: model.title,
    subtitle: model.subtitle,
    companyName: model.companyName,
    logoDataUrl: model.logoDataUrl,
    printedBy: model.printedBy,
    bodyHtml: formalReportBodyHtml(model),
    settings,
  })
}

/** أنماط الواجهة المشتركة — تُستدعى من مكوّن React (نصّ CSS خالص) */
export const FORMAL_REPORT_CSS = `
.fr-wrap{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;font-size:12.5px}
.dark .fr-wrap{background:#0f172a;color:#e2e8f0;border-color:#334155}
.fr-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border-bottom:2px solid #0f172a;flex-wrap:wrap}
.dark .fr-head{border-color:#94a3b8}
.fr-co{font-weight:900;font-size:17px}
.fr-meta-sub{font-size:10.5px;color:#64748b;margin-top:3px}
.fr-title{text-align:center;font-weight:900;font-size:19px;margin:14px 0 2px}
.fr-sub{text-align:center;color:#64748b;font-size:11.5px;margin:0 0 14px}
.fr-table{width:100%;border-collapse:collapse;font-size:12px}
.fr-table th{background:#0f172a;color:#fff;padding:8px 10px;text-align:right;font-weight:800;font-size:11px;white-space:nowrap}
.dark .fr-table th{background:#334155}
.fr-table td{padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
.dark .fr-table td{border-color:#334155}
.fr-table tbody tr:nth-child(even) td{background:#f8fafc}
.dark .fr-table tbody tr:nth-child(even) td{background:#1e293b22}
.fr-table .num{direction:ltr;text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}
.fr-table .fr-em-total td{font-weight:900;background:#eef2ff!important;border-top:2px solid #0f172a}
.dark .fr-table .fr-em-total td{background:#1e3a8a33!important;border-color:#94a3b8}
.fr-table .fr-em-subtotal td{font-weight:800;background:#f1f5f9!important}
.dark .fr-table .fr-em-subtotal td{background:#33415555!important}
.fr-table .fr-em-highlight td{font-weight:900;background:#ecfdf5!important;color:#065f46}
.dark .fr-table .fr-em-highlight td{background:#064e3b44!important;color:#6ee7b7}
.fr-pos{color:#047857}.fr-neg{color:#b91c1c}.fr-warn{color:#b45309}.fr-muted{color:#64748b}
.fr-cell-sub{display:block;font-size:10px;color:#94a3b8;font-weight:500;margin-top:1px}
.fr-sec{font-weight:900;font-size:13px;margin:18px 0 6px;padding:6px 10px;background:#f1f5f9;border-inline-start:3px solid #0f172a}
.dark .fr-sec{background:#1e293b}
.fr-sec small{font-weight:500;color:#64748b}
.fr-notes{margin-top:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:10.5px;color:#92400e}
.dark .fr-notes{background:#78350f33;border-color:#92400e;color:#fbbf24}
.fr-sign{display:flex;justify-content:space-between;gap:24px;margin-top:28px;padding-top:14px;border-top:1px dashed #cbd5e1;text-align:center}
.fr-sign div{flex:1;font-size:11px;font-weight:800}
.fr-sign .line{border-top:1.5px dotted #94a3b8;margin-top:26px;padding-top:4px;color:#94a3b8;font-size:9.5px;font-weight:500}
.fr-foot{margin-top:16px;padding-top:8px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:10px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dark .fr-foot{border-color:#334155}
.fr-actions{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
.dark .fr-actions{border-color:#334155}
.fr-body{padding:0 18px 20px}
@media print{.fr-actions{display:none}.fr-wrap{border:0;border-radius:0}.fr-table th{background:#0f172a!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

export { toneClass }
