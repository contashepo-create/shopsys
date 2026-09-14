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
  salesSummary, topItems, dailySales, customerBalances, supplierBalances,
  stockAlerts, inventoryValue, periodPresets, type Period,
} from '../../core/reports.ts'
import { inputCls } from '../components/ui.tsx'

type TabId = 'sales' | 'items' | 'parties' | 'inventory'

export function ReportsPage() {
  const { sales, saleReturns, purchases, items, customers, suppliers, installmentPlans } = useDataStore()
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

  /* ─── الحسابات (كلها نواة خالصة) ─── */
  const summary = useMemo(() => salesSummary(sales, saleReturns, period), [sales, saleReturns, period])
  const daily = useMemo(() => dailySales(sales, period), [sales, period])
  const top = useMemo(() => topItems(sales, saleReturns, period, 10), [sales, saleReturns, period])
  const custRows = useMemo(() => {
    // التحصيلات: أقساط محصلة (مقدم + مدفوعات الجدول) لكل عميل
    const collections = installmentPlans.map((p) => ({
      customerId: p.customerId,
      amountMinor: p.downPaymentMinor + p.items.reduce((a, i) => a + i.paidMinor, 0),
    }))
    return customerBalances(sales, saleReturns, collections)
  }, [sales, saleReturns, installmentPlans])
  const suppRows = useMemo(() => supplierBalances(purchases, []), [purchases])
  const alerts = useMemo(() => stockAlerts(items), [items])
  const invValue = useMemo(() => inventoryValue(items), [items])

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
        </div>
      )}

      {tab === 'parties' && (
        <div className="anim-up grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Users size={14} className="text-violet-500" /> مديونيات العملاء (كل الوقت)
            </div>
            {custRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا ذمم عملاء</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {custRows.map((r) => (
                    <tr key={r.customerId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">فواتير {fmt(r.invoicedMinor)} — حُصِّل {fmt(r.collectedMinor + r.returnedMinor)}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Truck size={14} className="text-cyan-500" /> مستحقات الموردين (كل الوقت)
            </div>
            {suppRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا مستحقات موردين</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {suppRows.map((r) => (
                    <tr key={r.supplierId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{suppName(r.supplierId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">مشتريات {fmt(r.purchasedMinor)} — سُدد {fmt(r.paidMinor)}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
    </div>
  )
}
