/**
 * صفحة «حول» (القرار 28): محتواها يتحكم فيه المطوّر عن بُعد عبر
 * Cloudflare Worker (نقطة /about) — تتحدث تلقائياً عند توفر الإنترنت
 * وتعمل بآخر نسخة محفوظة أوفلاين.
 */
import { Info, MessageCircle, Phone, Globe, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../../stores/app.store.ts'
import { fetchAbout, DEFAULT_CLOUD_BASE_URL, FALLBACK_ABOUT } from '../../core/cloud.ts'
import { APP_VERSION, fetchUpdateInfo, decideUpdate, buildUpdatePlan, type UpdateDecision } from '../../core/updates.ts'
import { DownloadCloud, ShieldCheck } from 'lucide-react'
import { PLAN_LABELS } from '../../core/license.ts'
import { Btn, useToast } from '../components/ui.tsx'

export function AboutPage() {
  const { cloudAbout, cloudSyncedAt, setCloudData, deviceId, activatedPayload, setup } = useAppStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const about = cloudAbout ?? FALLBACK_ABOUT

  // فحص التحديثات عبر Cloudflare (البند 6) — النتيجة تُعرض ببطاقة أسفل معلومات النسخة
  const [updBusy, setUpdBusy] = useState(false)
  const [updDecision, setUpdDecision] = useState<UpdateDecision | null>(null)
  const checkUpdates = async () => {
    setUpdBusy(true)
    const info = await fetchUpdateInfo(DEFAULT_CLOUD_BASE_URL)
    setUpdBusy(false)
    if (info === null) { toast.show('تعذّر الوصول لخادم التحديثات — أنت على النسخة المحفوظة', 'error'); return }
    const d = decideUpdate(APP_VERSION, info)
    setUpdDecision(d)
    toast.show(d.kind === 'up_to_date' ? 'أنت على أحدث إصدار ✅' : 'يتوفر تحديث جديد ⬇️')
  }

  const refresh = async () => {
    setBusy(true)
    const fresh = await fetchAbout(DEFAULT_CLOUD_BASE_URL)
    setBusy(false)
    if (fresh) { setCloudData({ about: fresh }); toast.show('تم التحديث من السحابة ✅') }
    else toast.show('تعذّر الاتصال — تُعرض آخر نسخة محفوظة', 'error')
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className={`${card} text-center space-y-3`}>
        <img src="/app-logo.png" alt="TAHAKAM ERP" className="max-h-32 mx-auto object-contain rounded-2xl shadow-lg" />
        <h1 className="text-2xl font-black">{about.title}</h1>
        <p className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{about.body}</p>
        <div className="flex items-center justify-center gap-4 flex-wrap text-sm font-bold">
          {about.supportTelegram && (
            <a href={`https://t.me/${about.supportTelegram.replace('@', '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sky-600 hover:underline">
              <MessageCircle className="w-4 h-4" /> {about.supportTelegram}
            </a>
          )}
          {about.supportPhone && <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300" dir="ltr"><Phone className="w-4 h-4" /> {about.supportPhone}</span>}
          {about.website && (
            <a href={about.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-violet-600 hover:underline">
              <Globe className="w-4 h-4" /> الموقع
            </a>
          )}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-black flex items-center gap-2"><Info className="w-5 h-5 text-sky-500" /> معلومات النسخة</h2>
          <Btn variant="ghost" onClick={refresh} disabled={busy}><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> تحديث من السحابة</Btn>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">معرف الجهاز</div><div className="font-mono font-bold" dir="ltr">{deviceId}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">الباقة</div><div className="font-black">{activatedPayload ? PLAN_LABELS[activatedPayload.plan] : 'تجريبي'}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">النشاط</div><div className="font-black">{setup.activityId ?? '—'}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">آخر مزامنة سحابية</div><div className="font-bold">{cloudSyncedAt ? cloudSyncedAt.slice(0, 16).replace('T', ' ') : 'لم تتم بعد'}</div></div>
        </div>
      </div>

      {/* فحص التحديثات — Cloudflare (البند 6) */}
      <div className={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-black flex items-center gap-2"><DownloadCloud className="w-5 h-5 text-emerald-500" /> التحديثات</h2>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-bold text-slate-400">الإصدار الحالي: <b className="text-slate-700 dark:text-slate-200 font-mono" dir="ltr">v{APP_VERSION}</b></span>
            <Btn onClick={checkUpdates} disabled={updBusy}>
              <RefreshCw className={`w-4 h-4 ${updBusy ? 'animate-spin' : ''}`} /> فحص التحديثات
            </Btn>
          </div>
        </div>
        {updDecision && updDecision.kind === 'up_to_date' && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15 text-[12.5px] font-bold text-emerald-600 anim-pop">
            ✅ أنت على أحدث إصدار — لا تحديثات متاحة الآن.
          </div>
        )}
        {updDecision && updDecision.kind !== 'up_to_date' && (
          <div className="mt-3 space-y-3 anim-pop">
            <div className={`p-3 rounded-xl border text-[12.5px] font-bold ${updDecision.kind === 'mandatory_update' ? 'bg-rose-500/5 border-rose-500/15 text-rose-600' : 'bg-sky-500/5 border-sky-500/15 text-sky-600'}`}>
              {updDecision.kind === 'mandatory_update' ? '⚠️ تحديث إجباري (أمني) — ' : '⬇️ يتوفر إصدار جديد: '}
              <b className="font-mono" dir="ltr">v{updDecision.info.latestVersion}</b>
              {updDecision.info.releaseNotesAr && <div className="mt-1 font-normal text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{updDecision.info.releaseNotesAr}</div>}
            </div>
            <div className="p-3 rounded-xl bg-slate-500/5 text-[11.5px] space-y-1.5">
              <div className="font-black text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-500" /> خطة التحديث الآمن (تلقائية بالكامل):</div>
              {buildUpdatePlan().map((st, i) => (
                <div key={st.id} className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  {st.titleAr}
                </div>
              ))}
              <div className="pt-1 text-[10.5px] text-amber-600 dark:text-amber-400 font-bold">
                🛟 أي فشل = تراجع تلقائي واستعادة النسخة الاحتياطية — بياناتك خارج مسار التثبيت ولا يمسها الحذف أبداً.
              </div>
            </div>
            <div className="text-[11px] text-slate-400">
              💡 التنزيل والتثبيت التلقائي يتفعلان في نسخة سطح المكتب — من متصفح التطوير يظهر الإشعار فقط.
            </div>
          </div>
        )}
      </div>

      {/* شعار المطوّر — علامة حصرية للمالك */}
      <div className={`${card} text-center space-y-2 !bg-black !border-slate-800`}>
        <img src="/dev-logo.png" alt="شعار المطوّر" className="max-h-40 mx-auto object-contain" />
        <div className="text-[13px] text-amber-400/90 font-black">تطوير وملكية حصرية — جميع الحقوق محفوظة</div>
        <div className="text-[13px] text-slate-300 font-black">م / محمد عبدة</div>
      </div>
    </div>
  )
}
