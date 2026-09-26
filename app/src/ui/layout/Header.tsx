/**
 * الرأس العلوي — تبديل الثيم فاتح/داكن، وضع المحاسبة، معلومات المستخدم
 * + جرس تنبيهات فعّال (إصلاح بلاغ المالك): قائمة منسدلة بتنبيهات حقيقية
 *   (صلاحيات/أقساط/شيكات) والضغط على أي تنبيه يفتح شاشته.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, BookOpenText, Calculator, Bell, UserCircle2, BellOff, LogOut } from 'lucide-react'
import { authRequired } from '../../core/auth.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { collectNotifications, visibleNotifications } from '../../core/notifications.ts'
import { isRentalOverdue, rentalExpectedEnd } from '../../core/rental.ts'
import { collectLeaseAlerts } from '../../core/realestate.ts'
import { connectivityStatus, CONNECTIVITY_LABELS } from '../../core/architecture.ts'
import { currentOpenShift, salesShiftPolicy } from '../../core/shifts.ts'
import { isInvoiceFirst } from '../../core/activities.ts'
import { guardNavigation } from '../components/ui.tsx'

export function Header({ title }: { title: string }) {
  const { theme, toggleTheme, setup, setAccountingMode, sync } = useAppStore()

  // مؤشر الاتصال المرئي (Offline-First — أمر المالك): يستمع لأحداث المتصفح
  const [browserOnline, setBrowserOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  useEffect(() => {
    const on = () => setBrowserOnline(true)
    const off = () => setBrowserOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const conn = connectivityStatus({ browserOnline, syncEnabled: sync.enabled, dirty: sync.dirty, lastResult: sync.lastResult })
  const connInfo = CONNECTIVITY_LABELS[conn]
  const { batches, items, installmentPlans, customers, cheques, issues, appUsers, currentUserId, ownerPinHash, logout, pinResetRequests, readNotificationIds, markNotificationRead, markAllNotificationsRead, restoreNotifications, roleOverrides, customRoles, ownerProfile, rentalContracts, tickets, laundryOrders, leases, shifts } = useDataStore()
  const navigate = useNavigate()
  const goTo = (path: string) => { if (!guardNavigation(() => navigate(path))) navigate(path) }
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )

  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!bellOpen) return
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [bellOpen])

  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const shiftPolicy = salesShiftPolicy({
    roleId: activeUser?.roleId,
    isOwner: currentUserId == null || activeUser?.roleId === 'owner',
    requireOpenShiftForSales: setup.requireOpenShiftForSales,
    userOverride: activeUser?.requireOpenShiftForSales,
    invoiceFirst: isInvoiceFirst(setup.activityId),
  })
  const openShift = currentOpenShift(shifts)
  const authOn = authRequired(ownerPinHash, appUsers.filter((u) => u.active).length)

  const notifications = useMemo(
    () => collectNotifications({
      batches,
      itemName: (id) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`,
      // انخفاض المخزون تحت حد إعادة الطلب (نمط Lightspeed) — للأصناف النشطة ذات حد فقط
      lowStockItems: items
        .filter((it) => it.isActive && it.minQty > 0 && (it.stockQty ?? 0) <= it.minQty)
        .map((it) => ({ id: it.id, nameAr: it.nameAr, stockQty: it.stockQty ?? 0, minQty: it.minQty })),
      installmentPlans,
      customerName: (id) => customers.find((c) => c.id === id)?.nameAr ?? `عميل #${id}`,
      cheques,
      // إيجارات متجاوزة موعد الإرجاع (نمط Point of Rental) + مواعيد تسليم موعودة متجاوزة (صيانة/مغسلة)
      overdueRentals: rentalContracts
        .filter((c) => isRentalOverdue(c, new Date().toISOString()))
        .map((c) => ({ id: c.id, contractNumber: c.contractNumber, equipmentName: c.equipmentName, expectedEnd: rentalExpectedEnd(c.date, c.days, c.rateType ?? 'daily') })),
      overduePromises: [
        ...tickets
          .filter((t) => (t.status === 'received' || t.status === 'in_progress' || t.status === 'ready') && t.promisedAt && t.promisedAt < new Date().toISOString())
          .map((t) => ({ id: t.id, docNumber: t.ticketNumber, what: t.deviceName, kind: 'maintenance' as const, promisedAt: t.promisedAt ?? '' })),
        ...laundryOrders
          .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled' && o.promisedAt && o.promisedAt < new Date().toISOString().slice(0, 10))
          .map((o) => ({ id: o.id, docNumber: o.orderNumber, what: o.customerName, kind: 'laundry' as const, promisedAt: o.promisedAt })),
      ],
      // عقود إيجار العقارات: انتهاء قريب (60 يوماً) أو أقساط متأخرة (نمط سمات)
      leaseAlerts: collectLeaseAlerts(leases, new Date().toISOString().slice(0, 10), 60),
      openIssues: issues.filter((i) => i.status !== 'resolved').map((i) => ({ id: i.id, title: i.title, reportedBy: i.reportedBy })),
      // طلبات استعادة كلمة السر — تظهر للمالك فقط (الموظف لا يرى الجرس المالي أصلاً بحكم الصلاحيات)
      openPinResets: currentUserId == null
        ? pinResetRequests.filter((r) => r.status === 'open').map((r) => ({ id: r.id, nameAr: r.nameAr }))
        : [],
      fmt: (m) => formatMinor(m, cur, false),
      todayIso: new Date().toISOString(),
    }),
    [batches, items, installmentPlans, customers, cheques, issues, pinResetRequests, currentUserId, cur, rentalContracts, tickets, laundryOrders, leases],
  )
  // مراجعة المالك («لماذا إشعارات المالك تظهر لأي مستخدم؟»):
  // الجرس يفلتر بصلاحيات المستخدم النشط — الكاشير لا يرى أقساطاً ولا شيكات ولا بلاغات
  const myPerms = useMemo(
    () => effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, useAppStore.getState().setup.activityId)),
    [activeUser, roleOverrides, customRoles],
  )
  const notificationsForMe = useMemo(
    () => visibleNotifications(notifications, myPerms),
    [notifications, myPerms],
  )
  // طلب المالك: التحكم في الإشعارات وتعليمها كمقروء — الشارة تعدّ غير المقروء فقط
  const readSet = new Set(readNotificationIds)
  const unread = notificationsForMe.filter((n) => !readSet.has(n.id))
  const readOnes = notificationsForMe.filter((n) => readSet.has(n.id))

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-card-dark/70 glass">
      <h1 className="text-lg font-extrabold text-slate-800 dark:text-white flex-1">{title}</h1>

      {/* مؤشر الاتصال/المزامنة — يظهر دائماً ليطمئن المستخدم أن العمل محفوظ محلياً */}
      <span
        title={connInfo.nameAr}
        className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-full transition-colors ${
          connInfo.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : connInfo.tone === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : connInfo.tone === 'danger' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
          : 'bg-slate-100 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400'
        }`}
      >
        <span>{connInfo.icon}</span>
        <span className="hidden lg:inline">{connInfo.nameAr}</span>
      </span>

      {country && (
        <span className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/70 px-3 py-1.5 rounded-full">
          {country.flag} {country.nameAr} · {country.currency.symbol}
        </span>
      )}

      {/* حالة الوردية: قرارها مركزي حسب الدور، لا حسب كون الحساب مالكاً فقط */}
      {setup.modules.includes('pos') && !openShift && !isInvoiceFirst(setup.activityId) && (
        <button
          onClick={() => goTo('/sales/shifts')}
          title={shiftPolicy.required ? shiftPolicy.messageAr : shiftPolicy.messageAr}
          className={`hidden sm:flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-full transition-all hover:scale-105 ${
            shiftPolicy.required
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 animate-pulse'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
          }`}
        >
          {shiftPolicy.required ? '⛔ افتح وردية' : '💡 وردية اختيارية'}
        </button>
      )}

      {/* مفتاح وضع المحاسبة (القرار 10) */}
      <button
        onClick={() => setAccountingMode(setup.accountingMode === 'simple' ? 'full' : 'simple')}
        title={setup.accountingMode === 'simple' ? 'تفعيل الوضع المحاسبي الكامل' : 'العودة للوضع المبسّط'}
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 ${
          setup.accountingMode === 'full'
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold shadow-sm'
            : 'bg-slate-100 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400'
        }`}
      >
        {setup.accountingMode === 'full' ? <BookOpenText size={14} /> : <Calculator size={14} />}
        {setup.accountingMode === 'full' ? 'محاسبي كامل' : 'مبسّط'}
      </button>

      <div ref={bellRef} className="relative">
        <button
          onClick={() => setBellOpen((v) => !v)}
          title={unread.length ? `${unread.length} تنبيه غير مقروء` : 'لا تنبيهات جديدة'}
          className="relative p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-all duration-200 hover:scale-110"
        >
          <Bell size={18} />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-4 h-4 px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute left-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 shadow-2xl z-50 anim-in">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">
                🔔 التنبيهات {unread.length > 0 && <span className="text-rose-500 font-bold">({unread.length} جديد)</span>}
              </span>
              {unread.length > 0 && (
                <button
                  onClick={() => markAllNotificationsRead(unread.map((n) => n.id))}
                  className="text-[10.5px] font-bold text-brand-600 dark:text-brand-400 hover:underline"
                >✓✓ تعليم الكل كمقروء</button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-slate-400">
                <BellOff size={22} className="mx-auto mb-2 opacity-50" />
                <div className="text-[12px]">لا تنبيهات حالياً — كل شيء تحت السيطرة ✓</div>
              </div>
            ) : unread.length === 0 && readOnes.length > 0 ? (
              <div className="p-4 text-center text-slate-400 space-y-2">
                <div className="text-[12px]">كل التنبيهات مقروءة ✓ ({readOnes.length} في الأرشيف)</div>
                <button onClick={restoreNotifications} className="text-[10.5px] font-bold text-brand-600 dark:text-brand-400 hover:underline">↩️ إظهار المقروءة</button>
              </div>
            ) : (
              <>
                {unread.map((n) => (
                  <div
                    key={n.id}
                    className="w-full flex items-start gap-1 px-2 py-2.5 border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <button onClick={() => { setBellOpen(false); goTo(n.route) }} className="flex-1 text-right">
                      <div className={`text-[12px] font-bold flex items-center gap-1.5 ${n.severity === 'danger' ? 'text-rose-600' : n.severity === 'warn' ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'}`}>
                        <span>{n.icon}</span> {n.title}
                      </div>
                      <div className="text-[10.5px] text-slate-400 mt-0.5">{n.body}</div>
                    </button>
                    <button
                      onClick={() => markNotificationRead(n.id)}
                      title="تعليم كمقروء"
                      className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors text-[11px] font-black"
                    >✓</button>
                  </div>
                ))}
                {readOnes.length > 0 && (
                  <div className="px-4 py-2 text-center">
                    <button onClick={restoreNotifications} className="text-[10px] font-bold text-slate-400 hover:text-brand-500 hover:underline">
                      ↩️ {readOnes.length} تنبيه مقروء — اضغط للإظهار
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* تبديل الثيم */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-xl text-slate-500 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-all duration-300 hover:scale-110 hover:rotate-12"
        title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <div className="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-slate-700">
        <div className="text-left hidden sm:block">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{activeUser?.nameAr ?? (setup.ownerName || 'المالك')}</div>
          <div className={`text-[10px] font-bold ${activeUser ? 'text-brand-500' : 'text-emerald-500'}`}>
            {activeUser ? `🛡️ ${activeUser.roleId}` : '👑 كل الصلاحيات'}
          </div>
        </div>
        <button onClick={() => goTo('/settings/profile')} title="حسابي — بياناتي ورقمي السري" className="transition-transform hover:scale-110">
          {(() => {
            const av = activeUser ? activeUser.avatarDataUrl : ownerProfile.avatarDataUrl
            return av
              ? <img src={av} alt="" className="w-8 h-8 rounded-xl object-cover border border-brand-500/40" />
              : <UserCircle2 size={30} className="text-brand-500" />
          })()}
        </button>
        {authOn && (
          <button
            onClick={logout}
            title="تسجيل خروج — العودة لشاشة الدخول"
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 transition-all duration-200 hover:scale-110"
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
    </header>
  )
}
