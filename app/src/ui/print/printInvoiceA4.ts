/**
 * فاتورة A4 احترافية — ShopSys (المرحلة 5)
 * ─────────────────────────────────────────
 * قالب عربي RTL أنيق للطباعة على A4: شريط ترويسة ملون باسم المحل،
 * صندوقا بيانات الفاتورة والعميل، جدول أصناف مخطط، بطاقة إجماليات،
 * المبلغ كتابةً (تفقيط)، وسطر توقيعات — نفس نموذج ReceiptModel الخالص.
 */
import type { ReceiptModel } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ─── تفقيط عربي (المبلغ كتابةً) ─── */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

function below1000(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(HUNDREDS[h])
  if (r) {
    if (r < 20) parts.push(ONES[r])
    else {
      const o = r % 10
      const t = Math.floor(r / 10)
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t])
    }
  }
  return parts.join(' و')
}

/** تفقيط عدد صحيح حتى مليارات — يكفي أي فاتورة */
export function numberToArabicWords(n: number): string {
  if (n === 0) return 'صفر'
  if (n < 0) return `سالب ${numberToArabicWords(-n)}`
  const scales: [number, string, string, string][] = [
    [1_000_000_000, 'مليار', 'ملياران', 'مليارات'],
    [1_000_000, 'مليون', 'مليونان', 'ملايين'],
    [1_000, 'ألف', 'ألفان', 'آلاف'],
  ]
  const parts: string[] = []
  let rest = Math.floor(n)
  for (const [scale, one, two, many] of scales) {
    const count = Math.floor(rest / scale)
    rest %= scale
    if (!count) continue
    if (count === 1) parts.push(one)
    else if (count === 2) parts.push(two)
    else if (count <= 10) parts.push(`${below1000(count)} ${many}`)
    else parts.push(`${below1000(count)} ${one}`)
  }
  if (rest) parts.push(below1000(rest))
  return parts.join(' و')
}

/** «مائة وثلاثون جنيهاً وخمسون قرشاً فقط لا غير» */
export function amountInWords(minor: number, cur: CurrencyConfig): string {
  const major = Math.floor(Math.abs(minor) / 10 ** cur.decimals)
  const frac = Math.abs(minor) % 10 ** cur.decimals
  let s = `${numberToArabicWords(major)} ${cur.name || cur.symbol}`
  if (frac > 0) s += ` و${numberToArabicWords(frac)} من المائة`
  return `${s} فقط لا غير`
}

/* ─── القالب ─── */

