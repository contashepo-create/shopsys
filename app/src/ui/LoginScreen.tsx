/**
 * شاشة تسجيل الدخول (طلب المالك — سد ثغرة انتحال الصلاحيات):
 * تحجب التطبيق كله حتى دخول صحيح بالرقم السري — لا تبديل مستخدم بدونها.
 * + استعادة كلمة السر: الموظف يسجل طلباً يصل المالك إشعاراً،
 *   والمالك يستلم رقماً مؤقتاً على تليجرام (مجاني وعبر الإنترنت) صالحاً 15 دقيقة.
 */
import { useMemo, useState } from 'react'
import { Crown, ShieldCheck, LogIn, KeyRound, Send, LifeBuoy } from 'lucide-react'
import { useDataStore } from '../data/repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { hashPin } from '../core/audit.ts'
import { generateTempPin, buildTempPinMessage, TEMP_PIN_TTL_MIN, lockoutMinutesLeft } from '../core/auth.ts'
import { apiUrl, isValidBotToken, isValidChatId } from '../core/telegram.ts'
import { Btn, Modal, inputCls, useToast } from './components/ui.tsx'

export function LoginScreen() {
  const { appUsers, login, requestPinReset, setOwnerTempPin, setOwnerPin, loginGuard } = useDataStore()
  const { setup, telegram } = useAppStore()
  const toast = useToast()

  const activeUsers = useMemo(() => appUsers.filter((u) => u.active), [appUsers])
  const [selected, setSelected] = useState<number | null>(null) // null = المالك
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  // بعد دخول برقم مؤقت: يُلزم المالك بتعيين رقم جديد فوراً
  const [mustSetNewPin, setMustSetNewPin] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')

  const lockLeft = lockoutMinutesLeft(loginGuard, new Date().toISOString())
  const telegramReady = isValidBotToken(telegram.botToken) && isValidChatId(telegram.chatId)

  const doLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { usedTempPin } = await login(selected, pin)
      setPin('')
      if (usedTempPin) setMustSetNewPin(true)
      else toast.show('أهلاً بك — دخول موفق ✅')
    } catch (e) {
      toast.show((e as Error).message, 'error')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const saveNewOwnerPin = async () => {
    try {
      if (newPin !== newPin2) throw new Error('الرقمان غير متطابقين')
      setOwnerPin(await hashPin(newPin))
      setMustSetNewPin(false)
      setNewPin(''); setNewPin2('')
      toast.show('حُفظ الرقم السري الجديد — احفظه جيداً ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /** الموظف نسي رقمه: طلب يصل المالك إشعاراً بالجرس وفي شاشة الصلاحيات */
  const forgotEmployee = () => {
    if (selected == null) return
    try {
      requestPinReset(selected)
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

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 via-white to-brand-500/10 dark:from-slate-950 dark:via-slate-900 dark:to-brand-500/10">
      <div className="w-full max-w-md space-y-5 anim-pop">
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">{setup.shopName || 'تَحَكَّم'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">اختر حسابك وأدخل رقمك السري للمتابعة</p>
        </div>

        <div className="rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
          {/* اختيار الحساب */}
          <div className="space-y-1.5">
            <button
              onClick={() => { setSelected(null); setPin('') }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-right transition-all ${selected == null ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}
            >
              <Crown size={15} className="text-amber-500 shrink-0" />
              <span className="text-[13px] font-bold flex-1 text-slate-800 dark:text-white">{setup.ownerName || 'المالك'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">👑 المالك</span>
            </button>
            {activeUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => { setSelected(u.id); setPin('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-right transition-all ${selected === u.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}
              >
                <ShieldCheck size={15} className="text-brand-500 shrink-0" />
                <span className="text-[13px] font-bold flex-1 text-slate-800 dark:text-white">{u.nameAr}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">{u.roleId}</span>
              </button>
            ))}
          </div>

          {/* الرقم السري */}
          <div className="space-y-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              maxLength={8}
              value={pin}
              disabled={lockLeft > 0}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) void doLogin() }}
              placeholder="● ● ● ●"
              className={`${inputCls} text-center !text-xl tracking-[0.5em] font-black`}
            />
            {lockLeft > 0 && (
              <p className="text-[11px] text-rose-500 font-bold text-center">
                ⛔ محاولات كثيرة خاطئة — انتظر {lockLeft} دقيقة ثم أعد المحاولة
              </p>
            )}
            <Btn className="w-full !py-3 !text-sm" onClick={() => void doLogin()} disabled={busy || pin.length < 4 || lockLeft > 0}>
              <LogIn size={16} /> {busy ? 'جارٍ التحقق…' : 'دخول'}
            </Btn>
          </div>

          {/* نسيت رقمي */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-center">
            {selected == null ? (
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
            {selected == null && !telegramReady && (
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

      {/* تعيين رقم جديد إجباري بعد الدخول برقم مؤقت */}
      <Modal open={mustSetNewPin} onClose={() => { /* إجباري — لا إغلاق قبل التعيين */ }} title="🔑 عيّن رقمك السري الجديد الآن">
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            دخلت برقم مؤقت من تليجرام وقد احترق باستخدامه. عيّن رقمك الدائم الجديد (4-8 أرقام) قبل المتابعة.
          </p>
          <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} placeholder="الرقم الجديد" className={`${inputCls} text-center tracking-widest`} />
          <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} placeholder="تأكيد الرقم" className={`${inputCls} text-center tracking-widest`} />
          <Btn className="w-full" onClick={() => void saveNewOwnerPin()} disabled={newPin.length < 4 || newPin2.length < 4}>
            <KeyRound size={15} /> حفظ الرقم الجديد
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
