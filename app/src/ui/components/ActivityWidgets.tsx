/**
 * ويدجات النشاط في لوحة المعلومات (قرار المالك — بند 11):
 * كل نشاط يرى ما يهمه فعلاً: مواعيد اليوم للعيادة، الرحلات النشطة للوجستيات،
 * أوردرات المطبخ للمطعم، مركز الذهب للمجوهرات... الأرقام حية من المخزن.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { KARAT_LABELS } from '../../core/jewelry.ts'
import { themeForActivity, WIDGET_LABELS, type ActivityWidget } from '../../core/activityTheme.ts'
import { customerStatement, customerUnitDocs, statementBalance } from '../../core/statements.ts'

interface Row { key: string; main: string; sub: string; badge?: string; tone?: 'ok' | 'warn' | 'danger' }

export function ActivityWidgets() {
  const { setup } = useAppStore()
  const store = useDataStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur)
  const theme = themeForActivity(setup.activityId)
  const today = new Date().toISOString().slice(0, 10)

  /** بيانات كل ويدجت — تُحسب فقط للويدجات المعروضة */
  const widgets = useMemo(() => {
    const build = (w: ActivityWidget): { rows: Row[]; count: number } => {
      switch (w) {
        case 'today_appointments': {
          const list = store.clinicAppointments.filter((a) => a.date === today && !a.done).sort((a, b) => a.time.localeCompare(b.time))
          return {
            count: list.length,
            rows: list.slice(0, 4).map((a) => ({
              key: `ap${a.id}`,
              main: store.clinicPatients.find((p) => p.id === a.patientId)?.nameAr ?? `مريض #${a.patientId}`,
              sub: a.purpose || 'كشف',
              badge: a.time, tone: 'ok' as const,
            })),
          }
        }
        case 'active_trips': {
          const list = store.trips.filter((t) => t.date.startsWith(today))
          return {
            count: list.length,
            rows: list.slice(0, 4).map((t) => ({ key: `tr${t.id}`, main: `${t.fromLoc} ← ${t.toLoc}`, sub: t.tripNumber, badge: fmt(t.totals?.grandMinor ?? t.qty * t.unitPriceMinor), tone: 'ok' as const })),
          }
        }
        case 'open_tickets': {
          const list = store.tickets.filter((t) => t.status === 'received' || t.status === 'in_progress' || t.status === 'ready')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((t) => ({
              key: `tk${t.id}`, main: t.deviceName, sub: `${t.ticketNumber} — ${t.customerName || 'عميل نقدي'}`,
              badge: t.status === 'ready' ? 'جاهز للتسليم' : t.status === 'in_progress' ? 'قيد الإصلاح' : 'مستلم',
              tone: t.status === 'ready' ? ('warn' as const) : ('ok' as const),
            })),
          }
        }
        case 'open_rentals': {
          const list = store.rentalContracts.filter((c) => c.status === 'active')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((c) => ({ key: `rc${c.id}`, main: c.equipmentName, sub: c.contractNumber, badge: fmt(c.days * c.dailyRateMinor), tone: 'ok' as const })),
          }
        }
        case 'lab_pending': {
          const list = store.labOrders.filter((o) => o.tests.some((t) => t.status === 'pending' || t.status === 'collected' || t.status === 'resulted'))
          return {
            count: list.length,
            rows: list.slice(0, 4).map((o) => ({
              key: `lo${o.id}`, main: o.patientName, sub: o.orderNumber,
              badge: `${o.tests.filter((t) => t.status === 'approved').length}/${o.tests.length} معتمد`, tone: 'warn' as const,
            })),
          }
        }
        case 'open_projects': {
          const list = store.projects.filter((p) => p.status === 'active')
          return { count: list.length, rows: list.slice(0, 4).map((p) => ({ key: `pj${p.id}`, main: p.nameAr, sub: p.code, tone: 'ok' as const })) }
        }
        case 'kitchen_orders': {
          const list = store.restaurantOrders.filter((o) => o.status === 'open')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((o) => ({
              key: `ro${o.id}`, main: o.type === 'dine_in' ? `طاولة ${o.tableName}` : o.type === 'delivery' ? 'دليفري' : 'تيك أواي',
              sub: `${o.orderNumber} — ${o.lines.length} صنف`, tone: 'warn' as const,
            })),
          }
        }
        case 'expiry_soon': {
          const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
          const soon = store.batches.filter((b) => b.qty > 0 && b.expiryDate && b.expiryDate <= horizon)
          return {
            count: soon.length,
            rows: soon.sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1)).slice(0, 4).map((b) => ({
              key: `bt${b.id}`,
              main: store.items.find((i) => i.id === b.itemId)?.nameAr ?? `صنف #${b.itemId}`,
              sub: `كمية ${b.qty}`, badge: b.expiryDate!,
              tone: b.expiryDate! <= today ? ('danger' as const) : ('warn' as const),
            })),
          }
        }
        case 'gold_position': {
          const byKarat = new Map<string, number>()
          for (const p of store.jewelryProfiles) {
            const item = store.items.find((i) => i.id === p.itemId)
            const qty = item?.stockQty ?? 0
            if (qty <= 0) continue
            const label = KARAT_LABELS[p.karat] ?? String(p.karat)
            byKarat.set(label, (byKarat.get(label) ?? 0) + p.weightGrams * qty)
          }
          const rows = [...byKarat.entries()].map(([k, g]) => ({ key: k, main: `عيار ${k}`, sub: 'في المخزون', badge: `${g.toFixed(2)} جم`, tone: 'ok' as const }))
          return { count: rows.length, rows: rows.slice(0, 4) }
        }
        case 'top_debtors': {
          const allVouchers = [
            ...store.vouchers,
            ...store.clientSettlements.map((st) => ({ voucherNumber: st.settlementNumber, kind: 'receipt' as const, date: st.date, partyKind: 'customer' as const, partyId: st.customerId, amountMinor: st.amountMinor })),
          ]
          const rows = store.customers
            .map((c) => ({
              c,
              bal: statementBalance(customerStatement({ customerId: c.id, sales: store.sales, saleReturns: store.saleReturns, allSales: store.sales, vouchers: allVouchers, cheques: store.cheques, extraDocs: customerUnitDocs({ customerId: c.id, trips: store.trips, tickets: store.tickets, rentals: store.rentalContracts, clinicVisits: store.clinicVisits, clinicCollections: store.clinicCollections, linkedPatientIds: store.clinicPatients.filter((p) => p.linkedCustomerId === c.id).map((p) => p.id) }) })),
            }))
            .filter((x) => x.bal > 0)
            .sort((a, b) => b.bal - a.bal)
          return { count: rows.length, rows: rows.slice(0, 4).map((x) => ({ key: `cu${x.c.id}`, main: x.c.nameAr, sub: x.c.phone || '—', badge: fmt(x.bal), tone: x.bal > 0 ? ('warn' as const) : ('ok' as const) })) }
        }
      }
    }
    return theme.widgets.slice(0, 3).map((w) => ({ id: w, meta: WIDGET_LABELS[w], ...build(w) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, setup.activityId, today])

  if (widgets.length === 0) return null

  return (
    <div className={`grid grid-cols-1 ${widgets.length > 1 ? 'lg:grid-cols-2' : ''} gap-4`}>
      {widgets.map((w, i) => (
        <div key={w.id} style={{ animationDelay: `${200 + i * 60}ms` }} className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2">
              <span className="text-lg">{w.meta.icon}</span> {w.meta.titleAr}
            </h3>
            <Link to={w.meta.route} className="text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:underline">
              {w.count > 0 ? `الكل (${w.count}) ←` : 'فتح ←'}
            </Link>
          </div>
          {w.rows.length === 0 ? (
            <div className="text-center py-6 text-slate-300 dark:text-slate-600 text-[13px]">✓ {w.meta.emptyAr}</div>
          ) : (
            <div className="space-y-1.5">
              {w.rows.map((r) => (
                <div key={r.key} className={`flex items-center justify-between px-3 py-2 rounded-xl border text-[12.5px] ${
                  r.tone === 'danger' ? 'bg-rose-500/5 border-rose-500/15' : r.tone === 'warn' ? 'bg-amber-500/5 border-amber-500/15' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800'
                }`}>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-700 dark:text-slate-200 truncate">{r.main}</div>
                    <div className="text-[10.5px] text-slate-400 truncate">{r.sub}</div>
                  </div>
                  {r.badge && (
                    <span className={`shrink-0 text-[11px] font-black ${r.tone === 'danger' ? 'text-rose-500' : r.tone === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`}>{r.badge}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
