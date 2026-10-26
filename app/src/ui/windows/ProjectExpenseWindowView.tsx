/**
 * نافذة مصروف المشروع الحرة (اعتماد المالك لنموذج N-04 الحي 2026-10-22
 * «بكل تفاصيلها» بدل المودال القديم): حقول واسعة لا تخنق الأسماء، بنود حرة
 * بتصنيفات تنمو من «أخرى…» وتُحفظ دائماً، مورد بزر «+» يفتح نافذة ابنة
 * مملوكة لهذه النافذة، مدفوع الآن ومصدره والباقي آجلاً على الجهة.
 * المحرك بلا تغيير في جوهره: الصافي ← 5110 · ضريبة المدخلات ← 2102 ·
 * المدفوع ← خزينة/عهدة · الآجل ← 2101 على المورد (addProjectCost).
 * مكيّفات معلنة عن النموذج: مفتاح الضريبة ثلاثي (بدون/+فوق الصافي/شاملة)
 * بدل علامة أحادية حتى لا تضيع فواتير «شاملة الضريبة»، وبند «تُحتسب ضمن»
 * عند إنشاء تصنيف حتى تهبط مصروفاته في حوض الموازنة الصحيح.
 */
import { useEffect, useMemo, useState } from 'react'
import { Hammer, Plus, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, computeProjectExpenseLine, normalizeExpenseCategoryName, type CostKind, type ExpenseTaxMode } from '../../core/contracting.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { DocOutcome } from '../components/DocSection.tsx'
import { PrePostChecks, type PrePostIssue } from '../components/PrePostChecks.tsx'
import { useWindowHost } from './windowHostContext.ts'
import { openPartyEditorWindow, openEntityPickerWindow } from './windowStore.ts'
import { todayLocalIso } from '../../core/time.ts'

const OTHER_CATEGORY_VALUE = '__other'

interface ExpenseLineDraft {
  id: number
  description: string
  /** '' أو رقم التصنيف كنص أو '__other' أثناء إنشاء تصنيف جديد */
  categoryId: string
  otherName: string
  otherKind: CostKind
  qty: string
  unitPrice: string
  boqItemId: string
}

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

