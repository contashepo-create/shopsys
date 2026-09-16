/**
 * إعدادات طباعة التقارير المعممة (طلب المالك — بند إعدادات طباعة لكل تقرير):
 * غلاف موحّد لكل مطبوعات النظام غير الفواتير: التقارير المالية، اليومية،
 * كشوف الحساب، تقارير الأقسام — ترويسة منشأة + شعار + ألوان + تذييل + ورق.
 * نواة خالصة بلا واجهات — الواجهة في PrintSettingsPage.
 */

export interface ReportPrintSettings {
  /** حجم الورق للتقارير */
  paper: 'A4' | 'A5' | 'letter'
  /** الاتجاه */
  orientation: 'portrait' | 'landscape'
  /** اللون الرئيسي لرؤوس الجداول والعناوين */
  accentColor: string
  /** إظهار شعار المنشأة (من إعدادات الفاتورة) في ترويسة التقرير */
  showLogo: boolean
  /** إظهار اسم المنشأة */
  showCompanyName: boolean
  /** سطر ترويسة إضافي (عنوان/هاتف/سجل تجاري) — '' = بلا */
  headerLine: string
  /** تذييل التقرير — '' = الافتراضي */
  footerText: string
  /** حجم الخط الأساسي بالنقاط 9–14 */
  baseFontPt: number
  /** إظهار تاريخ ووقت الطباعة */
  showPrintedAt: boolean
  /** إظهار اسم المستخدم الطابع */
  showPrintedBy: boolean
  /** خانات توقيع رسمية (إعداد/مراجعة/اعتماد) — للتقارير المقدمة لجهات خارجية */
  showSignatures: boolean
}

export const DEFAULT_REPORT_PRINT: ReportPrintSettings = {
  paper: 'A4',
  orientation: 'portrait',
  accentColor: '#0f172a',
  showLogo: true,
  showCompanyName: true,
  headerLine: '',
  footerText: '',
  baseFontPt: 12,
  showPrintedAt: true,
  showPrintedBy: false,
  showSignatures: false,
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * الغلاف الموحّد لكل مطبوعات التقارير:
 * عنوان احترافي + ترويسة منشأة اختيارية + جسم HTML + تذييل — حسب الإعدادات.
 */
export function renderReportShell(args: {
  title: string // «ميزان المراجعة»، «دفتر اليومية العامة»، «سجل طبي»…
  subtitle: string // الفترة أو وصف الفلاتر
  companyName: string
  logoDataUrl?: string
  printedBy?: string
  bodyHtml: string
  settings: ReportPrintSettings
}): string {
  const s = args.settings
  const size = s.paper === 'letter' ? 'letter' : s.paper
  const logo = s.showLogo && args.logoDataUrl
    ? `<img src="${args.logoDataUrl}" alt="" style="max-height:52px;max-width:130px;object-fit:contain" />`
    : ''
  const meta: string[] = []
  if (s.showPrintedAt) meta.push(`طُبع ${new Date().toLocaleString('ar-EG')}`)
  if (s.showPrintedBy && args.printedBy) meta.push(`بواسطة ${esc(args.printedBy)}`)
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(args.title)}</title><style>
    @page { size: ${size} ${s.orientation}; margin: 14mm 12mm; }
    body{font-family:'Segoe UI',Tahoma,sans-serif;margin:0;color:#0f172a;font-size:${s.baseFontPt}px}
    .rp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:2.5px solid ${s.accentColor};padding-bottom:8px;margin-bottom:6px}
    .rp-co{font-size:${s.baseFontPt + 4}px;font-weight:900;color:${s.accentColor}}
    .rp-hl{font-size:${Math.max(8, s.baseFontPt - 2)}px;color:#64748b;margin-top:2px}
    h1{font-size:${s.baseFontPt + 6}px;margin:10px 0 2px;text-align:center;color:${s.accentColor};letter-spacing:.5px}
    .rp-sub{text-align:center;font-size:${Math.max(8, s.baseFontPt - 1)}px;color:#475569;margin:0 0 14px}
    table{width:100%;border-collapse:collapse;font-size:${Math.max(9, s.baseFontPt - 0.5)}px}
    th{background:${s.accentColor}12;color:${s.accentColor};padding:7px 9px;text-align:right;border-bottom:2px solid ${s.accentColor}55}
    td{padding:6px 9px;border-bottom:1px solid #e2e8f0}
    .num{direction:ltr;text-align:left;font-variant-numeric:tabular-nums}
    .total td{font-weight:800;background:#f8fafc;border-top:2px solid #94a3b8}
    .sec{font-weight:800;background:#f8fafc}
    tfoot td{font-weight:900;background:#f8fafc;border-top:2px solid #94a3b8}
    footer{margin-top:22px;font-size:${Math.max(8, s.baseFontPt - 3)}px;color:#94a3b8;text-align:center;border-top:1px dashed #cbd5e1;padding-top:6px}
  </style></head><body>
    ${s.showCompanyName || logo || s.headerLine ? `<div class="rp-head">
      <div>
        ${s.showCompanyName ? `<div class="rp-co">${esc(args.companyName)}</div>` : ''}
        ${s.headerLine ? `<div class="rp-hl">${esc(s.headerLine)}</div>` : ''}
      </div>
      ${logo}
    </div>` : ''}
    <h1>${esc(args.title)}</h1>
    <div class="rp-sub">${esc(args.subtitle)}</div>
    ${args.bodyHtml}
    ${s.showSignatures ? `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:34px;text-align:center;font-size:${Math.max(8, s.baseFontPt - 2)}px;font-weight:700;color:#334155">
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">إعداد</div></div>
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">مراجعة</div></div>
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">اعتماد</div></div>
    </div>` : ''}
    <footer>${s.footerText ? esc(s.footerText) + ' · ' : ''}${meta.join(' · ')}${meta.length || s.footerText ? ' · ' : ''}تَحَكَّم TAHAKAM ERP</footer>
  </body></html>`
}
