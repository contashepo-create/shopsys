/**
 * بلاغات المشاكل الداخلية (طلب المالك):
 * أي مستخدم فرعي يبلغ عن مشكلة في أي عملية (فاتورة/قيد/سند…) —
 * فتظهر للمدير/المحاسب في هذه الشاشة وفي جرس التنبيهات ليحلها ويوثق الحل.
 */
import { useMemo, useState } from 'react'
import { MessageSquareWarning, Plus, CheckCircle2, CircleDot, Timer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { ISSUE_STATUS_LABELS, type IssueStatus } from '../../core/audit.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

export function IssuesPage() {
  const { issues, appUsers, currentUserId, reportIssue, setIssueStatus, sales, purchases, vouchers } = useDataStore()
  const toast = useToast()
  const activeUser = appUsers.find((u) => u.id === currentUserId)
  // المدير/المحاسب = المالك أو دور بصلاحية acc.journal.view — للتبسيط: المالك وغير المقيدين يرون الكل
  const isManager = currentUserId == null || activeUser?.roleId === 'owner' || activeUser?.roleId === 'accountant'

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [refKey, setRefKey] = useState('')
  const [resolving, setResolving] = useState<number | null>(null)
  const [resolution, setResolution] = useState('')

  // مراجع جاهزة للاختيار: آخر الفواتير والسندات (يسهل على الكاشير تحديد العملية)
  const refOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = []
    for (const s of [...sales].slice(-15).reverse()) opts.push({ key: `sale:${s.id}`, label: `فاتورة بيع ${s.invoiceNumber}` })
    for (const p of [...purchases].slice(-10).reverse()) opts.push({ key: `purchase:${p.id}`, label: `فاتورة شراء ${p.invoiceNumber}` })
    for (const v of [...vouchers].slice(-10).reverse()) opts.push({ key: `voucher:${v.id}`, label: `سند ${v.voucherNumber}` })
    return opts
  }, [sales, purchases, vouchers])

  const refLabel = (key: string) => refOptions.find((o) => o.key === key)?.label ?? key

  const submit = () => {
    try {
      reportIssue({ title, details, refKey })
      toast.show('أُرسل البلاغ — سيظهر للمدير/المحاسب فوراً ✓')
      setOpen(false); setTitle(''); setDetails(''); setRefKey('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const resolve = (id: number) => {
    try {
      setIssueStatus(id, 'resolved', resolution)
      toast.show('أُغلق البلاغ مع توثيق الحل ✓')
      setResolving(null); setResolution('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const sorted = useMemo(() => [...issues].sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || b.id - a.id), [issues])
  const openCount = issues.filter((i) => i.status !== 'resolved').length

  const statusIcon = (s: IssueStatus) => s === 'resolved' ? <CheckCircle2 size={14} className="text-emerald-500" /> : s === 'in_progress' ? <Timer size={14} className="text-amber-500" /> : <CircleDot size={14} className="text-rose-500" />

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-slate-500">
          {openCount > 0 ? <span className="font-bold text-rose-600">🔴 {openCount} بلاغ مفتوح</span> : <span className="text-emerald-600 font-bold">✓ لا بلاغات مفتوحة</span>}
          <span className="mr-2 text-slate-400">— أي مستخدم يبلغ عن مشكلة في عملية، والمدير أو المحاسب يحلها ويوثق الحل</span>
        </div>
        <Btn onClick={() => setOpen(true)}><Plus size={15} /> بلاغ جديد</Btn>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon="📮" title="لا بلاغات" sub="واجه أحد الموظفين مشكلة في فاتورة أو سند؟ يضغط «بلاغ جديد» فتصل للمدير فوراً" />
      ) : (
        <div className="space-y-2">
          {sorted.map((i) => (
            <div key={i.id} className={`anim-up rounded-2xl bg-white dark:bg-card-dark border p-4 ${i.status === 'resolved' ? 'border-slate-200 dark:border-slate-800 opacity-70' : 'border-rose-500/30'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-52">
                  <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2 text-[14px]">
                    {statusIcon(i.status)} {i.title}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold">{ISSUE_STATUS_LABELS[i.status].nameAr}</span>
                    {i.refKey && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold">{refLabel(i.refKey)}</span>}
                  </div>
                  <div className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap">{i.details}</div>
                  <div className="text-[10.5px] text-slate-400 mt-1.5">
                    أبلغ: <b>{i.reportedBy}</b> · {i.reportedAt.slice(0, 16).replace('T', ' ')}
                    {i.status === 'resolved' && <> — حلّه: <b>{i.resolvedBy}</b> {i.resolvedAt?.slice(0, 16).replace('T', ' ')}{i.resolution && <> · «{i.resolution}»</>}</>}
                  </div>
                </div>
                {isManager && i.status !== 'resolved' && (
                  <div className="flex gap-1.5">
                    {i.status === 'open' && (
                      <Btn variant="ghost" className="border border-amber-300 dark:border-amber-700 !text-[12px] !py-1.5" onClick={() => setIssueStatus(i.id, 'in_progress')}>
                        ⏳ قيد المعالجة
                      </Btn>
                    )}
                    <Btn className="!text-[12px] !py-1.5" onClick={() => { setResolving(i.id); setResolution('') }}>✓ تم الحل</Btn>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* بلاغ جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="📮 بلاغ عن مشكلة">
        <div className="space-y-4">
          <p className="text-[11.5px] text-slate-400 p-3 rounded-xl bg-sky-500/5 border border-sky-500/20 leading-relaxed">
            💡 هذا البلاغ داخلي: يصل للمدير/المحاسب في نفس المحل ليصحح العملية. لمراسلة المطوّر عن عطل تقني استخدم شاشة «الدعم الفني».
          </p>
          <Field label="عنوان المشكلة">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="فاتورة بمبلغ خاطئ / سند مكرر…" />
          </Field>
          <Field label="العملية المرتبطة (اختياري)" hint="حدد الفاتورة أو السند ليصل المدير للمشكلة مباشرة">
            <select value={refKey} onChange={(e) => setRefKey(e.target.value)} className={inputCls}>
              <option value="">— بدون —</option>
              {refOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="شرح المشكلة">
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} className={inputCls} placeholder="ماذا حدث بالضبط؟ ما القيمة الصحيحة؟" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={submit} disabled={!title.trim() || details.trim().length < 5}><MessageSquareWarning size={15} /> إرسال البلاغ</Btn>
          </div>
        </div>
      </Modal>

      {/* توثيق الحل */}
      <Modal open={resolving != null} onClose={() => setResolving(null)} title="✓ توثيق حل المشكلة">
        <div className="space-y-4">
          <Field label="ماذا فعلت لحلها؟" hint="يُحفظ في البلاغ ليعرف المُبلغ أن مشكلته حُلت وكيف">
            <input value={resolution} onChange={(e) => setResolution(e.target.value)} className={inputCls} placeholder="عُدلت الفاتورة بقيد عاكس / أُلغي السند المكرر…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setResolving(null)}>إلغاء</Btn>
            <Btn onClick={() => resolving != null && resolve(resolving)}>حفظ وإغلاق البلاغ</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
