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
import { useDataStore } from '../../data/repo.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { needsSupervisorPin, REFUND_APPROVE_PERM } from '../../core/refundApproval.ts'

export function useSupervisorApproval(permId: string = REFUND_APPROVE_PERM): {
  /** هل سيُطلب رقم سري من المستخدم الحالي؟ (لعرض تلميح في الشاشة) */
  willAskPin: boolean
  /** نفّذ عملية بموافقة: تمر فوراً للمخول، وتفتح حوار الرقم لغيره */
  request: (onApproved: (approvedBy?: string) => void) => void
  /** حوار الرقم — ضعه في نهاية JSX الصفحة */
  dialog: React.ReactNode
} {
  const { appUsers, currentUserId, roleOverrides, approveByPin } = useDataStore()
  const [pending, setPending] = useState<((approvedBy?: string) => void) | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides))
  const decision = needsSupervisorPin(activeUser, perms, permId)

  const request = useCallback((onApproved: (approvedBy?: string) => void) => {
    if (!decision.needsPin) {
      onApproved(undefined) // مخول — يمر مباشرة، والختم باسمه
      return
    }
    setPin(''); setError(''); setPending(() => onApproved)
  }, [decision.needsPin])

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
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="رقم المشرف السري…"
          className="w-full text-center tracking-[0.5em] text-xl font-black px-4 py-3 rounded-2xl border-2 border-amber-500/40 bg-transparent focus:border-amber-500 outline-none"
        />
        {error && <p className="text-[12px] font-bold text-rose-500 text-center">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setPending(null)} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-[13px] text-slate-500">إلغاء</button>
          <button onClick={() => void confirm()} disabled={pin.length < 4 || busy} className="p-2.5 rounded-xl bg-amber-500 text-white font-black text-[13px] disabled:opacity-40">
            {busy ? '…' : '✓ اعتماد'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return { willAskPin: decision.needsPin, request, dialog }
}
