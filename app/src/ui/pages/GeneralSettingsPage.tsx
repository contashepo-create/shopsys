/**
 * الإعدادات العامة — البلد والعملة والضريبة وطريقة الاحتساب
 * (القرارات 6 — كل قيم البلد قابلة للتعديل اليدوي)
 */
import { useState } from 'react'
import { Percent, Globe2, RefreshCcw, ShieldAlert } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { ARAB_COUNTRIES, getCountry } from '../../core/countries.ts'
import { ACTIVITY_TEMPLATES, FEATURE_LABELS, MODULE_LABELS, ALL_MODULES } from '../../core/activities.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

export function GeneralSettingsPage() {
  const { setup, resetSetup, toggleModule } = useAppStore()
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const activity = ACTIVITY_TEMPLATES.find((a) => a.id === setup.activityId)
  const [vat, setVat] = useState(String(setup.vatPercent))
  const [taxInclusive, setTaxInclusive] = useState(setup.taxInclusive)

  const saveTax = () => {
    useAppStore.setState((s) => ({
      setup: { ...s.setup, vatPercent: Number(vat) || 0, taxInclusive },
    }))
    toast.show('تم حفظ إعدادات الضريبة')
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* البلد والعملة */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5">
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <Globe2 size={17} className="text-sky-500" /> البلد والعملة
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
            <div className="text-[11px] text-slate-400 mb-1">البلد</div>
            <div className="font-bold text-slate-800 dark:text-white">{country ? `${country.flag} ${country.nameAr}` : '—'}</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
            <div className="text-[11px] text-slate-400 mb-1">العملة</div>
            <div className="font-bold text-slate-800 dark:text-white">{country?.currency.name} ({country?.currency.symbol})</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
            <div className="text-[11px] text-slate-400 mb-1">الكسور العشرية</div>
            <div className="font-bold text-slate-800 dark:text-white">{country?.currency.decimals} خانات</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            تغيير البلد يعيد معالج أول التشغيل (البيانات محفوظة).
          </p>
          <Btn variant="ghost" onClick={() => { resetSetup(); }}>
            <span className="flex items-center gap-1.5 text-xs"><RefreshCcw size={13} /> تغيير البلد/النشاط</span>
          </Btn>
        </div>
      </section>

      {/* الضريبة */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '80ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <Percent size={17} className="text-emerald-500" /> الضريبة ({country?.taxName ?? 'ضريبة القيمة المضافة'})
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="النسبة ٪" hint="قابلة للتعديل دائماً — الضرائب تتغير بقرارات حكومية">
            <input value={vat} onChange={(e) => setVat(e.target.value)} type="number" min={0} max={50} className={inputCls} />
          </Field>
          <Field label="طريقة الاحتساب في الأسعار (القرار 6)">
            <div className="flex gap-2">
              {([[true, 'شامل الضريبة'], [false, 'تُضاف في الفاتورة']] as const).map(([val, label]) => (
                <button
                  key={String(val)}
                  onClick={() => setTaxInclusive(val)}
                  className={`flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold border-2 transition-all duration-200 hover:scale-[1.02] ${
                    taxInclusive === val
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex justify-end mt-4"><Btn onClick={saveTax}>حفظ إعدادات الضريبة</Btn></div>
      </section>

      {/* الأرصدة السالبة (طلب المالك) — النظام كله يحترم هذين المفتاحين */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '120ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <ShieldAlert size={17} className="text-rose-500" /> الأرصدة السالبة
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          الافتراضي: ممنوع — أي عملية ستجعل رصيد خزينة/بنك أو صنفٍ سالباً تُرفض برسالة واضحة قبل أي كتابة.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ['allowNegativeTreasury', '🏦 السماح بالرصيد السالب في الخزائن والبنوك', 'صرف/تحويل/شراء أكبر من رصيد الخزينة — مفيد لو تسجل متأخراً وتضبط لاحقاً'],
            ['allowNegativeStock', '📦 السماح بالبيع برصيد مخزون سالب', 'بيع صنف كميته صفر — الجرد القادم يصحح الفارق'],
          ] as const).map(([key, label, hint]) => {
            const on = setup[key]
            return (
              <button
                key={key}
                onClick={() => {
                  useAppStore.setState((s) => ({ setup: { ...s.setup, [key]: !s.setup[key] } }))
                  toast.show(!on ? '⚠️ سُمح بالرصيد السالب — استخدمه بوعي' : 'مُنع الرصيد السالب — النظام يرفض أي عملية تكسره ✓')
                }}
                className={`text-right p-4 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.01] ${
                  on ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-bold text-[13px] ${on ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>{label}</span>
                  <span className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${on ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                    <span className={`block w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${on ? '-translate-x-4.5' : ''}`} />
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1.5">{hint}</div>
                <div className={`text-[10.5px] font-bold mt-1 ${on ? 'text-amber-600' : 'text-emerald-600'}`}>{on ? 'مسموح حالياً' : 'ممنوع (مُوصى به)'}</div>
              </button>
            )
          })}
        </div>
      </section>

      {/* النشاط والوحدات */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '160ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-4">النشاط والوحدات المفعّلة</h3>
        <div className="flex items-center gap-3 mb-4 p-3.5 rounded-xl bg-brand-500/5 border border-brand-500/15">
          <span className="text-2xl">{activity?.icon}</span>
          <div>
            <div className="font-bold text-slate-800 dark:text-white text-sm">{activity?.nameAr}</div>
            <div className="text-[11px] text-slate-400">{activity?.description}</div>
          </div>
        </div>
        {/* مفاتيح تفعيل/إلغاء الوحدات — طلب المالك: الوحدات تتبع النشاط وتُبدَّل من هنا */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {ALL_MODULES.map((m) => {
            const on = setup.modules.includes(m)
            const info = MODULE_LABELS[m]
            return (
              <button
                key={m}
                onClick={() => {
                  try {
                    toggleModule(m)
                    toast.show(on ? `أُطفئت وحدة ${info.nameAr} — اختفت شاشاتها من القائمة` : `فُعِّلت وحدة ${info.nameAr} ✅`)
                  } catch (e) {
                    toast.show((e as Error).message, 'error')
                  }
                }}
                className={`group flex items-center gap-3 p-3 rounded-xl border-2 text-right transition-all duration-200 ${
                  on
                    ? 'border-emerald-400/60 bg-emerald-500/5'
                    : 'border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-100'
                }`}
              >
                <span className="text-xl transition-transform duration-200 group-hover:scale-125">{info.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[13px] text-slate-800 dark:text-white">{info.nameAr}</span>
                  <span className="block text-[10.5px] text-slate-400 truncate">{info.desc}</span>
                </span>
                <span
                  className={`shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200 ${on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${on ? 'right-0.5' : 'right-4'}`} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {setup.features.map((f) => (
            <span key={f} className="text-[11px] px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
              {FEATURE_LABELS[f].icon} {FEATURE_LABELS[f].nameAr}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          💡 إطفاء الوحدة يخفي شاشاتها فوراً دون حذف بياناتها — أعد تفعيلها فتعود كما كانت.
          الخصائص (البنفسجية) افتراضيات النشاط — كل خاصية تُفعَّل لأي قسم أو صنف من شاشة الأصناف (القرار 5).
        </p>
      </section>

      {/* اختيار بلد آخر يدوياً */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '240ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-3 text-sm">تبديل سريع للبلد (يضبط العملة والضريبة)</h3>
        <div className="flex flex-wrap gap-1.5">
          {ARAB_COUNTRIES.map((c) => (
            <button
              key={c.code}
              onClick={() => {
                useAppStore.setState((s) => ({
                  setup: { ...s.setup, countryCode: c.code, vatPercent: c.vatPercent },
                }))
                setVat(String(c.vatPercent))
                toast.show(`تم التبديل إلى ${c.nameAr} — ${c.currency.name}`)
              }}
              className={`px-2.5 py-1.5 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 hover:scale-105 ${
                setup.countryCode === c.code
                  ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              {c.flag} {c.nameAr}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
