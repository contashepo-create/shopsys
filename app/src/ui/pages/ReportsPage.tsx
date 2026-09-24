/**
 * مركز التقارير (المرحلة 5) — كل الأرقام من المستندات المرحّلة وقيودها:
 * ملخص المبيعات والأرباح، مبيعات يومية (أعمدة)، أفضل الأصناف،
 * أرصدة العملاء والموردين، تنبيهات وقيمة المخزون — بفترات جاهزة أو مخصصة.
 */
import { useMemo, useState } from 'react'
import { BarChart3, TrendingUp, PackageSearch, Users, Truck, AlertTriangle, Boxes, ReceiptText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import {
  salesSummary, topItems, dailySales, stagnantItems,
  stockAlerts, inventoryValue, periodPresets, type Period,
} from '../../core/reports.ts'
import { expiryAlerts } from '../../core/batches.ts'
import { agingFromStatement, supplierRowsForAging } from '../../core/statements.ts'
import { expensesSummary, expenseDetails, invoiceExpensesByCostCenter, costCenterExpensesCsv, expenseSummaryCsv, expenseDetailsCsv, invoiceExpensesByCategory, invoiceExpenseCategoriesCsv } from '../../core/expenseReports.ts'
import { accountName } from './accountNames.ts'
import { inputCls } from '../components/ui.tsx'
import { FinancialReportsTab } from './FinancialReportsTab.tsx'
import { renderReportShell } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Printer } from 'lucide-react'
import { Landmark } from 'lucide-react'

type TabId = 'sales' | 'items' | 'parties' | 'inventory' | 'expenses' | 'financial'

/** تسميات مصادر العمليات لتقرير المصروفات */
const EXP_SOURCE_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع', purchase: 'فاتورة شراء', payment_voucher: 'سند صرف', payroll: 'رواتب',
  manual: 'قيد يدوي', depreciation: 'إهلاك', wastage: 'هالك', logistics_trip: 'نقلة',
  reversal: 'قيد عاكس', adjustment: 'تسوية', asset_payment: 'سداد أصل', external_commission: 'عمولات',
  contracting: 'مقاولات', lab: 'معمل', sale_return: 'مرتجع بيع', purchase_return: 'مرتجع شراء',
}

