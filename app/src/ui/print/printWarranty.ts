/**
 * شهادة ضمان (جولة الأجهزة الكهربائية): تُطبع للعميل مع الجهاز —
 * الصنف، السيريال، تاريخ البيع، مدة الضمان ونهايته، وشروط مختصرة.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderWarrantyCardHtml(args: {
  shopName: string
  shopPhone: string
  itemName: string
  serial: string
  soldAt: string // ISO
  invoiceNumber: string
  customerName: string
  warrantyMonths: number
  warrantyUntil: string // YYYY-MM-DD
}): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A5 landscape; margin: 10mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; }
    .card { border: 3px double #0e7490; border-radius: 14px; padding: 18px 22px; }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0e7490; padding-bottom: 10px; }
    .shop { font-size: 18px; font-weight: 900; color: #0e7490; }
    .title { font-size: 22px; font-weight: 900; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 16px 0; }
    .lbl { font-size: 11px; color: #64748b; font-weight: 700; }
    .val { font-size: 15px; font-weight: 900; }
    .serial { font-family: monospace; letter-spacing: 1px; }
    .until { background: #ecfeff; border: 1.5px solid #06b6d4; border-radius: 10px; padding: 10px 14px; text-align: center; margin-top: 4px; }
    .until b { font-size: 18px; color: #0e7490; }
    .terms { font-size: 10.5px; color: #64748b; border-top: 1px dashed #94a3b8; margin-top: 14px; padding-top: 8px; line-height: 1.8; }
  </style></head><body><div class="card">
    <div class="head">
      <div><div class="shop">${esc(args.shopName)}</div><div class="lbl">${esc(args.shopPhone)}</div></div>
      <div class="title">🛡️ شهادة ضمان</div>
    </div>
    <div class="grid">
      <div><div class="lbl">الجهاز</div><div class="val">${esc(args.itemName)}</div></div>
      <div><div class="lbl">الرقم المسلسل</div><div class="val serial" dir="ltr">${esc(args.serial)}</div></div>
      <div><div class="lbl">العميل</div><div class="val">${esc(args.customerName)}</div></div>
      <div><div class="lbl">فاتورة البيع</div><div class="val">${esc(args.invoiceNumber)} — ${esc(args.soldAt.slice(0, 10))}</div></div>
    </div>
    <div class="until">مدة الضمان: <b>${args.warrantyMonths} شهراً</b> — سارٍ حتى <b>${esc(args.warrantyUntil)}</b></div>
    <div class="terms">
      • الضمان يغطي عيوب الصناعة فقط ولا يشمل سوء الاستخدام أو الكسر أو السوائل أو التيار الكهربائي غير المستقر.<br>
      • يُشترط تقديم هذه الشهادة أو فاتورة الشراء عند طلب الصيانة، ومطابقة الرقم المسلسل.<br>
      • فتح الجهاز لدى غير الصيانة المعتمدة يُسقط الضمان.
    </div>
  </div><script>window.onload = () => { window.print() }</script></body></html>`
}
