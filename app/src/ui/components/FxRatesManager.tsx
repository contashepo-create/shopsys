/**
 * مدير أسعار الصرف (طلب المالك 2026-10-01) — لوحة واحدة تُستعمل في مكانين:
 * ① صفحة الإعدادات العامة (كل العملات).
 * ② نافذة منبثقة من داخل الفاتورة مفلترة تلقائياً على العملة المختارة
 *    (تُفتح بالضغط على «سعر اليوم» تحت منتقي العملة).
 *
 * المسؤولية: المالك الرئيسي فقط (صلاحية set.general الحساسة)، والحفظ أو
 * السحب من API يمران بالرقم السري دائماً — حتى للمالك نفسه (forcePin).
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, RefreshCw, Save, ArrowLeft } from 'lucide-react'
import { Btn, Field, inputCls, useToast } from './ui.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { useSupervisorApproval } from './SupervisorPinDialog.tsx'
import { getCountry } from '../../core/countries.ts'
import { formatRate } from '../../core/foreignCurrency.ts'
import {
  fetchFxRates, fxManagedCurrencies, fxRateAgeLabel, normalizeFxRatesSettings,
  parseFxRateInput, type FxRatesSettings,
} from '../../core/fxRates.ts'

export function FxRatesManager({ focusCode, onDone }: { focusCode?: string | null; onDone?: () => void }) {
  const { fxRates, fxRatesSettings, setFxRate, applyFxApiQuotes, updateFxRatesSettings, setup } = useAppStore()
  const { appUsers, currentUserId } = useDataStore()
  const toast = useToast()
  const nav = useNavigate()
  const approval = useSupervisorApproval('set.general', { forcePin: true })
  const userName = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? 'المالك'

  const book = useMemo(() => {
    const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م' }
    return cur
  }, [setup.countryCode])

  const currencies = useMemo(() => {
    const all = fxManagedCurrencies(book.code)
    if (!focusCode) return all
    const key = focusCode.toUpperCase()
    return all.filter((row) => row.code === key)
  }, [book.code, focusCode])

  /* مسوّدة التعديلات اليدوية: نص السعر كما يكتبه المستخدم لكل عملة */
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const row of currencies) initial[row.code] = fxRates[row.code] ? formatRate(fxRates[row.code].ratePpm) : ''
    return initial
  })
  const [settingsDraft, setSettingsDraft] = useState<FxRatesSettings>(() => normalizeFxRatesSettings(fxRatesSettings))
  const [busy, setBusy] = useState(false)

  const changedCodes = currencies.filter((row) => {
    const draft = (drafts[row.code] ?? '').trim()
    if (!draft) return false
    const saved = fxRates[row.code]
    return !saved || formatRate(saved.ratePpm) !== draft
  })

  const saveManual = () => {
    if (!changedCodes.length) { toast.show('لا تغييرات لتحفظها'); return }
    approval.request((approvedBy) => {
      try {
        for (const row of changedCodes) {
          const ppm = parseFxRateInput(drafts[row.code] ?? '')
          if (ppm <= 0) throw new Error(`سعر ${row.code} غير سليم`)
          setFxRate(row.code, ppm, approvedBy ?? userName)
        }
        toast.show(`حُفظ سعر ${changedCodes.length} عملة ✓ (اعتمده ${approvedBy ?? userName})`)
        onDone?.()
      } catch (error) { toast.show((error as Error).message, 'error') }
    })
  }

  const saveSettings = () => {
    approval.request((approvedBy) => {
      updateFxRatesSettings({ ...settingsDraft, lastRefreshError: null })
      toast.show(`حُفظت إعدادات أسعار الصرف ✓ (اعتمدها ${approvedBy ?? userName})`)
    })
  }

  const pullNow = () => {
    approval.request(async (approvedBy) => {
      setBusy(true)
      try {
        const quotes = await fetchFxRates({
          provider: settingsDraft.apiProvider,
          customUrl: settingsDraft.customUrl,
          bookCode: book.code,
          codes: (focusCode ? currencies.map((c) => c.code) : fxManagedCurrencies(book.code).map((c) => c.code)),
        })
        const applied = applyFxApiQuotes(quotes, `API (${approvedBy ?? userName})`)
        updateFxRatesSettings({ lastRefreshAt: new Date().toISOString(), lastRefreshError: null })
        toast.show(`سُحبت أسعار ${applied} عملة من المزود ✓`)
        /* حدّث المسوّدة بالأسعار الجديدة فوراً */
        setDrafts((prev) => {
          const next = { ...prev }
          for (const quote of quotes) if (next[quote.code] !== undefined) next[quote.code] = formatRate(quote.ratePpm)
          return next
        })
      } catch (error) {
        updateFxRatesSettings({ lastRefreshError: (error as Error).message })
        toast.show(`فشل السحب: ${(error as Error).message}`, 'error')
      } finally { setBusy(false) }
    })
  }

  return (
    <div className="space-y-4" data-fx-rates>
      {/* شرح طريقة الاستخدام (طلب المالك: اشرح للمستخدم طريقة الاستخدام) */}
      <div className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300" data-fx-rates-help>
        <p className="mb-1 flex items-center gap-1.5 font-bold text-sky-700 dark:text-sky-300"><Info size={14} /> كيف تُستعمل أسعار الصرف؟</p>
        <p>• السعر المحفوظ هنا هو <b>السعر الافتراضي</b> الذي يظهر تلقائياً في فاتورة البيع/الشراء المتقدمة عند التحصيل بعملة أجنبية — يمكنك تعديله داخل الفاتورة عند الحاجة، والقيد يُرحَّل دائماً بعملة الدفتر ({book.code}).</p>
        <p>• <b>يدوي</b>: اكتب السعر لكل عملة ثم «حفظ الأسعار» (يطلب الرقم السري).</p>
        <p>• <b>API</b>: اختر المزود المجاني open.er-api.com (بلا مفتاح) أو رابطك الخاص، ثم «اسحب الآن» — ويمكن ترك السحب التلقائي عند فتح الفاتورة بتحديد عدد الساعات.</p>
        <p>• التعديل والسحب مسؤولية <b>المالك الرئيسي</b> فقط — كل حفظ يوثّق اسم المعتمد ووقته.</p>
      </div>

      {/* ① جدول الأسعار اليدوي */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-card-dark">
        <p className="mb-2 text-[12.5px] font-black text-slate-700 dark:text-slate-200">
          {focusCode ? `سعر ${focusCode} مقابل ${book.code}` : `أسعار العملات مقابل ${book.code} (عملة الدفتر)`}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {currencies.map((row) => {
            const saved = fxRates[row.code]
            return (
              <div key={row.code} className="rounded-xl border border-slate-200 p-2 dark:border-slate-700" data-fx-rate-row={row.code}>
                <Field label={`${row.code} — ${row.nameAr}`} hint={`لكل 1 ${row.code}`}>
                  <input
                    className={inputCls}
                    dir="ltr"
                    inputMode="decimal"
                    data-fx-rate-input={row.code}
                    value={drafts[row.code] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.code]: e.target.value }))}
                    placeholder={`مثال 48.50 = ${row.code} يساوي كم ${book.code}`}
                  />
                </Field>
                <p className="mt-1 text-[10.5px] text-slate-500" data-fx-rate-meta={row.code}>
                  {saved ? `محفوظ ${formatRate(saved.ratePpm)} · ${fxRateAgeLabel(saved)} · ${saved.source === 'api' ? 'API' : 'يدوي'} — ${saved.updatedBy}` : 'لا سعر محفوظ بعد'}
                </p>
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span data-fx-save>
            <Btn onClick={saveManual} disabled={!changedCodes.length || busy}>
              <span className="flex items-center gap-1.5"><Save size={14} /> حفظ الأسعار{changedCodes.length ? ` (${changedCodes.length})` : ''} — بالرقم السري</span>
            </Btn>
          </span>
          {onDone && <Btn variant="ghost" onClick={onDone}>تم</Btn>}
        </div>
      </div>

      {/* ② إعدادات المصدر (يدوي/API) */}
      {!focusCode && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-card-dark" data-fx-source-settings>
          <p className="mb-2 text-[12.5px] font-black text-slate-700 dark:text-slate-200">مصدر الأسعار: يدوي أم API؟</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="الطريقة">
              <select
                className={inputCls}
                data-fx-mode
                value={settingsDraft.mode}
                onChange={(e) => setSettingsDraft((prev) => ({ ...prev, mode: e.target.value as 'manual' | 'api' }))}
              >
                <option value="manual">يدوي — أكتب الأسعار بنفسي</option>
                <option value="api">API — سحب تلقائي</option>
              </select>
            </Field>
            {settingsDraft.mode === 'api' && (
              <>
                <Field label="المزود">
                  <select
                    className={inputCls}
                    data-fx-provider
                    value={settingsDraft.apiProvider}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, apiProvider: e.target.value as 'erapi' | 'custom' }))}
                  >
                    <option value="erapi">open.er-api.com (مجاني بلا مفتاح)</option>
                    <option value="custom">رابط مخصص</option>
                  </select>
                </Field>
                {settingsDraft.apiProvider === 'custom' && (
                  <Field label="الرابط المخصص" hint="يعيد { rates: { USD: 0.02 } } بأساس عملة الدفتر — {BASE} يُستبدل تلقائياً">
                    <input className={inputCls} dir="ltr" data-fx-custom-url value={settingsDraft.customUrl} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, customUrl: e.target.value }))} placeholder="https://…/latest/{BASE}" />
                  </Field>
                )}
                <Field label="سحب تلقائي كل (ساعات)" hint="0 = لا سحب تلقائي عند فتح الفاتورة">
                  <input className={inputCls} dir="ltr" type="number" min={0} max={168} data-fx-auto-hours value={settingsDraft.autoRefreshHours} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, autoRefreshHours: Number(e.target.value) || 0 }))} />
                </Field>
              </>
            )}
          </div>
          {fxRatesSettings.lastRefreshAt && (
            <p className="mt-1 text-[10.5px] text-slate-500">آخر سحب ناجح: {fxRateAgeLabel({ ratePpm: 0, updatedAt: fxRatesSettings.lastRefreshAt, updatedBy: '', source: 'api' })}{fxRatesSettings.lastRefreshError ? ` · آخر خطأ: ${fxRatesSettings.lastRefreshError}` : ''}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span data-fx-save-settings>
              <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700" onClick={saveSettings} disabled={busy}>
                <span className="flex items-center gap-1.5"><Save size={14} /> حفظ الإعدادات — بالرقم السري</span>
              </Btn>
            </span>
            {settingsDraft.mode === 'api' && (
              <span data-fx-pull>
                <Btn onClick={pullNow} disabled={busy}>
                  <span className="flex items-center gap-1.5"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'جارٍ السحب…' : 'اسحب الآن — بالرقم السري'}</span>
                </Btn>
              </span>
            )}
          </div>
        </div>
      )}

      {/* من النافذة المنبثقة: الطريق إلى الإعدادات الكاملة */}
      {focusCode && (
        <button
          type="button"
          className="flex items-center gap-1.5 text-[12px] font-bold text-brand-600 hover:underline"
          data-fx-open-full
          onClick={() => { onDone?.(); nav('/settings/general') }}
        >
          <ArrowLeft size={13} /> إعدادات أسعار الصرف الكاملة (كل العملات ومصدر API)
        </button>
      )}

      {approval.dialog}
    </div>
  )
}
