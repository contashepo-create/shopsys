/**
 * لوحة اليوم — بلغة التاجر (وثيقة التصميم 9.1)
 * الأرقام هنا تجريبية للعرض حتى تتصل قاعدة البيانات في الخطوة القادمة.
 */
import { TrendingUp, Wallet, Coins, AlertTriangle, ArrowUpLeft, ArrowDownLeft, PackageX, CalendarClock } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'

export function Dashboard() {
  const { setup } = useAppStore()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (minor: number) => formatMinor(minor, cur)

  const cards = [
    { title: 'مبيعات اليوم', value: fmt(1245000), icon: TrendingUp, color: 'from-emerald-500 to-teal-500', glow: 'shadow-emerald-500/30', delta: '+12٪ عن أمس' },
    { title: 'ربح اليوم', value: fmt(218000), icon: Coins, color: 'from-violet-500 to-fuchsia-500', glow: 'shadow-violet-500/30', delta: 'هامش 17.5٪' },
    { title: 'في الخزينة', value: fmt(830000), icon: Wallet, color: 'from-sky-500 to-cyan-500', glow: 'shadow-sky-500/30', delta: '3 ورديات مفتوحة' },
    { title: 'تنبيهات', value: '5', icon: AlertTriangle, color: 'from-amber-500 to-orange-500', glow: 'shadow-amber-500/30', delta: 'تحتاج انتباهك' },
  ]

  const alerts = [
    { icon: CalendarClock, color: 'text-amber-500 bg-amber-500/10', text: '3 أصناف تنتهي صلاحيتها خلال 7 أيام', tag: 'صلاحيات' },
    { icon: PackageX, color: 'text-rose-500 bg-rose-500/10', text: 'صنفان وصلا لحد الطلب — يحتاجان شراء', tag: 'نواقص' },
    { icon: ArrowDownLeft, color: 'text-sky-500 bg-sky-500/10', text: 'قسط مستحق غداً على العميل أحمد سمير', tag: 'أقساط' },
  ]

  return (
    <div className="space-y-6">
      {/* البطاقات */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div
            key={c.title}
            style={{ animationDelay: `${i * 80}ms` }}
            className={`anim-up group relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br ${c.color} text-white shadow-xl ${c.glow} transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl cursor-default`}
          >
            <div className="absolute -left-6 -bottom-6 opacity-15 transition-transform duration-500 group-hover:scale-125 group-hover:rotate-12">
              <c.icon size={110} />
            </div>
            <div className="relative">
              <div className="text-sm opacity-85 font-semibold">{c.title}</div>
              <div className="text-2xl font-black mt-1.5">{c.value}</div>
              <div className="text-[11px] opacity-75 mt-2">{c.delta}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* التنبيهات */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '320ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <AlertTriangle size={17} className="text-amber-500" /> تنبيهات تحتاجك
          </h3>
          <div className="space-y-2.5">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200 cursor-pointer">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${a.color}`}>
                  <a.icon size={17} />
                </span>
                <span className="text-[13px] text-slate-600 dark:text-slate-300 flex-1">{a.text}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">{a.tag}</span>
              </div>
            ))}
          </div>
        </div>

        {/* لك وعليك */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '400ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4">لك وعليك</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
              <div className="flex items-center gap-2.5">
                <ArrowUpLeft size={18} className="text-emerald-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">لك عند العملاء</span>
              </div>
              <span className="font-black text-emerald-600 dark:text-emerald-400">{fmt(1230000)}</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/15">
              <div className="flex items-center gap-2.5">
                <ArrowDownLeft size={18} className="text-rose-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">عليك للموردين</span>
              </div>
              <span className="font-black text-rose-600 dark:text-rose-400">{fmt(4500000)}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            💡 هذه الأرقام مشتقة من دفتر الأستاذ الموحّد — نفس مصدر ميزان المراجعة، فلا تتناقض أبداً.
          </p>
        </div>

        {/* حالة النظام */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '480ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4">إنجاز المرحلة 0</h3>
          <div className="space-y-2.5 text-[13px]">
            {[
              ['محرك النقود (كسور متغيرة حسب البلد)', true],
              ['محرك القيود المزدوجة + شجرة الحسابات', true],
              ['نظام الصلاحيات والأدوار الجاهزة', true],
              ['معالج أول تشغيل (بلد + نشاط)', true],
              ['واجهة RTL بثيمين وأقسام ملونة', true],
              ['قاعدة البيانات SQLite (الخطوة القادمة)', false],
              ['شاشة الكاشير POS (المرحلة 2)', false],
            ].map(([label, done], i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                  {done ? '✓' : '…'}
                </span>
                <span className={done ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}>{label as string}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