/** HTML فاتورة A4 كاملة — دالة خالصة (تُفحص في verify) */
export function renderInvoiceA4Html(model: ReceiptModel, cur: CurrencyConfig): string {
  const fmt = (m: number) => formatMinor(m, cur, false)
  const rows = model.rows
    .map(
      (r, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="name">${esc(r.nameAr)}</td>
        <td class="c">${esc(r.qtyLabel)}</td>
        <td class="c">${fmt(r.unitPriceMinor)}</td>
        <td class="c">${r.discountPercent ? `${r.discountPercent}٪` : '—'}</td>
        <td class="c amt">${fmt(r.totalMinor)}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1e293b; font-size: 12px; }
  /* شريط الترويسة */
  .band { background: linear-gradient(90deg, #6366f1, #8b5cf6); color: #fff; border-radius: 12px; padding: 6mm 7mm; display: flex; justify-content: space-between; align-items: center; }
  .band .shop { font-size: 21px; font-weight: 900; }
  .band .hdr { font-size: 10px; opacity: .92; margin-top: 1mm; }
  .band .doc { text-align: left; }
  .band .doc .t { font-size: 15px; font-weight: 900; letter-spacing: .5px; }
  .band .doc .n { font-size: 12px; background: rgba(255,255,255,.18); border-radius: 6px; padding: 1mm 3mm; margin-top: 1.5mm; display: inline-block; font-weight: 700; }
  /* صندوقا البيانات */
  .boxes { display: flex; gap: 5mm; margin-top: 5mm; }
  .box { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 3.5mm 4.5mm; }
  .box .ttl { font-size: 9px; font-weight: 900; color: #6366f1; margin-bottom: 1.5mm; }
  .box .row { display: flex; justify-content: space-between; padding: .8mm 0; }
  .box .row .k { color: #64748b; }
  .box .row .v { font-weight: 700; }
  /* جدول الأصناف */
  table.items { width: 100%; border-collapse: collapse; margin-top: 5mm; }
  table.items thead th { background: #6366f1; color: #fff; font-size: 10.5px; font-weight: 900; padding: 2.6mm 2mm; }
  table.items thead th:first-child { border-radius: 0 8px 8px 0; }
  table.items thead th:last-child { border-radius: 8px 0 0 8px; }
  table.items tbody td { padding: 2.4mm 2mm; border-bottom: 1px solid #eef1f6; }
  table.items tbody tr:nth-child(even) td { background: #f8fafc; }
  .c { text-align: center; }
  .name { font-weight: 700; }
  .amt { font-weight: 900; }
  /* الإجماليات */
  .bottom { display: flex; gap: 5mm; margin-top: 5mm; align-items: flex-start; }
  .words { flex: 1; border: 1px dashed #c7d2fe; border-radius: 10px; padding: 3.5mm 4.5mm; background: #f5f7ff; }
  .words .ttl { font-size: 9px; font-weight: 900; color: #6366f1; margin-bottom: 1mm; }
  .words .txt { font-weight: 700; line-height: 1.7; }
  .totals { width: 66mm; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .totals .row { display: flex; justify-content: space-between; padding: 2.2mm 4mm; border-bottom: 1px solid #eef1f6; }
  .totals .row .k { color: #64748b; }
  .totals .row .v { font-weight: 800; }
  .totals .grand { background: #6366f1; color: #fff; font-weight: 900; font-size: 14px; padding: 3mm 4mm; display: flex; justify-content: space-between; }
  /* التذييل */
  .sig { display: flex; justify-content: space-between; margin-top: 14mm; padding: 0 8mm; }
  .sig div { text-align: center; color: #64748b; font-size: 10.5px; width: 44mm; border-top: 1px solid #cbd5e1; padding-top: 2mm; }
  .foot { text-align: center; color: #94a3b8; font-size: 10px; margin-top: 8mm; }
</style></head><body>
  <div class="band">
    <div>
      <div class="shop">${esc(model.shopName)}</div>
      ${model.headerLines.map((l) => `<div class="hdr">${esc(l)}</div>`).join('')}
    </div>
    <div class="doc">
      <div class="t">فاتورة مبيعات</div>
      <div class="n">${esc(model.invoiceNumber)}</div>
    </div>
  </div>

  <div class="boxes">
    <div class="box">
      <div class="ttl">بيانات الفاتورة</div>
      <div class="row"><span class="k">التاريخ</span><span class="v">${esc(model.dateLabel)}</span></div>
      <div class="row"><span class="k">طريقة الدفع</span><span class="v">${esc(model.paymentLabel)}</span></div>
      <div class="row"><span class="k">عدد الأصناف / القطع</span><span class="v">${model.itemCount} / ${model.totalQty}</span></div>
    </div>
    <div class="box">
      <div class="ttl">بيانات العميل</div>
      <div class="row"><span class="k">الاسم</span><span class="v">${esc(model.customerName)}</span></div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th style="width:8mm">#</th><th>الصنف</th><th style="width:20mm">الكمية</th>
      <th style="width:26mm">سعر الوحدة</th><th style="width:16mm">خصم</th><th style="width:28mm">الإجمالي</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="bottom">
    <div class="words">
      <div class="ttl">المبلغ كتابةً</div>
      <div class="txt">${esc(amountInWords(model.totalMinor, cur))}</div>
    </div>
    <div class="totals">
      <div class="row"><span class="k">الإجمالي قبل الخصم</span><span class="v">${fmt(model.grossMinor)}</span></div>
      ${model.discountMinor > 0 ? `<div class="row"><span class="k">الخصم</span><span class="v">-${fmt(model.discountMinor)}</span></div>` : ''}
      ${model.taxLabel ? `<div class="row"><span class="k">الأساس الضريبي</span><span class="v">${fmt(model.taxBaseMinor)}</span></div>
      <div class="row"><span class="k">${esc(model.taxLabel)}</span><span class="v">${fmt(model.taxMinor)}</span></div>` : ''}
      <div class="grand"><span>الإجمالي المستحق</span><span>${fmt(model.totalMinor)} ${esc(cur.symbol)}</span></div>
    </div>
  </div>

  <div class="sig"><div>البائع</div><div>المستلم</div></div>
  <div class="foot">${esc(model.footerText)}</div>
</body></html>`
}
