import { useEffect, useMemo, useState } from 'react'
import { financialPositionReview, type Maturity, type PositionRow } from '../../core/financialPositionReview.ts'
import { comparisonCsvAmount } from '../../core/financialComparison.ts'
import { toCsv } from '../../core/financialReports.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import type { JournalEntry } from '../../core/ledger.ts'
import { escHtml, renderReportShell } from '../../core/reportPrint.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, inputCls } from '../components/ui.tsx'
import { printHtml } from '../print/printReceipt.ts'

const NOTICE = 'مركز مالي تشغيلي يحتاج مراجعة واعتمادًا من المختص؛ ليس إيداعًا في قوائم أو إقرارًا زكويًا. التصنيف يحدده المستخدم لكل حساب وتاريخ ولا يُحفظ؛ افحص آجال كل رصيد. الحساب الذي يجمع آجالاً مختلفة يحتاج تفصيلاً وتسويات خارج هذا العرض، فلا يعتمد هذا التبويب وحده. قد تُستبعد أرصدة تحويلات الفروع المتقابلة المحددة آلياً؛ راجع مطابقتها وهوية الكيان. الرمز — يعني صفراً أو عدم انطباق التصنيف في العمود. التوازن لا يثبت صحة البيانات أو اكتمالها.'

export function FinancialPositionReview({ journal, asOf, names, cur, companyName, scopeLabel, scopeWarning }: { journal: readonly JournalEntry[]; asOf: string; names: Record<string, string>; cur: CurrencyConfig; companyName: string; scopeLabel: string; scopeWarning: string }) {
  const [comparisons, setComparisons] = useState(['', '', ''])
  const [selection, setSelection] = useState<{ journal: readonly JournalEntry[]; values: Record<string, Maturity> }>({ journal, values: {} })
  // Never apply an old maturity decision to changed ledger data, even for one render.
  const classifications = useMemo(() => selection.journal === journal ? selection.values : {}, [journal, selection])
  useEffect(() => { setSelection(current => current.journal === journal ? current : { journal, values: {} }) }, [journal])
  const dates = comparisons.filter(Boolean)
  const output = useMemo(() => {
    try { return { report: financialPositionReview(journal, asOf, dates, classifications, names), error: '' } }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : 'تعذر إعداد التقرير' } }
    // comparisons is the state identity; dates is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, asOf, comparisons, classifications, names])
  const report = output.report
  const fmt = (amount: number) => formatMinor(amount, cur, false)
  const counts = report ? `أرصدة الحسابات غير المصنفة عبر التواريخ: ${report.unclassifiedCount}.` : ''
  const resultRows = (): { kind: 'section' | 'row' | 'total'; row: PositionRow }[] => {
    if (!report) return []
    const rows: { kind: 'section' | 'row' | 'total'; row: PositionRow }[] = []
    for (const section of report.sections) {
      rows.push({ kind: 'section', row: { key: `heading:${section.key}`, label: section.label, values: [] } })
      section.rows.forEach(row => rows.push({ kind: 'row', row: { ...row, key: `${section.key}:${row.key}` } }))
      rows.push({ kind: 'total', row: section.total })
      if (section.key === 'assets-unclassified') rows.push({ kind: 'total', row: report.totalAssets })
      if (section.key === 'liabilities-unclassified') rows.push({ kind: 'total', row: report.totalLiabilities })
      if (section.key === 'equity') rows.push({ kind: 'total', row: report.liabilitiesAndEquity }, { kind: 'total', row: report.difference })
    }
    if (report.workingCapital) rows.push({ kind: 'total', row: report.workingCapital })
    return rows
  }
  const exportCsv = () => {
    if (!report) return
    const meta = toCsv(['بيانات التقرير', 'القيمة'], [['المنشأة', companyName], ['النطاق', scopeLabel], ['التقرير', 'المركز المالي المقارن'], ['الفترة', `حتى ${asOf}`], ['العملة', cur.symbol], ['تنبيه', NOTICE], ['مراجعة التصنيف', counts], ...(scopeWarning ? [['مراجعة إسناد الفروع', scopeWarning]] : [])])
    const head = toCsv(['البند', ...report.dates], []).replace(/^\uFEFF/, '')
    const rows = resultRows().map(({ row, kind }) => {
      const label = toCsv([], [[kind === 'row' && row.code ? `${row.code} — ${row.label}` : row.label]]).replace(/^\uFEFF\n/, '')
      return `${label},${report.dates.map((_, index) => kind === 'section' || (kind === 'row' && row.values[index] === 0) ? '' : comparisonCsvAmount(row.values[index], cur.decimals)).join(',')}`
    })
    const csv = `${meta}\n\n${head}\n${rows.join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `financial-position-${asOf}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  const print = () => {
    if (!report) return
    const body = `<p>${escHtml(NOTICE)}</p>${scopeWarning ? `<p>${escHtml(scopeWarning)}</p>` : ''}<p>${escHtml(counts)} العملة: ${escHtml(cur.symbol)}</p><table><thead><tr><th>البند</th>${report.dates.map(date => `<th>${escHtml(date)}</th>`).join('')}</tr></thead><tbody>${resultRows().map(({ kind, row }) => kind === 'section' ? `<tr class="sec"><td colspan="${report.dates.length + 1}">${escHtml(row.label)}</td></tr>` : `<tr${kind === 'total' ? ' class="total"' : ''}><td>${row.code ? `${escHtml(row.code)} — ` : ''}${escHtml(row.label)}</td>${row.values.map(value => `<td class="num" dir="ltr">${escHtml(kind === 'row' && value === 0 ? '—' : fmt(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'المركز المالي المقارن', subtitle: `${companyName} — ${scopeLabel} — حتى ${asOf}`, companyName, logoDataUrl: receipt.logoDataUrl, bodyHtml: body, settings: reportPrint }))
  }
  return <section className="space-y-4" aria-label="المركز المالي المقارن">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
      <div><h3 className="text-base font-black text-slate-900 dark:text-white">المركز المالي المقارن</h3><p className="text-xs text-slate-500">{companyName} · {scopeLabel} · حتى {asOf} · {cur.symbol}</p></div>
      <div className="flex gap-2"><Btn variant="ghost" disabled={!report} onClick={print}>طباعة / PDF</Btn><Btn variant="ghost" disabled={!report} onClick={exportCsv}>تصدير Excel</Btn></div>
    </div>
    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{NOTICE}</p>
    <div className="flex flex-wrap gap-3">{comparisons.map((date, index) => <label key={index} className="text-xs font-bold text-slate-600 dark:text-slate-300">تاريخ المقارنة {index + 1}<input type="date" className={`${inputCls} mt-1 block`} value={date} onChange={event => setComparisons(prev => prev.map((value, i) => i === index ? event.target.value : value))} /></label>)}</div>
    <p className="text-xs text-slate-500">أضف حتى ثلاثة تواريخ سابقة اختيارية؛ كل عمود يمثل الرصيد التراكمي حتى تاريخه. اختر التصنيف لكل حساب وتاريخ من القائمة تحت رصيده. تُمسح التصنيفات عند تغير الدفتر أو مغادرة التقرير أو تبديل الفرع، ولا تعد إقراراً أو اعتماداً. الرمز — يعني صفراً أو عدم انطباق التصنيف في العمود.</p>
    {output.error && <p role="alert" className="text-sm text-red-600">{output.error}</p>}
    {report && <>
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{counts} {report.workingCapital ? 'يمكن عرض رأس المال العامل بعد تحديد جميع التصنيفات، مع مراجعة الآجال المختلطة.' : 'لا يُحسب رأس المال العامل قبل تحديد جميع التصنيفات.'}</p>
      {report.difference.values.some(amount => amount !== 0) && <p role="alert" className="text-sm text-red-600">المركز غير متوازن في تاريخ واحد على الأقل — راجع الدفتر قبل الاستخدام.</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700"><table className="w-full min-w-[560px] text-xs"><thead className="bg-slate-800 text-white"><tr><th className="px-3 py-3 text-right">البند</th>{report.dates.map(date => <th key={date} className="px-3 py-3 text-left" dir="ltr">{date}</th>)}</tr></thead><tbody>
        {resultRows().map(({ kind, row }) => kind === 'section' ? <tr key={row.key} className="bg-slate-100 dark:bg-slate-800 font-black"><th colSpan={report.dates.length + 1} className="px-3 py-2 text-right">{row.label}</th></tr> : <tr key={`${kind}:${row.key}`} className={`border-t border-slate-100 dark:border-slate-800 ${kind === 'total' ? 'font-black bg-slate-50 dark:bg-slate-800/50' : ''}`}><td className="px-3 py-2">{row.code && <span dir="ltr" className="text-slate-400 me-2">{row.code}</span>}{row.label}</td>{row.values.map((value, index) => <td key={report.dates[index]} className="px-3 py-2 text-left tabular-nums" dir="ltr"><span>{value === 0 && kind === 'row' ? '—' : fmt(value)}</span>{kind === 'row' && row.root && row.code && value !== 0 && <select dir="rtl" className="block mt-1 w-full rounded border border-slate-300 bg-white text-[10px] text-slate-700" aria-label={`تصنيف ${row.label} ${report.dates[index]}`} value={classifications[JSON.stringify([row.code, report.dates[index]])] ?? 'unclassified'} onChange={event => { const maturity = event.target.value as Maturity; const key = JSON.stringify([row.code, report.dates[index]]); setSelection({ journal, values: { ...classifications, [key]: maturity } }) }}><option value="unclassified">غير مصنف</option><option value="current">متداول</option><option value="noncurrent">غير متداول</option></select>}</td>)}</tr>)}
      </tbody></table></div>
    </>}
  </section>
}
