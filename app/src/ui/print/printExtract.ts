/**
 * §94: مستند المستخلص المطبوع — تصميم شامل جديد (طلب المالك: «شكل المستخلص
 * وترتيب العناصر به قصور كبير والعناصر غير مرتبطة وتنسيقه عقيم وغير متوازن
 * والخطوط متداخلة مع الحقول»).
 *
 * وثيقة A4 رسمية مقدَّمة للجهة المالكة:
 *   ترويسة منشأة + شبكة بيانات متوازنة + جدول بنود BOQ (نسبة سابقة/حالية/قيمة
 *   الشريحة) + سلّم الإجماليات (أعمال → ضريبة → محتجز → استرداد دفعة → الصافي)
 *   + صندوق التراكمي ونسبة الإنجاز + توقيعات ثلاثية متوازنة.
 * كل حقل بصف مستقل محاذى — لا تداخل خطوط ولا أعمدة عائمة.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface ExtractPrintLine {
  code: string
  descriptionAr: string
  prevPercent: number
  newPercent: number
  /** قيمة شريحة هذا المستخلص للبند — منسقة نصياً */
  value: string
}

export function renderExtractHtml(args: {
  shopName: string
  extractNumber: string
  dateIso: string
  projectName: string
  projectCode: string
  clientName: string
  contractValue: string // منسق — '' = غير محدد
  description: string
  previousGross: string // تراكمي الأعمال بالمستخلصات السابقة (منسق)
  currentGross: string
  cumulativeGross: string
  progressPercent: number | null // تراكمي ÷ قيمة العقد — null = عقد بلا قيمة
  vat: string // '' = بلا
  retention: string // '' = بلا محتجز
  retentionPercent: number
  /** §94: بنود المستخلص من BOQ — تُعرض جدولاً تفصيلياً إن وُجدت */
  lines?: ExtractPrintLine[]
  /** §94: ما استُرد من الدفعة المقدمة في هذا المستخلص — منسق، '' = لا استرداد */
  advanceRecovery?: string
  due: string // الصافي المستحق
  payment: 'cash' | 'credit'
  currencySymbol?: string
}): string {
  const sym = args.currencySymbol ?? ''
  const lines = args.lines ?? []
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>مستخلص ${esc(args.extractNumber)}</title><style>
    @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1e293b; margin: 0; font-size: 12.5px; line-height: 1.55; }
    /* ── الترويسة: شعار يمين + هوية المستند يسار — صف واحد ثابت ── */
    .doc-head { display: flex; align-items: stretch; justify-content: space-between; border: 2px solid #9a3412; border-radius: 10px; overflow: hidden; }
    .doc-head .brand { padding: 12px 16px; min-width: 34%; }
    .doc-head .brand .shop { font-size: 17px; font-weight: 900; color: #9a3412; line-height: 1.3; }
    .doc-head .brand .kind { font-size: 11px; color: #64748b; margin-top: 2px; }
    .doc-head .docid { background: #9a3412; color: #fff; padding: 12px 18px; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
    .doc-head .docid b { font-size: 19px; letter-spacing: .5px; }
    .doc-head .docid span { font-size: 11px; opacity: .92; }
    /* ── شبكة بيانات المشروع: أعمدة متساوية كل خانة ببطاقة مستقلة ── */
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0; }
    .meta .cell { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; min-height: 44px; background: #f8fafc; }
    .meta .cell.wide { grid-column: span 3; }
    .meta .lbl { display: block; font-size: 10.5px; font-weight: 700; color: #64748b; margin-bottom: 1px; }
    .meta .val { display: block; font-size: 12.5px; font-weight: 800; color: #0f172a; word-break: break-word; }
    /* ── جدول البنود ── */
    .sect { margin: 12px 0 6px; display: flex; align-items: center; gap: 8px; }
    .sect .t { font-size: 13px; font-weight: 900; color: #9a3412; white-space: nowrap; }
    .sect .rule { flex: 1; border-top: 2px solid #fdba74; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td, th { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: middle; word-wrap: break-word; }
    th { background: #fff7ed; color: #9a3412; font-size: 11px; font-weight: 800; }
    .num { font-family: 'Consolas', 'Courier New', monospace; direction: ltr; text-align: left; font-weight: 700; }
    .pct { font-family: 'Consolas', monospace; direction: ltr; text-align: center; font-weight: 700; }
    td.desc { font-size: 12px; }
    .total td { background: #fff7ed; font-weight: 900; font-size: 13px; }
    /* ── سلّم الإجماليات: خانات مستقلة بلا تداخل ── */
    .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-top: 4px; }
    .totals .row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding: 5px 2px; }
    .totals .row span { font-size: 12px; font-weight: 700; color: #334155; }
    .totals .row b { font-family: 'Consolas', monospace; direction: ltr; font-size: 13px; }
    .totals .due { grid-column: span 2; background: #9a3412; color: #fff; border-radius: 8px; padding: 9px 14px; display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .totals .due span { font-size: 13.5px; font-weight: 900; }
    .totals .due b { font-family: 'Consolas', monospace; direction: ltr; font-size: 17px; }
    .totals .due small { display: block; font-size: 10.5px; font-weight: 400; opacity: .9; }
    /* ── التراكمي والإنجاز ── */
    .cum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
    .cum .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 10px; text-align: center; background: #fff; }
    .cum .box .l { display: block; font-size: 10.5px; font-weight: 700; color: #64748b; }
    .cum .box .v { display: block; font-family: 'Consolas', monospace; direction: ltr; font-size: 14px; font-weight: 800; }
    .cum .box.cur { background: #fff7ed; border-color: #fdba74; }
    .progress-wrap { margin-top: 10px; }
    .progress-lbl { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; color: #9a3412; margin-bottom: 3px; }
    .progress { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 99px; height: 15px; overflow: hidden; }
    .progress .bar { background: linear-gradient(90deg, #ea580c, #f97316); height: 100%; border-radius: 99px; }
    .desc-block { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 7px 10px; margin-top: 10px; background: #f8fafc; }
    .desc-block .lbl { font-size: 10.5px; font-weight: 800; color: #64748b; }
    .desc-block .txt { font-size: 12px; white-space: pre-wrap; }
    /* ── التوقيعات ── */
    .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 34px; }
    .sig { text-align: center; }
    .sig .role { font-size: 11.5px; font-weight: 800; color: #334155; }
    .sig .who { font-size: 10.5px; color: #64748b; margin: 1px 0 26px; min-height: 14px; }
    .sig .line { border-top: 1.5px solid #334155; padding-top: 4px; font-size: 10px; color: #64748b; }
    .foot { margin-top: 16px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    @media print { .noprint { display: none; } }
  </style></head><body>
    <div class="doc-head">
      <div class="brand">
        <div class="shop">${esc(args.shopName)}</div>
        <div class="kind">مستخلص أعمال مقدم للجهة المالكة — نشاط المقاولات</div>
      </div>
      <div class="docid">
        <span>مستخلص رقم</span>
        <b>${esc(args.extractNumber)}</b>
        <span>التاريخ: ${esc(args.dateIso.slice(0, 10))}${args.payment === 'cash' ? ' · محصل نقدي' : ' · آجل (مستحق على العميل)'}</span>
      </div>
    </div>

    <div class="meta">
      <div class="cell"><span class="lbl">المشروع</span><span class="val">${esc(args.projectName)}</span></div>
      <div class="cell"><span class="lbl">كود المشروع</span><span class="val">${esc(args.projectCode)}</span></div>
      <div class="cell"><span class="lbl">الجهة المالكة / العميل</span><span class="val">${esc(args.clientName || '—')}</span></div>
      ${args.contractValue ? `<div class="cell"><span class="lbl">قيمة العقد</span><span class="val">${esc(args.contractValue)}</span></div>` : ''}
      <div class="cell"><span class="lbl">نسبة المحتجز (ضمان)</span><span class="val">${args.retentionPercent}٪</span></div>
      <div class="cell"><span class="lbl">عدد بنود المستخلص</span><span class="val">${lines.length > 0 ? String(lines.length) : 'مبلغ إجمالي'}</span></div>
    </div>

    ${lines.length > 0 ? `
    <div class="sect"><span class="t">بنود الأعمال من جدول الكميات (BOQ)</span><span class="rule"></span></div>
    <table>
      <colgroup><col style="width:11%"><col style="width:42%"><col style="width:11%"><col style="width:11%"><col style="width:12.5%"><col style="width:12.5%"></colgroup>
      <thead><tr>
        <th>الكود</th><th>بيان البند</th><th>منجز سابقاً</th><th>منجز حالياً</th><th>قيمة الشريحة</th><th>نسبة من العقد</th>
      </tr></thead>
      <tbody>
        ${lines.map((l) => `<tr>
          <td class="num">${esc(l.code)}</td>
          <td class="desc">${esc(l.descriptionAr)}</td>
          <td class="pct">${l.prevPercent}٪</td>
          <td class="pct" style="color:#c2410c">${l.newPercent}٪</td>
          <td class="num">${esc(l.value)}</td>
          <td class="pct">${l.newPercent >= l.prevPercent && l.newPercent > 0 ? `+${Math.round((l.newPercent - l.prevPercent) * 10) / 10}٪` : '—'}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4">إجمالي قيمة أعمال هذا المستخلص</td><td colspan="2" class="num" style="text-align:center">${esc(args.currentGross)}</td></tr>
      </tbody>
    </table>` : ''}

    <div class="sect"><span class="t">احتساب المستخلص</span><span class="rule"></span></div>
    <div class="totals">
      <div class="row"><span>قيمة الأعمال المنفذة</span><b>${esc(args.currentGross)}</b></div>
      <div class="row"><span>ضريبة القيمة المضافة ${args.vat ? '' : '(غير خاضع)'}</span><b>${esc(args.vat || `0 ${sym}`.trim())}</b></div>
      <div class="row"><span>محتجز ضمان (${args.retentionPercent}٪)</span><b style="color:#b45309">− ${esc(args.retention || `0 ${sym}`.trim())}</b></div>
      <div class="row"><span>استرداد من الدفعة المقدمة</span><b style="color:#b45309">− ${esc(args.advanceRecovery || `0 ${sym}`.trim())}</b></div>
      <div class="due">
        <span>الصافي المستحق للجهة المالكة دفعه<small>${args.payment === 'cash' ? 'محصل كاملاً وقت إصدار المستخلص' : 'يُسدد وفق شروط التعاقد — على حساب العميل'}</small></span>
        <b>${esc(args.due)}</b>
      </div>
    </div>

    <div class="sect" style="margin-top:14px"><span class="t">الموقف التراكمي من العقد</span><span class="rule"></span></div>
    <div class="cum">
      <div class="box"><span class="l">أعمال المستخلصات السابقة</span><span class="v">${esc(args.previousGross)}</span></div>
      <div class="box cur"><span class="l">أعمال هذا المستخلص</span><span class="v">${esc(args.currentGross)}</span></div>
      <div class="box"><span class="l">الإجمالي التراكمي</span><span class="v">${esc(args.cumulativeGross)}</span></div>
    </div>
    ${args.progressPercent !== null ? `
    <div class="progress-wrap">
      <div class="progress-lbl"><span>نسبة الإنجاز التراكمية من قيمة العقد</span><span>${args.progressPercent}٪</span></div>
      <div class="progress"><div class="bar" style="width:${Math.min(100, args.progressPercent)}%"></div></div>
    </div>` : ''}

    ${args.description ? `<div class="desc-block"><span class="lbl">بيان الأعمال المنفذة</span><div class="txt">${esc(args.description)}</div></div>` : ''}

    <div class="sigs">
      <div class="sig"><div class="role">المقاول</div><div class="who">${esc(args.shopName)}</div><div class="line">الاسم والتوقيع والختم</div></div>
      <div class="sig"><div class="role">الاستشاري</div><div class="who">يعتمد الأعمال المنفذة</div><div class="line">الاسم والتوقيع والختم</div></div>
      <div class="sig"><div class="role">الجهة المالكة</div><div class="who">${esc(args.clientName || '')}</div><div class="line">الاعتماد والصرف</div></div>
    </div>

    <div class="foot">مستند نظامي يُصدر آلياً من منظومة المحاسبة — مستخلص ${esc(args.extractNumber)} · ${esc(args.dateIso.slice(0, 10))}${lines.length > 0 ? ' · بندي من جدول الكميات' : ' · مبلغ إجمالي'}</div>
  </body></html>`
}

export interface ExtractClientInvoicePrintLine {
  code: string
  descriptionAr: string
  unit?: string
  boqQty?: number
  unitPrice?: string
  boqTotal?: string
  prevPercent: number
  newPercent: number
  currentSlicePercent: number
  value: string
}

/**
 * §96: طباعة المستخلص كفاتورة بيع احترافية موجهة للعميل (طلب المالك:
 * «بجانب المستخلص طباعة فاتوره احترافية للعميل كانها فاتورة بيع ولاكنها مستخلص»).
 */
export function renderExtractClientInvoiceHtml(args: {
  shopName: string
  shopPhone?: string
  shopAddress?: string
  shopTaxId?: string
  extractNumber: string
  dateIso: string
  projectName: string
  projectCode: string
  contractNumber?: string
  clientName: string
  clientPhone?: string
  clientTaxId?: string
  contractValue: string
  description: string
  previousGross: string
  currentGross: string
  cumulativeGross: string
  progressPercent: number | null
  vat: string
  retention: string
  retentionPercent: number
  advanceRecovery?: string
  due: string
  payment: 'cash' | 'credit'
  currencySymbol?: string
  isFinal?: boolean
  lines?: ExtractClientInvoicePrintLine[]
}): string {
  const sym = args.currencySymbol ?? ''
  const lines = args.lines ?? []
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فاتورة مستخلص ${esc(args.extractNumber)}</title><style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 12.5px; line-height: 1.55; }
    .inv-banner { display: flex; justify-content: space-between; align-items: stretch; border: 2px solid #0f766e; border-radius: 12px; overflow: hidden; margin-bottom: 12px; }
    .inv-banner .company { padding: 14px 18px; flex: 1; background: #f0fdfa; }
    .inv-banner .company .name { font-size: 19px; font-weight: 900; color: #0f766e; }
    .inv-banner .company .sub { font-size: 11px; color: #475569; margin-top: 3px; }
    .inv-banner .badge { background: linear-gradient(135deg, #0f766e, #0d9488); color: #fff; padding: 14px 22px; text-align: left; min-width: 250px; display: flex; flex-direction: column; justify-content: center; }
    .inv-banner .badge .title { font-size: 15px; font-weight: 900; letter-spacing: .3px; }
    .inv-banner .badge .num { font-family: 'Consolas', monospace; font-size: 20px; font-weight: 900; margin: 2px 0; direction: ltr; }
    .inv-banner .badge .meta-line { font-size: 11px; opacity: .92; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .party-box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; background: #f8fafc; }
    .party-box .head { font-size: 11px; font-weight: 900; color: #0f766e; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px; }
    .party-box .row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
    .party-box .row span { color: #64748b; }
    .party-box .row b { color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; vertical-align: middle; }
    th { background: #0f766e; color: #fff; font-size: 11px; font-weight: 800; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .num { font-family: 'Consolas', monospace; direction: ltr; text-align: left; font-weight: 700; }
    .pct { font-family: 'Consolas', monospace; direction: ltr; text-align: center; font-weight: 800; }
    .summary-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px; margin-top: 14px; align-items: start; }
    .cum-card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; background: #fff; }
    .cum-card .head { font-size: 11.5px; font-weight: 900; color: #0f766e; margin-bottom: 8px; }
    .cum-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; font-size: 12px; }
    .totals-card { border: 2px solid #0f766e; border-radius: 10px; overflow: hidden; background: #fff; }
    .totals-card .t-row { display: flex; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12.5px; }
    .totals-card .t-row span { color: #334155; font-weight: 700; }
    .totals-card .t-row b { font-family: 'Consolas', monospace; direction: ltr; }
    .totals-card .t-due { background: #0f766e; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
    .totals-card .t-due span { font-size: 13.5px; font-weight: 900; }
    .totals-card .t-due b { font-family: 'Consolas', monospace; direction: ltr; font-size: 18px; font-weight: 900; }
    .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 32px; }
    .sig { text-align: center; }
    .sig .role { font-size: 11.5px; font-weight: 800; color: #334155; margin-bottom: 28px; }
    .sig .line { border-top: 1.5px solid #334155; padding-top: 4px; font-size: 10.5px; color: #64748b; }
    .foot { margin-top: 18px; text-align: center; font-size: 10.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  </style></head><body>
    <div class="inv-banner">
      <div class="company">
        <div class="name">${esc(args.shopName)}</div>
        <div class="sub">فاتورة مطالبة مالية عن أعمال مقاولات منفذة (مستخلص أعمال للعميل)</div>
        ${args.shopTaxId ? `<div class="sub">الرقم الضريبي: <b>${esc(args.shopTaxId)}</b></div>` : ''}
        ${args.shopPhone || args.shopAddress ? `<div class="sub">${esc([args.shopPhone, args.shopAddress].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
      <div class="badge">
        <div class="title">فاتورة مستخلص أعمال للعميل${args.isFinal ? ' (ختامي)' : ''}</div>
        <div class="num">${esc(args.extractNumber)}</div>
        <div class="meta-line">تاريخ الإصدار: ${esc(args.dateIso.slice(0, 10))}</div>
        <div class="meta-line">حالة الفاتورة: ${args.payment === 'cash' ? 'محصلة نقداً / بنكياً' : 'آجلة — مستحقة على العميل'}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party-box">
        <div class="head">فُوترت إلى (العميل / الجهة المالكة)</div>
        <div class="row"><span>اسم العميل:</span><b>${esc(args.clientName || '—')}</b></div>
        ${args.clientPhone ? `<div class="row"><span>الهاتف:</span><b>${esc(args.clientPhone)}</b></div>` : ''}
        ${args.clientTaxId ? `<div class="row"><span>الرقم الضريبي للعميل:</span><b>${esc(args.clientTaxId)}</b></div>` : ''}
        <div class="row"><span>طريقة السداد:</span><b>${args.payment === 'cash' ? 'نقدي / بنكي مباشر' : 'آجل على حساب العميل'}</b></div>
      </div>
      <div class="party-box">
        <div class="head">بيانات المشروع والعقد</div>
        <div class="row"><span>المشروع:</span><b>${esc(args.projectCode)} — ${esc(args.projectName)}</b></div>
        ${args.contractNumber ? `<div class="row"><span>رقم العقد:</span><b>${esc(args.contractNumber)}</b></div>` : ''}
        ${args.contractValue ? `<div class="row"><span>قيمة العقد:</span><b>${esc(args.contractValue)}</b></div>` : ''}
        <div class="row"><span>محتجز ضمان الأعمال:</span><b>${args.retentionPercent}٪</b></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:6%">#</th>
          <th style="width:11%">الكود</th>
          <th style="width:${lines.length > 0 ? '33%' : '63%'}">البيان / بند الأعمال</th>
          ${lines.length > 0 ? `
          <th style="width:10%">إجمالي البند</th>
          <th style="width:10%">النسبة السابقة</th>
          <th style="width:10%">النسبة الجديدة</th>
          <th style="width:8%">شريحة الفاتورة</th>
          ` : ''}
          <th style="width:${lines.length > 0 ? '12%' : '20%'}">قيمة الأعمال (${esc(sym)})</th>
        </tr>
      </thead>
      <tbody>
        ${lines.length > 0
          ? lines.map((l, idx) => `<tr>
              <td class="pct">${idx + 1}</td>
              <td class="num">${esc(l.code)}</td>
              <td>${esc(l.descriptionAr)}${l.unit && l.boqQty ? ` <small style="color:#64748b">(${l.boqQty} ${esc(l.unit)}${l.unitPrice ? ` × ${esc(l.unitPrice)}` : ''})</small>` : ''}</td>
              <td class="num">${esc(l.boqTotal ?? '—')}</td>
              <td class="pct">${l.prevPercent}٪</td>
              <td class="pct" style="color:#0f766e">${l.newPercent}٪</td>
              <td class="pct">+${l.currentSlicePercent}٪</td>
              <td class="num">${esc(l.value)}</td>
            </tr>`).join('')
          : `<tr>
              <td class="pct">1</td>
              <td class="num">${esc(args.projectCode)}</td>
              <td>${esc(args.description || `أعمال منفذة على مشروع ${args.projectName}`)}</td>
              <td class="num">${esc(args.currentGross)}</td>
            </tr>`
        }
      </tbody>
    </table>

    <div class="summary-grid">
      <div class="cum-card">
        <div class="head">كشف الموقف التراكمي للأعمال حتى هذه الفاتورة</div>
        <div class="cum-row"><span>أعمال الفواتير / المستخلصات السابقة:</span><b class="num">${esc(args.previousGross)}</b></div>
        <div class="cum-row"><span>أعمال هذه الفاتورة (${esc(args.extractNumber)}):</span><b class="num">${esc(args.currentGross)}</b></div>
        <div class="cum-row"><span>إجمالي الأعمال المنفذة حتى تاريخه:</span><b class="num">${esc(args.cumulativeGross)}</b></div>
        ${args.progressPercent !== null ? `<div class="cum-row"><span>نسبة الإنجاز الإجمالية من العقد:</span><b class="pct">${args.progressPercent}٪</b></div>` : ''}
        ${args.description ? `<div style="margin-top:8px;font-size:11.5px;color:#334155"><b>ملاحظات وبيان الأعمال:</b> ${esc(args.description)}</div>` : ''}
      </div>

      <div class="totals-card">
        <div class="t-row"><span>إجمالي قيمة أعمال الفاتورة (قبل الضريبة)</span><b>${esc(args.currentGross)}</b></div>
        <div class="t-row"><span>ضريبة القيمة المضافة (+)</span><b>${esc(args.vat || `0 ${sym}`.trim())}</b></div>
        <div class="t-row"><span>يُخصم: محتجز ضمان الأعمال (${args.retentionPercent}٪) (−)</span><b style="color:#b45309">− ${esc(args.retention || `0 ${sym}`.trim())}</b></div>
        ${args.advanceRecovery ? `<div class="t-row"><span>يُخصم: استرداد دفعة مقدمة (−)</span><b style="color:#b45309">− ${esc(args.advanceRecovery)}</b></div>` : ''}
        <div class="t-due">
          <span>صافي الفاتورة المستحق على العميل</span>
          <b>${esc(args.due)}</b>
        </div>
      </div>
    </div>

    <div class="sigs">
      <div class="sig"><div class="role">إعداد المحاسبة / المقاول (${esc(args.shopName)})</div><div class="line">التوقيع والختم</div></div>
      <div class="sig"><div class="role">اعتماد المهندس / الاستشاري</div><div class="line">التوقيع والاعتماد</div></div>
      <div class="sig"><div class="role">استلام واعتماد العميل (${esc(args.clientName || 'الجهة المالكة')})</div><div class="line">الاسم والتوقيع والتاريخ</div></div>
    </div>

    <div class="foot">فاتورة مستخلص أعمال للعميل رقم ${esc(args.extractNumber)} · مشروع ${esc(args.projectCode)} (${esc(args.projectName)}) · تاريخ ${esc(args.dateIso.slice(0, 10))}</div>
  </body></html>`
}

