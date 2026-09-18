/**
 * شاشة تسجيل الدخول (طلب المالك — سد ثغرة انتحال الصلاحيات):
 * تحجب التطبيق كله حتى دخول صحيح بالرقم السري — لا تبديل مستخدم بدونها.
 * سياسة المالك (المراجعة الأمنية): **لا قائمة أسماء تُعرض** — كل مستخدم يكتب
 * معرّفه بنفسه (اسمه كاملاً أو هاتفه أو بريده) كالنظم العالمية، فلا يعرف
 * الغريب أسماء الحسابات ولا عددها. المالك يدخل من زر «دخول المالك».
 * + أول دخول لموظف برقم مبدئي من المدير ⇒ تغيير الرقم إجباري قبل المتابعة.
 * + استعادة كلمة السر: الموظف يسجل طلباً يصل المالك إشعاراً،
 *   والمالك يستلم رقماً مؤقتاً على تليجرام صالحاً 15 دقيقة.
 */
import { useState } from 'react'
import { Crown, UserCircle2, LogIn, KeyRound, Send, LifeBuoy } from 'lucide-react'
import { useDataStore } from '../data/repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { hashPin, findUserByIdentifier } from '../core/audit.ts'
import { generateTempPin, buildTempPinMessage, TEMP_PIN_TTL_MIN, lockoutMinutesLeft } from '../core/auth.ts'
import { apiUrl, isValidBotToken, isValidChatId } from '../core/telegram.ts'
import { Btn, Modal, inputCls, useToast } from './components/ui.tsx'

