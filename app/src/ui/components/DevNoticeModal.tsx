/**
 * نافذة تنبيه المطوّر المنبثقة — بند 10 من تدقيق 2026-10-08.
 * ─────────────────────────────────────────────────────────────
 * لماذا مكوّن مستقل عن `Modal` العام؟ لأن `Modal` في هذا المشروع **عمداً** غير
 * حاجب (يُصغَّر، ولا يعتم الشاشة، ويُغلق بـEscape) بقرار المالك «النوافذ عادية».
 * التنبيه العاجل من المطوّر يحتاج العكس تماماً: قراءة مؤكَّدة قبل المتابعة.
 * لذا overlay مستقل (لكن بطبقات المشروع الموحّدة: OverlayPortal + layer-approval):
 *   • critical ⇒ لا Escape ولا إغلاق — زر «تمّت القراءة» هو المخرج الوحيد.
 *   • important ⇒ زر «تمّت القراءة» + «لاحقاً» (تأجيل لهذه الجلسة، يعود عند
 *     الإقلاع التالي حتى يُقرّ أو تنتهي صلاحيته).
 *   • info ⇒ لا نافذة إطلاقاً (جرس + توست كما كان) — لا مقاطعة بلا سبب.
 *
 * الإقرار يُحفظ محلياً (ackedNoticeIds) ويُرسل إيصال قراءة للعامل best-effort؛
 * فشل الإيصال لا يعيد النافذة للعميل (الإقرار المحلي هو المعتمد).
 */
import { useEffect, useRef, useState } from 'react'
import { OverlayPortal } from './ui.tsx'
import { Megaphone, AlertTriangle, ShieldAlert, Check } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { LICENSE_CLOUD_BASE_URL } from '../../core/cloud.ts'
import {
  pendingPopupNotice, isAckMandatory, sendNoticeAck,
  NOTICE_LEVEL_ICONS, NOTICE_LEVEL_LABELS_AR, osNotificationFor,
} from '../../core/devNotice.ts'
import { showDesktopNotification } from '../../data/desktopBridge.ts'

const LEVEL_STYLE = {
  critical: { ring: 'border-rose-400/70', head: 'text-rose-600 dark:text-rose-400', Icon: ShieldAlert },
  important: { ring: 'border-amber-400/70', head: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
  info: { ring: 'border-slate-300', head: 'text-slate-600', Icon: Megaphone },
} as const

export function DevNoticeHost() {
  const notices = useAppStore((s) => s.cloudNotifications)
  const ackedIds = useAppStore((s) => s.ackedNoticeIds)
  const ackNotice = useAppStore((s) => s.ackNotice)
  /* التأجيل «لاحقاً» لهذه الجلسة فقط — لا يُحفظ، فيعود التنبيه بعد الإقلاع */
  const [snoozedIds, setSnoozedIds] = useState<string[]>([])
  const announced = useRef(new Set<string>())

  const notice = pendingPopupNotice(notices, { ackedIds, snoozedIds })

  /* إشعار نظام التشغيل (Electron) للتنبيهات المهمة/العاجلة — مرة لكل معرّف */
  useEffect(() => {
    for (const item of notices) {
      if (announced.current.has(item.id)) continue
      announced.current.add(item.id)
      const os = osNotificationFor(item)
      if (os) void showDesktopNotification(os.title, os.body)
    }
  }, [notices])

  if (!notice) return null
  const style = LEVEL_STYLE[notice.level]
  const mandatory = isAckMandatory(notice)
  const { Icon } = style

  const ack = () => {
    ackNotice(notice.id)
    // إيصال القراءة — لا يُنتظر ولا يعطّل الإغلاق
    void sendNoticeAck(LICENSE_CLOUD_BASE_URL, notice.id, useAppStore.getState().deviceId)
  }

  /* سلّم الطبقات الموحّد (حارس overlay_layers): الغطاء يستعمل `layer-approval`
     (3000) ويُركَّب على body عبر OverlayPortal — لا z-index محلياً، وإلا حُبست
     النافذة داخل أي حاوية متحركة. الغطاء نفسه pointer-events-none فيمرّ العمل
     خلفه (لا شلل للتطبيق)، والبطاقة وحدها هي التي تستقبل النقر. */
  return (
    <OverlayPortal>
    <div
      dir="rtl"
      className="layer-approval pointer-events-none fixed inset-0 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={NOTICE_LEVEL_LABELS_AR[notice.level]}
    >
      <div
        className={`pointer-events-auto w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 ${style.ring} shadow-2xl overflow-hidden anim-pop`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-500/5 border-b border-slate-200/60 dark:border-slate-800">
          <Icon className={`w-5 h-5 ${style.head}`} />
          <div className="font-black text-[13px] text-slate-700 dark:text-slate-200">
            {NOTICE_LEVEL_ICONS[notice.level]} {notice.title || NOTICE_LEVEL_LABELS_AR[notice.level]}
          </div>
          <span className="mr-auto text-[10px] font-bold text-slate-400">من المطوّر</span>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{notice.body}</p>
          {notice.createdAt && (
            <div className="text-[10.5px] font-bold text-slate-400">🕒 {notice.createdAt.slice(0, 16).replace('T', ' ')}</div>
          )}
          {mandatory && (
            <p className="text-[11px] font-bold text-rose-500/90">
              تنبيه عاجل — يلزم الإقرار بالقراءة قبل المتابعة.
            </p>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={ack}
            data-testid="dev-notice-ack"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[13px] font-black px-4 py-2.5 transition-colors"
          >
            <Check className="w-4 h-4" /> تمّت القراءة
          </button>
          {!mandatory && (
            <button
              onClick={() => setSnoozedIds((ids) => (ids.includes(notice.id) ? ids : [...ids, notice.id]))}
              data-testid="dev-notice-snooze"
              className="rounded-xl border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[12px] font-bold px-4 py-2.5 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              لاحقاً
            </button>
          )}
        </div>
      </div>
    </div>
    </OverlayPortal>
  )
}
