/**
 * الدعم الفني — محادثة مع المطوّر (طلب المالك):
 * المستخدم يرسل مشكلته فتصل للمطوّر على بوت التليجرام بكل بيانات الجهاز،
 * والمطوّر يرد من البوت (Reply) فيظهر رده هنا كمحادثة بين طرفين.
 * سجل التطبيق يُرفق فقط بموافقة صريحة وبعلم المستخدم أنه لأغراض الإصلاح.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Headset, Send, RefreshCw, FileText, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getActivity } from '../../core/activities.ts'
import { DEFAULT_CLOUD_BASE_URL } from '../../core/cloud.ts'
import { buildSupportPayload, fetchConversation, sendSupportMessage, SUPPORT_POLL_MS, type SupportMessage } from '../../core/support.ts'
import { getLogText, getLogLines, logEvent } from '../../core/applog.ts'
import { getOrCreateSupportToken } from '../../data/supportAuth.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

const APP_VERSION = '1.0'

export function SupportPage() {
  const { setup, deviceId } = useAppStore()
  const { appUsers, currentUserId } = useDataStore()
  const toast = useToast()
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [text, setText] = useState('')
  const [attachLog, setAttachLog] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeUser = appUsers.find((u) => u.id === currentUserId)
  const logCount = useMemo(() => getLogLines().length, [])

  const refresh = async () => {
    const token = await getOrCreateSupportToken()
    const conv = await fetchConversation(DEFAULT_CLOUD_BASE_URL, deviceId, token)
    if (conv) setMessages(conv)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, SUPPORT_POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  const send = async () => {
    try {
      const payload = buildSupportPayload({
        text,
        customer: `${setup.shopName}${activeUser ? ` (${activeUser.nameAr})` : ''}`,
        activity: getActivity(setup.activityId)?.nameAr ?? '',
        appVersion: APP_VERSION,
        attachLog,
        logText: attachLog ? getLogText() : '',
      })
      setSending(true)
      const token = await getOrCreateSupportToken()
      const ok = await sendSupportMessage(DEFAULT_CLOUD_BASE_URL, deviceId, token, payload)
      setSending(false)
      if (!ok) return toast.show('تعذر الإرسال — تأكد من اتصال الإنترنت وحاول ثانية', 'error')
      logEvent('info', `support: أُرسلت رسالة دعم${attachLog ? ' + لوج' : ''}`)
      setMessages((m) => [...m, { id: (m.at(-1)?.id ?? 0) + 1, from: 'client', text: payload.text, at: new Date().toISOString() }])
      setText(''); setAttachLog(false)
      toast.show('وصلت رسالتك للمطوّر — سيصلك الرد هنا ✓')
    } catch (e) {
      setSending(false)
      toast.show((e as Error).message, 'error')
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col" style={{ minHeight: 420 }}>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Headset size={17} className="text-brand-500" /> الدعم الفني — محادثة مع المطوّر
          </div>
          <button onClick={refresh} title="تحديث المحادثة" className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors">
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
          {loading ? (
            <div className="text-center text-slate-400 text-[12px] py-10">جارٍ جلب المحادثة…</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-slate-400 py-10 space-y-1">
              <div className="text-3xl">💬</div>
              <div className="text-[13px] font-bold">لا رسائل بعد</div>
              <div className="text-[11.5px]">اكتب مشكلتك بالأسفل — تصل للمطوّر فوراً على البوت ويصلك رده هنا</div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.from === 'client' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.from === 'client'
                    ? 'bg-brand-500/10 text-slate-700 dark:text-slate-200 rounded-tr-sm'
                    : 'bg-white dark:bg-card-dark border border-emerald-500/30 text-slate-700 dark:text-slate-200 rounded-tl-sm'
                }`}>
                  <div className="text-[10px] font-bold mb-0.5 opacity-60">{m.from === 'client' ? '🧑 أنت' : '👨‍💻 المطوّر'}</div>
                  {m.text}
                  {m.at && <div className="text-[9.5px] opacity-50 mt-1" dir="ltr">{m.at.slice(0, 16).replace('T', ' ')}</div>}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2}
            className={inputCls} placeholder="اشرح مشكلتك… (نص فقط — لا يمكن إرفاق ملفات لأسباب أمنية)"
          />
          {/* موافقة صريحة على إرسال اللوج (طلب المالك: بعلم المستخدم ولغرض الإصلاح) */}
          <label className="flex items-start gap-2 text-[11.5px] text-slate-500 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={attachLog} onChange={(e) => setAttachLog(e.target.checked)} className="w-4 h-4 mt-0.5 accent-brand-600" />
            <span>
              <b className="flex items-center gap-1"><FileText size={12} /> إرفاق سجل التطبيق التقني ({logCount} سطراً)</b>
              أوافق على إرسال سجل أحداث التطبيق للمطوّر <b>لأغراض تشخيص وإصلاح المشكلة فقط</b> —
              السجل تقني (رسائل أخطاء وأحداث) ولا يحتوي أرصدة أو بيانات عملائك المالية.
            </span>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-slate-400 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" /> قناة نصية آمنة — كل الرسائل تُعقَّم من الطرفين ولا تقبل ملفات
            </span>
            <Btn onClick={send} disabled={sending || text.trim().length < 3}>
              <Send size={14} /> {sending ? 'جارٍ الإرسال…' : 'إرسال للمطوّر'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
