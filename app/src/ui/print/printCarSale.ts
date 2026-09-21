/**
 * عقد بيع سيارة مطبوع (جولة مراجعة معرض السيارات): الورقة التي يتسلمها
 * المشتري مع كل بيع — طرفا العقد، بيانات السيارة كاملة (ماركة/موديل/سنة/
 * لوحة-شاسيه/عداد)، الثمن كتابةً ورقماً غير قابل، إقرارات المعاينة
 * ونقل الملكية، وتوقيعان — بلا تكلفة ولا ربح (سرّيان).
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderCarSaleContractHtml(args: {
  shopName: string
  dateIso: string
  buyerName: string
  make: string
  model: string
  year: number
  plateOrVin: string
  odometerKm: number
  price: string // منسق بالعملة
  vat: string // '' = بلا
  payment: 'cash' | 'credit'
  consignment: boolean // سيارة أمانة (بيع بالعمولة لصالح مالكها)
  notes: string
}): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A4 portrait; margin: 18mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 13.5px; line-height: 1.8; }
    .head { text-align: center; border-bottom: 3px double #b45309; padding-bottom: 10px; margin-bottom: 16px; }
    .head h1 { margin: 0; font-size: 21px; color: #b45309; }
    .head .sub { font-size: 12px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    td, th { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: right; }
    th { background: #fffbeb; color: #92400e; width: 30%; }
    .price { font-size: 16px; font-weight: 900; color: #b45309; }
    .terms { font-size: 12px; color: #475569; }
    .terms li { margin-bottom: 4px; }
    .sigs { display: flex; justify-content: space-between; margin-top: 48px; }
    .sig { text-align: center; font-weight: 700; }
    .sig .line { border-top: 1.5px solid #334155; padding-top: 6px; min-width: 180px; }
  </style></head><body>
    <div class="head">
      <h1>عقد بيع سيارة</h1>
      <div class="sub">${esc(args.shopName)} — تحريراً في ${esc(args.dateIso.slice(0, 10))}</div>
    </div>
    <p>إنه في التاريخ الموضح أعلاه، تم البيع بين <b>${esc(args.shopName)}</b> (البائع${args.consignment ? ' — بصفته وكيلاً بالعمولة عن المالك' : ''}) والسيد/ <b>${esc(args.buyerName) || '—'}</b> (المشتري) على السيارة الموضحة:</p>
    <table>
      <tr><th>الماركة والموديل</th><td>${esc(args.make)} ${esc(args.model)} — موديل ${args.year}</td></tr>
      <tr><th>اللوحة / الشاسيه</th><td dir="ltr" style="text-align:right;font-family:monospace;font-weight:700">${esc(args.plateOrVin)}</td></tr>
      <tr><th>قراءة العداد</th><td dir="ltr" style="text-align:right">${args.odometerKm.toLocaleString('en')} كم</td></tr>
      <tr><th>الثمن المتفق عليه</th><td class="price">${esc(args.price)} (${args.payment === 'cash' ? 'سُدد نقداً بالكامل' : 'آجل — بذمة المشتري'})</td></tr>
      ${args.vat ? `<tr><th>الضريبة</th><td>${esc(args.vat)}</td></tr>` : ''}
      ${args.notes ? `<tr><th>ملاحظات</th><td>${esc(args.notes)}</td></tr>` : ''}
    </table>
    <ol class="terms">
      <li>يقر المشتري بمعاينة السيارة المعاينة التامة النافية للجهالة وقبولها بحالتها الراهنة.</li>
      <li>يلتزم الطرفان بإتمام إجراءات نقل الملكية أمام الجهات المختصة، وما يستجد بعد التسليم على مسؤولية المشتري.</li>
      <li>هذا العقد ملزم للطرفين ولا يُعتد بأي تعديل إلا كتابةً وبتوقيعهما.</li>
    </ol>
    <div class="sigs">
      <div class="sig"><div class="line">البائع</div></div>
      <div class="sig"><div class="line">المشتري</div></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