export function LoginScreen() {
  const { appUsers, login, requestPinReset, setOwnerTempPin, setOwnerPin, changeOwnPin, loginGuard } = useDataStore()
  const { setup, telegram } = useAppStore()
  const toast = useToast()

  /** وضعان: موظف (يكتب معرفه بنفسه) أو المالك (زر صريح) */
  const [mode, setMode] = useState<'employee' | 'owner'>('employee')
  const [identifier, setIdentifier] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  // إجبار تعيين رقم جديد: للمالك بعد رقم مؤقت، وللموظف عند أول دخول
  const [mustSetNewPin, setMustSetNewPin] = useState<null | { kind: 'owner' } | { kind: 'employee'; userId: number }>(null)
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')

  const lockLeft = lockoutMinutesLeft(loginGuard, new Date().toISOString())
  const telegramReady = isValidBotToken(telegram.botToken) && isValidChatId(telegram.chatId)

  const doLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'employee') {
        const user = findUserByIdentifier(appUsers, identifier)
        // رسالة واحدة عامة سواء أخطأ المعرف أو الرقم — لا نكشف أي الاثنين خاطئ
        if (!user) throw new Error('بيانات الدخول غير صحيحة — تحقق من المعرف والرقم السري')
        const { mustChangePin } = await login(user.id, pin)
        setPin('')
        if (mustChangePin) {
          setMustSetNewPin({ kind: 'employee', userId: user.id })
        } else {
          toast.show(`أهلاً ${user.nameAr} — دخول موفق ✅`)
        }
      } else {
        const { usedTempPin } = await login(null, pin)
        setPin('')
        if (usedTempPin) setMustSetNewPin({ kind: 'owner' })
        else toast.show('أهلاً بك — دخول موفق ✅')
      }
    } catch (e) {
      toast.show((e as Error).message, 'error')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const saveNewPin = async () => {
    try {
      if (newPin !== newPin2) throw new Error('الرقمان غير متطابقين')
      const hash = await hashPin(newPin)
      if (mustSetNewPin?.kind === 'employee') changeOwnPin(mustSetNewPin.userId, hash)
      else setOwnerPin(hash)
      setMustSetNewPin(null)
      setNewPin(''); setNewPin2('')
      toast.show('حُفظ رقمك السري الجديد — لا يعرفه أحد غيرك الآن ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /** الموظف نسي رقمه: طلب يصل المالك إشعاراً بالجرس وفي شاشة الصلاحيات */
  const forgotEmployee = () => {
    const user = findUserByIdentifier(appUsers, identifier)
    if (!user) {
      toast.show('اكتب اسمك أو هاتفك أو بريدك أولاً حتى نعرف صاحب الطلب', 'error')
      return
    }
    try {
      requestPinReset(user.id)
      toast.show('أُبلغ المالك بطلبك — سيعيّن لك رقماً جديداً ويخبرك به')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /** المالك نسي رقمه: رقم مؤقت 6 خانات يُرسل إلى تليجرام المالك عبر بوته */
  const forgotOwner = async () => {
    if (!telegramReady) {
      toast.show('استعادة المالك تحتاج ربط بوت التليجرام أولاً (إعدادات ← بوت التليجرام)', 'error')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      const temp = generateTempPin()
      const expiresAt = new Date(Date.now() + TEMP_PIN_TTL_MIN * 60_000).toISOString()
      const res = await fetch(apiUrl(telegram.botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: buildTempPinMessage(setup.shopName, temp, TEMP_PIN_TTL_MIN) }),
      })
      const data = (await res.json()) as { ok: boolean; description?: string }
      if (!data.ok) throw new Error(data.description || 'رفض تليجرام الإرسال — تحقق من البوت')
      // التجزئة فقط تُخزن — الرقم نفسه لا يلمس القرص أبداً
      setOwnerTempPin({ pinHash: await hashPin(temp), expiresAt })
      toast.show(`أُرسل رقم مؤقت إلى تليجرامك — صالح ${TEMP_PIN_TTL_MIN} دقيقة ✅`)
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'تعذر الوصول إلى تليجرام — تحقق من الإنترنت', 'error')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = pin.length >= 4 && (mode === 'owner' || identifier.trim().length > 0)

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 via-white to-brand-500/10 dark:from-slate-950 dark:via-slate-900 dark:to-brand-500/10">
      <div className="w-full max-w-md space-y-5 anim-pop">
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">{setup.shopName || 'تَحَكَّم'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === 'employee' ? 'اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري' : 'أدخل الرقم السري للمالك'}
          </p>
        </div>

        <div className="rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
          {/* تبديل الوضع: موظف / مالك — لا قائمة أسماء تُعرض أبداً */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setMode('employee'); setPin('') }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[12px] font-bold transition-all ${mode === 'employee' ? 'border-brand-500/50 bg-brand-500/10 text-brand-600 dark:text-brand-400' : 'border-slate-100 dark:border-slate-800 text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'}`}
            >
              <UserCircle2 size={15} /> موظف
            </button>
            <button
              onClick={() => { setMode('owner'); setIdentifier(''); setPin('') }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[12px] font-bold transition-all ${mode === 'owner' ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-slate-100 dark:border-slate-800 text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'}`}
            >
              <Crown size={15} /> دخول المالك
            </button>
          </div>

          {/* معرّف الموظف: يكتبه بنفسه — name="tahakam-login-id" وautoComplete=off لمنع اقتراحات المتصفح */}
          {mode === 'employee' && (
            <input
              type="text"
              name="tahakam-login-id"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={identifier}
              disabled={lockLeft > 0}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="الاسم الكامل أو رقم الهاتف أو البريد"
              className={inputCls}
            />
          )}

          {/* الرقم السري */}
          <div className="space-y-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              name="tahakam-login-pin"
              dir="ltr"
              maxLength={8}
              value={pin}
              disabled={lockLeft > 0}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void doLogin() }}
              placeholder="● ● ● ●"
              className={`${inputCls} text-center !text-xl tracking-[0.5em] font-black`}
            />
            {lockLeft > 0 && (
              <p className="text-[11px] text-rose-500 font-bold text-center">
                ⛔ محاولات كثيرة خاطئة — انتظر {lockLeft} دقيقة ثم أعد المحاولة
              </p>
            )}
            <Btn className="w-full !py-3 !text-sm" onClick={() => void doLogin()} disabled={busy || !canSubmit || lockLeft > 0}>
              <LogIn size={16} /> {busy ? 'جارٍ التحقق…' : 'دخول'}
            </Btn>
          </div>

          {/* نسيت رقمي */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-center">
            {mode === 'owner' ? (
              <button
                onClick={() => void forgotOwner()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                <Send size={13} /> نسيت رقمي — أرسل رقماً مؤقتاً إلى تليجرامي
              </button>
            ) : (
              <button
                onClick={forgotEmployee}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                <LifeBuoy size={13} /> نسيت رقمي — إبلاغ المالك ليعيد تعيينه
              </button>
            )}
            {mode === 'owner' && !telegramReady && (
              <p className="text-[10.5px] text-slate-400 mt-1.5 leading-relaxed">
                💡 لتفعيل استعادة رقم المالك: اربط بوت التليجرام من «الإعدادات ← بوت التليجرام» وأنت داخل.
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-[10.5px] text-slate-400">
          كل دخول وخروج يُسجَّل في سجل النشاطات باسم صاحبه — صفر انتحال صلاحيات.
        </p>
      </div>

      {/* تعيين رقم جديد إجباري: مالك برقم مؤقت أو موظف بأول دخول */}
      <Modal open={mustSetNewPin != null} onClose={() => { /* إجباري — لا إغلاق قبل التعيين */ }} title="🔑 عيّن رقمك السري الجديد الآن">
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {mustSetNewPin?.kind === 'employee'
              ? 'هذا أول دخول لك برقم مبدئي من المدير — عيّن رقمك الخاص الآن (4-8 أرقام). بعد الحفظ لا يعرفه أحد غيرك.'
              : 'دخلت برقم مؤقت من تليجرام وقد احترق باستخدامه. عيّن رقمك الدائم الجديد (4-8 أرقام) قبل المتابعة.'}
          </p>
          <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} placeholder="الرقم الجديد" className={`${inputCls} text-center tracking-widest`} />
          <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} placeholder="تأكيد الرقم" className={`${inputCls} text-center tracking-widest`} />
          <Btn className="w-full" onClick={() => void saveNewPin()} disabled={newPin.length < 4 || newPin2.length < 4}>
            <KeyRound size={15} /> حفظ الرقم الجديد
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
