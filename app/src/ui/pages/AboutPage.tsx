/**
 * صفحة «حول» (القرار 28): محتواها يتحكم فيه المطوّر عن بُعد عبر
 * Cloudflare Worker (نقطة /about) — تتحدث تلقائياً عند توفر الإنترنت
 * وتعمل بآخر نسخة محفوظة أوفلاين.
 */
import { Info, MessageCircle, Phone, Globe, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../../stores/app.store.ts'
import { fetchAbout, DEFAULT_CLOUD_BASE_URL, FALLBACK_ABOUT } from '../../core/cloud.ts'
import { PLAN_LABELS } from '../../core/license.ts'
import { Btn, useToast } from '../components/ui.tsx'

export function AboutPage() {
  const { cloudAbout, cloudSyncedAt, setCloudData, deviceId, activatedPayload, setup } = useAppStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const about = cloudAbout ?? FALLBACK_ABOUT

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
        <img src="/app-icon.png" alt="حسبان" className="w-20 h-20 rounded-2xl mx-auto shadow-lg" />
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

      {/* شعار المطوّر — علامة حصرية للمالك */}
      <div className={`${card} text-center space-y-2 !bg-black !border-slate-800`}>
        <img src="/dev-logo.png" alt="شعار المطوّر" className="max-h-40 mx-auto object-contain" />
        <div className="text-[12px] text-slate-400 font-bold">تطوير وملكية حصرية — جميع الحقوق محفوظة</div>
      </div>
    </div>
  )
}
