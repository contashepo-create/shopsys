/**
 * شاشة «اعتماد المستندات» (طلب المالك — خطة ③).
 * تعرض المستندات المعلّقة التي سجّلها الموظفون، فيعتمدها صاحب الصلاحية
 * **فتُرحَّل فوراً بقيدها ومخزونها الكامل**، أو يرفضها بسبب مكتوب فلا يبقى
 * لها أي أثر محاسبي. أعلى الشاشة إعدادات النظام نفسها: تفعيل/إيقاف، النطاق،
 * حد المبلغ، المعتمِدون الإضافيون، ومن مستنداته معتمدة تلقائياً.
 */
import { useMemo, useState } from 'react'
import { BadgeCheck, ShieldCheck, ShieldX, Clock, FileText } from 'lucide-react'
import { ApprovalSettingsCard } from '../components/ApprovalSettingsCard.tsx'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'
import { formatMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import { APPROVAL_DOC_LABELS, canApprove, pendingForUser, type DocApprovalStatus } from '../../core/approvals.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'

export function ApprovalsPage() {
  const toast = useToast()
  const { docApprovals, decideDocApproval, appUsers, currentUserId, roleOverrides, customRoles } = useDataStore()
  const setup = useAppStore((s) => s.setup)
  const approvals = useAppStore((s) => s.approvals)
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'

  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
  const allowed = canApprove({ settings: approvals, userId: currentUserId, userPermissions: perms })
  /* الإعدادات يراها المالك وأصحاب صلاحية الاعتماد فقط — الموظف يرى قائمته */
  const canConfigure = allowed || currentUserId == null

  const [filter, setFilter] = useState<'pending' | DocApprovalStatus | 'all'>('pending')
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState<number | null>(null)

  const rows = useMemo(() => {
    const list = filter === 'all' ? docApprovals : docApprovals.filter((row) => row.status === filter)
    return list.slice().reverse()
  }, [docApprovals, filter])
  const pendingMine = pendingForUser(docApprovals, currentUserId, perms.has('docs.approve'))

  const decide = (id: number, status: 'approved' | 'rejected') => {
    try {
      const updated = decideDocApproval(id, { status, by: currentUserId, byName: activeUser?.nameAr ?? setup.ownerName ?? 'المالك', reason: status === 'rejected' ? reason : undefined })
      toast.show(status === 'approved' ? `اعتُمد المستند ورُحِّل ${updated.postedDocumentRef ?? ''} بقيده ومخزونه ✓` : 'رُفض المستند ولم يُقيَّد شيء')
      setRejecting(null); setReason('')
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black flex items-center gap-2"><BadgeCheck size={18} /> اعتماد المستندات</h2>
          <p className="text-xs text-slate-500">
            {approvals.enabled
              ? 'النظام مفعّل — المستندات الخاضعة له لا تُقيَّد في الدفتر حتى تُعتمد.'
              : 'النظام موقوف حالياً — كل المستندات تُرحَّل فوراً. فعّله من بطاقة الإعدادات أدناه.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${pendingMine.length ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-600'}`} data-approvals-badge>
            <Clock size={12} className="inline" /> معلّق لك: {pendingMine.length}
          </span>
          <QuickSelect className={`${inputCls} w-40`} aria-label="تصفية طلبات الاعتماد" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="pending">المعلّقة</option>
            <option value="approved">المعتمدة</option>
            <option value="rejected">المرفوضة</option>
            <option value="all">الكل</option>
          </QuickSelect>
        </div>
      </div>

      {!allowed && (
        <div className={`${card} p-4 text-sm text-amber-700 dark:text-amber-300`}>
          ليست لديك صلاحية «اعتماد المستندات». اطلب من المالك تفعيل <b>docs.approve</b> لحسابك من قسم الصلاحيات.
        </div>
      )}

      {canConfigure && <ApprovalSettingsCard />}

      <section className={`${card} overflow-hidden`} data-approvals-list>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-black text-slate-500 dark:bg-slate-800/60 dark:text-slate-300">
            <tr><th className="p-2">النوع</th><th className="p-2">المستند</th><th className="p-2">الطرف</th><th className="p-2">القيمة</th><th className="p-2">أدخله</th><th className="p-2">التاريخ</th><th className="p-2">الحالة</th><th className="p-2">القرار</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8}>
                <div className="grid place-items-center gap-1 p-8 text-center text-slate-400">
                  <ShieldCheck size={26} />
                  <b className="text-sm">لا طلبات {filter === 'pending' ? 'معلّقة' : ''}</b>
                  <span className="text-xs">المستندات الخاضعة للاعتماد تظهر هنا فور تسجيلها.</span>
                </div>
              </td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200/70 dark:border-slate-700/60" data-approval-row={row.id}>
                <td className="p-2 text-center"><FileText size={12} className="inline" /> {APPROVAL_DOC_LABELS[row.kind]}</td>
                <td className="p-2 text-center font-bold">{row.title}</td>
                <td className="p-2 text-center">{row.partyName}</td>
                <td className="p-2 text-center font-mono font-bold">{formatMinor(row.amountMinor, cur, false)}</td>
                <td className="p-2 text-center">{row.requestedByName}</td>
                <td className="p-2 text-center font-mono text-[11px]">{row.requestedAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="p-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${row.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' : row.status === 'rejected' ? 'bg-rose-500/10 text-rose-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {row.status === 'approved' ? 'معتمد ورُحِّل' : row.status === 'rejected' ? 'مرفوض' : 'بانتظار الاعتماد'}
                  </span>
                  {row.reason && <div className="text-[10px] text-rose-500">{row.reason}</div>}
                  {row.status === 'approved' && row.postedDocumentRef && <div className="text-[10px] text-emerald-600" data-approval-posted-ref>{row.postedDocumentRef}</div>}
                </td>
                <td className="p-2">
                  {row.status === 'pending' && allowed && (
                    rejecting === row.id ? (
                      <div className="flex items-center gap-1">
                        <input className={`${inputCls} w-40`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الرفض *" aria-label="سبب الرفض" />
                        <Btn variant="ghost" onClick={() => decide(row.id, 'rejected')}>تأكيد الرفض</Btn>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <Btn onClick={() => decide(row.id, 'approved')}><span className="flex items-center gap-1"><ShieldCheck size={13} /> اعتماد</span></Btn>
                        <Btn variant="ghost" onClick={() => { setRejecting(row.id); setReason('') }}><span className="flex items-center gap-1"><ShieldX size={13} /> رفض</span></Btn>
                      </div>
                    )
                  )}
                  {row.status !== 'pending' && <span className="text-[11px] text-slate-400">{row.decidedByName} · {(row.decidedAt ?? '').slice(0, 16).replace('T', ' ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${card} p-3 text-[12px] leading-6 text-slate-500 dark:text-slate-400`}>
        <b className="text-slate-700 dark:text-slate-200">كيف يعمل النظام؟</b>
        <div>• التفعيل والنطاق وحد المبلغ والمعتمِدون من بطاقة <b>الإعدادات</b> أعلاه، والصلاحيتان <b>docs.approve</b> و<b>docs.autoApproved</b> من قسم الصلاحيات.</div>
        <div>• مستند المستخدم صاحب <b>docs.autoApproved</b> يُرحَّل فوراً حتى لو كان النظام مفعّلاً.</div>
        <div>• <b>الاعتماد يرحّل المستند فوراً</b> بقيده ومخزونه كاملاً؛ إن تعذّر الترحيل (مخزون تغيّر مثلاً) يظهر السبب ويبقى الطلب معلقاً.</div>
        <div>• عند إيقاف النظام تُرحَّل كل المستندات مباشرة بلا رجوع لأحد.</div>
        <div>• <b>لا قيد محاسبي ولا حركة مخزون قبل الاعتماد</b> — الرفض لا يترك أثراً.</div>
      </section>

      <Field label="" hint=""><span className="hidden" /></Field>
    </div>
  )
}
