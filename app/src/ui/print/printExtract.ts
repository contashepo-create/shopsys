/**
 * المستخلص المطبوع (جولة مراجعة المقاولات): الوثيقة الرسمية المقدمة
 * للجهة المالكة للمطالبة — بيانات المشروع والعقد، قيمة أعمال المستخلص
 * الحالي والتراكمي السابق ونسبة الإنجاز، الضريبة، المحتجز (خصماً)،
 * والصافي المستحق — بتوقيعات المقاول والاستشاري والمالك.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
  due: string // الصافي المستحق
  payment: 'cash' | 'credit'
}): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A4 portrait; margin: 16mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 13px; }
    .head { text-align: center; border-bottom: 3px double #c2410c; padding-bottom: 10px; margin-bottom: 14px; }
    .head h1 { margin: 0; font-size: 20px; color: #c2410c; }
    .head .sub { font-size: 12px; color: #64748b; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 14px; font-size: 12.5px; }
    .meta b { color: #9a3412; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    td, th { border: 1px solid #cbd5e1; padding: 7px 12px; text-align: right; }
    th { background: #fff7ed; color: #9a3412; }
    .money { font-weight: 800; font-family: monospace; direction: ltr; text-align: left; }
    .minus td { color: #b91c1c; }
    .total td { background: #fff7ed; font-weight: 900; font-size: 14px; }
    .progress { background: #f1f5f9; border-radius: 8px; height: 14px; overflow: hidden; margin: 4px 0 14px; }
    .progress .bar { background: #ea580c; height: 100%; }
    .sigs { display: flex; justify-content: space-between; margin-top: 44px; font-size: 12px; font-weight: 700; }
    .sig .line { border-top: 1.5px solid #334155; padding-top: 5px; min-width: 150px; text-align: center; }
  </style></head><body>
    <div class="head">
      <h1>مستخلص أعمال — ${esc(args.extractNumber)}</h1>
      <div class="sub">${esc(args.shopName)} — ${esc(args.dateIso.slice(0, 10))}</div>
    </div>
    <div class="meta">
      <div><b>المشروع:</b> ${esc(args.projectName)} (${esc(args.projectCode)})</div>
      <div><b>الجهة المالكة:</b> ${esc(args.clientName)}</div>
      ${args.contractValue ? `<div><b>قيمة العقد:</b> ${esc(args.contractValue)}</div>` : ''}
      ${args.description ? `<div><b>بيان الأعمال:</b> ${esc(args.description)}</div>` : ''}
    </div>
    ${args.progressPercent !== null ? `
    <div style="font-size:11.5px;font-weight:700;color:#9a3412">نسبة الإنجاز التراكمية: ${args.progressPercent}٪</div>
    <div class="progress"><div class="bar" style="width:${Math.min(100, args.progressPercent)}%"></div></div>` : ''}
    <table>
      <tr><th>البيان</th><th style="width:26%">القيمة</th></tr>
      <tr><td>أعمال المستخلصات السابقة (تراكمي)</td><td class="money">${esc(args.previousGross)}</td></tr>
      <tr><td>أعمال المستخلص الحالي</td><td class="money">${esc(args.currentGross)}</td></tr>
      <tr><td><b>إجمالي الأعمال التراكمي</b></td><td class="money"><b>${esc(args.cumulativeGross)}</b></td></tr>
      ${args.vat ? `<tr><td>ضريبة القيمة المضافة (الحالي)</td><td class="money">${esc(args.vat)}</td></tr>` : ''}
      ${args.retention ? `<tr class="minus"><td>يُخصم: محتجز ضمان الأعمال ${args.retentionPercent}٪</td><td class="money">(${esc(args.retention)})</td></tr>` : ''}
      <tr class="total"><td>صافي المستحق عن هذا المستخلص (${args.payment === 'cash' ? 'حُصّل نقداً' : 'مطالبة على الجهة'})</td><td class="money">${esc(args.due)}</td></tr>
    </table>
    <div class="sigs">
      <div class="sig"><div class="line">المقاول</div></div>
      <div class="sig"><div class="line">الاستشاري</div></div>
      <div class="sig"><div class="line">الجهة المالكة</div></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
