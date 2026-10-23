/**
 * معالج إصدار مستخلص — ثلاث خطوات كنافذة حرة (تبسيط إنشاء المستخلص،
 * حزمة المالك المعتمدة): المشروع ← الأعمال ← التسوية والاعتماد.
 * المحرر الكامل داخل صفحة المشروعات يبقى كما هو للتعديل والحالات
 * المتقدمة؛ هذا المعالج هو الطريق السريع الموجه للحالة الشائعة
 * (مبلغ مقطوع أو بنود جدول كميات بنسب إنجاز)، ويستعمل نفس المحرك
 * addProjectExtract بلا أي مسار ترحيل موازٍ — فلا فرق دفترياً إطلاقاً.
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, FileCheck2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { boqItemTotal, computeExtractLines, computeExtractTotals } from '../../core/contracting.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'
import { useWindowHost } from './windowHostContext.ts'
import { openProjectEditorWindow } from './windowStore.ts'

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

export function ExtractWizardWindowView() {
  const host = useWindowHost()
  const preselectProjectId = Number(host?.props.preselectProjectId ?? 0)
  const onPosted = host?.props.onPosted as ((extractId: number) => void) | undefined
  const cur = useCur()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toast = useToast()
  const { setup } = useAppStore()
  const {
    projects, boqItems, projectExtracts, clientAdvances, treasuries,
    addProjectExtract, getProjectBillingGuard,
  } = useDataStore()

  const [step, setStep] = useState(1)
  const [projectId, setProjectId] = useState(preselectProjectId)
  const [mode, setMode] = useState<'gross' | 'lines'>('gross')
  const [gross, setGross] = useState('')
  const [linePct, setLinePct] = useState<Record<number, string>>({})
  const [desc, setDesc] = useState('')
  const [vatOn, setVatOn] = useState(setup.vatPercent > 0)
  const [payment, setPayment] = useState<'credit' | 'cash'>('credit')
  const [treasury, setTreasury] = useState('1101')
  const [recovery, setRecovery] = useState('')
  const [isFinal, setIsFinal] = useState(false)
  const [posted, setPosted] = useState<{ id: number; extractNumber: string; dueMinor: number; retentionMinor: number } | null>(null)

  const project = projects.find((p) => p.id === projectId) ?? null
  const projectBoq = useMemo(() => boqItems.filter((b) => b.projectId === projectId), [boqItems, projectId])
  const guard = projectId > 0 ? getProjectBillingGuard(projectId) : null
  const advanceRemaining = clientAdvances
    .filter((a) => a.projectId === projectId)
    .reduce((sum, a) => sum + Math.max(0, a.amountMinor - a.recoveredMinor), 0)

  /* النسبة المفوترة سابقاً لكل بند — نفس قاعدة محرر الصفحة: من المستخلصات الصادرة */
  const prevPct = (boqId: number): number => projectExtracts
    .filter((ex) => ex.projectId === projectId)
    .reduce((max, ex) => {
      const l = ex.lines?.find((x) => x.boqItemId === boqId)
      return l && l.newProgressPercent > max ? l.newProgressPercent : max
    }, 0)

  const linesInput = useMemo(() => Object.entries(linePct)
    .filter(([, v]) => v !== '')
    .map(([id, v]) => ({ boqItemId: Number(id), newProgressPercent: Number(v) }))
    .filter((l) => projectBoq.some((b) => b.id === l.boqItemId) && l.newProgressPercent > prevPct(l.boqItemId)),
  // prevPct تُشتق من المستخلصات الحالية — تُعاد مع تغيّرها أو تغيّر المشروع
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [linePct, projectBoq, projectExtracts, projectId])

  const linesPreview = useMemo(() => {
    if (mode !== 'lines' || linesInput.length === 0) return { grossMinor: 0, error: '' }
    try {
      const { grossMinor } = computeExtractLines(linesInput, projectBoq)
      return { grossMinor, error: '' }
    } catch (e) {
      return { grossMinor: 0, error: (e as Error).message }
    }
  }, [mode, linesInput, projectBoq])

  const parseMoney = (s: string): number => { try { return s.trim() ? toMinor(s, cur.decimals) : 0 } catch { return -1 } }
  const grossMinor = mode === 'gross' ? Math.max(0, parseMoney(gross)) : linesPreview.grossMinor
  const recoveryMinor = Math.max(0, parseMoney(recovery))
  const totals = project && grossMinor > 0
    ? computeExtractTotals(grossMinor, project.retentionPercent, vatOn ? setup.vatPercent : 0)
    : null
  const dueAfterRecovery = totals ? totals.dueMinor - recoveryMinor : 0

  /* أي إدخال فعلي يجعل النافذة «غير نظيفة» فيسأل المضيف قبل الإغلاق */
  const dirty = !posted && (step > 1 || gross !== '' || linesInput.length > 0)
  useEffect(() => { host?.setDirty(dirty) }, [host, dirty])

  const stepError = (): string => {
    if (step === 1) return project ? '' : 'اختر المشروع أولاً'
    if (step === 2) {
      if (mode === 'gross') return parseMoney(gross) > 0 ? '' : 'أدخل قيمة الأعمال المنفذة'
      if (linesInput.length === 0) return 'ارفع نسبة إنجاز بند واحد على الأقل'
      return linesPreview.error
    }
    if (recoveryMinor > advanceRemaining) return `استرداد الدفعة يتجاوز المتبقي منها (${fmt(advanceRemaining)})`
    if (totals && recoveryMinor > totals.dueMinor) return 'استرداد الدفعة أكبر من مستحق هذا المستخلص'
    return ''
  }

  const reset = () => {
    setStep(1); setPosted(null); setGross(''); setLinePct({}); setDesc(''); setRecovery(''); setIsFinal(false)
  }

  const submit = () => {
    if (!project) return
    const err = stepError()
    if (err) { toast.show(err, 'error'); return }
    try {
      const ex = addProjectExtract({
        projectId: project.id,
        grossMinor: mode === 'gross' ? grossMinor : undefined,
        extractLines: mode === 'lines' ? linesInput : undefined,
        vatPercent: vatOn ? setup.vatPercent : 0,
        payment,
        description: desc.trim() || 'أعمال منفذة',
        treasury,
        advanceRecoveryMinor: recoveryMinor,
        isFinal,
      })
      setPosted({ id: ex.id, extractNumber: ex.extractNumber, dueMinor: ex.totals.dueMinor - (ex.advanceRecoveryMinor ?? 0), retentionMinor: ex.totals.retentionMinor })
      toast.show(`سُجل المستخلص ${ex.extractNumber} ✅`)
      onPosted?.(ex.id)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  if (posted) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center" data-window-view="extract-wizard" data-wizard-done>
        <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        <b className="text-lg">سُجل المستخلص {posted.extractNumber} بنجاح</b>
        <p className="text-sm text-slate-500">المستحق للعميل الآن: <b>{fmt(posted.dueMinor)} {cur.symbol}</b> · محتجز الضمان: <b>{fmt(posted.retentionMinor)} {cur.symbol}</b></p>
        <p className="text-xs text-slate-400">الذمة والضريبة نشأتا من هذا المستخلص — وفاتورته الضريبية عند الحاجة تكون «توثيقاً» من فاتورة البيع.</p>
        <div className="flex gap-2">
          <Btn onClick={reset}>مستخلص آخر</Btn>
          <Btn variant="primary" onClick={() => host?.close()}>تم — إغلاق</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-window-view="extract-wizard">
      {/* مؤشر الخطوات */}
      <div className="flex items-center gap-2 px-4 pt-4" data-wizard-steps>
        {['١ — المشروع', '٢ — الأعمال المنفذة', '٣ — التسوية والاعتماد'].map((label, i) => (
          <button
            key={label}
            type="button"
            disabled={i + 1 > step}
            onClick={() => setStep(i + 1)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-bold ${step === i + 1 ? 'bg-brand-600 text-white' : step > i + 1 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
          >{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {step === 1 && (
          <div className="space-y-3">
            <Field label="المشروع *">
              <div className="flex gap-2">
                <QuickSelect className={inputCls} value={projectId} onChange={(e) => { setProjectId(Number(e.target.value)); setLinePct({}) }} data-window-autofocus aria-label="مشروع المستخلص">
                  <option value={0}>اختر المشروع…</option>
                  {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
                </QuickSelect>
                <button
                  type="button" data-wizard-new-project
                  className="shrink-0 rounded-lg border border-emerald-300 px-2 py-0.5 font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                  title="مشروع غير موجود بعد؟ أنشئه في نافذة ابنة ويُختار هنا تلقائياً"
                  onClick={() => openProjectEditorWindow(0, host?.windowId ?? null, (id) => { setProjectId(id); setLinePct({}) })}
                >+ مشروع جديد</button>
              </div>
            </Field>
            {project && guard && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 grid grid-cols-2 gap-2 text-[12px]" data-wizard-project-summary>
                <span>العميل: <b>{project.clientName || '—'}</b></span>
                <span>العقد الفعلي: <b>{fmt(guard.effectiveContractNetMinor)}</b></span>
                <span>مستخلَص حتى الآن: <b>{fmt(guard.extractedNetMinor)}</b></span>
                <span>محتجز الضمان: <b>{project.retentionPercent}٪</b></span>
                <span>متبقي دفعة مقدمة للاسترداد: <b>{fmt(advanceRemaining)}</b></span>
                <span>عدد المستخلصات الصادرة: <b>{projectExtracts.filter((e) => e.projectId === projectId).length}</b></span>
              </div>
            )}
          </div>
        )}

        {step === 2 && project && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button type="button" data-wizard-mode="gross" onClick={() => setMode('gross')} className={`px-3 py-1.5 rounded-lg border text-[12px] font-bold ${mode === 'gross' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 dark:border-slate-600'}`}>مبلغ أعمال إجمالي</button>
              <button type="button" data-wizard-mode="lines" disabled={projectBoq.length === 0} onClick={() => setMode('lines')} className={`px-3 py-1.5 rounded-lg border text-[12px] font-bold disabled:opacity-40 ${mode === 'lines' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 dark:border-slate-600'}`}>بنود جدول الكميات بنسب إنجاز</button>
            </div>
            {mode === 'gross' ? (
              <Field label={`قيمة الأعمال المنفذة في هذا المستخلص — قبل الضريبة (${cur.symbol}) *`}>
                <input className={inputCls} inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" data-window-autofocus aria-label="قيمة أعمال المستخلص" />
              </Field>
            ) : (
              <div className="space-y-1" data-wizard-boq>
                {projectBoq.map((b) => {
                  const prev = prevPct(b.id)
                  const next = Number(linePct[b.id] ?? '')
                  const slice = next > prev ? Math.round(boqItemTotal(b) * (next - prev) / 100) : 0
                  return (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 text-[12px] border-b border-slate-100 dark:border-slate-800 pb-1">
                      <span className="flex-1 min-w-40"><b>{b.code}</b> — {b.descriptionAr} <span className="text-slate-400">({fmt(boqItemTotal(b))})</span></span>
                      <span>سابق {prev}٪ ←</span>
                      <input
                        className={`${inputCls} w-20`} inputMode="decimal" placeholder={String(prev)}
                        value={linePct[b.id] ?? ''} aria-label={`نسبة إنجاز ${b.code} الجديدة`}
                        onChange={(e) => setLinePct((prevMap) => ({ ...prevMap, [b.id]: e.target.value }))}
                      />
                      <span>٪</span>
                      <b className="w-28 text-left">{slice > 0 ? fmt(slice) : '—'}</b>
                    </div>
                  )
                })}
                {linesPreview.error && <p className="text-amber-600 font-bold text-[12px]">{linesPreview.error}</p>}
                <p>إجمالي شريحة هذا المستخلص: <b>{fmt(linesPreview.grossMinor)} {cur.symbol}</b></p>
              </div>
            )}
            <Field label="بيان المستخلص">
              <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="مثال: أعمال خرسانات الدور الأرضي" aria-label="بيان المستخلص" />
            </Field>
          </div>
        )}

        {step === 3 && project && totals && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="ضريبة القيمة المضافة">
                <label className="inline-flex items-center gap-2 text-[12px] font-bold h-9">
                  <input type="checkbox" checked={vatOn} onChange={(e) => setVatOn(e.target.checked)} className="accent-brand-600" />
                  احتساب {vatOn ? `${setup.vatPercent}٪` : ''}
                </label>
              </Field>
              <Field label="طريقة السداد">
                <QuickSelect className={inputCls} value={payment} onChange={(e) => setPayment(e.target.value as 'credit' | 'cash')} aria-label="طريقة سداد المستخلص">
                  <option value="credit">آجل — على ذمة العميل</option>
                  <option value="cash">تحصيل فوري</option>
                </QuickSelect>
              </Field>
              {payment === 'cash' && (
                <Field label="خزينة التحصيل">
                  <QuickSelect className={inputCls} value={treasury} onChange={(e) => setTreasury(e.target.value)} aria-label="خزينة تحصيل المستخلص">
                    {treasuries.map((t) => <option key={t.code} value={t.code}>{t.nameAr}</option>)}
                  </QuickSelect>
                </Field>
              )}
              {advanceRemaining > 0 && (
                <Field label={`استرداد من الدفعة المقدمة (المتبقي ${fmt(advanceRemaining)})`}>
                  <input className={inputCls} inputMode="decimal" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="0.00" aria-label="استرداد دفعة مقدمة" />
                </Field>
              )}
              <Field label="مستخلص ختامي؟">
                <label className="inline-flex items-center gap-2 text-[12px] font-bold h-9">
                  <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} className="accent-brand-600" />
                  نعم — لا مستخلصات بعده
                </label>
              </Field>
            </div>
            <div className="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/20 p-3 text-[12px] space-y-1" data-wizard-totals>
              <div className="flex justify-between"><span>قيمة الأعمال</span><b>{fmt(totals.grossMinor)}</b></div>
              <div className="flex justify-between"><span>ض.ق.م</span><b>{fmt(totals.vatMinor)}</b></div>
              <div className="flex justify-between"><span>محتجز ضمان {project.retentionPercent}٪ (−)</span><b>{fmt(totals.retentionMinor)}</b></div>
              {recoveryMinor > 0 && <div className="flex justify-between"><span>استرداد دفعة مقدمة (−)</span><b>{fmt(recoveryMinor)}</b></div>}
              <div className="flex justify-between border-t pt-1 text-[13px]"><span>المستحق {payment === 'cash' ? 'للتحصيل الآن' : 'على ذمة العميل'}</span><b>{fmt(dueAfterRecovery)} {cur.symbol}</b></div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-700 px-4 py-3">
        <Btn onClick={() => (step > 1 ? setStep(step - 1) : host?.close())}>
          {step > 1 ? <><ChevronRight className="w-4 h-4" /> السابق</> : 'إلغاء'}
        </Btn>
        {stepError() && <span className="text-[11px] text-amber-600 font-bold">{stepError()}</span>}
        {step < 3 ? (
          <Btn variant="primary" disabled={!!stepError()} onClick={() => setStep(step + 1)}>التالي <ChevronLeft className="w-4 h-4" /></Btn>
        ) : (
          <Btn variant="primary" disabled={!!stepError() || !totals} onClick={submit} data-wizard-post><FileCheck2 className="w-4 h-4" /> ترحيل المستخلص</Btn>
        )}
      </div>
    </div>
  )
}
