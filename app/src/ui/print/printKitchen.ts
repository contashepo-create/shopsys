/**
 * بون المطبخ (جولة مراجعة المطعم): يُطبع حرارياً للمطبخ عند إرسال الطلب —
 * أصناف وكميات وملاحظات فقط، **بلا أي أسعار** (المطبخ لا يعرف الحسابات).
 */
import type { CartLine } from '../../core/pos.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderKitchenTicketHtml(args: {
  shopName: string
  orderNumber: string
  typeLabel: string
  tableName: string
  notes: string
  lines: readonly CartLine[]
  dateIso: string
}): string {
  const rows = args.lines
    .map(
      (l) => `<tr>
        <td class="q">${l.qty}×</td>
        <td class="n">${esc(l.nameAr)}</td>
      </tr>`,
    )
    .join('')
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; width: 72mm; margin: 0; color: #000; }
    .head { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
    .shop { font-size: 13px; font-weight: 700; }
    .ord { font-size: 22px; font-weight: 900; letter-spacing: 1px; }
    .meta { font-size: 12px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 2px; border-bottom: 1px dotted #999; font-size: 15px; font-weight: 700; }
    .q { width: 34px; font-size: 17px; font-weight: 900; }
    .notes { margin-top: 8px; border: 2px solid #000; padding: 5px; font-size: 13px; font-weight: 700; }
    .foot { text-align: center; font-size: 10px; margin-top: 8px; }
  </style></head><body>
    <div class="head">
      <div class="shop">${esc(args.shopName)} — 🍳 بون مطبخ</div>
      <div class="ord">${esc(args.orderNumber)}</div>
      <div class="meta">${esc(args.typeLabel)}${args.tableName ? ` — طاولة ${esc(args.tableName)}` : ''}</div>
      <div class="meta">${new Date(args.dateIso).toLocaleString('ar-EG')}</div>
    </div>
    <table>${rows}</table>
    ${args.notes ? `<div class="notes">📝 ${esc(args.notes)}</div>` : ''}
    <div class="foot">بلا أسعار — نسخة المطبخ</div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
