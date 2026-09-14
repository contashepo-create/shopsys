/**
 * المظهر (استكمال المرحلة 1):
 * الوضع الفاتح/الداكن، اللون الرئيسي من لوحات جاهزة (يتلون التطبيق فوراً)،
 * حجم العرض (تكبير/تصغير)، وتقليل الحركة — كل شيء يُطبَّق لحظياً ويُحفظ.
 */
import { Sun, Moon, Palette, ZoomIn, Accessibility, Check } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { ACCENTS, ZOOM_LEVELS } from '../../core/appearance.ts'
import { useToast } from '../components/ui.tsx'

export function AppearancePage() {
  const { theme, toggleTheme, appearance, updateAppearance } = useAppStore()
  const toast = useToast()

  return (
    <div className="max-w-3xl space-y-4">
      {/* الوضع */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3">
          {theme === 'light' ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} className="text-indigo-400" />} الوضع
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => theme !== 'light' && toggleTheme()}
            className={`p-4 rounded-2xl border-2 transition-all duration-200 ${theme === 'light' ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
          >
            <div className="h-16 rounded-xl bg-[#f4f5fb] border border-slate-200 mb-2 overflow-hidden">
              <div className="h-4 bg-white border-b border-slate-100" />
              <div className="p-2 flex gap-1.5">
                <div className="w-8 h-6 rounded bg-white border border-slate-200" />
                <div className="flex-1 h-6 rounded bg-white border border-slate-200" />
              </div>
            </div>
            <div className="text-[12.5px] font-bold flex items-center justify-center gap-1.5">
              <Sun size={13} /> فاتح {theme === 'light' && <Check size={13} className="text-brand-600" />}
            </div>
          </button>
          <button
            onClick={() => theme !== 'dark' && toggleTheme()}
            className={`p-4 rounded-2xl border-2 transition-all duration-200 ${theme === 'dark' ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
          >
            <div className="h-16 rounded-xl bg-[#0b1020] border border-slate-700 mb-2 overflow-hidden">
              <div className="h-4 bg-[#131a2e] border-b border-slate-800" />
              <div className="p-2 flex gap-1.5">
                <div className="w-8 h-6 rounded bg-[#131a2e] border border-slate-800" />
                <div className="flex-1 h-6 rounded bg-[#131a2e] border border-slate-800" />
              </div>
            </div>
            <div className="text-[12.5px] font-bold flex items-center justify-center gap-1.5">
              <Moon size={13} /> داكن {theme === 'dark' && <Check size={13} className="text-brand-600" />}
            </div>
          </button>
        </div>
      </section>

      {/* اللون الرئيسي */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '60ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-1">
          <Palette size={15} className="text-brand-600" /> اللون الرئيسي
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">يتلون به شريط التنقل والأزرار الرئيسية فوراً</p>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {ACCENTS.map((a) => {
            const active = appearance.accentId === a.id
            return (
              <button
                key={a.id}
                onClick={() => { updateAppearance({ accentId: a.id }); toast.show(`اللون الرئيسي: ${a.nameAr} ✅`) }}
                title={a.nameAr}
                className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all duration-200 ${active ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/50' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/30'}`}
              >
                <span
                  className="w-9 h-9 rounded-full shadow-inner flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
                  style={{ background: `linear-gradient(135deg, ${a.shades[400]}, ${a.shades[600]})` }}
                >
                  {active && <Check size={15} className="text-white drop-shadow" />}
                </span>
                <span className="text-[10px] font-bold text-slate-500">{a.nameAr.replace(' (الافتراضي)', '')}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* حجم العرض */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '120ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-1">
          <ZoomIn size={15} className="text-brand-600" /> حجم العرض
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">كبّر الواجهة على الشاشات البعيدة أو صغّرها لعرض المزيد</p>
        <div className="grid grid-cols-4 gap-2">
          {ZOOM_LEVELS.map((z) => (
            <button
              key={z.value}
              onClick={() => updateAppearance({ zoom: z.value })}
              className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ${appearance.zoom === z.value ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
            >
              <div className="font-black" style={{ fontSize: `${12 * z.value}px` }}>أ</div>
              <div className="text-[10.5px] font-bold mt-0.5">{z.label}</div>
              <div className="text-[9px] text-slate-400" dir="ltr">{Math.round(z.value * 100)}%</div>
            </button>
          ))}
        </div>
      </section>

      {/* إتاحة */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '180ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3">
          <Accessibility size={15} className="text-brand-600" /> الإتاحة
        </h2>
        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
          <div>
            <div className="text-[12.5px] font-bold text-slate-600 dark:text-slate-300">تقليل الحركة</div>
            <div className="text-[10.5px] text-slate-400">إيقاف الحركات والانتقالات — مفيد للأجهزة الضعيفة أو من تزعجهم الحركة</div>
          </div>
          <input
            type="checkbox"
            checked={appearance.reduceMotion}
            onChange={(e) => updateAppearance({ reduceMotion: e.target.checked })}
            className="w-4 h-4 accent-brand-600"
          />
        </label>
      </section>
    </div>
  )
}
