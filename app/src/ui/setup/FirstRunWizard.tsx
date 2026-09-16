/**
 * معالج أول تشغيل — إعادة تصميم (أمر المالك):
 * ① البلد والنشاط قوائم منسدلة احترافية + بطاقة معاينة حية.
 * ② انتقالات متقدمة بين الخطوات (انزلاق + توهج + كرات ضوئية عائمة).
 * ③ صفحة بيانات المنشأة: الإلزامي = اسم المنشأة/المالك/الهاتف/البريد/المدينة
 *    (منسدلة حسب البلد) + الشارع/الحي — والبلد ثابت من خطوة الإعداد.
 * ④ البيانات الضريبية اختيارية — لكن غيابها يمنع إصدار فاتورة إلكترونية
 *    إن كانت ميزتها مفعّلة (التحقق في شاشة الفاتورة الإلكترونية نفسها).
 * البلد يُقفل بعد الإنهاء — تغييره عبر المطوّر فقط.
 */
import { useState } from 'react'
import { Check, ChevronLeft, Crown, Sparkles, CalendarRange, Globe2, Store, Building2 } from 'lucide-react'
import { ARAB_COUNTRIES, getCountry, type Country } from '../../core/countries.ts'
import { ACTIVITY_TEMPLATES, FEATURE_LABELS, MODULE_LABELS, type ActivityTemplate } from '../../core/activities.ts'
import { citiesOf } from '../../core/cities.ts'
import { suggestFiscalYear, validateFiscalYear } from '../../core/fiscal.ts'
import { useAppStore } from '../../stores/app.store.ts'

const STEPS = [
  { n: 1, label: 'البلد', icon: '🌍' },
  { n: 2, label: 'النشاط', icon: '🏪' },
  { n: 3, label: 'السنة المالية', icon: '📅' },
  { n: 4, label: 'بيانات المنشأة', icon: '🏢' },
]

const inputCls =
  'w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-sm text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors duration-200 placeholder:text-slate-300 dark:placeholder:text-slate-600'

const isValidEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim())
const isValidPhone = (v: string) => v.replace(/\D/g, '').length >= 7

