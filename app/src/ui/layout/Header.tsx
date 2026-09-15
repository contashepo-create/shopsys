/**
 * الرأس العلوي — تبديل الثيم فاتح/داكن، وضع المحاسبة، معلومات المستخدم
 * + جرس تنبيهات فعّال (إصلاح بلاغ المالك): قائمة منسدلة بتنبيهات حقيقية
 *   (صلاحيات/أقساط/شيكات) والضغط على أي تنبيه يفتح شاشته.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, BookOpenText, Calculator, Bell, UserCircle2, BellOff } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { collectNotifications } from '../../core/notifications.ts'

export function Header({ title }: { title: string }) {
  const { theme, toggleTheme, setup, setAccountingMode } = useAppStore()
  const { batches, items, installmentPlans, customers, cheques } = useDataStore()
  const navigate = useNavigate()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

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

  const notifications = useMemo(
    () => collectNotifications({
      batches,
      itemName: (id) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`,
      installmentPlans,
      customerName: (id) => customers.find((c) => c.id === id)?.nameAr ?? `عميل #${id}`,
      cheques,
      fmt: (m) => formatMinor(m, cur, false),
      todayIso: new Date().toISOString(),
    }),
    [batches, items, installmentPlans, customers, cheques, cur],
  )

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-card-dark/70 glass">
      <h1 className="text-lg font-extrabold text-slate-800 dark:text-white flex-1">{title}</h1>

      {country && (
        <span className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/70 px-3 py-1.5 rounded-full">
          {country.flag} {country.nameAr} · {country.currency.symbol}
          {country.vatPercent > 0 && ` · ضريبة ${country.vatPercent}٪`}
        </span>
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
          title={notifications.length ? `${notifications.length} تنبيه` : 'لا تنبيهات'}
          className="relative p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-all duration-200 hover:scale-110"
        >
          <Bell size={18} />
          {notifications.length > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-4 h-4 px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
              {notifications.length > 9 ? '9+' : notifications.length}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute left-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 shadow-2xl z-50 anim-in">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 text-[12px] font-extrabold text-slate-700 dark:text-slate-200">
              🔔 التنبيهات {notifications.length > 0 && <span className="text-slate-400 font-bold">({notifications.length})</span>}
            </div>
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-slate-400">
                <BellOff size={22} className="mx-auto mb-2 opacity-50" />
                <div className="text-[12px]">لا تنبيهات حالياً — كل شيء تحت السيطرة ✓</div>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { setBellOpen(false); navigate(n.route) }}
                  className="w-full text-right px-4 py-2.5 border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className={`text-[12px] font-bold flex items-center gap-1.5 ${n.severity === 'danger' ? 'text-rose-600' : n.severity === 'warn' ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'}`}>
                    <span>{n.icon}</span> {n.title}
                  </div>
                  <div className="text-[10.5px] text-slate-400 mt-0.5">{n.body}</div>
                </button>
              ))
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
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{setup.ownerName || 'المالك'}</div>
          <div className="text-[10px] text-emerald-500 font-bold">👑 كل الصلاحيات</div>
        </div>
        <UserCircle2 size={30} className="text-brand-500" />
      </div>
    </header>
  )
}
