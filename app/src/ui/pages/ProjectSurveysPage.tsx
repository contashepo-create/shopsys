import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Printer, Save } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { projectExtractFingerprint, ProjectCommitUnconfirmedError, withProjectExtractCommit } from '../../data/projectExtractCommit.ts'
import { assertSurveyIntegrity, exactBilledQuantities } from '../../core/projectSurvey.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { todayLocalIso } from '../../core/time.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { renderSurveyHtml } from '../print/printSurvey.ts'
import { renderCloseoutHtml } from '../print/printCloseout.ts'

export function ProjectSurveysPage() {
  const data = useDataStore()
  const { projects, boqItems, projectSurveys, projectExtractDrafts, projectCloseouts, projectExtracts, appUsers, currentUserId, roleOverrides, customRoles } = data
  const { setup } = useAppStore()
  const toast = useToast(), navigate = useNavigate()
  const [projectId, setProjectId] = useState(0)
  const [values, setValues] = useState<Record<number, string>>({})
  const [isFinal, setIsFinal] = useState(false)
  const [reason, setReason] = useState('')
  const [measurementDate, setMeasurementDate] = useState(todayLocalIso())
  const [draftDeleteReason, setDraftDeleteReason] = useState('')
  const [confirmDraftDelete, setConfirmDraftDelete] = useState(false)
  const [confirmSurveyDelete, setConfirmSurveyDelete] = useState(false)
  const [surveyDeleteReason, setSurveyDeleteReason] = useState('')
  const [surveyDeleteBasis, setSurveyDeleteBasis] = useState('')
  const [closeoutOpen, setCloseoutOpen] = useState(false)
  const [closeoutConfirmed, setCloseoutConfirmed] = useState(false)
  const [closeoutNotes, setCloseoutNotes] = useState('')
  const [closeoutBasis, setCloseoutBasis] = useState('')
  const [revision, setRevision] = useState(0)
  const [basis, setBasis] = useState('')
  const pending = useRef(false)
  const project = projects.find(row => row.id === projectId)
  const survey = projectSurveys.find(row => row.projectId === projectId)
  const draft = projectExtractDrafts.find(row => row.projectId === projectId)
  const items = useMemo(() => boqItems.filter(row => row.projectId === projectId), [boqItems, projectId])
  const history = useMemo(() => projectExtracts.filter(row => row.projectId === projectId), [projectExtracts, projectId])
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (amount: number) => formatMinor(amount, cur, false)
  const user = appUsers.find(row => row.id === currentUserId && row.active)
  const canManage = currentUserId == null || (!!user && effectivePermissionsFor(user, rolesWithOverrides(roleOverrides, customRoles, setup.activityId)).has('contracting.survey.manage'))
  let billed = new Map<number, number>(), historyError = ''
  try { if (survey) assertSurveyIntegrity(survey, items, history); billed = new Map(exactBilledQuantities(items, history).map(line => [line.boqItemId, line.cumulativeQty])) } catch (error) { historyError = (error as Error).message }
  const selectProject = (id: number) => {
    setProjectId(id); setMeasurementDate(todayLocalIso()); setReason(''); setDraftDeleteReason(''); setConfirmDraftDelete(false); setSurveyDeleteReason(''); setConfirmSurveyDelete(false); setCloseoutOpen(false); setCloseoutConfirmed(false); setCloseoutNotes('')
    const selected = projectSurveys.find(row => row.projectId === id)
    const selectedItems = boqItems.filter(row => row.projectId === id)
    let previous = new Map<number, number>()
    try { previous = new Map(exactBilledQuantities(selectedItems, projectExtracts.filter(row => row.projectId === id)).map(line => [line.boqItemId, line.cumulativeQty])) } catch { /* يظهر الخطأ في الجدول ويمنع الاعتماد */ }
    setValues(Object.fromEntries(selectedItems.map(item => [item.id, String(selected?.lines.find(line => line.boqItemId === item.id)?.cumulativeQty ?? previous.get(item.id) ?? 0)])))
    setIsFinal(!!selected?.isFinal); setRevision(selected?.revisions.length ?? 0)
    setBasis(id ? projectExtractFingerprint(data, id) : '')
  }
  const save = async () => {
    if (!project || pending.current) return
    pending.current = true
    try {
      if (items.some(item => !values[item.id]?.trim() || !Number.isFinite(Number(values[item.id])))) throw new Error('أدخل كمية صحيحة لكل بند؛ لا تترك الكمية فارغة')
      const result = await withProjectExtractCommit(project.id, basis, () => useDataStore.getState().saveProjectSurvey({ projectId: project.id, lines: items.map(item => ({ boqItemId: item.id, cumulativeQty: Number(values[item.id] ?? '') })), expectedRevision: revision, reason, isFinal, measurementDate }))
      setRevision(result.revisions.length); setReason('')
      setBasis(projectExtractFingerprint(useDataStore.getState(), project.id))
      toast.show('حُفظت مراجعة الحصر دون إنشاء قيد أو مستخلص')
    } catch (error) {
      if (error instanceof ProjectCommitUnconfirmedError) { setProjectId(0); toast.show('حُفظ الحصر محلياً لكن تعذر تأكيد الحفظ — راجع الحالة قبل المحاولة مجدداً', 'error') }
      else toast.show((error as Error).message, 'error')
    } finally { pending.current = false }
  }
  const prepare = async () => {
    if (!project || !survey || pending.current) return
    pending.current = true
    try {
      await withProjectExtractCommit(project.id, projectExtractFingerprint(data, project.id), () => useDataStore.getState().prepareProjectExtractDraft(project.id, survey.revisions.length))
      navigate(`/contracting/extracts?projectId=${project.id}&fromSurvey=1`)
    } catch (error) {
      toast.show(error instanceof ProjectCommitUnconfirmedError ? 'جُهزت المسودة محلياً ولم يؤكد حفظها — راجعها قبل إعادة المحاولة' : (error as Error).message, 'error')
    } finally { pending.current = false }
  }
  const deleteDraft = async () => {
    if (!project || !draft || pending.current || !confirmDraftDelete) return
    pending.current = true
    try {
      await withProjectExtractCommit(project.id, projectExtractFingerprint(data, project.id), () => useDataStore.getState().deleteProjectExtractDraft(project.id, draftDeleteReason))
      setConfirmDraftDelete(false); setDraftDeleteReason(''); toast.show('حُذفت المسودة غير المرحّلة دون تغيير الدفتر')
    } catch (error) {
      if (error instanceof ProjectCommitUnconfirmedError) setConfirmDraftDelete(false)
      toast.show(error instanceof ProjectCommitUnconfirmedError ? 'حُذفت المسودة محلياً ولم يؤكد الحفظ — راجع الحالة' : (error as Error).message, 'error')
    } finally { pending.current = false }
  }
  const deleteSurvey = async () => {
    if (!project || !survey || pending.current || !confirmSurveyDelete) return
    pending.current = true
    try {
      await withProjectExtractCommit(project.id, surveyDeleteBasis, () => useDataStore.getState().deleteUnpostedSurvey(project.id, surveyDeleteReason))
      setProjectId(0); setConfirmSurveyDelete(false); toast.show('حُذف الحصر غير المرحّل ومسودته دون تغيير الدفتر')
    } catch (error) {
      if (error instanceof ProjectCommitUnconfirmedError) { setProjectId(0); setConfirmSurveyDelete(false) }
      toast.show(error instanceof ProjectCommitUnconfirmedError ? 'حُذف الحصر محلياً ولم يؤكد الحفظ — راجع الحالة' : (error as Error).message, 'error')
    } finally { pending.current = false }
  }
  const issueCloseout = async () => {
    if (!project || !survey || pending.current || !closeoutConfirmed) return
    pending.current = true
    try {
      const record = await withProjectExtractCommit(project.id, closeoutBasis, () => useDataStore.getState().issueProjectCloseout({ projectId: project.id, expectedRevision: survey.revisions.length, notes: closeoutNotes, confirmed: closeoutConfirmed }))
      setCloseoutOpen(false); setCloseoutConfirmed(false); setCloseoutNotes('')
      toast.show(`حُفظ محضر إقفال الكميات ${record.number} دون قيد أو فاتورة`)
    } catch (error) {
      if (error instanceof ProjectCommitUnconfirmedError) { setCloseoutOpen(false); setCloseoutConfirmed(false) }
      toast.show(error instanceof ProjectCommitUnconfirmedError ? 'حُفظ المحضر محلياً ولم يؤكد الحفظ — راجع السجل قبل إعادة المحاولة' : (error as Error).message, 'error')
    } finally { pending.current = false }
  }
  const printCloseout = (id: number) => {
    const fresh = useDataStore.getState(), record = fresh.projectCloseouts.find(row => row.id === id)
    if (!record) return toast.show('المحضر غير موجود في الفرع الحالي', 'error')
    try {
      const html = renderCloseoutHtml({ shopName: setup.shopName || 'المقاولات', record, current: fresh.isProjectCloseoutCurrent(id), currency: cur.symbol, fmt })
      openPrintPreview({ html, wide: true, title: `محضر إقفال كميات ${record.number}` })
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const print = () => {
    if (!project || !survey) return
    try {
      data.assertProjectExtractOriginals(project.id)
      data.assertProjectExtractRefunds(project.id)
      const html = renderSurveyHtml({ shopName: setup.shopName || 'المقاولات', project, survey, items, history, fmt, currency: cur.symbol })
      openPrintPreview({ html, wide: true, title: `كشف الحصر — ${project.code}` })
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const hasDifference = !!survey && !historyError && items.some(item => (survey.lines.find(line => line.boqItemId === item.id)?.cumulativeQty ?? 0) > (billed.get(item.id) ?? 0))
  return <div className="space-y-4" data-project-surveys>
    <div className="flex items-center justify-between flex-wrap gap-3"><div><h1 className="text-xl font-black">حصر الأعمال للمشروعات</h1><p className="text-sm text-slate-500">حصر واحد تراكمي لكل مشروع؛ الحصر لا ينشئ قيداً أو فاتورة.</p></div><select aria-label="مشروع الحصر" value={projectId || ''} onChange={event => selectProject(Number(event.target.value))} className={`${inputCls} max-w-sm`}><option value="">اختر المشروع</option>{projects.map(row => <option key={row.id} value={row.id}>{row.code} — {row.nameAr}</option>)}</select></div>
    {!project && <p className="rounded-xl border p-5 text-slate-500">اختر المشروع لعرض العقد والحصر والمستخلصات.</p>}
    {project && <>
      <div className="rounded-xl border p-3 text-sm flex flex-wrap gap-4"><b>{project.code} — {project.nameAr}</b><span>الجهة: {project.clientName || '—'}</span><span>المراجعة المحفوظة: {survey?.revisions.length ?? 'لا يوجد حصر بعد'}</span><span>{survey?.isFinal ? 'حصر ختامي' : 'حصر جاري'}</span></div>
      {historyError && <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{historyError} — لا تُعامل النسب التقديرية أو المبالغ الإجمالية ككميات مؤكدة.</p>}
      {!items.length && <p role="alert">أضف بنود جدول الكميات للمشروع أولاً.</p>}
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr>{['البند / الوحدة', 'كمية العقد', 'سعر الوحدة', 'المنفذ التراكمي', 'المستخلص', 'غير المستخلص', 'المتبقي من العقد'].map(text => <th key={text} className="p-2 text-right">{text}</th>)}</tr></thead><tbody>{items.map(item => {
        const entered = Number(values[item.id]), valid = values[item.id]?.trim() !== '' && Number.isFinite(entered)
        const extracted = billed.get(item.id) ?? 0
        return <tr key={item.id} className="border-t"><td className="p-2">{item.code} — {item.descriptionAr} ({item.unit})</td><td className="p-2">{item.qty}</td><td className="p-2">{fmt(item.unitPriceMinor)}</td><td className="p-2"><input aria-label={`المنفذ للبند ${item.code}`} className="w-24 border rounded bg-transparent p-1" dir="ltr" inputMode="decimal" value={values[item.id] ?? ''} onChange={event => setValues({ ...values, [item.id]: event.target.value })} /></td><td className="p-2">{historyError ? '—' : extracted}</td><td className="p-2">{valid && !historyError ? Number((entered - extracted).toFixed(3)) : '—'}</td><td className="p-2">{valid ? Number((item.qty - entered).toFixed(3)) : '—'}</td></tr>
      })}</tbody></table></div>
      <p className="text-xs text-slate-500">الكميات حتى ثلاثة منازل عشرية؛ لا تُجمع كميات بوحدات مختلفة. يمكن تخفيض الحصر فوق المستخلص بسبب موثق فقط.</p>
      <Field label="تاريخ قياس هذه المراجعة" hint="تاريخ القياس الذي تدخله لهذه المراجعة، لا تاريخ تسجيلها ولا تاريخ كل الكميات السابقة."><input type="date" aria-label="تاريخ قياس الحصر" max={todayLocalIso()} value={measurementDate} onChange={event => setMeasurementDate(event.target.value)} className={inputCls} /></Field>
      <div className="grid gap-3 md:grid-cols-2"><Field label="سبب التصحيح أو إعادة فتح الختامي"><input aria-label="سبب تعديل الحصر" value={reason} onChange={event => setReason(event.target.value)} className={inputCls} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isFinal} onChange={event => setIsFinal(event.target.checked)} /> حصر ختامي (لا يفترض تنفيذ كامل العقد)</label></div>
      <div className="flex flex-wrap gap-2"><Btn onClick={() => void save()} disabled={!canManage || !!historyError || !items.length || project.status !== 'active'}><Save size={15} /> اعتماد وحفظ الحصر</Btn><Btn onClick={print} disabled={!survey || !!historyError}><Printer size={15} /> طباعة الحصر المحفوظ</Btn><Btn onClick={() => void prepare()} disabled={!canManage || !survey || !hasDifference || !!historyError || project.status !== 'active'}><FileText size={15} /> تجهيز مسودة مستخلص من الحصر المحفوظ</Btn><Btn variant="ghost" onClick={() => selectProject(project.id)}>إعادة تحميل الحصر</Btn></div>
      {draft && <div className="rounded-xl border p-3 text-sm"><b>مسودة مستخلص محفوظة</b> — مشتقة من مراجعة {draft.surveyRevision}، ولا تمثل قيداً أو مطالبة مرحّلة. <button className="text-sky-700 underline ml-3" onClick={() => navigate(`/contracting/extracts?projectId=${project.id}&fromSurvey=1`)}>فتح المسودة</button> <button className="text-rose-600 underline" onClick={() => setConfirmDraftDelete(true)}>حذف المسودة</button>{confirmDraftDelete && <div className="flex flex-wrap items-center gap-2 pt-2"><input aria-label="سبب حذف مسودة المستخلص" value={draftDeleteReason} onChange={event => setDraftDeleteReason(event.target.value)} placeholder="سبب الحذف" className={inputCls} /><Btn onClick={() => void deleteDraft()} disabled={!canManage || !draftDeleteReason.trim()}>تأكيد حذف المسودة</Btn><Btn variant="ghost" onClick={() => setConfirmDraftDelete(false)}>تراجع</Btn></div>}</div>}
      {survey && <div className="rounded-xl border border-rose-300 p-3 text-sm"><button className="text-rose-700 underline" onClick={() => { setSurveyDeleteBasis(projectExtractFingerprint(data, project.id)); setConfirmSurveyDelete(true) }}>حذف الحصر غير المرحّل</button>{confirmSurveyDelete && <div className="space-y-2 pt-2"><p>سيُحذف الحصر ومراجعته ومسودة المستخلص إن وجدت. يُمنع الحذف عند وجود مستند مرتبط أو حركة مالية للمشروع.</p><input aria-label="سبب حذف الحصر" value={surveyDeleteReason} onChange={event => setSurveyDeleteReason(event.target.value)} placeholder="سبب الحذف" className={inputCls} /><div className="flex gap-2"><Btn onClick={() => void deleteSurvey()} disabled={!canManage || !surveyDeleteReason.trim()}>تأكيد حذف الحصر</Btn><Btn variant="ghost" onClick={() => setConfirmSurveyDelete(false)}>تراجع</Btn></div></div>}</div>}
      {survey && !hasDifference && !historyError && <div className="rounded-xl border border-amber-300 p-3 text-sm space-y-2"><p>لا توجد كمية محصورة غير مستخلصة؛ لا تُنشأ فاتورة صفرية. بعد اعتماد الحصر الختامي يمكن إصدار محضر إقفال كميات غير مالي.</p><button className="text-sky-700 underline" disabled={!canManage || !survey.isFinal || project.status !== 'active'} onClick={() => { setCloseoutBasis(projectExtractFingerprint(data, project.id)); setCloseoutConfirmed(false); setCloseoutOpen(true) }}>إصدار محضر إقفال الكميات</button>{closeoutOpen && <div className="space-y-2"><p>المحضر يثبت مطابقة الكميات وقت الإصدار فقط؛ لا يغلق المشروع ولا يسوي الذمم أو المحتجزات أو يثبت التسليم.</p><Field label="ملاحظات المحضر"><input aria-label="ملاحظات محضر الإقفال" maxLength={1000} value={closeoutNotes} onChange={event => setCloseoutNotes(event.target.value)} className={inputCls} /></Field><label className="flex items-center gap-2"><input type="checkbox" checked={closeoutConfirmed} onChange={event => setCloseoutConfirmed(event.target.checked)} /> راجعت الحصر الختامي والمستخلصات وأفهم أن المحضر غير مالي</label><div className="flex gap-2"><Btn onClick={() => void issueCloseout()} disabled={!closeoutConfirmed || !canManage}>تأكيد إصدار المحضر</Btn><Btn variant="ghost" onClick={() => setCloseoutOpen(false)}>إلغاء</Btn></div></div>}</div>}
      {projectCloseouts.some(row => row.projectId === project.id) && <details className="rounded-xl border p-3 text-sm"><summary className="font-bold cursor-pointer">محاضر إقفال الكميات</summary><ul className="space-y-2 pt-2">{projectCloseouts.filter(row => row.projectId === project.id).slice().reverse().map(row => <li key={row.id} className="border-t pt-2">{row.number} — مراجعة {row.surveyRevision} — {row.at} — {data.isProjectCloseoutCurrent(row.id) ? 'مطابق للأساس الحالي' : 'تاريخي — يحتاج مراجعة'} <button className="text-sky-700 underline" onClick={() => printCloseout(row.id)}>معاينة وطباعة المحضر</button></li>)}</ul></details>}
      {survey && <details className="rounded-xl border p-3 text-sm"><summary className="font-bold cursor-pointer">سجل المراجعات ({survey.revisions.length})</summary><ul className="space-y-2 pt-2">{[...survey.revisions].reverse().map(row => <li key={row.revision} className="border-t pt-2">مراجعة {row.revision} — وقت التسجيل {row.at} — تاريخ القياس {row.measurementDate ?? 'غير مسجل'} — {row.by} — {row.source === 'extract' ? `مستخلص #${row.extractId}` : 'إدخال/تصحيح'} {row.reason && `— ${row.reason}`} {row.isFinal && '— ختامي'}<div className="text-xs text-slate-500">{row.lines.map(line => { const item = items.find(item => item.id === line.boqItemId); return `${item?.code ?? `#${line.boqItemId}`} : ${line.cumulativeQty} ${line.unit ?? item?.unit ?? ''}` }).join(' · ')}</div></li>)}</ul></details>}
    </>}
  </div>
}
