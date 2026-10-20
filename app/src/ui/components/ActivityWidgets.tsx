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
import { widgetsForModules } from '../../core/moduleCatalog.ts'
import { collectLeaseAlerts } from '../../core/realestate.ts'
import { collectAlerts as collectInstallmentAlerts } from '../../core/installments.ts'
import { bookingsForDate, BOOKING_STATUS_LABELS } from '../../core/booking.ts'
import { LAUNDRY_STATUS_LABELS } from '../../core/laundry.ts'
import type { BusinessModule } from '../../core/activities.ts'

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
          const list = store.clinicAppointments.filter((a) => a.date === today && a.status === 'scheduled').sort((a, b) => a.time.localeCompare(b.time))
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
        case 'yield_today': {
          const recent = [...store.processingOrders].reverse().slice(0, 4)
          return {
            count: store.processingOrders.length,
            rows: recent.map((o) => {
              const outQty = o.outputs.reduce((a, x) => a + x.qty, 0)
              const y = o.sourceQty > 0 ? Math.round((outQty / o.sourceQty) * 1000) / 10 : 0
              return {
                key: `pr${o.id}`,
                main: `${o.orderNumber} — ${store.items.find((i) => i.id === o.sourceItemId)?.nameAr ?? '؟'}`,
                sub: `خام ${o.sourceQty} → نواتج ${Math.round(outQty * 1000) / 1000}${o.wasteQty > 0 ? ` + فاقد ${o.wasteQty}` : ''}`,
                badge: `${y}٪`, tone: y >= 45 ? ('ok' as const) : ('warn' as const),
              }
            }),
          }
        }
        case 'low_stock': {
          const list = store.items.filter((i) => !i.isService && (i.stockQty ?? 0) <= (i.minQty ?? 0))
          return {
            count: list.length,
            rows: list.slice(0, 4).map((i) => ({
              key: `ls${i.id}`, main: i.nameAr, sub: `الحد ${i.minQty ?? 0} ${i.baseUnit ?? ''}`,
              badge: `${i.stockQty ?? 0}`, tone: 'warn' as const,
            })),
          }
        }
        case 'po_waiting': {
          const list = store.purchaseOrders.filter((o) => o.status === 'sent' || o.status === 'partial')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((o) => ({
              key: `po${o.id}`, main: o.supplierName, sub: `${o.orderNumber} — تسليم ${o.expectedDate || 'غير محدد'}`,
              badge: fmt(o.lines.reduce((sum, l) => sum + Math.round(l.qty * l.unitPriceMinor), 0)), tone: 'ok' as const,
            })),
          }
        }
        case 'upcoming_installments': {
          const list = collectInstallmentAlerts(store.installmentPlans, today)
          return {
            count: list.length,
            rows: list.slice(0, 4).map((a) => ({
              key: `in${a.planId}-${a.seq}`,
              main: store.customers.find((c) => c.id === store.installmentPlans.find((p) => p.id === a.planId)?.customerId)?.nameAr ?? `خطة #${a.planId}`,
              sub: `قسط ${a.seq} — استحقاق ${a.dueDate}`,
              badge: fmt(a.amountDueMinor), tone: a.kind === 'overdue' ? ('danger' as const) : ('warn' as const),
            })),
          }
        }
        case 'laundry_orders': {
          const list = store.laundryOrders.filter((o) => o.status === 'received' || o.status === 'processing' || o.status === 'ready')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((o) => ({
              key: `lo${o.id}`, main: o.customerName || 'عميل نقدي', sub: `${o.orderNumber} — وعد ${o.promisedAt || 'غير محدد'}`,
              badge: LAUNDRY_STATUS_LABELS[o.status], tone: o.status === 'ready' ? ('warn' as const) : ('ok' as const),
            })),
          }
        }
        case 'today_bookings': {
          const list = bookingsForDate(store.bookings, today).filter((b) => b.status === 'scheduled')
          return {
            count: list.length,
            rows: list.slice(0, 4).map((b) => ({
              key: `bk${b.id}`, main: b.customerName || 'عميل', sub: b.serviceName || b.notes || 'حجز',
              badge: `${b.time} · ${BOOKING_STATUS_LABELS[b.status]}`, tone: 'ok' as const,
            })),
          }
        }
        case 'wallet_float': {
          const list = store.walletOps.filter((o) => o.date === today)
          return {
            count: list.length,
            rows: list.slice(0, 4).map((o) => ({
              key: `wo${o.id}`, main: `${o.opNumber} — ${o.targetPhone || '—'}`,
              sub: `هامش الخدمة ${fmt(o.totals?.revenueMinor ?? o.chargeMinor ?? 0)} · آجل ${fmt(o.totals?.remainingMinor ?? 0)}`,
              badge: fmt(o.paidMinor), tone: 'ok' as const,
            })),
          }
        }
        case 'rentals_expiring': {
          const list = collectLeaseAlerts(store.leases, today)
          return {
            count: list.length,
            rows: list.slice(0, 4).map((a) => ({
              key: `le${a.leaseId}`,
              main: a.tenantName || `عقد #${a.leaseId}`,
              sub: a.kind === 'overdue' ? `قسط متأخر ${a.days} يوماً — ${a.contractNumber}` : `العقد ينتهي بعد ${a.days} يوماً — ${a.contractNumber}`,
              badge: a.amountMinor ? fmt(a.amountMinor) : 'انتهاء', tone: a.kind === 'overdue' ? ('danger' as const) : ('warn' as const),
            })),
          }
        }
        case 'top_debtors': {
          const rows = store.customers
            .map((c) => ({
              c,
              bal: store.getCustomerBalance(c.id), // الرصيد الموحّد من كل الأنشطة
            }))
            .filter((x) => x.bal > 0)
            .sort((a, b) => b.bal - a.bal)
          return { count: rows.length, rows: rows.slice(0, 4).map((x) => ({ key: `cu${x.c.id}`, main: x.c.nameAr, sub: x.c.phone || '—', badge: fmt(x.bal), tone: x.bal > 0 ? ('warn' as const) : ('ok' as const) })) }
        }
      }
    }
    /* ويدجات النشاط أولاً (هوية الشاشة)، ثم ودجات الوحدات المضافة بترتيب ALL_MODULES —
       فلا يبقى ويدجت الوحدة المطعَّمة حبيس نشاطه الأصلي (سدّ ف5). */
    const modules = ((setup.modules ?? []) as BusinessModule[])
    const extra = widgetsForModules(modules).filter((w) => !theme.widgets.includes(w))
    /* حدّ أقصى ٦ بطاقات: ودجتا النشاط + حتى أربع ودجات لوحداته المضافة */
    const list = [...theme.widgets, ...extra].slice(0, 6)
    return list.map((w) => ({ id: w, meta: WIDGET_LABELS[w], ...build(w) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, setup.activityId, setup.modules, today])

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
