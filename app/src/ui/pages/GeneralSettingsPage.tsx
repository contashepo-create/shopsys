/**
 * الإعدادات العامة — البلد والعملة والضريبة وطريقة الاحتساب
 * (القرارات 6 — كل قيم البلد قابلة للتعديل اليدوي)
 */
import { useState } from 'react'
import { Percent, Globe2, ShieldAlert, Warehouse, CalendarCheck2, Lock, Gift } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { ARAB_COUNTRIES, getCountry } from '../../core/countries.ts'
import { ACTIVITY_TEMPLATES, FEATURE_LABELS, MODULE_LABELS, ALL_MODULES } from '../../core/activities.ts'
import { suggestFiscalYear, validateFiscalYear, validateYearClose, buildFiscalYearReport, type FiscalYear } from '../../core/fiscal.ts'
import { formatMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast } from '../components/ui.tsx'
import { accountName } from './accountNames.ts'

export function GeneralSettingsPage() {
  const { setup, fiscalYears, addFiscalYear, markFiscalYearClosed, loyalty, updateLoyalty } = useAppStore()
  const { warehouses, closeFiscalYear, journal } = useDataStore()
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
  /* تقرير السنة المالية (طلب المالك): مفتوحة أو مقفلة — رصيد كل حساب أول السنة + الحركة + الحالي */
  const [reportYear, setReportYear] = useState<FiscalYear | null>(null)
  const yearReport = reportYear
    ? buildFiscalYearReport(
        journal,
        reportYear,
        journal.filter((e) => e.sourceType === 'year_closing' && e.sourceId === reportYear.id).map((e) => e.id),
      )
    : null

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

      {/* سياسة الورديات (مراجعة المالك — النمط العالمي Toast/Square) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '130ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <ShieldAlert size={17} className="text-violet-500" /> سياسة الورديات
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          النمط العالمي (Toast / Square): كل بيع يُربط بوردية مفتوحة كي يُحاسَب الكاشير على العجز
          والزيادة عند الإقفال — بيع بلا وردية = نقدية بلا مسؤول عنها. عطّله فقط لو تعمل وحدك.
        </p>
        {(() => {
          const on = setup.requireOpenShiftForSales
          return (
            <button
              onClick={() => {
                useAppStore.setState((s) => ({ setup: { ...s.setup, requireOpenShiftForSales: !s.setup.requireOpenShiftForSales } }))
                toast.show(!on ? 'أصبح فتح الوردية إلزامياً قبل أي بيع ✓' : '⚠️ سُمح بالبيع بلا وردية — الفواتير ستُسجل «بلا وردية» ولن تدخل محاسبة الدرج')
              }}
              className={`w-full sm:w-auto text-right p-4 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.01] ${
                on ? 'border-violet-500/50 bg-violet-500/10' : 'border-amber-500/50 bg-amber-500/10'
              }`}
            >
              <div className="flex items-center justify-between gap-6">
                <span className={`font-bold text-[13px] ${on ? 'text-violet-700 dark:text-violet-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  ⏱️ منع البيع بلا وردية مفتوحة
                </span>
                <span className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${on ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`block w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${on ? '-translate-x-4.5' : ''}`} />
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                عند التفعيل: شاشة الكاشير ترفض إتمام أي فاتورة حتى تُفتح وردية بعهدة افتتاحية
              </div>
              <div className={`text-[10.5px] font-bold mt-1 ${on ? 'text-violet-600' : 'text-amber-600'}`}>{on ? 'إلزامي (مُوصى به)' : 'غير إلزامي — البيع بلا وردية مسموح'}</div>
            </button>
          )
        })()}
      </section>

      {/* برنامج نقاط الولاء (نمط Lightspeed Loyalty / Square) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '135ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <Gift size={17} className="text-pink-500" /> برنامج نقاط الولاء
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          النمط العالمي (Lightspeed / Square): العميل المسجل يكسب نقاطاً تلقائياً من كل فاتورة،
          ويستبدلها برصيد دائن في حسابه يُخصم من مشترياته القادمة. الكسب يُقرَّب لأسفل — لا أنصاف نقاط.
        </p>
        <div className="space-y-4">
          <button
            onClick={() => {
              updateLoyalty({ enabled: !loyalty.enabled })
              toast.show(!loyalty.enabled ? 'فُعّل برنامج الولاء — العملاء المسجلون يكسبون نقاطاً من الآن ✓' : 'أُوقف برنامج الولاء — النقاط المكتسبة محفوظة')
            }}
            className={`w-full sm:w-auto text-right p-4 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.01] ${
              loyalty.enabled ? 'border-pink-500/50 bg-pink-500/10' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-6">
              <span className={`font-bold text-[13px] ${loyalty.enabled ? 'text-pink-700 dark:text-pink-400' : 'text-slate-500'}`}>
                🎁 تفعيل نقاط الولاء
              </span>
              <span className={`w-10 h-5.5 rounded-full p-0.5 transition-colors ${loyalty.enabled ? 'bg-pink-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <span className={`block w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${loyalty.enabled ? '-translate-x-4.5' : ''}`} />
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1.5">الكسب للعملاء المسجلين فقط — العميل النقدي لا يكسب نقاطاً</div>
          </button>

          {loyalty.enabled && (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={`نقاط لكل ${cur.symbol} من الفاتورة`} hint="الافتراضي العالمي: 1 نقطة لكل وحدة عملة">
                <input
                  value={String(loyalty.pointsPerUnit)} dir="ltr" className={inputCls}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) updateLoyalty({ pointsPerUnit: v }) }}
                />
              </Field>
              <Field label={`قيمة النقطة عند الاستبدال (${cur.decimals === 3 ? 'فلس' : 'قرش/هللة'})`} hint={`5 = كل 100 نقطة تساوي ${fmt(500)} ${cur.symbol}`}>
                <input
                  value={String(loyalty.redeemValueMinor)} dir="ltr" className={inputCls}
                  onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 0) updateLoyalty({ redeemValueMinor: v }) }}
                />
              </Field>
              <Field label="أدنى نقاط للاستبدال" hint="منع استبدال الفتات — الافتراضي 100">
                <input
                  value={String(loyalty.minRedeemPoints)} dir="ltr" className={inputCls}
                  onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 0) updateLoyalty({ minRedeemPoints: v }) }}
                />
              </Field>
            </div>
            {/* الشرح الديناميكي (طلب المالك): يتحدث مع الأرقام — مثال حي يتغير فور تعديل أي خانة */}
            {(() => {
              const sample = 100 * 10 ** cur.decimals // فاتورة افتراضية: 100 وحدة عملة
              const earned = Math.floor((sample / 10 ** cur.decimals) * loyalty.pointsPerUnit)
              const redeemAll = earned * loyalty.redeemValueMinor
              const minValue = loyalty.minRedeemPoints * loyalty.redeemValueMinor
              const invoicesToMin = loyalty.pointsPerUnit > 0 && earned > 0 ? Math.ceil(loyalty.minRedeemPoints / earned) : 0
              return (
                <div className="p-4 rounded-2xl bg-pink-500/5 border border-pink-500/20 space-y-2">
                  <div className="text-[12px] font-black text-pink-700 dark:text-pink-300">📖 كيف تعمل إعداداتك الحالية؟ (مثال حي يتحدث مع أرقامك)</div>
                  <ul className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1.5 pr-4 list-disc">
                    <li>
                      عميل مسجل يشتري بفاتورة <b>{fmt(sample)} {cur.symbol}</b> ⇒ يكسب فوراً <b className="text-pink-600">{earned.toLocaleString('ar-EG')} نقطة</b>
                      {' '}({loyalty.pointsPerUnit} نقطة × {fmt(sample)} {cur.symbol} — الكسر يُقرَّب لأسفل).
                    </li>
                    <li>
                      لو استبدل هذه النقاط كلها يحصل على خصم <b className="text-emerald-600">{fmt(redeemAll)} {cur.symbol}</b>
                      {' '}(كل نقطة = {loyalty.redeemValueMinor} {cur.decimals === 3 ? 'فلس' : 'قرش/هللة'}).
                    </li>
                    <li>
                      لا يستطيع الاستبدال قبل جمع <b>{loyalty.minRedeemPoints.toLocaleString('ar-EG')} نقطة</b>
                      {' '}(= خصم {fmt(minValue)} {cur.symbol}){invoicesToMin > 1 ? <> — أي بعد نحو <b>{invoicesToMin.toLocaleString('ar-EG')} فواتير</b> بحجم المثال</> : null}.
                    </li>
                    <li className="text-slate-400">
                      محاسبياً: الاستبدال قيد تلقائي — مصروف برنامج الولاء (5115) مديناً / ذمم العملاء (1104) دائناً. لا شيء يدوي.
                    </li>
                  </ul>
                </div>
              )
            })()}
            </>
          )}
        </div>
      </section>

      {/* المخزن الافتراضي للفواتير (الأمر 8) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '140ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <Warehouse size={17} className="text-cyan-500" /> المخزن الافتراضي للفواتير
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          يظهر مُختاراً تلقائياً أعلى فاتورة البيع (الكاشير) وفاتورة الشراء — ويمكن تغييره لكل فاتورة.
          لا يوجد اختيار مبهم: اختر مخزناً محدداً، وفاتورة الشراء يمكنها التحديد لكل سطر عند الحاجة.
        </p>
        <div className="max-w-sm">
          <select
            value={setup.defaultWarehouseId ?? warehouses.find((w) => w.isMain)?.id ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              useAppStore.setState((s) => ({ setup: { ...s.setup, defaultWarehouseId: v } }))
              toast.show('حُفظ المخزن الافتراضي ✓')
            }}
            className={inputCls}
          >
            {warehouses.length === 0 && <option value="">لا توجد مخازن</option>}
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
                <div className="flex items-center gap-2">
                  <Btn variant="ghost" onClick={() => setReportYear(y)}>📊 تقرير السنة</Btn>
                  {y.status === 'closed' ? (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-500 font-bold flex items-center gap-1"><Lock size={11} /> مقفلة</span>
                  ) : closable ? (
                    <Btn variant="ghost" onClick={() => setCloseTarget(y)}>🔒 إقفال السنة</Btn>
                  ) : (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">مفتوحة — جارية</span>
                  )}
                </div>
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

      {/* تقرير السنة المالية (طلب المالك): رصيد كل حساب أول السنة + حركة الفترة + الرصيد الحالي/الختامي */}
      <Modal open={!!reportYear} onClose={() => setReportYear(null)} title={`📊 تقرير السنة المالية «${reportYear?.nameAr ?? ''}» — ${reportYear?.status === 'closed' ? 'مقفلة' : 'مفتوحة'}`} wide>
        {reportYear && yearReport && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-3.5">
                <div className="text-[10.5px] font-bold text-emerald-600">إيرادات الفترة</div>
                <div className="text-lg font-black text-emerald-700 dark:text-emerald-300 mt-0.5">{fmt(yearReport.totalRevenueMinor)} {cur.symbol}</div>
              </div>
              <div className="rounded-2xl bg-rose-500/10 border border-rose-500/25 p-3.5">
                <div className="text-[10.5px] font-bold text-rose-600">مصروفات الفترة</div>
                <div className="text-lg font-black text-rose-700 dark:text-rose-300 mt-0.5">{fmt(yearReport.totalExpenseMinor)} {cur.symbol}</div>
              </div>
              <div className={`rounded-2xl p-3.5 border ${yearReport.netProfitMinor >= 0 ? 'bg-sky-500/10 border-sky-500/25' : 'bg-amber-500/10 border-amber-500/25'}`}>
                <div className="text-[10.5px] font-bold text-slate-500">صافي {yearReport.netProfitMinor >= 0 ? 'الربح' : 'الخسارة'}</div>
                <div className="text-lg font-black text-slate-800 dark:text-white mt-0.5">{fmt(Math.abs(yearReport.netProfitMinor))} {cur.symbol}</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              لكل حساب: رصيده أول السنة (تراكمي من كل ما قبل {reportYear.startDate})، حركة الفترة، ثم الرصيد
              {reportYear.status === 'closed' ? ' الختامي (حتى نهاية السنة)' : ' الحالي'} — موجب = مدين، وبين قوسين = دائن.
            </p>
            {yearReport.rows.length === 0 ? (
              <div className="text-center text-[12px] text-slate-400 py-8">لا حركة على أي حساب في هذه السنة</div>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-right font-bold">الحساب</th>
                      <th className="px-3 py-2 text-center font-bold">رصيد أول السنة</th>
                      <th className="px-3 py-2 text-center font-bold">حركة الفترة</th>
                      <th className="px-3 py-2 text-center font-bold">{reportYear.status === 'closed' ? 'الرصيد الختامي' : 'الرصيد الحالي'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearReport.rows.map((r) => {
                      const cell = (v: number) => (v >= 0 ? fmt(v) : `(${fmt(-v)})`)
                      return (
                        <tr key={r.accountCode} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{accountName(r.accountCode)} <span className="text-[10px] text-slate-400" dir="ltr">{r.accountCode}</span></td>
                          <td className="px-3 py-2 text-center" dir="ltr">{cell(r.openingMinor)}</td>
                          <td className="px-3 py-2 text-center" dir="ltr">{cell(r.movementMinor)}</td>
                          <td className="px-3 py-2 text-center font-black" dir="ltr">{cell(r.closingMinor)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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