export function FirstRunWizard() {
  const completeSetup = useAppStore((s) => s.completeSetup)
  const [step, setStep] = useState(1)
  const [countryCode, setCountryCode] = useState('')
  const [activityId, setActivityId] = useState('')
  const country: Country | null = countryCode ? (getCountry(countryCode) ?? null) : null
  const activity: ActivityTemplate | null = ACTIVITY_TEMPLATES.find((a) => a.id === activityId) ?? null

  // بيانات المنشأة (الإلزامية بطلب المالك)
  const [shopName, setShopName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [street, setStreet] = useState('')
  const cities = citiesOf(countryCode)
  const effectiveCity = city === '__other__' ? customCity.trim() : city

  // السنة المالية
  const thisYear = new Date().getFullYear()
  const [fyName, setFyName] = useState(String(thisYear))
  const [fyStart, setFyStart] = useState(`${thisYear}-01-01`)
  const [fyEnd, setFyEnd] = useState(`${thisYear}-12-31`)
  const fyErrors = validateFiscalYear({ nameAr: fyName, startDate: fyStart, endDate: fyEnd }, [])

  const companyOk =
    Boolean(shopName.trim() && ownerName.trim() && effectiveCity && street.trim()) &&
    isValidPhone(phone) && isValidEmail(email)

  const canNext =
    step === 1 ? !!country
    : step === 2 ? !!activity
    : step === 3 ? fyErrors.length === 0
    : companyOk

  const pickYear = (y: number) => {
    const fy = suggestFiscalYear(y)
    setFyName(fy.nameAr); setFyStart(fy.startDate); setFyEnd(fy.endDate)
  }

  const finish = () => {
    if (country && activity && companyOk && fyErrors.length === 0) {
      completeSetup({
        country, activity, shopName: shopName.trim(), ownerName: ownerName.trim(),
        fiscalYear: { nameAr: fyName.trim(), startDate: fyStart, endDate: fyEnd },
        contact: { phone: phone.trim(), email: email.trim(), city: effectiveCity, street: street.trim() },
      })
    }
  }

  return (
    <div dir="rtl" className="relative min-h-screen flex items-center justify-center p-6 overflow-hidden bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 dark:from-slate-950 dark:via-brand-900 dark:to-fuchsia-950">
      {/* كرات ضوئية عائمة — خلفية حية */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-fuchsia-400/25 blur-3xl anim-orb" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 w-[28rem] h-[28rem] rounded-full bg-sky-400/20 blur-3xl anim-orb" style={{ animationDelay: '-6s' }} />
      <div className="pointer-events-none absolute top-1/3 left-1/4 w-64 h-64 rounded-full bg-amber-300/15 blur-3xl anim-orb" style={{ animationDelay: '-10s' }} />

      <div className="relative w-full max-w-3xl anim-pop">
        {/* الشعار */}
        <div className="text-center mb-6">
          <div className="anim-float inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur text-white mb-3 shadow-2xl">
            <Store size={32} />
          </div>
          <h1 className="text-3xl font-black text-white">أهلاً بك في «تَحَكَّم» — TAHAKAM ERP</h1>
          <p className="text-white/70 mt-1">نظام إدارة المحلات والمحاسبة — يكبر معك</p>
        </div>

        {/* مؤشر الخطوات المسمّى */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {STEPS.map((s) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold transition-all duration-500 ${
                    s.n < step ? 'bg-emerald-400 text-white scale-90 rotate-[360deg]' : s.n === step ? 'bg-white text-brand-600 scale-110 shadow-lg anim-glow' : 'bg-white/20 text-white/60'
                  }`}
                >
                  {s.n < step ? <Check size={16} /> : s.icon}
                </div>
                <span className={`text-[10px] font-bold transition-colors duration-300 ${s.n === step ? 'text-white' : 'text-white/50'}`}>{s.label}</span>
              </div>
              {s.n < STEPS.length && <div className={`w-10 h-1 rounded-full mb-4 transition-all duration-500 ${s.n < step ? 'bg-emerald-400' : 'bg-white/20'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-card-dark rounded-3xl shadow-2xl p-6 md:p-8">
          {/* الخطوة 1: البلد — قائمة منسدلة احترافية + بطاقة معاينة */}
          {step === 1 && (
            <div key="s1" className="anim-wizard-step">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <Globe2 size={20} className="text-brand-500" /> اختر بلدك
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                سنضبط العملة والكسور والضريبة تلقائياً — <b className="text-amber-600">البلد يُقفل بعد الإعداد</b> ولا يغيّره إلا الدعم الفني
              </p>
              <div className="max-w-md mx-auto space-y-4">
                <select value={countryCode} onChange={(e) => { setCountryCode(e.target.value); setCity(''); setCustomCity('') }} className={`${inputCls} !text-base font-bold`}>
                  <option value="">— اختر البلد —</option>
                  {ARAB_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.nameAr} — {c.currency.name}</option>
                  ))}
                </select>
                {country && (
                  <div className="anim-pop p-4 rounded-2xl bg-gradient-to-l from-brand-500/10 to-fuchsia-500/10 border border-brand-500/20 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl anim-float">{country.flag}</span>
                      <div>
                        <div className="font-black text-lg text-slate-800 dark:text-white">{country.nameAr}</div>
                        <div className="text-[11px] text-slate-400">تم ضبط الإعدادات المحلية تلقائياً</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                      <div className="p-2 rounded-xl bg-white/60 dark:bg-slate-800/60"><div className="text-slate-400">العملة</div><b>{country.currency.name} ({country.currency.symbol})</b></div>
                      <div className="p-2 rounded-xl bg-white/60 dark:bg-slate-800/60"><div className="text-slate-400">الكسور</div><b>{country.currency.decimals} خانات</b></div>
                      <div className="p-2 rounded-xl bg-white/60 dark:bg-slate-800/60"><div className="text-slate-400">الضريبة</div><b>{country.vatPercent > 0 ? `${country.vatPercent}٪` : 'بدون'}</b></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* الخطوة 2: النشاط — قائمة منسدلة + معاينة الوحدات والخصائص */}
          {step === 2 && (
            <div key="s2" className="anim-wizard-step">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">ما نشاطك التجاري؟ 🏪</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                النشاط يحدد الأقسام والشاشات الظاهرة — الأقسام الإضافية يفعّلها الدعم الفني في رخصتك
              </p>
              <div className="max-w-md mx-auto space-y-4">
                <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={`${inputCls} !text-base font-bold`}>
                  <option value="">— اختر النشاط —</option>
                  {ACTIVITY_TEMPLATES.map((a) => (
                    <option key={a.id} value={a.id}>{a.icon} {a.nameAr}</option>
                  ))}
                </select>
                {activity && (
                  <div className="anim-pop p-4 rounded-2xl bg-brand-500/5 border border-brand-500/20">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-4xl anim-float">{activity.icon}</span>
                      <div>
                        <div className="font-black text-slate-800 dark:text-white">{activity.nameAr}</div>
                        <div className="text-[11px] text-slate-400 leading-relaxed">{activity.description}</div>
                      </div>
                    </div>
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
            </div>
          )}

          {/* الخطوة 3: السنة المالية */}
          {step === 3 && (
            <div key="s3" className="anim-wizard-step">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <CalendarRange size={20} className="text-brand-500" /> افتح سنتك المالية 📅
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                كل القيود والفواتير ستُسجَّل داخل هذه السنة. اختر السنة الحالية، أو سنة سابقة إن كنت ستُدخل عمليات قديمة — ويمكنك فتح سنوات أخرى لاحقاً.
              </p>
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
                  <input value={fyName} onChange={(e) => setFyName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">بداية السنة</label>
                  <input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">نهاية السنة</label>
                  <input type="date" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} className={inputCls} />
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

          {/* الخطوة 4: بيانات المنشأة — الإلزامية بطلب المالك */}
          {step === 4 && (
            <div key="s4" className="anim-wizard-step">
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <Building2 size={20} className="text-brand-500" /> بيانات المنشأة والمالك
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                كل الحقول هنا إلزامية — البيانات الضريبية اختيارية وتُضاف لاحقاً من شاشة الفاتورة الإلكترونية
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">اسم المنشأة / المحل *</label>
                  <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="مثال: أسواق البركة" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">اسم المالك *</label>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="مثال: محمد عبده" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">رقم الهاتف *</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" className={`${inputCls} ${phone && !isValidPhone(phone) ? '!border-rose-400' : ''}`} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">البريد الإلكتروني *</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" dir="ltr" className={`${inputCls} ${email && !isValidEmail(email) ? '!border-rose-400' : ''}`} />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">البلد (ثابت من الإعداد)</label>
                  <div className={`${inputCls} bg-slate-50 dark:bg-slate-800/50 cursor-not-allowed flex items-center gap-2 font-bold`}>
                    <span>{country?.flag}</span> {country?.nameAr} <span className="ms-auto text-amber-500">🔒</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">المدينة *</label>
                  {cities.length > 0 ? (
                    <select value={city} onChange={(e) => setCity(e.target.value)} className={inputCls}>
                      <option value="">— اختر المدينة —</option>
                      {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__other__">أخرى…</option>
                    </select>
                  ) : (
                    <input value={customCity} onChange={(e) => { setCustomCity(e.target.value); setCity('__other__') }} placeholder="اكتب المدينة" className={inputCls} />
                  )}
                  {city === '__other__' && cities.length > 0 && (
                    <input value={customCity} onChange={(e) => setCustomCity(e.target.value)} placeholder="اكتب اسم المدينة" className={`${inputCls} mt-2 anim-pop`} />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">الشارع / الحي *</label>
                  <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="مثال: شارع الجمهورية — حي السلام" className={inputCls} />
                </div>
              </div>
              <div className="max-w-xl mx-auto mt-4 space-y-3">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                  <Crown size={18} className="text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    <b>دور المالك محمي بنيوياً:</b> كل الصلاحيات بلا استثناء، ولا يستطيع أي مستخدم آخر تقليصها أو حذف الحساب أو تعطيله.
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-sky-500/5 border border-sky-500/15 text-[11px] font-bold text-sky-600 dark:text-sky-400">
                  🧾 البيانات الضريبية (رقم التسجيل…) اختيارية — لكن بدونها لا يمكن إصدار فاتورة إلكترونية إذا كانت ميزتها مفعّلة في رخصتك.
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
