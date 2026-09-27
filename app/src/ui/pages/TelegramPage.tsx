import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * بوت التليجرام — جانب العميل (المرحلة 5 — القرار 7):
 * القرار 7 يفصل بوتين: بوت المطوّر (تراخيص وتفعيل ميزات — خارج التطبيق)
 * وبوت العميل (هذه الصفحة): توكن BotFather + معرف محادثة المالك،
 * إرسال تقرير اليوم، تنبيه النواقص، والنسخة الاحتياطية.
 * الميزة مقفلة بمفتاح ترخيص يحمل telegram_bot (نمط القرار 21).
 */
import { useMemo, useState } from 'react'
import { Bot, Send, KeyRound, MessageSquareText, PackageSearch, DatabaseBackup, Lock, CheckCircle2, CalendarClock } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore, DATA_VERSION } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import {
  isValidBotToken, isValidChatId, maskToken, apiUrl,
  buildDailyReportText, buildLowStockText, buildBackupCaption,
} from '../../core/telegram.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { sanitizeHour, hourLabelAr } from '../../core/schedule.ts'
import { salesSummary, stockAlerts, type Period } from '../../core/reports.ts'
import { buildBackup, backupFileName } from '../../core/backup.ts'
import { decryptForDevice } from '../../data/secureStorage.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'


