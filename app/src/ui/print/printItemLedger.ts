/**
 * طباعة كارت الصنف (دفتر حركة الصنف) — قالب A4 احترافي بنمط كشوف pro-acc:
 * ترويسة + بيانات الصنف + بطاقات ملخص (افتتاحي/وارد/منصرف/الرصيد)
 * + جدول حركات برصيد جارٍ + ذيل توقيعات (أمين المخزن/المراجع).
 */
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import type { ItemLedgerResult } from '../../core/itemLedger.ts'
import { todayLocalIso } from '../../core/time.ts'

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface ItemLedgerPrintArgs {
  shopName: string
  headerLines: string[]
  itemName: string
  itemDetails: string[] // SKU/قسم/وحدة/تكلفة/سعر…
  ledger: ItemLedgerResult
  period?: string // «من 2026-01-01 إلى 2026-09-15»
  cur: CurrencyConfig
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''))

export function renderItemLedgerHtml(a: ItemLedgerPrintArgs): string {
  const fmt = (m: number) => formatMinor(m, a.cur, false)
  const today = todayLocalIso()

  const rowsHtml = a.ledger.rows
    .map(
      (r, i) => `<tr class="${i % 2 ? 'alt' : ''}">
      <td>${esc(r.date)}</td>
      <td class="doc">${esc(r.docLabel)}</td>
      <td class="num in">${r.inQty ? qty(r.inQty) : '—'}</td>
      <td class="num out">${r.outQty ? qty(r.outQty) : '—'}</td>
      <td class="num bal">${qty(r.balance)}</td>
      <td class="num">${r.valueMinor ? fmt(r.valueMinor) : '—'}</td>
      <td class="note">${esc(r.note)}</td>
    </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كارت صنف — ${esc(a.itemName)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
  .shop { font-size: 19px; font-weight: 900; }
  .hl { color: #475569; font-size: 10.5px; margin-top: 2px; }
  .tb { border: 2px solid #0f172a; padding: 6px 22px; font-size: 15px; font-weight: 800; border-radius: 6px; text-align:center; }
  .pd { color: #64748b; font-size: 10px; margin-top: 5px; text-align:center; }
  .party { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 14px; margin-bottom: 12px; }
  .pname { font-weight: 800; font-size: 14px; }
  .pdet { color: #64748b; font-size: 10.5px; margin-top: 3px; }
  /* ملخص نظامي بجدول بلا بطاقات (قرار المالك 2026-10-27) */
  .summary { margin-bottom: 12px; }
  .summary th { background: #f1f5f9; color: #0f172a; border-bottom: 2px solid #0f172a; }
  .summary td { text-align: center; font-size: 12px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0f172a; color: #fff; padding: 6px 8px; font-size: 10.5px; text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #eef2f7; font-size: 11px; }
  tr.alt td { background: #f8fafc; }
  .num { font-weight: 700; }
  .in { color: #059669; }
  .out { color: #e11d48; }
  .bal { font-weight: 900; }
  .doc { font-weight: 700; }
  .note { color: #64748b; font-size: 10px; }
  .sigs { display: flex; justify-content: space-around; margin-top: 34px; }
  .sig { text-align: center; color: #475569; font-size: 11px; font-weight: 700; }
  .sig .line { width: 130px; border-top: 1.5px dashed #94a3b8; margin-top: 30px; }
  .foot { margin-top: 14px; text-align: center; color: #94a3b8; font-size: 9.5px; }
</style></head><body>
  <div class="head">
    <div><div class="shop">${esc(a.shopName)}</div>${a.headerLines.map((l) => `<div class="hl">${esc(l)}</div>`).join('')}</div>
    <div><div class="tb">كارت صنف — دفتر الحركة</div><div class="pd">تاريخ الطباعة: ${today}${a.period ? ` • ${esc(a.period)}` : ''}</div></div>
  </div>
  <div class="party">
    <div class="pname">${esc(a.itemName)}</div>
    <div class="pdet">${a.itemDetails.map(esc).join(' • ')}</div>
  </div>
  <table class="summary">
    <thead><tr><th>رصيد أول الفترة</th><th>إجمالي الوارد</th><th>إجمالي المنصرف</th><th>رصيد آخر الفترة</th></tr></thead>
    <tbody><tr>
      <td>${qty(a.ledger.openingQty)}</td>
      <td class="in">${qty(a.ledger.totalIn)}</td>
      <td class="out">${qty(a.ledger.totalOut)}</td>
      <td class="bal">${qty(a.ledger.closingQty)}</td>
    </tr></tbody>
  </table>
  <table>
    <thead><tr><th>التاريخ</th><th>المستند</th><th>وارد</th><th>منصرف</th><th>الرصيد</th><th>القيمة</th><th>ملاحظة</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:18px">لا حركات في الفترة المحددة</td></tr>'}</tbody>
  </table>
  <div class="sigs">
    <div class="sig"><div class="line"></div>أمين المخزن</div>
    <div class="sig"><div class="line"></div>المراجع</div>
    <div class="sig"><div class="line"></div>الإدارة</div>
  </div>
  <div class="foot">دفتر حركة الصنف يُبنى من مستنداته الفعلية (شراء/بيع/مرتجعات/جرد/إنتاج/أذون صرف) — لا يقبل تعديلاً يدوياً</div>
</body></html>`
}
