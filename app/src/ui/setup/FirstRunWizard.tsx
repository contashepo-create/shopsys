/**
 * معالج أول تشغيل — 4 خطوات:
 * 1) اختيار البلد (يضبط العملة والكسور والضريبة تلقائياً)
 * 2) اختيار النشاط (يفعّل خصائص الأصناف ووحدات العمل)
 * 3) السنة المالية (هذه السنة أو سنة سابقة لتسجيل عمليات قديمة) — طلب المالك
 * 4) بيانات المحل وحساب المالك (كل الصلاحيات — محمي بنيوياً)
 */
import { useState } from 'react'
import { Check, ChevronLeft, Store, Crown, Sparkles, CalendarRange } from 'lucide-react'
import { ARAB_COUNTRIES, type Country } from '../../core/countries.ts'
import { ACTIVITY_TEMPLATES, FEATURE_LABELS, MODULE_LABELS, type ActivityTemplate } from '../../core/activities.ts'
import { suggestFiscalYear, validateFiscalYear } from '../../core/fiscal.ts'
import { useAppStore } from '../../stores/app.store.ts'

const STEPS = [1, 2, 3, 4]

export function FirstRunWizard() {
  const completeSetup = useAppStore((s) => s.completeSetup)
  const [step, setStep] = useState(1)
  const [country, setCountry] = useState<Country | null>(null)
  const [activity, setActivity] = useState<ActivityTemplate | null>(null)
  const [shopName, setShopName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  // السنة المالية
  const thisYear = new Date().getFullYear()
  const [fyName, setFyName] = useState(String(thisYear))
  const [fyStart, setFyStart] = useState(`${thisYear}-01-01`)
  const [fyEnd, setFyEnd] = useState(`${thisYear}-12-31`)
  const fyErrors = validateFiscalYear({ nameAr: fyName, startDate: fyStart, endDate: fyEnd }, [])

  const canNext =
    step === 1 ? !!country
    : step === 2 ? !!activity
    : step === 3 ? fyErrors.length === 0
    : Boolean(shopName.trim() && ownerName.trim())

  const pickYear = (y: number) => {
    const fy = suggestFiscalYear(y)
    setFyName(fy.nameAr); setFyStart(fy.startDate); setFyEnd(fy.endDate)
  }

  const finish = () => {
    if (country && activity && shopName.trim() && ownerName.trim() && fyErrors.length === 0) {
      completeSetup({
        country, activity, shopName: shopName.trim(), ownerName: ownerName.trim(),
        fiscalYear: { nameAr: fyName.trim(), startDate: fyStart, endDate: fyEnd },
      })
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 dark:from-slate-950 dark:via-brand-900 dark:to-fuchsia-950">
      <div className="w-full max-w-3xl anim-pop">
        {/* الشعار */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur text-white mb-3 shadow-2xl">
            <Store size={32} />
          </div>
          <h1 className="text-3xl font-black text-white">أهلاً بك في «كونتاشو»</h1>
          <p className="text-white/70 mt-1">نظام إدارة المحلات والمحاسبة — يكبر معك</p>
        </div>

        {/* مؤشر الخطوات */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {STEPS.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  s < step ? 'bg-emerald-400 text-white scale-90' : s === step ? 'bg-white text-brand-600 scale-110 shadow-lg' : 'bg-white/20 text-white/60'
                }`}
              >
                {s < step ? <Check size={16} /> : s}
              </div>
              {s < STEPS.length && <div className={`w-10 h-1 rounded-full transition-colors duration-300 ${s < step ? 'bg-emerald-400' : 'bg-white/20'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-card-dark rounded-3xl shadow-2xl p-6 md:p-8">
          {/* الخطوة 1: البلد */}
          {step === 1 && (
            <div className="anim-in">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">اختر بلدك 🌍</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                سنضبط العملة والكسور العشرية والضريبة تلقائياً — ويمكنك تعديلها لاحقاً من الإعدادات
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-80 overflow-y-auto pl-1">
                {ARAB_COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setCountry(c)}
                    className={`group text-right p-3 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg ${
                      country?.code === c.code
                        ? 'border-brand-500 bg-brand-500/10 shadow-md shadow-brand-500/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-brand-300'
                    }`}
                  >
                    <div className="text-2xl mb-1 transition-transform duration-200 group-hover:scale-125 w-fit">{c.flag}</div>
                    <div className="font-bold text-sm text-slate-800 dark:text-white">{c.nameAr}</div>
                    <div className="text-[11px] text-slate-400">
                      {c.currency.symbol}
                      {c.vatPercent > 0 ? ` · ${c.vatPercent}٪` : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* الخطوة 2: النشاط */}
          {step === 2 && (
            <div className="anim-in">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">ما نشاطك التجاري؟ 🏪</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                النشاط يضبط الإعدادات الافتراضية فقط — كل خاصية تبقى قابلة للتفعيل لأي صنف لاحقاً
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pl-1">
                {ACTIVITY_TEMPLATES.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setActivity(a)}
                    className={`group text-right p-3.5 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
                      activity?.id === a.id
                        ? 'border-brand-500 bg-brand-500/10 shadow-md shadow-brand-500/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-brand-300'
                    }`}
                  >
                    <div className="text-2xl mb-1.5 transition-transform duration-200 group-hover:scale-125 w-fit">{a.icon}</div>
                    <div className="font-bold text-sm text-slate-800 dark:text-white mb-0.5">{a.nameAr}</div>
                    <div className="text-[11px] text-slate-400 leading-relaxed">{a.description}</div>
                  </button>
                ))}
              </div>
              {activity && (
                <div className="mt-4 p-3.5 rounded-2xl bg-brand-500/5 border border-brand-500/20 anim-pop">
                  <div className="text-xs font-bold text-brand-600 dark:text-brand-400 mb-2 flex items-center gap-1">
                    <Sparkles size={13} /> سيُفعَّل تلقائياً:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activity.modules.map((m) => (
                      <span key={m} className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                        {MODULE_LABELS[m].icon} وحدة {MODULE_LABELS[m].nameAr}
                      </span>
                    ))}
                    {activity.features.map((f) => (
                      <span key={f} className="text-[11px] px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
                        {FEATURE_LABELS[f].icon} {FEATURE_LABELS[f].nameAr}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* الخطوة 3: السنة المالية (طلب المالك) */}
          {step === 3 && (
            <div className="anim-in">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <CalendarRange size={20} className="text-brand-500" /> افتح سنتك المالية 📅
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                كل القيود والفواتير ستُسجَّل داخل هذه السنة. اختر السنة الحالية، أو سنة سابقة إن كنت ستُدخل عمليات قديمة — ويمكنك فتح سنوات أخرى لاحقاً.
              </p>
              {/* اختيار سريع */}
              <div className="flex flex-wrap gap-2 mb-5 justify-center">
                {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
                  <button
                    key={y}
                    onClick={() => pickYear(y)}
                    className={`px-5 py-2.5 rounded-2xl border-2 font-black transition-all duration-200 hover:scale-105 ${
                      fyName === String(y)
                        ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300 shadow-md shadow-brand-500/20'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {y}
                    {y === thisYear && <span className="block text-[9px] font-bold text-emerald-500">الحالية</span>}
                    {y < thisYear && <span className="block text-[9px] font-bold text-amber-500">سابقة</span>}
                    {y > thisYear && <span className="block text-[9px] font-bold text-sky-500">قادمة</span>}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto">
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">اسم السنة</label>
                  <input value={fyName} onChange={(e) => setFyName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-sm text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">بداية السنة</label>
                  <input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-sm text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">نهاية السنة</label>
                  <input type="date" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-sm text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors" />
                </div>
              </div>
              {fyErrors.length > 0 && (
                <div className="anim-pop mt-4 max-w-xl mx-auto space-y-1">
                  {fyErrors.map((e, i) => (
                    <div key={i} className="text-[12px] px-3 py-2 rounded-xl font-bold bg-rose-500/10 text-rose-600">{e}</div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-4 text-center">
                💡 السنة المالية قد لا تطابق الميلادية (مثلاً يوليو ← يونيو) — حرر التواريخ كما يناسبك.
              </p>
            </div>
          )}

          {/* الخطوة 4: بيانات المحل والمالك */}
          {step === 4 && (
            <div className="anim-in">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">بيانات المحل والمالك</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">حساب المالك يملك كل الصلاحيات — ولا يمكن لأحد تقييده</p>
              <div className="space-y-4 max-w-md mx-auto">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">اسم المحل / الشركة</label>
                  <input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="مثال: أسواق البركة"
                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors duration-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">اسم المالك</label>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="مثال: محمد عبده"
                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors duration-200"
                  />
                </div>
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                  <Crown size={18} className="text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    <b>دور المالك محمي بنيوياً:</b> كل الصلاحيات بلا استثناء، ولا يستطيع أي مستخدم آخر تقليصها أو حذف الحساب أو تعطيله.
                  </div>
                </div>
                {country && activity && (
                  <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                    <div>📍 البلد: <b>{country.flag} {country.nameAr}</b> — العملة: <b>{country.currency.name}</b> ({country.currency.decimals} كسور)</div>
                    <div>🧾 الضريبة: <b>{country.vatPercent > 0 ? `${country.vatPercent}٪ ${country.taxName}` : 'بدون'}</b></div>
                    <div>🏪 النشاط: <b>{activity.icon} {activity.nameAr}</b></div>
                    <div>📅 السنة المالية: <b>{fyName}</b> ({fyStart} ← {fyEnd})</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* أزرار التنقل */}
          <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 ${step === 1 ? 'invisible' : ''}`}
            >
              رجوع
            </button>
            <button
              disabled={!canNext}
              onClick={() => (step === 4 ? finish() : setStep((s) => s + 1))}
              className="group flex items-center gap-2 px-7 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-l from-brand-600 to-fuchsia-600 shadow-lg shadow-brand-500/30 transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {step === 4 ? '🚀 ابدأ العمل' : 'التالي'}
              {step < 4 && <ChevronLeft size={16} className="transition-transform duration-200 group-hover:-translate-x-1" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
