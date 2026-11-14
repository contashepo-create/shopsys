import { useMemo, useState } from 'react'
import type { JournalEntry } from '../../core/ledger.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import { comparisonCsvAmount, financialComparison } from '../../core/financialComparison.ts'
import { assertFinancialEntityProfiles, type FinancialEntityProfile } from '../../core/financialEntities.ts'
import { toCsv, type FinPeriod } from '../../core/financialReports.ts'
import { escHtml, renderReportShell } from '../../core/reportPrint.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Btn, inputCls } from '../components/ui.tsx'

const LIMITS = 'مقارنة تشغيلية للدفتر المرئي وليست قوائم قانونية أو إيضاحات معتمدة. تحقق من تماثل مدة الفترتين والسياسات وإسناد الفروع والأرصدة الافتتاحية والتسويات. تصنيف التدفقات تقديري وقد لا يوزع القيد المركب بدقة؛ راجع المختص.'

export function FinancialComparisonReview({ journal, period, cashCodes, names, cur, companyName, scopeLabel, scopeWarning, profiles, branches, activeBranchId }: { journal: readonly JournalEntry[]; period: FinPeriod; cashCodes: readonly string[]; names: Record<string, string>; cur: CurrencyConfig; companyName: string; scopeLabel: string; scopeWarning: string; profiles: readonly FinancialEntityProfile[]; branches: readonly { id: number; nameAr: string }[]; activeBranchId: number | null }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [profileId, setProfileId] = useState('')
  const prior = useMemo(() => ({ from, to }), [from, to])
  const scoped = useMemo(() => {
    if (!profileId) return { entries: journal, label: scopeLabel, warning: scopeWarning, error: '' }
    try {
      if (activeBranchId != null || !branches.length) throw new Error('تجميع فروع الكيان متاح للمالك في العرض الشامل للفروع فقط')
      assertFinancialEntityProfiles(profiles, branches)
      const profile = profiles.find(item => item.id === profileId)
      if (!profile || profile.branchIds.length === 0) throw new Error('إعداد الكيان غير موجود أو لا يحتوي فروعاً — راجعه أولاً')
      const ids = new Set(profile.branchIds)
      const entries = journal.filter(entry => entry.branchId != null && ids.has(entry.branchId))
      const unassigned = journal.filter(entry => entry.branchId == null && entry.date <= period.to).length
      const branchNames = profile.branchIds.map(id => branches.find(branch => branch.id === id)?.nameAr ?? `#${id}`).join('، ')
      const warning = `تجميع استرشادي حسب ارتباط الفروع الحالي فقط (${branchNames})، لا تاريخ صلاحية له ولا يثبت ملكية القيود السابقة أو الكيان القانوني أو التوحيد. استُبعد ${unassigned} قيد دون فرع صريح حتى نهاية الفترة؛ قد توجد قيود مشتركة أو غير مسندة ومقابلات بين كيانات تحتاج مراجعة مستقلة. الإطار والمراجع في الإعداد اختيارات وصفية لا تثبت الأهلية.`
      return { entries, label: `تجميع الفروع الحالية للكيان ${profile.nameAr}`, warning, error: '' }
    } catch (error) { return { entries: [], label: scopeLabel, warning: scopeWarning, error: error instanceof Error ? error.message : 'إعداد الكيان غير صالح' } }
  }, [profileId, journal, scopeLabel, scopeWarning, activeBranchId, branches, profiles, period.to])
  const output = useMemo(() => {
    if (scoped.error) return { report: null, error: scoped.error }
    if (!from || !to) return { report: null, error: '' }
    try { return { report: financialComparison(scoped.entries, period, prior, cashCodes, names), error: '' } }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : 'تعذر إعداد المقارنة — راجع الدفتر' } }
  }, [scoped, period, prior, cashCodes, names, from, to])
  const { report, error } = output
  const fmt = (value: number) => formatMinor(value, cur, false)
  const currentLabel = `${period.from} إلى ${period.to}`
  const priorLabel = `${from} إلى ${to}`
  const status = report ? `توازن المركز المالي: الحالية ${report.currentBalanced ? 'متوازن' : 'غير متوازن'}، المقارنة ${report.priorBalanced ? 'متوازن' : 'غير متوازن'}؛ تسوية حقوق الملكية: الحالية ${report.currentEquityReconciled ? 'متطابقة' : 'غير متطابقة'}، المقارنة ${report.priorEquityReconciled ? 'متطابقة' : 'غير متطابقة'}. التوازن لا يثبت صحة البيانات.` : ''
  const exportCsv = () => {
    if (!report) return
    const meta = toCsv(['بيانات المقارنة', 'القيمة'], [['المنشأة', companyName], ['النطاق', scoped.label], ['الفترة الحالية', currentLabel], ['فترة المقارنة', priorLabel], ['العملة', cur.symbol], ['المراجعة', LIMITS], ['حالة التسوية', status], ...(scoped.warning ? [['تنبيه النطاق', scoped.warning]] : [])])
    // أسماء الحسابات نصوص غير موثوقة فتهرّب عبر toCsv؛ الأرقام تُولّد من
    // الوحدات الصحيحة مباشرة لتبقى سالبة وعددية بلا تقريب عائم أو حقن صيغة.
    const header = toCsv(['القسم', 'البند', currentLabel, priorLabel], []).replace(/^\uFEFF/, '')
    const rows: string[] = []
    for (const section of report.sections) for (const row of section.rows) {
      const text = toCsv([], [[section.label, row.label]]).replace(/^\uFEFF\n/, '')
      rows.push(`${text},${comparisonCsvAmount(row.currentMinor, cur.decimals)},${comparisonCsvAmount(row.priorMinor, cur.decimals)}`)
    }
    const csv = `${meta}\n\n${header}\n${rows.join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `financial-comparison-${period.from}-${period.to}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  const print = () => {
    if (!report) return
    const table = `<table><thead><tr><th>البند</th><th>${escHtml(currentLabel)}</th><th>${escHtml(priorLabel)}</th></tr></thead><tbody>${report.sections.map(section => `<tr class="sec"><td colspan="3">${escHtml(section.label)}</td></tr>${section.rows.map(row => `<tr><td>${escHtml(row.label)}</td><td class="num">${escHtml(fmt(row.currentMinor))}</td><td class="num">${escHtml(fmt(row.priorMinor))}</td></tr>`).join('')}`).join('')}</tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'مقارنة القوائم التشغيلية', subtitle: `${companyName} — ${scoped.label}`, companyName, logoDataUrl: receipt.logoDataUrl, bodyHtml: `<p>${escHtml(LIMITS)}</p>${scoped.warning ? `<p>${escHtml(scoped.warning)}</p>` : ''}<p>${escHtml(status)}</p><p>العملة: ${escHtml(cur.symbol)}</p>${table}`, settings: reportPrint }))
  }
  return <section className="space-y-4" aria-label="مقارنة القوائم التشغيلية">
    <p className="text-xs text-amber-700 dark:text-amber-300">{LIMITS}</p>
    {activeBranchId == null && branches.length > 0 && profiles.length > 0 && <label className="block text-xs font-bold">نطاق المقارنة الاسترشادي<select className={`${inputCls} block mt-1`} value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">الدفتر الظاهر وفق نطاق التقرير</option>{profiles.map(profile => <option value={profile.id} key={profile.id}>فروع الكيان الحالية: {profile.nameAr}</option>)}</select></label>}
    {profileId && <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="note"><strong>{scoped.label}</strong><p>{scoped.warning}</p></div>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-bold">بداية فترة المقارنة<input className={`${inputCls} block mt-1`} type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="text-xs font-bold">نهاية فترة المقارنة<input className={`${inputCls} block mt-1`} type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <Btn variant="ghost" disabled={!report} onClick={print}>طباعة المقارنة / PDF</Btn>
      <Btn variant="ghost" disabled={!report} onClick={exportCsv}>تصدير المقارنة CSV</Btn>
    </div>
    {!from || !to ? <p className="text-xs text-slate-500">حدد فترة المقارنة السابقة يدوياً؛ لا تُفترض مدة السنة أو قابلية المقارنة تلقائياً.</p> : null}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {report && <><p className="text-xs font-bold" role={report.currentBalanced && report.priorBalanced && report.currentEquityReconciled && report.priorEquityReconciled ? undefined : 'alert'}>{status}</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full text-xs"><thead><tr><th className="p-2 text-right">البند</th><th className="p-2 text-right">الحالية: {currentLabel}</th><th className="p-2 text-right">المقارنة: {priorLabel}</th></tr></thead><tbody>
        {report.sections.map(section => <FragmentSection key={section.key} label={section.label} rows={section.rows} fmt={fmt} />)}
      </tbody></table></div></>}
  </section>
}

function FragmentSection({ label, rows, fmt }: { label: string; rows: readonly { key: string; label: string; currentMinor: number; priorMinor: number }[]; fmt: (value: number) => string }) {
  return <><tr className="bg-slate-100 dark:bg-slate-800 font-bold"><th className="p-2 text-right" colSpan={3}>{label}</th></tr>{rows.map(row => <tr key={row.key} className="border-t border-slate-100 dark:border-slate-800"><td className="p-2">{row.label}</td><td className="p-2 tabular-nums">{fmt(row.currentMinor)}</td><td className="p-2 tabular-nums">{fmt(row.priorMinor)}</td></tr>)}</>
}
