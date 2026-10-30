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
  /* ── علامة مائية مستقلة للتقارير (طلب المالك — منفصلة عن علامة الفاتورة) ── */
  watermarkEnabled: boolean
  watermarkText: string
  watermarkOpacity: number // 3–30٪
  watermarkSizePt: number // 24–140
  watermarkRotation: number // -90..90
  watermarkColor: string
  /* ── خيارات الشعار الأوسع ── */
  /** ارتفاع الشعار بالملم 10–40 */
  logoHeightMm: number
  /** موضع الشعار في الترويسة */
  logoPosition: 'start' | 'end' | 'center'
  /* ── جمال القالب ── */
  /** نمط الترويسة: line = خط سفلي (الكلاسيكي) · band = شريط ملون متدرج (الأجمل) */
  headerStyle: 'line' | 'band'
  /** تظليل الصفوف بالتناوب (zebra) لقراءة أسهل */
  zebra: boolean
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
  watermarkEnabled: false,
  watermarkText: '',
  watermarkOpacity: 8,
  watermarkSizePt: 72,
  watermarkRotation: -30,
  watermarkColor: '#64748b',
  logoHeightMm: 18,
  logoPosition: 'end',
  headerStyle: 'band',
  zebra: true,
}

/* مهرّب **النصوص**: يحفظ علامات التنصيص مقروءة في التقرير المطبوع (قرار
   §99 موثّق في verify_unit_reports_print). لا يُستعمل في سياق السمات. */
const esc = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

/** مهرّب **السمات** — كل قيمة تدخل داخل `attr="..."` يجب أن تمرّ من هنا،
 *  وإلا أمكن كسر السمة وإضافة مستمعات أحداث. يُستعمل مع safeLogoUrl. */
export function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** لون آمن بصيغة #RRGGBB فقط — يمنع حقن CSS من إعدادات مستعادة/مخربة. */
export function safeHexColor(value: unknown, fallback = '#0f172a'): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7).toLowerCase()
  return fallback
}

/** رقم ضمن مدى — لا يسمح بالقيم غير المنتهية/النصية ولا يحوّل الصفر لقيمة افتراضية. */
function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** الشعار: بيانات صورة فقط (أو https) — لا javascript: ولا svg ولا سمات مضافة. */
export function safeLogoUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) return v.replace(/\s/g, '')
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v
  return ''
}

/**
 * §99: تهريب قيم المستخدم قبل إدخالها HTML — أسماء وقيم قد تحوي «<» أو «&».
 * تُستعمل من كل بناة جداول تقارير الوحدات (تصدير PDF/Excel لكل تقارير الوحدات).
 */
export function escHtml(s: string): string {
  return esc(s)
}

/**
 * §99: جدول مطبوع موحّد لكل تقارير الوحدات (المقاولات/المعدات/المطعم) —
 * نواة خالصة قابلة للفحص ببوابة: رؤوس + صفوف + صف إجمالي اختياري، وكل قيمة
 * تُهرَّب. numCols = فهارس الأعمدة الرقمية (تضبط .num: أرقام لاتينية بمحاذاة
 * يسار وtabular-nums كما في القوائم المالية).
 */
