/**
 * الترخيص (المرحلة 5) — Ed25519 (القرار 4):
 * معرف الجهاز يُرسَل للمطوّر → يصدر مفتاحاً موقّعاً بمفتاحه الخاص →
 * التطبيق يتحقق بالمفتاح العام المضمّن. الميزات الحساسة (الفاتورة
 * الإلكترونية — قرار 21) لا تعمل إلا إن حملها المفتاح.
 */
import { useMemo, useState } from 'react'
import { ShieldCheck, KeyRound, Copy, Fingerprint, CalendarClock, Sparkles, AlertTriangle, XCircle } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import {
  evaluateLicense, verifyLicenseKey, hasFeature, effectiveLimits, PLAN_LABELS, FEATURE_LABELS, TRIAL_DAYS,
  type LicenseFeature,
} from '../../core/license.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

const ALL_FEATURES: LicenseFeature[] = ['einvoice_eg', 'einvoice_sa', 'multi_branch', 'telegram_bot']

export function LicensePage() {
  const { deviceId, trialStartedAt, lastSeenAt, activatedPayload, setActivated, clearActivation } = useAppStore()
  const toast = useToast()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)

  const state = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() }),
    [activatedPayload, trialStartedAt, lastSeenAt],
  )

  const copyDevice = async () => {
    try { await navigator.clipboard.writeText(deviceId); toast.show('نُسخ معرف الجهاز — أرسله للمطوّر 📋') }
    catch { toast.show('تعذّر النسخ — انسخه يدوياً', 'error') }
  }

  const activate = async () => {
    setBusy(true)
    try {
      const payload = await verifyLicenseKey(keyInput, deviceId)
      setActivated(keyInput.trim(), payload)
      setKeyInput('')
      toast.show(`تم التفعيل — خطة ${PLAN_LABELS[payload.plan]} ✅`)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  const statusBadge = () => {
    switch (state.status) {
      case 'active':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[12px]"><ShieldCheck size={13} /> مفعّل — {PLAN_LABELS[state.payload.plan]}{state.daysLeft != null ? ` (${state.daysLeft} يوماً متبقياً)` : ' (مدى الحياة)'}</span>
      case 'trial':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/10 text-sky-600 font-bold text-[12px]"><CalendarClock size={13} /> تجربة — {state.daysLeft} من {TRIAL_DAYS} يوماً متبقية</span>
      case 'trial_expired':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold text-[12px]"><AlertTriangle size={13} /> انتهت التجربة — فعّل بمفتاح</span>
      case 'expired':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 font-bold text-[12px]"><XCircle size={13} /> انتهى الاشتراك ({state.payload.expiresAt})</span>
      case 'clock_tampered':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 font-bold text-[12px]"><AlertTriangle size={13} /> اكتُشف إرجاع ساعة الجهاز</span>
      default:
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 font-bold text-[12px]"><XCircle size={13} /> غير صالح</span>
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="anim-up space-y-4">
        {/* الحالة */}
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
              <ShieldCheck size={17} className="text-slate-500" /> حالة الترخيص
            </div>
            {statusBadge()}
          </div>

          <Field label="معرف هذا الجهاز" hint="أرسله للمطوّر ليصدر لك مفتاح تفعيل مربوطاً به">
            <div className="flex gap-2">
              <input value={deviceId} readOnly className={`${inputCls} font-mono !text-[15px] font-bold tracking-wider`} dir="ltr" />
              <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 shrink-0" onClick={copyDevice}><Copy size={14} /> نسخ</Btn>
            </div>
          </Field>

          {activatedPayload ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-slate-400">العميل</span><b>{activatedPayload.customer || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">الخطة</span><b>{PLAN_LABELS[activatedPayload.plan]}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">تاريخ الإصدار</span><b dir="ltr">{activatedPayload.issuedAt}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">ينتهي في</span><b dir="ltr">{activatedPayload.expiresAt ?? 'مدى الحياة'}</b></div>
              {(() => {
                const lim = effectiveLimits(activatedPayload)
                return (
                  <>
                    <div className="flex justify-between"><span className="text-slate-400">المستخدمون</span><b>{lim.maxUsers}{activatedPayload.extraUsers ? ` (منهم ${activatedPayload.extraUsers} إضافي من البوت)` : ''}</b></div>
                    <div className="flex justify-between"><span className="text-slate-400">الفروع</span><b>{lim.maxBranches}{activatedPayload.extraBranches ? ` (منها ${activatedPayload.extraBranches} إضافي من البوت)` : ''}</b></div>
                    <div className="flex justify-between"><span className="text-slate-400">نسخ متعددة على الشبكة (ERP)</span><b>{lim.multiInstance ? 'مسموح ✓' : 'غير متاح في هذه الباقة'}</b></div>
                  </>
                )
              })()}
              <button onClick={() => { clearActivation(); toast.show('أُزيل التفعيل من هذا الجهاز') }} className="text-[11px] text-rose-500 hover:text-rose-600 font-bold pt-1">إزالة التفعيل</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <Field label="مفتاح التفعيل" hint="يبدأ بـ SHOPSYS1. — الصقه كما وصلك من المطوّر">
                <textarea
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  rows={4}
                  className={`${inputCls} font-mono !text-[11px] resize-none`}
                  dir="ltr"
                  placeholder="SHOPSYS1.eyJ2IjoxLCJkZXZpY2VJZCI6..."
                />
              </Field>
              <Btn onClick={activate} disabled={!keyInput.trim() || busy} className="w-full">
                <KeyRound size={15} /> {busy ? 'جارٍ التحقق…' : 'تفعيل الترخيص'}
              </Btn>
            </div>
          )}
        </div>

        {/* بصمة الأمان */}
        <div className={card}>
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2 mb-3">
            <Fingerprint size={17} className="text-slate-500" /> كيف يعمل؟
          </div>
          <ul className="text-[12.5px] text-slate-500 dark:text-slate-400 space-y-2 leading-relaxed">
            <li>• المفتاح موقّع رقمياً <b>Ed25519</b> بمفتاح المطوّر الخاص — أي تعديل حرف واحد يُبطله.</li>
            <li>• المفتاح مربوط بمعرف هذا الجهاز فقط — لا يعمل على جهاز آخر.</li>
            <li>• التجربة {TRIAL_DAYS} يوماً كاملة الميزات الأساسية، وإرجاع ساعة الجهاز يُكتشف تلقائياً.</li>
            <li>• الميزات الخاصة (الفاتورة الإلكترونية…) لا تُفعَّل إلا إن حملها مفتاحك — بقرار المطوّر.</li>
          </ul>
        </div>
      </div>

      {/* الميزات المرخصة */}
      <div className="anim-up space-y-4" style={{ animationDelay: '80ms' }}>
        <div className={card}>
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
            <Sparkles size={17} className="text-slate-500" /> الميزات الخاصة بالمفتاح
          </div>
          <div className="space-y-2">
            {ALL_FEATURES.map((f) => {
              const on = hasFeature(state, f)
              return (
                <div key={f} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${on ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-slate-200 dark:border-slate-700 opacity-60'}`}>
                  <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{FEATURE_LABELS[f]}</span>
                  {on
                    ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">مفعّلة</span>
                    : <span className="text-[10px] font-bold text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded-full">تتطلب مفتاحاً يحملها</span>}
                </div>
              )
            })}
          </div>
          <div className="mt-4 text-[11px] text-slate-400 leading-relaxed">
            الفاتورة الضريبية الإلكترونية (مصر / السعودية) متوقفة افتراضياً لكل المستخدمين،
            ولا يفعّلها إلا المطوّر بإصدار مفتاح يحملها (القرار 21) — لاحقاً عبر بوت التليجرام مباشرة.
          </div>
        </div>
      </div>
    </div>
  )
}
