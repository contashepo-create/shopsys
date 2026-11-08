import type { BoqItem, Project } from '../../core/contracting.ts'
import type { ProjectSurvey } from '../../core/projectSurvey.ts'
import { assertSurveyIntegrity, exactBilledQuantities } from '../../core/projectSurvey.ts'
import { normalizeMovementQty } from '../../core/pos.ts'
import type { QuantityHistoryExtract } from '../../core/projectExtractQuantity.ts'

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const quantity = (value: number) => String(Number(value.toFixed(3)))
const measuredValue = (qty: number, price: number): number => {
  normalizeMovementQty(qty, true)
  if (!Number.isSafeInteger(price) || price < 0) throw new Error('سعر وحدة الحصر غير صالح')
  const value = (BigInt(Math.round(qty * 1000)) * BigInt(price) + 500n) / 1000n
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('قيمة الحصر خارج المجال الآمن')
  return Number(value)
}

/** وثيقة الحصر لا تنشئ فاتورة أو قيداً ولا تجمع وحدات مختلفة. */
export function renderSurveyHtml(args: { shopName: string; project: Project; survey: ProjectSurvey; items: readonly BoqItem[]; history: readonly QuantityHistoryExtract[]; fmt: (minor: number) => string; currency: string }): string {
  const { project, survey, items, history } = args
  assertSurveyIntegrity(survey, items, history)
  const billed = new Map(exactBilledQuantities(items, history).map(line => [line.boqItemId, line.cumulativeQty]))
  const rows = items.map(item => {
    const measured = survey.lines.find(line => line.boqItemId === item.id)?.cumulativeQty ?? 0
    const extracted = billed.get(item.id) ?? 0
    if (measured < extracted) throw new Error('الحصر أقل من الكميات المستخلصة — راجع المستندات')
    return `<tr><td>${esc(item.code)} — ${esc(item.descriptionAr)}</td><td>${esc(item.unit)}</td><td>${quantity(item.qty)}</td><td>${esc(args.fmt(item.unitPriceMinor))}</td><td>${quantity(measured)}</td><td>${quantity(extracted)}</td><td>${quantity(measured - extracted)}</td><td>${quantity(item.qty - measured)}</td><td>${esc(args.fmt(measuredValue(measured, item.unitPriceMinor)))}</td></tr>`
  }).join('')
  const total = items.reduce((sum, item) => sum + measuredValue(survey.lines.find(line => line.boqItemId === item.id)?.cumulativeQty ?? 0, item.unitPriceMinor), 0)
  if (!Number.isSafeInteger(total)) throw new Error('إجمالي الحصر خارج المجال الآمن')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>حصر أعمال ${esc(project.code)}</title><style>
  @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px Tahoma,Arial,sans-serif;color:#172033;line-height:1.55}header{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #9a3412;padding:10px 0}h1{font-size:20px;margin:0}h2{font-size:15px;margin:4px 0;color:#9a3412}.meta{display:flex;gap:25px;flex-wrap:wrap;margin:12px 0}table{width:100%;border-collapse:collapse;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px;text-align:right;overflow-wrap:anywhere}th{background:#fff7ed;color:#7c2d12}td:not(:first-child){white-space:nowrap}.total{font-weight:bold;text-align:left;margin:12px 0}.sign{display:flex;justify-content:space-around;margin-top:45px}small{color:#64748b}</style></head><body>
  <header><div><h1>${esc(args.shopName)}</h1><h2>كشف حصر الأعمال ${survey.isFinal ? 'الختامي' : 'المعتمد'}</h2></div><div><b>${esc(project.code)}</b><br>المراجعة ${survey.revisions.length}<br>${esc(survey.revisions.at(-1)?.at ?? survey.createdAt)}</div></header>
  <div class="meta"><span><b>المشروع:</b> ${esc(project.nameAr)}</span><span><b>الجهة المالكة:</b> ${esc(project.clientName || '—')}</span><span><b>حالة الحصر:</b> ${survey.isFinal ? 'ختامي' : 'جاري'}</span><span><b>تاريخ قياس المراجعة الأخيرة:</b> ${esc(survey.revisions.at(-1)?.measurementDate ?? 'غير مسجل')}</span></div>
  <table><thead><tr><th>البند</th><th>الوحدة</th><th>كمية العقد</th><th>سعر الوحدة</th><th>المنفذ المحصور</th><th>المستخلص</th><th>غير المستخلص</th><th>المتبقي من العقد</th><th>قيمة المنفذ</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total">قيمة الأعمال المنفذة التراكمية قبل الضريبة: ${esc(args.fmt(total))} ${esc(args.currency)}</div><small>تاريخ قياس المراجعة الأخيرة لا يثبت تاريخ جميع الكميات السابقة. الحصر إثبات للكميات ولا يُنشئ قيداً أو فاتورة. الأرقام المستخلصة قبل أي إشعارات تتطلب مراجعة خاصة؛ لا تُجمع الكميات ذات الوحدات المختلفة.</small>
  <div class="sign"><span>المقاول<br>........................</span><span>الاستشاري<br>........................</span><span>الجهة المالكة<br>........................</span></div></body></html>`
}