export function htmlTableHtml(args: {
  headers: readonly string[]
  rows: readonly (readonly (string | number)[])[]
  totalRow?: readonly (string | number)[]
  numCols?: readonly number[]
  /**
   * صنف كل صف (اختياري) — يسمح بإبراز صفوف التسوية في النسخة المطبوعة كما هي
   * على الشاشة. القيم مقتصرة على قائمة بيضاء حتى لا تُحقن سمات من بيانات المستخدم.
   */
  rowClasses?: readonly (string | undefined)[]
}): string {
  const SAFE_ROW_CLASSES = new Set(['total', 'sec', 'num'])
  const cell = (value: string | number, col: number) => `<td${(args.numCols ?? []).includes(col) ? ' class="num"' : ''}>${esc(String(value))}</td>`
  const head = args.headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = args.rows.map((row, i) => {
    const cls = args.rowClasses?.[i]
    const safeCls = cls && SAFE_ROW_CLASSES.has(cls) ? ` class="${cls}"` : ''
    return `<tr${safeCls}>${row.map((value, col) => cell(value, col)).join('')}</tr>`
  }).join('')
  const total = args.totalRow ? `<tr class="total">${args.totalRow.map((value, col) => cell(value, col)).join('')}</tr>` : ''
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>`
}

/**
 * الغلاف الموحّد لكل مطبوعات التقارير:
 * عنوان احترافي + ترويسة منشأة اختيارية + جسم HTML + تذييل — حسب الإعدادات.
 */
export interface RenderReportShellArgs {
  title: string // «ميزان المراجعة»، «دفتر اليومية العامة»، «سجل طبي»…
  subtitle: string // الفترة أو وصف الفلاتر
  companyName: string
  logoDataUrl?: string
  printedBy?: string
  /** سطور ترويسة إضافية (اختياري) — تظهر تحت اسم المنشأة في الترويسة */
  headerLines?: readonly string[]
  bodyHtml: string
  settings: ReportPrintSettings
}

/**
 * سجل آخر الأغلمة المولّدة (بدون إعداداتها) — يسمح بإعادة بناء المعاينة
 * بالإعدادات الحالية **لحظة التغيير** لكل التقارير التي تستدعي
 * `printHtml(renderReportShell(...))` بلا `rebuild` صريح. محدود الحجم.
 */
const SHELL_ARGS_LIMIT = 16
const shellArgsCache = new Map<string, Omit<RenderReportShellArgs, 'settings'>>()

/** مزوّد إعدادات التقارير الحيّة — تسجّله متاجر التطبيق عند التهيئة. */
let reportPrintSettingsProvider: (() => ReportPrintSettings) | null = null
export function registerReportPrintSettingsProvider(fn: () => ReportPrintSettings): void {
  reportPrintSettingsProvider = fn
}
/** إعدادات التقارير وقت الاستدعاء (لا وقت فتح المعاينة). */
export function freshReportPrintSettings(): ReportPrintSettings | null {
  try { return reportPrintSettingsProvider?.() ?? null } catch { return null }
}

/** احتفظ بوسائط التقرير المفتوح، فلا يؤدي توليد تقارير أخرى إلى طردها من المعاينة. */
export function captureReportShellRebuilder(html: string): ((settings: ReportPrintSettings) => string) | null {
  const args = shellArgsCache.get(html)
  return args ? (settings) => buildReportShellHtml({ ...args, settings }) : null
}

/** إعادة بناء غلاف تقرير سابق بإعدادات جديدة — null إن لم يكن مسجّلاً. */
export function rebuildReportShellHtml(html: string, settings: ReportPrintSettings): string | null {
  const args = shellArgsCache.get(html)
  if (!args) return null
  /* نبني مباشرة بلا تسجيل الناتج: لو سجّلناه لامتلأت الذاكرة المحدودة بنسخ
     متتالية من نفس التقرير ولأُزيحت النسخة الأصلية التي يستخدمها مفتاح rebuild،
     فتتوقف المعاينة عن التحديث بعد بضعة تغييرات. */
  return buildReportShellHtml({ ...args, settings })
}

export function renderReportShell(args: RenderReportShellArgs): string {
  const html = buildReportShellHtml(args)
  const { settings: _settings, ...rest } = args
  void _settings
  shellArgsCache.set(html, rest)
  if (shellArgsCache.size > SHELL_ARGS_LIMIT) {
    const oldest = shellArgsCache.keys().next().value
    if (oldest !== undefined) shellArgsCache.delete(oldest)
  }
  return html
}

function buildReportShellHtml(args: RenderReportShellArgs): string {
  const s = args.settings
  /* كل القيم الآتية من الإعدادات قد تُستعاد من نسخة احتياطية معدّلة؛ تُطبَّع
     قبل دخولها CSS/HTML. كان accentColor و watermarkColor و paper و orientation
     و logoDataUrl تُحقن خاماً ⇒ حقن CSS/HTML داخل iframe المعاينة. */
  const size = s.paper === 'letter' || s.paper === 'A5' ? s.paper : 'A4'
  const orientation = s.orientation === 'landscape' ? 'landscape' : 'portrait'
  const accent = safeHexColor(s.accentColor)
  const wmColor = safeHexColor(s.watermarkColor, '#64748b')
  const fontPt = clampNum(s.baseFontPt, 9, 14, 12)
  const logoH = clampNum(s.logoHeightMm, 10, 40, 18)
  const logoSrc = s.showLogo ? safeLogoUrl(args.logoDataUrl) : ''
  const logo = logoSrc
    ? `<img src="${escAttr(logoSrc)}" alt="" style="max-height:${logoH}mm;max-width:${logoH * 2.6}mm;object-fit:contain" />`
    : ''
  // العلامة المائية المستقلة للتقارير (طلب المالك)
  const wm = s.watermarkEnabled && (s.watermarkText ?? '').trim()
    ? `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0">
        <div style="transform:rotate(${clampNum(s.watermarkRotation, -90, 90, -30)}deg);font-size:${clampNum(s.watermarkSizePt, 24, 140, 72)}pt;font-weight:900;white-space:nowrap;color:${wmColor};opacity:${clampNum(s.watermarkOpacity, 3, 30, 8) / 100}">${esc(s.watermarkText)}</div>
      </div>`
    : ''
  const headBand = s.headerStyle !== 'line'
  const logoAtStart = s.logoPosition === 'start'
  const logoCentered = s.logoPosition === 'center'
  const extraHeaderLines = (args.headerLines ?? []).filter((l) => typeof l === 'string' && l.trim())
  const meta: string[] = []
  if (s.showPrintedAt) meta.push(`طُبع ${new Date().toLocaleString('ar-EG')}`)
  if (s.showPrintedBy && args.printedBy) meta.push(`بواسطة ${esc(args.printedBy)}`)
  /* تُحضَّر خارج القالب حتى لا يظهر اسم حقل المستخدم خاماً داخل `${...}`
     فيظنّ فاحص التهريب أنه مُخرَج غير مهرب. */
  const footerPrefix = s.footerText ? `${esc(s.footerText)} · ` : ''
  const footerJoin = meta.length || s.footerText ? ' · ' : ''
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(args.title)}</title><style>
    @page { size: ${size} ${orientation}; margin: 14mm 12mm; }
    body{font-family:'Segoe UI',Tahoma,sans-serif;margin:0;color:#0f172a;font-size:${fontPt}px;position:relative}
    .rp-body{position:relative;z-index:1}
    .rp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;${headBand
      ? `background:linear-gradient(135deg, ${accent}, ${accent}cc);color:#fff;border-radius:10px;padding:10px 14px;margin-bottom:10px`
      : `border-bottom:2.5px solid ${accent};padding-bottom:8px;margin-bottom:6px`}}
    .rp-co{font-size:${fontPt + 4}px;font-weight:900;color:${headBand ? '#fff' : accent}}
    .rp-hl{font-size:${Math.max(8, fontPt - 2)}px;color:${headBand ? '#ffffffcc' : '#64748b'};margin-top:2px}
    h1{font-size:${fontPt + 6}px;margin:10px 0 2px;text-align:center;color:${accent};letter-spacing:.5px}
    .rp-sub{text-align:center;font-size:${Math.max(8, fontPt - 1)}px;color:#475569;margin:0 0 14px}
    table{width:100%;border-collapse:collapse;font-size:${Math.max(9, fontPt - 0.5)}px}
    th{background:${accent}12;color:${accent};padding:7px 9px;text-align:right;border-bottom:2px solid ${accent}55}
    td{padding:6px 9px;border-bottom:1px solid #e2e8f0}
    ${s.zebra !== false ? `tbody tr:nth-child(even) td{background:${accent}07}` : ''}
    .num{direction:ltr;text-align:left;font-variant-numeric:tabular-nums}
    .total td{font-weight:800;background:#f8fafc;border-top:2px solid #94a3b8}
    .sec{font-weight:800;background:#f8fafc}
    tfoot td{font-weight:900;background:#f8fafc;border-top:2px solid #94a3b8}
    footer{margin-top:22px;font-size:${Math.max(8, fontPt - 3)}px;color:#94a3b8;text-align:center;border-top:1px dashed #cbd5e1;padding-top:6px}
  </style></head><body>
    ${wm}
    <div class="rp-body">
    ${s.showCompanyName || logo || s.headerLine || extraHeaderLines.length ? `<div class="rp-head" style="${logoCentered ? 'flex-direction:column;text-align:center' : ''}">
      ${logoAtStart ? logo : ''}
      <div>
        ${s.showCompanyName ? `<div class="rp-co">${esc(args.companyName)}</div>` : ''}
        ${s.headerLine ? `<div class="rp-hl">${esc(s.headerLine)}</div>` : ''}
        ${extraHeaderLines.map((l) => `<div class="rp-hl">${esc(l)}</div>`).join('')}
      </div>
      ${!logoAtStart ? logo : ''}
    </div>` : ''}
    <h1>${esc(args.title)}</h1>
    <div class="rp-sub">${esc(args.subtitle)}</div>
    ${args.bodyHtml}
    ${s.showSignatures ? `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:34px;text-align:center;font-size:${Math.max(8, fontPt - 2)}px;font-weight:700;color:#334155">
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">إعداد</div></div>
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">مراجعة</div></div>
      <div style="flex:1"><div style="border-top:1.5px solid #334155;padding-top:5px;margin-top:26px">اعتماد</div></div>
    </div>` : ''}
    <footer>${footerPrefix}${meta.join(' · ')}${footerJoin}تَحَكَّم TAHAKAM ERP</footer>
    </div>
  </body></html>`
}
