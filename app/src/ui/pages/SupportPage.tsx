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
/* بلاغ 2026-10-27: استُبدل النطاق القديم الميت بنطاق عامل التحكم الحيّ */
import { buildSupportPayload, fetchConversation, sendSupportMessage, SUPPORT_POLL_MS, type SupportSendResult, type SupportMessage } from '../../core/support.ts'
import { getLogText, getLogLines, logEvent } from '../../core/applog.ts'
import { combineSupportLogs } from '../../core/supportDiagnostic.ts'
import { getOrCreateSupportToken } from '../../data/supportAuth.ts'
import { APP_VERSION } from '../../core/updates.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'
import { localDateTimeLabel } from '../../core/time.ts'
import { SUPPORT_CLOUD_BASE_URL } from '../../core/cloud.ts'

export function SupportPage() {
  const { setup, deviceId } = useAppStore()
  const { appUsers, currentUserId } = useDataStore()
  const toast = useToast()
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [text, setText] = useState('')
  const [attachLog, setAttachLog] = useState(false)
  const [logPreview, setLogPreview] = useState<string | null>(null)
  const [logError, setLogError] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logTruncated, setLogTruncated] = useState(false)
  const logRequest = useRef(0)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [conversationAvailable, setConversationAvailable] = useState<boolean | null>(null)
  /* حالة القناة للعرض: لا نقول «لا يوجد إنترنت» إلا بعد مسبار فعلي */
  const [channel, setChannel] = useState<{ ok: boolean; text: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeUser = appUsers.find((u) => u.id === currentUserId)
  const logCount = useMemo(() => getLogLines().length, [])

  const refresh = async () => {
    try {
      const token = await getOrCreateSupportToken()
      const conv = await fetchConversation(SUPPORT_CLOUD_BASE_URL, deviceId, token)
      if (conv === null) setConversationAvailable(false)
      else { setMessages(conv); setConversationAvailable(true) }
    } catch {
      setConversationAvailable(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, SUPPORT_POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  const prepareLog = async () => {
    const request = ++logRequest.current
    setLogLoading(true); setLogError(''); setLogPreview(null); setLogTruncated(false)
    try {
      let mainLog: string | null = null
      let truncated = false
      if (window.shopsysDesktop?.runtime === 'electron') {
        const readMainLog = window.shopsysSupport?.readMainLog
        if (!readMainLog) throw new Error('نسخة سطح المكتب لا تدعم إرفاق main.log — حدّث التطبيق أو أرسل الرسالة بلا السجل')
        const result = await readMainLog()
        if (!result?.ok || typeof result.text !== 'string') throw new Error('تعذرت قراءة main.log؛ تأكد من صلاحية الملف أو أرسل الرسالة بلا السجل')
        mainLog = result.text
        truncated = result.truncated
      }
      const preview = combineSupportLogs(mainLog, getLogText())
      if (request === logRequest.current) { setLogPreview(preview); setLogTruncated(truncated) }
    } catch (error) {
      if (request === logRequest.current) setLogError((error as Error).message || 'تعذّر تجهيز السجل')
    } finally { if (request === logRequest.current) setLogLoading(false) }
  }

  const toggleLog = (checked: boolean) => {
    setAttachLog(checked)
    if (checked) void prepareLog()
    else { logRequest.current++; setLogPreview(null); setLogError(''); setLogLoading(false) }
  }

  const send = async () => {
    try {
      if (attachLog && (!logPreview || logLoading || logError)) throw new Error('راجع السجل المرفق أو ألغِ اختياره قبل الإرسال')
      const payload = buildSupportPayload({
        text,
        customer: `${setup.shopName}${activeUser ? ` (${activeUser.nameAr})` : ''}`,
        activity: getActivity(setup.activityId)?.nameAr ?? '',
        appVersion: APP_VERSION,
        attachLog,
        logText: attachLog ? logPreview ?? '' : '',
      })
      setSending(true)
      const token = await getOrCreateSupportToken()
      const result: SupportSendResult = await sendSupportMessage(SUPPORT_CLOUD_BASE_URL, deviceId, token, payload)
      setSending(false)
      /* بند 5 + بلاغ 2026-10-27: السبب الحقيقي من الخادم/النقل — لا «لا يوجد اتصال» كاذبة.
         يبقى النص مكتوباً كما هو عند الفشل، ويظهر سبب واضح أعلى المحادثة. */
      if (!result.ok) {
        setChannel({ ok: false, text: result.reason })
        logEvent('error', `support: فشل الإرسال (${result.status || 'transport'}، offline=${result.offline}، محاولات=${result.attempts}) — ${result.reason}${result.detail ? ` | ${result.detail}` : ''}`)
        return toast.show(result.reason, 'error')
      }
      const fullyNotified = result.notified === true && (!payload.log || result.logNotified === true)
      setChannel(fullyNotified ? null : { ok: false, text: result.reason })
      logEvent(fullyNotified ? 'info' : 'warn', `support: حُفظت رسالة دعم؛ إشعار المطوّر=${result.notified === true}، إشعار السجل=${payload.log ? result.logNotified === true : 'لم يطلب'}`)
      setMessages((m) => [...m, { id: (m.at(-1)?.id ?? 0) + 1, from: 'client', text: payload.text, at: new Date().toISOString() }])
      setText(''); toggleLog(false)
      toast.show(result.reason, fullyNotified ? 'success' : 'error')
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
        {channel && !channel.ok && (
          <div role="status" className="mx-3 mt-3 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-200">
            <b>حالة الإرسال:</b> {channel.text}
          </div>
        )}

        {conversationAvailable === false && (
          <div role="status" className="mx-3 mt-3 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-200">
            تعذر تحديث المحادثة؛ قد لا تظهر الرسائل المحفوظة. حاول تحديثها قبل إعادة إرسال رسالة غير مؤكدة.
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
          {loading ? (
            <div className="text-center text-slate-400 text-[12px] py-10">جارٍ جلب المحادثة…</div>
          ) : messages.length === 0 && conversationAvailable === false ? (
            <div className="text-center text-slate-400 text-[12px] py-10">المحادثة غير متاحة حالياً — لا يمكن الجزم بأنها فارغة.</div>
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
                  {m.at && <div className="text-[9.5px] opacity-50 mt-1" dir="ltr">{localDateTimeLabel(m.at)}</div>}
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
          {/* لا تُقرأ سجلات سطح المكتب ولا تُرسل إلا باختيار المستخدم ومراجعته. */}
          <label className="flex items-start gap-2 text-[11.5px] text-slate-500 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={attachLog} onChange={(e) => toggleLog(e.target.checked)} disabled={sending} className="w-4 h-4 mt-0.5 accent-brand-600" />
            <span><b className="flex items-center gap-1"><FileText size={12} /> إرفاق مقتطف سجل الواجهة وmain.log ({logCount} سطر واجهة)</b>
              أوافق على إرسال المقتطف المعروض للمطوّر للتشخيص فقط. يُحجب بعض المحتوى الحساس تلقائياً، لكن قد تبقى بيانات شخصية؛ راجع النص قبل الإرسال. لا تُرسل قاعدة البيانات.
            </span>
          </label>
          {attachLog && <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 space-y-2 text-xs">
            {logLoading && <div>جارٍ تجهيز السجل…</div>}
            {logError && <div role="alert" className="text-rose-600">{logError}</div>}
            {logPreview && <><div>هذه لقطة وقت التجهيز؛ أعد تجهيزها إذا حدث خطأ جديد.{logTruncated ? ' اقتُصر على أحدث جزء من main.log؛ السجل الأقدم غير مرفق.' : ''}</div><pre aria-label="معاينة السجل المرفق" dir="auto" className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] bg-slate-100 dark:bg-slate-900 p-2 rounded">{logPreview}</pre></>}
            <button type="button" disabled={logLoading || sending} onClick={() => void prepareLog()} className="text-brand-600 font-bold disabled:opacity-40">تحديث معاينة السجل</button>
          </div>}
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-slate-400 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" /> قناة نصية آمنة — كل الرسائل تُعقَّم من الطرفين ولا تقبل ملفات
            </span>
            <Btn onClick={send} disabled={sending || text.trim().length < 3 || (attachLog && (logLoading || !!logError || !logPreview))}>
              <Send size={14} /> {sending ? 'جارٍ الإرسال…' : 'إرسال للمطوّر'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
