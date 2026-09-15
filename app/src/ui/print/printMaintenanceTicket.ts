/**
 * إيصالات الصيانة الاحترافية (الأمر 23 — بمستوى موبايل شوب):
 * 1) إيصال استلام الجهاز عند فتح التذكرة (رقم التتبع + الجهاز + العطل + التقدير)
 * 2) فاتورة تسليم للعميل: أجرة + قطع + خدمات + ضريبة + المحصَّل والباقي —
 *    التكلفة الداخلية والربح لا يظهران هنا أبداً (سريان — يظهران في التقارير فقط).
 * A4 عربية RTL — نمط كشف الحساب الاحترافي نفسه.
 */
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import type { TicketTotals, TicketServiceInput } from '../../core/maintenance.ts'

export interface TicketPrintModel {
  shopName: string
  headerLines: string[] // عنوان/هاتف المتجر
  ticketNumber: string
  date: string
  customerName: string
  customerPhone: string
  deviceName: string
  issue: string
  estimateMinor?: number
  /** موعد التسليم الموعود (جولة المغسلة) — يُطبع بإيصال الاستلام */
  promisedAt?: string
  notes?: string
}

export interface TicketInvoicePrintModel extends TicketPrintModel {
  laborMinor: number
  parts: { nameAr: string; qty: number; unitPriceMinor: number }[] // بلا تكلفة — سرية
  services: Pick<TicketServiceInput, 'nameAr' | 'qty' | 'unitPriceMinor'>[] // بلا تكلفة — سرية
  totals: TicketTotals
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const baseCss = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; direction: rtl; color: #1e293b; padding: 24px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f766e; padding-bottom: 12px; margin-bottom: 14px; }
  .shop { font-size: 20px; font-weight: 900; color: #0f766e; }
  .sub { color: #64748b; font-size: 11px; margin-top: 2px; }
  .doc-title { text-align: left; }
  .doc-title h1 { font-size: 16px; color: #0f766e; }
  .doc-title .num { font-family: monospace; font-size: 12px; color: #475569; }
  .box { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; }
  .box .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .box .lbl { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #0f766e; color: #fff; padding: 7px 10px; font-size: 11.5px; text-align: right; }
  td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  .totals { margin-right: auto; width: 46%; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 10px; }
  .totals .grand { background: #0f766e; color: #fff; border-radius: 8px; font-weight: 900; font-size: 14px; padding: 8px 10px; }
  .totals .due { color: #b91c1c; font-weight: 800; }
  .sig { display: flex; justify-content: space-between; margin-top: 40px; }
  .sig div { width: 30%; text-align: center; border-top: 1.5px dashed #94a3b8; padding-top: 6px; color: #475569; font-size: 11.5px; }
  .foot { margin-top: 22px; text-align: center; color: #94a3b8; font-size: 10px; }
  @media print { body { padding: 12px; } }
`

/** إيصال استلام الجهاز — يُطبع عند فتح التذكرة ويُسلَّم للعميل كإثبات */
export function renderTicketReceiptHtml(m: TicketPrintModel, cur: CurrencyConfig): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(m.ticketNumber)}</title><style>${baseCss}</style></head><body>
  <div class="head">
    <div><div class="shop">${esc(m.shopName)}</div>${m.headerLines.map((l) => `<div class="sub">${esc(l)}</div>`).join('')}</div>
    <div class="doc-title"><h1>إيصال استلام جهاز للصيانة</h1><div class="num">${esc(m.ticketNumber)}</div><div class="num">${esc(m.date.slice(0, 10))}</div></div>
  </div>
  <div class="box">
    <div class="row"><span class="lbl">العميل</span><b>${esc(m.customerName || 'عميل نقدي')}</b></div>
    ${m.customerPhone ? `<div class="row"><span class="lbl">الهاتف</span><b dir="ltr">${esc(m.customerPhone)}</b></div>` : ''}
    <div class="row"><span class="lbl">الجهاز</span><b>${esc(m.deviceName)}</b></div>
    <div class="row"><span class="lbl">العطل المبلَّغ</span><b>${esc(m.issue)}</b></div>
    ${m.estimateMinor && m.estimateMinor > 0 ? `<div class="row"><span class="lbl">التقدير المبدئي المتفق عليه</span><b>${formatMinor(m.estimateMinor, cur)}</b></div>` : ''}
    ${m.promisedAt ? `<div class="row"><span class="lbl">موعد التسليم الموعود</span><b dir="ltr">${esc(m.promisedAt.slice(0, 16).replace('T', ' '))}</b></div>` : ''}
    ${m.notes ? `<div class="row"><span class="lbl">ملاحظات</span><span>${esc(m.notes)}</span></div>` : ''}
  </div>
  <div class="box" style="background:#fffbeb;border-color:#fcd34d">
    <b>شروط الاستلام:</b> يُرجى الاحتفاظ بهذا الإيصال وتقديمه عند الاستلام — المتجر غير مسؤول عن الأجهزة غير المستلمة بعد 30 يوماً من إشعار الجاهزية.
  </div>
  <div class="sig"><div>توقيع العميل</div><div>موظف الاستلام</div><div>ختم المتجر</div></div>
  <div class="foot">نظام تَحَكَّم — TAHAKAM ERP</div>
  </body></html>`
}

/** فاتورة تسليم الصيانة للعميل — التكلفة والربح لا يُطبعان أبداً */
export function renderTicketInvoiceHtml(m: TicketInvoicePrintModel, cur: CurrencyConfig): string {
  const money = (n: number) => formatMinor(n, cur)
  const lines: string[] = []
  if (m.laborMinor > 0) lines.push(`<tr><td>أجرة الصيانة والفحص</td><td style="text-align:center">1</td><td>${money(m.laborMinor)}</td><td>${money(m.laborMinor)}</td></tr>`)
  for (const sv of m.services) lines.push(`<tr><td>${esc(sv.nameAr)} <span style="color:#94a3b8;font-size:10px">(خدمة)</span></td><td style="text-align:center">${sv.qty}</td><td>${money(sv.unitPriceMinor)}</td><td>${money(Math.round(sv.unitPriceMinor * sv.qty))}</td></tr>`)
  for (const p of m.parts) lines.push(`<tr><td>${esc(p.nameAr)} <span style="color:#94a3b8;font-size:10px">(قطعة غيار)</span></td><td style="text-align:center">${p.qty}</td><td>${money(p.unitPriceMinor)}</td><td>${money(Math.round(p.unitPriceMinor * p.qty))}</td></tr>`)
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(m.ticketNumber)}</title><style>${baseCss}</style></head><body>
  <div class="head">
    <div><div class="shop">${esc(m.shopName)}</div>${m.headerLines.map((l) => `<div class="sub">${esc(l)}</div>`).join('')}</div>
    <div class="doc-title"><h1>فاتورة صيانة</h1><div class="num">${esc(m.ticketNumber)}</div><div class="num">${esc(m.date.slice(0, 10))}</div></div>
  </div>
  <div class="box">
    <div class="row"><span class="lbl">العميل</span><b>${esc(m.customerName || 'عميل نقدي')}</b></div>
    <div class="row"><span class="lbl">الجهاز</span><b>${esc(m.deviceName)}</b></div>
    <div class="row"><span class="lbl">العطل</span><span>${esc(m.issue)}</span></div>
  </div>
  <table>
    <thead><tr><th>البيان</th><th style="width:60px;text-align:center">الكمية</th><th style="width:110px">سعر الوحدة</th><th style="width:110px">الإجمالي</th></tr></thead>
    <tbody>${lines.join('')}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>الإجمالي قبل الضريبة</span><b>${money(m.totals.revenueMinor)}</b></div>
    ${m.totals.vatMinor > 0 ? `<div class="row"><span>ض.ق.م</span><b>${money(m.totals.vatMinor)}</b></div>` : ''}
    <div class="row grand"><span>الإجمالي المستحق</span><span>${money(m.totals.grandMinor)}</span></div>
    <div class="row"><span>المحصَّل نقداً</span><b>${money(m.totals.paidMinor)}</b></div>
    ${m.totals.creditMinor > 0 ? `<div class="row due"><span>المتبقي (آجل)</span><span>${money(m.totals.creditMinor)}</span></div>` : ''}
  </div>
  <div class="sig"><div>استلمت الجهاز بحالة سليمة — توقيع العميل</div><div>الفني المسؤول</div><div>ختم المتجر</div></div>
  <div class="foot">شكراً لثقتكم — نظام تَحَكَّم TAHAKAM ERP</div>
  </body></html>`
}
