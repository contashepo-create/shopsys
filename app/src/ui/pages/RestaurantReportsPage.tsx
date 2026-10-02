/**
 * وحدة تقارير المطعم (ثالثة وحدات «تقارير لكل نشاط»): نفس نمط المقاولات (§88)
 * والمعدات (§89) — الأطباق وهوامشها (Food Cost %) · أوامر المطعم (صالة/تيك أواي/
 * دليفري) · أوامر الإنتاج المسبق — بتصدير CSV لكل جدول وفلترة فترة.
 * البطاقة نفسها من النواة الخالصة restaurantReportCard (قابلة للفحص ببوابة).
 */
import { useMemo, useState } from 'react'
import { ChefHat, UtensilsCrossed, Factory } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { restaurantReportCard, ORDER_TYPE_LABELS, type RestaurantOrderType } from '../../core/restaurant.ts'
import { toCsv } from '../../core/security.ts'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { EmptyState } from '../components/ui.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700'

function downloadCsv(rows: readonly Record<string, unknown>[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type Period = 'today' | 'month' | 'all'
const PERIOD_LABELS: Record<Period, string> = { today: 'اليوم', month: 'هذا الشهر', all: 'كل الفترات' }

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-amber-500/10 text-amber-600',
  settled: 'bg-emerald-500/10 text-emerald-600',
  cancelled: 'bg-rose-500/10 text-rose-600',
}
const STATUS_LABELS: Record<string, string> = { open: 'مفتوح', settled: 'مقفل', cancelled: 'ملغى' }

export function RestaurantReportsPage() {
  const { sales, recipes, restaurantOrders, productionOrders, items } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [tab, setTab] = usePersistedSectionView('restaurant-reports', 'dishes', ['dishes', 'orders', 'production'] as const)
  const [period, setPeriod] = useState<Period>('month')

  /* فترة التقرير: الأوامر والفواتير والإنتاج تُفلتر بالتاريخ */
  const inPeriod = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    return (dateIso: string) => {
      if (period === 'all') return true
      const d = dateIso.slice(0, 10)
      return period === 'today' ? d === today : d.slice(0, 7) === month
    }
  }, [period])

  /** فواتير البيع المرحّلة في الفترة — مصدر الإيراد والتكلفة الحقيقي */
  const periodSales = useMemo(() => sales.filter((s) => inPeriod(s.date)), [sales, inPeriod])
  /** أوامر المطعم في الفترة (المفتوح يقاس لحظياً أياً كان تاريخ فتحه) */
  const periodOrders = useMemo(
    () => restaurantOrders.filter((o) => o.status !== 'open' ? inPeriod(o.settledAt ?? o.openedAt) : true),
    [restaurantOrders, inPeriod],
  )
  /** فواتير الأوامر المقفلة — لعدّ متوسط قيمة الأمر */
  const settledSalesMinor = useMemo(() => {
    const saleIds = new Set(restaurantOrders.filter((o) => o.saleId != null).map((o) => o.saleId as number))
    return periodSales.filter((s) => saleIds.has(s.id)).reduce((a, s) => a + s.totals.totalMinor, 0)
  }, [periodSales, restaurantOrders])

  const report = useMemo(() => restaurantReportCard({
    soldLines: periodSales.flatMap((s) => s.lines.map((l) => ({
      itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor, unitCostMinor: l.unitCostMinor, discountPercent: l.discountPercent,
    }))),
    recipeProductIds: recipes.filter((r) => r.isActive).map((r) => r.productItemId),
    orders: periodOrders.map((o) => ({
      type: o.type, status: o.status,
      lines: o.lines.map((l) => ({ qty: l.qty, unitPriceMinor: l.unitPriceMinor, discountPercent: l.discountPercent })),
    })),
    settledOrdersSalesMinor: settledSalesMinor,
  }), [periodSales, recipes, periodOrders, settledSalesMinor])

  const nameOf = (itemId: number) =>
    itemId === -1 ? 'رسوم الخدمة والتوصيل' : items.find((it) => it.id === itemId)?.nameAr ?? `صنف #${itemId}`

  /* ═══ تبويب: أوامر الإنتاج ═══ */
  const periodProduction = useMemo(() => productionOrders.filter((p) => inPeriod(p.date)), [productionOrders, inPeriod])
  const productionTotals = useMemo(() => periodProduction.reduce(
    (a, p) => ({ ingredients: a.ingredients + p.ingredientsCostMinor, overhead: a.overhead + p.overheadMinor, total: a.total + p.totalCostMinor }),
    { ingredients: 0, overhead: 0, total: 0 },
  ), [periodProduction])

  const KPI = ({ label, value, hint, accent = '' }: { label: string; value: string; hint?: string; accent?: string }) => (
    <div className={`${card} p-3.5`}>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">{label}</div>
      <div className={`mt-1 text-xl font-black tabular-nums ${accent || 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-slate-400">{hint}</div>}
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto" dir="rtl">
      {/* الرأس + فترة التقرير */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-slate-100">🍽️ وحدة تقارير المطعم</h1>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
            هامش كل طبق وتكلفة المواد (Food Cost %) وأوامر الصالة والتوصيل والإنتاج — بتصدير CSV لكل جدول.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${period === p ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPI label={`إيراد ${PERIOD_LABELS[period]}`} value={`${fmt(report.revenueMinor)} ${cur.symbol}`} hint="من فواتير البيع المرحّلة" accent="text-emerald-600" />
        <KPI label="تكلفة المواد" value={`${fmt(report.cogsMinor)} ${cur.symbol}`} hint="تكلفة الخامات المباعة فعلاً" accent="text-rose-600" />
        <KPI label="مجمل الربح" value={`${fmt(report.grossProfitMinor)} ${cur.symbol}`} hint="الإيراد − تكلفة المواد" accent={report.grossProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
        <KPI
          label="Food Cost %"
          value={report.foodCostPercent == null ? '—' : `${report.foodCostPercent.toLocaleString('en-US')}٪`}
          hint={report.foodCostPercent == null ? 'لا إيراد بعد' : report.foodCostPercent <= 35 ? 'ضمن معيار المطاعم (≤35٪) ✓' : 'فوق المعيار — راجع الأسعار والحواصل'}
          accent={report.foodCostPercent != null && report.foodCostPercent <= 35 ? 'text-emerald-600' : 'text-amber-600'}
        />
        <KPI label="الأوامر المقفلة" value={report.orders.settledCount.toLocaleString('en-US')} hint={`ملغاة: ${report.orders.cancelledCount}`} />
        <KPI label="أوامر مفتوحة الآن" value={report.orders.openCount.toLocaleString('en-US')} hint={`قيد التحصيل: ${fmt(report.orders.openValueMinor)} ${cur.symbol}`} accent={report.orders.openCount > 0 ? 'text-amber-600' : ''} />
        <KPI label="متوسط قيمة الأمر" value={report.orders.avgSettledOrderMinor == null ? '—' : `${fmt(report.orders.avgSettledOrderMinor)} ${cur.symbol}`} hint="فواتير الأوامر المقفلة ÷ عددها" />
      </div>

      {/* التبويبات */}
      <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {([['dishes', 'الأطباق والهوامش', ChefHat], ['orders', 'أوامر المطعم', UtensilsCrossed], ['production', 'الإنتاج المسبق', Factory]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-bold transition-colors ${tab === id ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ═══ ① الأطباق والهوامش ═══ */}
      {tab === 'dishes' && (
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <b className="text-[13px] text-slate-700 dark:text-slate-200">الأطباق مرتبة بالربح — {report.dishCount.toLocaleString('en-US')} صنفاً في {PERIOD_LABELS[period]}</b>
            <button
              onClick={() => downloadCsv(report.dishes.map((d) => ({
                'الصنف': nameOf(d.itemId), 'وصفة مطبخ': d.hasRecipe ? 'نعم' : 'جاهز', 'الكمية': d.soldQty,
                'الإيراد': fmt(d.revenueMinor), 'التكلفة': fmt(d.costMinor), 'الربح': fmt(d.profitMinor),
                'الهامش٪': d.marginPercent == null ? '' : d.marginPercent,
              })), `أطباق-المطعم-${new Date().toISOString().slice(0, 10)}.csv`)}
              className="text-[12px] font-bold text-emerald-600 hover:text-emerald-700"
            >
              ⬇ CSV
            </button>
          </div>
          {report.dishes.length === 0 ? (
            <div className="p-8"><EmptyState icon="🍽️" title="لا مبيعات في هذه الفترة" sub="قفل أوامر الطاولات أو رحّل فواتير بيع لتظهر الأطباق وهوامشها هنا" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <tr>{['الصنف', 'المصدر', 'الكمية', 'الإيراد', 'تكلفة المواد', 'الربح', 'الهامش٪'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {report.dishes.map((d) => (
                    <tr key={d.itemId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-bold text-slate-700 dark:text-slate-200">{nameOf(d.itemId)}</td>
                      <td className="px-3 py-2.5">
                        {d.hasRecipe
                          ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold">يُحضَّر بالمطبخ</span>
                          : <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold">جاهز</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{d.soldQty.toLocaleString('en-US')}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold">{fmt(d.revenueMinor)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-rose-600">{fmt(d.costMinor)}</td>
                      <td className={`px-3 py-2.5 tabular-nums font-bold ${d.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(d.profitMinor)}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold">
                        {d.marginPercent == null ? '—' : (
                          <span className={d.marginPercent >= 60 ? 'text-emerald-600' : d.marginPercent >= 40 ? 'text-amber-600' : 'text-rose-600'}>
                            {d.marginPercent.toLocaleString('en-US')}٪
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ ② أوامر المطعم ═══ */}
      {tab === 'orders' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(Object.keys(ORDER_TYPE_LABELS) as RestaurantOrderType[]).map((t) => (
              <div key={t} className={`${card} p-3.5`}>
                <div className="flex items-center gap-2 text-[12px] font-bold text-slate-600 dark:text-slate-300">
                  <span>{ORDER_TYPE_LABELS[t].icon}</span> {ORDER_TYPE_LABELS[t].nameAr}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-lg font-black tabular-nums text-emerald-600">{report.orders.byType[t].settled.toLocaleString('en-US')}</div><div className="text-[10px] text-slate-400">مقفل</div></div>
                  <div><div className="text-lg font-black tabular-nums text-amber-600">{report.orders.byType[t].open.toLocaleString('en-US')}</div><div className="text-[10px] text-slate-400">مفتوح</div></div>
                  <div><div className="text-sm font-black tabular-nums text-slate-700 dark:text-slate-200 mt-1">{fmt(report.orders.byType[t].openValueMinor)}</div><div className="text-[10px] text-slate-400">قيمة المفتوح</div></div>
                </div>
              </div>
            ))}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <b className="text-[13px] text-slate-700 dark:text-slate-200">الأوامر — {periodOrders.length.toLocaleString('en-US')} أمراً</b>
              <button
                onClick={() => downloadCsv(periodOrders.map((o) => ({
                  'الأمر': o.orderNumber, 'النوع': ORDER_TYPE_LABELS[o.type].nameAr,
                  'الطاولة/التوصيل': o.tableName || o.deliveryInfo || '—',
                  'الحالة': STATUS_LABELS[o.status], 'الفَتح': o.openedAt.slice(0, 16).replace('T', ' '),
                  'القفل': o.settledAt ? o.settledAt.slice(0, 16).replace('T', ' ') : '',
                  'القيمة': fmt(o.lines.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor * (100 - l.discountPercent) / 100), 0)),
                })), `أوامر-المطعم-${new Date().toISOString().slice(0, 10)}.csv`)}
                className="text-[12px] font-bold text-emerald-600 hover:text-emerald-700"
              >
                ⬇ CSV
              </button>
            </div>
            {periodOrders.length === 0 ? (
              <div className="p-8"><EmptyState icon="🧾" title="لا أوامر في هذه الفترة" sub="افتح أوامر الطاولات والدليفري من شاشة البيع — تُقفل بفاتورة فتظهر هنا" /></div>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 sticky top-0">
                    <tr>{['الأمر', 'النوع', 'الطاولة / التوصيل', 'الحالة', 'الفَتح', 'القفل', 'القيمة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {periodOrders.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-mono font-bold">{o.orderNumber}</td>
                        <td className="px-3 py-2.5">{ORDER_TYPE_LABELS[o.type].icon} {ORDER_TYPE_LABELS[o.type].nameAr}</td>
                        <td className="px-3 py-2.5 max-w-52 truncate" title={o.tableName || o.deliveryInfo}>{o.tableName || o.deliveryInfo || '—'}</td>
                        <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_BADGE[o.status]}`}>{STATUS_LABELS[o.status]}</span></td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500">{o.openedAt.slice(0, 16).replace('T', ' ')}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500">{o.settledAt ? o.settledAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                        <td className="px-3 py-2.5 tabular-nums font-bold">{fmt(o.lines.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor * (100 - l.discountPercent) / 100), 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ ③ الإنتاج المسبق ═══ */}
      {tab === 'production' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="أوامر الإنتاج" value={periodProduction.length.toLocaleString('en-US')} hint={PERIOD_LABELS[period]} />
            <KPI label="تكلفة الخامات" value={`${fmt(productionTotals.ingredients)} ${cur.symbol}`} accent="text-rose-600" />
            <KPI label="مصاريف التشغيل" value={`${fmt(productionTotals.overhead)} ${cur.symbol}`} hint="غاز/عمالة مباشرة — تُرسمل على المنتج" />
            <KPI label="إجمالي التكلفة" value={`${fmt(productionTotals.total)} ${cur.symbol}`} hint="خامات + مصاريف تشغيل" />
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <b className="text-[13px] text-slate-700 dark:text-slate-200">أوامر الإنتاج المسبق — التشغيلات وكمياتها وتكلفتها</b>
              <button
                onClick={() => downloadCsv(periodProduction.map((p) => ({
                  'الأمر': p.orderNumber, 'التاريخ': p.date.slice(0, 10), 'المنتج': nameOf(p.productItemId),
                  'تشغيلات': p.batches, 'الكمية المنتجة': p.producedQty,
                  'خامات': fmt(p.ingredientsCostMinor), 'مصاريف': fmt(p.overheadMinor),
                  'الإجمالي': fmt(p.totalCostMinor), 'تكلفة الوحدة': p.producedQty > 0 ? fmt(Math.round(p.totalCostMinor / p.producedQty)) : '',
                })), `إنتاج-المطعم-${new Date().toISOString().slice(0, 10)}.csv`)}
                className="text-[12px] font-bold text-emerald-600 hover:text-emerald-700"
              >
                ⬇ CSV
              </button>
            </div>
            {periodProduction.length === 0 ? (
              <div className="p-8"><EmptyState icon="🏭" title="لا أوامر إنتاج في هذه الفترة" sub="أوامر الإنتاج المسبق تخصم الخامات وترسمل التكلفة على المنتج — من «الوصفات والإنتاج»" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <tr>{['الأمر', 'التاريخ', 'المنتج', 'تشغيلات', 'الكمية', 'خامات', 'مصاريف', 'الإجمالي', 'تكلفة الوحدة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {periodProduction.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-mono font-bold">{p.orderNumber}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500">{p.date.slice(0, 10)}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-700 dark:text-slate-200">{nameOf(p.productItemId)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{p.batches.toLocaleString('en-US')}</td>
                        <td className="px-3 py-2.5 tabular-nums">{p.producedQty.toLocaleString('en-US')}</td>
                        <td className="px-3 py-2.5 tabular-nums text-rose-600">{fmt(p.ingredientsCostMinor)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-amber-600">{fmt(p.overheadMinor)}</td>
                        <td className="px-3 py-2.5 tabular-nums font-bold">{fmt(p.totalCostMinor)}</td>
                        <td className="px-3 py-2.5 tabular-nums font-bold text-emerald-600">
                          {p.producedQty > 0 ? fmt(Math.round(p.totalCostMinor / p.producedQty)) : '—'}
                        </td>
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
