/**
 * شريط «قرب انتهاء الاشتراك» (بند 5 من تدقيق 2026-10-08).
 * ─────────────────────────────────────────────────────────────
 * الطلب: «رسالة غير مزعجة للعميل أنه متبقي فقط 10 أيام على انتهاء اشتراكه».
 *
 * غير مزعجة **فعلاً** لا شكلاً:
 *   • شريط رفيع غير حاجب — لا نافذة حوارية، ولا يوقف أي عمل، ولا يغطي الشاشة.
 *   • يُحسب محلياً من `expiresAt` الموقّع في الرخصة ⇒ يظهر حتى بلا إنترنت.
 *   • زر «×» يُسكته بقية اليوم (ولا يعود إلا غداً) — الحق في الإسكات محفوظ.
 *   • لا يظهر لاشتراك مدى الحياة، ولا بعد الانتهاء (شاشة القفل هي الواجهة حينها).
 *   • التدرج: 10 أيام ⇒ شريط محايد · 3 أيام ⇒ كهرماني بزر «تواصل للتجديد».
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, X, Headset } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { renewalReminder, shouldShowReminderBar } from '../../core/subscriptionReminder.ts'

export function RenewalNoticeBar() {
  const navigate = useNavigate()
  const activatedPayload = useAppStore((s) => s.activatedPayload)
  const dismissedDay = useAppStore((s) => s.renewalDismissedDay)
  const dismiss = useAppStore((s) => s.dismissRenewalNotice)

  const todayIso = new Date().toISOString()
  const reminder = useMemo(
    () => renewalReminder({ expiresAt: activatedPayload?.expiresAt ?? null, todayIso }),
    // اليوم وحده يكفي لإعادة الحساب — لا حاجة لإعادة التقييم كل ثانية
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activatedPayload?.expiresAt, todayIso.slice(0, 10)],
  )

  if (!shouldShowReminderBar({ reminder, todayIso, dismissedDay })) return null
  const urgent = reminder.kind === 'urgent'

  return (
    <div
      dir="rtl"
      role="status"
      /* **غير لاصق** عمداً (خلاف `LanStatusBar`): كلاهما `sticky top-0` بنفس
         الطبقة، وشريطان لاصقان على الحافة نفسها يتراكبان عند التمرير فيختفي
         مؤشر حالة الشبكة خلف شريط التذكير (وفي وضع الشريط العلوي يختفي خلف
         `MenuBar`). التذكير رسالة تُقرأ مرة في اليوم لا مؤشر حالة دائم: يظهر في
         أعلى كل صفحة وفي جرس التنبيهات، فالتضحية بالالتصاق تحمي شريط الشبكة. */
      className={`flex items-center justify-center gap-2 px-4 py-1 text-[11px] font-bold relative z-30 ${
        urgent ? 'bg-amber-500/95 text-slate-900' : 'bg-sky-600/90 text-white'
      }`}
    >
      <CalendarClock className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">
        <b>{reminder.titleAr}</b>
        <span className="hidden sm:inline opacity-90"> — {reminder.bodyAr}</span>
      </span>
      <button
        onClick={() => navigate('/settings/license')}
        className="shrink-0 underline underline-offset-2 hover:opacity-80"
        title="تفاصيل الترخيص والاشتراك"
      >
        التفاصيل
      </button>
      {reminder.showContact && (
        <button
          onClick={() => navigate('/settings/support')}
          className="shrink-0 flex items-center gap-1 rounded-md bg-slate-900/15 hover:bg-slate-900/25 px-2 py-0.5"
          title="افتح محادثة الدعم للتجديد"
        >
          <Headset className="w-3 h-3" /> تواصل للتجديد
        </button>
      )}
      <button
        onClick={() => dismiss(todayIso.slice(0, 10))}
        className="shrink-0 p-0.5 rounded hover:bg-black/10"
        title="إسكات هذا التنبيه بقية اليوم"
        aria-label="إسكات تنبيه الاشتراك اليوم"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
