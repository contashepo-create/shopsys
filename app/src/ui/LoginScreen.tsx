/**
 * شاشة تسجيل الدخول (طلب المالك — سد ثغرة انتحال الصلاحيات):
 * تحجب التطبيق كله حتى دخول صحيح بالرقم السري — لا تبديل مستخدم بدونها،
 * وتُفرض من جديد في كل مرة يُفتح فيها التطبيق فعلياً (إغلاق وإعادة فتح)
 * حتى لو لم يُسجَّل خروج صريح — عبر `sessionAuth` المحصور بعمر النافذة
 * (مراجعة المالك الثالثة: جهاز POS مشترك يحتاج محاسبة دخول/خروج دقيقة).
 * سياسة المالك المحدَّثة (عكَست «لا قائمة أسماء» السابقة): تُعرض بطاقات
 * بأسماء من استخدموا هذا الجهاز من قبل للاختيار السريع، أو «مستخدم جديد»
 * لكتابة معرّف غير مسجَّل بعد — الاسم فقط يُحفظ (لا كلمة سر إطلاقاً، تُكتب
 * يدوياً كل مرة — طلب المالك الأمني الرابع).
 * **دخول موحّد بلا زر مالك مميز** (مراجعة المالك الثانية): المالك يدخل من نفس
 * النموذج بمعرفه الخاص — فلا يعرف الغريب أن للمالك مدخلاً خاصاً أصلاً.
 * + أول دخول لموظف برقم مبدئي من المدير ⇒ تغيير الرقم إجباري قبل المتابعة.
 * + استعادة كلمة السر: الموظف يسجل طلباً يصل المالك إشعاراً،
 *   والمالك يستلم رقماً مؤقتاً على تليجرام صالحاً 15 دقيقة.
 */
