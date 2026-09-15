/**
 * بوليصة نقل مطبوعة (جولة مراجعة اللوجستيات): الورقة التي تسافر مع السائق —
 * المرسل/المرسل إليه، المسار، المركبة والسائق، الحاويات، أجرة النقلة،
 * ومصاريف الطريق «على حساب العميل» فقط (ما يُطالَب به) — بلا تكلفة ولا ربح.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderWaybillHtml(args: {
  shopName: string
  tripNumber: string
  dateIso: string
  customerName: string
  fromLoc: string
  toLoc: string
  vehiclePlate: string
  vehicleType: string
  driverName: string
  containerNumbers: string[]
  qty: number
  unitPrice: string // منسق
  freightTotal: string // أجرة النقل (بعد الضريبة إن وجدت)
  customerExpenses: { nameAr: string; amount: string }[] // «على حساب العميل» فقط
  grandTotal: string // المستحق على العميل
  payment: 'cash' | 'credit'
  notes: string
}): string {
  const containers = args.containerNumbers.filter(Boolean)
  const expRows = args.customerExpenses
    .map((e) => `<tr><td>${esc(e.nameAr)} <span class="tag">على حساب العميل</span></td><td class="money" dir="ltr">${esc(e.amount)}</td></tr>`)
    .join('')
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A5 landscape; margin: 8mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px double #a21caf; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { margin: 0; font-size: 16px; color: #a21caf; }
    .badge { font-size: 13px; font-weight: 900; border: 2px solid #a21caf; border-radius: 8px; padding: 3px 10px; color: #a21caf; }
    .route { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 900; margin: 8px 0; }
    .route .arrow { color: #a21caf; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 8px; }
    .grid div b { color: #86198f; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    td, th { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: right; }
    th { background: #fdf4ff; color: #86198f; font-size: 11px; }
    .money { font-weight: 800; }
    .total td { background: #fdf4ff; font-weight: 900; font-size: 13px; }
    .tag { font-size: 9px; background: #fef3c7; color: #92400e; border-radius: 4px; padding: 1px 5px; font-weight: 700; }
    .cont { font-family: monospace; font-weight: 700; direction: ltr; text-align: left; }
    .sigs { display: flex; justify-content: space-between; margin-top: 18px; font-size: 11px; font-weight: 700; }
    .sig .line { border-top: 1px solid #334155; padding-top: 3px; min-width: 120px; text-align: center; }
  </style></head><body>
    <div class="head">
      <div><h1>${esc(args.shopName)}</h1><div style="font-size:10px;color:#64748b">بوليصة نقل — Waybill</div></div>
      <div class="badge">${esc(args.tripNumber)}</div>
    </div>
    <div class="route"><span>${esc(args.fromLoc) || '—'}</span><span class="arrow">⟵</span><span>${esc(args.toLoc) || '—'}</span></div>
    <div class="grid">
      <div><b>التاريخ:</b> ${esc(args.dateIso.slice(0, 10))}</div>
      <div><b>العميل:</b> ${esc(args.customerName)}</div>
      <div><b>المركبة:</b> ${esc(args.vehicleType)} ${args.vehiclePlate ? `— لوحة ${esc(args.vehiclePlate)}` : ''}</div>
      <div><b>السائق:</b> ${esc(args.driverName) || '—'}</div>
      ${containers.length ? `<div style="grid-column:1/-1"><b>الحاويات (${containers.length}):</b> <span class="cont">${containers.map(esc).join(' · ')}</span></div>` : ''}
    </div>
    <table>
      <tr><th>البيان</th><th style="width:24%">القيمة</th></tr>
      <tr><td>أجرة النقل — ${args.qty} × ${esc(args.unitPrice)}</td><td class="money" dir="ltr">${esc(args.freightTotal)}</td></tr>
      ${expRows}
      <tr class="total"><td>الإجمالي المستحق (${args.payment === 'cash' ? 'نقدي' : 'آجل — على الحساب'})</td><td dir="ltr">${esc(args.grandTotal)}</td></tr>
    </table>
    ${args.notes ? `<div style="margin-top:6px;font-size:10.5px;color:#64748b">📝 ${esc(args.notes)}</div>` : ''}
    <div class="sigs">
      <div class="sig"><div class="line">السائق</div></div>
      <div class="sig"><div class="line">المستلم</div></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
