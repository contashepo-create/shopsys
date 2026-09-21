/**
 * تبويب «القوائم المالية» بمركز التقارير (أمر المالك):
 * قائمة منسدلة لاختيار التقرير + فلتر الفترة → عرض → طباعة/PDF أو تصدير Excel:
 * ميزان المراجعة، قائمة الدخل، المركز المالي، دفتر الأستاذ العام، التدفق النقدي، تقرير الضريبة.
 */
import { useMemo, useState } from 'react'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import { useActivityBaseCoa } from '../activityCoa.ts'
import {
  trialBalance, incomeStatement, balanceSheet, generalLedger, cashFlowReport, vatReport, toCsv,
  type FinPeriod,
} from '../../core/financialReports.ts'
import { Btn, inputCls } from '../components/ui.tsx'
import { printHtml } from '../print/printReceipt.ts'
import { renderReportShell } from '../../core/reportPrint.ts'
import { useAppStore } from '../../stores/app.store.ts'

type FinReportId = 'trial_balance' | 'income' | 'balance_sheet' | 'gl' | 'cash_flow' | 'vat'

/** تسميات أنشطة التدفق النقدي (IAS 7) */
const CF_ACTIVITY_LABELS = { operating: 'تشغيلي', investing: 'استثماري', financing: 'تمويلي' } as const

const REPORTS: { id: FinReportId; nameAr: string; icon: string }[] = [
  { id: 'trial_balance', nameAr: 'ميزان المراجعة', icon: '⚖️' },
  { id: 'income', nameAr: 'قائمة الدخل (الأرباح والخسائر)', icon: '📈' },
  { id: 'balance_sheet', nameAr: 'المركز المالي (الميزانية)', icon: '🏛️' },
  { id: 'gl', nameAr: 'دفتر الأستاذ العام (حركة حساب)', icon: '📒' },
  { id: 'cash_flow', nameAr: 'التدفق النقدي (النقدية والسيولة)', icon: '💧' },
  { id: 'vat', nameAr: 'تقرير الضريبة (ض.ق.م)', icon: '🧾' },
]

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** غلاف طباعة موحّد احترافي للقوائم المالية */


