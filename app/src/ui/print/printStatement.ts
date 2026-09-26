/**
 * كشف حساب احترافي للطباعة — على نمط قوالب pro-acc (طلب المالك):
 * ترويسة شركة + صندوق عنوان + بطاقات ملخص (مدين/دائن/الرصيد بمعناه)
 * + جدول حركات برصيد جارٍ + ذيل توقيعات (المحاسب/المدير المالي/الختم).
 * يُطبع عبر iframe مخفي (printHtml) — لا نوافذ منبثقة تحجبها المتصفحات.
 */
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import type { StatementRow } from '../../core/statements.ts'

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface StatementPrintArgs {
  shopName: string
  headerLines: string[] // عنوان/هاتف/رقم ضريبي…
  title: string // «كشف حساب عميل»…
  partyName: string
  partyDetails?: string[] // هاتف/عنوان/رقم ضريبي للطرف — اختياري
  rows: StatementRow[]
  debitLabel: string
  creditLabel: string
  /** معنى الرصيد النهائي: [موجب، سالب] مثل «مطلوب منه» / «رصيد له عندك» */
  balanceMeaning: [string, string]
  cur: CurrencyConfig
}

export function renderStatementHtml(a: StatementPrintArgs): string {
  const fmt = (m: number) => formatMinor(m, a.cur, false)
  const totalDebit = a.rows.reduce((s, r) => s + r.debitMinor, 0)
  const totalCredit = a.rows.reduce((s, r) => s + r.creditMinor, 0)
  const balance = a.rows.length ? a.rows[a.rows.length - 1].balanceMinor : 0
  const meaning = balance >= 0 ? a.balanceMeaning[0] : a.balanceMeaning[1]
  const today = new Date().toISOString().slice(0, 10)

  const rowsHtml = a.rows
    .map(
      (r, i) => `<tr class="${i % 2 ? 'alt' : ''}">
      <td>${esc(r.date.slice(0, 10))}</td>
      <td class="doc">${esc(r.docLabel)}</td>
      <td class="num">${r.operationMinor != null ? fmt(r.operationMinor) : '—'}</td>
      <td class="num">${r.debitMinor ? fmt(r.debitMinor) : '—'}</td>
      <td class="num">${r.creditMinor ? fmt(r.creditMinor) : '—'}</td>
      <td class="num bal ${r.balanceMinor < 0 ? 'neg' : ''}">${fmt(Math.abs(r.balanceMinor))}${r.balanceMinor < 0 ? ' *' : ''}</td>
    </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(a.title)} — ${esc(a.partyName)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
  .shop { font-size: 19px; font-weight: 900; }
  .hl { color: #475569; font-size: 10.5px; margin-top: 2px; }
  .tbox { text-align: center; }
  .tb { border: 2px solid #0f172a; padding: 6px 22px; font-size: 15px; font-weight: 800; border-radius: 6px; }
  .pd { color: #64748b; font-size: 10px; margin-top: 5px; }
  .party { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; }
  .pname { font-weight: 800; font-size: 14px; }
  .pdet { color: #64748b; font-size: 10.5px; }
  .cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .card { border-radius: 8px; padding: 8px 12px; border: 1px solid; }
  .card .cl { font-size: 10px; font-weight: 700; }
  .card .cv { font-size: 15px; font-weight: 900; margin-top: 2px; }
  .card.deb { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
  .card.cred { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .card.bal { background: #eff6ff; border-color: #bfdbfe; color: #1e40af; }
  .card .cm { font-size: 9.5px; color: #64748b; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  thead th { background: #0f172a; color: #fff; padding: 7px 10px; text-align: right; font-size: 10.5px; }
  td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  tr.alt td { background: #f8fafc; }
  .num { text-align: left; font-weight: 700; direction: ltr; }
  .doc { font-weight: 700; }
  .bal { font-weight: 900; }
  .neg { color: #b91c1c; }
  tfoot td { background: #f1f5f9; font-weight: 900; border-top: 2px solid #0f172a; }
  .note { color: #64748b; font-size: 9.5px; margin-top: 6px; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 34px; border-top: 1px solid #cbd5e1; padding-top: 14px; text-align: center; }
  .sig .st { font-weight: 800; font-size: 11px; }
  .sig .sl { margin-top: 26px; border-top: 1.5px dotted #94a3b8; padding-top: 4px; color: #94a3b8; font-size: 9.5px; }
</style></head><body>
  <div class="head">
    <div>
      <div class="shop">${esc(a.shopName || 'تَحَكَّم')}</div>
      ${a.headerLines.filter((l) => l.trim()).map((l) => `<div class="hl">${esc(l)}</div>`).join('')}
    </div>
    <div class="tbox">
      <div class="tb">${esc(a.title)}</div>
      <div class="pd">تاريخ الطباعة: ${today}</div>
    </div>
  </div>

  <div class="party">
    <div>
      <div class="pname">${esc(a.partyName)}</div>
      ${a.partyDetails?.length ? `<div class="pdet">${a.partyDetails.map(esc).join(' · ')}</div>` : ''}
    </div>
    <div class="pdet">عدد الحركات: ${a.rows.length}</div>
  </div>

  <div class="cards">
    <div class="card deb"><div class="cl">إجمالي مدين</div><div class="cv">${fmt(totalDebit)} ${esc(a.cur.symbol)}</div></div>
    <div class="card cred"><div class="cl">إجمالي دائن</div><div class="cv">${fmt(totalCredit)} ${esc(a.cur.symbol)}</div></div>
    <div class="card bal"><div class="cl">الرصيد الحالي</div><div class="cv">${fmt(Math.abs(balance))} ${esc(a.cur.symbol)}</div><div class="cm">${esc(meaning)}</div></div>
  </div>

  <table>
    <thead><tr><th>التاريخ</th><th>المستند / البيان</th><th style="text-align:left">قيمة العملية</th><th style="text-align:left">${esc(a.debitLabel)}</th><th style="text-align:left">${esc(a.creditLabel)}</th><th style="text-align:left">الرصيد</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:18px">لا حركات في هذا الحساب بعد</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">الإجمالي</td><td class="num">${fmt(a.rows.reduce((s, r) => s + (r.operationMinor ?? 0), 0))}</td><td class="num">${fmt(totalDebit)}</td><td class="num">${fmt(totalCredit)}</td><td class="num ${balance < 0 ? 'neg' : ''}">${fmt(Math.abs(balance))}${balance < 0 ? ' *' : ''}</td></tr></tfoot>
  </table>
  ${a.rows.some((r) => r.balanceMinor < 0) || balance < 0 ? `<div class="note">* الرصيد المعلّم بنجمة معكوس الاتجاه — ${esc(a.balanceMeaning[1])}</div>` : ''}

  <div class="sigs">
    <div class="sig"><div class="st">المحاسب</div><div class="sl">الاسم والتوقيع</div></div>
    <div class="sig"><div class="st">المدير المالي</div><div class="sl">الاسم والتوقيع</div></div>
    <div class="sig"><div class="st">الختم والتوقيع</div><div class="sl">خاتم المنشأة</div></div>
  </div>
</body></html>`
}
