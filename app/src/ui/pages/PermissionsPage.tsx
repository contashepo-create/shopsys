/**
 * شاشة الصلاحيات — تشيك بوكس بجانب كل صلاحية (القرار 12)
 * أقسام قابلة للطي + "تحديد الكل" + دور المالك محمي (القرار 11)
 * + إدارة المستخدمين الفرعيين (طلب المالك): اسم + دور + رقم سري —
 *   كل ما يفعله كل مستخدم يُسجل باسمه في سجل النشاطات (يراه المالك فقط).
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Crown, Lock, ShieldCheck, Plus, Users, UserX, SlidersHorizontal, KeyRound } from 'lucide-react'
import { PERMISSIONS, PERMISSION_SECTIONS, rolesWithOverrides } from '../../core/permissions.ts'
import { useDataStore } from '../../data/repo.ts'
import { hashPin, suggestRoleForJobTitle } from '../../core/audit.ts'
import { Btn, Field, inputCls, Modal, useToast } from '../components/ui.tsx'

export function PermissionsPage() {
  const [activeRoleId, setActiveRoleId] = useState('cashier')
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['sales']))
  const { appUsers, currentUserId, addAppUser, removeAppUser, updateAppUser, roleOverrides, setRolePermissions, setUserPermExceptions, ownerPinHash, setOwnerPin, pinResetRequests, resolvePinReset, employees } = useDataStore()
  // الأدوار محفوظة دائماً (البند 4): التعديلات في المخزن لا تضيع عند التحديث — والمالك محمي
  const roles = rolesWithOverrides(roleOverrides)
  const toast = useToast()
  const [userModal, setUserModal] = useState(false)
  // استثناءات فردية (البند 4 — لكل موظف): منح فوق الدور أو حجب رغم الدور
  const [excFor, setExcFor] = useState<number | null>(null)
  const [uRole, setURole] = useState('cashier')
  const [uPin, setUPin] = useState('')
  // سياسة المالك: الحساب يُبنى على موظف مسجل — بياناته وماليته في شاشة الموظفين
  const [uEmployeeId, setUEmployeeId] = useState(0)
  // 🔐 رقم المالك + إعادة تعيين أرقام الموظفين (استعادة كلمة السر)
  const [ownerPinModal, setOwnerPinModal] = useState(false)
  const [oPin, setOPin] = useState('')
  const [oPin2, setOPin2] = useState('')
  const [pinFor, setPinFor] = useState<number | null>(null)
  const [ePin, setEPin] = useState('')
  const [ePin2, setEPin2] = useState('')
  const openResets = pinResetRequests.filter((r) => r.status === 'open')

  const saveOwnerPin = async () => {
    try {
      if (oPin !== oPin2) throw new Error('الرقمان غير متطابقين')
      setOwnerPin(await hashPin(oPin))
      setOwnerPinModal(false); setOPin(''); setOPin2('')
      toast.show('حُفظ رقم المالك — شاشة الدخول مفعلة من الآن ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const saveEmployeePin = async () => {
    if (pinFor == null) return
    try {
      if (ePin !== ePin2) throw new Error('الرقمان غير متطابقين')
      const pinHash = await hashPin(ePin)
      const openReq = openResets.find((r) => r.userId === pinFor)
      if (openReq) resolvePinReset(openReq.id, 'done', pinHash)
      else updateAppUser(pinFor, { pinHash })
      // رقم من المدير = مبدئي دائماً: يظهر له في القائمة ويُجبر الموظف على تغييره بأول دخول
      updateAppUser(pinFor, { mustChangePin: true, initialPin: ePin })
      const name = appUsers.find((x) => x.id === pinFor)?.nameAr ?? ''
      setPinFor(null); setEPin(''); setEPin2('')
      toast.show(`عُيّن رقم مبدئي لـ«${name}» — سيُجبر على تغييره بأول دخول ✅`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const saveUser = async () => {
    try {
      const emp = employees.find((x) => x.id === uEmployeeId)
      if (!emp) throw new Error('اختر الموظف أولاً — الحساب يُبنى على موظف مسجل ببياناته المالية')
      const pinHash = await hashPin(uPin)
      addAppUser({
        nameAr: emp.nameAr, roleId: uRole, pinHash,
        employeeId: emp.id, phone: emp.phone, email: emp.email,
        initialPin: uPin, mustChangePin: true,
      })
      toast.show(`أُنشئ حساب «${emp.nameAr}» — سيُجبر على تغيير الرقم عند أول دخول ✓`)
      setUserModal(false); setUPin(''); setURole('cashier'); setUEmployeeId(0)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const activeRole = roles.find((r) => r.id === activeRoleId)!
  const isOwner = !!activeRole.isOwner
  const permSet = useMemo(() => new Set(activeRole.permissions), [activeRole])

  const togglePerm = (permId: string) => {
    if (isOwner) return // المالك محمي — كل الصلاحيات دائماً
    const next = activeRole.permissions.includes(permId)
      ? activeRole.permissions.filter((p) => p !== permId)
      : [...activeRole.permissions, permId]
    setRolePermissions(activeRoleId, next) // حفظ دائم — يسري فوراً على القائمة والمسارات
  }

  const toggleSection = (sectionId: string, checkAll: boolean) => {
    if (isOwner) return
    const sectionPerms = PERMISSIONS.filter((p) => p.section === sectionId).map((p) => p.id)
    const next = checkAll
      ? [...new Set([...activeRole.permissions, ...sectionPerms])]
      : activeRole.permissions.filter((p) => !sectionPerms.includes(p))
    setRolePermissions(activeRoleId, next)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* قائمة الأدوار */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 h-fit">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold text-slate-800 dark:text-white text-sm">الأدوار</h3>
          <button className="flex items-center gap-1 text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-500/10 px-2 py-1 rounded-lg transition-colors duration-200">
            <Plus size={13} /> دور جديد
          </button>
        </div>
        <div className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveRoleId(r.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                r.id === activeRoleId
                  ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300 font-bold shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {r.isOwner ? <Crown size={15} className="text-amber-500" /> : <ShieldCheck size={15} className="opacity-60" />}
              <span className="flex-1 text-right">{r.nameAr}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
                {r.isOwner ? 'الكل' : r.permissions.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* شبكة الصلاحيات */}
      <div className="lg:col-span-3 space-y-3">
        {isOwner && (
          <div className="anim-pop flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 text-sm">
            <Lock size={18} className="shrink-0" />
            <div>
              <b>دور المالك محمي بنيوياً</b> — يملك كل الصلاحيات بلا استثناء ولا يمكن تعديلها أو حذف الدور. هذا ضمانك الدائم للسيطرة الكاملة.
            </div>
          </div>
        )}

        {PERMISSION_SECTIONS.map((section, i) => {
          const sectionPerms = PERMISSIONS.filter((p) => p.section === section.id)
          const checkedCount = sectionPerms.filter((p) => permSet.has(p.id)).length
          const allChecked = checkedCount === sectionPerms.length
          const isOpen = openSections.has(section.id)

          return (
            <div
              key={section.id}
              style={{ animationDelay: `${i * 50}ms` }}
              className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() =>
                    setOpenSections((prev) => {
                      const n = new Set(prev)
                      if (n.has(section.id)) n.delete(section.id)
                      else n.add(section.id)
                      return n
                    })
                  }
                  className="flex items-center gap-3 flex-1 group"
                >
                  <span className="text-lg transition-transform duration-200 group-hover:scale-125">{section.icon}</span>
                  <span className="font-bold text-sm text-slate-800 dark:text-white">{section.nameAr}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${allChecked ? 'bg-emerald-500/15 text-emerald-600' : checkedCount ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                    {checkedCount}/{sectionPerms.length}
                  </span>
                  <ChevronDown size={15} className={`opacity-40 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <label className={`flex items-center gap-1.5 text-[11px] font-bold ${isOwner ? 'opacity-40' : 'cursor-pointer text-slate-500 hover:text-brand-600'} transition-colors duration-200`}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={isOwner}
                    onChange={(e) => toggleSection(section.id, e.target.checked)}
                    className="w-4 h-4 rounded accent-brand-600 cursor-pointer"
                  />
                  تحديد الكل
                </label>
              </div>

              <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {sectionPerms.map((perm) => {
                      const checked = permSet.has(perm.id)
                      return (
                        <label
                          key={perm.id}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-200 ${
                            isOwner ? 'opacity-70' : 'cursor-pointer hover:scale-[1.01]'
                          } ${
                            checked
                              ? 'border-brand-500/30 bg-brand-500/8'
                              : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isOwner}
                            onChange={() => togglePerm(perm.id)}
                            className="w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
                          />
                          <span className={`text-[13px] flex-1 ${checked ? 'text-slate-800 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                            {perm.nameAr}
                          </span>
                          {perm.sensitive && (
                            <span title="صلاحية حساسة" className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-bold shrink-0">حساسة</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        <p className="text-[11px] text-slate-400 px-2">
          📝 كل تغيير في الصلاحيات يُسجَّل في سجل التدقيق (من غيّر، ماذا، متى) — وثيقة التصميم، القرار 12.
        </p>

        {/* ─── المستخدمون الفرعيون (طلب المالك): كل ما يفعله كل مستخدم يُسجل باسمه ─── */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2">
              <Users size={16} className="text-brand-500" /> المستخدمون
            </h3>
            <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 !text-[12px] !py-1.5" onClick={() => setUserModal(true)}>
              <Plus size={13} /> مستخدم جديد
            </Btn>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            💡 اختر «المستخدم النشط» عند تبديل الشخص الذي يعمل على الجهاز — كل عملية بعدها تُسجل باسمه
            في <b>سجل النشاطات</b> (يظهر للمالك فقط). حذف المستخدم = تعطيله فقط، ليبقى تاريخه في السجل صحيحاً.
          </p>
          {/* 🔐 رقم المالك السري — شرط تفعيل شاشة الدخول وإضافة المستخدمين */}
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${ownerPinHash ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/8'}`}>
            <Crown size={14} className="text-amber-500 shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-bold">المالك</div>
              <div className="text-[10.5px] text-slate-400">
                {ownerPinHash ? 'محمي برقم سري — شاشة الدخول مفعلة ✓' : '⚠️ بلا رقم سري — عيّنه لتفعيل شاشة الدخول قبل إضافة موظفين'}
              </div>
            </div>
            <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 !text-[11px] !py-1" onClick={() => setOwnerPinModal(true)}>
              <KeyRound size={12} /> {ownerPinHash ? 'تغيير الرقم' : 'تعيين رقم سري'}
            </Btn>
          </div>

          {/* 🔑 طلبات استعادة كلمة السر المفتوحة — من شاشة الدخول */}
          {currentUserId == null && openResets.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 space-y-2">
              <div className="text-[12px] font-extrabold text-amber-600 dark:text-amber-400">🔑 طلبات استعادة رقم سري ({openResets.length})</div>
              {openResets.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 font-bold">{r.nameAr}</span>
                  <span className="text-[10px] text-slate-400">{r.requestedAt.slice(0, 16).replace('T', ' ')}</span>
                  <Btn className="!text-[11px] !py-1" onClick={() => setPinFor(r.userId)}>تعيين رقم جديد</Btn>
                  <Btn variant="ghost" className="!text-[11px] !py-1 border border-slate-200 dark:border-slate-700" onClick={() => { try { resolvePinReset(r.id, 'cancelled'); toast.show('أُلغي الطلب') } catch (err) { toast.show((err as Error).message, 'error') } }}>رفض</Btn>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {appUsers.filter((u) => u.active).map((u) => (
              <div key={u.id} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${currentUserId === u.id ? 'border-brand-500/40 bg-brand-500/8' : 'border-slate-100 dark:border-slate-800'}`}>
                <ShieldCheck size={14} className="text-slate-400" />
                <span className="text-[13px] font-bold flex-1">
                  {u.nameAr}
                  {u.employeeId != null && <span className="text-[9.5px] text-slate-400 font-normal mr-1.5">👥 موظف مربوط</span>}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">{roles.find((r) => r.id === u.roleId)?.nameAr ?? u.roleId}</span>
                {u.mustChangePin && u.initialPin && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-bold" title="الرقم المبدئي — سيختفي فور تغييره بأول دخول">
                    🔑 {u.initialPin}
                  </span>
                )}
                {u.mustChangePin && !u.initialPin && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-bold">لم يغيّر رقمه بعد</span>}
                {currentUserId === u.id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-600 font-bold">نشط الآن</span>}
                <button
                  onClick={() => setPinFor(u.id)}
                  title="إعادة تعيين الرقم السري لهذا المستخدم"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                >
                  <KeyRound size={13} />
                </button>
                <button
                  onClick={() => setExcFor(u.id)}
                  title="استثناءات فردية — منح أو حجب صلاحيات لهذا المستخدم تحديداً فوق دوره"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-brand-500 hover:bg-brand-500/10 transition-colors"
                >
                  <SlidersHorizontal size={13} />
                </button>
                <button
                  onClick={() => { try { removeAppUser(u.id); toast.show(`عُطل «${u.nameAr}» — تاريخه محفوظ في السجل`) } catch (err) { toast.show((err as Error).message, 'error') } }}
                  title="تعطيل المستخدم (تاريخه يبقى في سجل النشاطات)"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                >
                  <UserX size={13} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-slate-400 leading-relaxed">
            🔐 تبديل المستخدم لا يتم من هنا — من زر «تسجيل خروج» أعلى الشاشة ثم الدخول بالحساب الآخر برقمه السري.
          </p>
        </div>
      </div>

      {/* 🔐 تعيين/تغيير رقم المالك السري */}
      <Modal open={ownerPinModal} onClose={() => { setOwnerPinModal(false); setOPin(''); setOPin2('') }} title="🔐 الرقم السري للمالك">
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            من أول تعيين تُفعَّل شاشة الدخول: لا أحد يفتح التطبيق بلا رقمه السري، وكل دخول وخروج يُسجل.
            إن نسيت رقمك لاحقاً يصلك رقم مؤقت على تليجرامك (اربط البوت من الإعدادات).
          </p>
          <Field label="الرقم السري (4-8 أرقام)">
            <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={oPin} onChange={(e) => setOPin(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-widest`} />
          </Field>
          <Field label="تأكيد الرقم">
            <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={oPin2} onChange={(e) => setOPin2(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-widest`} />
          </Field>
          <Btn className="w-full" disabled={oPin.length < 4} onClick={() => void saveOwnerPin()}>
            <KeyRound size={15} /> حفظ
          </Btn>
        </div>
      </Modal>

      {/* 🔑 إعادة تعيين رقم سري لموظف (يغلق طلب الاستعادة إن وُجد) */}
      <Modal open={pinFor != null} onClose={() => { setPinFor(null); setEPin(''); setEPin2('') }} title={`🔑 رقم سري جديد — ${appUsers.find((x) => x.id === pinFor)?.nameAr ?? ''}`}>
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            عيّن الرقم الجديد ثم أبلغه للموظف بنفسك (هاتفياً أو واتساب) — النظام لا يخزن الرقم، فقط بصمته المشفرة.
          </p>
          <Field label="الرقم الجديد (4-8 أرقام)">
            <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={ePin} onChange={(e) => setEPin(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-widest`} />
          </Field>
          <Field label="تأكيد الرقم">
            <input type="password" inputMode="numeric" dir="ltr" maxLength={8} value={ePin2} onChange={(e) => setEPin2(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-widest`} />
          </Field>
          <Btn className="w-full" disabled={ePin.length < 4} onClick={() => void saveEmployeePin()}>
            <KeyRound size={15} /> حفظ وإغلاق الطلب
          </Btn>
        </div>
      </Modal>

      {/* ⚖️ استثناءات فردية لمستخدم (البند 4): الفعال = صلاحيات الدور ∪ الممنوح − المحجوب */}
      <Modal open={excFor != null} onClose={() => setExcFor(null)} title={(() => {
        const u = appUsers.find((x) => x.id === excFor)
        return u ? `⚖️ استثناءات «${u.nameAr}» — فوق دور ${roles.find((r) => r.id === u.roleId)?.nameAr ?? u.roleId}` : ''
      })()} wide>
        {excFor != null && (() => {
          const u = appUsers.find((x) => x.id === excFor)
          if (!u) return null
          const rolePerms = new Set(roles.find((r) => r.id === u.roleId)?.permissions ?? [])
          const extra = new Set(u.extraPerms ?? [])
          const denied = new Set(u.deniedPerms ?? [])
          const effective = (p: string) => (rolePerms.has(p) || extra.has(p)) && !denied.has(p)
          const toggle = (p: string) => {
            const nextExtra = new Set(extra); const nextDenied = new Set(denied)
            if (effective(p)) {
              // إطفاء: من الدور ⇒ حجب — من المنح الفردي ⇒ إزالة المنح
              if (rolePerms.has(p)) nextDenied.add(p)
              nextExtra.delete(p)
            } else {
              // تشغيل: كان محجوباً ⇒ فك الحجب — غير موجود أصلاً ⇒ منح فردي
              if (denied.has(p)) nextDenied.delete(p)
              else nextExtra.add(p)
            }
            try { setUserPermExceptions(u.id, [...nextExtra], [...nextDenied]) }
            catch (err) { toast.show((err as Error).message, 'error') }
          }
          return (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                💡 الشيك يعرض <b>الصلاحية الفعالة</b> لهذا المستخدم: تفعيلها فوق الدور = <b className="text-emerald-500">منح فردي</b>،
                وإطفاء صلاحية يمنحها الدور = <b className="text-rose-500">حجب فردي</b>. كل شيء يُحفظ فوراً ويسري على القائمة والمسارات.
              </p>
              {PERMISSION_SECTIONS.map((sec) => (
                <div key={sec.id}>
                  <div className="text-[11px] font-black text-slate-400 mb-1.5">{sec.icon} {sec.nameAr}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {PERMISSIONS.filter((p) => p.section === sec.id).map((p) => {
                      const on = effective(p.id)
                      const isException = extra.has(p.id) || denied.has(p.id)
                      return (
                        <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all text-[12px] ${on ? 'border-brand-500/30 bg-brand-500/8' : 'border-slate-100 dark:border-slate-800'}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="w-4 h-4 rounded accent-brand-600" />
                          <span className={`flex-1 ${on ? 'font-semibold text-slate-800 dark:text-white' : 'text-slate-500'}`}>{p.nameAr}</span>
                          {isException && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${extra.has(p.id) ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-500'}`}>
                              {extra.has(p.id) ? 'منح فردي' : 'محجوبة'}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div className="flex justify-end"><Btn onClick={() => setExcFor(null)}>تم</Btn></div>
            </div>
          )
        })()}
      </Modal>

      {/* مستخدم جديد — يُبنى على موظف مسجل (سياسة المالك) */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title="👤 حساب دخول جديد (من الموظفين)">
        <div className="space-y-4">
          <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed bg-sky-500/5 rounded-xl p-3">
            🧾 الحساب يُبنى على <b>موظف مسجل</b>: سجله أولاً في «شاشة الموظفين» ببياناته المالية
            (راتب/بدلات/هاتف) — فتُخصم عليه السلف وعجوزات الورديات وتُربط وردياته باسمه.
            ثم فعّل حساب دخوله من هنا برقم مبدئي <b>سيُجبر على تغييره عند أول دخول</b>.
          </p>
          <Field label="الموظف *" hint="غير موجود؟ أضفه من شاشة الموظفين أولاً — وظيفته تقترح دوره تلقائياً">
            <select
              value={uEmployeeId}
              onChange={(e) => {
                const id = Number(e.target.value)
                setUEmployeeId(id)
                const emp = employees.find((x) => x.id === id)
                if (emp?.jobTitle) setURole(suggestRoleForJobTitle(emp.jobTitle))
              }}
              className={inputCls}
            >
              <option value={0}>— اختر الموظف —</option>
              {employees
                .filter((e) => e.active && !appUsers.some((u) => u.active && u.employeeId === e.id))
                .map((e) => <option key={e.id} value={e.id}>{e.nameAr}{e.jobTitle ? ` — ${e.jobTitle}` : ''}</option>)}
            </select>
          </Field>
          <Field label="الدور" hint="اقتُرح تلقائياً من وظيفته — يمكنك تعديله">
            <select value={uRole} onChange={(e) => setURole(e.target.value)} className={inputCls}>
              {roles.filter((r) => !r.isOwner).map((r) => <option key={r.id} value={r.id}>{r.nameAr}</option>)}
            </select>
          </Field>
          <Field label="الرقم السري المبدئي (4–8 أرقام)" hint="سيظهر لك في القائمة حتى يغيّره الموظف بأول دخول — بعدها لا يعرفه أحد">
            <input value={uPin} onChange={(e) => setUPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className={inputCls} dir="ltr" placeholder="مثال: 1234" name="tahakam-initial-pin" autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setUserModal(false)}>إلغاء</Btn>
            <Btn onClick={saveUser} disabled={!uEmployeeId || uPin.length < 4}>إنشاء الحساب</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
