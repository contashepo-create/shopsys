/**
 * تبويبا «تقرير المبيعات» و«تقرير المشتريات» في مركز التقارير (طلب المالك 2026-11-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * «أريد تقريراً مهماً في قائمة التقارير لكل نشاط: تقرير مبيعات وتقرير مشتريات
 * يعرض كل الفواتير مع إمكانية فلترة الفواتير من تاريخ إلى تاريخ.»
 *
 * كل الأرقام من المستندات المرحّلة عبر `core/invoiceReports.ts` (منطق خالص
 * مختبَر)، والواجهة تعرض **كل** فاتورة مفردة (لا تجميعاً) مع فلترة فترة
 * صريحة (من/إلى) وبحث وحالة سداد، وطباعة/تصدير CSV.
 */
import { useMemo, useState } from 'react'
import { CalendarRange, FileSpreadsheet, Printer, Search, X } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import { renderReportShell } from '../../core/reportPrint.ts'
import { todayLocalIso } from '../../core/time.ts'
import {
  buildPurchaseInvoiceReport, buildSalesInvoiceReport, invoiceRangeLabel, purchaseInvoiceReportCsv,
  salesInvoiceReportCsv, summarizePurchaseInvoiceRows, summarizeSalesInvoiceRows,
  type InvoiceReportStatus, type PurchaseInvoiceReportRow, type SalesInvoiceReportRow,
} from '../../core/invoiceReports.ts'
import { printHtml } from '../print/printReceipt.ts'
import { openPurchaseInvoiceWindow, openSalesInvoiceWindow } from '../windows/windowStore.ts'
import { inputCls } from '../components/ui.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const STATUS_OPTIONS: { value: 'all' | InvoiceReportStatus; label: string }[] = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'paid', label: 'مدفوعة' },
  { value: 'partial', label: 'جزئية' },
  { value: 'unpaid', label: 'آجلة' },
]

const statusBadge = (status: InvoiceReportStatus) =>
  status === 'paid'
    ? 'bg-emerald-500/10 text-emerald-600'
    : status === 'partial'
      ? 'bg-amber-500/10 text-amber-600'
      : 'bg-rose-500/10 text-rose-600'

interface TabProps {
  cur: CurrencyConfig
  companyName: string
  initialFrom: string
  initialTo: string
}

/** أزرار فترات سريعة + حالة الفترة المحلية (مستقلة عن فترة المركز أعلاه) */
function useInvoiceRange(centerFrom: string, centerTo: string) {
  // «يعرض كل الفواتير»: يبدأ التقرير بلا فلترة تاريخ، والفلاتر اختيارية
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const today = todayLocalIso()
  const applyPreset = (preset: 'today' | 'month' | 'year' | 'all') => {
    if (preset === 'all') { setFrom(''); setTo(''); return }
    if (preset === 'today') { setFrom(today); setTo(today); return }
    if (preset === 'month') { setFrom(`${today.slice(0, 7)}-01`); setTo(today); return }
    setFrom(`${today.slice(0, 4)}-01-01`); setTo(today)
  }
  const applyCenter = () => { setFrom(centerFrom); setTo(centerTo) }
  return { from, to, setFrom, setTo, applyPreset, applyCenter, today, hasCenter: Boolean(centerFrom && centerTo) }
}

