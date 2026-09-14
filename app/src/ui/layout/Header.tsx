/**
 * الرأس العلوي — تبديل الثيم فاتح/داكن، وضع المحاسبة، معلومات المستخدم
 */
import { Moon, Sun, BookOpenText, Calculator, Bell, UserCircle2 } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'

export function Header({ title }: { title: string }) {
  const { theme, toggleTheme, setup, setAccountingMode } = useAppStore()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined

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

      <button className="relative p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-all duration-200 hover:scale-110">
        <Bell size={18} />
        <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
      </button>

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
