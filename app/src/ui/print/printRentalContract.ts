/**
 * عقد إيجار معدة مطبوع (جولة مراجعة إيجار المعدات): A4 — طرفا العقد،
 * المعدة والمدة والسعر والتأمين، قراءة العدّاد عند التسليم، بنود التزام،
 * وتوقيعان — كما تُسلِّم شركات تأجير المعدات ورقة عقد مع كل خروج معدة.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderRentalContractHtml(args: {
  shopName: string
  shopPhone: string
  contractNumber: string
  dateIso: string
  customerName: string
  customerPhone: string
  equipmentName: string
  equipmentCode: string
  units: number
  unitLabel: string // يوم/ساعة/شهر
  unitRate: string // منسق بالعملة
  rentTotal: string
  vat: string
  deposit: string
  /** ملخص السداد — اختياري للتوافق مع العقود المطبوعة القديمة */
  paymentLabel?: string
  paidRent?: string
  dueRent?: string
  startReading: number | null
  expectedEnd: string // ISO
  notes: string
}): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A4 portrait; margin: 16mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 13px; }
    .head { text-align: center; border-bottom: 3px double #0d9488; padding-bottom: 10px; margin-bottom: 14px; }
    .head h1 { margin: 0; font-size: 20px; color: #0d9488; }
    .head .sub { font-size: 12px; color: #64748b; }
    .num { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    td, th { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right; }
    th { background: #f0fdfa; color: #0f766e; width: 32%; }
    .money { font-weight: 900; }
    .terms { font-size: 11.5px; color: #475569; line-height: 1.9; }
    .terms li { margin-bottom: 2px; }
    .sigs { display: flex; justify-content: space-between; margin-top: 40px; }
    .sig { text-align: center; font-weight: 700; }
    .sig .line { border-top: 1.5px solid #334155; padding-top: 5px; min-width: 170px; }
  </style></head><body>
    <div class="head">
      <h1>${esc(args.shopName)}</h1>
      <div class="sub">عقد إيجار معدة ${args.shopPhone ? '— ' + esc(args.shopPhone) : ''}</div>
    </div>
    <div class="num"><span>عقد رقم: ${esc(args.contractNumber)}</span><span>التاريخ: ${esc(args.dateIso.slice(0, 10))}</span></div>
    <table>
      <tr><th>المستأجر (الطرف الثاني)</th><td>${esc(args.customerName)}${args.customerPhone ? ' — ' + esc(args.customerPhone) : ''}</td></tr>
      <tr><th>المعدة</th><td>${esc(args.equipmentName)}${args.equipmentCode ? ` (${esc(args.equipmentCode)})` : ''}</td></tr>
      <tr><th>المدة</th><td>${args.units} ${esc(args.unitLabel)} — حتى ${esc(args.expectedEnd.slice(0, 10))}</td></tr>
      ${args.startReading !== null ? `<tr><th>قراءة العدّاد عند التسليم</th><td dir="ltr" style="text-align:right">${args.startReading}</td></tr>` : ''}
      <tr><th>سعر ال${esc(args.unitLabel)}</th><td class="money">${esc(args.unitRate)}</td></tr>
      <tr><th>إجمالي الإيجار</th><td class="money">${esc(args.rentTotal)}</td></tr>
      ${args.vat ? `<tr><th>الضريبة</th><td>${esc(args.vat)}</td></tr>` : ''}
      ${args.deposit ? `<tr><th>التأمين المسترد</th><td class="money">${esc(args.deposit)}</td></tr>` : ''}
      ${args.paymentLabel ? `<tr><th>طريقة السداد</th><td>${esc(args.paymentLabel)}</td></tr>` : ''}
      ${args.paidRent ? `<tr><th>المدفوع من الإيجار</th><td class="money">${esc(args.paidRent)}</td></tr>` : ''}
      ${args.dueRent ? `<tr><th>المتبقي على العميل</th><td class="money">${esc(args.dueRent)}</td></tr>` : ''}
      ${args.notes ? `<tr><th>ملاحظات</th><td>${esc(args.notes)}</td></tr>` : ''}
    </table>
    <ol class="terms">
      <li>يلتزم المستأجر بإعادة المعدة بحالتها المستلمة، وأي تلف أو نقص يُخصم من التأمين أو يُطالَب به.</li>
      <li>التأخير عن الموعد المحدد يُحاسَب بسعر الوحدة نفسه عن كل وحدة تجاوز.</li>
      <li>المعدة مسؤولية المستأجر الكاملة من الاستلام حتى الإرجاع، ولا يجوز تأجيرها من الباطن.</li>
      <li>يُرَدّ التأمين كاملاً عند الإرجاع السليم في الموعد بعد المعاينة.</li>
    </ol>
    <div class="sigs">
      <div class="sig"><div class="line">الطرف الأول (المؤجّر)</div></div>
      <div class="sig"><div class="line">الطرف الثاني (المستأجر)</div></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