function RangeFilterBar({
  from, to, setFrom, setTo, applyPreset, applyCenter, hasCenter, search, setSearch, status, setStatus, onCsv, onPrint, resultCount,
}: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void
  applyPreset: (preset: 'today' | 'month' | 'year' | 'all') => void
  applyCenter: () => void; hasCenter: boolean
  search: string; setSearch: (v: string) => void
  status: 'all' | InvoiceReportStatus; setStatus: (v: 'all' | InvoiceReportStatus) => void
  onCsv: () => void; onPrint: () => void; resultCount: number
}) {
  return (
    <div className={`${card} p-4 flex flex-wrap items-end gap-3`}>
      <div>
        <label className="text-[10px] font-bold text-slate-400 block mb-1">من تاريخ</label>
        <input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} data-invoice-from />
      </div>
      <div>
        <label className="text-[10px] font-bold text-slate-400 block mb-1">إلى تاريخ</label>
        <input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} data-invoice-to />
      </div>
      <div className="min-w-48">
        <label className="text-[10px] font-bold text-slate-400 block mb-1">بحث</label>
        <div className="relative">
          <Search size={13} className="absolute top-1/2 -translate-y-1/2 end-2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="رقم الفاتورة / المرجع / الطرف" aria-label="بحث في الفواتير" className={`${inputCls} !py-1.5 pe-7`} data-invoice-search />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-bold text-slate-400 block mb-1">حالة السداد</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | InvoiceReportStatus)} className={`${inputCls} !w-auto !py-1.5`} data-invoice-status>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => applyPreset('today')} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600">يوم واحد</button>
        <button type="button" onClick={() => applyPreset('month')} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600">شهر واحد</button>
        <button type="button" onClick={() => applyPreset('year')} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600">سنة واحدة</button>
        <button type="button" onClick={() => applyPreset('all')} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600">كل الفواتير</button>
        {hasCenter && <button type="button" onClick={applyCenter} title="تطبيق فترة مركز التقارير أعلاه" className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-sky-500/10 text-sky-600 hover:bg-sky-500/20">فترة المركز أعلاه</button>}
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo('') }} title="مسح فلترة التاريخ" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500"><X size={13} /></button>
        )}
      </div>
      <div className="ms-auto flex items-center gap-2">
        <span className="text-[11px] font-bold text-slate-400">{resultCount} فاتورة</span>
        <button type="button" onClick={onCsv} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-emerald-600 flex items-center gap-1.5"><FileSpreadsheet size={13} /> CSV</button>
        <button type="button" onClick={onPrint} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 flex items-center gap-1.5"><Printer size={13} /> طباعة</button>
      </div>
      {from && to && from > to && (
        <div className="w-full rounded-lg bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-600" role="alert">
          تاريخ «من» بعد تاريخ «إلى» — لا توجد فواتير مطابقة. صحّح الفترة.
        </div>
      )}
    </div>
  )
}

