import type { BoqItem } from '../../core/contracting.ts'
import type { ProjectNetQuantityReport } from '../../core/projectNetQuantityHistory.ts'
import { comparisonCsvAmount } from '../../core/financialComparison.ts'
import { toCsv } from '../../core/financialReports.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import { escHtml, renderReportShell, type ReportPrintSettings } from '../../core/reportPrint.ts'

const NOTE = 'عرض استرشادي لكميات المستخلصات والإشعارات وفق تاريخ المستند حتى اليوم المحدد، وليس الحصر الفعلي أو رصيداً مالياً أو إثباتاً لما كان معلوماً وقتها. أسماء البنود والعقد من البيانات الحالية؛ راجع تاريخ العقد والقيود والتسويات. لا يعيد فتح الختامي.'
type Args = { companyName: string; projectName: string; projectCode: string; asOf: string; items: readonly BoqItem[]; report: ProjectNetQuantityReport; currency: CurrencyConfig }
const label = (items: readonly BoqItem[], id: number) => {
  const item = items.find(row => row.id === id)
  if (!item) throw new Error('بند تاريخ الكميات غير موجود — أعد الفحص')
  return item.code + ' — ' + item.descriptionAr + ' (' + item.unit + ')'
}

export function renderProjectNetQuantityHtml(args: Args & { settings: ReportPrintSettings; logoDataUrl?: string }): string {
  const { report, items, currency } = args
  const rows = report.rows.map(row => `<tr><td>${escHtml(label(items, row.boqItemId))}</td><td class="num">${row.issuedQty}</td><td class="num">${row.returnedQty}</td><td class="num">${row.netQty}</td><td class="num">${escHtml(formatMinor(row.netMinor, currency, false))}</td></tr>`).join('')
  const events = report.events.map(event => `<tr><td>${event.journalEntryId}</td><td>${escHtml(event.date)}</td><td>${escHtml(event.extractNumber)}</td><td>${event.kind === 'credit' ? 'إشعار دائن' : 'مستخلص'}</td><td class="num">${escHtml(formatMinor(event.grossMinor, currency, false))}</td></tr>`).join('')
  const bodyHtml = `<p>${escHtml(NOTE)}</p><p>العملة: ${escHtml(currency.symbol)}</p><table><thead><tr><th>البند</th><th>كمية المستخلصات</th><th>كمية الإشعارات</th><th>الصافي</th><th>قيمة الأعمال الصافية قبل الضريبة</th></tr></thead><tbody>${rows}</tbody></table><h3>الأحداث حتى التاريخ المحدد</h3><table><thead><tr><th>القيد</th><th>تاريخ المستند</th><th>المستخلص</th><th>النوع</th><th>الأعمال قبل الضريبة</th></tr></thead><tbody>${events}</tbody></table>`
  return renderReportShell({ title: 'صافي كميات المستخلصات بتاريخ محدد', subtitle: args.projectCode + ' — ' + args.projectName + ' — حتى ' + args.asOf, companyName: args.companyName, bodyHtml, settings: args.settings, logoDataUrl: args.logoDataUrl })
}

/** نصوص غير موثوقة عبر الحماية المشتركة؛ الأموال من الوحدات الصحيحة. */
export function projectNetQuantityCsv(args: Args): string {
  const meta = toCsv(['بيانات التقرير', 'القيمة'], [['المنشأة', args.companyName], ['المشروع', args.projectCode + ' — ' + args.projectName], ['حتى', args.asOf], ['العملة', args.currency.symbol], ['تنبيه', NOTE]])
  const header = toCsv(['البند', 'كمية المستخلصات', 'كمية الإشعارات', 'صافي الكمية', 'قيمة الأعمال الصافية قبل الضريبة'], []).replace(/^\uFEFF/, '')
  const rows = args.report.rows.map(row => {
    const text = toCsv([], [[label(args.items, row.boqItemId)]]).replace(/^\uFEFF\n/, '')
    return `${text},${row.issuedQty},${row.returnedQty},${row.netQty},${comparisonCsvAmount(row.netMinor, args.currency.decimals)}`
  })
  const eventHeader = toCsv(['القيد', 'تاريخ المستند', 'المستخلص', 'النوع', 'الأعمال قبل الضريبة'], []).replace(/^\uFEFF/, '')
  const events = args.report.events.map(event => {
    const text = toCsv([], [[event.date, event.extractNumber, event.kind === 'credit' ? 'إشعار دائن' : 'مستخلص']]).replace(/^\uFEFF\n/, '')
    return `${event.journalEntryId},${text},${comparisonCsvAmount(event.grossMinor, args.currency.decimals)}`
  })
  return `${meta}\n\n${header}\n${rows.join('\n')}\n\n${eventHeader}\n${events.join('\n')}`
}
