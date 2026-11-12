import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Printer, Save } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { projectExtractFingerprint, ProjectCommitUnconfirmedError, withProjectExtractCommit } from '../../data/projectExtractCommit.ts'
import { assertSurveyIntegrity, exactBilledQuantities } from '../../core/projectSurvey.ts'
import { assertQuantityChangeLinks } from '../../core/projectExtractQuantity.ts'
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
  // للمراجعة فقط؛ لا يعيد فتح الختامي ولا يفعّل تجهيز مستخلص جديد.
  let netHistory: ReturnType<typeof data.getProjectNetQuantityReport> | null = null, netHistoryError = ''
  if (project && history.some(row => (row.refundedMinor ?? 0) > 0 || (row.refunds?.length ?? 0) > 0)) {
    try { netHistory = data.getProjectNetQuantityReport(project.id) } catch (error) { netHistoryError = (error as Error).message }
  }
  const selectProject = (id: number) => {
    setProjectId(id); setMeasurementDate(todayLocalIso()); setReason(''); setDraftDeleteReason(''); setConfirmDraftDelete(false); setSurveyDeleteReason(''); setConfirmSurveyDelete(false); setCloseoutOpen(false); setCloseoutConfirmed(false); setCloseoutNotes('')
    const selected = projectSurveys.find(row => row.projectId === id)
    const selectedItems = boqItems.filter(row => row.projectId === id)
    setValues(Object.fromEntries(selectedItems.map(item => [item.id, String(selected?.lines.find(line => line.boqItemId === item.id)?.cumulativeQty ?? 0)])))
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
    const build = () => {
      const fresh = useDataStore.getState(), matches = fresh.projectCloseouts.filter(row => row.id === id)
      if (matches.length !== 1 || !fresh.projects.some(row => row.id === matches[0].projectId)) throw new Error('المحضر أو مشروعه غير موجود في الفرع الحالي')
      const app = useAppStore.getState(), currency = (app.setup.countryCode && getCountry(app.setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
      return renderCloseoutHtml({ shopName: app.setup.shopName || 'المقاولات', record: matches[0], current: fresh.isProjectCloseoutCurrent(id), currency: currency.symbol, fmt: amount => formatMinor(amount, currency, false) })
    }
    try { openPrintPreview({ html: build(), rebuild: build, wide: true, title: 'محضر إقفال كميات' }) } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const print = () => {
    if (!project || !survey) return
    const id = project.id
    const build = () => {
      const fresh = useDataStore.getState(), projects = fresh.projects.filter(row => row.id === id), surveys = fresh.projectSurveys.filter(row => row.projectId === id)
      if (projects.length !== 1 || surveys.length !== 1) throw new Error('المشروع أو حصره غير موجود أو غير فريد في الفرع الحالي')
      const app = useAppStore.getState(), currency = (app.setup.countryCode && getCountry(app.setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
      const currentItems = fresh.boqItems.filter(row => row.projectId === id)
      assertQuantityChangeLinks(currentItems, fresh.changeOrders.filter(row => row.projectId === id))
      let showBilled = true
      try { fresh.assertProjectExtractOriginals(id); fresh.assertProjectExtractRefunds(id) } catch { showBilled = false }
      return renderSurveyHtml({ shopName: app.setup.shopName || 'المقاولات', project: projects[0], survey: surveys[0], items: currentItems, history: fresh.projectExtracts.filter(row => row.projectId === id), fmt: amount => formatMinor(amount, currency, false), currency: currency.symbol, showBilled })
    }
    try { openPrintPreview({ html: build(), rebuild: build, wide: true, title: `كشف الحصر — ${project.code}` }) } catch (error) { toast.show((error as Error).message, 'error') }
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
      <p className="text-xs text-slate-500">الكميات حتى ثلاثة منازل عشرية؛ لا تُجمع كميات بوحدات مختلفة. الحصر مستقل عن المستخلص؛ يتطلب تخفيض كمية محصورة سبباً موثقاً.</p>
      {(netHistory || netHistoryError) && <section className="rounded-xl border border-sky-400/40 p-3 space-y-2" aria-label="مراجعة صافي كميات الإشعارات">
        <h2 className="font-bold">مراجعة صافي الكميات بعد الإشعارات</h2>
        <p className="text-xs text-slate-500">للمراجعة فقط: الإشعار يخفض الكمية والقيمة المستخلصة، ولا يغيّر الحصر الفعلي أو يعيد فتح الختامي. الفرق مقارن بالحصر المحفوظ لا القيم غير المحفوظة.</p>
        {netHistoryError && <p role="alert">{netHistoryError} — لا يمكن عرض صافي موثوق دون مراجعة التاريخ والدفتر.</p>}
        {netHistory && <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['البند', 'المستخلص الأصلي', 'كمية الإشعارات', 'صافي المستخلص', 'الحصر المحفوظ', 'الحصر ناقص الصافي', 'قيمة الأعمال الصافية قبل الضريبة'].map(text => <th key={text} className="p-2 text-right">{text}</th>)}</tr></thead><tbody>{netHistory.rows.map(row => {
          const item = items.find(value => value.id === row.boqItemId)!, measured = survey?.lines.find(value => value.boqItemId === row.boqItemId)?.cumulativeQty ?? 0
          return <tr key={row.boqItemId} className="border-t"><td className="p-2">{item.code} — {item.unit}</td><td className="p-2">{row.issuedQty}</td><td className="p-2">{row.returnedQty}</td><td className="p-2">{row.netQty}</td><td className="p-2">{survey ? measured : '—'}</td><td className="p-2">{survey ? Number((measured - row.netQty).toFixed(3)) : '—'}</td><td className="p-2">{fmt(row.netMinor)}</td></tr>
        })}</tbody></table></div><details><summary className="cursor-pointer font-bold">تسلسل المستخلصات والإشعارات</summary><p className="text-xs text-slate-500">الترتيب حسب رقم القيد المسجل، وليس حسب تاريخ المستند الذي قد يُدخل بأثر رجعي.</p><ol className="space-y-1 pt-2">{netHistory.events.map(event => <li key={event.journalEntryId} className="text-sm">قيد {event.journalEntryId} — {event.date} — {event.extractNumber} — {event.kind === 'credit' ? 'إشعار دائن' : 'مستخلص'} — {fmt(event.grossMinor)} قبل الضريبة</li>)}</ol></details></>}
      </section>}
      <Field label="تاريخ قياس هذه المراجعة" hint="تاريخ القياس الذي تدخله لهذه المراجعة، لا تاريخ تسجيلها ولا تاريخ كل الكميات السابقة."><input type="date" aria-label="تاريخ قياس الحصر" max={todayLocalIso()} value={measurementDate} onChange={event => setMeasurementDate(event.target.value)} className={inputCls} /></Field>
      <div className="grid gap-3 md:grid-cols-2"><Field label="سبب التصحيح أو إعادة فتح الختامي"><input aria-label="سبب تعديل الحصر" value={reason} onChange={event => setReason(event.target.value)} className={inputCls} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isFinal} onChange={event => setIsFinal(event.target.checked)} /> حصر ختامي (لا يفترض تنفيذ كامل العقد)</label></div>
      <div className="flex flex-wrap gap-2"><Btn onClick={() => void save()} disabled={!canManage || !items.length || project.status !== 'active'}><Save size={15} /> اعتماد وحفظ الحصر</Btn><Btn onClick={print} disabled={!survey}><Printer size={15} /> طباعة الحصر المحفوظ</Btn><Btn onClick={() => void prepare()} disabled={!canManage || !survey || !hasDifference || !!historyError || project.status !== 'active'}><FileText size={15} /> تجهيز مسودة مستخلص من الحصر المحفوظ</Btn><Btn variant="ghost" onClick={() => selectProject(project.id)}>إعادة تحميل الحصر</Btn></div>
      {draft && <div className="rounded-xl border p-3 text-sm"><b>مسودة مستخلص محفوظة</b> — مشتقة من مراجعة {draft.surveyRevision}، ولا تمثل قيداً أو مطالبة مرحّلة. <button className="text-sky-700 underline ml-3" onClick={() => navigate(`/contracting/extracts?projectId=${project.id}&fromSurvey=1`)}>فتح المسودة</button> <button className="text-rose-600 underline" onClick={() => setConfirmDraftDelete(true)}>حذف المسودة</button>{confirmDraftDelete && <div className="flex flex-wrap items-center gap-2 pt-2"><input aria-label="سبب حذف مسودة المستخلص" value={draftDeleteReason} onChange={event => setDraftDeleteReason(event.target.value)} placeholder="سبب الحذف" className={inputCls} /><Btn onClick={() => void deleteDraft()} disabled={!canManage || !draftDeleteReason.trim()}>تأكيد حذف المسودة</Btn><Btn variant="ghost" onClick={() => setConfirmDraftDelete(false)}>تراجع</Btn></div>}</div>}
      {survey && <div className="rounded-xl border border-rose-300 p-3 text-sm"><button className="text-rose-700 underline" onClick={() => { setSurveyDeleteBasis(projectExtractFingerprint(data, project.id)); setConfirmSurveyDelete(true) }}>حذف الحصر غير المرحّل</button>{confirmSurveyDelete && <div className="space-y-2 pt-2"><p>سيُحذف الحصر ومراجعته ومسودة المستخلص إن وجدت. يُمنع الحذف عند وجود مستند مرتبط أو حركة مالية للمشروع.</p><input aria-label="سبب حذف الحصر" value={surveyDeleteReason} onChange={event => setSurveyDeleteReason(event.target.value)} placeholder="سبب الحذف" className={inputCls} /><div className="flex gap-2"><Btn onClick={() => void deleteSurvey()} disabled={!canManage || !surveyDeleteReason.trim()}>تأكيد حذف الحصر</Btn><Btn variant="ghost" onClick={() => setConfirmSurveyDelete(false)}>تراجع</Btn></div></div>}</div>}
      {survey && !hasDifference && !historyError && <div className="rounded-xl border border-amber-300 p-3 text-sm space-y-2"><p>لا توجد كمية محصورة غير مستخلصة؛ لا تُنشأ فاتورة صفرية. بعد اعتماد الحصر الختامي يمكن إصدار محضر إقفال كميات غير مالي.</p><button className="text-sky-700 underline" disabled={!canManage || !survey.isFinal || project.status !== 'active'} onClick={() => { setCloseoutBasis(projectExtractFingerprint(data, project.id)); setCloseoutConfirmed(false); setCloseoutOpen(true) }}>إصدار محضر إقفال الكميات</button>{closeoutOpen && <div className="space-y-2"><p>المحضر يثبت مطابقة الكميات وقت الإصدار فقط؛ لا يغلق المشروع ولا يسوي الذمم أو المحتجزات أو يثبت التسليم.</p><Field label="ملاحظات المحضر"><input aria-label="ملاحظات محضر الإقفال" maxLength={1000} value={closeoutNotes} onChange={event => setCloseoutNotes(event.target.value)} className={inputCls} /></Field><label className="flex items-center gap-2"><input type="checkbox" checked={closeoutConfirmed} onChange={event => setCloseoutConfirmed(event.target.checked)} /> راجعت الحصر الختامي والمستخلصات وأفهم أن المحضر غير مالي</label><div className="flex gap-2"><Btn onClick={() => void issueCloseout()} disabled={!closeoutConfirmed || !canManage}>تأكيد إصدار المحضر</Btn><Btn variant="ghost" onClick={() => setCloseoutOpen(false)}>إلغاء</Btn></div></div>}</div>}
      {projectCloseouts.some(row => row.projectId === project.id) && <details className="rounded-xl border p-3 text-sm"><summary className="font-bold cursor-pointer">محاضر إقفال الكميات</summary><ul className="space-y-2 pt-2">{projectCloseouts.filter(row => row.projectId === project.id).slice().reverse().map(row => <li key={row.id} className="border-t pt-2">{row.number} — مراجعة {row.surveyRevision} — {row.at} — {data.isProjectCloseoutCurrent(row.id) ? 'مطابق للأساس الحالي' : 'تاريخي — يحتاج مراجعة'} <button className="text-sky-700 underline" onClick={() => printCloseout(row.id)}>معاينة وطباعة المحضر</button></li>)}</ul></details>}
      {survey && <details className="rounded-xl border p-3 text-sm"><summary className="font-bold cursor-pointer">سجل المراجعات ({survey.revisions.length})</summary><ul className="space-y-2 pt-2">{[...survey.revisions].reverse().map(row => <li key={row.revision} className="border-t pt-2">مراجعة {row.revision} — وقت التسجيل {row.at} — تاريخ القياس {row.measurementDate ?? 'غير مسجل'} — {row.by} — {row.source === 'extract' ? `مستخلص #${row.extractId}` : 'إدخال/تصحيح'} {row.reason && `— ${row.reason}`} {row.isFinal && '— ختامي'}<div className="text-xs text-slate-500">{row.lines.map(line => { const item = items.find(item => item.id === line.boqItemId); return `${item?.code ?? `#${line.boqItemId}`} : ${line.cumulativeQty} ${line.unit ?? item?.unit ?? ''}` }).join(' · ')}</div></li>)}</ul></details>}
    </>}
  </div>
}