export function ProjectExpenseWindowView() {
  const host = useWindowHost()
  const preselectProjectId = Number(host?.props.preselectProjectId ?? 0)
  const cur = useCur()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toast = useToast()
  const { setup } = useAppStore()
  const vatEnabled = setup.vatPercent > 0
  const defaultVat = vatEnabled ? setup.vatPercent : 14
  const {
    projects, suppliers, boqItems, costCenters, projectExpenseCategories,
    addProjectCost, addProjectExpenseCategory, getProjectProfit, getProjectBudgetVariance,
  } = useDataStore()
  const [checksOpen, setChecksOpen] = useState(false)

  const touch = () => host?.setDirty(true)
  useEffect(() => {
    if (!host) return
    host.setClosePrompt({ hint: 'بنود المصروف لم تُسجَّل بعد. الإغلاق يفقد هذا المصروف فقط — النوافذ الأخرى لن تتأثر.', discardLabel: 'إغلاق بلا تسجيل' })
    return () => host.setClosePrompt(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.windowId])

  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects])
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    const pre = activeProjects.find((p) => p.id === preselectProjectId)
    return pre ? String(pre.id) : activeProjects[0] ? String(activeProjects[0].id) : ''
  })
  const [supplierId, setSupplierId] = useState<number>(0)
  const [date, setDate] = useState<string>(() => todayLocalIso())
  const [invoiceRef, setInvoiceRef] = useState('')
  const [paidNow, setPaidNow] = useState('')
  const [paySource, setPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [costCenterId, setCostCenterId] = useState<number | null>(null)
  const [generalNotes, setGeneralNotes] = useState('')
  const [taxMode, setTaxMode] = useState<ExpenseTaxMode>(vatEnabled ? 'exclusive' : 'none')
  const [vatPercent, setVatPercent] = useState<string>(String(defaultVat))
  const firstCategoryId = projectExpenseCategories[0]?.id
  const newLine = (id: number): ExpenseLineDraft => ({
    id, description: '', categoryId: firstCategoryId != null ? String(firstCategoryId) : OTHER_CATEGORY_VALUE,
    otherName: '', otherKind: 'other', qty: '1', unitPrice: '', boqItemId: '',
  })
  const [lines, setLines] = useState<ExpenseLineDraft[]>(() => [newLine(1)])

  const selectedProject = projects.find((p) => p.id === Number(selectedProjectId)) ?? null
  const projectBoq = useMemo(
    () => (selectedProject ? boqItems.filter((b) => b.projectId === selectedProject.id) : []),
    [boqItems, selectedProject],
  )
  const selectedProjectProfit = selectedProject ? getProjectProfit(selectedProject.id) : null

  const updateLine = (id: number, patch: Partial<ExpenseLineDraft>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    touch()
  }
  const addLine = () => {
    setLines((prev) => [...prev, newLine(prev.reduce((m, r) => Math.max(m, r.id), 0) + 1)])
    touch()
  }
  const removeLine = (id: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev))
    touch()
  }
  const confirmOtherCategory = (draft: ExpenseLineDraft) => {
    const name = draft.otherName.trim()
    if (!name) { toast.show('اكتب اسم التصنيف أولاً', 'error'); return }
    try {
      const existed = projectExpenseCategories.some((c) => normalizeExpenseCategoryName(c.nameAr) === normalizeExpenseCategoryName(name))
      const cat = addProjectExpenseCategory(name, draft.otherKind)
      updateLine(draft.id, { categoryId: String(cat.id), otherName: '' })
      toast.show(existed
        ? `التصنيف «${cat.nameAr}» موجود أصلاً في قائمتك — اخترناه لك`
        : `✅ أُضيف التصنيف «${cat.nameAr}» لقائمتك الدائمة — سيظهر في كل مصروفات المشاريع بعد الآن`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const safeMinor = (v: string) => { try { return toMinor(v || '0', cur.decimals) } catch { return 0 } }
  const computedPreview = (() => {
    const vatPct = Number(vatPercent) || 0
    const rows = lines.map((l) => {
      const cat = l.categoryId && l.categoryId !== OTHER_CATEGORY_VALUE
        ? projectExpenseCategories.find((c) => c.id === Number(l.categoryId)) ?? null
        : null
      const computed = computeProjectExpenseLine(
        {
          description: l.description,
          kind: cat?.kind ?? 'other',
          categoryId: cat?.id ?? null,
          categoryNameAr: cat?.nameAr,
          qty: Number(l.qty) || 0,
          unitPriceMinor: safeMinor(l.unitPrice),
          taxMode,
          vatPercent: vatPct,
          boqItemId: l.boqItemId ? Number(l.boqItemId) : null,
        },
        defaultVat,
      )
      return { draft: l, computed, hasCategory: cat != null }
    })
    const valid = rows.filter((r) => r.hasCategory && r.computed.grossMinor > 0 && r.computed.description.length > 0)
    const pendingOther = rows.some((r) => r.draft.categoryId === OTHER_CATEGORY_VALUE && (r.computed.grossMinor > 0 || r.draft.description.trim().length > 0))
    return {
      rows, valid, pendingOther,
      netMinor: valid.reduce((s, r) => s + r.computed.netMinor, 0),
      vatMinor: valid.reduce((s, r) => s + r.computed.vatMinor, 0),
      grossMinor: valid.reduce((s, r) => s + r.computed.grossMinor, 0),
    }
  })()

  const paidNowMinor = (() => {
    try { return paidNow.trim() ? toMinor(paidNow, cur.decimals) : 0 }
    catch { return Number.NaN }
  })()
  const paidNowValid = Number.isInteger(paidNowMinor) && paidNowMinor >= 0 && paidNowMinor <= computedPreview.grossMinor
  const dueNowMinor = paidNowValid ? computedPreview.grossMinor - paidNowMinor : Math.max(0, computedPreview.grossMinor - (Number.isFinite(paidNowMinor) ? paidNowMinor : 0))

  /* مراجعة قبل الترحيل (طلب المالك — بنفس أسلوب فاتورة البيع): كل سبب رفض
     محتمل ظاهر داخل النافذة قبل الضغط، والضغط مع وجود مانع يفتح اللوحة بدل
     رسالة عابرة. المحرك يبقى الحكم الأخير — هذه مرآته المبكرة. */
  const prePostIssues: PrePostIssue[] = []
  if (!selectedProject) {
    prePostIssues.push({ id: 'no-project', level: 'blocking', text: 'لم تختر المشروع المحمَّل عليه المصروف', focus: '[data-expense-project-select]' })
  } else if (selectedProject.status === 'completed') {
    prePostIssues.push({ id: 'project-completed', level: 'blocking', text: `المشروع «${selectedProject.nameAr}» مقفل — لا تكاليف جديدة عليه`, focus: '[data-expense-project-select]' })
  }
  if (computedPreview.pendingOther) {
    prePostIssues.push({ id: 'pending-other', level: 'blocking', text: 'يوجد تصنيف جديد من «أخرى…» لم تُكمل إضافته للقائمة', hint: 'اكتب اسم التصنيف واضغط «إضافة للقائمة» أو اختر تصنيفاً موجوداً', focus: '[data-expense-other-name]' })
  }
  for (const { draft, computed } of computedPreview.rows) {
    const hasDesc = draft.description.trim().length > 0
    const hasValue = computed.grossMinor > 0
    if (hasValue && !hasDesc) prePostIssues.push({ id: `line-nodesc-${draft.id}`, level: 'blocking', text: 'يوجد بند بقيمة بلا بيان — البيان إلزامي للمراجعة', focus: '[data-expense-line-desc]' })
    else if (hasDesc && !hasValue && draft.categoryId !== OTHER_CATEGORY_VALUE) prePostIssues.push({ id: `line-novalue-${draft.id}`, level: 'blocking', text: `البند «${draft.description.trim()}» بلا قيمة موجبة (كمية × سعر)`, focus: '[data-expense-line-price]' })
    if (prePostIssues.length > 8) break
  }
  if (computedPreview.valid.length === 0 && !prePostIssues.some((i) => i.id.startsWith('line-'))) {
    prePostIssues.push({ id: 'no-lines', level: 'blocking', text: 'لا بنود مصروف صالحة بعد — أدخل بياناً وقيمة لبند واحد على الأقل', focus: '[data-expense-line-desc]' })
  }
  if (!paidNowValid) {
    prePostIssues.push({ id: 'paid-range', level: 'blocking', text: 'المبلغ المدفوع يجب أن يكون بين صفر وإجمالي المصروف', focus: '[data-expense-paid-now]' })
  }
  if (dueNowMinor > 0 && !supplierId) {
    prePostIssues.push({ id: 'due-no-supplier', level: 'blocking', text: `يوجد متبقٍّ آجل ${fmt(dueNowMinor)} ${cur.symbol} بلا مورد/جهة يظهر في كشف حسابها`, focus: '[data-expense-supplier]' })
  }
  if (paidNowValid && paidNowMinor > 0 && paySource.kind === 'custody' && !paySource.custodyFileId) {
    prePostIssues.push({ id: 'custody-missing', level: 'blocking', text: 'اختر ملف العهدة الذي دُفع منه المبلغ', focus: '[data-project-expense-source]' })
  }
  if (selectedProject && computedPreview.valid.length > 0) {
    try {
      const newByKind = new Map<CostKind, number>()
      for (const r of computedPreview.valid) newByKind.set(r.computed.kind, (newByKind.get(r.computed.kind) ?? 0) + r.computed.netMinor)
      for (const row of getProjectBudgetVariance(selectedProject.id).rows) {
        const add = newByKind.get(row.kind) ?? 0
        if (add > 0 && row.budgetMinor > 0 && row.actualMinor + add > row.budgetMinor) {
          prePostIssues.push({ id: `budget-${row.kind}`, level: 'warning', text: `سيتجاوز موازنة «${COST_KIND_LABELS[row.kind].nameAr}» بمقدار ${fmt(row.actualMinor + add - row.budgetMinor)} ${cur.symbol}`, hint: 'تنبيه فقط — الترحيل مسموح' })
        }
      }
    } catch { /* مشروع بلا موازنة — لا تحذيرات */ }
  }
  if (!invoiceRef.trim() && computedPreview.valid.length > 0) {
    prePostIssues.push({ id: 'no-ref', level: 'warning', text: 'بلا رقم فاتورة/إيصال مرجعي — المراجع الخارجي سيطلبه', focus: '[data-expense-date]' })
  }
  if (paidNowValid && paidNowMinor === 0 && computedPreview.grossMinor > 0) {
    prePostIssues.push({ id: 'full-credit', level: 'warning', text: 'المصروف آجل بالكامل — لن تتحرك أي خزينة الآن' })
  }
  const blockingCount = prePostIssues.filter((i) => i.level === 'blocking').length

  const saveExpenseInvoice = () => {
    if (!selectedProject) { toast.show('اختر المشروع أولاً', 'error'); return }
    if (computedPreview.pendingOther) { toast.show('أكمل إضافة التصنيف الجديد بزر «إضافة للقائمة» أو اختر تصنيفاً موجوداً للبند', 'error'); return }
    if (computedPreview.valid.length === 0) { toast.show('أدخل بند مصروف واحداً على الأقل ببيان وسعر موجب', 'error'); return }
    try {
      const grossMinor = computedPreview.grossMinor
      const paidMinor = paidNowMinor
      if (!Number.isInteger(paidMinor) || paidMinor < 0 || paidMinor > grossMinor) {
        throw new Error('المبلغ المدفوع يجب أن يكون بين صفر وإجمالي المصروف')
      }
      const dueMinor = grossMinor - paidMinor
      if (dueMinor > 0 && !supplierId) {
        throw new Error('يوجد متبقٍّ آجل — اختر المورد أو الجهة ليظهر في كشف حسابها')
      }
      if (paidMinor > 0 && paySource.kind === 'custody' && !paySource.custodyFileId) {
        throw new Error('اختر ملف العهدة الذي دُفع منه المبلغ')
      }
      const created = addProjectCost({
        projectId: selectedProject.id,
        payment: dueMinor === 0 ? 'cash' : paidMinor === 0 ? 'credit' : 'mixed',
        paidMinor,
        supplierId: supplierId || null,
        description: generalNotes.trim() || undefined,
        invoiceRef: invoiceRef.trim() || undefined,
        treasury: paidMinor > 0 && paySource.kind === 'treasury' ? paySource.treasury : undefined,
        custodyFileId: paidMinor > 0 && paySource.kind === 'custody' ? paySource.custodyFileId : null,
        costCenterId,
        defaultVatPercent: defaultVat,
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
        lines: computedPreview.valid.map((r) => ({
          description: r.computed.description,
          kind: r.computed.kind,
          categoryId: r.computed.categoryId ?? null,
          qty: r.computed.qty,
          unitPriceMinor: r.computed.unitPriceMinor,
          taxMode: r.computed.taxMode,
          vatPercent: r.computed.vatPercent,
          boqItemId: r.computed.boqItemId,
        })),
      })
      toast.show(
        `سُجّلت فاتورة مصروفات المشروع ${created.expenseNumber ?? `#${created.id}`} على «${selectedProject.nameAr}» — إجمالي ${fmt(created.grossMinor ?? created.amountMinor)}، مدفوع ${fmt(created.paidMinor ?? 0)}، وآجل ${fmt(created.dueMinor ?? 0)} ✅`,
      )
      host?.setDirty(false)
      host?.close()
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  if (activeProjects.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500" data-window-view="project-expense">
        لا مشروعات نشطة حالياً — أنشئ مشروعاً من قسم المشروعات ثم سجّل مصروفاته من هنا.
      </div>
    )
  }

  const completionPct = selectedProject && selectedProject.contractValueMinor > 0 && selectedProjectProfit
    ? Math.round((selectedProjectProfit.extractedMinor / selectedProject.contractValueMinor) * 100)
    : 0

  return (
    <div className="space-y-4 p-5" data-window-view="project-expense" data-project-expense-window>
      {/* حقول علوية واسعة: المشروع والمورد — بلا خنق للأسماء الطويلة */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Field label="المشروع المحمَّل عليه المصروف *">
          <select
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value)
              setLines((prev) => prev.map((l) => ({ ...l, boqItemId: '' })))
              touch()
            }}
            className={`${inputCls} h-11 text-[13.5px] font-bold`}
            title="انقر مرتين لفتح بحث المشاريع الحي — إنشاء مشروع جديد من داخله"
            onDoubleClick={() => openEntityPickerWindow({
              entity: 'project',
              parentId: host?.windowId ?? null,
              onPick: (id) => {
                setSelectedProjectId(String(id))
                setLines((prev) => prev.map((l) => ({ ...l, boqItemId: '' })))
                touch()
              },
            })}
            data-expense-project-select
          >
            <option value="">— اختر المشروع —</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.nameAr} ({p.clientName || 'بدون عميل'})</option>
            ))}
          </select>
        </Field>
        <Field
          label={dueNowMinor > 0 ? 'المورد / الجهة (للآجل وكشف الحساب) *' : 'المورد / الجهة (للآجل وكشف الحساب)'}
          hint={dueNowMinor > 0 ? `المتبقي الآجل ${fmt(dueNowMinor)} ${cur.symbol} يجب ربطه بجهة مسجلة.` : 'لا يلزم اختيار جهة إذا كان المبلغ مدفوعاً بالكامل.'}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 grow" data-expense-supplier>
              <PartyQuickPicker
                parties={suppliers}
                value={supplierId}
                onChange={(id) => { setSupplierId(id); touch() }}
                cashLabel="— بلا مورد (يجب أن يكون مدفوعاً بالكامل) —"
                label="بحث المورد / الجهة"
                entityKind="supplier"
                cashValue={0}
                showCash={dueNowMinor === 0}
              />
            </div>
            <button
              type="button"
              title="مورد جديد — إضافة سريعة في نافذة ابنة لهذه النافذة"
              aria-label="مورد جديد"
              data-expense-new-supplier
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-500/40 bg-brand-500/10 text-lg font-black text-brand-600 transition-colors hover:bg-brand-500/20 dark:text-brand-300"
              onClick={() => openPartyEditorWindow('supplier', 0, host?.windowId ?? null, (id) => { setSupplierId(id); touch() })}
            >
              ＋
            </button>
          </div>
        </Field>
      </div>

      {selectedProject && selectedProjectProfit && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-orange-500/25 bg-orange-500/5 p-3 text-center text-[12px] sm:grid-cols-4" data-expense-project-summary>
          <div><span className="block text-[10.5px] text-slate-500">قيمة العقد</span><b>{fmt(selectedProject.contractValueMinor)} {cur.symbol}</b></div>
          <div><span className="block text-[10.5px] text-slate-500">المستخلصات الصادرة ({completionPct}٪ منجز)</span><b className="text-emerald-600">{fmt(selectedProjectProfit.extractedMinor)} {cur.symbol}</b></div>
          <div><span className="block text-[10.5px] text-slate-500">التكاليف المسجلة سابقاً</span><b className="text-rose-600">{fmt(selectedProjectProfit.costsMinor)} {cur.symbol}</b></div>
          <div><span className="block text-[10.5px] text-slate-500">ربح المشروع الحالي</span><b className={selectedProjectProfit.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(selectedProjectProfit.profitMinor)} {cur.symbol}</b></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="التاريخ">
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); touch() }} className={inputCls} data-expense-date />
        </Field>
        <Field label="رقم فاتورة/إيصال مرجعي">
          <input value={invoiceRef} onChange={(e) => { setInvoiceRef(e.target.value); touch() }} className={inputCls} placeholder="مثال: INV-8821" dir="ltr" />
        </Field>
        <Field label={`المدفوع الآن (${cur.symbol})`} hint="اتركه فارغاً أو صفراً إذا كان آجلاً بالكامل">
          <input
            type="number" min={0} step="any" inputMode="decimal" dir="ltr" placeholder="0 = آجل بالكامل"
            value={paidNow}
            onChange={(e) => { setPaidNow(e.target.value); touch() }}
            className={inputCls}
            data-expense-paid-now
            data-project-expense-paid
          />
        </Field>
        <div className="space-y-1.5" data-project-expense-source>
          {paidNowValid && paidNowMinor > 0
            ? <PaySourcePicker linked value={paySource} onChange={(v) => { setPaySource(v); touch() }} />
            : <>
                <span className="block text-[12px] font-bold text-slate-600 dark:text-slate-300">مصدر المدفوع</span>
                <div className="flex min-h-10 items-center rounded-xl border border-dashed border-slate-300 px-3 text-[11px] text-slate-400 dark:border-slate-700" data-no-payment-source>لا يُختار مصدر سداد ما دام المدفوع صفراً.</div>
              </>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="مركز التكلفة العام (اختياري)">
          <select value={costCenterId ?? ''} onChange={(e) => { setCostCenterId(e.target.value ? Number(e.target.value) : null); touch() }} className={inputCls}>
            <option value="">بدون مركز عام</option>
            {costCenters.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.nameAr}</option>
            ))}
          </select>
        </Field>
        <Field label="بيان عام للفاتورة (اختياري)">
          <input value={generalNotes} onChange={(e) => { setGeneralNotes(e.target.value); touch() }} className={inputCls} placeholder="توريد مواد ومصنعيات موقع…" />
        </Field>
      </div>

      {!paidNowValid && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] font-bold text-rose-700 dark:text-rose-300" data-expense-paid-error>
          المبلغ المدفوع يجب أن يكون بين صفر وإجمالي المصروف.
        </p>
      )}

      {/* بنود المصروف الحرة */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12px]" data-expense-lines-table>
          <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <tr>
              <th className="p-2 text-right font-bold">#</th>
              <th className="min-w-[220px] p-2 text-right font-bold">بيان البند *</th>
              <th className="min-w-[230px] p-2 text-right font-bold">التصنيف — اختر أو أنشئ من «أخرى…»</th>
              {projectBoq.length > 0 && <th className="min-w-[140px] p-2 text-right font-bold">بند BOQ (اختياري)</th>}
              <th className="w-24 p-2 text-center font-bold">الكمية</th>
              <th className="w-32 p-2 text-center font-bold">السعر *</th>
              <th className="p-2 text-left font-bold">القيمة</th>
              <th className="w-10 p-2" />
            </tr>
          </thead>
          <tbody>
            {computedPreview.rows.map(({ draft, computed }, i) => (
              <tr key={draft.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="p-2 pt-3 text-slate-400">{i + 1}</td>
                <td className="p-2">
                  <input
                    value={draft.description}
                    onChange={(e) => updateLine(draft.id, { description: e.target.value })}
                    placeholder="بيان المصروف…"
                    className={inputCls}
                    data-expense-line-desc
                  />
                </td>
                <td className="p-2">
                  <select
                    value={draft.categoryId}
                    onChange={(e) => updateLine(draft.id, { categoryId: e.target.value })}
                    className={inputCls}
                    data-expense-line-category
                  >
                    {projectExpenseCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.nameAr}</option>
                    ))}
                    <option value={OTHER_CATEGORY_VALUE}>أخرى… (تصنيف جديد)</option>
                  </select>
                  {draft.categoryId === OTHER_CATEGORY_VALUE && (
                    <div className="mt-1.5 space-y-1.5 rounded-lg border border-brand-500/30 bg-brand-500/5 p-2" data-expense-other-add>
                      <input
                        value={draft.otherName}
                        onChange={(e) => updateLine(draft.id, { otherName: e.target.value })}
                        placeholder="اسم التصنيف الجديد…"
                        className={inputCls}
                        autoFocus
                        data-expense-other-name
                      />
                      <div className="flex items-center gap-1.5">
                        <select
                          value={draft.otherKind}
                          onChange={(e) => updateLine(draft.id, { otherKind: e.target.value as CostKind })}
                          className={inputCls}
                          title="تُحتسب ضمن (حوض الموازنة والتجميع المحاسبي)"
                          data-expense-other-kind
                        >
                          {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                            <option key={k} value={k}>تُحتسب ضمن: {COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</option>
                          ))}
                        </select>
                        <Btn type="button" onClick={() => confirmOtherCategory(draft)} data-expense-other-confirm>إضافة للقائمة</Btn>
                      </div>
                    </div>
                  )}
                </td>
                {projectBoq.length > 0 && (
                  <td className="p-2">
                    <select value={draft.boqItemId} onChange={(e) => updateLine(draft.id, { boqItemId: e.target.value })} className={inputCls}>
                      <option value="">— عام —</option>
                      {projectBoq.map((b) => (
                        <option key={b.id} value={b.id}>{b.code} — {b.descriptionAr}</option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="p-2">
                  <input value={draft.qty} onChange={(e) => updateLine(draft.id, { qty: e.target.value })} inputMode="decimal" dir="ltr" className={`${inputCls} text-center`} data-expense-line-qty />
                </td>
                <td className="p-2">
                  <input value={draft.unitPrice} onChange={(e) => updateLine(draft.id, { unitPrice: e.target.value })} inputMode="decimal" dir="ltr" placeholder="0.00" className={`${inputCls} text-center font-bold`} data-expense-line-price />
                </td>
                <td className="p-2 pt-3 text-left font-black tabular-nums" data-expense-line-gross>{fmt(computed.grossMinor)}</td>
                <td className="p-2 pt-2.5 text-center">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(draft.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-600" title="حذف البند">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Btn variant="ghost" type="button" onClick={addLine} data-add-expense-line>
          <Plus className="h-4 w-4" /> بند مصروف
        </Btn>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700" data-expense-tax-mode role="group" aria-label="طريقة احتساب ضريبة المدخلات">
          {([
            ['none', 'بدون ضريبة'],
            ['exclusive', 'ضريبة فوق الصافي'],
            ['inclusive', 'الأسعار شاملة الضريبة'],
          ] as [ExpenseTaxMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={taxMode === mode}
              onClick={() => { setTaxMode(mode); touch() }}
              className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-colors ${taxMode === mode ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {taxMode !== 'none' && (
          <label className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-500">
            ض.ق.م المدخلات ٪ (تُسترد 2102)
            <input value={vatPercent} onChange={(e) => { setVatPercent(e.target.value); touch() }} inputMode="decimal" dir="ltr" className={`${inputCls} w-20 text-center`} />
          </label>
        )}
        <span className="text-[11.5px] text-slate-500">عدد البنود الفعالة: <b>{computedPreview.valid.length}</b></span>
      </div>

      {/* الإجماليات الفورية وأثرها على ربح المشروع */}
      <div className="space-y-3 rounded-2xl border-2 border-rose-500/30 bg-rose-500/5 p-4" data-expense-summary-box>
        <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
          <div className="rounded-xl border border-rose-500/20 bg-white p-3 dark:bg-slate-900">
            <div className="text-[11px] text-slate-500">صافي المصروف المحمّل على المشروع (5110)</div>
            <div className="text-lg font-black text-rose-600" data-expense-total-net>{fmt(computedPreview.netMinor)} {cur.symbol}</div>
            <div className="text-[10px] text-slate-400">يُخصم مباشرة من صافي ربح المشروع</div>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-white p-3 dark:bg-slate-900">
            <div className="text-[11px] text-slate-500">ضريبة مدخلات مستردة (2102)</div>
            <div className="text-lg font-black text-sky-600" data-expense-total-vat>{fmt(computedPreview.vatMinor)} {cur.symbol}</div>
            <div className="text-[10px] text-slate-400">تُسترد ضريبياً ولا تُحمَّل على تكلفة المشروع</div>
          </div>
          <div className="rounded-xl bg-rose-600 p-3 text-white">
            <div className="text-[11px] opacity-90">الإجمالي الشامل</div>
            <div className="text-xl font-black" data-expense-total-gross>{fmt(computedPreview.grossMinor)} {cur.symbol}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/20 pt-2 text-[10px] opacity-95" data-expense-payment-breakdown>
              <div>مدفوع الآن: <b data-expense-paid-preview>{fmt(paidNowValid ? paidNowMinor : 0)} {cur.symbol}</b></div>
              <div>متبقٍّ آجل: <b data-expense-due-preview>{fmt(dueNowMinor)} {cur.symbol}</b></div>
            </div>
          </div>
        </div>
        {selectedProject && selectedProjectProfit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rose-500/20 pt-2 text-[12px]" data-expense-profit-impact>
            <span>أثر الفاتورة على صافي ربح المشروع (<b>{selectedProject.nameAr}</b>):</span>
            <span>
              الربح قبل المصروف: <b>{fmt(selectedProjectProfit.profitMinor)} {cur.symbol}</b>
              {' ← '}
              الربح بعد خصم صافي المصروف:{' '}
              <b className={selectedProjectProfit.profitMinor - computedPreview.netMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'} data-expense-profit-after>
                {fmt(selectedProjectProfit.profitMinor - computedPreview.netMinor)} {cur.symbol}
              </b>
            </span>
          </div>
        )}
      </div>

      <DocOutcome>الأثر: <b>5110 تكاليف مشروعات مقاولات</b> مديناً بالصافي {fmt(computedPreview.netMinor)} · <b>2102</b> مديناً بالضريبة {fmt(computedPreview.vatMinor)}{paidNowValid && paidNowMinor > 0 ? <> · <b>{paySource.kind === 'custody' ? '1108 عهد الموظف' : `الخزينة/البنك ${paySource.treasury}`}</b> دائناً بالمدفوع {fmt(paidNowMinor)}</> : null}{dueNowMinor > 0 ? <> · <b>2101 المورد/الجهة المختارة</b> دائناً بالمتبقي الآجل {fmt(dueNowMinor)}</> : null}.</DocOutcome>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <span className="text-[11px] text-slate-400">تصنيفاتك الحرة محفوظة وتعود معك كل مرة</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setChecksOpen((v) => !v)}
              title="مراجعة المصروف قبل الترحيل: موانع وتنبيهات بأسبابها"
              data-expense-prepost-open
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11.5px] font-extrabold transition-colors ${blockingCount > 0 ? 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-300' : prePostIssues.length > 0 ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'}`}
            >
              ✓ مراجعة قبل الترحيل
              {prePostIssues.length > 0 && <span className="rounded-full bg-current/15 px-1.5 text-[10px] font-black">{prePostIssues.length}</span>}
            </button>
            <PrePostChecks issues={prePostIssues} open={checksOpen} onClose={() => setChecksOpen(false)} />
          </div>
          <Btn variant="ghost" onClick={() => host?.close()}>إغلاق</Btn>
          <Btn
            onClick={() => {
              if (blockingCount > 0) { setChecksOpen(true); toast.show('توجد موانع ترحيل — راجع لوحة «مراجعة قبل الترحيل» لتعرف أين الخطأ بالضبط', 'error'); return }
              saveExpenseInvoice()
            }}
            shortcut="F9"
            data-save-project-expense
            disabled={!selectedProject}
          >
            <Hammer className="h-4 w-4" /> ✔ تسجيل المصروف
          </Btn>
        </div>
      </div>
    </div>
  )
}
