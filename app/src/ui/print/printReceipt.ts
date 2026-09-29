/**
 * طباعة الإيصال الحراري — يبني HTML عربياً RTL بمقاس 80/58مم
 * ويطبعه عبر iframe مخفي (يعمل في المتصفح واليوم نفسه في قشرة Electron).
 *
 * أُعيد تصميم القالب (طلب المالك) ليحمل كل ما يجب أن يحمله إيصال احترافي:
 * شعار وترويسة، شريط عنوان المستند، بيانات الفاتورة (رقم/مرجع/تاريخ/كاشير/عميل/دفع)،
 * جدول أصناف مرقّم بسعر الوحدة والخصم والسيريالات، ثم كتلة إجماليات كاملة
 * (قبل الخصم، الخصم، الأساس، الضريبة، المستحق، المدفوع، المتبقي)، والمبلغ كتابةً،
 * وQR زاتكا، وباركود رقم الفاتورة، وتذييل مع ختم لحظة الطباعة.
 *
 * كل عنصر يحترم مفاتيح الإظهار/الإخفاء في إعدادات الطباعة — ومنها المفتاح الجديد
 * `showOperator` الذي يُظهر/يُخفي اسم من قام بالطباعة.
 */
import type { ReceiptModel, ReceiptSettings } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import { barcodeSvg } from '../../core/code128.ts'
import { amountInWords } from './printInvoiceA4.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML كامل للإيصال — دالة خالصة (تُفحص في verify) */
export function renderReceiptHtml(model: ReceiptModel, cur: CurrencyConfig, settings: ReceiptSettings): string {
  const paper = settings.paperWidth
  const wide = paper === '80'
  const w = wide ? '72mm' : '48mm'
  const fmt = (m: number) => formatMinor(m, cur, false)
  const showDisc = settings.showDiscount
  const rows = model.rows
    .map(
      (r, index) => `
      <tr>
        <td class="idx">${index + 1}</td>
        <td class="name">${esc(r.nameAr)}${showDisc && r.discountPercent ? `<span class="disc"> خصم ${r.discountPercent}٪</span>` : ''}
          <div class="sub">${esc(r.qtyLabel)} × ${fmt(r.unitPriceMinor)}${r.vatPercent != null && r.vatPercent > 0 ? ` · ض. ${r.vatPercent}٪` : ''}</div>
          ${r.serials.length ? `<div class="sub" dir="ltr" style="text-align:right">${r.serials.map(esc).join(' · ')}</div>` : ''}
        </td>
        <td class="amt">${fmt(r.totalMinor)}</td>
      </tr>`,
    )
    .join('')

  const logo = settings.showLogo && settings.logoDataUrl
    ? `<div class="center"><img src="${esc(settings.logoDataUrl)}" alt="شعار" style="max-width:${wide ? '30mm' : '22mm'};max-height:16mm;object-fit:contain;"/></div>`
    : ''

  /** سطر «مفتاح … قيمة» — النقاط الفاصلة تجعل الإيصال مقروءاً على الرول */
  const kv = (label: string, value: string) => `<div class="kv"><span class="k">${label}</span><span class="v">${value}</span></div>`
  const info: string[] = []
  info.push(kv('رقم الفاتورة', `<b>${esc(model.invoiceNumber)}</b>`))
  if (model.refCode) info.push(kv('مرجع التتبع', `<b dir="ltr">${esc(model.refCode)}</b>`))
  if (settings.showDate) info.push(kv('التاريخ والوقت', esc(model.dateLabel)))
  if (settings.showCustomer) info.push(kv('العميل', esc(model.customerName)))
  if (settings.showPayment) info.push(kv('طريقة الدفع', esc(model.paymentLabel)))
  // اسم القائم بالطباعة — يظهر ما لم يُطفأ من إعدادات الطباعة (طلب المالك)
  const showOperator = settings.showOperator !== false
  const operatorRow = showOperator && model.operatorName?.trim()
    ? `<div class="kv"><span class="k op">طبع بواسطة: ${esc(model.operatorName.trim())}</span></div>`
    : ''

  const totals: string[] = []
  if (settings.showItemCounts) totals.push(kv('عدد الأصناف / القطع', `${model.itemCount} / ${model.totalQty}`))
  if (model.discountMinor > 0 && showDisc) {
    totals.push(kv('الإجمالي قبل الخصم', fmt(model.grossMinor)))
    totals.push(kv('إجمالي الخصم', `-${fmt(model.discountMinor)}`))
  }
  if (model.taxLabel) {
    if (model.taxBaseMinor > 0) totals.push(kv('الأساس الخاضع للضريبة', fmt(model.taxBaseMinor)))
    totals.push(kv(esc(model.taxLabel), fmt(model.taxMinor)))
  }

  const payments = model.remainingMinor > 0 || model.paidMinor !== model.totalMinor
    ? `${kv('المدفوع', fmt(model.paidMinor))}${kv('المتبقي (آجل)', `<b>${fmt(model.remainingMinor)} ${esc(cur.symbol)}</b>`)}`
    : ''

  const words = settings.showWords && model.totalMinor > 0
    ? `<div class="words">المبلغ كتابةً: ${esc(amountInWords(model.totalMinor, cur))}</div>`
    : ''

  const qr = model.qrDataUrl
    ? `<div class="center" style="margin-top:2mm"><img src="${esc(model.qrDataUrl)}" alt="ZATCA QR" style="width:${wide ? '26mm' : '20mm'};height:auto"/></div>`
    : ''

  // باركود رقم الفاتورة — يسهّل استرجاعها بالماسح عند المرتجع أو الاستفسار
  const barcode = (() => {
    if (!/^[\x20-\x7E]+$/.test(model.invoiceNumber)) return ''
    try {
      return `<div class="center barcode">${barcodeSvg(model.invoiceNumber, wide ? 28 : 22, 1)}<div class="bc">${esc(model.invoiceNumber)}</div></div>`
    } catch { return '' }
  })()

  const printedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @page { size: ${w} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* بلاغ المالك: «الخطوط الصغيرة الفرعية لا تُطبع بوضوح».
     رؤوس الطابعات الحرارية 203dpi أحادية اللون: الرمادي يتفكك والخط تحت 10px
     يتشوّه. لذلك: **كل النصوص سوداء صريحة** (لا #333)، وأصغر مقاس 10.5px،
     وأوزان لا تقل عن 600 للنص الفرعي، مع منع المتصفح من تفتيح الألوان. */
  body {
    width: ${w}; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #000; padding: 2mm 1mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; text-rendering: geometricPrecision;
    font-weight: 600; line-height: 1.45; -webkit-font-smoothing: none;
  }
  .center { text-align: center; }
  .shop { font-size: ${wide ? '17px' : '15px'}; font-weight: 900; letter-spacing: -0.2px; }
  .hdr { font-size: ${wide ? '11.5px' : '11px'}; font-weight: 700; }
  .title { margin: 1.5mm 0; padding: 1.2mm 0; background: #000; color: #fff; text-align: center; font-size: ${wide ? '13px' : '12px'}; font-weight: 900; letter-spacing: 0.5px; }
  .kv { display: flex; justify-content: space-between; gap: 2mm; font-size: ${wide ? '11.5px' : '11px'}; padding: 0.35mm 0; font-weight: 700; }
  .kv .k { color: #000; white-space: nowrap; }
  .kv .k.op { font-weight: 800; color: #000; }
  .kv .v { text-align: left; font-weight: 800; }
  hr { border: none; border-top: 1px dashed #000; margin: 1.5mm 0; }
  table { width: 100%; border-collapse: collapse; font-size: ${wide ? '12px' : '11.5px'}; }
  thead td { font-size: ${wide ? '11px' : '10.5px'}; font-weight: 900; color: #000; border-bottom: 1.4px solid #000; padding-bottom: 0.7mm; }
  td { padding: 0.9mm 0; vertical-align: top; color: #000; }
  .idx { width: 5.5mm; text-align: center; font-size: ${wide ? '11px' : '10.5px'}; font-weight: 800; color: #000; }
  .name { font-weight: 800; }
  .sub { font-size: ${wide ? '11px' : '10.5px'}; font-weight: 700; color: #000; }
  .disc { font-size: ${wide ? '11px' : '10.5px'}; font-weight: 700; color: #000; }
  .amt { text-align: left; font-weight: 900; white-space: nowrap; padding-right: 2mm; }
  .tot { display: flex; justify-content: space-between; font-size: ${wide ? '11.5px' : '11px'}; padding: 0.45mm 0; font-weight: 700; }
  .grand { font-size: ${wide ? '17px' : '15px'}; font-weight: 900; display: flex; justify-content: space-between; align-items: center; margin: 1mm 0; padding: 1.2mm 1.5mm; border: 2.2px solid #000; }
  .words { font-size: ${wide ? '11px' : '10.5px'}; font-weight: 700; text-align: center; margin-top: 1mm; line-height: 1.5; }
  .barcode { margin-top: 2mm; }
  .barcode svg { max-width: 100%; height: auto; }
  .bc { font-size: ${wide ? '11px' : '10.5px'}; font-weight: 800; letter-spacing: 1px; }
  .foot { text-align: center; font-size: ${wide ? '11.5px' : '11px'}; margin-top: 2mm; font-weight: 800; }
  .stamp { text-align: center; font-size: ${wide ? '11px' : '10.5px'}; font-weight: 700; color: #000; margin-top: 1.5mm; }
</style></head><body>
  ${logo}
  <div class="center shop">${esc(model.shopName)}</div>
  ${settings.showHeaderLines ? model.headerLines.map((l) => `<div class="center hdr">${esc(l)}</div>`).join('') : ''}
  <div class="title">${esc(model.docTitle ?? 'فاتورة مبيعات')}</div>
  ${info.join('')}
  ${operatorRow}
  <hr>
  <table>
    <thead><tr><td class="idx">#</td><td>الصنف — الكمية × السعر</td><td class="amt">الإجمالي</td></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  ${totals.join('')}
  <div class="grand"><span>الإجمالي المستحق</span><span>${fmt(model.totalMinor)} ${esc(cur.symbol)}</span></div>
  ${payments}
  ${words}
  ${qr}
  ${barcode}
  ${settings.showFooter && model.footerText.trim() ? `<hr><div class="foot">${esc(model.footerText)}</div>` : ''}
  <div class="stamp">تمت الطباعة: ${esc(printedAt)}</div>
</body></html>`
}

/** يطبع HTML عبر iframe مخفي ثم يزيله */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.left = '-9999px'
  frame.style.width = '0'
  frame.style.height = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
  let printed = false
  const doPrint = () => {
    if (printed) return
    printed = true
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch { /* تجاهل */ }
    setTimeout(() => frame.remove(), 3000)
  }
  frame.onload = doPrint
  // احتياط لو أطلق onload قبل التسجيل — مهلة تكفي تحميل الخط
  setTimeout(doPrint, 400)
}
