/**
 * الإعدادات العامة — البلد والعملة والضريبة وطريقة الاحتساب
 * (القرارات 6 — كل قيم البلد قابلة للتعديل اليدوي)
 */
import { useState } from 'react'
import { Percent, Globe2, ShieldAlert, Warehouse, CalendarCheck2, Lock } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { ARAB_COUNTRIES, getCountry } from '../../core/countries.ts'
import { ACTIVITY_TEMPLATES, FEATURE_LABELS, MODULE_LABELS, ALL_MODULES } from '../../core/activities.ts'
import { suggestFiscalYear, validateFiscalYear, validateYearClose } from '../../core/fiscal.ts'
import { formatMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast } from '../components/ui.tsx'

export function GeneralSettingsPage() {
  const { setup, fiscalYears, addFiscalYear, markFiscalYearClosed } = useAppStore()
  const { warehouses, closeFiscalYear } = useDataStore()
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const activity = ACTIVITY_TEMPLATES.find((a) => a.id === setup.activityId)
  const [vat, setVat] = useState(String(setup.vatPercent))
  const [taxInclusive, setTaxInclusive] = useState(setup.taxInclusive)
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* ─── إقفال السنة المالية (منهجية QuickBooks/Xero — طلب المالك) ─── */
  const [closeTarget, setCloseTarget] = useState<(typeof fiscalYears)[number] | null>(null)
  const [newYearOpen, setNewYearOpen] = useState(false)
  const nextSuggested = suggestFiscalYear(new Date().getFullYear() + (fiscalYears.some((y) => y.nameAr === String(new Date().getFullYear())) ? 1 : 0))
  const [fyName, setFyName] = useState(nextSuggested.nameAr)
  const [fyStart, setFyStart] = useState(nextSuggested.startDate)
  const [fyEnd, setFyEnd] = useState(nextSuggested.endDate)
  const doCloseYear = () => {
    if (!closeTarget) return
    try {
      const { netProfitMinor } = closeFiscalYear(closeTarget, fiscalYears)
      markFiscalYearClosed(closeTarget.id)
      toast.show(`أُقفلت سنة «${closeTarget.nameAr}» — صافي ${netProfitMinor >= 0 ? 'الربح' : 'الخسارة'} ${fmt(Math.abs(netProfitMinor))} ${cur.symbol} رُحّل للأرباح المرحلة ✅`)
      setCloseTarget(null)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }
  const saveNewYear = () => {
    const errors = validateFiscalYear({ nameAr: fyName, startDate: fyStart, endDate: fyEnd }, fiscalYears)
    if (errors.length) return toast.show(errors[0], 'error')
    addFiscalYear({ nameAr: fyName.trim(), startDate: fyStart, endDate: fyEnd })
    toast.show(`فُتحت السنة المالية «${fyName}» ✅`)
    setNewYearOpen(false)
  }

  const [specialty, setSpecialty] = useState(setup.doctorSpecialty ?? '')
  const saveSpecialty = () => {
    useAppStore.setState((s) => ({ setup: { ...s.setup, doctorSpecialty: specialty.trim() } }))
    toast.show('تم حفظ تخصص العيادة ✅')
  }

  const saveTax = () => {
    useAppStore.setState((s) => ({
      setup: { ...s.setup, vatPercent: Number(vat) || 0, taxInclusive },
    }))
    toast.show('تم حفظ إعدادات الضريبة')
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* تخصص العيادة — نشاط العيادة فقط (طلب المالك: التخصص يختاره المالك لا يُفرض) */}
      {setup.activityId === 'clinic' && (
        <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
            🩺 تخصص العيادة
          </h3>
          <p className="text-[11px] text-slate-400 mb-3">يظهر في الروشتة تحت اسم الطبيب وفي مطبوعات العيادة — اكتبه كما تحب (نفسي، جلدية، أسنان…)</p>
          <div className="flex gap-2">
            <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} className={inputCls} placeholder="مثال: جلدية وتجميل" />
            <Btn onClick={saveSpecialty}>حفظ</Btn>
          </div>
        </section>
      )}

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
        {/* أمر المالك: البلد يُقفل بعد أول إعداد — لا يغيّره المستخدم ولا المدير، المطوّر فقط عبر البوت */}
        <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
          <span className="text-lg">🔒</span>
          <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
            البلد والنشاط مقفولان بعد الإعداد الأول — تغييرهما يتم عبر الدعم الفني (المطوّر) فقط.
          </p>
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

      {/* المخزن الافتراضي للفواتير (الأمر 8) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '140ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <Warehouse size={17} className="text-cyan-500" /> المخزن الافتراضي للفواتير
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          يظهر مُختاراً تلقائياً أعلى فاتورة البيع (الكاشير) وفاتورة الشراء — ويمكن تغييره لكل فاتورة.
          «مخزن غير محدد» يعامل حركته على المخزن الرئيسي.
        </p>
        <div className="max-w-sm">
          <select
            value={setup.defaultWarehouseId ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              useAppStore.setState((s) => ({ setup: { ...s.setup, defaultWarehouseId: v } }))
              toast.show('حُفظ المخزن الافتراضي ✓')
            }}
            className={inputCls}
          >
            <option value="">🏬 مخزن غير محدد</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>🏬 {w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
          </select>
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
        {/* سياسة الأقسام (أمر المالك): المستخدم لا يضيف/يحذف أقساماً —
            الافتراضية تتبع النشاط، والإضافي يفعّله المطوّر فقط عبر البوت بمفتاح موقَّع */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {ALL_MODULES.filter((m) => setup.modules.includes(m) || activity?.modules.includes(m)).map((m) => {
            const on = setup.modules.includes(m)
            const isDefault = activity?.modules.includes(m)
            const info = MODULE_LABELS[m]
            return (
              <div
                key={m}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 text-right ${
                  on ? 'border-emerald-400/60 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700 opacity-60'
                }`}
              >
                <span className="text-xl">{info.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[13px] text-slate-800 dark:text-white">{info.nameAr}</span>
                  <span className="block text-[10.5px] text-slate-400 truncate">{info.desc}</span>
                </span>
                <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg ${on ? (isDefault ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600') : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                  {on ? (isDefault ? 'أساسي للنشاط' : 'مفعّل من المطوّر') : 'غير مفعّل'}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 p-3 rounded-xl bg-sky-500/5 border border-sky-500/15 mb-4">
          <span className="text-lg">ℹ️</span>
          <p className="text-[11px] font-bold text-sky-600 dark:text-sky-400">
            الأقسام تتبع نشاطك تلقائياً — لإضافة قسم آخر تواصل مع الدعم الفني ليفعّله لك في رخصتك.
          </p>
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

      {/* السنوات المالية والإقفال السنوي (طلب المالك — منهجية عالمية) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2"><CalendarCheck2 size={16} className="text-emerald-500" /> السنوات المالية</h3>
          <Btn variant="ghost" onClick={() => setNewYearOpen(true)}>+ فتح سنة جديدة</Btn>
        </div>
        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          الإقفال السنوي (منهجية البرامج العالمية): قيد يُصفّر كل الإيرادات والمصروفات ويرحّل صافي
          الربح/الخسارة إلى «الأرباح المرحّلة» — وبعده تُقفل الفترة فلا قيود بأثر رجعي فيها.
          أرصدة العملاء والموردين والخزائن تنتقل تلقائياً (الميزانية تراكمية).
        </p>
        <div className="space-y-2">
          {fiscalYears.length === 0 && <div className="text-[12px] text-slate-400">لا سنوات مسجلة</div>}
          {fiscalYears.map((y) => {
            const closable = validateYearClose(y, fiscalYears, new Date().toISOString().slice(0, 10)).length === 0
            return (
              <div key={y.id} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5">
                <div>
                  <span className="font-black text-slate-800 dark:text-white">{y.nameAr}</span>
                  <span className="text-[11px] text-slate-400 ms-2" dir="ltr">{y.startDate} → {y.endDate}</span>
                </div>
                {y.status === 'closed' ? (
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-500 font-bold flex items-center gap-1"><Lock size={11} /> مقفلة</span>
                ) : closable ? (
                  <Btn variant="ghost" onClick={() => setCloseTarget(y)}>🔒 إقفال السنة</Btn>
                ) : (
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">مفتوحة — جارية</span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <Modal open={!!closeTarget} onClose={() => setCloseTarget(null)} title={`🔒 إقفال السنة المالية «${closeTarget?.nameAr ?? ''}»`}>
        <div className="space-y-4">
          <div className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            سيحدث الآتي (لا رجوع إلا بعكس القيد يدوياً):
            <ul className="list-disc pr-5 mt-2 space-y-1 text-[12px]">
              <li>قيد إقفال بتاريخ {closeTarget?.endDate} يصفّر كل حسابات الإيرادات والمصروفات</li>
              <li>صافي الربح/الخسارة يُرحَّل إلى «أرباح مرحّلة 3102»</li>
              <li>تُقفل الفترة: يُرفض أي قيد يدوي بتاريخ داخلها</li>
              <li>قوائم الدخل التاريخية تظل صحيحة (قيد الإقفال مستثنى منها)</li>
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setCloseTarget(null)}>تراجع</Btn>
            <Btn onClick={doCloseYear}>🔒 تأكيد الإقفال</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={newYearOpen} onClose={() => setNewYearOpen(false)} title="📅 فتح سنة مالية جديدة">
        <div className="space-y-4">
          <Field label="اسم السنة *"><input value={fyName} onChange={(e) => setFyName(e.target.value)} className={inputCls} placeholder="2027" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="من *"><input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} className={inputCls} /></Field>
            <Field label="إلى *"><input type="date" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setNewYearOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveNewYear}>💾 فتح السنة</Btn>
          </div>
        </div>
      </Modal>

      {/* البلد مقفول بعد أول تسجيل (أمر المالك) — كل الدفاتر والقيود والضرائب مبنية عليه،
          وتغييره بعد بدء العمل يفسد العملة والتقارير. التغيير للمطوّر فقط عبر البوت. */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '240ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-3 text-sm">🔒 بلد المنشأة (مقفول)</h3>
        {(() => {
          const c = ARAB_COUNTRIES.find((x) => x.code === setup.countryCode)
          return (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
              <span className="text-2xl">{c?.flag ?? '🌍'}</span>
              <div className="flex-1">
                <div className="font-black text-slate-700 dark:text-slate-200 text-[13px]">{c?.nameAr ?? 'غير محدد'} — {c?.currency.name ?? ''}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  البلد يُثبَّت عند أول تسجيل لأن كل الدفاتر والعملة والضرائب مبنية عليه.
                  لو حدث خطأ في الاختيار تواصل مع الدعم الفني — التغيير يتم من المطوّر حصراً.
                </div>
              </div>
            </div>
          )
        })()}
      </section>
    </div>
  )
}
