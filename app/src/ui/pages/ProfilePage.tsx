/**
 * صفحة «حسابي» — البروفايل الذاتي لكل مستخدم (طلب المالك):
 * النمط العالمي (Lightspeed: «كل مستخدم يعدل ملفه وأمانه بنفسه» / Square):
 *  1) تغيير الرقم السري بحرية بعد التحقق من الرقم الحالي — بلا مرور على المالك.
 *  2) تحديث بيانات التواصل (هاتف/بريد) والصورة الشخصية.
 *  3) المالك من نفس الصفحة يدير «هوية الدخول الموحد» الخاصة به (اسم/هاتف/بريد)
 *     لأن زر «دخول المالك» المميز أُلغي — المعرف هو ما يحدد حسابه.
 * الحقول الحساسة (الدور/الصلاحيات/التفعيل) ليست هنا — للمالك فقط في شاشة الصلاحيات.
 */
import { useRef, useState } from 'react'
import { validatePinFormat, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../../core/auth.ts'
import { UserCircle2, KeyRound, Camera, Save, ShieldCheck } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { phonePlaceholder } from '../../core/countries.ts'
import { hashPin } from '../../core/audit.ts'
import { Btn, Field, inputCls, useToast, PinInput } from '../components/ui.tsx'

/** ضغط الصورة إلى مربع صغير (Data URL) — تخزين محلي خفيف بلا ملفات خارجية */
function readAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = 160
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      const min = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')) }
    img.src = url
  })
}

export function ProfilePage() {
  const { appUsers, currentUserId, ownerProfile, updateOwnerProfile, changeMyPin, updateMyProfile } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const isOwner = currentUserId == null
  const me = appUsers.find((u) => u.id === currentUserId) ?? null

  const displayName = isOwner ? (ownerProfile.nameAr || setup.ownerName || 'المالك') : (me?.nameAr ?? '؟')
  const avatar = isOwner ? ownerProfile.avatarDataUrl : (me?.avatarDataUrl ?? '')

  // بيانات التواصل + هوية دخول المالك
  const [nameDraft, setNameDraft] = useState(isOwner ? (ownerProfile.nameAr || 'المالك') : '')
  const [phone, setPhone] = useState(isOwner ? ownerProfile.phone : (me?.phone ?? ''))
  const [email, setEmail] = useState(isOwner ? ownerProfile.email : (me?.email ?? ''))

  // تغيير الرقم السري
  const [curPin, setCurPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const saveContact = () => {
    try {
      if (isOwner) updateOwnerProfile({ nameAr: nameDraft, phone, email })
      else updateMyProfile({ phone, email })
      toast.show('حُفظت بياناتك ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const savePin = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (newPin !== newPin2) throw new Error('كلمتا السر الجديدتان غير متطابقتين')
      const fmtErr = validatePinFormat(newPin)
      if (fmtErr.length) throw new Error(fmtErr.join(' — '))
      await changeMyPin(curPin, await hashPin(newPin))
      setCurPin(''); setNewPin(''); setNewPin2('')
      toast.show('تغيّر رقمك السري — لا يعرفه أحد غيرك الآن ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }

  const pickAvatar = async (file: File | null) => {
    if (!file) return
    try {
      const dataUrl = await readAvatar(file)
      if (isOwner) updateOwnerProfile({ avatarDataUrl: dataUrl })
      else updateMyProfile({ avatarDataUrl: dataUrl })
      toast.show('تحدّثت صورتك ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* البطاقة التعريفية */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-6 flex items-center gap-5">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-20 h-20 rounded-2xl object-cover border-2 border-brand-500/30" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-brand-500/10 flex items-center justify-center">
              <UserCircle2 size={44} className="text-brand-500" />
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            title="تغيير الصورة الشخصية"
            className="absolute -bottom-2 -left-2 p-1.5 rounded-xl bg-brand-500 text-white shadow-lg hover:scale-110 transition-transform"
          >
            <Camera size={13} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickAvatar(e.target.files?.[0] ?? null)} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-800 dark:text-white truncate">{displayName}</h2>
          <div className="text-[12px] font-bold mt-0.5 flex items-center gap-1.5">
            {isOwner
              ? <span className="text-emerald-600 dark:text-emerald-400">👑 المالك — كل الصلاحيات</span>
              : <span className="text-brand-500">🛡️ {me?.roleId ?? '؟'}</span>}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            هنا تدير بياناتك أنت فقط — الأدوار والصلاحيات يديرها المالك من شاشة «المستخدمون والصلاحيات».
          </p>
        </div>
      </section>

      {/* بيانات التواصل + هوية دخول المالك */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '60ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <ShieldCheck size={17} className="text-brand-500" /> {isOwner ? 'هوية الدخول الموحد' : 'بيانات التواصل'}
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4 leading-relaxed">
          {isOwner
            ? 'ألغينا زر «دخول المالك» المميز — تدخل من نفس نموذج الجميع بأحد هذه المعرفات + رقمك السري، فلا يعرف الغريب أن للمالك مدخلاً خاصاً. اجعلها معرفات لا يخمنها أحد.'
            : 'اسمك أو هاتفك أو بريدك هو معرف دخولك — حدّثه هنا وسيعمل فوراً في شاشة الدخول.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {isOwner ? (
            <Field label="اسم الدخول" hint="الافتراضي «المالك» — غيّره لاسم لا يخمنه غيرك">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoComplete="off" className={inputCls} />
            </Field>
          ) : (
            <Field label="الاسم" hint="يغيّره المالك فقط من شاشة الصلاحيات">
              <input value={me?.nameAr ?? ''} readOnly className={`${inputCls} opacity-60 cursor-not-allowed`} />
            </Field>
          )}
          <Field label="الهاتف" hint="يصلح معرف دخول">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" autoComplete="off" className={inputCls} placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
          </Field>
          <Field label="البريد" hint="يصلح معرف دخول">
            <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="off" className={inputCls} />
          </Field>
        </div>
        <Btn className="mt-4" onClick={saveContact}><Save size={15} /> حفظ البيانات</Btn>
      </section>

      {/* تغيير الرقم السري — ذاتي بالكامل */}
      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '120ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <KeyRound size={17} className="text-amber-500" /> تغيير رقمي السري
        </h3>
        <p className="text-[11.5px] text-slate-400 mb-4">
          غيّره متى شئت — يلزم رقمك الحالي أولاً (النمط العالمي). لو نسيته: زر «نسيت رقمي السري» في شاشة الدخول.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="كلمة السر الحالية">
            <PinInput value={curPin} onChange={setCurPin} centered />
          </Field>
          <Field label="كلمة السر الجديدة" hint={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} خانة — أرقام وحروف ورموز`}>
            <PinInput value={newPin} onChange={setNewPin} centered />
          </Field>
          <Field label="تأكيد كلمة السر الجديدة">
            <PinInput value={newPin2} onChange={setNewPin2} centered />
          </Field>
        </div>
        <Btn className="mt-4" onClick={() => void savePin()} disabled={busy || curPin.length === 0 || newPin.length < PIN_MIN_LENGTH || newPin2.length < PIN_MIN_LENGTH}>
          <KeyRound size={15} /> {busy ? 'جارٍ الحفظ…' : 'تغيير الرقم'}
        </Btn>
      </section>
    </div>
  )
}
