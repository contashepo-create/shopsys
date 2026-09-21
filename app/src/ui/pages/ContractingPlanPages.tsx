/**
 * تخطيط المقاولات — نقلة AccFlex/pro-acc:
 * BudgetPage — موازنة فئات التكاليف لكل مشروع + تقرير انحراف حي (وفر/تحذير/تجاوز).
 * TasksPage — جدول زمني مبسط (جانت أفقي) بمهام مرتبطة اختيارياً ببنود BOQ.
 */
import { useMemo, useState } from 'react'
import { Plus, Scale, CalendarRange } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, PROJECT_TASK_STATUS_LABELS, type CostKind } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
const KINDS = Object.keys(COST_KIND_LABELS) as CostKind[]

function useCur() {
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  return { cur, fmt }
}

/* ─────────────────────────── موازنة المشروع والانحرافات ─────────────────────────── */
export function ProjectBudgetPage() {
  const { projects, projectBudgets, projectCosts, setProjectBudget, getProjectBudgetVariance } = useDataStore()
  const { cur, fmt } = useCur()
  const toast = useToast()
  const open = projects.filter((p) => p.status === 'active')
  const [projectId, setProjectId] = useState<number | ''>('')
  const pid = projectId === '' ? (open[0]?.id ?? null) : projectId
  const project = projects.find((p) => p.id === pid) ?? null

  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState<Record<CostKind, string>>({ materials: '', labor: '', equipment: '', subcontract: '', other: '' })

  // projectCosts في التبعيات ضرورية: أي تكلفة جديدة يجب أن تحدّث تقرير الانحراف فوراً
  const report = useMemo(() => (project ? getProjectBudgetVariance(project.id) : null), [project, getProjectBudgetVariance, projectBudgets, projectCosts])

  const startEdit = () => {
    if (!project) return
    const next = { materials: '', labor: '', equipment: '', subcontract: '', other: '' } as Record<CostKind, string>
    for (const b of projectBudgets.filter((x) => x.projectId === project.id)) next[b.kind] = String(b.amountMinor / 10 ** cur.decimals)
    setDraft(next)
    setEditOpen(true)
  }
  const saveBudget = () => {
    if (!project) return
    try {
      setProjectBudget(project.id, KINDS.map((k) => ({ kind: k, amountMinor: draft[k] ? toMinor(draft[k], cur.decimals) : 0 })))
      toast.show('حُفظت موازنة المشروع ✅')
      setEditOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const STATUS_UI = {
    ok: { label: 'ضمن الموازنة', cls: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30' },
    warning: { label: 'اقترب من السقف', cls: 'text-amber-600 bg-amber-500/10 border-amber-500/30' },
    over: { label: 'تجاوز!', cls: 'text-rose-600 bg-rose-500/10 border-rose-500/30' },
  } as const

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2"><Scale className="w-5 h-5 text-orange-500" /> موازنة المشروع والانحرافات</h1>
          <p className="text-[12px] text-slate-500 mt-1">موازنة تقديرية لكل فئة تكلفة تُقارن بالفعلي أولاً بأول — تحذير عند 85٪ وتجاوز فوق 100٪</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={pid ?? ''} onChange={(e) => setProjectId(Number(e.target.value))} className={inputCls + ' !w-56'}>
            {open.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
          </select>
          <Btn onClick={startEdit} disabled={!project}><Plus className="w-4 h-4" /> ضبط الموازنة</Btn>
        </div>
      </div>

      {!project ? (
        <EmptyState icon="⚖️" title="لا مشروعات مفتوحة" sub="أنشئ مشروعاً أولاً ثم اضبط موازنته بالفئات" />
      ) : !report || report.rows.length === 0 ? (
        <EmptyState icon="⚖️" title="لا موازنة ولا تكاليف بعد" sub="اضغط «ضبط الموازنة» لإدخال المبالغ التقديرية لكل فئة — ستُقارن تلقائياً بكل تكلفة تُسجل" />
      ) : (
        <div className={card + ' overflow-hidden'}>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-[11px]">
              <tr>
                <th className="p-3 text-right font-bold">الفئة</th>
                <th className="p-3 text-left font-bold">الموازنة</th>
                <th className="p-3 text-left font-bold">الفعلي</th>
                <th className="p-3 text-left font-bold">الانحراف</th>
                <th className="p-3 text-center font-bold">الاستهلاك</th>
                <th className="p-3 text-center font-bold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const ui = STATUS_UI[r.status]
                return (
                  <tr key={r.kind} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-3 font-bold text-slate-700 dark:text-slate-200">{COST_KIND_LABELS[r.kind].icon} {COST_KIND_LABELS[r.kind].nameAr}</td>
                    <td className="p-3 text-left tabular-nums">{fmt(r.budgetMinor)}</td>
                    <td className="p-3 text-left tabular-nums font-bold">{fmt(r.actualMinor)}</td>
                    <td className={`p-3 text-left tabular-nums font-bold ${r.varianceMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {r.varianceMinor >= 0 ? `وفر ${fmt(r.varianceMinor)}` : `عجز ${fmt(-r.varianceMinor)}`}
                    </td>
                    <td className="p-3">
                      <div className="w-28 mx-auto">
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className={`h-full rounded-full ${r.status === 'over' ? 'bg-rose-500' : r.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, r.usagePercent)}%` }} />
                        </div>
                        <div className="text-[10px] text-center font-bold text-slate-500 mt-0.5">{r.usagePercent}٪</div>
                      </div>
                    </td>
                    <td className="p-3 text-center"><span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${ui.cls}`}>{ui.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-orange-500/10 font-black text-orange-700 dark:text-orange-300">
              <tr>
                <td className="p-3">الإجمالي</td>
                <td className="p-3 text-left tabular-nums">{fmt(report.totalBudgetMinor)}</td>
                <td className="p-3 text-left tabular-nums">{fmt(report.totalActualMinor)}</td>
                <td className={`p-3 text-left tabular-nums ${report.totalBudgetMinor - report.totalActualMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(Math.abs(report.totalBudgetMinor - report.totalActualMinor))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={project ? `موازنة — ${project.nameAr}` : ''}>
        <div className="space-y-3">
          {KINDS.map((k) => (
            <Field key={k} label={`${COST_KIND_LABELS[k].icon} ${COST_KIND_LABELS[k].nameAr} (${cur.symbol})`}>
              <input value={draft[k]} onChange={(e) => setDraft((s) => ({ ...s, [k]: e.target.value }))} inputMode="decimal" className={inputCls} placeholder="0 = بلا موازنة لهذه الفئة" />
            </Field>
          ))}
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-3 text-[12px] font-bold text-sky-700 dark:text-sky-300">
            الحفظ يستبدل الموازنة السابقة للمشروع بالكامل — أي تكلفة تُسجل في فئة بلا موازنة ستظهر «تجاوزاً» فوراً
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveBudget}>حفظ الموازنة</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ─────────────────────────── الجدول الزمني (جانت مبسط) ─────────────────────────── */
export function ProjectTasksPage() {
  const { projects, projectTasks, boqItems, addProjectTask, updateProjectTaskProgress } = useDataStore()
  const toast = useToast()
  const open = projects.filter((p) => p.status === 'active')
  const [projectId, setProjectId] = useState<number | ''>('')
  const pid = projectId === '' ? (open[0]?.id ?? null) : projectId
  const project = projects.find((p) => p.id === pid) ?? null
  const tasks = useMemo(() => projectTasks.filter((t) => t.projectId === pid).sort((a, b) => a.startDate.localeCompare(b.startDate)), [projectTasks, pid])

  /* نطاق الجانت: من أول بداية إلى آخر نهاية */
  const range = useMemo(() => {
    if (!tasks.length) return null
    const min = tasks.reduce((m, t) => (t.startDate < m ? t.startDate : m), tasks[0].startDate)
    const max = tasks.reduce((m, t) => (t.endDate > m ? t.endDate : m), tasks[0].endDate)
    const d0 = new Date(min).getTime(), d1 = new Date(max).getTime()
    const span = Math.max(1, d1 - d0)
    return { d0, span, min, max }
  }, [tasks])

  const [addOpen, setAddOpen] = useState(false)
  const [tName, setTName] = useState('')
  const [tStart, setTStart] = useState('')
  const [tEnd, setTEnd] = useState('')
  const [tBoq, setTBoq] = useState<number | ''>('')
  const projBoq = useMemo(() => boqItems.filter((b) => b.projectId === pid), [boqItems, pid])

  const saveTask = () => {
    if (!project) return
    try {
      addProjectTask({ projectId: project.id, nameAr: tName, startDate: tStart, endDate: tEnd, progressPercent: 0, boqItemId: tBoq === '' ? null : tBoq })
      toast.show('أُضيفت المهمة ✅')
      setAddOpen(false); setTName(''); setTStart(''); setTEnd(''); setTBoq('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const bumpProgress = (taskId: number, current: number) => {
    const raw = window.prompt('نسبة الإنجاز الجديدة (تراكمية 0–100):', String(current))
    if (raw === null) return
    try { updateProjectTaskProgress(taskId, Number(raw)); toast.show('حُدث التقدم ✅') } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const todayPct = range ? Math.min(100, Math.max(0, ((Date.now() - range.d0) / range.span) * 100)) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2"><CalendarRange className="w-5 h-5 text-orange-500" /> الجدول الزمني للمشروع</h1>
          <p className="text-[12px] text-slate-500 mt-1">مهام بمدد وتقدم تراكمي على شريط زمني — المتأخرة عن اليوم بلا إنجاز تظهر بالأحمر</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={pid ?? ''} onChange={(e) => setProjectId(Number(e.target.value))} className={inputCls + ' !w-56'}>
            {open.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
          </select>
          <Btn onClick={() => setAddOpen(true)} disabled={!project}><Plus className="w-4 h-4" /> مهمة جديدة</Btn>
        </div>
      </div>

      {!project ? (
        <EmptyState icon="🗓️" title="لا مشروعات مفتوحة" sub="أنشئ مشروعاً أولاً" />
      ) : !tasks.length || !range ? (
        <EmptyState icon="🗓️" title="لا مهام بعد" sub="أضف مهام المشروع بمددها — حفر، أساسات، هيكل، تشطيبات… — وتابع تقدمها على الشريط الزمني" />
      ) : (
        <div className={card + ' p-4 space-y-3'}>
          <div className="flex justify-between text-[11px] font-bold text-slate-400"><span>{range.min}</span><span>{range.max}</span></div>
          <div className="relative space-y-2">
            {/* خط اليوم */}
            {todayPct > 0 && todayPct < 100 && (
              <div className="absolute top-0 bottom-0 w-px bg-rose-400/70 z-10" style={{ insetInlineStart: `${todayPct}%` }} title="اليوم" />
            )}
            {tasks.map((t) => {
              const s = ((new Date(t.startDate).getTime() - range.d0) / range.span) * 100
              const w = Math.max(2, ((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / range.span) * 100)
              const late = t.status !== 'done' && new Date(t.endDate).getTime() < Date.now()
              const st = PROJECT_TASK_STATUS_LABELS[t.status]
              return (
                <div key={t.id} className="grid grid-cols-[180px_1fr_90px] items-center gap-3">
                  <button onClick={() => bumpProgress(t.id, t.progressPercent)} className="text-right text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:text-orange-600 truncate" title="تحديث التقدم">
                    {st.icon} {t.nameAr}
                  </button>
                  <div className="relative h-6 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className={`absolute top-0 h-full rounded-lg ${late ? 'bg-rose-200 dark:bg-rose-900/50' : 'bg-orange-200 dark:bg-orange-900/40'}`} style={{ insetInlineStart: `${s}%`, width: `${w}%` }}>
                      <div className={`h-full rounded-lg ${late ? 'bg-rose-500' : 'bg-orange-500'}`} style={{ width: `${t.progressPercent}%` }} />
                    </div>
                  </div>
                  <div className={`text-[11px] font-bold text-center ${late ? 'text-rose-600' : 'text-slate-500'}`}>{t.progressPercent}٪{late ? ' ⏰' : ''}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={project ? `مهمة جديدة — ${project.nameAr}` : ''}>
        <div className="space-y-3">
          <Field label="اسم المهمة *"><input value={tName} onChange={(e) => setTName(e.target.value)} className={inputCls} placeholder="أعمال الحفر والأساسات…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="البداية *"><input type="date" value={tStart} onChange={(e) => setTStart(e.target.value)} className={inputCls} /></Field>
            <Field label="النهاية *"><input type="date" value={tEnd} onChange={(e) => setTEnd(e.target.value)} className={inputCls} /></Field>
          </div>
          {projBoq.length > 0 && (
            <Field label="ربط ببند BOQ (اختياري)" hint="للمتابعة فقط — نسبة البند تُحدَّث من المستخلصات">
              <select value={tBoq} onChange={(e) => setTBoq(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls}>
                <option value="">بلا ربط</option>
                {projBoq.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.descriptionAr}</option>)}
              </select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveTask} disabled={!tName.trim() || !tStart || !tEnd}>إضافة المهمة</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