import { useState } from 'react'
import { LogIn, KeyRound, LifeBuoy, UserPlus, X, ChevronRight } from 'lucide-react'
import { useRawDataStore } from '../data/repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { hashPin, findUserByIdentifier, matchesOwnerIdentity } from '../core/audit.ts'
import { generateTempPin, buildTempPinMessage, TEMP_PIN_TTL_MIN, lockoutMinutesLeft, validatePinFormat, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../core/auth.ts'
import { apiUrl, isValidBotToken, isValidChatId } from '../core/telegram.ts'
import { loadRecentLogins, rememberRecentLogin, forgetRecentLogin, purgeLegacySavedPin, type RecentLogin } from '../data/recentLogins.ts'
import { markSessionAuthenticated } from '../data/sessionAuth.ts'
import { Btn, Modal, inputCls, PinInput, useToast } from './components/ui.tsx'


export function LoginScreen() {
  /* الهوية لا تُصفّى بالفرع أبداً: شاشة الدخول تقرأ المتجر الخام حتى ترى
     مستخدمي كل الفروع — المتجر المصفّى (useDataStore) يحصر appUsers في
     الفرع النشط، فكان مستخدم فرع آخر يختفي من البحث ويُرفض دخوله الصحيح
     (بلاغ المالك 2026-10-22) — وloginGuard/ownerProfile خامان أصحّ أيضاً. */
  const { appUsers, login, requestPinReset, setOwnerTempPin, setOwnerPin, changeOwnPin, loginGuard, currentUserId, loggedOut, ownerProfile } = useRawDataStore()
  const { setup, telegram } = useAppStore()
  const toast = useToast()

  /** دخول موحد: الجميع (مالكاً وموظفين) يكتبون المعرف + الرقم في نفس النموذج */
  const [identifier, setIdentifier] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  // بطاقات «من استخدم هذا الجهاز من قبل» (طلب المالك): اختيار سريع للاسم
  // فقط — كلمة السر تُكتب يدوياً دوماً ولا تُحفظ إطلاقاً. أول ظهور بلا
  // بطاقات محفوظة ⇒ النموذج اليدوي مباشرة (لا شاشة اختيار فارغة).
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>(() => {
    purgeLegacySavedPin() // تنظيف ميراث كلمة السر المحفوظة من إصدار سابق
    return loadRecentLogins()
  })
  const [picking, setPicking] = useState(() => recentLogins.length > 0)
  const pickUser = (r: RecentLogin) => {
    setIdentifier(r.identifier)
    setPin('')
    setPicking(false)
  }
  const pickNewUser = () => {
    setIdentifier('')
    setPin('')
    setPicking(false)
  }
  const forgetUser = (r: RecentLogin) => {
    forgetRecentLogin(r.identifier)
    setRecentLogins((prev) => prev.filter((x) => x.identifier !== r.identifier))
  }
  // إجبار تعيين رقم جديد: للمالك بعد رقم مؤقت، وللموظف عند أول دخول
  const [mustSetNewPin, setMustSetNewPin] = useState<null | { kind: 'owner' } | { kind: 'employee'; userId: number }>(null)
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')

  // إصلاح باج «إجبار تغيير الرقم» (بلاغ المالك): الاعتماد على حالة محلية فقط كان
  // يُسقط المودال إذا أُعيد تركيب الشاشة بعد login() — الآن يُشتق من المخزن مباشرة:
  // مستخدم داخل (غير خارج) وعليه mustChangePin ⇒ المودال إجباري مهما حدث للحالة المحلية
  const storeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const forcedChange: null | { kind: 'employee'; userId: number } =
    !loggedOut && storeUser?.mustChangePin ? { kind: 'employee', userId: storeUser.id } : null
  const effectiveMustSet = forcedChange ?? mustSetNewPin

  const lockLeft = lockoutMinutesLeft(loginGuard, new Date().toISOString())
  const telegramReady = isValidBotToken(telegram.botToken) && isValidChatId(telegram.chatId)

  const doLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      // المعرف يحدد الحساب: هوية المالك أولاً (الافتراضية «المالك» حتى يخصصها من بروفايله)
      // + اسم المالك المكتوب في ويزارد الإعداد يعمل كمعرف أيضاً — حتى لا يُحبس مالك لم يخصص هويته
      const ownerByWizardName = !!setup.ownerName?.trim() && identifier.trim() === setup.ownerName.trim()
      if (matchesOwnerIdentity(ownerProfile, identifier) || ownerByWizardName) {
        const { usedTempPin } = await login(null, pin)
        markSessionAuthenticated()
        rememberRecentLogin(identifier, ownerProfile.nameAr?.trim() || 'المالك')
        setPin('')
        if (usedTempPin) setMustSetNewPin({ kind: 'owner' })
        else toast.show('أهلاً بك — دخول موفق ✅')
      } else {
        const user = findUserByIdentifier(appUsers, identifier)
        // رسالة واحدة عامة سواء أخطأ المعرف أو الرقم — لا نكشف أي الاثنين خاطئ
        if (!user) throw new Error('بيانات الدخول غير صحيحة — تحقق من المعرف والرقم السري')
        const { mustChangePin } = await login(user.id, pin)
        markSessionAuthenticated()
        rememberRecentLogin(identifier, user.nameAr)
        setPin('')
        if (mustChangePin) {
          setMustSetNewPin({ kind: 'employee', userId: user.id })
        } else {
          toast.show(`أهلاً ${user.nameAr} — دخول موفق ✅`)
        }
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
      const fmtErrors = validatePinFormat(newPin)
      if (fmtErrors.length) throw new Error(fmtErrors.join(' — '))
      const hash = await hashPin(newPin)
      if (effectiveMustSet?.kind === 'employee') await changeOwnPin(effectiveMustSet.userId, hash, newPin)
      else setOwnerPin(hash)
      setMustSetNewPin(null)
      setNewPin(''); setNewPin2('')
      toast.show('حُفظت كلمة سرك الجديدة — لا يعرفها أحد غيرك الآن ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /**
   * «نسيت رقمي» موحد: المعرف يحدد المسار —
   * هوية المالك ⇒ رقم مؤقت عبر تليجرام؛ موظف ⇒ طلب يصل المالك إشعاراً بالجرس.
   */
  const forgotUnified = () => {
    if (matchesOwnerIdentity(ownerProfile, identifier) || (!!setup.ownerName?.trim() && identifier.trim() === setup.ownerName.trim())) {
      void forgotOwner()
      return
    }
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

  // كلمة السر الجديدة والرقم المؤقت يلتزمان بحد 6-32؛ لا نرسل نموذجاً أقصر من السياسة الحالية.
  const canSubmit = pin.length >= PIN_MIN_LENGTH && identifier.trim().length > 0

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 via-white to-brand-500/10 dark:from-slate-950 dark:via-slate-900 dark:to-brand-500/10">
      <div className="w-full max-w-md space-y-5 anim-pop">
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">{setup.shopName || 'تَحَكَّم'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري
          </p>
        </div>

        <div className="rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
          {picking ? (
            /* بطاقات «من استخدم هذا الجهاز من قبل» — اختيار سريع للاسم فقط،
               كلمة السر دوماً تُكتب يدوياً بعد الاختيار (لا تُحفظ إطلاقاً) */
            <div className="space-y-2">
              {recentLogins.map((r) => (
                <button
                  key={r.identifier}
                  type="button"
                  onClick={() => pickUser(r)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-brand-500/50 hover:bg-brand-500/5 transition-colors text-right"
                >
                  <span className="w-9 h-9 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300 flex items-center justify-center font-black text-sm shrink-0">
                    {r.displayName.trim().charAt(0) || '؟'}
                  </span>
                  <span className="flex-1 min-w-0 font-bold text-[13px] text-slate-800 dark:text-white truncate">{r.displayName}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); forgetUser(r) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); forgetUser(r) } }}
                    title="إزالة هذا الاسم من قائمة الجهاز"
                    className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                  >
                    <X size={14} />
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={pickNewUser}
                className="w-full flex items-center justify-center gap-2 px-3.5 py-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-brand-500/50 hover:text-brand-600 transition-colors font-bold text-[13px]"
              >
                <UserPlus size={15} /> مستخدم جديد
              </button>
            </div>
          ) : (
            <>
              {recentLogins.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setPicking(true); setIdentifier(''); setPin('') }}
                  className="inline-flex items-center gap-1 text-[11.5px] font-bold text-slate-400 hover:text-brand-600 transition-colors"
                >
                  <ChevronRight size={13} /> عودة لاختيار مستخدم
                </button>
              )}
              {/* دخول موحد (مراجعة المالك): لا زر «دخول المالك» مميز —
                  المالك والموظفون يدخلون من نفس الحقلين */}
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
                autoFocus={identifier === ''}
              />

              {/* كلمة السر — بعين إظهار/إخفاء، تُكتب يدوياً دوماً ولا تُحفظ أبداً (طلب المالك) */}
              <div className="space-y-2 mt-3">
                <PinInput
                  value={pin}
                  onChange={setPin}
                  disabled={lockLeft > 0}
                  onEnter={() => { if (canSubmit) void doLogin() }}
                  placeholder="كلمة السر"
                  name="tahakam-login-pin"
                  centered
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

              {/* نسيت رقمي — موحد: المعرف يحدد المسار (مالك ⇒ تليجرام، موظف ⇒ إبلاغ المالك) */}
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-center mt-3">
                <button
                  onClick={forgotUnified}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
                >
                  <LifeBuoy size={13} /> نسيت رقمي السري
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[10.5px] text-slate-400">
          كل دخول وخروج يُسجَّل في سجل النشاطات باسم صاحبه — صفر انتحال صلاحيات.
        </p>
      </div>

      {/* تعيين رقم جديد إجباري: مالك برقم مؤقت أو موظف بأول دخول */}
      <Modal open={effectiveMustSet != null} onClose={() => { /* إجباري — لا إغلاق قبل التعيين */ }} title="🔑 عيّن رقمك السري الجديد الآن">
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {effectiveMustSet?.kind === 'employee'
              ? `هذا أول دخول لك بكلمة سر مبدئية من المدير — عيّن كلمتك الخاصة الآن (${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} خانة: أرقام وحروف ورموز). بعد الحفظ لا يعرفها أحد غيرك.`
              : `دخلت برقم مؤقت من تليجرام وقد احترق باستخدامه. عيّن كلمة سرك الدائمة الجديدة (${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} خانة) قبل المتابعة.`}
          </p>
          <PinInput value={newPin} onChange={setNewPin} placeholder="كلمة السر الجديدة" centered />
          <PinInput value={newPin2} onChange={setNewPin2} placeholder="تأكيد كلمة السر" centered />
          <Btn className="w-full" onClick={() => void saveNewPin()} disabled={newPin.length < PIN_MIN_LENGTH || newPin2.length < PIN_MIN_LENGTH}>
            <KeyRound size={15} /> حفظ كلمة السر الجديدة
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
