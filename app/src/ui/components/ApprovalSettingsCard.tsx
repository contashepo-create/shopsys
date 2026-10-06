/**
 * بطاقة إعدادات نظام اعتماد المستندات — مشتركة بين قسم الصلاحيات وشاشة
 * «طلبات الاعتماد» (طلب المالك: التحكم كله من قسم الصلاحيات أيضاً).
 * تفعيل/إيقاف · نطاق الأنواع الستة · حد المبلغ · معتمِدون إضافيون · تجاوز تلقائي.
 */
import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { inputCls, useToast } from './ui.tsx'
import { formatMinor, toMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import { APPROVAL_DOC_KINDS, APPROVAL_DOC_LABELS, type ApprovalDocKind } from '../../core/approvals.ts'

export function ApprovalSettingsCard() {
  const toast = useToast()
  const appUsers = useDataStore((s) => s.appUsers)
  const setup = useAppStore((s) => s.setup)
  const approvals = useAppStore((s) => s.approvals)
  const updateApprovals = useAppStore((s) => s.updateApprovals)
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const [thresholdText, setThresholdText] = useState(() => (approvals.thresholdMinor > 0 ? String(approvals.thresholdMinor / 10 ** cur.decimals) : '0'))

  const toggleScope = (kind: ApprovalDocKind) =>
    updateApprovals({ scope: approvals.scope.includes(kind) ? approvals.scope.filter((row) => row !== kind) : [...approvals.scope, kind] })
  const toggleUserList = (list: 'approverUserIds' | 'autoApprovedUserIds', userId: number) =>
    updateApprovals({ [list]: approvals[list].includes(userId) ? approvals[list].filter((row) => row !== userId) : [...approvals[list], userId] })
  const commitThreshold = () => {
    const minor = toMinor(thresholdText || '0', cur.decimals)
    if (!Number.isFinite(minor) || minor < 0) { toast.show('حد مبلغ غير صالح', 'error'); setThresholdText('0'); return }
    updateApprovals({ thresholdMinor: Math.round(minor) })
    toast.show(minor > 0 ? `المستندات تحت ${formatMinor(minor, cur, false)} تُرحَّل فوراً` : 'كل المستندات ضمن النطاق تحتاج اعتماداً')
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-approvals-settings>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="flex items-center gap-1 text-sm"><SlidersHorizontal size={14} /> إعدادات نظام الاعتماد</b>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-black" data-approvals-enabled>
          <input
            type="checkbox"
            className="size-4 accent-emerald-600"
            data-approvals-toggle
            checked={approvals.enabled}
            onChange={(event) => {
              updateApprovals({ enabled: event.target.checked })
              toast.show(event.target.checked ? 'فُعِّل نظام الاعتماد — النطاق الخاضع يقف حتى يُعتمد' : 'أُوقف النظام — كل المستندات تُرحَّل فوراً')
            }}
          />
          {approvals.enabled ? 'مفعّل' : 'موقوف'}
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] font-black text-slate-500 dark:text-slate-400">أنواع المستندات الخاضعة للاعتماد</div>
          <div className="flex flex-wrap gap-1.5">
            {APPROVAL_DOC_KINDS.map((kind) => (
              <label
                key={kind}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${approvals.scope.includes(kind) ? 'border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}
              >
                <input type="checkbox" className="size-3.5 accent-emerald-600" data-approvals-scope={kind} checked={approvals.scope.includes(kind)} onChange={() => toggleScope(kind)} />
                {APPROVAL_DOC_LABELS[kind]}
              </label>
            ))}
          </div>
          <div className="text-[10px] text-slate-400">التحويل بين الخزائن ليس مستند طرف خارجي — لا يدخل النطاق.</div>
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400">
            حد المبلغ: ما دونه يُرحَّل فوراً (0 = كل المستندات ضمن النطاق)
            <div className="mt-1 flex items-center gap-1">
              <input
                className={`${inputCls} w-32`}
                data-approvals-threshold
                inputMode="decimal"
                value={thresholdText}
                onChange={(event) => setThresholdText(event.target.value)}
                onBlur={commitThreshold}
                onKeyDown={(event) => { if (event.key === 'Enter') commitThreshold() }}
              />
              <span className="text-[11px] text-slate-400">{cur.symbol}</span>
            </div>
          </label>
          <div className="text-[10px] text-slate-400">المالك وصاحب صلاحية docs.approve يعتمدان؛ من هنا تضيف معتمِدين بلا تعديل الأدوار.</div>
        </div>
      </div>
      {appUsers.length > 0 && (
        <div className="grid gap-3 border-t border-slate-100 pt-2 md:grid-cols-2 dark:border-slate-800">
          <div>
            <div className="mb-1 text-[11px] font-black text-slate-500 dark:text-slate-400">معتمِدون إضافيون (بلا تعديل الأدوار)</div>
            <div className="flex flex-wrap gap-1.5">
              {appUsers.map((user) => (
                <label key={`appr-${user.id}`} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${approvals.approverUserIds.includes(user.id) ? 'border-sky-400 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
                  <input type="checkbox" className="size-3 accent-sky-600" data-approvals-user-approver={user.id} checked={approvals.approverUserIds.includes(user.id)} onChange={() => toggleUserList('approverUserIds', user.id)} />
                  {user.nameAr}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-black text-slate-500 dark:text-slate-400">مستنداتهم معتمدة تلقائياً (تجاوز صريح)</div>
            <div className="flex flex-wrap gap-1.5">
              {appUsers.map((user) => (
                <label key={`auto-${user.id}`} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${approvals.autoApprovedUserIds.includes(user.id) ? 'border-violet-400 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
                  <input type="checkbox" className="size-3 accent-violet-600" data-approvals-user-auto={user.id} checked={approvals.autoApprovedUserIds.includes(user.id)} onChange={() => toggleUserList('autoApprovedUserIds', user.id)} />
                  {user.nameAr}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
