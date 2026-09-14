/**
 * طباعة الإيصال الحراري — يبني HTML عربياً RTL بمقاس 80/58مم
 * ويطبعه عبر iframe مخفي (يعمل في المتصفح واليوم نفسه في قشرة Electron).
 */
import type { ReceiptModel, PaperWidth } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML كامل للإيصال — دالة خالصة (تُفحص في verify) */
export function renderReceiptHtml(model: ReceiptModel, cur: CurrencyConfig, paper: PaperWidth): string {
  const w = paper === '80' ? '72mm' : '48mm'
  const fmt = (m: number) => formatMinor(m, cur, false)
  const rows = model.rows
    .map(
      (r) => `
      <tr>
        <td class="name">${esc(r.nameAr)}${r.discountPercent ? `<span class="disc"> خصم ${r.discountPercent}٪</span>` : ''}
          <div class="sub">${esc(r.qtyLabel)} × ${fmt(r.unitPriceMinor)}</div>
        </td>
        <td class="amt">${fmt(r.totalMinor)}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @page { size: ${w} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${w}; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #000; padding: 2mm 1mm; }
  .center { text-align: center; }
  .shop { font-size: ${paper === '80' ? '15px' : '13px'}; font-weight: 900; }
  .hdr { font-size: ${paper === '80' ? '10px' : '9px'}; }
  .meta { font-size: ${paper === '80' ? '10px' : '9px'}; display: flex; justify-content: space-between; margin-top: 1mm; }
  hr { border: none; border-top: 1px dashed #000; margin: 1.5mm 0; }
  table { width: 100%; border-collapse: collapse; font-size: ${paper === '80' ? '11px' : '10px'}; }
  td { padding: 0.8mm 0; vertical-align: top; }
  .name { font-weight: 700; }
  .sub { font-size: ${paper === '80' ? '9px' : '8px'}; font-weight: 400; color: #333; }
  .disc { font-size: 9px; font-weight: 400; }
  .amt { text-align: left; font-weight: 900; white-space: nowrap; padding-right: 2mm; }
  .tot { display: flex; justify-content: space-between; font-size: ${paper === '80' ? '10px' : '9px'}; padding: 0.4mm 0; }
  .grand { font-size: ${paper === '80' ? '15px' : '13px'}; font-weight: 900; display: flex; justify-content: space-between; margin-top: 1mm; }
  .foot { text-align: center; font-size: ${paper === '80' ? '10px' : '9px'}; margin-top: 2mm; }
</style></head><body>
  <div class="center shop">${esc(model.shopName)}</div>
  ${model.headerLines.map((l) => `<div class="center hdr">${esc(l)}</div>`).join('')}
  <hr>
  <div class="meta"><span>فاتورة: <b>${esc(model.invoiceNumber)}</b></span><span>${esc(model.dateLabel)}</span></div>
  <div class="meta"><span>العميل: ${esc(model.customerName)}</span><span>الدفع: ${esc(model.paymentLabel)}</span></div>
  <hr>
  <table>${rows}</table>
  <hr>
  <div class="tot"><span>عدد الأصناف / القطع</span><span>${model.itemCount} / ${model.totalQty}</span></div>
  ${model.discountMinor > 0 ? `<div class="tot"><span>إجمالي الخصم</span><span>-${fmt(model.discountMinor)}</span></div>` : ''}
  ${model.taxLabel ? `<div class="tot"><span>${esc(model.taxLabel)}</span><span>${fmt(model.taxMinor)}</span></div>` : ''}
  <div class="grand"><span>الإجمالي</span><span>${fmt(model.totalMinor)} ${esc(cur.symbol)}</span></div>
  <hr>
  <div class="foot">${esc(model.footerText)}</div>
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