function SummaryCards({
  cards, cur,
}: {
  cards: { label: string; value: number; tone?: string; hint?: string; isCount?: boolean }[]
  cur: CurrencyConfig
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((item) => (
        <div key={item.label} className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><CalendarRange size={13} /> {item.label}</div>
          <div className={`font-black text-xl mt-1 ${item.tone ?? 'text-slate-800 dark:text-slate-100'}`}>
            {item.isCount ? item.value.toLocaleString('en-US') : formatMinor(item.value, cur, false)}
            {!item.isCount && <span className="text-[11px] font-bold text-slate-400"> {cur.symbol}</span>}
          </div>
          {item.hint && <div className="text-[10px] text-slate-400 mt-0.5">{item.hint}</div>}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center text-slate-400 text-[13px] py-12">{text}</div>
}

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  /* إعطاء المتصفح وقتاً لبدء التنزيل قبل تحرير الـURL — بعض المتصفحات تلغي
     التنزيل إذا أُلغي الـblob فوراً */
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ───────────────────────────── تقرير المبيعات ───────────────────────────── */

export function SalesInvoicesReportTab({ cur, companyName, initialFrom, initialTo }: TabProps) {
  const { sales, customers } = useDataStore()
  const { from, to, setFrom, setTo, applyPreset, applyCenter, hasCenter } = useInvoiceRange(initialFrom, initialTo)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceReportStatus>('all')
  const fmt = (amount: number) => formatMinor(amount, cur, false)

  const report = useMemo(() => buildSalesInvoiceReport(sales, customers, { from, to }, search), [sales, customers, from, to, search])
  const rows = useMemo(() => (status === 'all' ? report.rows : report.rows.filter((row) => row.status === status)), [report.rows, status])
  const summary = useMemo(() => summarizeSalesInvoiceRows(rows), [rows])

  const print = () => {
    const { reportPrint, receipt } = useAppStore.getState()
    const body = `<table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الطرف</th><th>الدفع</th><th>البنود</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td class="num">${esc(row.date.slice(0, 10))}</td><td class="num">${esc(row.invoiceNumber)}</td><td>${esc(row.partyName)}</td><td>${esc(row.paymentLabel)}</td><td class="num">${row.itemCount}</td><td class="num">${fmt(row.totalMinor)}</td><td class="num">${fmt(row.paidMinor)}</td><td class="num">${fmt(row.dueMinor)}</td><td>${esc(row.statusLabel)}</td></tr>`).join('')}
      <tr class="total"><td colspan="5">الإجمالي (${summary.count} فاتورة)</td><td class="num">${fmt(summary.totalMinor)}</td><td class="num">${fmt(summary.paidMinor)}</td><td class="num">${fmt(summary.dueMinor)}</td><td></td></tr>
    </tbody></table>`
    printHtml(renderReportShell({
      title: 'تقرير فواتير المبيعات',
      subtitle: `الفترة: ${invoiceRangeLabel({ from, to })}${search ? ` · بحث: ${search}` : ''}${status !== 'all' ? ` · الحالة: ${STATUS_OPTIONS.find((option) => option.value === status)?.label}` : ''}`,
      companyName,
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: body,
    }))
  }

  return (
    <div className="anim-up space-y-3">
      <RangeFilterBar
        from={from} to={to} setFrom={setFrom} setTo={setTo} applyPreset={applyPreset}
        applyCenter={applyCenter} hasCenter={hasCenter}
        search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        resultCount={rows.length} onCsv={() => downloadCsv('sales-invoices-report.csv', salesInvoiceReportCsv(rows))} onPrint={print}
      />
      <SummaryCards
        cur={cur}
        cards={[
          { label: 'عدد الفواتير', value: summary.count, tone: 'text-sky-600', isCount: true, hint: `${summary.paidCount} مدفوعة · ${summary.partialCount} جزئية · ${summary.unpaidCount} آجلة` },
          { label: 'إجمالي المبيعات', value: summary.totalMinor, hint: `ضريبة ${fmt(summary.taxMinor)} ${cur.symbol}` },
          { label: 'المحصّل', value: summary.paidMinor, tone: 'text-emerald-600' },
          { label: 'المتبقي على العملاء', value: summary.dueMinor, tone: summary.dueMinor > 0 ? 'text-rose-500' : 'text-emerald-600' },
        ]}
      />
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800">
          <div className="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">🧾 كل فواتير البيع <span className="text-[10px] font-normal text-slate-400">— {invoiceRangeLabel({ from, to })}</span></div>
          <span className="text-[10px] text-slate-400">تُستثنى فواتير توثيق المشاريع (بلا إيراد جديد) حتى لا يُحتسب الإيراد مرتين</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState text="لا فواتير بيع مطابقة لهذه الفترة/البحث" />
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-white dark:bg-card-dark z-10">
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2.5 text-right font-bold">التاريخ</th>
                  <th className="px-4 py-2.5 text-right font-bold">الفاتورة</th>
                  <th className="px-4 py-2.5 text-right font-bold">الطرف</th>
                  <th className="px-4 py-2.5 text-right font-bold">الدفع</th>
                  <th className="px-4 py-2.5 text-right font-bold">البنود</th>
                  <th className="px-4 py-2.5 text-left font-bold">الإجمالي</th>
                  <th className="px-4 py-2.5 text-left font-bold">المدفوع</th>
                  <th className="px-4 py-2.5 text-left font-bold">المتبقي</th>
                  <th className="px-4 py-2.5 text-right font-bold">الحالة</th>
                  <th className="px-4 py-2.5 text-left font-bold">فتح</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <SalesRow key={row.id} row={row} cur={cur} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SalesRow({ row, cur }: { row: SalesInvoiceReportRow; cur: CurrencyConfig }) {
  const num = (value: number) => formatMinor(value, cur, false)
  return (
    <tr className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-sky-500/[0.03] transition-colors">
      <td className="px-4 py-2 text-slate-500" dir="ltr">{row.date.slice(0, 10)}</td>
      <td className="px-4 py-2">
        <div className="font-bold text-slate-700 dark:text-slate-200" dir="ltr">{row.invoiceNumber}</div>
        {row.refCode && <div className="text-[9.5px] text-slate-400 font-mono" dir="ltr">{row.refCode}</div>}
      </td>
      <td className="px-4 py-2">
        <div className="font-bold text-slate-700 dark:text-slate-200">{row.partyName}</div>
        <div className="text-[9.5px] text-slate-400">{row.partyKindLabel}</div>
      </td>
      <td className="px-4 py-2 text-slate-500">{row.paymentLabel}</td>
      <td className="px-4 py-2 text-slate-400">{row.itemCount}</td>
      <td className="px-4 py-2 font-black text-slate-700 dark:text-slate-200 text-left" dir="ltr">{num(row.totalMinor)}</td>
      <td className="px-4 py-2 text-emerald-600 text-left" dir="ltr">{num(row.paidMinor)}</td>
      <td className={`px-4 py-2 font-bold text-left ${row.dueMinor > 0 ? 'text-rose-500' : 'text-slate-400'}`} dir="ltr">{num(row.dueMinor)}</td>
      <td className="px-4 py-2 text-right"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(row.status)}`}>{row.statusLabel}</span></td>
      <td className="px-4 py-2 text-left">
        <button type="button" onClick={() => openSalesInvoiceWindow(row.id)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 hover:bg-sky-500/20" data-open-sale={row.id}>مراجعة</button>
      </td>
    </tr>
  )
}

/* ──────────────────────────── تقرير المشتريات ──────────────────────────── */

export function PurchasesInvoicesReportTab({ cur, companyName, initialFrom, initialTo }: TabProps) {
  const { purchases, suppliers } = useDataStore()
  const { from, to, setFrom, setTo, applyPreset, applyCenter, hasCenter } = useInvoiceRange(initialFrom, initialTo)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceReportStatus>('all')
  const fmt = (amount: number) => formatMinor(amount, cur, false)

  const report = useMemo(() => buildPurchaseInvoiceReport(purchases, suppliers, { from, to }, search), [purchases, suppliers, from, to, search])
  const rows = useMemo(() => (status === 'all' ? report.rows : report.rows.filter((row) => row.status === status)), [report.rows, status])
  const summary = useMemo(() => summarizePurchaseInvoiceRows(rows), [rows])

  const print = () => {
    const { reportPrint, receipt } = useAppStore.getState()
    const body = `<table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>المورد</th><th>فاتورة المورد</th><th>الاستحقاق</th><th>الاستلام</th><th>الإجمالي</th><th>مستحق المورد</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td class="num">${esc(row.date.slice(0, 10))}</td><td class="num">${esc(row.invoiceNumber)}</td><td>${esc(row.supplierName)}</td><td>${esc(row.supplierInvoiceNumber || '—')}</td><td class="num">${esc(row.dueDate || '—')}</td><td>${esc(row.receiptStatusLabel)}</td><td class="num">${fmt(row.totalMinor)}</td><td class="num">${fmt(row.supplierDueMinor)}</td><td class="num">${fmt(row.paidMinor)}</td><td class="num">${fmt(row.dueMinor)}</td><td>${esc(row.statusLabel)}</td></tr>`).join('')}
      <tr class="total"><td colspan="6">الإجمالي (${summary.count} فاتورة)</td><td class="num">${fmt(summary.totalMinor)}</td><td class="num">${fmt(summary.supplierDueMinor)}</td><td class="num">${fmt(summary.paidMinor)}</td><td class="num">${fmt(summary.dueMinor)}</td><td></td></tr>
    </tbody></table>`
    printHtml(renderReportShell({
      title: 'تقرير فواتير المشتريات',
      subtitle: `الفترة: ${invoiceRangeLabel({ from, to })}${search ? ` · بحث: ${search}` : ''}${status !== 'all' ? ` · الحالة: ${STATUS_OPTIONS.find((option) => option.value === status)?.label}` : ''}`,
      companyName,
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: body,
    }))
  }

  return (
    <div className="anim-up space-y-3">
      <RangeFilterBar
        from={from} to={to} setFrom={setFrom} setTo={setTo} applyPreset={applyPreset}
        applyCenter={applyCenter} hasCenter={hasCenter}
        search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        resultCount={rows.length} onCsv={() => downloadCsv('purchase-invoices-report.csv', purchaseInvoiceReportCsv(rows))} onPrint={print}
      />
      <SummaryCards
        cur={cur}
        cards={[
          { label: 'عدد الفواتير', value: summary.count, tone: 'text-sky-600', isCount: true, hint: `${summary.paidCount} مدفوعة · ${summary.partialCount} جزئية · ${summary.unpaidCount} آجلة` },
          { label: 'إجمالي المشتريات', value: summary.totalMinor, hint: `مستحق المورد ${fmt(summary.supplierDueMinor)} ${cur.symbol}` },
          { label: 'المسدد للموردين', value: summary.paidMinor, tone: 'text-emerald-600' },
          { label: 'المتبقي على الموردين', value: summary.dueMinor, tone: summary.dueMinor > 0 ? 'text-rose-500' : 'text-emerald-600' },
        ]}
      />
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800">
          <div className="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">🛒 كل فواتير الشراء <span className="text-[10px] font-normal text-slate-400">— {invoiceRangeLabel({ from, to })}</span></div>
          <span className="text-[10px] text-slate-400">«مستحق المورد» = البضاعة + مصاريفه؛ المصاريف المدفوعة من خزنتك لا تدخل دين المورد</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState text="لا فواتير شراء مطابقة لهذه الفترة/البحث" />
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-white dark:bg-card-dark z-10">
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2.5 text-right font-bold">التاريخ</th>
                  <th className="px-4 py-2.5 text-right font-bold">الفاتورة</th>
                  <th className="px-4 py-2.5 text-right font-bold">المورد</th>
                  <th className="px-4 py-2.5 text-right font-bold">فاتورة المورد</th>
                  <th className="px-4 py-2.5 text-right font-bold">الاستحقاق</th>
                  <th className="px-4 py-2.5 text-right font-bold">الاستلام</th>
                  <th className="px-4 py-2.5 text-left font-bold">الإجمالي</th>
                  <th className="px-4 py-2.5 text-left font-bold">مستحق المورد</th>
                  <th className="px-4 py-2.5 text-left font-bold">المدفوع</th>
                  <th className="px-4 py-2.5 text-left font-bold">المتبقي</th>
                  <th className="px-4 py-2.5 text-right font-bold">الحالة</th>
                  <th className="px-4 py-2.5 text-left font-bold">فتح</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <PurchaseRow key={row.id} row={row} cur={cur} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function PurchaseRow({ row, cur }: { row: PurchaseInvoiceReportRow; cur: CurrencyConfig }) {
  const num = (value: number) => formatMinor(value, cur, false)
  return (
    <tr className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-sky-500/[0.03] transition-colors">
      <td className="px-4 py-2 text-slate-500" dir="ltr">{row.date.slice(0, 10)}</td>
      <td className="px-4 py-2">
        <div className="font-bold text-slate-700 dark:text-slate-200" dir="ltr">{row.invoiceNumber}</div>
        {row.refCode && <div className="text-[9.5px] text-slate-400 font-mono" dir="ltr">{row.refCode}</div>}
      </td>
      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{row.supplierName}</td>
      <td className="px-4 py-2 text-slate-500" dir="ltr">{row.supplierInvoiceNumber || '—'}</td>
      <td className="px-4 py-2 text-slate-500" dir="ltr">{row.dueDate || '—'}</td>
      <td className="px-4 py-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.receiptStatusLabel === 'مستلمة' ? 'bg-emerald-500/10 text-emerald-600' : row.receiptStatusLabel === 'استلام جزئي' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-500'}`}>{row.receiptStatusLabel}</span>
      </td>
      <td className="px-4 py-2 font-black text-slate-700 dark:text-slate-200 text-left" dir="ltr">{num(row.totalMinor)}</td>
      <td className="px-4 py-2 text-slate-500 text-left" dir="ltr">{num(row.supplierDueMinor)}</td>
      <td className="px-4 py-2 text-emerald-600 text-left" dir="ltr">{num(row.paidMinor)}</td>
      <td className={`px-4 py-2 font-bold text-left ${row.dueMinor > 0 ? 'text-rose-500' : 'text-slate-400'}`} dir="ltr">{num(row.dueMinor)}</td>
      <td className="px-4 py-2 text-right"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(row.status)}`}>{row.statusLabel}</span></td>
      <td className="px-4 py-2 text-left">
        <button type="button" onClick={() => openPurchaseInvoiceWindow(row.id)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 hover:bg-sky-500/20" data-open-purchase={row.id}>مراجعة</button>
      </td>
    </tr>
  )
}