export function FinancialReportsTab({ period, cur, companyName }: { period: { from: string; to: string }; cur: CurrencyConfig; companyName: string }) {
  const { customAccounts, journal, treasuries } = useDataStore()
  const [reportId, setReportId] = useState<FinReportId>('trial_balance')
  const [glAccount, setGlAccount] = useState('1101')

  const fmt = (m: number) => formatMinor(m, cur, false)
  const p: FinPeriod = period
  const periodLabel = `من ${p.from} إلى ${p.to}`
  const extraNames = useMemo(() => Object.fromEntries([...treasuries.map((t) => [t.code, t.nameAr] as const), ...customAccounts.map((a) => [a.code, a.nameAr] as const)]), [treasuries, customAccounts])
  const cashCodes = useMemo(() => treasuries.map((t) => t.code), [treasuries])
  // قائمة حسابات دفتر الأستاذ مفلترة حسب النشاط (وحساب متحرك يظهر دائماً — صمام الأمان)
  const activityBase = useActivityBaseCoa()
  const accountOptions = useMemo(() => {
    const std = activityBase.filter((a) => a.isPostable).map((a) => ({ code: a.code, nameAr: a.nameAr }))
    const extra = treasuries.filter((t) => !std.some((a) => a.code === t.code)).map((t) => ({ code: t.code, nameAr: t.nameAr }))
    // الحسابات المخصصة التي أضافها المالك — تظهر في دفتر الأستاذ كأي حساب
    const customs = customAccounts.map((a) => ({ code: a.code, nameAr: a.nameAr }))
    return [...std, ...extra, ...customs].sort((a, b) => a.code.localeCompare(b.code))
  }, [activityBase, treasuries, customAccounts])

  const tb = useMemo(() => (reportId === 'trial_balance' ? trialBalance(journal, p, extraNames) : null), [reportId, journal, p, extraNames])
  const inc = useMemo(() => (reportId === 'income' ? incomeStatement(journal, p, extraNames) : null), [reportId, journal, p, extraNames])
  const bs = useMemo(() => (reportId === 'balance_sheet' ? balanceSheet(journal, p.to, extraNames) : null), [reportId, journal, p.to, extraNames])
  const gl = useMemo(() => (reportId === 'gl' ? generalLedger(journal, glAccount, p, extraNames) : null), [reportId, journal, glAccount, p, extraNames])
  const cf = useMemo(() => (reportId === 'cash_flow' ? cashFlowReport(journal, cashCodes, p, extraNames) : null), [reportId, journal, cashCodes, p, extraNames])
  const vat = useMemo(() => (reportId === 'vat' ? vatReport(journal, p) : null), [reportId, journal, p])

  const reportName = REPORTS.find((r) => r.id === reportId)!.nameAr

  /* ─── تصدير Excel (CSV) ─── */
  const exportExcel = () => {
    let csv = ''
    if (tb) csv = toCsv(['الكود', 'الحساب', 'مدين', 'دائن'], [
      ...tb.rows.map((r) => [r.code, r.nameAr, fmt(r.debitMinor), fmt(r.creditMinor)]),
      ['', 'الإجمالي', fmt(tb.totalDebitMinor), fmt(tb.totalCreditMinor)],
    ])
    if (inc) csv = toCsv(['البند', 'المبلغ'], [
      ...inc.revenues.map((r) => [`إيراد — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['إجمالي الإيرادات', fmt(inc.totalRevenueMinor)],
      ...inc.costOfSales.map((r) => [`تكلفة مباشرة — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['إجمالي التكاليف المباشرة', fmt(inc.totalCostOfSalesMinor)],
      ['مجمل الربح', fmt(inc.grossProfitMinor)],
      ...inc.operatingExpenses.map((r) => [`مصروف تشغيلي — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['إجمالي المصروفات التشغيلية', fmt(inc.totalOperatingExpenseMinor)],
      [inc.netProfitMinor >= 0 ? 'صافي الربح' : 'صافي الخسارة', fmt(Math.abs(inc.netProfitMinor))],
    ])
    if (bs) csv = toCsv(['البند', 'المبلغ'], [
      ...bs.currentAssets.map((r) => [`أصول متداولة — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['إجمالي الأصول المتداولة', fmt(bs.totalCurrentAssetsMinor)],
      ...bs.nonCurrentAssets.map((r) => [`أصول غير متداولة — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['إجمالي الأصول غير المتداولة', fmt(bs.totalNonCurrentAssetsMinor)],
      ['إجمالي الأصول', fmt(bs.totalAssetsMinor)],
      ...bs.liabilities.map((r) => [`التزامات — ${r.nameAr}`, fmt(r.amountMinor)]),
      ...bs.equity.map((r) => [`حقوق ملكية — ${r.nameAr}`, fmt(r.amountMinor)]),
      ['أرباح مرحلة (نتيجة النشاط)', fmt(bs.retainedEarningsMinor)],
      ['إجمالي الالتزامات وحقوق الملكية', fmt(bs.totalLiabilitiesEquityMinor)],
    ])
    if (gl) csv = toCsv(['التاريخ', 'قيد', 'البيان', 'مدين', 'دائن', 'الرصيد'], [
      ['', '', 'رصيد أول الفترة', '', '', fmt(gl.openingMinor)],
      ...gl.rows.map((r) => [r.date.slice(0, 10), `#${r.entryNumber}`, r.description, fmt(r.debitMinor), fmt(r.creditMinor), fmt(r.balanceMinor)]),
      ['', '', 'رصيد آخر الفترة', '', '', fmt(gl.closingMinor)],
    ])
    if (cf) csv = toCsv(['البند', 'المبلغ'], [
      ['رصيد النقدية أول الفترة', fmt(cf.openingCashMinor)],
      ...cf.inflows.map((r) => [`داخل (${CF_ACTIVITY_LABELS[r.activity]}) — ${r.label}`, fmt(r.amountMinor)]),
      ['إجمالي المقبوضات', fmt(cf.totalInMinor)],
      ...cf.outflows.map((r) => [`خارج (${CF_ACTIVITY_LABELS[r.activity]}) — ${r.label}`, fmt(r.amountMinor)]),
      ['إجمالي المدفوعات', fmt(cf.totalOutMinor)],
      ['صافي التدفق التشغيلي', fmt(cf.operatingNetMinor)],
      ['صافي التدفق الاستثماري', fmt(cf.investingNetMinor)],
      ['صافي التدفق التمويلي', fmt(cf.financingNetMinor)],
      ['صافي التغير', fmt(cf.netChangeMinor)],
      ['رصيد النقدية آخر الفترة', fmt(cf.closingCashMinor)],
    ])
    if (vat) csv = toCsv(['البند', 'المبلغ'], [
      ['ضريبة المخرجات (مبيعات ومرتجعاتها)', fmt(vat.outputVatMinor)],
      ['ضريبة المدخلات (مشتريات ومرتجعاتها)', fmt(vat.inputVatMinor)],
      [vat.netDueMinor >= 0 ? 'صافي إقرار الفترة (مستحق للمصلحة)' : 'رصيد ضريبي دائن لك', fmt(Math.abs(vat.netDueMinor))],
      ['المسدد للمصلحة خلال الفترة', fmt(vat.settledMinor)],
      [vat.remainingMinor >= 0 ? 'المتبقي بعد السداد' : 'رصيد دائن بعد السداد', fmt(Math.abs(vat.remainingMinor))],
    ])
    downloadCsv(`${reportName}-${p.from}-${p.to}.csv`, csv)
  }

  /* ─── طباعة / PDF ─── */
  const printReport = () => {
    const num = (m: number) => `<td class="num">${fmt(m)}</td>`
    let body = ''
    if (tb) body = `<table><tr><th>الكود</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr>${tb.rows.map((r) => `<tr><td dir="ltr">${r.code}</td><td>${r.nameAr}</td>${num(r.debitMinor)}${num(r.creditMinor)}</tr>`).join('')}<tr class="total"><td></td><td>الإجمالي ${tb.balanced ? '✓ متوازن' : '⚠ غير متوازن'}</td>${num(tb.totalDebitMinor)}${num(tb.totalCreditMinor)}</tr></table>`
    if (inc) body = `<table><tr><th>البند</th><th>المبلغ</th></tr><tr class="sec"><td colspan="2">الإيرادات</td></tr>${inc.revenues.map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي الإيرادات</td>${num(inc.totalRevenueMinor)}</tr><tr class="sec"><td colspan="2">التكاليف المباشرة (تكلفة الإيراد)</td></tr>${inc.costOfSales.map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>مجمل الربح</td>${num(inc.grossProfitMinor)}</tr><tr class="sec"><td colspan="2">المصروفات التشغيلية</td></tr>${inc.operatingExpenses.map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي المصروفات التشغيلية</td>${num(inc.totalOperatingExpenseMinor)}</tr><tr class="total"><td>${inc.netProfitMinor >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</td>${num(Math.abs(inc.netProfitMinor))}</tr></table>`
    if (bs) body = `<table><tr><th>البند</th><th>المبلغ</th></tr><tr class="sec"><td colspan="2">الأصول المتداولة</td></tr>${bs.currentAssets.map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي الأصول المتداولة</td>${num(bs.totalCurrentAssetsMinor)}</tr>${bs.nonCurrentAssets.length ? `<tr class="sec"><td colspan="2">الأصول غير المتداولة</td></tr>${bs.nonCurrentAssets.map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي الأصول غير المتداولة</td>${num(bs.totalNonCurrentAssetsMinor)}</tr>` : ''}<tr class="total"><td>إجمالي الأصول</td>${num(bs.totalAssetsMinor)}</tr><tr class="sec"><td colspan="2">الالتزامات وحقوق الملكية</td></tr>${[...bs.liabilities, ...bs.equity].map((r) => `<tr><td>${r.nameAr}</td>${num(r.amountMinor)}</tr>`).join('')}<tr><td>أرباح مرحلة (نتيجة النشاط)</td>${num(bs.retainedEarningsMinor)}</tr><tr class="total"><td>إجمالي الالتزامات وحقوق الملكية ${bs.balanced ? '✓' : '⚠'}</td>${num(bs.totalLiabilitiesEquityMinor)}</tr></table>`
    if (gl) body = `<table><tr><th>التاريخ</th><th>قيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr><tr class="sec"><td colspan="5">رصيد أول الفترة — ${gl.accountName}</td>${num(gl.openingMinor)}</tr>${gl.rows.map((r) => `<tr><td dir="ltr">${r.date.slice(0, 10)}</td><td dir="ltr">#${r.entryNumber}</td><td>${r.description}</td>${num(r.debitMinor)}${num(r.creditMinor)}${num(r.balanceMinor)}</tr>`).join('')}<tr class="total"><td colspan="5">رصيد آخر الفترة</td>${num(gl.closingMinor)}</tr></table>`
    if (cf) body = `<table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>رصيد النقدية أول الفترة</td>${num(cf.openingCashMinor)}</tr><tr class="sec"><td colspan="2">المقبوضات</td></tr>${cf.inflows.map((r) => `<tr><td>${r.label} <small>(${CF_ACTIVITY_LABELS[r.activity]})</small></td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي المقبوضات</td>${num(cf.totalInMinor)}</tr><tr class="sec"><td colspan="2">المدفوعات</td></tr>${cf.outflows.map((r) => `<tr><td>${r.label} <small>(${CF_ACTIVITY_LABELS[r.activity]})</small></td>${num(r.amountMinor)}</tr>`).join('')}<tr class="total"><td>إجمالي المدفوعات</td>${num(cf.totalOutMinor)}</tr><tr class="sec"><td colspan="2">صافي التدفقات حسب النشاط (IAS 7)</td></tr><tr><td>التشغيلي</td>${num(cf.operatingNetMinor)}</tr><tr><td>الاستثماري</td>${num(cf.investingNetMinor)}</tr><tr><td>التمويلي</td>${num(cf.financingNetMinor)}</tr><tr class="total"><td>رصيد النقدية آخر الفترة</td>${num(cf.closingCashMinor)}</tr></table>`
    if (vat) body = `<table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>ضريبة المخرجات (مبيعات ومرتجعاتها)</td>${num(vat.outputVatMinor)}</tr><tr><td>ضريبة المدخلات (مشتريات ومرتجعاتها)</td>${num(vat.inputVatMinor)}</tr><tr class="total"><td>${vat.netDueMinor >= 0 ? 'صافي إقرار الفترة (مستحق للمصلحة)' : 'رصيد ضريبي دائن لك'}</td>${num(Math.abs(vat.netDueMinor))}</tr><tr><td>المسدد للمصلحة خلال الفترة</td>${num(vat.settledMinor)}</tr><tr class="total"><td>${vat.remainingMinor >= 0 ? 'المتبقي بعد السداد' : 'رصيد دائن بعد السداد'}</td>${num(Math.abs(vat.remainingMinor))}</tr></table>`
    // الغلاف الموحّد بإعدادات طباعة التقارير (طلب المالك: إعدادات لكل مطبوعة لا الفواتير فقط)
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({
      title: reportName,
      subtitle: `${companyName} — ${reportId === 'balance_sheet' ? `حتى ${p.to}` : periodLabel}`,
      companyName,
      logoDataUrl: receipt.logoDataUrl,
      bodyHtml: body,
      settings: reportPrint,
    }))
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
  const th = 'px-3 py-2 text-right text-[11px] font-black text-slate-400'
  const td = 'px-3 py-2 text-[12.5px]'
  const numTd = `${td} font-bold tabular-nums`
  const rowB = 'border-t border-slate-100 dark:border-slate-800'

  return (
    <div className={`anim-up ${card} p-5 space-y-4`}>
      {/* اختيار التقرير + أدوات التصدير */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px]">
          <div className="text-[11px] font-bold text-slate-400 mb-1">نوع التقرير</div>
          <select value={reportId} onChange={(e) => setReportId(e.target.value as FinReportId)} className={inputCls}>
            {REPORTS.map((r) => <option key={r.id} value={r.id}>{r.icon} {r.nameAr}</option>)}
          </select>
        </div>
        {reportId === 'gl' && (
          <div className="min-w-[240px]">
            <div className="text-[11px] font-bold text-slate-400 mb-1">الحساب</div>
            <select value={glAccount} onChange={(e) => setGlAccount(e.target.value)} className={inputCls}>
              {accountOptions.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 ms-auto">
          <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700" onClick={printReport}><Printer size={14} /> طباعة / PDF</Btn>
          <Btn variant="ghost" className="border border-emerald-300/50 text-emerald-600" onClick={exportExcel}><FileSpreadsheet size={14} /> تصدير Excel</Btn>
        </div>
      </div>

      {/* ─── ميزان المراجعة ─── */}
      {tb && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className={th}>الكود</th><th className={th}>الحساب</th><th className={th}>مدين</th><th className={th}>دائن</th></tr></thead>
            <tbody>
              {tb.rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 text-[12px]">لا قيود في الفترة</td></tr>}
              {tb.rows.map((r) => (
                <tr key={r.code} className={rowB}>
                  <td className={`${td} font-mono text-slate-400`} dir="ltr">{r.code}</td>
                  <td className={td}>{r.nameAr}</td>
                  <td className={numTd}>{r.debitMinor ? fmt(r.debitMinor) : '—'}</td>
                  <td className={numTd}>{r.creditMinor ? fmt(r.creditMinor) : '—'}</td>
                </tr>
              ))}
              <tr className={`${rowB} bg-slate-50 dark:bg-slate-800/50 font-black`}>
                <td className={td}></td>
                <td className={td}>الإجمالي {tb.balanced ? <span className="text-emerald-600">✓ متوازن</span> : <span className="text-rose-600">⚠ غير متوازن</span>}</td>
                <td className={numTd}>{fmt(tb.totalDebitMinor)}</td>
                <td className={numTd}>{fmt(tb.totalCreditMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ─── قائمة الدخل ─── */}
      {inc && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
              <div className="px-4 py-2 bg-emerald-500/5 font-black text-[12px] text-emerald-600">الإيرادات</div>
              {inc.revenues.map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
              <div className={`flex justify-between px-4 py-2 ${rowB} bg-emerald-500/5 font-black text-[13px]`}><span>إجمالي الإيرادات</span><span className="tabular-nums">{fmt(inc.totalRevenueMinor)}</span></div>
            </div>
            <div className="rounded-xl border border-amber-500/20 overflow-hidden">
              <div className="px-4 py-2 bg-amber-500/5 font-black text-[12px] text-amber-600">التكاليف المباشرة (تكلفة الإيراد)</div>
              {inc.costOfSales.length === 0 && <div className="px-4 py-3 text-center text-slate-400 text-[12px]">لا تكاليف مباشرة</div>}
              {inc.costOfSales.map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
              <div className={`flex justify-between px-4 py-2 ${rowB} bg-amber-500/5 font-black text-[13px]`}><span>إجمالي التكاليف المباشرة</span><span className="tabular-nums">{fmt(inc.totalCostOfSalesMinor)}</span></div>
            </div>
            <div className="rounded-xl border border-rose-500/20 overflow-hidden">
              <div className="px-4 py-2 bg-rose-500/5 font-black text-[12px] text-rose-600">المصروفات التشغيلية</div>
              {inc.operatingExpenses.length === 0 && <div className="px-4 py-3 text-center text-slate-400 text-[12px]">لا مصروفات تشغيلية</div>}
              {inc.operatingExpenses.map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
              <div className={`flex justify-between px-4 py-2 ${rowB} bg-rose-500/5 font-black text-[13px]`}><span>إجمالي المصروفات التشغيلية</span><span className="tabular-nums">{fmt(inc.totalOperatingExpenseMinor)}</span></div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className={`rounded-xl p-4 text-center font-black text-lg ${inc.grossProfitMinor >= 0 ? 'bg-sky-500/10 text-sky-600' : 'bg-rose-500/10 text-rose-600'}`}>
              مجمل الربح: {fmt(Math.abs(inc.grossProfitMinor))} {cur.symbol}{inc.grossProfitMinor < 0 ? ' (خسارة)' : ''}
              {inc.totalRevenueMinor > 0 && <span className="block text-[11px] font-bold text-slate-400 mt-1">هامش مجمل {(Math.round((inc.grossProfitMinor / inc.totalRevenueMinor) * 1000) / 10).toLocaleString('ar-EG')}٪</span>}
            </div>
            <div className={`rounded-xl p-4 text-center font-black text-lg ${inc.netProfitMinor >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
              {inc.netProfitMinor >= 0 ? '📈 صافي الربح' : '📉 صافي الخسارة'}: {fmt(Math.abs(inc.netProfitMinor))} {cur.symbol}
              {inc.totalRevenueMinor > 0 && <span className="block text-[11px] font-bold text-slate-400 mt-1">هامش صافٍ {(Math.round((inc.netProfitMinor / inc.totalRevenueMinor) * 1000) / 10).toLocaleString('ar-EG')}٪</span>}
            </div>
          </div>
        </div>
      )}

      {/* ─── المركز المالي ─── */}
      {bs && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-sky-500/20 overflow-hidden">
            <div className="px-4 py-2 bg-sky-500/5 font-black text-[12px] text-sky-600">الأصول (حتى {p.to})</div>
            <div className="px-4 py-1.5 text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800/40">الأصول المتداولة</div>
            {bs.currentAssets.map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
            <div className={`flex justify-between px-4 py-1.5 ${rowB} text-[11.5px] font-bold text-slate-500`}><span>إجمالي المتداولة</span><span className="tabular-nums">{fmt(bs.totalCurrentAssetsMinor)}</span></div>
            {bs.nonCurrentAssets.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800/40">الأصول غير المتداولة</div>
                {bs.nonCurrentAssets.map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
                <div className={`flex justify-between px-4 py-1.5 ${rowB} text-[11.5px] font-bold text-slate-500`}><span>إجمالي غير المتداولة</span><span className="tabular-nums">{fmt(bs.totalNonCurrentAssetsMinor)}</span></div>
              </>
            )}
            <div className={`flex justify-between px-4 py-2 ${rowB} bg-sky-500/5 font-black text-[13px]`}><span>إجمالي الأصول</span><span className="tabular-nums">{fmt(bs.totalAssetsMinor)}</span></div>
          </div>
          <div className="rounded-xl border border-violet-500/20 overflow-hidden">
            <div className="px-4 py-2 bg-violet-500/5 font-black text-[12px] text-violet-600">الالتزامات وحقوق الملكية</div>
            {[...bs.liabilities, ...bs.equity].map((r) => <div key={r.code} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.nameAr}</span><b className="tabular-nums">{fmt(r.amountMinor)}</b></div>)}
            <div className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>أرباح مرحلة (نتيجة النشاط)</span><b className="tabular-nums">{fmt(bs.retainedEarningsMinor)}</b></div>
            <div className={`flex justify-between px-4 py-2 ${rowB} bg-violet-500/5 font-black text-[13px]`}><span>الإجمالي {bs.balanced ? <span className="text-emerald-600">✓</span> : <span className="text-rose-600">⚠</span>}</span><span className="tabular-nums">{fmt(bs.totalLiabilitiesEquityMinor)}</span></div>
          </div>
        </div>
      )}

      {/* ─── دفتر الأستاذ ─── */}
      {gl && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap gap-4 text-[11.5px] font-bold">
            <span>📒 {gl.accountCode} — {gl.accountName}</span>
            <span className="text-slate-400">رصيد أول الفترة: <b className="text-slate-600 dark:text-slate-300 tabular-nums">{fmt(gl.openingMinor)}</b></span>
            <span className="text-slate-400">رصيد آخر الفترة: <b className="text-slate-600 dark:text-slate-300 tabular-nums">{fmt(gl.closingMinor)}</b></span>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className={th}>التاريخ</th><th className={th}>قيد</th><th className={th}>البيان</th><th className={th}>مدين</th><th className={th}>دائن</th><th className={th}>الرصيد</th></tr></thead>
            <tbody>
              {gl.rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400 text-[12px]">لا حركات على الحساب في الفترة</td></tr>}
              {gl.rows.map((r, i) => (
                <tr key={i} className={rowB}>
                  <td className={`${td} text-slate-400`} dir="ltr">{r.date.slice(0, 10)}</td>
                  <td className={`${td} font-mono text-slate-400`} dir="ltr">#{r.entryNumber}</td>
                  <td className={td}>{r.description}</td>
                  <td className={numTd}>{r.debitMinor ? fmt(r.debitMinor) : '—'}</td>
                  <td className={numTd}>{r.creditMinor ? fmt(r.creditMinor) : '—'}</td>
                  <td className={`${numTd} ${r.balanceMinor < 0 ? 'text-rose-500' : ''}`}>{fmt(r.balanceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── التدفق النقدي ─── */}
      {cf && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">نقدية أول الفترة</div><div className="font-black tabular-nums">{fmt(cf.openingCashMinor)}</div></div>
            <div className="p-3 rounded-xl bg-emerald-500/5"><div className="text-[10px] text-slate-400">إجمالي المقبوضات</div><div className="font-black text-emerald-600 tabular-nums">{fmt(cf.totalInMinor)}</div></div>
            <div className="p-3 rounded-xl bg-rose-500/5"><div className="text-[10px] text-slate-400">إجمالي المدفوعات</div><div className="font-black text-rose-600 tabular-nums">{fmt(cf.totalOutMinor)}</div></div>
            <div className="p-3 rounded-xl bg-sky-500/5"><div className="text-[10px] text-slate-400">نقدية آخر الفترة</div><div className="font-black text-sky-600 tabular-nums">{fmt(cf.closingCashMinor)}</div></div>
          </div>
          {/* صافي التدفقات حسب النشاط — IAS 7 (المقارنة العالمية: QuickBooks/Xero) */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5"><div className="text-[10px] text-slate-400 font-bold">صافي التشغيلي</div><div className={`font-black tabular-nums ${cf.operatingNetMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(cf.operatingNetMinor)}</div></div>
            <div className="p-3 rounded-xl border border-violet-500/15 bg-violet-500/5"><div className="text-[10px] text-slate-400 font-bold">صافي الاستثماري</div><div className={`font-black tabular-nums ${cf.investingNetMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(cf.investingNetMinor)}</div></div>
            <div className="p-3 rounded-xl border border-amber-500/15 bg-amber-500/5"><div className="text-[10px] text-slate-400 font-bold">صافي التمويلي</div><div className={`font-black tabular-nums ${cf.financingNetMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(cf.financingNetMinor)}</div></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
              <div className="px-4 py-2 bg-emerald-500/5 font-black text-[12px] text-emerald-600">تدفقات داخلة</div>
              {cf.inflows.length === 0 && <div className="p-4 text-center text-slate-400 text-[12px]">لا مقبوضات</div>}
              {cf.inflows.map((r, i) => <div key={i} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.label} <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 font-bold">{CF_ACTIVITY_LABELS[r.activity]}</span></span><b className="text-emerald-600 tabular-nums">{fmt(r.amountMinor)}</b></div>)}
            </div>
            <div className="rounded-xl border border-rose-500/20 overflow-hidden">
              <div className="px-4 py-2 bg-rose-500/5 font-black text-[12px] text-rose-600">تدفقات خارجة</div>
              {cf.outflows.length === 0 && <div className="p-4 text-center text-slate-400 text-[12px]">لا مدفوعات</div>}
              {cf.outflows.map((r, i) => <div key={i} className={`flex justify-between px-4 py-2 ${rowB} text-[12.5px]`}><span>{r.label} <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 font-bold">{CF_ACTIVITY_LABELS[r.activity]}</span></span><b className="text-rose-600 tabular-nums">{fmt(r.amountMinor)}</b></div>)}
            </div>
          </div>
        </div>
      )}

      {/* ─── تقرير الضريبة ─── */}
      {vat && (
        <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3 text-center">
          <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15"><div className="text-[11px] text-slate-400 font-bold">ضريبة المخرجات (مبيعات ومرتجعاتها)</div><div className="font-black text-xl mt-1 text-emerald-600 tabular-nums">{fmt(vat.outputVatMinor)}</div></div>
          <div className="p-4 rounded-xl bg-sky-500/5 border border-sky-500/15"><div className="text-[11px] text-slate-400 font-bold">ضريبة المدخلات (مشتريات ومرتجعاتها)</div><div className="font-black text-xl mt-1 text-sky-600 tabular-nums">{fmt(vat.inputVatMinor)}</div></div>
          <div className={`p-4 rounded-xl border ${vat.netDueMinor >= 0 ? 'bg-rose-500/5 border-rose-500/15' : 'bg-emerald-500/5 border-emerald-500/15'}`}>
            <div className="text-[11px] text-slate-400 font-bold">{vat.netDueMinor >= 0 ? 'إقرار الفترة (مستحق للمصلحة)' : 'رصيد دائن لك'}</div>
            <div className={`font-black text-xl mt-1 tabular-nums ${vat.netDueMinor >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(Math.abs(vat.netDueMinor))}</div>
          </div>
          <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/15"><div className="text-[11px] text-slate-400 font-bold">المسدد للمصلحة بالفترة</div><div className="font-black text-xl mt-1 text-violet-600 tabular-nums">{fmt(vat.settledMinor)}</div></div>
          <div className={`p-4 rounded-xl border ${vat.remainingMinor > 0 ? 'bg-amber-500/5 border-amber-500/15' : 'bg-emerald-500/5 border-emerald-500/15'}`}>
            <div className="text-[11px] text-slate-400 font-bold">{vat.remainingMinor >= 0 ? 'المتبقي بعد السداد' : 'رصيد دائن بعد السداد'}</div>
            <div className={`font-black text-xl mt-1 tabular-nums ${vat.remainingMinor > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmt(Math.abs(vat.remainingMinor))}</div>
          </div>
        </div>
      )}
    </div>
  )
}