export function TelegramPage() {
  const { setup, telegram, updateTelegram, schedule, updateSchedule, lastDailySentDay, activatedPayload, trialStartedAt, lastSeenAt } = useAppStore()
  const { sales, saleReturns, items } = useDataStore()
  const toast = useToast()

  const licensed = useMemo(() => {
    const state = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    return hasFeature(state, 'telegram_bot')
  }, [activatedPayload, trialStartedAt, lastSeenAt])

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(telegram.chatId)
  const [busy, setBusy] = useState<string | null>(null)

  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )

  const connected = isValidBotToken(telegram.botToken) && isValidChatId(telegram.chatId)

  const saveConnection = () => {
    const t = token.trim() || telegram.botToken
    if (!isValidBotToken(t)) return toast.show('صيغة التوكن غير صحيحة — انسخه من BotFather كما هو', 'error')
    if (!isValidChatId(chatId)) return toast.show('معرف المحادثة رقم (أرسل /start لبوت @userinfobot لمعرفته)', 'error')
    updateTelegram({ botToken: t, chatId: chatId.trim() })
    setToken('')
    toast.show('حُفظ اتصال البوت ✅')
  }

  /** استدعاء Bot API — يعيد رسالة خطأ عربية مفهومة عند الفشل */
  const callBot = async (method: string, body: FormData | Record<string, unknown>): Promise<void> => {
    const init: RequestInit = body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    let res: Response
    try {
      res = await fetch(apiUrl(telegram.botToken, method), init)
    } catch {
      throw new Error('تعذر الوصول إلى تليجرام — تحقق من اتصال الإنترنت')
    }
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) {
      if (res.status === 401) throw new Error('التوكن مرفوض — تأكد منه في BotFather')
      if (data.description?.includes('chat not found')) throw new Error('المحادثة غير موجودة — أرسل /start للبوت أولاً ثم أعد المحاولة')
      throw new Error(data.description || 'رفض تليجرام الطلب')
    }
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    if (!connected) return toast.show('احفظ التوكن ومعرف المحادثة أولاً', 'error')
    setBusy(label)
    try { await fn(); toast.show(`${label} ✅`) }
    catch (err) { toast.show((err as Error).message, 'error') }
    finally { setBusy(null) }
  }

  const testConnection = () => run('وصلت رسالة الاختبار', async () => {
    await callBot('sendMessage', { chat_id: telegram.chatId, text: `✅ ${setup.shopName || 'تَحَكَّم'} متصل بالبوت بنجاح` })
  })

  const sendDaily = () => run('أُرسل تقرير اليوم', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const period: Period = { from: today, to: today }
    const s = salesSummary(sales, saleReturns, period)
    const alerts = stockAlerts(items)
    await callBot('sendMessage', {
      chat_id: telegram.chatId,
      text: buildDailyReportText({
        shopName: setup.shopName || 'تَحَكَّم',
        dateLabel: today,
        invoiceCount: s.invoiceCount,
        netSalesMinor: s.totalMinor,
        grossProfitMinor: s.netProfitMinor,
        cashInMinor: s.cashMinor,
        creditInMinor: s.creditMinor,
        returnsMinor: s.returnsMinor,
        lowStockCount: alerts.length,
        currencySymbol: cur.symbol,
        currencyDecimals: cur.decimals,
      }),
    })
  })

  const sendLowStock = () => run('أُرسل تنبيه النواقص', async () => {
    const alerts = stockAlerts(items)
    if (alerts.length === 0) throw new Error('لا نواقص حالياً — كل الأصناف فوق حد الطلب 🎉')
    await callBot('sendMessage', { chat_id: telegram.chatId, text: buildLowStockText(setup.shopName || 'تَحَكَّم', alerts) })
  })

  const sendBackup = () => run('أُرسلت النسخة الاحتياطية', async () => {
    const appRaw = localStorage.getItem('shopsys-app')
    const storeEnc = localStorage.getItem('shopsys-data')
    // قاعدة البيانات مشفرة على القرص (القرار 28) — نفكها قبل بناء ملف النسخة
    const storeRaw = storeEnc == null ? null : await decryptForDevice(storeEnc)
    if (!storeRaw) throw new Error('لا بيانات للنسخ بعد')
    const backup = buildBackup({
      appState: appRaw ? JSON.parse(appRaw) : null,
      storeState: JSON.parse(storeRaw),
      appDataVersion: DATA_VERSION,
      shopName: setup.shopName,
    })
    const fd = new FormData()
    fd.set('chat_id', telegram.chatId)
    fd.set('caption', buildBackupCaption(setup.shopName || 'تَحَكَّم', backup.createdAt))
    fd.set('document', new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }), backupFileName(setup.shopName, backup.createdAt))
    await callBot('sendDocument', fd)
  })

  /* ─── شاشة القفل (الميزة بمفتاح ترخيص فقط — القرار 21) ─── */
  if (!licensed) {
    return (
      <div className="max-w-2xl">
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-10 text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Lock size={26} className="text-slate-400" />
          </div>
          <h2 className="font-black text-slate-700 dark:text-slate-200">بوت التليجرام ميزة مرخّصة</h2>
          <p className="text-[12.5px] text-slate-400 leading-relaxed">
            تقارير اليوم وتنبيهات النواقص والنسخ الاحتياطي عبر تليجرام تتطلب مفتاح تفعيل يحمل ميزة
            «بوت تليجرام». تواصل مع المطوّر لإصدار مفتاح بها، ثم فعّله من صفحة الترخيص.
          </p>
          <a href="#/settings/license" className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-600 hover:underline">
            <KeyRound size={14} /> الذهاب إلى صفحة الترخيص
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* الاتصال */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Bot size={15} className="text-brand-600" /> اتصال بوت العميل
          </h2>
          {connected && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
              <CheckCircle2 size={13} /> متصل — {maskToken(telegram.botToken)}
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-slate-400 leading-relaxed">
          أنشئ بوتاً خاصاً بمحلك من <b dir="ltr">@BotFather</b> وانسخ التوكن هنا، ثم أرسل <b dir="ltr">/start</b> لبوتك
          وضع معرف محادثتك (تعرفه من <b dir="ltr">@userinfobot</b>). هذا بوت المحل — منفصل تماماً عن بوت المطوّر (القرار 7).
        </p>
        <Field label="توكن البوت" hint={telegram.botToken ? 'محفوظ — اتركه فارغاً للإبقاء عليه' : 'مثال: 1234567890:AAF…'}>
          <input value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} dir="ltr" type="password" placeholder={telegram.botToken ? maskToken(telegram.botToken) : '1234567890:AA…'} />
        </Field>
        <Field label="معرف المحادثة (chat id)">
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} className={inputCls} dir="ltr" placeholder="123456789" />
        </Field>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={testConnection} disabled={!connected || busy !== null}>
            <span className="flex items-center gap-1.5"><Send size={13} /> {busy === 'وصلت رسالة الاختبار' ? 'جارٍ الإرسال…' : 'اختبار الاتصال'}</span>
          </Btn>
          <Btn onClick={saveConnection}>💾 حفظ الاتصال</Btn>
        </div>
      </section>

      {/* الإرسال اليدوي */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-2" style={{ animationDelay: '60ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 mb-2">إرسال الآن</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button onClick={sendDaily} disabled={!connected || busy !== null} className="p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-all duration-200 text-center disabled:opacity-40">
            <MessageSquareText size={20} className="mx-auto text-brand-600 mb-1.5" />
            <div className="text-[12px] font-bold">تقرير اليوم</div>
            <div className="text-[10px] text-slate-400">مبيعات وربح ونقدي/آجل</div>
          </button>
          <button onClick={sendLowStock} disabled={!connected || busy !== null} className="p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all duration-200 text-center disabled:opacity-40">
            <PackageSearch size={20} className="mx-auto text-amber-600 mb-1.5" />
            <div className="text-[12px] font-bold">تنبيه النواقص</div>
            <div className="text-[10px] text-slate-400">الأصناف تحت حد الطلب</div>
          </button>
          <button onClick={sendBackup} disabled={!connected || busy !== null} className="p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all duration-200 text-center disabled:opacity-40">
            <DatabaseBackup size={20} className="mx-auto text-emerald-600 mb-1.5" />
            <div className="text-[12px] font-bold">نسخة احتياطية</div>
            <div className="text-[10px] text-slate-400">ملف كامل إلى المحادثة</div>
          </button>
        </div>
        {busy && <p className="text-[11px] text-slate-400 text-center pt-1">جارٍ الإرسال…</p>}
      </section>

      {/* التفضيلات */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-2" style={{ animationDelay: '120ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 mb-2">التفضيلات</h2>
        {([
          ['sendDailyReport', 'تضمين تقرير اليوم في الإرسال المجدول', 'عند تشغيل نسخة سطح المكتب يُرسل تلقائياً نهاية اليوم'],
          ['sendLowStock', 'تضمين تنبيهات النواقص', 'مع تقرير اليوم عند وجود أصناف تحت الحد'],
          ['sendBackups', 'تضمين نسخة احتياطية دورية', 'ملف كامل يُرسل مع التقرير — خط دفاع إضافي'],
        ] as const).map(([key, label, hint]) => (
          <label key={key} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
            <div>
              <div className="text-[12.5px] font-bold text-slate-600 dark:text-slate-300">{label}</div>
              <div className="text-[10.5px] text-slate-400">{hint}</div>
            </div>
            <input type="checkbox" checked={telegram[key]} onChange={(e) => updateTelegram({ [key]: e.target.checked })} className="w-4 h-4 accent-brand-600" />
          </label>
        ))}
      </section>

      {/* الجدولة التلقائية (القرار 32) */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3" style={{ animationDelay: '160ms' }}>
        <h2 className="text-[13px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <CalendarClock size={15} className="text-slate-400" /> الإرسال التلقائي اليومي
        </h2>
        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
          <div>
            <div className="text-[12.5px] font-bold text-slate-600 dark:text-slate-300">تفعيل الإرسال المجدول</div>
            <div className="text-[10.5px] text-slate-400">
              يُرسل التقرير والنسخة تلقائياً مرة واحدة يومياً بعد الساعة المحددة —
              ولو كان الجهاز مطفأً وقتها يُرسل فور أول تشغيل تالٍ
            </div>
          </div>
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => updateSchedule({ enabled: e.target.checked })} className="w-4 h-4 accent-brand-600" />
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <Field label="ساعة الإرسال اليومي">
            <QuickSelect
              value={schedule.hour}
              onChange={(e) => updateSchedule({ hour: sanitizeHour(e.target.value) })}
              className={inputCls}
              disabled={!schedule.enabled}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabelAr(h)}</option>
              ))}
            </QuickSelect>
          </Field>
          <div className="text-[11.5px] text-slate-400 pt-4">
            {lastDailySentDay ? `آخر إرسال تلقائي ناجح: ${lastDailySentDay}` : 'لم يُرسل تلقائياً بعد'}
          </div>
        </div>
      </section>
    </div>
  )
}
