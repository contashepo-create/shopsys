/**
 * صفحة «حول» (القرار 28): محتواها يتحكم فيه المطوّر عن بُعد عبر
 * Cloudflare Worker (نقطة /about) — تتحدث تلقائياً عند توفر الإنترنت
 * وتعمل بآخر نسخة محفوظة أوفلاين.
 */
import { Info, MessageCircle, Phone, Globe, RefreshCw, Scale, Mail, MapPin, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/app.store.ts'
import { fetchAbout, fetchAccountMessage, LICENSE_CLOUD_BASE_URL, FALLBACK_ABOUT, hasAboutContact, whatsappLink } from '../../core/cloud.ts'
import { DeveloperMessage } from '../components/DeveloperMessage.tsx'
import { APP_VERSION } from '../../core/updates.ts'
import { PLAN_LABELS } from '../../core/license.ts'
import { Btn, useToast } from '../components/ui.tsx'

export function AboutPage() {
  const { cloudAbout, cloudAccountMessage, cloudSyncedAt, setCloudData, deviceId, activatedPayload, setup } = useAppStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const about = cloudAbout ?? FALLBACK_ABOUT

  // رسالة المطوّر لهذا الجهاز: تُحدَّث عند فتح «حول» (بجانب المزامنة الدورية)
  useEffect(() => {
    if (!deviceId) return
    let cancelled = false
    void fetchAccountMessage(LICENSE_CLOUD_BASE_URL, deviceId).then((msg) => {
      if (!cancelled && msg !== null) setCloudData({ accountMessage: msg })
    })
    return () => { cancelled = true }
  }, [deviceId, setCloudData])

  const refresh = async () => {
    setBusy(true)
    const fresh = await fetchAbout(LICENSE_CLOUD_BASE_URL)
    setBusy(false)
    if (fresh) { setCloudData({ about: fresh }); toast.show('تم التحديث من السحابة ✅') }
    else toast.show('تعذّر الاتصال — تُعرض آخر نسخة محفوظة', 'error')
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className={`${card} text-center space-y-3`}>
        <img src="./app-logo.png" alt="TAHAKAM ERP" className="max-h-32 mx-auto object-contain rounded-2xl shadow-lg" />
        <h1 className="text-2xl font-black">{about.title}</h1>
        <p className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{about.body}</p>
        <DeveloperMessage message={cloudAccountMessage} />
        {/* بند 9 (تدقيق 2026-10-08): كل قنوات التواصل — تُملأ من لوحة المطوّر.
            الروابط معقّمة في parseAbout (http/https/mailto/tel فقط). */}
        {hasAboutContact(about) ? (
          <div className="flex items-center justify-center gap-3 flex-wrap text-sm font-bold pt-1">
            {about.supportWhatsapp && (
              <a href={whatsappLink(about.supportWhatsapp)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-emerald-600 hover:underline" title="واتساب الدعم">
                <MessageCircle className="w-4 h-4" /> واتساب
              </a>
            )}
            {about.supportPhone && (
              <a href={`tel:${about.supportPhone.replace(/\s/g, '')}`} dir="ltr"
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:underline">
                <Phone className="w-4 h-4" /> {about.supportPhone}
              </a>
            )}
            {about.supportTelegram && (
              <a href={`https://t.me/${about.supportTelegram}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sky-600 hover:underline">
                <MessageCircle className="w-4 h-4" /> @{about.supportTelegram}
              </a>
            )}
            {about.supportEmail && (
              <a href={`mailto:${about.supportEmail}`} dir="ltr"
                className="flex items-center gap-1.5 text-violet-600 hover:underline">
                <Mail className="w-4 h-4" /> {about.supportEmail}
              </a>
            )}
            {about.website && (
              <a href={about.website} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-violet-600 hover:underline">
                <Globe className="w-4 h-4" /> الموقع
              </a>
            )}
            {about.socialLinks.map((link) => (
              <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:underline">
                <Globe className="w-4 h-4" /> {link.label}
              </a>
            ))}
          </div>
        ) : (
          <div className="text-[11.5px] text-slate-400 font-bold">
            لم يضبط المطوّر بيانات تواصل عن بُعد بعد — استخدم «الدعم الفني» من الإعدادات لفتح محادثة مباشرة.
          </div>
        )}
        {(about.address || about.workHours) && (
          <div className="text-[12px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1">
            {about.address && <div className="flex items-center justify-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {about.address}</div>}
            {about.workHours && <div className="flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {about.workHours}</div>}
          </div>
        )}
        {about.extraFields.length > 0 && (
          <div className="pt-2 space-y-1.5 text-right">
            {about.extraFields.map((field) => (
              <div key={`${field.label}-${field.value}`} className="flex items-start justify-between gap-3 rounded-xl bg-slate-500/5 px-3 py-2 text-[12.5px]">
                <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">{field.label}</span>
                {field.url
                  ? <a href={field.url} target="_blank" rel="noreferrer" className="font-bold text-sky-600 hover:underline break-all">{field.value}</a>
                  : <span className="font-bold text-slate-700 dark:text-slate-200 break-all">{field.value}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-black flex items-center gap-2"><Info className="w-5 h-5 text-sky-500" /> معلومات النسخة</h2>
          <Btn variant="ghost" onClick={refresh} disabled={busy}><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> تحديث من السحابة</Btn>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">إصدار التطبيق</div><div className="font-mono font-bold" dir="ltr">v{APP_VERSION}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">معرف الجهاز</div><div className="font-mono font-bold" dir="ltr">{deviceId}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">الباقة</div><div className="font-black">{activatedPayload ? PLAN_LABELS[activatedPayload.plan] : 'تجريبي'}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">النشاط</div><div className="font-black">{setup.activityId ?? '—'}</div></div>
          <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">آخر مزامنة سحابية</div><div className="font-bold">{cloudSyncedAt ? cloudSyncedAt.slice(0, 16).replace('T', ' ') : 'لم تتم بعد'}</div></div>
        </div>
      </div>

      {/* v1.0.8: الاتفاقية والخصوصية — مراجعة دائمة */}
      <button
        onClick={() => window.location.hash = '#/settings/legal'}
        className="anim-up w-full px-5 py-3.5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:border-violet-400 hover:text-violet-600 transition-colors flex items-center justify-center gap-2"
      >
        <Scale size={16} /> مراجعة اتفاقية الاستخدام وسياسة الخصوصية
      </button>

      {/* شعار المطوّر — علامة حصرية للمالك */}
      <div className={`${card} text-center space-y-2 !bg-black !border-slate-800`}>
        <img src="./dev-logo.png" alt="شعار المطوّر" className="max-h-40 mx-auto object-contain" />
        <div className="text-[13px] text-amber-400/90 font-black">تطوير وملكية حصرية — جميع الحقوق محفوظة</div>
        <div className="text-[13px] text-slate-300 font-black">م / محمد عبدة</div>
      </div>
    </div>
  )
}
