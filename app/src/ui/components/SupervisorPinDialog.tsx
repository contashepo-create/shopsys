/**
 * بوابة موافقة المشرف (نمط Square/Toast/Roller — طلب المالك):
 * ─────────────────────────────────────────────────────────
 * أي عملية حساسة (مرتجع/استبدال/تسوية…) ينفذها مستخدم لا يملك صلاحية
 * اعتمادها تفتح هذا الحوار: يُدخل المشرف/المالك رقمه السري فيُعتمد التنفيذ
 * ويُسجَّل اسم المعتمد على المستند وفي سجل التدقيق.
 * المالك (أو من مُنح صلاحية الاعتماد) يمر مباشرة بلا حوار.
 *
 * الاستخدام:
 *   const approval = useSupervisorApproval() // أو useSupervisorApproval('inv.adjust')
 *   approval.request((approvedBy) => doTheThing(approvedBy))
 *   … ثم {approval.dialog} في الـJSX
 */
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff } from 'lucide-react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../core/auth.ts'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { needsSupervisorPin, REFUND_APPROVE_PERM } from '../../core/refundApproval.ts'

export function useSupervisorApproval(permId: string = REFUND_APPROVE_PERM, options: { forcePin?: boolean } = {}): {
  /** هل سيُطلب رقم سري من المستخدم الحالي؟ (لعرض تلميح في الشاشة) */
  willAskPin: boolean
  /** نفّذ عملية بموافقة: تمر فوراً للمخول، وتفتح حوار الرقم لغيره */
  request: (onApproved: (approvedBy?: string) => void) => void
  /** حوار الرقم — ضعه في نهاية JSX الصفحة */
  dialog: React.ReactNode
} {
  const { appUsers, currentUserId, roleOverrides, customRoles, approveByPin } = useDataStore()
  const [pending, setPending] = useState<((approvedBy?: string) => void) | null>(null)
  const [showPin, setShowPin] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, useAppStore.getState().setup.activityId))
  const decision = needsSupervisorPin(activeUser, perms, permId)
  const needsPin = options.forcePin === true || decision.needsPin

  const request = useCallback((onApproved: (approvedBy?: string) => void) => {
    if (!needsPin) {
      onApproved(undefined) // مخول — يمر مباشرة، والختم باسمه
      return
    }
    setPin(''); setError(''); setPending(() => onApproved)
  }, [needsPin])

  const confirm = async () => {
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      const { approvedBy } = await approveByPin(pin, permId)
      const cb = pending
      setPending(null); setPin('')
      cb(approvedBy)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* مراجعة المالك الثانية: المودال العام صار createPortal بـ z-[100] — هذا الحوار يُطلب
     غالباً ومودال مفتوح (صرف/إتلاف/مرتجع)، فيجب أن يكون بوابةً أيضاً وفوقه: z-[110] */
  const dialog = pending ? createPortal(
    <div className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPending(null)}>
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-card-dark border border-amber-500/30 p-6 space-y-4 anim-pop" onClick={(e) => e.stopPropagation()}>
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white">موافقة المشرف مطلوبة</h3>
          <p className="text-[12px] text-slate-500 leading-relaxed">
            هذه العملية تتطلب اعتماد مشرف — أدخل الرقم السري للمالك
            أو لمشرف يملك صلاحية الاعتماد. يُسجَّل اسم المعتمد على المستند.
          </p>
        </div>
        {/* عين إظهار/إخفاء (طلب المالك) — كلمة سر 6-32 خانة أرقاماً وحروفاً ورموزاً */}
        <div className="relative">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\s/g, '').slice(0, PIN_MAX_LENGTH))}
            onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
            type={showPin ? 'text' : 'password'}
            autoFocus
            dir="ltr"
            placeholder="كلمة سر المشرف…"
            className="w-full text-center text-lg font-black px-4 py-3 !pl-11 rounded-2xl border-2 border-amber-500/40 bg-transparent focus:border-amber-500 outline-none"
          />
          <button type="button" tabIndex={-1} onClick={() => setShowPin((v) => !v)} title={showPin ? 'إخفاء' : 'إظهار'} className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-amber-600 transition-colors">
            {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {error && <p className="text-[12px] font-bold text-rose-500 text-center">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setPending(null)} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-[13px] text-slate-500">إلغاء</button>
          <button onClick={() => void confirm()} disabled={pin.length < PIN_MIN_LENGTH || busy} className="p-2.5 rounded-xl bg-amber-500 text-white font-black text-[13px] disabled:opacity-40">
            {busy ? '…' : '✓ اعتماد'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return { willAskPin: needsPin, request, dialog }
}
