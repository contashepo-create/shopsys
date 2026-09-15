/**
 * شاشة الصلاحيات — تشيك بوكس بجانب كل صلاحية (القرار 12)
 * أقسام قابلة للطي + "تحديد الكل" + دور المالك محمي (القرار 11)
 * + إدارة المستخدمين الفرعيين (طلب المالك): اسم + دور + رقم سري —
 *   كل ما يفعله كل مستخدم يُسجل باسمه في سجل النشاطات (يراه المالك فقط).
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Crown, Lock, ShieldCheck, Plus, Users, UserX } from 'lucide-react'
import { PERMISSIONS, PERMISSION_SECTIONS, DEFAULT_ROLES, type Role } from '../../core/permissions.ts'
import { useDataStore } from '../../data/repo.ts'
import { hashPin } from '../../core/audit.ts'
import { Btn, Field, inputCls, Modal, useToast } from '../components/ui.tsx'

export function PermissionsPage() {
  const [roles, setRoles] = useState<Role[]>(DEFAULT_ROLES)
  const [activeRoleId, setActiveRoleId] = useState('cashier')
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['sales']))
  const { appUsers, currentUserId, addAppUser, removeAppUser, setCurrentUser } = useDataStore()
  const toast = useToast()
  const [userModal, setUserModal] = useState(false)
  const [uName, setUName] = useState('')
  const [uRole, setURole] = useState('cashier')
  const [uPin, setUPin] = useState('')

  const saveUser = async () => {
    try {
      const pinHash = await hashPin(uPin)
      addAppUser({ nameAr: uName, roleId: uRole, pinHash })
      toast.show(`أُضيف المستخدم «${uName}» — كل ما يفعله سيُسجل باسمه في سجل النشاطات ✓`)
      setUserModal(false); setUName(''); setUPin(''); setURole('cashier')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const activeRole = roles.find((r) => r.id === activeRoleId)!
  const isOwner = !!activeRole.isOwner
  const permSet = useMemo(() => new Set(activeRole.permissions), [activeRole])

  const togglePerm = (permId: string) => {
    if (isOwner) return // المالك محمي — كل الصلاحيات دائماً
    setRoles((prev) =>
      prev.map((r) =>
        r.id === activeRoleId
          ? {
              ...r,
              permissions: r.permissions.includes(permId)
                ? r.permissions.filter((p) => p !== permId)
                : [...r.permissions, permId],
            }
          : r,
      ),
    )
  }

  const toggleSection = (sectionId: string, checkAll: boolean) => {
    if (isOwner) return
    const sectionPerms = PERMISSIONS.filter((p) => p.section === sectionId).map((p) => p.id)
    setRoles((prev) =>
      prev.map((r) =>
        r.id === activeRoleId
          ? {
              ...r,
              permissions: checkAll
                ? [...new Set([...r.permissions, ...sectionPerms])]
                : r.permissions.filter((p) => !sectionPerms.includes(p)),
            }
          : r,
      ),
    )
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
          <div className="space-y-1.5">
            <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${currentUserId == null ? 'border-amber-500/40 bg-amber-500/8' : 'border-slate-100 dark:border-slate-800'}`}>
              <input type="radio" checked={currentUserId == null} onChange={() => setCurrentUser(null)} className="w-4 h-4 accent-amber-500" />
              <Crown size={14} className="text-amber-500" />
              <span className="text-[13px] font-bold flex-1">المالك (الافتراضي)</span>
              {currentUserId == null && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-bold">نشط الآن</span>}
            </label>
            {appUsers.filter((u) => u.active).map((u) => (
              <label key={u.id} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${currentUserId === u.id ? 'border-brand-500/40 bg-brand-500/8' : 'border-slate-100 dark:border-slate-800'}`}>
                <input type="radio" checked={currentUserId === u.id} onChange={() => setCurrentUser(u.id)} className="w-4 h-4 accent-brand-600" />
                <ShieldCheck size={14} className="text-slate-400" />
                <span className="text-[13px] font-bold flex-1">{u.nameAr}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">{roles.find((r) => r.id === u.roleId)?.nameAr ?? u.roleId}</span>
                {currentUserId === u.id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-600 font-bold">نشط الآن</span>}
                <button
                  onClick={(e) => { e.preventDefault(); try { removeAppUser(u.id); toast.show(`عُطل «${u.nameAr}» — تاريخه محفوظ في السجل`) } catch (err) { toast.show((err as Error).message, 'error') } }}
                  title="تعطيل المستخدم (تاريخه يبقى في سجل النشاطات)"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                >
                  <UserX size={13} />
                </button>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* مستخدم جديد */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title="👤 مستخدم جديد">
        <div className="space-y-4">
          <Field label="الاسم">
            <input value={uName} onChange={(e) => setUName(e.target.value)} className={inputCls} placeholder="أحمد الكاشير" />
          </Field>
          <Field label="الدور" hint="يحدد صلاحياته من جدول الصلاحيات أعلاه">
            <select value={uRole} onChange={(e) => setURole(e.target.value)} className={inputCls}>
              {roles.filter((r) => !r.isOwner).map((r) => <option key={r.id} value={r.id}>{r.nameAr}</option>)}
            </select>
          </Field>
          <Field label="الرقم السري (4–8 أرقام)" hint="يُخزن مشفراً — لا يمكن استرجاعه، فقط تغييره">
            <input value={uPin} onChange={(e) => setUPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className={inputCls} dir="ltr" type="password" placeholder="••••" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setUserModal(false)}>إلغاء</Btn>
            <Btn onClick={saveUser} disabled={!uName.trim() || uPin.length < 4}>حفظ المستخدم</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