export function ReportsPage() {
  const { sales, saleReturns, items, customers, suppliers, batches, journal, customAccounts, projects } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const today = new Date().toISOString()

  const presets = useMemo(() => periodPresets(today), [today])
  const [presetId, setPresetId] = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const period: Period = useMemo(() => {
    if (presetId === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo }
    return presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  }, [presetId, customFrom, customTo, presets])

  const [tab, setTab] = useState<TabId>('sales')
  const [costProject, setCostProject] = useState<string>('all')
  const [costSettlement, setCostSettlement] = useState<'all' | 'paid_now' | 'payable_later'>('all')

  /* ─── الحسابات (كلها نواة خالصة) ─── */
  const summary = useMemo(() => salesSummary(sales, saleReturns, period), [sales, saleReturns, period])
  const daily = useMemo(() => dailySales(sales, period), [sales, period, costProject, costSettlement])
  const top = useMemo(() => topItems(sales, saleReturns, period, 10), [sales, saleReturns, period])
  // الراكد (سد فجوة DEXEF): مخزون بلا حركة بيع 30+ يوماً = رأس مال محبوس
  const stagnant = useMemo(() => stagnantItems(items, sales, new Date().toISOString(), 30), [items, sales])
  // الرصيد الموحّد من repo (إصلاح بلاغ المالك: سداد بسند قبض + رصيد افتتاحي لم يكونا محسوبين هنا)
  // نفس مصدر كشف الحساب وشاشات الأطراف — فلا تتناقض الأرقام أبداً
  const getCustomerBalance = useDataStore((s) => s.getCustomerBalance)
  const getSupplierBalance = useDataStore((s) => s.getSupplierBalance)
  const journalLen = useDataStore((s) => s.journal.length)
  const custRows = useMemo(
    () => customers
      .map((c) => ({ customerId: c.id, balanceMinor: getCustomerBalance(c.id) }))
      .filter((r) => r.balanceMinor !== 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor),
    // journalLen يحدّث القائمة بعد أي عملية مالية جديدة
    [customers, getCustomerBalance, journalLen],
  )
  const suppRows = useMemo(
    () => suppliers
      .map((sp) => ({ supplierId: sp.id, balanceMinor: getSupplierBalance(sp.id) }))
      .filter((r) => r.balanceMinor !== 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor),
    [suppliers, getSupplierBalance, journalLen],
  )
  // أعمار الديون (المقارنة العالمية: QuickBooks/Xero يقدمان A/R Aging 30/60/90 — كان غائباً)
  const getCustomerStatementRows = useDataStore((s) => s.getCustomerStatementRows)
  const getSupplierStatementRows = useDataStore((s) => s.getSupplierStatementRows)
  const todayYmd = today.slice(0, 10)
  const custAging = useMemo(
    () => custRows.map((r) => ({ customerId: r.customerId, aging: agingFromStatement(getCustomerStatementRows(r.customerId), todayYmd) })).filter((r) => r.aging.totalMinor > 0),
    [custRows, getCustomerStatementRows, todayYmd],
  )
  const suppAging = useMemo(
    () => suppRows.map((r) => ({ supplierId: r.supplierId, aging: agingFromStatement(supplierRowsForAging(getSupplierStatementRows(r.supplierId)), todayYmd) })).filter((r) => r.aging.totalMinor > 0),
    [suppRows, getSupplierStatementRows, todayYmd],
  )
  const alerts = useMemo(() => stockAlerts(items), [items])
  const invValue = useMemo(() => inventoryValue(items), [items])
  const expAlerts = useMemo(
    () => expiryAlerts(batches, (id) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`, new Date().toISOString()),
    [batches, items],
  )

  /* ─── تقارير المصروفات (طلب المالك): مجمّع + تفصيلي بفلترة محترفة ─── */
  const customExpenseCodes = useMemo(() => new Set(customAccounts.filter((a) => a.rootType === 'expenses').map((a) => a.code)), [customAccounts])
  const [expAccount, setExpAccount] = useState('') // '' = التقرير المجمّع لكل البنود
  const [expSource, setExpSource] = useState('')
  const expFilter = useMemo(() => ({ from: period.from, to: period.to, sourceType: expSource || undefined }), [period, expSource])
  const expSummary = useMemo(() => expensesSummary(journal, expFilter, accountName, customExpenseCodes), [journal, expFilter, customExpenseCodes])
  const costCenterExpenses = useMemo(() => invoiceExpensesByCostCenter(sales, { from: period.from, to: period.to, projectId: costProject === 'all' ? 'all' : costProject === 'none' ? null : Number(costProject), settlement: costSettlement }), [sales, period, costProject, costSettlement])
  const expenseCategories = useMemo(() => invoiceExpensesByCategory(sales, { from: period.from, to: period.to }), [sales, period])
  const expDetail = useMemo(
    () => expenseDetails(journal, { ...expFilter, accountCode: expAccount || undefined }, customExpenseCodes),
    [journal, expFilter, expAccount, customExpenseCodes],
  )
  const expSources = useMemo(() => [...new Set(journal.flatMap((e) => e.lines.some((l) => l.accountCode.startsWith('5') || customExpenseCodes.has(l.accountCode)) ? [e.sourceType] : []))], [journal, customExpenseCodes])
  const exportExpenses = () => {
    const csv = expAccount ? expenseDetailsCsv(expDetail.rows) : expenseSummaryCsv(expSummary.rows)
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = expAccount ? `expenses-${expAccount}.csv` : 'expenses-summary.csv'; link.click(); URL.revokeObjectURL(url)
  }

  const printExpenses = () => {
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const { reportPrint, receipt } = useAppStore.getState()
    const body = expAccount
      ? `<table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>المصدر</th><th>المبلغ</th></tr></thead><tbody>
          ${expDetail.rows.map((r) => `<tr><td class="num">#${r.entryNumber}</td><td class="num">${r.date}</td><td>${esc(r.description)}</td><td>${esc(EXP_SOURCE_LABELS[r.sourceType] ?? r.sourceType)}</td><td class="num">${fmt(r.amountMinor)}</td></tr>`).join('')}
          <tr class="total"><td colspan="4">إجمالي «${esc(accountName(expAccount))}»</td><td class="num">${fmt(expDetail.totalMinor)}</td></tr></tbody></table>`
      : `<table><thead><tr><th>الكود</th><th>البند</th><th>عدد الحركات</th><th>النسبة</th><th>الإجمالي</th></tr></thead><tbody>
          ${expSummary.rows.map((r) => `<tr><td class="num">${r.accountCode}</td><td>${esc(r.accountName)}</td><td class="num">${r.txCount}</td><td class="num">${r.sharePercent}%</td><td class="num">${fmt(r.totalMinor)}</td></tr>`).join('')}
          <tr class="total"><td colspan="4">إجمالي مصروفات الفترة</td><td class="num">${fmt(expSummary.grandTotalMinor)}</td></tr></tbody></table>`
    printHtml(renderReportShell({
      title: expAccount ? `تقرير مصروفات تفصيلي — ${accountName(expAccount)}` : 'تقرير المصروفات المجمّع',
      subtitle: `الفترة ${period.from} → ${period.to}${expSource ? ` · المصدر: ${EXP_SOURCE_LABELS[expSource] ?? expSource}` : ''}`,
      companyName: setup.shopName || '',
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: body,
    }))
  }

  const printCostCenterExpenses = () => {
    const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const projectName = (id: number | null) => id == null ? 'بدون مركز تكلفة' : projects.find((project) => project.id === id)?.nameAr ?? `مشروع #${id}`
    const body = `<table><thead><tr><th>مركز التكلفة</th><th>الحركات</th><th>مدفوع</th><th>مستحق</th><th>الإجمالي</th></tr></thead><tbody>${costCenterExpenses.rows.map((row) => `<tr><td>${esc(projectName(row.projectId))}</td><td class="num">${row.txCount}</td><td class="num">${fmt(row.paidMinor)}</td><td class="num">${fmt(row.accruedMinor)}</td><td class="num">${fmt(row.totalMinor)}</td></tr>`).join('')}<tr class="total"><td colspan="4">الإجمالي</td><td class="num">${fmt(costCenterExpenses.totalMinor)}</td></tr></tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'تحليل مصروفات الفواتير حسب مركز التكلفة', subtitle: `الفترة ${period.from} → ${period.to} · ${costSettlement === 'paid_now' ? 'مدفوع' : costSettlement === 'payable_later' ? 'مستحق' : 'كل حالات السداد'}`, companyName: setup.shopName || '', logoDataUrl: receipt.logoDataUrl, settings: reportPrint, bodyHtml: body }))
  }

  const custName = (id: number) => customers.find((c) => c.id === id)?.nameAr ?? `عميل #${id}`
  const suppName = (id: number) => suppliers.find((s) => s.id === id)?.nameAr ?? `مورد #${id}`

  const maxDaily = Math.max(1, ...daily.map((d) => d.totalMinor))

  const tabCls = (t: TabId) =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-sky-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

  return (
    <div className="space-y-4">
      {/* اختيار الفترة */}
      <div className="anim-up flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600'}`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPresetId('custom')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === 'custom' ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600'}`}
        >
          مخصصة
        </button>
        {presetId === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} dir="ltr" />
            <span className="text-slate-400 text-[12px]">إلى</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} dir="ltr" />
          </div>
        )}
        <span className="text-[11px] text-slate-400 ms-auto" dir="ltr">{period.from} → {period.to}</span>
      </div>

      {/* بطاقات الملخص */}
      <div className="anim-up grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ animationDelay: '40ms' }}>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><ReceiptText size={13} /> صافي المبيعات ({summary.invoiceCount} فاتورة)</div>
          <div className="font-black text-xl mt-1">{fmt(summary.totalMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">نقدي {fmt(summary.cashMinor)} — آجل {fmt(summary.creditMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><TrendingUp size={13} /> الربح الإجمالي</div>
          <div className={`font-black text-xl mt-1 ${summary.netProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(summary.netProfitMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">قبل المرتجعات {fmt(summary.profitMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><PackageSearch size={13} /> تكلفة المبيعات</div>
          <div className="font-black text-xl mt-1">{fmt(summary.cogsMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">خصومات {fmt(summary.discountMinor)} — ضريبة {fmt(summary.taxMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><AlertTriangle size={13} /> مرتجعات الفترة</div>
          <div className={`font-black text-xl mt-1 ${summary.returnsMinor > 0 ? 'text-rose-600' : ''}`}>{fmt(summary.returnsMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">قيمة المخزون الآن {fmt(invValue.totalMinor)}</div>
        </div>
      </div>

      {/* التبويبات */}
      <div className="anim-up flex items-center gap-2 flex-wrap" style={{ animationDelay: '80ms' }}>
        <button onClick={() => setTab('sales')} className={tabCls('sales')}><BarChart3 size={14} className="inline -mt-0.5 me-1" /> المبيعات اليومية</button>
        <button onClick={() => setTab('items')} className={tabCls('items')}><Boxes size={14} className="inline -mt-0.5 me-1" /> أفضل الأصناف</button>
        <button onClick={() => setTab('parties')} className={tabCls('parties')}><Users size={14} className="inline -mt-0.5 me-1" /> الذمم</button>
        <button onClick={() => setTab('inventory')} className={tabCls('inventory')}><PackageSearch size={14} className="inline -mt-0.5 me-1" /> المخزون</button>
        <button onClick={() => setTab('expenses')} className={tabCls('expenses')}><ReceiptText size={14} className="inline -mt-0.5 me-1" /> المصروفات</button>
        <button onClick={() => setTab('financial')} className={tabCls('financial')}><Landmark size={14} className="inline -mt-0.5 me-1" /> القوائم المالية</button>
      </div>

      {tab === 'sales' && (
        <div className={`anim-up ${card} p-5`}>
          {daily.length === 0 ? (
            <div className="text-center text-slate-400 text-[13px] py-10">لا مبيعات في هذه الفترة</div>
          ) : (
            <>
              <div className="flex items-end gap-1.5 h-44 overflow-x-auto pb-1">
                {daily.map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-1 min-w-[44px] flex-1 group">
                    <div className="text-[9px] font-bold text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{fmt(d.totalMinor)}</div>
                    <div
                      className="w-full max-w-[36px] rounded-t-lg bg-gradient-to-t from-sky-600 to-sky-400 transition-all hover:from-sky-500 hover:to-sky-300"
                      style={{ height: `${Math.max(4, (d.totalMinor / maxDaily) * 130)}px` }}
                      title={`${d.date}: ${fmt(d.totalMinor)} ${cur.symbol} (${d.invoiceCount} فاتورة)`}
                    />
                    <div className="text-[9px] text-slate-400" dir="ltr">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 text-center text-[12px] border-t border-slate-100 dark:border-slate-800 pt-3">
                <div><span className="text-slate-400">أيام البيع:</span> <b>{daily.length}</b></div>
                <div><span className="text-slate-400">متوسط اليوم:</span> <b>{fmt(Math.round(summary.totalMinor / Math.max(1, daily.length)))}</b></div>
                <div><span className="text-slate-400">أفضل يوم:</span> <b dir="ltr">{daily.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a)).date}</b></div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'items' && (
        <div className={`anim-up ${card} overflow-hidden`}>
          {top.length === 0 ? (
            <div className="text-center text-slate-400 text-[13px] py-10">لا مبيعات أصناف في هذه الفترة</div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">#</th>
                  <th className="px-4 py-3 text-right font-bold">الصنف</th>
                  <th className="px-4 py-3 text-right font-bold">الكمية</th>
                  <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                  <th className="px-4 py-3 text-right font-bold">التكلفة</th>
                  <th className="px-4 py-3 text-right font-bold">الربح</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                    <td className="px-4 py-2.5">{r.qty}</td>
                    <td className="px-4 py-2.5 font-bold">{fmt(r.revenueMinor)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmt(r.cogsMinor)}</td>
                    <td className={`px-4 py-2.5 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* الراكد — نمط DEXEF «تقرير الراكد وحد الطلب»: رأس المال المحبوس أولاً */}
          <div className="border-t border-slate-100 dark:border-slate-800">
            <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>🐢 الأصناف الراكدة (لم تُبع منذ 30+ يوماً وعليها مخزون)</span>
              {stagnant.length > 0 && <span className="text-rose-500">رأس مال محبوس: {fmt(stagnant.reduce((a, r) => a + r.stockValueMinor, 0))} {cur.symbol}</span>}
            </div>
            {stagnant.length === 0 ? (
              <div className="text-center text-emerald-500 text-[12px] pb-4 font-bold">لا أصناف راكدة — كل المخزون يتحرك ✓</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2 text-right font-bold">الصنف</th>
                    <th className="px-4 py-2 text-right font-bold">الرصيد</th>
                    <th className="px-4 py-2 text-right font-bold">قيمة المخزون</th>
                    <th className="px-4 py-2 text-right font-bold">آخر بيع</th>
                  </tr>
                </thead>
                <tbody>
                  {stagnant.slice(0, 15).map((r) => (
                    <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                      <td className="px-4 py-2">{r.stockQty}</td>
                      <td className="px-4 py-2 font-bold text-rose-600">{fmt(r.stockValueMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.idleDays === -1 ? 'لم يُبع قط' : `${r.lastSoldDate} (${r.idleDays} يوماً)`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'parties' && (
        <div className="anim-up space-y-3">
        <div className="flex justify-end">
          <button
            onClick={() => {
              // مطبوعة رسمية موحّدة المصدر مع كشوف الحساب (طلب المالك: طباعة مفلترة احترافية)
              const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              const table = (title: string, rows: { name: string; bal: number }[], meaning: [string, string]) =>
                `<h3 style="margin:14px 0 6px;font-size:1.05em">${title}</h3>
                 <table><thead><tr><th>الاسم</th><th>الحالة</th><th>الرصيد</th></tr></thead><tbody>
                 ${rows.length === 0 ? '<tr><td colspan="3">لا أرصدة</td></tr>' : rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.bal > 0 ? meaning[0] : meaning[1]}</td><td class="num">${fmt(Math.abs(r.bal))}</td></tr>`).join('')}
                 <tr class="total"><td colspan="2">الصافي</td><td class="num">${fmt(rows.reduce((a2, r) => a2 + r.bal, 0))}</td></tr></tbody></table>`
              const { reportPrint, receipt } = useAppStore.getState()
              printHtml(renderReportShell({
                title: 'تقرير أرصدة العملاء والموردين',
                subtitle: `${setup.shopName || ''} — الأرصدة الحية الموحّدة مع كشوف الحساب · ${new Date().toISOString().slice(0, 10)}`,
                companyName: setup.shopName || '',
                logoDataUrl: receipt.logoDataUrl,
                settings: reportPrint,
                bodyHtml:
                  table('أرصدة العملاء', custRows.map((r) => ({ name: custName(r.customerId), bal: r.balanceMinor })), ['مدين — عليه', 'دائن — له']) +
                  table('أرصدة الموردين', suppRows.map((r) => ({ name: suppName(r.supplierId), bal: r.balanceMinor })), ['له علينا', 'لنا عنده']),
              }))
            }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 transition-all flex items-center gap-1.5"
          >
            <Printer size={13} /> طباعة تقرير الأرصدة
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Users size={14} className="text-violet-500" /> أرصدة العملاء (موحّدة مع كشوف الحساب)
            </div>
            {custRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا ذمم عملاء</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {custRows.map((r) => (
                    <tr key={r.customerId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">{r.balanceMinor > 0 ? 'مدين — عليه' : 'دائن — له'}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Truck size={14} className="text-cyan-500" /> أرصدة الموردين (موحّدة مع كشوف الحساب)
            </div>
            {suppRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا مستحقات موردين</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {suppRows.map((r) => (
                    <tr key={r.supplierId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{suppName(r.supplierId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">{r.balanceMinor > 0 ? 'له علينا' : 'لنا عنده'}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* أعمار الديون 30/60/90 — المقارنة العالمية (QuickBooks A/R Aging Summary) */}
        {(custAging.length > 0 || suppAging.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: 'أعمار ديون العملاء (المتبقي غير المسدد)', rows: custAging.map((r) => ({ key: r.customerId, name: custName(r.customerId), a: r.aging })) },
              { title: 'أعمار مستحقات الموردين', rows: suppAging.map((r) => ({ key: r.supplierId, name: suppName(r.supplierId), a: r.aging })) },
            ].map((sec) => (
              <div key={sec.title} className={`${card} overflow-hidden`}>
                <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
                  ⏳ {sec.title}
                </div>
                {sec.rows.length === 0 ? (
                  <div className="text-center text-slate-400 text-[12px] py-8">لا ديون قائمة ✅</div>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-3 py-2 font-bold">الاسم</th>
                        <th className="px-2 py-2 font-bold">حتى 30ي</th>
                        <th className="px-2 py-2 font-bold">31–60</th>
                        <th className="px-2 py-2 font-bold">61–90</th>
                        <th className="px-2 py-2 font-bold text-rose-500">+90</th>
                        <th className="px-2 py-2 font-bold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map((r) => (
                        <tr key={r.key} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{r.name}</td>
                          <td className="px-2 py-2">{r.a.currentMinor ? fmt(r.a.currentMinor) : '—'}</td>
                          <td className="px-2 py-2 text-amber-600">{r.a.d31_60Minor ? fmt(r.a.d31_60Minor) : '—'}</td>
                          <td className="px-2 py-2 text-orange-600">{r.a.d61_90Minor ? fmt(r.a.d61_90Minor) : '—'}</td>
                          <td className="px-2 py-2 font-black text-rose-600">{r.a.over90Minor ? fmt(r.a.over90Minor) : '—'}</td>
                          <td className="px-2 py-2 font-black">{fmt(r.a.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {tab === 'inventory' && (
        <div className="anim-up grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500" /> تنبيهات المخزون ({alerts.length})
            </div>
            {alerts.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">كل الأصناف فوق حد الطلب ✅</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {alerts.map((r) => (
                    <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">المتاح {r.stockQty} — الحد {r.minQty}</td>
                      <td className="px-4 py-2 text-left">
                        {r.kind === 'out'
                          ? <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">نافد</span>
                          : <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">منخفض</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-rose-500" /> تنبيهات الصلاحية FEFO ({expAlerts.length})
            </div>
            {expAlerts.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا دفعات منتهية أو تنتهي خلال 30 يوماً ✅</div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {expAlerts.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{r.expiryDate} — كمية {r.qty}</td>
                        <td className="px-4 py-2 text-left">
                          {r.status === 'expired'
                            ? <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">منتهٍ منذ {-r.daysLeft} يوم</span>
                            : <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">ينتهي خلال {r.daysLeft} يوم</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Boxes size={14} className="text-emerald-500" /> قيمة المخزون (بالتكلفة)</span>
              <b className="text-emerald-600">{fmt(invValue.totalMinor)} {cur.symbol}</b>
            </div>
            {invValue.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">المخزون فارغ</div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {invValue.rows.map((r) => (
                      <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2 text-slate-400 text-[11px]">{r.stockQty} × {fmt(r.costMinor)}</td>
                        <td className="px-4 py-2 font-bold text-left">{fmt(r.valueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'expenses' && (
        <div className="anim-up space-y-3">
          {/* فلترة محترفة: بند + مصدر + الفترة أعلى الصفحة */}
          <div className={`${card} p-4 flex flex-wrap items-end gap-3`}>
            <div className="min-w-52">
              <div className="text-[10px] font-bold text-slate-400 mb-1">بند المصروف</div>
              <select value={expAccount} onChange={(e) => setExpAccount(e.target.value)} className={inputCls}>
                <option value="">— كل البنود (تقرير مجمّع) —</option>
                {expSummary.rows.map((r) => <option key={r.accountCode} value={r.accountCode}>{r.accountCode} — {r.accountName}</option>)}
              </select>
            </div>
            <div className="min-w-44">
              <div className="text-[10px] font-bold text-slate-400 mb-1">مصدر العملية</div>
              <select value={expSource} onChange={(e) => setExpSource(e.target.value)} className={inputCls}>
                <option value="">الكل</option>
                {expSources.map((st) => <option key={st} value={st}>{EXP_SOURCE_LABELS[st] ?? st}</option>)}
              </select>
            </div>
            <div className="ms-auto flex items-center gap-3">
              <div className="text-left">
                <div className="text-[10px] font-bold text-slate-400">إجمالي مصروفات الفترة</div>
                <div className="font-black text-lg text-rose-500">{fmt(expSummary.grandTotalMinor)} {cur.symbol}</div>
              </div>
              <button onClick={exportExpenses} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-emerald-600 transition-all">Excel/CSV</button>
              <button onClick={printExpenses} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 transition-all flex items-center gap-1.5">
                <Printer size={13} /> طباعة التقرير
              </button>
            </div>
          </div>

          {!expAccount ? (
            /* المجمّع: بند بند بنسبته وشريطه */
            <div className={`${card} overflow-hidden`}>
              {expSummary.rows.length === 0 ? (
                <div className="text-center text-slate-400 text-[12px] py-10">لا مصروفات في هذه الفترة</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-3 font-bold">البند</th>
                      <th className="px-4 py-3 font-bold">الحركات</th>
                      <th className="px-4 py-3 font-bold w-1/3">النسبة</th>
                      <th className="px-4 py-3 font-bold">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expSummary.rows.map((r) => (
                      <tr key={r.accountCode} onClick={() => setExpAccount(r.accountCode)} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.03] transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <span className="font-bold text-slate-700 dark:text-slate-200">{r.accountName}</span>
                          <span className="text-[10px] text-slate-400 font-mono ms-2" dir="ltr">{r.accountCode}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{r.txCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.min(100, r.sharePercent)}%` }} />
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 w-12" dir="ltr">{r.sharePercent}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-black text-rose-500">{fmt(r.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* التفصيلي: حركة حركة للبند المختار */
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <div className="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">تفصيلي «{accountName(expAccount)}» — {expDetail.rows.length} حركة</div>
                <button onClick={() => setExpAccount('')} className="text-[11px] font-bold text-sky-600 hover:underline">→ عودة للمجمّع</button>
              </div>
              {expDetail.rows.length === 0 ? (
                <div className="text-center text-slate-400 text-[12px] py-10">لا حركات على هذا البند في الفترة</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 font-bold">القيد</th>
                      <th className="px-4 py-2.5 font-bold">التاريخ</th>
                      <th className="px-4 py-2.5 font-bold">البيان</th>
                      <th className="px-4 py-2.5 font-bold">المصدر</th>
                      <th className="px-4 py-2.5 font-bold">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expDetail.rows.map((r, i) => (
                      <tr key={`${r.entryId}-${i}`} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]" dir="ltr">#{r.entryNumber}</td>
                        <td className="px-4 py-2.5 text-slate-500" dir="ltr">{r.date}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.description}</td>
                        <td className="px-4 py-2.5"><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold">{EXP_SOURCE_LABELS[r.sourceType] ?? r.sourceType}</span></td>
                        <td className={`px-4 py-2.5 font-black ${r.amountMinor >= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{fmt(r.amountMinor)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-900/40">
                      <td colSpan={4} className="px-4 py-2.5 font-black">إجمالي البند في الفترة</td>
                      <td className="px-4 py-2.5 font-black text-rose-500">{fmt(expDetail.totalMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between">
              <div><b>تحليل مصروفات الفواتير حسب مركز التكلفة</b><div className="text-[10px] text-slate-400">المدفوع والمستحق المرتبطان بالفاتورة والربحية</div></div>
              <div className="flex gap-2 items-center"><select className={inputCls} value={costProject} onChange={(e) => setCostProject(e.target.value)}><option value="all">كل المراكز</option><option value="none">بدون مركز</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.nameAr}</option>)}</select><select className={inputCls} value={costSettlement} onChange={(e) => setCostSettlement(e.target.value as typeof costSettlement)}><option value="all">كل الحالات</option><option value="paid_now">مدفوع</option><option value="payable_later">مستحق</option></select><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={printCostCenterExpenses}><Printer size={13} className="inline me-1"/>طباعة</button><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={() => { const csv = costCenterExpensesCsv(costCenterExpenses.rows, (id) => id == null ? 'بدون مركز تكلفة' : projects.find((project) => project.id === id)?.nameAr ?? `مشروع #${id}`); const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'cost-center-expenses.csv'; link.click(); URL.revokeObjectURL(url) }}>Excel/CSV</button><b className="text-rose-500">{fmt(costCenterExpenses.totalMinor)}</b></div>
            </div>
            {costCenterExpenses.rows.length ? <table className="w-full text-[12.5px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">مركز التكلفة</th><th>الحركات</th><th>مدفوع</th><th>مستحق</th><th>الإجمالي</th></tr></thead><tbody>{costCenterExpenses.rows.map((row) => <tr key={row.projectId ?? 'none'} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{row.projectId == null ? 'بدون مركز تكلفة' : projects.find((project) => project.id === row.projectId)?.nameAr ?? `مشروع #${row.projectId}`}</td><td>{row.txCount}</td><td className="text-emerald-600">{fmt(row.paidMinor)}</td><td className="text-amber-600">{fmt(row.accruedMinor)}</td><td className="font-black text-rose-500">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد مصروفات فواتير مرتبطة بالفترة</div>}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center"><div><b>تحليل أنواع مصروفات الفواتير</b><div className="text-[10px] text-slate-400">يشمل العمولات والضريبة وحالة السداد وعدد مراكز التكلفة</div></div><div className="flex gap-2 items-center"><span className="text-xs text-slate-500">ضريبة {fmt(expenseCategories.taxMinor)}</span><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={() => { const csv = invoiceExpenseCategoriesCsv(expenseCategories.rows); const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'invoice-expense-categories.csv'; link.click(); URL.revokeObjectURL(url) }}>Excel/CSV</button><b className="text-rose-500">{fmt(expenseCategories.totalMinor)}</b></div></div>
            {expenseCategories.rows.length ? <table className="w-full text-[12px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">النوع</th><th>الحساب</th><th>الحركات</th><th>المراكز</th><th>مدفوع</th><th>مستحق</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>{expenseCategories.rows.map((row) => <tr key={`${row.accountCode}:${row.label}`} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{row.label}</td><td className="font-mono">{row.accountCode}</td><td>{row.txCount}</td><td>{row.costCenterCount}</td><td className="text-emerald-600">{fmt(row.paidMinor)}</td><td className="text-amber-600">{fmt(row.accruedMinor)}</td><td>{fmt(row.taxMinor)}</td><td className="font-black text-rose-500">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد أنواع مصروفات في الفترة</div>}
          </div>
        </div>
      )}

      {tab === 'financial' && (
        <FinancialReportsTab period={period} cur={cur} companyName={setup.shopName || 'المنشأة'} />
      )}

    </div>
  )
}
