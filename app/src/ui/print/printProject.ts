import { CHANGE_ORDER_STATUS_LABELS, effectiveContractValue, type BoqItem, type ChangeOrder, type Project } from '../../core/contracting.ts'
import type { ProjectSurvey } from '../../core/projectSurvey.ts'
import { assertSurveyIntegrity } from '../../core/projectSurvey.ts'
import { assertQuantityChangeLinks, type QuantityHistoryExtract } from '../../core/projectExtractQuantity.ts'

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const qty = (value: number) => String(Number(value.toFixed(3)))

/** وثيقة العميل: الحصر إن وجد يبيّن مصدره، ولا تُختلق كميات لأوامر مالية بلا تفاصيل بنود. */
export function renderProjectHtml(args: { shopName: string; project: Project; items: readonly BoqItem[]; orders: readonly ChangeOrder[]; survey?: ProjectSurvey; history: readonly QuantityHistoryExtract[]; fmt: (minor: number) => string; currency: string }): string {
  const { project, items, orders, survey, history } = args
  if (items.some(row => row.projectId !== project.id) || orders.some(row => row.projectId !== project.id) || (survey && survey.projectId !== project.id)) throw new Error('بيانات مستند المشروع غير متطابقة')
  if (new Set(items.map(row => row.id)).size !== items.length) throw new Error('بنود المشروع غير فريدة — راجع البيانات')
  if (!Number.isSafeInteger(project.contractValueMinor) || orders.some(row => !Number.isSafeInteger(row.amountMinor))) throw new Error('قيمة العقد أو أمر التغيير غير صالحة')
  assertQuantityChangeLinks(items, orders)
  if (survey) assertSurveyIntegrity(survey, items, history)
  const approved = orders.filter(row => row.status === 'approved' || row.status === 'invoiced')
  const delta = approved.reduce((sum, row) => sum + row.amountMinor, 0)
  const effective = effectiveContractValue(project.contractValueMinor, orders)
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(effective)) throw new Error('إجمالي العقد خارج المجال الآمن')
  const money = (value: number) => `${esc(args.fmt(value))} ${esc(args.currency)}`
  let measuredTotal = 0, measuredComplete = !!survey && items.length > 0
  const unallocated = approved.some(order => !order.quantityChange)
  const rows = items.filter(item => !item.quantityChange).map(item => {
    if (!Number.isFinite(item.qty) || item.qty <= 0 || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) throw new Error('كمية أو سعر بند المشروع غير صالح')
    const value = Math.round(item.qty * item.unitPriceMinor)
    if (!Number.isSafeInteger(value)) throw new Error('قيمة بند المشروع خارج المجال الآمن')
    const slices = items.filter(row => row.quantityChange?.originalBoqItemId === item.id)
    const quantityMilli = slices.reduce((sum, row) => sum + Math.round(row.qty * 1000), 0)
    if (!Number.isSafeInteger(quantityMilli)) throw new Error('كمية أمر التغيير خارج المجال الآمن')
    const measurements = [item, ...slices].map(row => survey?.lines.find(line => line.boqItemId === row.id)?.cumulativeQty)
    const ambiguous = slices.length > 0 && measurements[0] != null && measurements[0] > item.qty
    const complete = measurements.every(value => value != null) && !ambiguous
    if (!complete) measuredComplete = false
    let measuredMilli = 0
    if (complete) {
      for (const [index, current] of measurements.entries()) {
        const milli = Math.round(current! * 1000)
        measuredMilli += milli
        const amount = (BigInt(milli) * BigInt([item, ...slices][index].unitPriceMinor) + 500n) / 1000n
        if (amount > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(measuredTotal + Number(amount))) throw new Error('قيمة الحصر خارج المجال الآمن')
        measuredTotal += Number(amount)
      }
    }
    const section = project.boqSections?.find(row => row.id === item.sectionId)?.nameAr
    const change = quantityMilli ? `${qty(quantityMilli / 1000)}${unallocated ? ' + غير مفصلة' : ''}` : (unallocated ? 'غير مفصلة' : '—')
    const measured = ambiguous ? 'راجع توزيع الحصر بين العقد والتغيير' : complete ? qty(measuredMilli / 1000) : 'غير مسجل'
    return `<tr><td>${esc(item.code)}</td><td>${section ? `${esc(section)} — ` : ''}${esc(item.descriptionAr)}</td><td>${esc(item.unit)}</td><td>${qty(item.qty)}</td><td>${change}</td><td>${measured}</td><td>${money(item.unitPriceMinor)}</td><td>${money(value)}</td></tr>`
  }).join('')
  const orderRows = orders.map(order => `<tr><td>${esc(order.number)}</td><td>${esc(order.titleAr)}${order.quantityChange ? ` — زيادة ${qty(order.quantityChange.qty)} ${esc(order.quantityChange.unit)}` : ''}</td><td>${esc(order.date)}</td><td>${esc(CHANGE_ORDER_STATUS_LABELS[order.status]?.nameAr ?? 'غير معروفة')}</td><td>${money(order.amountMinor)}</td></tr>`).join('')
  const source = survey ? `مراجعة ${survey.revisions.length} — ${survey.isFinal ? 'ختامي' : 'جاري'}؛ آخر مصدر: ${survey.revisions.at(-1)?.source === 'manual' ? 'قياس يدوي' : 'مستخلص'} — تاريخ قياس المراجعة الأخيرة: ${esc(survey.revisions.at(-1)?.measurementDate ?? 'غير مسجل')}` : 'لا يوجد حصر محفوظ؛ لا يُفترض أن الكميات المستخلصة هي المنفذة فعلياً.'
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مستند المشروع ${esc(project.code)}</title><style>
  @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px Tahoma,Arial,sans-serif;color:#172033;line-height:1.55}header{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #9a3412;padding:10px 0}h1{font-size:20px;margin:0}h2{font-size:15px;margin:12px 0 5px;color:#9a3412}.meta,.totals{display:flex;gap:18px;flex-wrap:wrap;margin:12px 0}.totals span{border:1px solid #cbd5e1;border-radius:5px;padding:7px}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px;text-align:right;overflow-wrap:anywhere}th{background:#fff7ed;color:#7c2d12}small{display:block;color:#475569;margin:8px 0}.sign{display:flex;justify-content:space-around;margin-top:40px}</style></head><body>
  <header><div><h1>${esc(args.shopName)}</h1><h2>بيان المشروع وجدول الكميات</h2></div><div><b>${esc(project.code)}</b><br>${esc(project.contractNumber || 'دون رقم عقد مسجل')}</div></header>
  <div class="meta"><span><b>المشروع:</b> ${esc(project.nameAr)}</span><span><b>الجهة المالكة:</b> ${esc(project.clientName || '—')}</span><span><b>تاريخ البداية:</b> ${esc(project.startDate)}</span><span><b>الموقع:</b> ${esc(project.location || '—')}</span></div>
  <div class="totals"><span>قيمة العقد الأصلية: <b>${money(project.contractValueMinor)}</b></span><span>صافي أوامر التغيير المعتمدة: <b>${money(delta)}</b></span><span>قيمة العقد بعد التغيير: <b>${money(effective)}</b></span></div>
  <h2>بنود العقد والحصر</h2><table><thead><tr><th>الكود</th><th>البند</th><th>الوحدة</th><th>كمية العقد</th><th>كمية أوامر التغيير</th><th>المنفذ المحصور</th><th>سعر الوحدة</th><th>قيمة كمية العقد</th></tr></thead><tbody>${rows || '<tr><td colspan="8">لا يوجد جدول كميات مسجل</td></tr>'}</tbody></table>
  <p><b>قيمة الكميات المحصورة بسعر بنود المشروع قبل الضريبة:</b> ${measuredComplete ? money(measuredTotal) : 'غير متاحة لعدم اكتمال الحصر'}</p>
  <small>مصدر الحصر: ${source} قد يتضمن الحصر قيماً أضيفت تلقائياً من مستخلصات؛ لا يثبت قياساً مستقلاً لكل بند. الكميات المعروضة هي جدول المشروع الحالي؛ قد لا يثبت السجل القديم كميات العقد الأصلية وقت التوقيع. ${unallocated ? 'بعض أوامر التغيير مبالغ إجمالية لا تحفظ توزيعاً على البنود؛ لا تتوفر كمياتها في هذا البيان.' : ''} الكميات المقاسة المجمعة تتطلب إدخال كل شريحة مرة واحدة، دون احتساب الزيادة ضمن الأصل والشريحة معاً. لا تُجمع كميات وحدات مختلفة.</small>
  <h2>أوامر التغيير</h2><table><thead><tr><th>الرقم</th><th>البيان</th><th>التاريخ</th><th>الحالة</th><th>القيمة قبل الضريبة</th></tr></thead><tbody>${orderRows || '<tr><td colspan="5">لا توجد أوامر تغيير مسجلة</td></tr>'}</tbody></table><small>يدخل في قيمة العقد أعلاه المعتمد والمُستخلص فقط؛ المسودات والمرفوضة معروضة للبيان ولا تدخل الإجمالي.</small>
  ${project.notes ? `<p><b>ملاحظات:</b> ${esc(project.notes)}</p>` : ''}<div class="sign"><span>المقاول<br>........................</span><span>الاستشاري<br>........................</span><span>الجهة المالكة<br>........................</span></div></body></html>`
}
