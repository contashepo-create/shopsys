import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
/**
 * صفحات المقاولات (القرار 27):
 * ProjectsPage — مشروعات بمستخلصات (PRX) وتكاليف ببنود ومحتجزات وربحية
 * كل قيد يظهر ويربط بالمشروع؛ الإفراج عن المحتجز يقفل المشروع.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, HardHat, Eye, BookOpenText, Banknote, TrendingUp, Receipt, Hammer, Wallet2, FilePlus2, Printer, HandCoins, Pencil, ShoppingCart, Truck, Users2, FileText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import type { Project } from '../../core/contracting.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, CHANGE_ORDER_STATUS_LABELS, boqItemTotal, effectiveContractValue, type CostKind } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { InvoiceDraftsModal } from '../components/InvoiceDraftsModal.tsx'
import { PrePostChecks, type PrePostIssue } from '../components/PrePostChecks.tsx'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { resolveDocumentPrintSettings } from '../print/branchPrint.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { usePrintSwitches } from '../hooks/usePrintSwitches.ts'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { openSalesInvoiceWindow, openProjectExpenseWindow, openExtractWizardWindow } from '../windows/windowStore.ts'
import { ProjectExpenseLedgerCard } from '../contracting/ProjectExpenseLedgerCard.tsx'
import { renderExtractHtml, renderExtractClientInvoiceHtml } from '../print/printExtract.ts'
import { printHtml } from '../print/printReceipt.ts'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'
import { todayLocalIso } from '../../core/time.ts'

export function ProjectsPage() {
  const navigate = useNavigate()
  const {
    projects, projectExtracts, projectCosts, retentionReleases, journal, changeOrders, customers, suppliers, employees, boqItems, paymentTerminals, paymentTerminalTransactions,
    addProject, updateProject, addBoqItem, addProjectExtract, releaseRetention, getProjectProfit,
    advancedInvoiceDrafts, upsertAdvancedInvoiceDraft, deleteAdvancedInvoiceDraft,
    receiveClientAdvance, getAdvanceBalance, addChangeOrder, setChangeOrderStatus, refundProjectExtract,
    staffCommissions, addStaffCommission, editProjectExtract, sales, purchases,
    ensureServiceItemForFreeLine,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* مشروع جديد */
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientId, setClientId] = useState('') // ربط إداري — لا يمس رصيد العميل
  const [contractValue, setContractValue] = useState('')
  const [retention, setRetention] = useState('5')
  const [startDate, setStartDate] = useState(todayLocalIso())
  const [notes, setNotes] = useState('')
  /* بيانات تشغيلية موسعة (أمر التعديل: نماذج احترافية) — اختيارية */
  const [contractNumber, setContractNumber] = useState('')
  const [location, setLocation] = useState('')
  const [expectedEnd, setExpectedEnd] = useState('')
  const [managerId, setManagerId] = useState('')
  const [tags, setTags] = useState('')
  /* §92: مسودات المشروع (kind='project') + مراجعة قبل الإنشاء — مثل فاتورة الأعلاف */
  const [projDraftsOpen, setProjDraftsOpen] = useState(false)
  const [projDraftId, setProjDraftId] = useState(() => crypto.randomUUID())
  const [projChecksOpen, setProjChecksOpen] = useState(false)

  /* البند العالمي (طلب المالك): المشروع يُنشأ بجدول كميات BOQ —
     قيمة العقد تُحسب من مجموع البنود (كمية × سعر) لا تُكتب يدوياً */
  interface BoqDraft { code: string; descriptionAr: string; unit: string; qty: string; unitPrice: string; estCost: string }
  const emptyBoqLine = (): BoqDraft => ({ code: '', descriptionAr: '', unit: 'م2', qty: '', unitPrice: '', estCost: '' })
  const [boqDraft, setBoqDraft] = useState<BoqDraft[]>([emptyBoqLine()])
  const patchBoqLine = (i: number, patch: Partial<BoqDraft>) =>
    setBoqDraft((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const validBoqLines = boqDraft.filter((l) => l.descriptionAr.trim() && Number(l.qty) > 0 && Number(l.unitPrice) >= 0)
  const boqTotalMinor = validBoqLines.reduce((a, l) => a + Math.round(Number(l.qty) * toMinor(l.unitPrice, cur.decimals)), 0)
  // نمط الإدخال: بنود (الافتراضي العالمي) أو قيمة إجمالية (عقود المقطوعية بلا جدول)
  const [valueMode, setValueMode] = useState<'boq' | 'manual'>('boq')
  const effectiveContractMinor = valueMode === 'boq' ? boqTotalMinor : toMinor(contractValue, cur.decimals)

  /* §92: أخطاء مانعة وتحذيرات قبل إنشاء المشروع — لوحة مثل فاتورة الأعلاف */
  const projectIssues: PrePostIssue[] = [
    ...(nameAr.trim() === '' ? [{ id: 'name', level: 'blocking' as const, text: 'اسم المشروع مطلوب' }] : []),
    ...(clientName.trim() === '' ? [{ id: 'client', level: 'warning' as const, text: 'المشروع بلا عميل/جهة — لن يظهر في تقارير ذمم العميل' }] : []),
    ...(valueMode === 'boq' && validBoqLines.length === 0
      ? [{ id: 'boq-empty', level: 'blocking' as const, text: 'أدخل بند جدول كميات واحداً على الأقل (وصف + كمية + سعر) — أو بدّل إلى «قيمة إجمالية»' }]
      : []),
    ...(valueMode === 'manual' && effectiveContractMinor <= 0
      ? [{ id: 'value', level: 'blocking' as const, text: 'قيمة العقد الإجمالية مطلوبة (أكبر من صفر)' }]
      : []),
    ...(valueMode === 'boq' && boqTotalMinor <= 0 && validBoqLines.length > 0
      ? [{ id: 'boq-zero', level: 'blocking' as const, text: 'بنود الجدول لا تنتج قيمة عقد — راجع الكميات والأسعار' }]
      : []),
    ...(expectedEnd && expectedEnd < startDate
      ? [{ id: 'dates', level: 'warning' as const, text: 'تاريخ التسليم المتوقع يسبق تاريخ البدء' }]
      : []),
    ...boqDraft.filter((l) => l.descriptionAr.trim() && Number(l.qty) > 0 && Number(l.unitPrice) === 0).map((l) => ({
      id: `free:${l.code || l.descriptionAr.slice(0, 20)}`, level: 'warning' as const, text: `البند «${l.descriptionAr.slice(0, 30)}» بسعر صفر`,
    })),
  ]
  const projectBlocking = projectIssues.filter((issue) => issue.level === 'blocking').length

  const saveProjectDraft = () => {
    const draft = upsertAdvancedInvoiceDraft({
      id: projDraftId, kind: 'project',
      name: `مسودة مشروع — ${nameAr.trim() || 'بلا اسم'}`,
      payload: JSON.stringify({ nameAr, clientName, clientId, contractValue, retention, startDate, notes, contractNumber, location, expectedEnd, managerId, tags, valueMode, boqDraft }),
    })
    toast.show(`حُفظت مسودة المشروع ${new Date(draft.updatedAt).toLocaleTimeString('ar-EG')} ✓`)
  }
  const applyProjectDraft = (draft: { payload: string }) => {
    try {
      const d = JSON.parse(draft.payload)
      setNameAr(d.nameAr ?? ''); setClientName(d.clientName ?? ''); setClientId(d.clientId ?? ''); setContractValue(d.contractValue ?? '')
      setRetention(d.retention ?? '5'); setStartDate(d.startDate ?? todayLocalIso()); setNotes(d.notes ?? '')
      setContractNumber(d.contractNumber ?? ''); setLocation(d.location ?? ''); setExpectedEnd(d.expectedEnd ?? ''); setManagerId(d.managerId ?? ''); setTags(d.tags ?? '')
      setValueMode(d.valueMode ?? 'boq'); setBoqDraft(d.boqDraft?.length ? d.boqDraft : [emptyBoqLine()])
      setOpen(true)
      toast.show('استُعيدت مسودة المشروع — أكمل وأنشئه ✓')
    } catch { toast.show('تعذر قراءة المسودة المحفوظة', 'error') }
  }

  const saveProject = () => {
    /* §92: المانع يفتح لوحة المراجعة بدل رسالة مبعثرة — نمط فاتورة الأعلاف */
    if (projectBlocking > 0) { setProjChecksOpen(true); return }
    try {
      if (valueMode === 'boq' && validBoqLines.length === 0) throw new Error('أدخل بند جدول كميات واحداً على الأقل (وصف + كمية + سعر) — أو بدّل إلى «قيمة إجمالية»')

      const p = addProject({
        nameAr: nameAr.trim(), clientName: clientName.trim(),
        clientId: clientId ? Number(clientId) : null,
        contractValueMinor: effectiveContractMinor,
        retentionPercent: Number(retention) || 0, startDate, notes: notes.trim(),
        contractNumber: contractNumber.trim(), location: location.trim(),
        expectedEndDate: expectedEnd, managerEmployeeId: managerId ? Number(managerId) : null,
        tags: tags.split('،').map((t) => t.trim()).filter(Boolean),
      })
      // بنود BOQ تُسجل مع المشروع — المستخلصات البندية تعمل من اليوم الأول
      if (valueMode === 'boq') {
        validBoqLines.forEach((l, idx) => {
          addBoqItem({
            projectId: p.id, code: l.code.trim() || String(idx + 1),
            descriptionAr: l.descriptionAr.trim(), unit: l.unit.trim() || 'مقطوعية',
            qty: Number(l.qty), unitPriceMinor: toMinor(l.unitPrice, cur.decimals),
            estCostMinor: l.estCost ? toMinor(l.estCost, cur.decimals) : 0,
          })
        })
      }
      deleteAdvancedInvoiceDraft(projDraftId)
      setProjDraftId(crypto.randomUUID())
      toast.show(`أُنشئ المشروع ${p.code}${valueMode === 'boq' ? ` بجدول كميات من ${validBoqLines.length} بند — قيمة العقد ${fmt(effectiveContractMinor)}` : ''} ✅`)
      setOpen(false); setNameAr(''); setClientName(''); setClientId(''); setContractValue(''); setRetention('5'); setNotes('')
      setContractNumber(''); setLocation(''); setExpectedEnd(''); setManagerId(''); setTags(''); setBoqDraft([emptyBoqLine()]); setValueMode('boq')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* مستخلص */
  const [extractFor, setExtractFor] = useState<Project | null>(null)
  const [exGross, setExGross] = useState('')
  const [exDesc, setExDesc] = useState('')
  const [exPayment, setExPayment] = useState<'cash' | 'credit'>('credit')
  const [exTreasury, setExTreasury] = useState('1101')
  const [exTerminal, setExTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [exVat, setExVat] = useState(true)
  const [exRecovery, setExRecovery] = useState('')
  /* المستخلص البندي (AccFlex): نسب تنفيذ تراكمية لكل بند BOQ — قيمة الشريحة تُحسب تلقائياً */
  const [exMode, setExMode] = useState<'lines' | 'gross'>('gross')
  const [exFinal, setExFinal] = useState(false)
  const [exLines, setExLines] = useState<Record<number, string>>({}) // boqItemId → النسبة الجديدة كنص
  /* §94: مراجعة المستخلص الصادر (وثيقة كاملة) وتعديله (قيد عاكس + إعادة بناء) */
  const [viewExtract, setViewExtract] = useState<(typeof projectExtracts)[number] | null>(null)
  const [editingExtract, setEditingExtract] = useState<(typeof projectExtracts)[number] | null>(null)
  const [exReason, setExReason] = useState('')
  const extractBoq = useMemo(() => (extractFor ? boqItems.filter((b) => b.projectId === extractFor.id) : []), [boqItems, extractFor])
  /** النسبة المفوترة سابقاً لبند: تُقرأ من المستخلصات السابقة للمشروع (أو من المستخلص الجاري تعديله) حتى لا يمنع شريط تقدم الموقع إصدار مستخلص جزئي */
  const exPrevPct = (b: { id: number; progressPercent: number }) => {
    if (editingExtract) return editingExtract.lines?.find((l) => l.boqItemId === b.id)?.prevProgressPercent ?? 0
    if (!extractFor) return 0
    return projectExtracts
      .filter((ex) => ex.projectId === extractFor.id)
      .reduce((max, ex) => {
        const l = ex.lines?.find((x) => x.boqItemId === b.id)
        return l && l.newProgressPercent > max ? l.newProgressPercent : max
      }, 0)
  }
  const exLinesPreview = useMemo(() => {
    const rows = extractBoq.map((b) => {
      const prev = editingExtract
        ? (editingExtract.lines?.find((l) => l.boqItemId === b.id)?.prevProgressPercent ?? 0)
        : !extractFor
          ? 0
          : projectExtracts
              .filter((ex) => ex.projectId === extractFor.id)
              .reduce((max, ex) => {
                const l = ex.lines?.find((x) => x.boqItemId === b.id)
                return l && l.newProgressPercent > max ? l.newProgressPercent : max
              }, 0)
      const raw = exLines[b.id]
      const np = raw === undefined || raw === '' ? null : Number(raw)
      const total = Math.round(b.qty * b.unitPriceMinor)
      const slice = np !== null && Number.isFinite(np) && np > prev && np <= 100 ? Math.round((total * (np - prev)) / 100) : 0
      return { boq: b, prevPercent: prev, newPercent: np, sliceMinor: slice }
    })
    return { rows, grossMinor: rows.reduce((sum, row) => sum + row.sliceMinor, 0) }
  }, [extractBoq, exLines, editingExtract, extractFor, projectExtracts])
  const applyPartialSlicePercent = (slicePct: number) => {
    if (!extractFor) return
    if (exMode === 'lines' && extractBoq.length > 0) {
      const next: Record<number, string> = {}
      for (const b of extractBoq) {
        const prev = exPrevPct(b)
        if (prev < 100) {
          const target = slicePct >= 100 ? 100 : Math.min(100, Math.round((prev + slicePct) * 100) / 100)
          if (target > prev) next[b.id] = String(target)
        }
      }
      setExLines(next)
      setExFinal(slicePct >= 100)
    } else {
      const pr = getProjectProfit(extractFor.id)
      const remaining = Math.max(0, extractFor.contractValueMinor - pr.extractedMinor)
      const base = remaining > 0 ? remaining : extractFor.contractValueMinor
      const sliceMinor = slicePct >= 100 ? base : Math.round(( extractFor.contractValueMinor * slicePct) / 100)
      setExGross(formatMinor(Math.min(base > 0 ? base : sliceMinor, sliceMinor), cur, false))
      setExFinal(slicePct >= 100)
    }
  }
  /** فتح محرر المستخلص محمّلاً بقيمه الصادرة — التعديل يعكس قيده ويعيد البناء بنفس الرقم */
  const openExtractEditor = (ex: (typeof projectExtracts)[number]) => {
    const prj = projects.find((p) => p.id === ex.projectId)
    if (!prj) return
    setViewExtract(null)
    setEditingExtract(ex)
    setExtractFor(prj)
    setExDesc(ex.description)
    setExPayment(ex.payment)
    setExTreasury('1101')
    setExVat(ex.totals.vatMinor > 0)
    setExRecovery(ex.advanceRecoveryMinor ? formatMinor(ex.advanceRecoveryMinor, cur, false) : '')
    setExFinal(!!ex.isFinal)
    setExReason('')
    if (ex.lines?.length) {
      setExMode('lines')
      setExLines(Object.fromEntries(ex.lines.map((l) => [l.boqItemId, String(l.newProgressPercent)])))
    } else {
      setExMode('gross')
      setExGross(formatMinor(ex.totals.grossMinor, cur, false))
    }
  }

  // مستخلص آجل فوق حد ائتمان عميل المشروع — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')

  /* ─── معاينة المستندين بمحرك قوالب الفواتير (طلب المالك: نافذة مثل نافذة الفاتورة) ─── */
  const printSwitches = usePrintSwitches()
  /** معاينة مستند قبل إنشائه: تعرض في النافذة الحرة أو تطبع صامتة حسب المفاتيح الثلاثة */
  const previewDraftDoc = (model: ReturnType<typeof buildSimpleDocModel>, title: string, templateHint?: InvoiceTemplate) => {
    const template: InvoiceTemplate = templateHint ?? (printSwitches.cashierPrint ? 'thermal' : 'a4')
    const live = useAppStore.getState().receipt
    if (!printSwitches.silentPrint) {
      openPrintPreview({
        html: buildModelHtml(model, cur, live, template),
        wide: template !== 'thermal',
        title,
        rebuild: () => { const r = useAppStore.getState().receipt; return buildModelHtml(model, cur, r, template) },
      })
      return
    }
    printModelWithTemplate(model, cur, live, template)
  }
  /** نموذج طباعة مشروع جديد: بنود جدول الكميات وقيمة العقد — كوثيقة تعاقدية قبل الإنشاء */
  const buildProjectDraftModel = () => buildSimpleDocModel({
    docTitle: valueMode === 'boq' ? 'مستند مشروع — جدول كميات' : 'مستند مشروع — مقطوعية',
    invoiceNumber: 'مسودة',
    refCode: 'PRJ-DRAFT',
    dateIso: startDate,
    partyLabel: clientName.trim() || 'عميل غير محدد',
    paymentLabel: `محتجز ضمان ${Number(retention) || 0}٪${expectedEnd ? ` · التسليم المتوقع ${expectedEnd}` : ''}`,
    rows: validBoqLines.map((l) => ({ nameAr: `${l.code.trim() || '—'} — ${l.descriptionAr.trim()} (${l.unit.trim() || 'مقطوعية'})`, qty: Number(l.qty), unitPriceMinor: toMinor(l.unitPrice, cur.decimals), totalMinor: Math.round(Number(l.qty) * toMinor(l.unitPrice, cur.decimals)) })),
    totalMinor: effectiveContractMinor,
    paidMinor: 0,
    operatorName: setup.ownerName ?? 'المالك',
    settings: useAppStore.getState().receipt,
    extraFooter: [notes.trim(), location.trim() && `الموقع: ${location.trim()}`].filter(Boolean).join(' · ') || undefined,
  })
  /** نموذج طباعة المستخلص قبل تسجيله: شرائح البنود أو المبلغ الإجمالي، والمحتجز والمستحق في التذييل */
  const buildExtractDraftModel = () => {
    if (!extractFor) throw new Error('لا مشروع')
    const grossMinor = exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)
    const vatMinor = Math.round((grossMinor * (exVat ? setup.vatPercent : 0)) / 100)
    const retentionMinor = Math.round((grossMinor * extractFor.retentionPercent) / 100)
    const recoveryMinor = exRecovery ? toMinor(exRecovery, cur.decimals) : 0
    const dueMinor = grossMinor + vatMinor - retentionMinor - recoveryMinor
    return buildSimpleDocModel({
      docTitle: exFinal ? 'مستخلص ختامي — أعمال منفذة' : 'مستخلص أعمال منفذة',
      invoiceNumber: 'مسودة',
      refCode: `PRX-${extractFor.code}`,
      dateIso: todayLocalIso(),
      partyLabel: extractFor.clientName || 'الجهة المالكة',
      paymentLabel: `${exPayment === 'cash' ? 'تحصيل فوري' : 'آجل (مستحق على العميل)'} · المستحق ${formatMinor(dueMinor, cur, false)} ${cur.symbol}`,
      rows: exMode === 'lines' && extractBoq.length > 0
        ? exLinesPreview.rows.filter((r) => r.sliceMinor > 0).map((r) => ({ nameAr: `${r.boq.code} — ${r.boq.descriptionAr} (${r.newPercent ?? r.boq.progressPercent}٪ تراكمي)`, qty: 1, unitPriceMinor: r.sliceMinor, totalMinor: r.sliceMinor }))
        : grossMinor > 0 ? [{ nameAr: exDesc.trim() || 'قيمة الأعمال المنفذة', qty: 1, unitPriceMinor: grossMinor, totalMinor: grossMinor }] : [],
      totalMinor: dueMinor,
      paidMinor: exPayment === 'cash' ? dueMinor : 0,
      operatorName: setup.ownerName ?? 'المالك',
      settings: useAppStore.getState().receipt,
      extraFooter: [
        `مشروع: ${extractFor.nameAr} (${extractFor.code})`,
        `الأعمال: ${formatMinor(grossMinor, cur, false)}${vatMinor > 0 ? ` · ض.ق.م ${formatMinor(vatMinor, cur, false)}` : ''}`,
        `محتجز ${extractFor.retentionPercent}٪: ${formatMinor(retentionMinor, cur, false)}`,
        recoveryMinor > 0 ? `استرداد دفعة مقدمة: ${formatMinor(recoveryMinor, cur, false)}` : '',
      ].filter(Boolean).join(' · '),
    })
  }

  const saveExtract = (creditLimitOverrideBy?: string) => {
    if (!extractFor) return
    try {
      const linesInput = exMode === 'lines'
        ? Object.entries(exLines)
            .filter(([, v]) => v !== '')
            .map(([id, v]) => ({ boqItemId: Number(id), newProgressPercent: Number(v) }))
            .filter((l) => {
              const b = extractBoq.find((x) => x.id === l.boqItemId)
              return b ? l.newProgressPercent > exPrevPct(b) : false
            })
        : undefined
      const terminal = paymentTerminals.find((row) => row.id === exTerminal.terminalId)
      const ex = addProjectExtract({
        projectId: extractFor.id,
        grossMinor: exMode === 'gross' ? toMinor(exGross, cur.decimals) : undefined,
        extractLines: linesInput,
        vatPercent: exVat ? setup.vatPercent : 0, payment: exPayment, description: exDesc.trim(), treasury: terminal?.settlementAccountCode ?? exTreasury,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: exTerminal.providerReference.trim(), cardLast4: exTerminal.cardLast4 || undefined } : undefined,
        advanceRecoveryMinor: exRecovery ? toMinor(exRecovery, cur.decimals) : 0,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
        isFinal: exFinal,
      })
      toast.show(`سُجل المستخلص ${ex.extractNumber} — المستحق ${fmt(ex.totals.dueMinor)} والمحتجز ${fmt(ex.totals.retentionMinor)} ✅`)
      /* §94: بعد الإصدار تفتح وثيقة المستخلص فوراً — البيانات والطباعة والتعديل في مكان واحد */
      setExtractFor(null); setExGross(''); setExDesc(''); setExRecovery(''); setExLines({}); setExFinal(false)
      setViewExtract(ex)
    } catch (e) {
      if (e instanceof CreditLimitError) { creditApproval.request((by) => saveExtract(by ?? 'المشرف')); return }
      toast.show((e as Error).message, 'error')
    }
  }

  /* §94: حفظ تعديل مستخلص صادر — قيد عاكس موثق السبب ثم إعادة بناء بنفس الرقم */
  const saveExtractEdit = (creditLimitOverrideBy?: string) => {
    if (!extractFor || !editingExtract) return
    try {
      const linesInput = exMode === 'lines'
        ? Object.entries(exLines)
            .filter(([, v]) => v !== '')
            .map(([id, v]) => ({ boqItemId: Number(id), newProgressPercent: Number(v) }))
            .filter((l) => {
              const b = extractBoq.find((x) => x.id === l.boqItemId)
              return b ? l.newProgressPercent > exPrevPct(b) : false
            })
        : undefined
      const ex = editProjectExtract({
        extractId: editingExtract.id,
        grossMinor: exMode === 'gross' ? toMinor(exGross, cur.decimals) : undefined,
        extractLines: linesInput,
        vatPercent: exVat ? setup.vatPercent : 0, payment: exPayment, description: exDesc.trim(), treasury: exTreasury,
        advanceRecoveryMinor: exRecovery ? toMinor(exRecovery, cur.decimals) : 0,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null, isFinal: exFinal, reason: exReason.trim(),
      })
      toast.show(`عُدّل المستخلص ${ex.extractNumber}: قيد عاكس ثم إعادة بناء — الصافي الآن ${fmt(ex.totals.dueMinor)} ✅`)
      setExtractFor(null); setEditingExtract(null); setExReason(''); setExGross(''); setExDesc(''); setExRecovery(''); setExLines({}); setExFinal(false)
      setViewExtract(ex)
    } catch (e) {
      if (e instanceof CreditLimitError) { creditApproval.request((by) => saveExtractEdit(by ?? 'المشرف')); return }
      toast.show((e as Error).message, 'error')
    }
  }

  /* عرض */
  const [viewing, setViewing] = useState<Project | null>(null)
  const [refundingExtract, setRefundingExtract] = useState<(typeof projectExtracts)[number] | null>(null)
  // عمولة موظف عن المشروع (تعميم — أمر المالك): مهندس مبيعات جلب العقد مثلاً
  const [commFor, setCommFor] = useState<Project | null>(null)
  /* §94-مراجعة (بلاغ المالك: «راجع كل شئ»): تعديل بيانات المشروع — قيمة العقد قبل أول مستخلص فقط */
  const [editPrj, setEditPrj] = useState<Project | null>(null)
  const [epName, setEpName] = useState(''); const [epClient, setEpClient] = useState(''); const [epClientId, setEpClientId] = useState('')
  const [epValue, setEpValue] = useState(''); const [epRetention, setEpRetention] = useState('')
  const [epStart, setEpStart] = useState(''); const [epEnd, setEpEnd] = useState(''); const [epLocation, setEpLocation] = useState('')
  const [epContractNo, setEpContractNo] = useState(''); const [epNotes, setEpNotes] = useState('')
  /* سد فجوة تقرير النشاط #11: لا مرجعية زمنية لاستحقاق الإفراج عن المحتجز بعد التسليم */
  const [epHandover, setEpHandover] = useState(''); const [epDlpMonths, setEpDlpMonths] = useState('')
  const openProjectEdit = (p: Project) => {
    setEditPrj(p)
    setEpName(p.nameAr); setEpClient(p.clientName); setEpClientId(p.clientId != null ? String(p.clientId) : '')
    setEpValue(String(p.contractValueMinor / 10 ** cur.decimals)); setEpRetention(String(p.retentionPercent))
    setEpStart(p.startDate); setEpEnd(p.expectedEndDate ?? ''); setEpLocation(p.location ?? '')
    setEpContractNo(p.contractNumber ?? ''); setEpNotes(p.notes ?? '')
    setEpHandover(p.actualHandoverDate ?? ''); setEpDlpMonths(p.defectsLiabilityMonths ? String(p.defectsLiabilityMonths) : '')
  }
  const saveProjectEdit = () => {
    if (!editPrj) return
    try {
      const updated = updateProject(editPrj.id, {
        nameAr: epName.trim(), clientName: epClient.trim(), clientId: epClientId ? Number(epClientId) : null,
        ...(epValue ? { contractValueMinor: toMinor(epValue, cur.decimals) } : {}),
        retentionPercent: Number(epRetention) || 0, startDate: epStart, expectedEndDate: epEnd || undefined,
        location: epLocation.trim() || undefined, contractNumber: epContractNo.trim() || undefined, notes: epNotes.trim(),
        actualHandoverDate: epHandover || null, defectsLiabilityMonths: epDlpMonths ? Number(epDlpMonths) : null,
      })
      toast.show(`عُدّلت بيانات ${updated.code} ✓`)
      setEditPrj(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const [commEmpId, setCommEmpId] = useState('')
  const [commAmount, setCommAmount] = useState('')
  const saveProjectCommission = () => {
    if (!commFor || !commEmpId || !commAmount.trim()) return
    try {
      const c = addStaffCommission({
        employeeId: Number(commEmpId), source: 'project', sourceId: commFor.id,
        description: `عمولة مشروع ${commFor.code} — ${commFor.nameAr}`,
        amountMinor: toMinor(commAmount, cur.decimals),
      })
      toast.show(`استُحقت ${c.code} — مصروف مربوط بالمشروع، تُصرف من شاشة الموظفين ← العمولات ✅`)
      setCommFor(null); setCommEmpId(''); setCommAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const viewingLive = viewing ? projects.find((p) => p.id === viewing.id) ?? null : null
  const profit = viewingLive ? getProjectProfit(viewingLive.id) : null
  const viewExtracts = viewingLive ? projectExtracts.filter((e) => e.projectId === viewingLive.id) : []

  /** المستخلص المطبوع (جولة المقاولات): تراكمي سابق + حالي + نسبة إنجاز + محتجز خصماً */
  const printExtract = (ex: (typeof projectExtracts)[number]) => {
    const prj = projects.find((p) => p.id === ex.projectId)
    if (!prj) return
    const documentSettings = resolveDocumentPrintSettings(prj)
    const previous = projectExtracts
      .filter((e) => e.projectId === ex.projectId && e.id < ex.id)
      .reduce((a, e) => a + e.totals.grossMinor, 0)
    const cumulative = previous + ex.totals.grossMinor
    printHtml(renderExtractHtml({
      shopName: documentSettings.setup.shopName || 'مقاولات',
      extractNumber: ex.extractNumber,
      dateIso: ex.date,
      projectName: prj.nameAr,
      projectCode: prj.code,
      clientName: prj.clientName,
      contractValue: prj.contractValueMinor > 0 ? `${fmt(prj.contractValueMinor)} ${cur.symbol}` : '',
      description: ex.description,
      previousGross: `${fmt(previous)} ${cur.symbol}`,
      currentGross: `${fmt(ex.totals.grossMinor)} ${cur.symbol}`,
      cumulativeGross: `${fmt(cumulative)} ${cur.symbol}`,
      progressPercent: prj.contractValueMinor > 0 ? Math.round((cumulative / prj.contractValueMinor) * 100) : null,
      vat: ex.totals.vatMinor > 0 ? `${fmt(ex.totals.vatMinor)} ${cur.symbol}` : '',
      retention: ex.totals.retentionMinor > 0 ? `${fmt(ex.totals.retentionMinor)} ${cur.symbol}` : '',
      retentionPercent: prj.retentionPercent,
      lines: (ex.lines ?? []).map((l) => ({ code: l.code, descriptionAr: l.descriptionAr, prevPercent: l.prevProgressPercent, newPercent: l.newProgressPercent, value: `${fmt(l.lineValueMinor)} ${cur.symbol}` })),
      advanceRecovery: ex.advanceRecoveryMinor ? `${fmt(ex.advanceRecoveryMinor)} ${cur.symbol}` : '',
      due: `${fmt(ex.totals.dueMinor)} ${cur.symbol}`,
      payment: ex.payment,
      currencySymbol: cur.symbol,
    }))
  }

  /** §96: طباعة فاتورة مستخلص احترافية للعميل (كأنها فاتورة بيع ولكنها مستخلص) */
  const printExtractClientInvoice = (ex: (typeof projectExtracts)[number]) => {
    const prj = projects.find((p) => p.id === ex.projectId)
    if (!prj) return
    const documentSettings = resolveDocumentPrintSettings(prj)
    const client = prj.clientId != null ? customers.find((c) => c.id === prj.clientId) : undefined
    const previous = projectExtracts
      .filter((e) => e.projectId === ex.projectId && e.id < ex.id)
      .reduce((a, e) => a + e.totals.grossMinor, 0)
    const cumulative = previous + ex.totals.grossMinor
    const einv = documentSettings.einvoice
    printHtml(renderExtractClientInvoiceHtml({
      shopName: documentSettings.setup.shopName || 'مقاولات',
      shopPhone: documentSettings.setup.phone,
      shopAddress: [documentSettings.setup.city, documentSettings.setup.street].filter(Boolean).join(' — '),
      shopTaxId: einv.taxNumber,
      extractNumber: ex.extractNumber,
      dateIso: ex.date,
      projectName: prj.nameAr,
      projectCode: prj.code,
      contractNumber: prj.contractNumber,
      clientName: client?.nameAr || prj.clientName || 'الجهة المالكة',
      clientPhone: client?.phone,
      clientTaxId: client?.taxNumber,
      contractValue: prj.contractValueMinor > 0 ? `${fmt(prj.contractValueMinor)} ${cur.symbol}` : '',
      description: ex.description,
      previousGross: `${fmt(previous)} ${cur.symbol}`,
      currentGross: `${fmt(ex.totals.grossMinor)} ${cur.symbol}`,
      cumulativeGross: `${fmt(cumulative)} ${cur.symbol}`,
      progressPercent: prj.contractValueMinor > 0 ? Math.round((cumulative / prj.contractValueMinor) * 100) : null,
      vat: ex.totals.vatMinor > 0 ? `${fmt(ex.totals.vatMinor)} ${cur.symbol}` : '',
      retention: ex.totals.retentionMinor > 0 ? `${fmt(ex.totals.retentionMinor)} ${cur.symbol}` : '',
      retentionPercent: prj.retentionPercent,
      advanceRecovery: ex.advanceRecoveryMinor ? `${fmt(ex.advanceRecoveryMinor)} ${cur.symbol}` : '',
      due: `${fmt(ex.totals.dueMinor)} ${cur.symbol}`,
      payment: ex.payment,
      currencySymbol: cur.symbol,
      isFinal: ex.isFinal,
      lines: (ex.lines ?? []).map((l) => {
        const boq = boqItems.find((b) => b.id === l.boqItemId)
        return {
          code: l.code,
          descriptionAr: l.descriptionAr,
          unit: boq?.unit,
          boqQty: boq?.qty,
          unitPrice: boq ? `${fmt(boq.unitPriceMinor)} ${cur.symbol}` : undefined,
          boqTotal: boq ? `${fmt(boqItemTotal(boq))} ${cur.symbol}` : undefined,
          prevPercent: l.prevProgressPercent,
          newPercent: l.newProgressPercent,
          currentSlicePercent: Math.max(0, Math.round((l.newProgressPercent - l.prevProgressPercent) * 100) / 100),
          value: `${fmt(l.lineValueMinor)} ${cur.symbol}`,
        }
      }),
    }))
  }
  const viewCosts = viewingLive ? projectCosts.filter((c) => c.projectId === viewingLive.id) : []
  const viewEntryIds = new Set([
    ...viewExtracts.map((e) => e.journalEntryId),
    ...viewCosts.map((c) => c.journalEntryId),
    ...retentionReleases.filter((r) => viewingLive && r.projectId === viewingLive.id).map((r) => r.journalEntryId),
  ])
  const viewEntries = journal.filter((e) => viewEntryIds.has(e.id))

  const [releaseFor, setReleaseFor] = useState<Project | null>(null)
  const [releaseTreasury, setReleaseTreasury] = useState('1101')
  const [releaseTerminal, setReleaseTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })

  /* دفعة مقدمة من العميل */
  const [advanceFor, setAdvanceFor] = useState<Project | null>(null)
  const [advAmount, setAdvAmount] = useState('')
  const [advTreasury, setAdvTreasury] = useState('1101')
  const [advTerminal, setAdvTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const saveAdvance = () => {
    if (!advanceFor) return
    try {
      const terminal = paymentTerminals.find((row) => row.id === advTerminal.terminalId)
      receiveClientAdvance({ projectId: advanceFor.id, amountMinor: toMinor(advAmount, cur.decimals), treasury: terminal?.settlementAccountCode ?? advTreasury, terminalPayment: terminal ? { terminalId: terminal.id, providerReference: advTerminal.providerReference.trim(), cardLast4: advTerminal.cardLast4 || undefined } : undefined })
      toast.show('سُجلت الدفعة المقدمة كالتزام 2109 — تُسترد من المستخلصات ✅')
      setAdvanceFor(null); setAdvAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* أمر تغيير */
  const [coFor, setCoFor] = useState<Project | null>(null)
  const [coTitle, setCoTitle] = useState('')
  const [coAmount, setCoAmount] = useState('')
  const [coDeduct, setCoDeduct] = useState(false)
  const saveChangeOrder = () => {
    if (!coFor) return
    try {
      const raw = toMinor(coAmount, cur.decimals)
      const co = addChangeOrder({ projectId: coFor.id, titleAr: coTitle.trim(), amountMinor: coDeduct ? -raw : raw })
      toast.show(`أُنشئ أمر التغيير ${co.number} (مسودة) — اعتمده ليدخل قيمة العقد ✅`)
      setCoFor(null); setCoTitle(''); setCoAmount(''); setCoDeduct(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const doRelease = () => {
    if (!releaseFor) return
    try {
      const terminal = paymentTerminals.find((row) => row.id === releaseTerminal.terminalId)
      const r = releaseRetention(releaseFor.id, terminal?.settlementAccountCode ?? releaseTreasury, terminal ? { terminalId: terminal.id, providerReference: releaseTerminal.providerReference.trim(), cardLast4: releaseTerminal.cardLast4 || undefined } : undefined)
      toast.show(`أُفرج عن محتجزات ${fmt(r.amount)} ${cur.symbol} وأُقفل المشروع 🎉`)
      setReleaseFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ═══ محرر مستند المشروع — نفس هيئة فاتورة البيع (طلب المالك: نافذة مثل نافذة الفاتورة تخدم المقاولات) ═══ */
  if (open) {
    return (
      <div data-project-doc-editor>
        <InvoicePOSFrame
          kind="sale"
          modeLabel="مشروع مقاولات"
          currencyLabel={`${cur.code} · ${cur.symbol}`}
          dateLabel={startDate}
          branchLabel={setup.shopName ?? ''}
          userLabel={setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber="PRJ-DRAFT"
          onBack={() => setOpen(false)}
          onNavigate={() => { /* لا تنقل أثناء التحرير */ }}
          onPartySearch={() => document.getElementById('project-client-field')?.focus()}
          onItemSearch={() => (document.getElementById('project-first-boq-line') ?? document.getElementById('project-contract-value'))?.focus()}
          onSaveDraft={saveProjectDraft}
          onRestoreDraft={() => setProjDraftsOpen(true)}
          onPrint={() => {
            if (valueMode === 'boq' && validBoqLines.length === 0) return toast.show('أضف بند جدول كميات واحداً على الأقل قبل المعاينة', 'error')
            previewDraftDoc(buildProjectDraftModel(), 'معاينة مستند المشروع — جدول الكميات')
          }}
          onExportPdf={() => { toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️'); if (valueMode === 'boq' ? validBoqLines.length > 0 : !!contractValue) previewDraftDoc(buildProjectDraftModel(), 'مستند المشروع') }}
          onPost={saveProject}
          headerFields={
            <>
              <Field label="اسم المشروع *" icon={<Hammer size={11} />}>
                <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="فيلا الشيخ زايد…" />
              </Field>
              <Field label="رقم العقد الرسمي">
                <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} className={inputCls} dir="ltr" placeholder="CT-2026-014" />
              </Field>
              <Field label="محتجز ضمان الأعمال ٪" hint="يُخصم من كل مستخلص ويُفرج عنه عند التسليم">
                <input value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="تاريخ البدء">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="التسليم المتوقع">
                <input type="date" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="العميل / الجهة المالكة">
                <div id="project-client-field" className="invoice-doc-infield flex gap-1">
                  <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="اسم الجهة" aria-label="اسم العميل" />
                  <PartyQuickPicker parties={customers} value={clientId ? Number(clientId) : 0} onChange={(id) => { setClientId(id ? String(id) : ''); const c = customers.find((x) => x.id === id); if (c && !clientName.trim()) setClientName(c.nameAr) }} cashLabel="بلا ربط" label="بحث العميل" cashValue={0} />
                </div>
              </Field>
              <Field label="مدير المشروع" hint="من سجل الموظفين">
                <PartyQuickPicker parties={employees.filter((employee) => employee.active)} value={managerId ? Number(managerId) : 0} onChange={(id) => setManagerId(id ? String(id) : '')} cashLabel="لاحقاً" label="بحث مدير المشروع" cashValue={0} />
              </Field>
              <Field label="موقع التنفيذ">
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="المنصورة — حي الجامعة" />
              </Field>
              <Field label="وسوم (افصل بـ ،)">
                <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="حكومي، تشطيبات" />
              </Field>
              <Field label="ملاحظات العقد">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
              </Field>
            </>
          }
          partyMeta={
            <div className="invoice-doc-partymeta">
              <span>النوع: <b>{valueMode === 'boq' ? '📐 جدول كميات' : '💵 مقطوعية'}</b></span>
              <span>العميل: <b>{clientName.trim() || 'غير محدد'}</b></span>
              <span>قيمة العقد: <b className="text-emerald-600">{fmt(effectiveContractMinor)} {cur.symbol}</b></span>
              <span>البنود: <b>{validBoqLines.length}</b></span>
              {expectedEnd && <span>التسليم: <b>{expectedEnd}</b></span>}
            </div>
          }
        >
          <section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark" data-project-boq>
            <div className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
              <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-emerald-500/10 to-transparent p-3 dark:border-slate-700">
                <div className="invoice-lines-toolbar-title"><b>قيمة العقد وجدول الكميات (BOQ)</b><small>كل بند: كود ووصف ووحدة وكمية وسعر — قيمة العقد تُحسب تلقائياً</small></div>
                <div className="invoice-lines-kpis">
                  <div className="invoice-kpi"><small>قيمة العقد (بدون ضريبة)</small><b className="text-emerald-600">{fmt(effectiveContractMinor)} {cur.symbol}</b></div>
                  <div className="invoice-kpi"><small>البنود الصالحة</small><b>{validBoqLines.length}</b></div>
                  <div className="invoice-kpi"><small>محتجز الضمان</small><b>{Number(retention) || 0}٪</b></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 p-3 border-b border-slate-200 dark:border-slate-700">
                {([['boq', 'بنود جدول كميات (مُوصى به)'], ['manual', 'قيمة إجمالية']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setValueMode(m)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${valueMode === m ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {valueMode === 'manual' ? (
                <div className="p-4">
                  <Field label={`قيمة العقد الإجمالية — بدون ضريبة (${cur.symbol}) *`} hint="§95: العقد صافٍ بلا ض.ق.م (تظهر في العرض والمستخلص فقط) — لعقود المقطوعية بلا جدول كميات">
                    <input id="project-contract-value" value={contractValue} onChange={(e) => setContractValue(e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {boqDraft.map((l, i) => (
                    <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                      <Field label="كود البند"><input value={l.code} onChange={(e) => patchBoqLine(i, { code: e.target.value })} className={inputCls} dir="ltr" placeholder={String(i + 1)} /></Field>
                      <div className="col-span-2"><Field label="وصف البند *"><input id={i === 0 ? 'project-first-boq-line' : undefined} value={l.descriptionAr} onChange={(e) => patchBoqLine(i, { descriptionAr: e.target.value })} className={inputCls} placeholder="أعمال حفر وردم…" /></Field></div>
                      <Field label="الوحدة *"><input value={l.unit} onChange={(e) => patchBoqLine(i, { unit: e.target.value })} className={inputCls} placeholder="م2 / م3 / طن" /></Field>
                      <Field label="الكمية *"><input value={l.qty} onChange={(e) => patchBoqLine(i, { qty: e.target.value })} inputMode="decimal" className={inputCls} dir="ltr" /></Field>
                      <Field label={`سعر الوحدة (${cur.symbol}) *`}><input value={l.unitPrice} onChange={(e) => patchBoqLine(i, { unitPrice: e.target.value })} inputMode="decimal" className={inputCls} dir="ltr" /></Field>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 min-w-0">
                          <Field label="تكلفة تقديرية/وحدة" hint="">
                            <input value={l.estCost} onChange={(e) => patchBoqLine(i, { estCost: e.target.value })} inputMode="decimal" className={inputCls} dir="ltr" placeholder="اختياري" />
                          </Field>
                        </div>
                        {boqDraft.length > 1 && (
                          <button onClick={() => setBoqDraft((prev) => prev.filter((_, idx) => idx !== i))} title="حذف البند" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all">✕</button>
                        )}
                      </div>
                      {Number(l.qty) > 0 && Number(l.unitPrice) > 0 && (
                        <div className="col-span-2 sm:col-span-7 text-[11px] font-bold text-emerald-600">
                          إجمالي البند: {fmt(Math.round(Number(l.qty) * toMinor(l.unitPrice, cur.decimals)))} {cur.symbol}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Btn variant="ghost" onClick={() => setBoqDraft((prev) => [...prev, emptyBoqLine()])}>+ بند جديد</Btn>
                    <div className="text-[13px] font-black text-emerald-700 dark:text-emerald-300">
                      💰 قيمة العقد المحسوبة: {fmt(boqTotalMinor)} {cur.symbol} <span className="text-[10.5px] font-bold text-slate-400">({validBoqLines.length} بند)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3">
              <DocOutcome>الأثر: لا قيد عند فتح المشروع · القيود تبدأ من أول دفعة مقدمة أو مستخلص، وكلها منسوبة لمركز تكلفة هذا المشروع · «معاينة» تعرض مستند المشروع بقالب الفواتير قبل إنشائه.</DocOutcome>
            </div>
          </section>
        </InvoicePOSFrame>

        {/* §92: مسودات المشروع + لوحة المراجعة قبل الإنشاء */}
        <InvoiceDraftsModal open={projDraftsOpen} onClose={() => setProjDraftsOpen(false)} kind="project" drafts={advancedInvoiceDrafts} currency={cur} currentDraftId={projDraftId} onPick={applyProjectDraft} onDelete={deleteAdvancedInvoiceDraft} />
        <PrePostChecks issues={projectIssues} open={projChecksOpen} onClose={() => setProjChecksOpen(false)} />
      </div>
    )
  }

  /* ═══ محرر المستخلص — فاتورة المقاولات بنفس هيئة فاتورة البيع (طلب المالك) ═══ */
  if (extractFor) {
    return (
      <div data-extract-doc-editor>
        <InvoicePOSFrame
          kind="sale"
          modeLabel={editingExtract ? 'تعديل مستخلص صادر — قيد عاكس وإعادة بناء' : 'مستخلص أعمال'}
          currencyLabel={`${cur.code} · ${cur.symbol}`}
          dateLabel={editingExtract ? editingExtract.date.slice(0, 10) : todayLocalIso()}
          branchLabel={setup.shopName ?? ''}
          userLabel={setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber={editingExtract ? `${editingExtract.extractNumber} (تعديل)` : `PRX-${extractFor.code}`}
          onBack={() => { setEditingExtract(null); setExtractFor(null); setExFinal(false) }}
          onNavigate={() => { /* لا تنقل أثناء التحرير */ }}
          onPartySearch={() => document.getElementById('extract-desc-field')?.focus()}
          onItemSearch={() => document.getElementById('extract-first-percent')?.focus()}
          onSaveDraft={() => toast.show('المستخلص يُسجل بـ«حفظ وترحيل» — بوابات الاعتماد وحد الائتمان تُفحص عندها')}
          onRestoreDraft={() => toast.show('لا مسودات للمستخلصات — النِّسَب تُحفظ تلقائياً مع كل بند')}
          onPrint={() => {
            const gross = exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)
            if (gross <= 0) return toast.show('أدخل قيمة الأعمال أو نسب التنفيذ قبل المعاينة', 'error')
            previewDraftDoc(buildExtractDraftModel(), `معاينة المستخلص — ${extractFor.nameAr}`)
          }}
          onExportPdf={() => { toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️'); const gross = exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals); if (gross > 0) previewDraftDoc(buildExtractDraftModel(), `مستخلص — ${extractFor.nameAr}`) }}
          onPost={() => (editingExtract ? saveExtractEdit() : saveExtract())}
          headerFields={
            <>
              {editingExtract && (
                <Field label="سبب التعديل (سجل تدقيق)" hint="يُوثَّق على القيد العاكس — لا تعديل بلا سبب">
                  <input data-extract-edit-reason value={exReason} onChange={(e) => setExReason(e.target.value)} className={inputCls} placeholder="تصحيح نسبة إنجاز بند / تعديل الاسترداد…" />
                </Field>
              )}
              <Field label="وصف الأعمال المنفذة">
                <input id="extract-desc-field" value={exDesc} onChange={(e) => setExDesc(e.target.value)} className={inputCls} placeholder="أعمال الأساسات…" />
              </Field>
              <Field label="الضريبة على المستخلص">
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                  <input type="checkbox" checked={exVat} onChange={(e) => setExVat(e.target.checked)} className="accent-orange-600" />
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪ على قيمة الأعمال</span>
                </label>
              </Field>
              <Field label="التحصيل">
                <div className="flex gap-2">
                  {(['credit', 'cash'] as const).map((p) => (
                    <button key={p} onClick={() => setExPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${exPayment === p ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي فوري' : 'آجل (مستحق)'}
                    </button>
                  ))}
                </div>
              </Field>
              {exPayment === 'cash' && (
                <div className="sm:col-span-2">
                  <PaymentMethodPicker value={{ treasury: exTreasury, terminalPayment: exTerminal }} onChange={(value) => { setExTreasury(value.treasury); setExTerminal(value.terminalPayment) }} operation="receipt" />
                </div>
              )}
              {getAdvanceBalance(extractFor.id) > 0 && (
                <Field label={`استرداد من الدفعة المقدمة (رصيدها ${fmt(getAdvanceBalance(extractFor.id))})`} hint="يخصم من مستحق هذا المستخلص ويطفئ التزام 2109">
                  <input value={exRecovery} onChange={(e) => setExRecovery(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0 = لا استرداد" />
                </Field>
              )}
              <Field label="طبيعة المستخلص (جزئي / ختامي)">
                <div className="grid grid-cols-2 gap-1.5" data-extract-nature-toggle>
                  <button
                    type="button"
                    onClick={() => setExFinal(false)}
                    className={`py-2 px-2 rounded-xl text-[11px] font-bold border-2 transition-all ${!exFinal ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                  >
                    مستخلص جاري / جزئي
                  </button>
                  <label className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[11px] font-bold border-2 cursor-pointer transition-all ${exFinal ? 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                    <input type="checkbox" checked={exFinal} onChange={(e) => setExFinal(e.target.checked)} className="w-3.5 h-3.5 shrink-0 accent-rose-600" />
                    <span>ختامي — لا مستخلصات بعده</span>
                  </label>
                </div>
              </Field>
            </>
          }
          partyMeta={
            <div className="invoice-doc-partymeta">
              <span>المشروع: <b>{extractFor.code} — {extractFor.nameAr}</b></span>
              <span>العميل: <b>{extractFor.clientName || 'الجهة المالكة'}</b></span>
              <span>النمط: <b>{exMode === 'lines' ? 'بندي من BOQ' : 'مبلغ إجمالي'}</b></span>
              {editingExtract && <span className="text-amber-600 font-bold">تعديل مستخلص صادر — يعكس قيده ويعيد بناءه بنفس الرقم</span>}
              <span>محتجز: <b>{extractFor.retentionPercent}٪</b></span>
              <span>أعمال هذا المستخلص: <b className="text-emerald-600">{fmt(exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals))} {cur.symbol}</b></span>
            </div>
          }
        >
          <section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark" data-extract-lines>
            <div className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
              <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-orange-500/10 to-transparent p-3 dark:border-slate-700">
                <div className="invoice-lines-toolbar-title"><b>أعمال هذا المستخلص</b><small>نسب تنفيذ تراكمية لكل بند من جدول الكميات — قيمة الشريحة تُحسب تلقائياً</small></div>
                <div className="invoice-lines-kpis">
                  <div className="invoice-kpi"><small>الأعمال</small><b className="text-emerald-600">{fmt(exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals))} {cur.symbol}</b></div>
                  <div className="invoice-kpi"><small>محتجز {extractFor.retentionPercent}٪</small><b className="text-amber-600">{fmt(Math.round(((exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)) * extractFor.retentionPercent) / 100))}</b></div>
                  <div className="invoice-kpi"><small>مستحق متوقع</small><b className="text-orange-600">{fmt((exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)) + Math.round(((exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)) * (exVat ? setup.vatPercent : 0)) / 100) - Math.round(((exMode === 'lines' ? exLinesPreview.grossMinor : toMinor(exGross, cur.decimals)) * extractFor.retentionPercent) / 100) - (exRecovery ? toMinor(exRecovery, cur.decimals) : 0))}</b></div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-slate-200 dark:border-slate-700">
                {extractBoq.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {([['lines', 'بندي من جدول الكميات'], ['gross', 'مبلغ إجمالي (جزئي أو كامل)']] as const).map(([m, label]) => (
                      <button key={m} onClick={() => setExMode(m)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${exMode === m ? 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-[11px] font-bold text-slate-500">نسب سريعة للمستخلص الجزئي:</span>}
                <div className="flex flex-wrap items-center gap-1" data-extract-quick-slices>
                  <span className="text-[11px] text-slate-400 font-bold ml-1">تعبئة دفعة جزئية:</span>
                  {[
                    [10, '+10٪ جزئي'],
                    [25, '+25٪ جزئي'],
                    [50, '+50٪ جزئي'],
                    [100, '100٪ المتبقي (ختامي)'],
                  ].map(([pct, label]) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPartialSlicePercent(Number(pct))}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300 hover:bg-orange-500/15 transition-all"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {exMode === 'lines' && extractBoq.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr>
                        <th className="p-2 text-right font-bold">البند</th>
                        <th className="p-2 text-center font-bold">مفوتر سابقاً ٪</th>
                        <th className="p-2 text-center font-bold">كمية هذا المستخلص</th>
                        <th className="p-2 text-center font-bold">جديد ٪ (تراكمي)</th>
                        <th className="p-2 text-left font-bold">قيمة الشريحة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exLinesPreview.rows.map(({ boq: b, prevPercent, newPercent, sliceMinor }, idx) => {
                        const slicePct = newPercent !== null && newPercent > prevPercent ? newPercent - prevPercent : 0
                        const sliceQty = slicePct > 0 ? Number(((b.qty * slicePct) / 100).toFixed(3)) : ''
                        return (
                          <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="p-2 font-bold text-slate-700 dark:text-slate-200">
                              {b.code} — {b.descriptionAr}
                              <span className="block text-[10px] font-normal text-slate-400">إجمالي البند: {b.qty} {b.unit} × {fmt(b.unitPriceMinor)}</span>
                            </td>
                            <td className="p-2 text-center text-slate-500">{prevPercent}٪</td>
                            <td className="p-2">
                              <input
                                value={sliceQty}
                                inputMode="decimal"
                                placeholder={`من ${Math.max(0, Number(((b.qty * (100 - prevPercent)) / 100).toFixed(2)))} ${b.unit}`}
                                onChange={(e) => {
                                  const q = Number(e.target.value)
                                  if (!e.target.value.trim() || !Number.isFinite(q) || q <= 0 || b.qty <= 0) {
                                    setExLines((s) => ({ ...s, [b.id]: '' }))
                                    return
                                  }
                                  const pct = Math.min(100, Math.round((prevPercent + (q / b.qty) * 100) * 100) / 100)
                                  setExLines((s) => ({ ...s, [b.id]: String(pct) }))
                                }}
                                className="w-24 mx-auto block text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent py-1 text-[11px] font-bold"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                id={idx === 0 ? 'extract-first-percent' : undefined}
                                value={exLines[b.id] ?? ''} inputMode="decimal" placeholder={`${prevPercent}`}
                                onChange={(e) => setExLines((s) => ({ ...s, [b.id]: e.target.value }))}
                                className="w-20 mx-auto block text-center rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent py-1 text-[12px] font-bold"
                              />
                              {newPercent !== null && (newPercent < prevPercent || newPercent > 100) && (
                                <div className="text-[10px] text-red-500 text-center font-bold mt-0.5">{newPercent > 100 ? 'أقصاها 100' : 'لا تقل عن السابق'}</div>
                              )}
                            </td>
                            <td className="p-2 text-left font-bold tabular-nums text-emerald-600">{sliceMinor > 0 ? fmt(sliceMinor) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-orange-500/10">
                      <tr>
                        <td colSpan={4} className="p-2 font-bold text-orange-700 dark:text-orange-300">إجمالي أعمال هذا المستخلص</td>
                        <td className="p-2 text-left font-black tabular-nums text-orange-700 dark:text-orange-300">{fmt(exLinesPreview.grossMinor)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-4">
                  <Field label={`قيمة الأعمال المنفذة في هذا المستخلص (${cur.symbol}) *`} hint={`قيمة العقد: ${fmt(extractFor.contractValueMinor)} · مفوتر سابقاً: ${fmt(getProjectProfit(extractFor.id).extractedMinor)}`}><input value={exGross} onChange={(e) => setExGross(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                </div>
              )}
            </div>
            <div className="p-3 space-y-2">
              <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3 text-[12px] font-bold text-orange-700 dark:text-orange-300">
                يُخصم محتجز {extractFor.retentionPercent}٪ تلقائياً ويقيد على 1105 حتى التسليم النهائي · «معاينة» تعرض المستخلص بقالب الفواتير قبل تسجيله — هذه هي فاتورة الجهة المالكة.
              </div>
              <DocOutcome>الأثر: <b>1104 العميل</b> مديناً بصافي المستخلص · <b>4107 إيراد المقاولات</b> دائناً · <b>1105 محتجز لدى العملاء</b> بالنسبة المحتجزة · والضريبة على <b>2102</b>.</DocOutcome>
            </div>
          </section>
        </InvoicePOSFrame>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><HardHat className="w-6 h-6 text-orange-500" /> مشروعات المقاولات</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" onClick={() => navigate('/contracting/extracts')} data-nav-project-extracts>
            <Receipt className="w-4 h-4 text-emerald-600" /> قسم المستخلصات (فواتير الأعمال)
          </Btn>
          <Btn variant="ghost" onClick={() => navigate('/contracting/expenses')} data-nav-project-expenses>
            <Hammer className="w-4 h-4 text-rose-600" /> قسم مصروفات المشروعات
          </Btn>
          <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> مشروع جديد</Btn>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon="🏗️" title="لا مشروعات بعد" sub="أنشئ مشروعك الأول: عقد بقيمة ونسبة محتجز، ثم سجّل المستخلصات والمصروفات من أقسامها المستقلة — الربحية تُحسب تلقائياً" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
              <tr>{['الكود', 'المشروع', 'العميل', 'قيمة العقد', 'الإنجاز', 'الربح حتى الآن', 'الحالة', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pr = getProjectProfit(p.id)
                return (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-orange-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-black">{p.code}</td>
                    <td className="px-3 py-2.5 font-bold">{p.nameAr}</td>
                    <td className="px-3 py-2.5">{p.clientName || '—'}</td>
                    <td className="px-3 py-2.5">{fmt(p.contractValueMinor)} {cur.symbol}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div className="h-full bg-orange-500 transition-all" style={{ width: `${pr.progressPercent}%` }} />
                        </div>
                        <span className="text-[11px] font-bold">{pr.progressPercent}٪</span>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 font-black ${pr.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(pr.profitMinor)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${p.status === 'active' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                        {p.status === 'active' ? 'جارٍ' : 'مُسلَّم'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {p.status === 'active' && (
                          <>
                            <button onClick={() => setAdvanceFor(p)} title="دفعة مقدمة من العميل" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all hover:scale-110"><Wallet2 className="w-4 h-4" /></button>
                            <button onClick={() => setCoFor(p)} title="أمر تغيير على العقد" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all hover:scale-110"><FilePlus2 className="w-4 h-4" /></button>
                            {pr.retentionHeldMinor > 0 && (
                              <button onClick={() => setReleaseFor(p)} title={`الإفراج عن المحتجز (${fmt(pr.retentionHeldMinor)}) وإقفال المشروع`} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><Banknote className="w-4 h-4" /></button>
                            )}
                          </>
                        )}
                        <button
                          onClick={() => setCommFor(p)}
                          title={staffCommissions.some((c) => c.source === 'project' && c.sourceId === p.id && c.status !== 'cancelled') ? 'عليه عمولة موظف — إدارتها من شاشة الموظفين' : 'عمولة موظف عن المشروع'}
                          className={`p-2 rounded-lg transition-all hover:scale-110 ${staffCommissions.some((c) => c.source === 'project' && c.sourceId === p.id && c.status !== 'cancelled') ? 'text-violet-500 bg-violet-500/10' : 'text-slate-400 hover:text-violet-600 hover:bg-violet-500/10'}`}
                        ><HandCoins className="w-4 h-4" /></button>
                        <button onClick={() => openProjectEdit(p)} data-project-edit title="تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all hover:scale-110"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setViewing(p)} title="التفاصيل والقيود" className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all hover:scale-110"><Eye className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* التفاصيل */}
      <Modal open={!!viewingLive} onClose={() => setViewing(null)} title={viewingLive ? `${viewingLive.code} — ${viewingLive.nameAr}` : ''} wide>
        {viewingLive && profit && (
          <div className="space-y-4 text-sm">
            <div className="flex justify-end">
              <Btn variant="ghost" data-project-new-invoice onClick={() => {
                /* بلاغ المالك (2026-10-17): «لماذا لم تظهر بنود المشروع في الفاتورة تلقائياً؟»
                   ⇒ الفاتورة تُفتح وبنود جدول الكميات معبأة فيها (أصناف خدمة مضمونة)،
                   لا مشروعاً وعميلاً فقط. */
                const boq = boqItems.filter((b) => b.projectId === viewingLive.id)
                openSalesInvoiceWindow(undefined, {
                  projectId: viewingLive.id,
                  customerId: viewingLive.clientId ?? undefined,
                  lines: boq.map((b) => ({
                    itemId: ensureServiceItemForFreeLine({ nameAr: b.descriptionAr, unitAr: b.unit, priceMinor: b.unitPriceMinor }),
                    qty: b.qty,
                    unitPriceMinor: b.unitPriceMinor,
                  })),
                  notes: boq.length ? `فاتورة مشروع ${viewingLive.code} — معبأة من جدول الكميات (${boq.length} بنداً)` : undefined,
                })
              }} title="فاتورة بيع كاملة بنافذة الفاتورة المتقدمة — مربوطة بهذا المشروع ومعبأة ببنود جدول الكميات وعميله"><ShoppingCart size={14} /> فاتورة بيع لهذا المشروع</Btn>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-[11px] text-slate-500">المستخلصات</div><div className="font-black text-emerald-600">{fmt(profit.extractedMinor)}</div></div>
              <div className="rounded-xl bg-rose-500/10 p-3"><div className="text-[11px] text-slate-500">التكاليف</div><div className="font-black text-rose-600">{fmt(profit.costsMinor)}</div></div>
              <div className="rounded-xl bg-orange-500/10 p-3"><div className="text-[11px] text-slate-500">الربح ({profit.marginPercent}٪)</div><div className={`font-black ${profit.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(profit.profitMinor)}</div></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">محتجز قائم</div><div className="font-black text-amber-600">{fmt(profit.retentionHeldMinor)}</div></div>
            </div>

            <div>
              <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> توزيع التكاليف</div>
              <div className="grid grid-cols-5 gap-1.5 text-center">
                {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                  <div key={k} className="rounded-xl bg-slate-500/5 p-2">
                    <div className="text-[10px] text-slate-500">{COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</div>
                    <div className="font-bold text-[12px]">{fmt(profit.costsByKind[k])}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* بلاغ المالك (2026-10-17): «لماذا لا يمكن معاينة بنود المشروع بعد إنشائه وبكل حرية؟»
                ⇒ جدول الكميات كاملاً في نافذة العرض: كود ووصف ووحدة وكمية وسعر وإجمالي وتقدم. */}
            {(() => {
              const boq = boqItems.filter((b) => b.projectId === viewingLive.id)
              return (
                <div data-project-boq-preview>
                  <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1"><BookOpenText className="w-4 h-4" /> بنود المشروع — جدول الكميات (BOQ)</span>
                    <b className="text-slate-700 dark:text-slate-200">{boq.length} بنداً · {fmt(boq.reduce((a, b) => a + boqItemTotal(b), 0))} {cur.symbol}</b>
                  </div>
                  {boq.length === 0 ? (
                    <div className="rounded-xl bg-slate-500/5 p-3 text-[11.5px] text-slate-500">لا بنود كميات لهذا المشروع — تُضاف من تعديل المشروع (تبويب جدول الكميات).</div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                      <table className="w-full text-[12px]">
                        <thead className="bg-slate-500/10 text-slate-600 dark:text-slate-300">
                          <tr>{['كود البند', 'الوصف', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'التكلفة التقديرية', 'الإنجاز'].map((h) => <th key={h} className="px-3 py-1.5 text-right font-bold">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {boq.map((b) => (
                            <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-1.5 font-mono font-bold">{b.code}</td>
                              <td className="px-3 py-1.5">{b.descriptionAr}</td>
                              <td className="px-3 py-1.5">{b.unit}</td>
                              <td className="px-3 py-1.5">{b.qty}</td>
                              <td className="px-3 py-1.5">{fmt(b.unitPriceMinor)}</td>
                              <td className="px-3 py-1.5 font-bold">{fmt(boqItemTotal(b))}</td>
                              <td className="px-3 py-1.5 text-rose-600">{fmt(Math.round(b.qty * b.estCostMinor))}</td>
                              <td className="px-3 py-1.5">{b.progressPercent}٪</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}

            {viewExtracts.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[12px]">
                  <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
                    <tr>{['المستخلص', 'التاريخ', 'الأعمال', 'المحتجز', 'المستحق', ''].map((h, i) => <th key={i} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {viewExtracts.map((e) => (
                      <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 font-bold">{e.extractNumber}</td>
                        <td className="px-3 py-2">{e.date.slice(0, 10)}</td>
                        <td className="px-3 py-2">{fmt(e.totals.grossMinor)}</td>
                        <td className="px-3 py-2 text-amber-600">{fmt(e.totals.retentionMinor)}</td>
                        <td className="px-3 py-2 font-bold">{fmt(e.totals.dueMinor)}</td>
                        <td className="px-3 py-2 flex items-center gap-1">
                          <button onClick={() => setViewExtract(e)} data-extract-review title="مراجعة المستخلص — كل البيانات والقيد والطباعة والتعديل" className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Eye size={13} /></button>
                          <button onClick={() => openExtractEditor(e)} data-extract-edit title="تعديل المستخلص — قيد عاكس وإعادة بناء بنفس الرقم" className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all"><Pencil size={13} /></button>
                          <button onClick={() => printExtractClientInvoice(e)} data-extract-client-invoice-print title="طباعة فاتورة احترافية للعميل (فاتورة مستخلص)" className="px-2 py-1 rounded-lg text-[11px] font-bold bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20 transition-all flex items-center gap-1"><FileText size={12} /> فاتورة للعميل</button>
                          <button onClick={() => printExtract(e)} title="طباعة المستخلص للجهة المالكة" className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all"><Printer size={13} /></button>
                          <button onClick={() => setRefundingExtract(e)} title="إشعار دائن (رفض جزء من الأعمال بعد الاعتماد)" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all text-[12px] font-black">↩️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* §94: المشروع مربوط بأطرافه — فواتير عملائه ومشتريات مورديه وعمولات موظفيه في مكان واحد */}
            {(() => {
              const prjSales = sales.filter((x) => x.projectId === viewingLive.id)
              const prjPurchases = purchases.filter((x) => x.projectId === viewingLive.id)
              const prjComms = staffCommissions.filter((c) => c.source === 'project' && c.sourceId === viewingLive.id)
              if (!prjSales.length && !prjPurchases.length && !prjComms.length) return null
              return (
                <div className="space-y-3" data-project-parties>
                  {prjSales.length > 0 && (
                    <div>
                      <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1"><ShoppingCart className="w-4 h-4" /> فواتير بيع المشروع (العملاء)</span>
                        <b className="text-emerald-600">{fmt(prjSales.reduce((a, x) => a + x.totals.totalMinor, 0))} {cur.symbol}</b>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-emerald-500/20">
                        <table className="w-full text-[12px]">
                          <thead className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><tr>{['الفاتورة', 'التاريخ', 'العميل', 'الإجمالي', 'المحصل'].map((h) => <th key={h} className="px-3 py-1.5 text-right font-bold">{h}</th>)}</tr></thead>
                          <tbody>
                            {prjSales.map((x) => (
                              <tr key={x.id} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-1.5 font-bold">{x.invoiceNumber}</td>
                                <td className="px-3 py-1.5">{x.date.slice(0, 10)}</td>
                                <td className="px-3 py-1.5">{customers.find((c) => c.id === x.customerId)?.nameAr ?? x.partyName ?? 'نقدي'}</td>
                                <td className="px-3 py-1.5 font-bold">{fmt(x.totals.totalMinor)}</td>
                                <td className="px-3 py-1.5">{fmt(x.paidMinor ?? 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {prjPurchases.length > 0 && (
                    <div>
                      <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1"><Truck className="w-4 h-4" /> مشتريات المشروع (الموردون)</span>
                        <b className="text-rose-600">{fmt(prjPurchases.reduce((a, x) => a + x.grandTotalMinor, 0))} {cur.symbol}</b>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-rose-500/20">
                        <table className="w-full text-[12px]">
                          <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300"><tr>{['الفاتورة', 'التاريخ', 'المورد', 'الإجمالي'].map((h) => <th key={h} className="px-3 py-1.5 text-right font-bold">{h}</th>)}</tr></thead>
                          <tbody>
                            {prjPurchases.map((x) => (
                              <tr key={x.id} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-1.5 font-bold">{x.invoiceNumber}</td>
                                <td className="px-3 py-1.5">{x.date.slice(0, 10)}</td>
                                <td className="px-3 py-1.5">{suppliers.find((c) => c.id === x.supplierId)?.nameAr ?? '—'}</td>
                                <td className="px-3 py-1.5 font-bold">{fmt(x.grandTotalMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {prjComms.length > 0 && (
                    <div>
                      <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center gap-1"><Users2 className="w-4 h-4" /> عمولات موظفي المشروع</div>
                      <div className="overflow-x-auto rounded-xl border border-sky-500/20">
                        <table className="w-full text-[12px]">
                          <thead className="bg-sky-500/10 text-sky-700 dark:text-sky-300"><tr>{['الكود', 'الموظف', 'القيمة', 'الحالة'].map((h) => <th key={h} className="px-3 py-1.5 text-right font-bold">{h}</th>)}</tr></thead>
                          <tbody>
                            {prjComms.map((c) => (
                              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-1.5 font-bold">{c.code}</td>
                                <td className="px-3 py-1.5">{employees.find((e) => e.id === c.employeeId)?.nameAr ?? '—'}</td>
                                <td className="px-3 py-1.5 font-bold">{fmt(c.amountMinor)}</td>
                                <td className="px-3 py-1.5">{c.status === 'accrued' ? 'مستحقة' : c.status === 'paid' ? 'مصروفة ✅' : 'ملغاة'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {viewEntries.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-rose-500/10 px-3 py-2 flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-[12px]">
                  <BookOpenText className="w-4 h-4" /> قيد #{e.entryNumber} — {e.description}
                </div>
                <table className="w-full text-[12px]"><tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                      <td className="px-3 py-1.5 text-emerald-600 font-bold">{l.debit ? fmt(l.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-rose-600 font-bold">{l.credit ? fmt(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* §94-مراجعة: تعديل بيانات المشروع — القيمة مقفولة بعد أول مستخلص (أوامر التغيير هي الباب) */}
      <Modal open={!!editPrj} onClose={() => setEditPrj(null)} title={editPrj ? `تعديل ${editPrj.code} — ${editPrj.nameAr}` : ''} subtitle="بيانات العقد والمواعيد — الكود والحالة لا يتغيران">
        {editPrj && (() => {
          const locked = projectExtracts.some((e) => e.projectId === editPrj.id)
          return (
            <div className="grid grid-cols-2 gap-3" data-project-edit-modal>
              <Field label="اسم المشروع *"><input className={inputCls} value={epName} onChange={(e) => setEpName(e.target.value)} aria-label="اسم المشروع" /></Field>
              <Field label="الجهة المالكة (العميل) *"><input className={inputCls} value={epClient} onChange={(e) => setEpClient(e.target.value)} aria-label="الجهة المالكة" /></Field>
              <Field label="ربط سجل العميل" hint="إداري بحت — لا قيد ولا ذمة"><input className={inputCls} type="number" value={epClientId} onChange={(e) => setEpClientId(e.target.value)} placeholder="رقم العميل (اختياري)" aria-label="ربط العميل" /></Field>
              <Field label={`قيمة العقد — بدون ضريبة (${cur.code})`} hint={locked ? '🔒 صدرت مستخلصات — تعديل القيمة بأمر تغيير فقط' : 'صافية بلا ض.ق.م · قبل أول مستخلص فقط'}>
                <input className={inputCls} type="number" disabled={locked} value={locked ? String(editPrj.contractValueMinor / 10 ** cur.decimals) : epValue} onChange={(e) => setEpValue(e.target.value)} aria-label="قيمة العقد" />
              </Field>
              <Field label="محتجز ضمان الأعمال ٪" hint="يؤثر على المستخلصات القادمة فقط"><input className={inputCls} type="number" value={epRetention} onChange={(e) => setEpRetention(e.target.value)} aria-label="نسبة المحتجز" /></Field>
              <Field label="رقم العقد الرسمي"><input className={inputCls} value={epContractNo} onChange={(e) => setEpContractNo(e.target.value)} aria-label="رقم العقد" /></Field>
              <Field label="تاريخ التسليم لل site"><input className={inputCls} type="date" value={epStart} onChange={(e) => setEpStart(e.target.value)} aria-label="تاريخ التسليم" /></Field>
              <Field label="موعد التسليم المتوقع"><input className={inputCls} type="date" value={epEnd} onChange={(e) => setEpEnd(e.target.value)} aria-label="موعد التسليم" /></Field>
              <Field label="موقع الأعمال"><input className={inputCls} value={epLocation} onChange={(e) => setEpLocation(e.target.value)} aria-label="موقع الأعمال" /></Field>
              <Field label="تاريخ التسليم الفعلي" hint="بعده تبدأ فترة الضمان — لتذكير استحقاق الإفراج عن المحتجز"><input className={inputCls} type="date" value={epHandover} onChange={(e) => setEpHandover(e.target.value)} aria-label="تاريخ التسليم الفعلي" /></Field>
              <Field label="فترة الضمان/الصيانة (أشهر)" hint="تُحسب من تاريخ التسليم الفعلي"><input className={inputCls} type="number" min={0} value={epDlpMonths} onChange={(e) => setEpDlpMonths(e.target.value)} aria-label="فترة الضمان بالشهور" /></Field>
              <Field label="ملاحظات"><input className={inputCls} value={epNotes} onChange={(e) => setEpNotes(e.target.value)} aria-label="ملاحظات" /></Field>
              <div className="col-span-2 flex gap-2 justify-end pt-1">
                <Btn variant="ghost" onClick={() => setEditPrj(null)}>إلغاء</Btn>
                <Btn onClick={saveProjectEdit} data-project-edit-save><Pencil size={14} /> حفظ التعديلات</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* الإفراج عن المحتجزات — باختيار الخزينة (طلب المالك) */}
      {/* دفعة مقدمة من العميل */}
      <Modal open={!!advanceFor} onClose={() => setAdvanceFor(null)} title={advanceFor ? `دفعة مقدمة — ${advanceFor.nameAr}` : ''} subtitle="مستند دفعة مقدمة: تحصيل قبل تنفيذ الأعمال">
        {advanceFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-sky-500/5 rounded-xl p-3">
              الدفعة المقدمة التزام (2109) لا إيراد — لأن الأعمال لم تُنفَّذ بعد. تُسترد تدريجياً من المستخلصات القادمة.
              {getAdvanceBalance(advanceFor.id) > 0 && <> الرصيد الحالي: <b>{fmt(getAdvanceBalance(advanceFor.id))}</b></>}
            </div>
            <Field label={`قيمة الدفعة (${cur.symbol})`}><input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="طريقة التحصيل"><div className="space-y-2"><PaymentMethodPicker value={{treasury:advTreasury,terminalPayment:advTerminal}} onChange={value=>{setAdvTreasury(value.treasury);setAdvTerminal(value.terminalPayment)}} operation="receipt"/></div></Field>
            <DocOutcome>الأثر: <b>الخزينة</b> أو حساب تسوية الماكينة مديناً بالمحصَّل · <b>2109 دفعات مقدمة من العملاء</b> دائناً بنفس القيمة — التزام لا إيراد، يُسترد تدريجياً من المستخلصات القادمة.</DocOutcome>
            <Btn onClick={saveAdvance} shortcut="F9" className="w-full" disabled={!advAmount}>استلام الدفعة</Btn>
          </div>
        )}
      </Modal>

      {/* أمر تغيير */}
      <Modal open={!!coFor} onClose={() => setCoFor(null)} title={coFor ? `أمر تغيير — ${coFor.nameAr}` : ''} subtitle="مستند أمر تغيير: تعديل نطاق العقد وقيمته">
        {coFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-violet-500/5 rounded-xl p-3">
              أمر التغيير يعدل قيمة العقد الفعلية بعد اعتماده (زيادة أعمال أو تخفيض نطاق) — بلا قيد محاسبي؛ أثره في تقرير WIP والربحية المتوقعة.
            </div>
            <Field label="عنوان أمر التغيير"><input value={coTitle} onChange={(e) => setCoTitle(e.target.value)} placeholder="أعمال إضافية للواجهة…" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`القيمة (${cur.symbol})`}><input value={coAmount} onChange={(e) => setCoAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="الاتجاه">
                <div className="flex gap-2">
                  <button onClick={() => setCoDeduct(false)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${!coDeduct ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>زيادة</button>
                  <button onClick={() => setCoDeduct(true)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${coDeduct ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>تخفيض</button>
                </div>
              </Field>
            </div>
            {changeOrders.filter((o) => o.projectId === coFor.id).length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-400">أوامر التغيير السابقة</div>
                {changeOrders.filter((o) => o.projectId === coFor.id).map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-[12px] bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                    <span><b>{o.number}</b> — {o.titleAr} ({o.amountMinor >= 0 ? '+' : '−'}{fmt(Math.abs(o.amountMinor))})</span>
                    {o.status === 'draft' ? (
                      <span className="flex gap-1">
                        <button onClick={() => { try { setChangeOrderStatus(o.id, 'approved'); toast.show('اعتُمد ✅') } catch (e) { toast.show((e as Error).message, 'error') } }} className="text-emerald-600 font-bold hover:underline">اعتماد</button>
                        <button onClick={() => { setChangeOrderStatus(o.id, 'rejected'); toast.show('رُفض') }} className="text-rose-500 font-bold hover:underline mr-2">رفض</button>
                      </span>
                    ) : o.status === 'approved' ? (
                      <span className="flex gap-2 items-center">
                        <span className="font-bold text-emerald-600">✅ معتمد</span>
                        <button onClick={() => { try { setChangeOrderStatus(o.id, 'invoiced'); toast.show('عُلّم مُستخلَصاً 🧾') } catch (e) { toast.show((e as Error).message, 'error') } }} title="عُدّ ضمن مستخلص صادر" className="text-sky-600 font-bold hover:underline">تعليم كمُستخلَص</button>
                      </span>
                    ) : (
                      <span className={`font-bold ${o.status === 'invoiced' ? 'text-sky-600' : 'text-rose-500'}`}>{CHANGE_ORDER_STATUS_LABELS[o.status].icon} {CHANGE_ORDER_STATUS_LABELS[o.status].nameAr}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <DocOutcome>الأثر: <b>لا قيد</b> عند إنشاء أمر التغيير أو اعتماده — يعدّل قيمة العقد ونسب الإنجاز فقط؛ القيد يتولد في المستخلص التالي (<b>4107</b> إيراداً و<b>1104</b> ذمةً و<b>1105</b> محتجزاً).</DocOutcome>
            <Btn onClick={saveChangeOrder} className="w-full" disabled={!coTitle.trim() || !coAmount}>إنشاء أمر التغيير (مسودة)</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!releaseFor} onClose={() => setReleaseFor(null)} title={releaseFor ? `الإفراج عن محتجزات ${releaseFor.nameAr}` : ''} subtitle="مستند إفراج: تحصيل ضمان انتهى أجله">
        {releaseFor && (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 text-[13px] font-bold text-amber-700 dark:text-amber-300">
              سيُحصَّل المحتجز المتبقي {fmt(getProjectProfit(releaseFor.id).retentionHeldMinor)} {cur.symbol} ويُقفل المشروع نهائياً.
            </div>
            <Field label="طريقة التحصيل"><div className="space-y-2"><PaymentMethodPicker value={{treasury:releaseTreasury,terminalPayment:releaseTerminal}} onChange={value=>{setReleaseTreasury(value.treasury);setReleaseTerminal(value.terminalPayment)}} operation="receipt"/></div></Field>
            <DocOutcome>الأثر: <b>الخزينة</b> أو حساب تسوية الماكينة مديناً بقيمة المحتجز المُفرج عنه · <b>1105 محتجزات ضمان أعمال</b> دائناً بإقفال الأصل — تحصيل حق قائم لا إيراد جديد.</DocOutcome>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setReleaseFor(null)}>إلغاء</Btn>
              <Btn onClick={doRelease} shortcut="F9">تحصيل وإقفال</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* §94: مراجعة المستخلص الصادر — وثيقة كاملة: البيانات والبنود والإجماليات والقيد + تعديل وطباعة */}
      <Modal open={!!viewExtract} onClose={() => setViewExtract(null)} title={viewExtract ? `المستخلص ${viewExtract.extractNumber} — مراجعة كاملة` : ''} subtitle="كل بيانات المستخلص بعد الإصدار — ومن هنا التعديل والطباعة وإشعار الدائن" wide>
        {viewExtract && (() => {
          const prj = projects.find((p) => p.id === viewExtract.projectId)
          if (!prj) return null
          const previous = projectExtracts.filter((e) => e.projectId === prj.id && e.id < viewExtract.id).reduce((a, e) => a + e.totals.grossMinor, 0)
          const cumulative = previous + viewExtract.totals.grossMinor
          const entry = journal.find((e) => e.id === viewExtract.journalEntryId)
          const reversalEntry = viewExtract.editReversalEntryId ? journal.find((e) => e.id === viewExtract.editReversalEntryId) : null
          const progress = prj.contractValueMinor > 0 ? Math.min(100, Math.round((cumulative / prj.contractValueMinor) * 100)) : null
          return (
            <div className="space-y-4 text-sm" data-extract-view>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">قيمة الأعمال</div><div className="font-black text-emerald-600" data-extract-view-gross>{fmt(viewExtract.totals.grossMinor)}</div></div>
                <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">محتجز {prj.retentionPercent}٪</div><div className="font-black text-amber-600" data-extract-view-retention>{fmt(viewExtract.totals.retentionMinor)}</div></div>
                <div className="rounded-xl bg-sky-500/10 p-3"><div className="text-[11px] text-slate-500">ض.ق.م</div><div className="font-black text-sky-600">{fmt(viewExtract.totals.vatMinor)}</div></div>
                <div className="rounded-xl bg-orange-500/10 p-3"><div className="text-[11px] text-slate-500">الصافي المستحق</div><div className="font-black text-orange-600" data-extract-view-due>{fmt(viewExtract.totals.dueMinor)}</div></div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-[12.5px]">
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">المشروع</span><b>{prj.code} — {prj.nameAr}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">الجهة المالكة / العميل</span><b>{prj.clientName || '—'}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">التاريخ · السداد</span><b>{viewExtract.date.slice(0, 10)} · {viewExtract.payment === 'cash' ? 'نقدي محصل' : 'آجل على العميل'}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">قيمة العقد · التراكمي</span><b>{fmt(prj.contractValueMinor)} ← {fmt(cumulative)} {progress !== null ? `(${progress}٪)` : ''}</b></div>
                {viewExtract.advanceRecoveryMinor ? <div className="flex justify-between px-3 py-2"><span className="text-slate-500">استرداد دفعة مقدمة</span><b className="text-amber-600">{fmt(viewExtract.advanceRecoveryMinor)}</b></div> : null}
                {viewExtract.description ? <div className="px-3 py-2"><span className="text-slate-500">بيان الأعمال: </span><b>{viewExtract.description}</b></div> : null}
                <div className="flex flex-wrap gap-1.5 px-3 py-2">
                  {viewExtract.isFinal && <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">ختامي</span>}
                  {viewExtract.editedAt && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold" title={viewExtract.lastEditReason}>عُدّل: {viewExtract.editedAt.slice(0, 10)}</span>}
                  {(viewExtract.refundedMinor ?? 0) > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold">إشعار دائن {fmt(viewExtract.refundedMinor ?? 0)}</span>}
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold">{viewExtract.lines?.length ? `${viewExtract.lines.length} بنود BOQ` : 'مبلغ إجمالي'}</span>
                </div>
              </div>

              {viewExtract.lines && viewExtract.lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700" data-extract-view-lines>
                  <table className="w-full text-[12px]">
                    <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300"><tr>{['الكود', 'البند', 'سابق ٪', 'حالي ٪', 'قيمة الشريحة'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr></thead>
                    <tbody>
                      {viewExtract.lines.map((l) => (
                        <tr key={l.boqItemId} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-mono">{l.code}</td>
                          <td className="px-3 py-2">{l.descriptionAr}</td>
                          <td className="px-3 py-2 text-center font-bold">{l.prevProgressPercent}٪</td>
                          <td className="px-3 py-2 text-center font-bold text-orange-600">{l.newProgressPercent}٪</td>
                          <td className="px-3 py-2 font-bold">{fmt(l.lineValueMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewExtract.refunds?.length ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px]">
                  <b className="text-amber-700 dark:text-amber-300">إشعارات دائنة على المستخلص:</b>
                  {viewExtract.refunds.map((r, i) => <div key={i} className="flex justify-between px-1 py-1"><span>{r.date.slice(0, 10)} — {r.reason}</span><b>{fmt(r.amountMinor)} {r.mode === 'cash' ? 'نقدي' : 'على العميل'}</b></div>)}
                </div>
              ) : null}

              {entry && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-sky-500/10 px-3 py-2 flex items-center gap-2 text-sky-700 dark:text-sky-300 font-bold text-[12px]"><BookOpenText className="w-4 h-4" /> القيد #{entry.entryNumber} — {entry.description}</div>
                  <table className="w-full text-[12px]"><tbody>
                    {entry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                        <td className="px-3 py-1.5 font-mono text-emerald-600">{l.debit ? fmt(l.debit) : ''}</td>
                        <td className="px-3 py-1.5 font-mono text-rose-600">{l.credit ? fmt(l.credit) : ''}</td>
                        <td className="px-3 py-1.5 text-slate-500">{l.note}</td>
                      </tr>
                    ))}
                  </tbody></table>
                  {reversalEntry && <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800">قيد عاكس للتعديل #{reversalEntry.entryNumber} — {reversalEntry.description}</div>}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pb-1">
                <Btn variant="ghost" onClick={() => printExtractClientInvoice(viewExtract)} data-extract-client-invoice-print><FileText size={14} /> طباعة فاتورة للعميل</Btn>
                <Btn variant="ghost" onClick={() => printExtract(viewExtract)}><Printer size={14} /> طباعة المستخلص</Btn>
                <Btn variant="ghost" onClick={() => setRefundingExtract(viewExtract)}>إشعار دائن</Btn>
                <Btn onClick={() => openExtractEditor(viewExtract)} data-extract-view-edit><Pencil size={14} /> تعديل المستخلص</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* إشعار دائن على مستخلص (مراجعة المرتجعات) */}
      <Modal open={!!refundingExtract} onClose={() => setRefundingExtract(null)} title={refundingExtract ? `إشعار دائن — ${refundingExtract.extractNumber}` : ''} subtitle="مستند إشعار دائن: عكس جزء معتمد من المستخلص">
        {refundingExtract && (
          <ServiceRefundBox
            grandMinor={refundingExtract.totals.dueMinor}
            refundedMinor={refundingExtract.refundedMinor ?? 0}
            currencySymbol={cur.symbol}
            fmt={fmt}
            terminalOriginal={(() => { const x = paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'project_extract' && row.documentId === String(refundingExtract.id)); return x ? { transactionId: x.id, terminalName: paymentTerminals.find((t) => t.id === x.terminalId)?.nameAr ?? x.terminalId } : undefined })()}
            allowCredit={true}
            hint="رفض المالك/الاستشاري جزءاً من الأعمال بعد اعتماد المستخلص: يعكس الإيراد وحصة الضريبة — «على الحساب» يخفض ذمة الجهة المالكة."
            onSubmit={(a) => {
              try {
                const original = a.terminalRefund ? paymentTerminalTransactions.find((row) => row.id === a.terminalRefund!.originalTransactionId) : undefined
                const treasury = original ? paymentTerminals.find((row) => row.id === original.terminalId)?.settlementAccountCode ?? a.treasury : a.treasury
                const u = refundProjectExtract({ extractId: refundingExtract.id, ...a, treasury })
                setRefundingExtract(null)
                toast.show(`سُجل إشعار دائن على ${u.extractNumber} وتولد القيد العاكس ✅`)
              } catch (err) { toast.show((err as Error).message, 'error') }
            }}
          />
        )}
        {refundingExtract && (
          <DocOutcome>الأثر: <b>4102 مرتجعات المبيعات</b> مديناً بصافي المرفوض و<b>2102</b> مديناً بحصته الضريبية · <b>الخزينة</b> دائنة عند الرد نقداً أو <b>1104 ذمم العملاء</b> دائنة عند التخفيض من حساب العميل.</DocOutcome>
        )}
      </Modal>
      {/* عمولة موظف عن المشروع (تعميم أمر المالك) */}
      <Modal open={!!commFor} onClose={() => setCommFor(null)} title={commFor ? `عمولة موظف — ${commFor.code}` : ''} subtitle="مستند استحقاق عمولة: ربط موظف بمشروع">
        {commFor && (
          <div className="space-y-3">
            {staffCommissions.filter((c) => c.source === 'project' && c.sourceId === commFor.id && c.status !== 'cancelled').map((c) => (
              <div key={c.id} className="rounded-xl bg-violet-500/10 border border-violet-500/25 p-3 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                {c.code} — {employees.find((e) => e.id === c.employeeId)?.nameAr}: {fmt(c.amountMinor)} ({c.status === 'paid' ? 'مصروفة ✓' : 'مستحقة ⏳'})
              </div>
            ))}
            <Field label="الموظف *">
              <PartyQuickPicker parties={employees.filter((employee) => employee.active)} value={commEmpId ? Number(commEmpId) : 0} onChange={(id) => setCommEmpId(id ? String(id) : '')} cashLabel="اختر الموظف" label="بحث الموظف" cashValue={0} />
            </Field>
            <Field label={`مبلغ العمولة (${cur.symbol}) *`}>
              <input value={commAmount} onChange={(e) => setCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <div className="text-[11px] text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 leading-relaxed">
              استحقاق فوري مربوط بالمشروع: يدخل ربحية الفترة، والصرف من شاشة الموظفين.
            </div>
            <DocOutcome>الأثر: <b>5117 مصروف عمولات موظفين</b> مديناً على مركز تكلفة المشروع · <b>2116 عمولات موظفين مستحقة</b> دائناً حتى الصرف مع الراتب أو منفرداً.</DocOutcome>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCommFor(null)}>إغلاق</Btn>
              <Btn onClick={saveProjectCommission} shortcut="F9" disabled={!commEmpId || !commAmount.trim()}>استحقاق العمولة</Btn>
            </div>
          </div>
        )}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   §96-أ: قسم مستقل لمصروفات المشروعات (`/contracting/expenses`)
   التسجيل من نافذة مصروف المشروع الحرة (ProjectExpenseWindowView — اعتماد
   المالك لنموذج N-04 الحي): بنود حرة بتصنيفات تنمو من «أخرى…» وتُحفظ،
   والصافي يُحمَّل على المشروع فيقلل أرباحه بطريقة محاسبية احترافية.
   هذه الصفحة: القائمة والتصفية والمعاينة فقط.
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ProjectExpensesPage() {
  const {
    projects,
    projectCosts,
    suppliers,
    custodyFiles,
    treasuries,
    journal,
  } = useDataStore()
  const { setup } = useAppStore()
  const cur = getCountry(setup.countryCode ?? 'EG')!.currency
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [searchParams] = useSearchParams()

  const [filterProjectId, setFilterProjectId] = useState<string>(() => searchParams.get('projectId') ?? '')
  const [filterKind, setFilterKind] = useState<string>('')
  const [search, setSearch] = useState('')
  const [viewCostId, setViewCostId] = useState<number | null>(null)

  const filteredCosts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...projectCosts]
      .filter((c) => (!filterProjectId || c.projectId === Number(filterProjectId)))
      .filter((c) => (!filterKind || c.kind === filterKind))
      .filter((c) => {
        if (!q) return true
        const p = projects.find((x) => x.id === c.projectId)
        const s = c.supplierId ? suppliers.find((x) => x.id === c.supplierId) : null
        return (
          (c.expenseNumber ?? '').toLowerCase().includes(q) ||
          (c.invoiceRef ?? '').toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          (p?.nameAr ?? '').toLowerCase().includes(q) ||
          (p?.code ?? '').toLowerCase().includes(q) ||
          (s?.nameAr ?? '').toLowerCase().includes(q) ||
          (c.lines ?? []).some((l) => (l.categoryNameAr ?? '').toLowerCase().includes(q))
        )
      })
      .sort((a, b) => b.id - a.id)
  }, [projectCosts, filterProjectId, filterKind, search, projects, suppliers])

  const kpis = useMemo(() => {
    const netTotal = filteredCosts.reduce((s, c) => s + c.amountMinor, 0)
    const vatTotal = filteredCosts.reduce((s, c) => s + (c.vatMinor ?? 0), 0)
    const grossTotal = filteredCosts.reduce((s, c) => s + (c.grossMinor ?? c.amountMinor + (c.vatMinor ?? 0)), 0)
    const dueTotal = filteredCosts.reduce((s, c) => s + (c.dueMinor ?? 0), 0)
    return { netTotal, vatTotal, grossTotal, dueTotal }
  }, [filteredCosts])

  const viewingCost = viewCostId != null ? projectCosts.find((c) => c.id === viewCostId) ?? null : null

  return (
    <div className="space-y-4" data-project-expenses-page>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Hammer className="w-6 h-6 text-rose-600" /> مصروفات المشروعات
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            قسم مستقل لتسجيل فواتير ومصروفات المشروعات ببنود حرة (شامل أو غير شامل الضريبة) وتحميل الصافي على أرباح المشروع
          </p>
        </div>
        <Btn onClick={() => openProjectExpenseWindow(filterProjectId ? Number(filterProjectId) : undefined)} data-open-project-expense data-open-project-expense-modal>
          <Plus className="w-4 h-4" /> تسجيل مصروف مشروع جديد
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">صافي مصروفات المشروعات (5110)</div>
          <div className="text-xl font-black text-rose-600 mt-1">{fmt(kpis.netTotal)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{filteredCosts.length} مستند مصروف يخصم من أرباح المشروعات</div>
        </div>
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">ضريبة المدخلات المستردة (2102)</div>
          <div className="text-xl font-black text-sky-600 mt-1">{fmt(kpis.vatTotal)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">معزولة محاسبياً لا تُضخّم تكلفة المشروع</div>
        </div>
        <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">الإجمالي الشامل للفواتير</div>
          <div className="text-xl font-black text-orange-600 mt-1">{fmt(kpis.grossTotal)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">إجمالي الصافي + الضريبة</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">المتبقي الآجل للموردين (2101)</div>
          <div className="text-xl font-black text-amber-600 mt-1">{fmt(kpis.dueTotal)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">مدرج في كشوف حسابات الموردين</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="w-60">
          <select value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)} className={inputCls} aria-label="تصفية حسب المشروع">
            <option value="">كل المشروعات ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className={inputCls} aria-label="تصفية حسب فئة التكلفة">
            <option value="">كل فئات التكلفة</option>
            {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
              <option key={k} value={k}>{COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم المستند، الفاتورة، البيان، المشروع، المورد…" className={inputCls} />
        </div>
      </div>

      {filteredCosts.length === 0 ? (
        <EmptyState
          icon="🧱"
          title="لا مصروفات مشروعات مسجلة"
          sub="اضغط «تسجيل مصروف مشروع جديد» لاختيار المشروع وإدخال بنود المصروفات الحرة (شامل أو غير شامل الضريبة)"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="w-full text-sm" data-project-expenses-table>
            <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <tr>
                {['رقم المستند', 'التاريخ', 'المشروع', 'الفئة / البنود', 'المورد / السداد', 'الصافي على المشروع (5110)', 'الضريبة (2102)', 'الإجمالي الشامل', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-right font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCosts.map((c) => {
                const prj = projects.find((p) => p.id === c.projectId)
                const sup = c.supplierId ? suppliers.find((s) => s.id === c.supplierId) : null
                const gross = c.grossMinor ?? c.amountMinor + (c.vatMinor ?? 0)
                const paid = c.paidMinor ?? (c.payment === 'cash' ? gross : 0)
                const due = c.dueMinor ?? Math.max(0, gross - paid)
                const custodyFile = c.custodyFileId != null ? custodyFiles.find((file) => file.id === c.custodyFileId) : null
                const sourceLabel = custodyFile
                  ? `عهدة ${custodyFile.fileNumber}`
                  : c.treasury
                  ? treasuries.find((treasury) => treasury.code === c.treasury)?.nameAr ?? c.treasury
                  : paid > 0 ? 'مصدر نقدي' : 'لم يُدفع بعد'
                return (
                  <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-rose-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-black">
                      {c.expenseNumber ?? `PEX-${String(c.id).padStart(4, '0')}`}
                      {c.invoiceRef && <span className="block text-[10px] text-slate-400">مرجع: {c.invoiceRef}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[12px]">{c.date.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 font-bold">{prj ? `${prj.code} — ${prj.nameAr}` : `#${c.projectId}`}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-500/10 text-[11px] font-bold ml-1.5">
                        {COST_KIND_LABELS[c.kind].icon} {COST_KIND_LABELS[c.kind].nameAr}
                      </span>
                      <span className="font-semibold">{c.description}</span>
                      {c.lines && c.lines.length > 0 && (
                        <span className="block text-[11px] text-slate-400">{c.lines.length} بنود مسجلة</span>
                      )}
                      {c.lines && c.lines.some((l) => l.categoryNameAr) && (
                        <span className="block text-[11px] text-brand-600 dark:text-brand-300" data-expense-line-categories>
                          {[...new Set(c.lines.map((l) => l.categoryNameAr).filter(Boolean))].join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px]">
                      {sup ? <div className="font-bold">{sup.nameAr}</div> : null}
                      <div className="mb-1 text-[10.5px] text-slate-400" data-project-expense-payment-source>مصدر المدفوع: {sourceLabel}</div>
                      <div className="mb-1 text-[10.5px] text-slate-500">مدفوع {fmt(paid)} · آجل {fmt(due)}</div>
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${c.payment === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : c.payment === 'credit' ? 'bg-amber-500/10 text-amber-600' : 'bg-sky-500/10 text-sky-600'}`}>
                        {c.payment === 'cash' ? 'مدفوع بالكامل' : c.payment === 'credit' ? 'آجل على المورد' : 'سداد جزئي'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-black text-rose-600">{fmt(c.amountMinor)} {cur.symbol}</td>
                    <td className="px-3 py-2.5 font-bold text-sky-600">{c.vatMinor ? `${fmt(c.vatMinor)} ${cur.symbol}` : '—'}</td>
                    <td className="px-3 py-2.5 font-black">{fmt(gross)} {cur.symbol}</td>
                    <td className="px-3 py-2.5 text-left">
                      <button
                        onClick={() => setViewCostId(c.id)}
                        data-view-project-expense
                        title="معاينة تفاصيل البنود والقيد المحاسبي"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* كشف المصروفات التفصيلي (طلب المالك — بندا ٨ و١٠): عند اختيار مشروع
          يظهر كشف سطر-لكل-بند بتصدير طباعة/PDF وExcel وCSV */}
      {filterProjectId && (() => {
        const prj = projects.find((p) => p.id === Number(filterProjectId))
        return prj ? (
          <ProjectExpenseLedgerCard
            costs={filteredCosts}
            projectCode={prj.code}
            projectNameAr={prj.nameAr}
            title={`كشف المصروفات التفصيلي — ${prj.code} — ${prj.nameAr} (سطر لكل بند)`}
          />
        ) : null
      })()}

      {/* معاينة تفاصيل مستند مصروف مشروع */}
      <Modal
        open={!!viewingCost}
        onClose={() => setViewCostId(null)}
        title={viewingCost ? `مستند مصروف مشروع ${viewingCost.expenseNumber ?? `#${viewingCost.id}`}` : ''}
        subtitle="تفصيل بنود المصروف والأثر المحاسبي على المشروع"
        wide
      >
        {viewingCost && (() => {
          const prj = projects.find((p) => p.id === viewingCost.projectId)
          const sup = viewingCost.supplierId ? suppliers.find((s) => s.id === viewingCost.supplierId) : null
          const entry = journal.find((e) => e.id === viewingCost.journalEntryId)
          const gross = viewingCost.grossMinor ?? viewingCost.amountMinor + (viewingCost.vatMinor ?? 0)
          const paid = viewingCost.paidMinor ?? (viewingCost.payment === 'cash' ? gross : 0)
          const due = viewingCost.dueMinor ?? Math.max(0, gross - paid)
          const custodyFile = viewingCost.custodyFileId != null ? custodyFiles.find((file) => file.id === viewingCost.custodyFileId) : null
          const paymentSource = custodyFile
            ? `عهدة ${custodyFile.fileNumber}`
            : viewingCost.treasury
            ? treasuries.find((treasury) => treasury.code === viewingCost.treasury)?.nameAr ?? viewingCost.treasury
            : paid > 0 ? 'مصدر نقدي' : 'لا يوجد — كامل المبلغ آجل'
          return (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-rose-500/10 p-3"><div className="text-[11px] text-slate-500">الصافي على المشروع (5110)</div><div className="font-black text-rose-600">{fmt(viewingCost.amountMinor)} {cur.symbol}</div></div>
                <div className="rounded-xl bg-sky-500/10 p-3"><div className="text-[11px] text-slate-500">ضريبة المدخلات (2102)</div><div className="font-black text-sky-600">{fmt(viewingCost.vatMinor ?? 0)} {cur.symbol}</div></div>
                <div className="rounded-xl bg-slate-500/10 p-3"><div className="text-[11px] text-slate-500">الإجمالي الشامل</div><div className="font-black">{fmt(gross)} {cur.symbol}</div></div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-[12.5px]">
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">المشروع</span><b>{prj ? `${prj.code} — ${prj.nameAr}` : `#${viewingCost.projectId}`}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">التاريخ</span><b>{viewingCost.date.slice(0, 10)}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">الجهة الآجلة</span><b>{sup?.nameAr ?? (due > 0 ? 'غير محددة — سجل قديم' : 'لا يوجد')}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">مصدر السداد</span><b>{paymentSource}</b></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">مدفوع الآن · آجل</span><b>{fmt(paid)} · {fmt(due)} {cur.symbol}</b></div>
                {viewingCost.invoiceRef && <div className="flex justify-between px-3 py-2"><span className="text-slate-500">رقم فاتورة المورد</span><b>{viewingCost.invoiceRef}</b></div>}
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">البيان</span><b>{viewingCost.description}</b></div>
              </div>
              {viewingCost.lines && viewingCost.lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-[12px]">
                    <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                      <tr>{['#', 'بيان البند', 'التصنيف', 'الكمية × السعر', 'حالة الضريبة', 'الصافي', 'الضريبة', 'الإجمالي'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {viewingCost.lines.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-1.5">{i + 1}</td>
                          <td className="px-3 py-1.5 font-bold">{l.description}</td>
                          <td className="px-3 py-1.5">{l.categoryNameAr ?? COST_KIND_LABELS[l.kind].nameAr}</td>
                          <td className="px-3 py-1.5">{l.qty} × {fmt(l.unitPriceMinor)}</td>
                          <td className="px-3 py-1.5">{l.taxMode === 'inclusive' ? `شامل (${l.vatPercent}٪)` : l.taxMode === 'exclusive' ? `غير شامل (+${l.vatPercent}٪)` : 'بدون ضريبة'}</td>
                          <td className="px-3 py-1.5 font-bold text-rose-600">{fmt(l.netMinor)}</td>
                          <td className="px-3 py-1.5 text-sky-600">{l.vatMinor > 0 ? fmt(l.vatMinor) : '—'}</td>
                          <td className="px-3 py-1.5 font-black">{fmt(l.grossMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {entry && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-sky-500/10 px-3 py-2 flex items-center gap-2 text-sky-700 dark:text-sky-300 font-bold text-[12px]">
                    <BookOpenText className="w-4 h-4" /> القيد #{entry.entryNumber} — {entry.description}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                          <td className="px-3 py-1.5 font-mono text-emerald-600">{l.debit ? fmt(l.debit) : ''}</td>
                          <td className="px-3 py-1.5 font-mono text-rose-600">{l.credit ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   §96-ب: قسم مستقل للمستخلصات كفواتير أعمال على العميل (`/contracting/extracts`)
   - عند اختيار المشروع تظهر بنود المشروع (BOQ) في الفاتورة وجميع النسب صفر افتراضياً
     إلا البنود التي يعدلها المستخدم (في المستخلص الأول).
   - وفي حالة عمل مستخلص للمرة الثانية (أو ما بعدها) تظهر النسبة السابقة وبجانبها
     مربع النسبة الجديدة.
   - وبجانب كل مستخلص زر طباعة فاتورة احترافية للعميل كأنها فاتورة بيع ولكنها مستخلص.
   ═══════════════════════════════════════════════════════════════════════════════ */
export function ProjectExtractsPage() {
  const {
    projects,
    projectExtracts,
    boqItems,
    changeOrders,
    customers,
    journal,
    paymentTerminals,
    addProjectExtract,
    editProjectExtract,
    refundProjectExtract,
    getAdvanceBalance,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const creditApproval = useSupervisorApproval()
  const cur = getCountry(setup.countryCode ?? 'EG')!.currency
  const fmt = (m: number) => formatMinor(m, cur, false)
  const vatEnabled = setup.vatPercent > 0
  const [searchParams] = useSearchParams()

  const [filterProjectId, setFilterProjectId] = useState<string>(() => searchParams.get('projectId') ?? '')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingExtractId, setEditingExtractId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [exMode, setExMode] = useState<'lines' | 'gross'>('lines')
  const [exLines, setExLines] = useState<Record<number, string>>({})
  const [exGross, setExGross] = useState('')
  const [exVat, setExVat] = useState(vatEnabled)
  const [exPayment, setExPayment] = useState<'cash' | 'credit'>('credit')
  const [exTreasury, setExTreasury] = useState('1101')
  const [exTerminal, setExTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [exDesc, setExDesc] = useState('')
  const [exRecovery, setExRecovery] = useState('')
  const [exFinal, setExFinal] = useState(false)
  const [exReason, setExReason] = useState('')
  const [viewExtractId, setViewExtractId] = useState<number | null>(null)
  const [refundExtractId, setRefundExtractId] = useState<number | null>(null)

  const selectedProject = projects.find((p) => p.id === Number(selectedProjectId)) ?? null
  const editingExtract = editingExtractId != null ? projectExtracts.find((e) => e.id === editingExtractId) ?? null : null

  /** المستخلصات السابقة للمشروع المختار (قبل المستخلص الحالي عند التعديل) */
  const priorExtracts = useMemo(() => {
    if (!selectedProject) return []
    return projectExtracts.filter(
      (e) => e.projectId === selectedProject.id && (editingExtract ? e.id < editingExtract.id : true),
    )
  }, [projectExtracts, selectedProject, editingExtract])

  const isSecondOrLaterExtract = priorExtracts.length > 0

  /** بنود BOQ للمشروع مع حساب النسبة السابقة المعتمدة لكل بند من المستخلصات السابقة */
  const projectBoqWithPrev = useMemo(() => {
    if (!selectedProject) return []
    return boqItems
      .filter((b) => b.projectId === selectedProject.id)
      .map((b) => {
        const billedPct = priorExtracts.reduce((max, ex) => {
          const l = ex.lines?.find((x) => x.boqItemId === b.id)
          return l && l.newProgressPercent > max ? l.newProgressPercent : max
        }, 0)
        const editLine = editingExtract?.lines?.find((x) => x.boqItemId === b.id)
        const prevPercent = editLine ? editLine.prevProgressPercent : billedPct
        return { ...b, prevPercent }
      })
  }, [boqItems, selectedProject, priorExtracts, editingExtract])

  const selectProjectForNewExtract = (projIdStr: string) => {
    setSelectedProjectId(projIdStr)
    const projId = Number(projIdStr)
    const pBoq = boqItems.filter((b) => b.projectId === projId)
    const pExtracts = projectExtracts.filter((e) => e.projectId === projId)
    setExMode(pBoq.length > 0 ? 'lines' : 'gross')
    // جميع النسب الافتراضية = 0% في المستخلص الأول، أو تساوي النسبة السابقة في المستخلص الثاني وما بعده (بحيث تكون شريحة الفاتورة 0% إلا للبنود التي يعدلها المستخدم)
    const initMap: Record<number, string> = {}
    for (const b of pBoq) {
      const prevPct = pExtracts.reduce((max, ex) => {
        const l = ex.lines?.find((x) => x.boqItemId === b.id)
        return l && l.newProgressPercent > max ? l.newProgressPercent : max
      }, 0)
      initMap[b.id] = String(prevPct)
    }
    setExLines(initMap)
    setExGross('')
  }

  const openNewExtractModal = (preselectProjectId?: number) => {
    setEditingExtractId(null)
    setExReason('')
    setExFinal(false)
    setExDesc('')
    setExRecovery('')
    setExVat(vatEnabled)
    setExPayment('credit')
    const active = projects.filter((p) => p.status === 'active')
    const initialProjId = preselectProjectId ?? (filterProjectId ? Number(filterProjectId) : active[0]?.id ?? 0)
    if (initialProjId) {
      selectProjectForNewExtract(String(initialProjId))
    } else {
      setSelectedProjectId('')
      setExLines({})
      setExGross('')
    }
    setModalOpen(true)
  }

  const openEditExtractModal = (ex: (typeof projectExtracts)[number]) => {
    setEditingExtractId(ex.id)
    setSelectedProjectId(String(ex.projectId))
    const pBoq = boqItems.filter((b) => b.projectId === ex.projectId)
    const pExtracts = projectExtracts.filter((e) => e.projectId === ex.projectId && e.id < ex.id)
    const hasLines = !!(ex.lines && ex.lines.length > 0)
    setExMode(hasLines ? 'lines' : 'gross')
    const initMap: Record<number, string> = {}
    for (const b of pBoq) {
      const existingLine = ex.lines?.find((x) => x.boqItemId === b.id)
      if (existingLine) {
        initMap[b.id] = String(existingLine.newProgressPercent)
      } else {
        const prevPct = pExtracts.reduce((max, prior) => {
          const l = prior.lines?.find((x) => x.boqItemId === b.id)
          return l && l.newProgressPercent > max ? l.newProgressPercent : max
        }, 0)
        initMap[b.id] = String(prevPct)
      }
    }
    setExLines(initMap)
    setExGross(String(ex.totals.grossMinor / 10 ** cur.decimals))
    setExVat(ex.totals.vatMinor > 0)
    setExPayment(ex.payment)
    setExDesc(ex.description)
    setExRecovery(ex.advanceRecoveryMinor ? String(ex.advanceRecoveryMinor / 10 ** cur.decimals) : '')
    setExFinal(!!ex.isFinal)
    setExReason('')
    setViewExtractId(null)
    setModalOpen(true)
  }

  const linesPreview = useMemo(() => {
    const rows = projectBoqWithPrev.map((b) => {
      const raw = exLines[b.id]
      const parsed = raw !== undefined && raw !== '' ? Number(raw) : b.prevPercent
      const newPercent = Number.isFinite(parsed) ? parsed : b.prevPercent
      const total = boqItemTotal(b)
      const validSlice = newPercent > b.prevPercent && newPercent <= 100
      const slicePercent = validSlice ? Math.round((newPercent - b.prevPercent) * 100) / 100 : 0
      const sliceMinor = validSlice
        ? Math.round((total * newPercent) / 100) - Math.round((total * b.prevPercent) / 100)
        : 0
      return { boq: b, prevPercent: b.prevPercent, newPercent, slicePercent, sliceMinor, total }
    })
    const grossMinor = rows.reduce((s, r) => s + r.sliceMinor, 0)
    return { rows, grossMinor }
  }, [projectBoqWithPrev, exLines])

  const effectiveGrossMinor = exMode === 'lines' ? linesPreview.grossMinor : toMinor(exGross || '0', cur.decimals)
  const retentionMinor = selectedProject ? Math.round((effectiveGrossMinor * selectedProject.retentionPercent) / 100) : 0
  const vatMinor = exVat ? Math.round((effectiveGrossMinor * setup.vatPercent) / 100) : 0
  const recoveryMinor = exRecovery ? toMinor(exRecovery, cur.decimals) : 0
  const dueMinor = Math.max(0, effectiveGrossMinor - retentionMinor + vatMinor - recoveryMinor)

  const printExtractDoc = (ex: (typeof projectExtracts)[number]) => {
    const prj = projects.find((p) => p.id === ex.projectId)
    if (!prj) return
    const documentSettings = resolveDocumentPrintSettings(prj)
    const previous = projectExtracts
      .filter((e) => e.projectId === ex.projectId && e.id < ex.id)
      .reduce((a, e) => a + e.totals.grossMinor, 0)
    const cumulative = previous + ex.totals.grossMinor
    printHtml(
      renderExtractHtml({
        shopName: documentSettings.setup.shopName || 'مقاولات',
        extractNumber: ex.extractNumber,
        dateIso: ex.date,
        projectName: prj.nameAr,
        projectCode: prj.code,
        clientName: prj.clientName,
        contractValue: prj.contractValueMinor > 0 ? `${fmt(prj.contractValueMinor)} ${cur.symbol}` : '',
        description: ex.description,
        previousGross: `${fmt(previous)} ${cur.symbol}`,
        currentGross: `${fmt(ex.totals.grossMinor)} ${cur.symbol}`,
        cumulativeGross: `${fmt(cumulative)} ${cur.symbol}`,
        progressPercent: prj.contractValueMinor > 0 ? Math.round((cumulative / prj.contractValueMinor) * 100) : null,
        vat: ex.totals.vatMinor > 0 ? `${fmt(ex.totals.vatMinor)} ${cur.symbol}` : '',
        retention: ex.totals.retentionMinor > 0 ? `${fmt(ex.totals.retentionMinor)} ${cur.symbol}` : '',
        retentionPercent: prj.retentionPercent,
        lines: (ex.lines ?? []).map((l) => ({
          code: l.code,
          descriptionAr: l.descriptionAr,
          prevPercent: l.prevProgressPercent,
          newPercent: l.newProgressPercent,
          value: `${fmt(l.lineValueMinor)} ${cur.symbol}`,
        })),
        advanceRecovery: ex.advanceRecoveryMinor ? `${fmt(ex.advanceRecoveryMinor)} ${cur.symbol}` : '',
        due: `${fmt(ex.totals.dueMinor)} ${cur.symbol}`,
        payment: ex.payment,
        currencySymbol: cur.symbol,
      }),
    )
  }

  const printClientInvoice = (ex: (typeof projectExtracts)[number]) => {
    const prj = projects.find((p) => p.id === ex.projectId)
    if (!prj) return
    const documentSettings = resolveDocumentPrintSettings(prj)
    const client = prj.clientId != null ? customers.find((c) => c.id === prj.clientId) : undefined
    const previous = projectExtracts
      .filter((e) => e.projectId === ex.projectId && e.id < ex.id)
      .reduce((a, e) => a + e.totals.grossMinor, 0)
    const cumulative = previous + ex.totals.grossMinor
    const einv = documentSettings.einvoice
    printHtml(
      renderExtractClientInvoiceHtml({
        shopName: documentSettings.setup.shopName || 'مقاولات',
        shopPhone: documentSettings.setup.phone,
        shopAddress: [documentSettings.setup.city, documentSettings.setup.street].filter(Boolean).join(' — '),
        shopTaxId: einv.taxNumber,
        extractNumber: ex.extractNumber,
        dateIso: ex.date,
        projectName: prj.nameAr,
        projectCode: prj.code,
        contractNumber: prj.contractNumber,
        clientName: client?.nameAr || prj.clientName || 'الجهة المالكة',
        clientPhone: client?.phone,
        clientTaxId: client?.taxNumber,
        contractValue: prj.contractValueMinor > 0 ? `${fmt(prj.contractValueMinor)} ${cur.symbol}` : '',
        description: ex.description,
        previousGross: `${fmt(previous)} ${cur.symbol}`,
        currentGross: `${fmt(ex.totals.grossMinor)} ${cur.symbol}`,
        cumulativeGross: `${fmt(cumulative)} ${cur.symbol}`,
        progressPercent: prj.contractValueMinor > 0 ? Math.round((cumulative / prj.contractValueMinor) * 100) : null,
        vat: ex.totals.vatMinor > 0 ? `${fmt(ex.totals.vatMinor)} ${cur.symbol}` : '',
        retention: ex.totals.retentionMinor > 0 ? `${fmt(ex.totals.retentionMinor)} ${cur.symbol}` : '',
        retentionPercent: prj.retentionPercent,
        advanceRecovery: ex.advanceRecoveryMinor ? `${fmt(ex.advanceRecoveryMinor)} ${cur.symbol}` : '',
        due: `${fmt(ex.totals.dueMinor)} ${cur.symbol}`,
        payment: ex.payment,
        currencySymbol: cur.symbol,
        isFinal: ex.isFinal,
        lines: (ex.lines ?? []).map((l) => {
          const boq = boqItems.find((b) => b.id === l.boqItemId)
          return {
            code: l.code,
            descriptionAr: l.descriptionAr,
            unit: boq?.unit,
            boqQty: boq?.qty,
            unitPrice: boq ? `${fmt(boq.unitPriceMinor)} ${cur.symbol}` : undefined,
            boqTotal: boq ? `${fmt(boqItemTotal(boq))} ${cur.symbol}` : undefined,
            prevPercent: l.prevProgressPercent,
            newPercent: l.newProgressPercent,
            currentSlicePercent: Math.max(0, Math.round((l.newProgressPercent - l.prevProgressPercent) * 100) / 100),
            value: `${fmt(l.lineValueMinor)} ${cur.symbol}`,
          }
        }),
      }),
    )
  }

  const submitExtract = (creditLimitOverrideBy?: string) => {
    if (!selectedProject) {
      toast.show('اختر المشروع أولاً', 'error')
      return
    }
    try {
      const linesInput =
        exMode === 'lines'
          ? linesPreview.rows
              .filter((r) => r.newPercent > r.prevPercent)
              .map((r) => ({ boqItemId: r.boq.id, newProgressPercent: r.newPercent }))
          : undefined
      if (editingExtract) {
        const updated = editProjectExtract({
          extractId: editingExtract.id,
          grossMinor: exMode === 'gross' ? toMinor(exGross, cur.decimals) : undefined,
          extractLines: linesInput,
          vatPercent: exVat ? setup.vatPercent : 0,
          payment: exPayment,
          description: exDesc.trim(),
          treasury: exTreasury,
          advanceRecoveryMinor: recoveryMinor,
          creditLimitOverrideBy: creditLimitOverrideBy ?? null,
          isFinal: exFinal,
          reason: exReason.trim(),
        })
        toast.show(`عُدّل المستخلص ${updated.extractNumber} — الصافي المستحق ${fmt(updated.totals.dueMinor)} ✅`)
        setModalOpen(false)
        setEditingExtractId(null)
        setViewExtractId(updated.id)
      } else {
        const terminal = paymentTerminals.find((row) => row.id === exTerminal.terminalId)
        const created = addProjectExtract({
          projectId: selectedProject.id,
          grossMinor: exMode === 'gross' ? toMinor(exGross, cur.decimals) : undefined,
          extractLines: linesInput,
          vatPercent: exVat ? setup.vatPercent : 0,
          payment: exPayment,
          description: exDesc.trim(),
          treasury: terminal?.settlementAccountCode ?? exTreasury,
          terminalPayment: terminal
            ? { terminalId: terminal.id, providerReference: exTerminal.providerReference.trim(), cardLast4: exTerminal.cardLast4 || undefined }
            : undefined,
          advanceRecoveryMinor: recoveryMinor,
          creditLimitOverrideBy: creditLimitOverrideBy ?? null,
          isFinal: exFinal,
        })
        toast.show(`صدر المستخلص ${created.extractNumber} كفاتورة على العميل — الصافي المستحق ${fmt(created.totals.dueMinor)} ✅`)
        setModalOpen(false)
        setViewExtractId(created.id)
      }
    } catch (e) {
      if (e instanceof CreditLimitError) {
        creditApproval.request((by) => submitExtract(by ?? 'المشرف'))
        return
      }
      toast.show((e as Error).message, 'error')
    }
  }

  const filteredExtracts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...projectExtracts]
      .filter((e) => (!filterProjectId || e.projectId === Number(filterProjectId)))
      .filter((e) => {
        if (!q) return true
        const p = projects.find((x) => x.id === e.projectId)
        return (
          e.extractNumber.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          (p?.nameAr ?? '').toLowerCase().includes(q) ||
          (p?.code ?? '').toLowerCase().includes(q) ||
          (p?.clientName ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => b.id - a.id)
  }, [projectExtracts, filterProjectId, search, projects])

  const kpis = useMemo(() => {
    const gross = filteredExtracts.reduce((s, e) => s + e.totals.grossMinor, 0)
    const vat = filteredExtracts.reduce((s, e) => s + e.totals.vatMinor, 0)
    const retention = filteredExtracts.reduce((s, e) => s + e.totals.retentionMinor, 0)
    const due = filteredExtracts.reduce((s, e) => s + e.totals.dueMinor, 0)
    return { gross, vat, retention, due }
  }, [filteredExtracts])

  const viewingExtract = viewExtractId != null ? projectExtracts.find((e) => e.id === viewExtractId) ?? null : null
  const refundingExtract = refundExtractId != null ? projectExtracts.find((e) => e.id === refundExtractId) ?? null : null

  return (
    <div className="space-y-4" data-project-extracts-page>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Receipt className="w-6 h-6 text-teal-600" /> المستخلصات (فواتير الأعمال للعملاء)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            قسم مستقل لإصدار المستخلصات كفواتير أعمال على العميل من بنود جدول الكميات (BOQ) مع طباعة فاتورة مستخلص احترافية للعميل
          </p>
        </div>
        <Btn variant="primary" onClick={() => openExtractWizardWindow()} data-open-extract-wizard title="طريق مختصر من ثلاث خطوات في نافذة حرة — نفس محرك الترحيل">
          <Plus className="w-4 h-4" /> مستخلص جديد — معالج سريع
        </Btn>
        <Btn onClick={() => openNewExtractModal()} data-open-extract-modal>
          <Plus className="w-4 h-4" /> إصدار مستخلص جديد (فاتورة للعميل)
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">إجمالي الأعمال المفوترة (4107)</div>
          <div className="text-xl font-black text-emerald-600 mt-1">{fmt(kpis.gross)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{filteredExtracts.length} مستخلص صادر للعملاء</div>
        </div>
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">ضريبة القيمة المضافة (2102)</div>
          <div className="text-xl font-black text-sky-600 mt-1">{fmt(kpis.vat)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">ضريبة مخرجات المستخلصات</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">محتجز ضمان الأعمال (1105)</div>
          <div className="text-xl font-black text-amber-600 mt-1">{fmt(kpis.retention)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">يُفرج عنه عند التسليم النهائي</div>
        </div>
        <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3.5">
          <div className="text-xs font-bold text-slate-500">صافي الفواتير المستحق على العملاء</div>
          <div className="text-xl font-black text-orange-600 mt-1">{fmt(kpis.due)} {cur.symbol}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">الصافي بعد المحتجز والضريبة</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="w-64">
          <select value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)} className={inputCls} aria-label="تصفية حسب المشروع">
            <option value="">كل المشروعات ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم المستخلص، المشروع، العميل، البيان…" className={inputCls} />
        </div>
      </div>

      {filteredExtracts.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="لا مستخلصات صادرة بعد"
          sub="اضغط «إصدار مستخلص جديد (فاتورة للعميل)» واختر المشروع لتظهر بنود المشروع بنسبة 0% افتراضياً وتُصدر فاتورة المستخلص للعميل"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="w-full text-sm" data-extracts-table>
            <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
              <tr>
                {['رقم المستخلص', 'التاريخ', 'المشروع', 'العميل / الجهة المالكة', 'البنود', 'قيمة الأعمال', 'الضريبة', 'المحتجز', 'الصافي المستحق', 'السداد', 'طباعة ومراجعة'].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-right font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredExtracts.map((ex) => {
                const prj = projects.find((p) => p.id === ex.projectId)
                return (
                  <tr key={ex.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-orange-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-black">
                      {ex.extractNumber}
                      {ex.isFinal && <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 font-bold">ختامي</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[12px]">{ex.date.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 font-bold">{prj ? `${prj.code} — ${prj.nameAr}` : `#${ex.projectId}`}</td>
                    <td className="px-3 py-2.5">{prj?.clientName || '—'}</td>
                    <td className="px-3 py-2.5 text-[12px]">
                      {ex.lines?.length ? (
                        <span className="px-2 py-0.5 rounded-lg bg-orange-500/10 text-orange-700 dark:text-orange-300 font-bold">
                          {ex.lines.length} بنود BOQ
                        </span>
                      ) : (
                        <span className="text-slate-400">مبلغ إجمالي</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-emerald-600">{fmt(ex.totals.grossMinor)}</td>
                    <td className="px-3 py-2.5 text-sky-600">{ex.totals.vatMinor > 0 ? fmt(ex.totals.vatMinor) : '—'}</td>
                    <td className="px-3 py-2.5 text-amber-600">{ex.totals.retentionMinor > 0 ? fmt(ex.totals.retentionMinor) : '—'}</td>
                    <td className="px-3 py-2.5 font-black text-orange-600">{fmt(ex.totals.dueMinor)} {cur.symbol}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${ex.payment === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                        {ex.payment === 'cash' ? 'نقدي محصل' : 'آجل على العميل'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => printClientInvoice(ex)}
                          data-extract-client-invoice-print
                          title="طباعة فاتورة احترافية للعميل كأنها فاتورة بيع ولكنها مستخلص"
                          className="px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-teal-600 text-white hover:bg-teal-700 transition-all flex items-center gap-1 shadow-sm"
                        >
                          <FileText size={13} /> طباعة فاتورة للعميل
                        </button>
                        <button
                          onClick={() => printExtractDoc(ex)}
                          title="طباعة وثيقة المستخلص الهندسي"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all"
                        >
                          <Printer size={14} />
                        </button>
                        <button
                          onClick={() => setViewExtractId(ex.id)}
                          data-extract-review
                          title="مراجعة المستخلص وتفاصيل القيد"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => openEditExtractModal(ex)}
                          data-extract-edit
                          title="تعديل المستخلص"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* نافذة إصدار / تعديل مستخلص كفاتورة على العميل */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingExtract ? `تعديل مستخلص ${editingExtract.extractNumber}` : 'إصدار مستخلص أعمال كفاتورة على العميل'}
        subtitle="عند اختيار المشروع تظهر بنود المشروع بنسبة 0% افتراضياً في المستخلص الأول، وفي المستخلص الثاني تظهر النسبة السابقة وبجانبها مربع النسبة الجديدة"
        wide
      >
        <div className="space-y-4" data-project-extract-modal>
          <DocSectionHead step="١" title="اختيار المشروع وبيانات فاتورة المستخلص" hint="المستخلص يولّد فاتورة أعمال على العميل مع احتساب المحتجز والضريبة واسترداد الدفعة المقدمة تلقائياً" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="المشروع *">
              <select
                value={selectedProjectId}
                disabled={!!editingExtract}
                onChange={(e) => selectProjectForNewExtract(e.target.value)}
                className={inputCls}
                data-extract-project-select
              >
                <option value="">— اختر المشروع —</option>
                {projects.filter((p) => p.status === 'active' || (editingExtract && p.id === editingExtract.projectId)).map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.nameAr} ({p.clientName || 'بدون عميل'})</option>
                ))}
              </select>
            </Field>
            <Field label="طريقة تحصيل الفاتورة">
              <div className="flex gap-2">
                {([
                  ['credit', 'آجل (على حساب العميل)'],
                  ['cash', 'نقدي / بنكي محصل'],
                ] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setExPayment(m)}
                    className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${exPayment === m ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="بيان المستخلص / ملاحظات الفاتورة">
              <input value={exDesc} onChange={(e) => setExDesc(e.target.value)} className={inputCls} placeholder="مستخلص أعمال جارية…" />
            </Field>
          </div>

          {exPayment === 'cash' && (
            <Field label="حساب الخزينة / البنك للتحصيل">
              <PaymentMethodPicker
                value={{ treasury: exTreasury, terminalPayment: exTerminal }}
                onChange={(v) => { setExTreasury(v.treasury); setExTerminal(v.terminalPayment) }}
                operation="receipt"
              />
            </Field>
          )}

          {editingExtract && (
            <Field label="سبب تعديل المستخلص (إلزامي لسجل التدقيق) *">
              <input
                value={exReason}
                onChange={(e) => setExReason(e.target.value)}
                className={inputCls}
                data-extract-edit-reason
                placeholder="مثال: تصحيح نسبة إنجاز بند المحارة بعد مراجعة الاستشاري…"
              />
            </Field>
          )}

          {selectedProject && (() => {
            const effective = effectiveContractValue(
              selectedProject.contractValueMinor,
              changeOrders.filter((o) => o.projectId === selectedProject.id),
            )
            const claimed = priorExtracts.reduce((s, e) => s + e.totals.grossMinor, 0)
            const remaining = Math.max(0, effective - claimed)
            return (
              <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3 space-y-2" data-extract-project-banner>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className="font-black text-teal-800 dark:text-teal-200">
                    {isSecondOrLaterExtract
                      ? `مستخلص رقم #${priorExtracts.length + 1} للمشروع — تظهر النسبة السابقة لكل بند وبجانبها مربع النسبة الجديدة`
                      : 'المستخلص الأول (#1) للمشروع — جميع نسب البنود 0٪ افتراضياً إلا البنود التي تعدلها'}
                  </span>
                  <span className="text-slate-500">
                    العميل: <b>{selectedProject.clientName || '—'}</b> · محتجز الضمان: <b>{selectedProject.retentionPercent}٪</b>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
                  <div className="rounded-lg bg-white dark:bg-slate-900 p-2"><span className="text-slate-400 block text-[10px]">قيمة العقد الفعلية</span><b>{fmt(effective)} {cur.symbol}</b></div>
                  <div className="rounded-lg bg-white dark:bg-slate-900 p-2"><span className="text-slate-400 block text-[10px]">مفوتر في مستخلصات سابقة</span><b className="text-emerald-600">{fmt(claimed)} {cur.symbol}</b></div>
                  <div className="rounded-lg bg-white dark:bg-slate-900 p-2"><span className="text-slate-400 block text-[10px]">المتبقي من سقف العقد</span><b className="text-orange-600">{fmt(remaining)} {cur.symbol}</b></div>
                </div>
              </div>
            )
          })()}

          {selectedProject && (
            <>
              <DocSectionHead
                step="٢"
                title="بنود المشروع في فاتورة المستخلص (جدول الكميات BOQ)"
                hint={
                  isSecondOrLaterExtract
                    ? 'النسبة السابقة معروضة أمام كل بند وبجانبها مربع النسبة التراكمية الجديدة — لا يُفوتر إلا الفرق الموجب'
                    : 'جميع النسب 0% افتراضياً — عدّل النسبة الجديدة للبنود المنفذة فقط لتدخل في الفاتورة'
                }
              />

              {projectBoqWithPrev.length > 0 && exMode === 'lines' ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-[12px]" data-extract-boq-table>
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                      <tr>
                        <th className="p-2.5 text-right font-bold">كود البند</th>
                        <th className="p-2.5 text-right font-bold">بيان البند (BOQ)</th>
                        <th className="p-2.5 text-left font-bold">إجمالي قيمة البند</th>
                        <th className="p-2.5 text-center font-bold bg-slate-200/70 dark:bg-slate-700/60">النسبة السابقة ٪</th>
                        <th className="p-2.5 text-center font-bold bg-teal-500/15 text-teal-800 dark:text-teal-200">النسبة الجديدة ٪</th>
                        <th className="p-2.5 text-center font-bold">شريحة هذه الفاتورة ٪</th>
                        <th className="p-2.5 text-left font-bold">قيمة البند في الفاتورة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linesPreview.rows.map(({ boq: b, prevPercent, newPercent, slicePercent, sliceMinor, total }) => (
                        <tr
                          key={b.id}
                          className={`border-t border-slate-100 dark:border-slate-800 ${sliceMinor > 0 ? 'bg-teal-500/5' : ''}`}
                          data-extract-boq-row={b.code}
                        >
                          <td className="p-2.5 font-mono font-bold">{b.code}</td>
                          <td className="p-2.5 font-bold">
                            {b.descriptionAr}
                            <span className="block text-[10.5px] font-normal text-slate-400">
                              {b.qty} {b.unit} × {fmt(b.unitPriceMinor)} {cur.symbol}
                            </span>
                          </td>
                          <td className="p-2.5 text-left font-bold tabular-nums">{fmt(total)}</td>
                          <td className="p-2.5 text-center font-black tabular-nums bg-slate-100/80 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300" data-boq-prev-pct>
                            {prevPercent}٪
                          </td>
                          <td className="p-2.5 text-center bg-teal-500/5">
                            <input
                              value={exLines[b.id] ?? String(prevPercent)}
                              onChange={(e) => setExLines((s) => ({ ...s, [b.id]: e.target.value }))}
                              inputMode="decimal"
                              dir="ltr"
                              data-boq-new-pct
                              className="w-24 mx-auto block text-center rounded-lg border-2 border-teal-600/40 focus:border-teal-600 bg-white dark:bg-slate-900 py-1 text-[12.5px] font-black"
                            />
                            {(newPercent < prevPercent || newPercent > 100) && (
                              <div className="text-[10px] text-rose-600 font-bold mt-0.5">
                                {newPercent > 100 ? 'لا تتجاوز 100٪' : `لا تقل عن السابقة (${prevPercent}٪)`}
                              </div>
                            )}
                          </td>
                          <td className="p-2.5 text-center font-bold tabular-nums text-teal-700 dark:text-teal-300" data-boq-slice-pct>
                            {slicePercent > 0 ? `+${slicePercent}٪` : '0٪'}
                          </td>
                          <td className="p-2.5 text-left font-black tabular-nums text-emerald-600" data-boq-slice-val>
                            {sliceMinor > 0 ? `${fmt(sliceMinor)} ${cur.symbol}` : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-teal-500/10">
                      <tr>
                        <td colSpan={6} className="p-2.5 font-bold text-teal-800 dark:text-teal-200">
                          إجمالي قيمة الأعمال المنفذة في هذه الفاتورة ({linesPreview.rows.filter((r) => r.sliceMinor > 0).length} بنود معدلة)
                        </td>
                        <td className="p-2.5 text-left font-black tabular-nums text-teal-800 dark:text-teal-200" data-extract-lines-gross>
                          {fmt(linesPreview.grossMinor)} {cur.symbol}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="space-y-2">
                  {projectBoqWithPrev.length > 0 && (
                    <Btn variant="ghost" onClick={() => setExMode('lines')}>العودة لجدول بنود المشروع (BOQ)</Btn>
                  )}
                  <Field label={`قيمة أعمال المستخلص الإجمالية (${cur.symbol}) *`}>
                    <input value={exGross} onChange={(e) => setExGross(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" data-extract-gross-input />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center pt-1">
                <label className="flex items-center gap-2 text-[12.5px] font-bold cursor-pointer">
                  <input type="checkbox" checked={exVat} onChange={(e) => setExVat(e.target.checked)} />
                  إضافة ضريبة القيمة المضافة ({setup.vatPercent}٪)
                </label>
                <label className="flex items-center gap-2 text-[12.5px] font-bold cursor-pointer text-rose-600">
                  <input type="checkbox" checked={exFinal} onChange={(e) => setExFinal(e.target.checked)} />
                  مستخلص ختامي للمشروع
                </label>
                {getAdvanceBalance(selectedProject.id) + (editingExtract?.advanceRecoveryMinor ?? 0) > 0 && (
                  <Field
                    label={`استرداد من الدفعة المقدمة (${cur.symbol})`}
                    hint={`رصيد الدفعة المقدمة: ${fmt(getAdvanceBalance(selectedProject.id) + (editingExtract?.advanceRecoveryMinor ?? 0))}`}
                  >
                    <input value={exRecovery} onChange={(e) => setExRecovery(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
                  </Field>
                )}
              </div>

              <div className="rounded-2xl border-2 border-teal-600/30 bg-teal-500/5 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center" data-extract-invoice-summary>
                <div className="rounded-xl bg-white dark:bg-slate-900 p-2.5">
                  <div className="text-[11px] text-slate-500">قيمة الأعمال الحالية (4107)</div>
                  <div className="font-black text-emerald-600" data-extract-summary-gross>{fmt(effectiveGrossMinor)} {cur.symbol}</div>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-900 p-2.5">
                  <div className="text-[11px] text-slate-500">ضريبة القيمة المضافة (2102)</div>
                  <div className="font-black text-sky-600" data-extract-summary-vat>{fmt(vatMinor)} {cur.symbol}</div>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-900 p-2.5">
                  <div className="text-[11px] text-slate-500">محتجز الضمان ({selectedProject.retentionPercent}٪) (1105)</div>
                  <div className="font-black text-amber-600" data-extract-summary-retention>− {fmt(retentionMinor)} {cur.symbol}</div>
                </div>
                <div className="rounded-xl bg-teal-700 text-white p-2.5">
                  <div className="text-[11px] opacity-90">صافي الفاتورة المستحق على العميل</div>
                  <div className="text-lg font-black" data-extract-summary-due>{fmt(dueMinor)} {cur.symbol}</div>
                </div>
              </div>
            </>
          )}

          <DocOutcome>الأثر: <b>1104 العميل</b> مديناً بصافي الفاتورة المستحق · <b>1105 محتجز ضمان أعمال</b> مديناً بالمحتجز · <b>2109</b> مديناً بالمسرد من الدفعة المقدمة · <b>4107 إيراد المقاولات</b> دائناً بقيمة الأعمال · و<b>2102</b> دائناً بالضريبة.</DocOutcome>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setModalOpen(false)}>إلغاء</Btn>
            <Btn
              onClick={() => submitExtract()}
              shortcut="F9"
              data-save-project-extract
              disabled={!selectedProject || effectiveGrossMinor <= 0 || (!!editingExtract && !exReason.trim())}
            >
              <Receipt className="w-4 h-4" /> {editingExtract ? 'حفظ تعديل المستخلص' : 'اعتماد المستخلص وإصدار الفاتورة'}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* مراجعة كاملة للمستخلص الصادر */}
      <Modal
        open={!!viewingExtract}
        onClose={() => setViewExtractId(null)}
        title={viewingExtract ? `فاتورة مستخلص ${viewingExtract.extractNumber} — مراجعة كاملة` : ''}
        subtitle="بيانات المستخلص وبنوده وقيده المحاسبي والطباعة كفاتورة للعميل"
        wide
      >
        {viewingExtract && (() => {
          const prj = projects.find((p) => p.id === viewingExtract.projectId)
          if (!prj) return null
          const previous = projectExtracts.filter((e) => e.projectId === prj.id && e.id < viewingExtract.id).reduce((a, e) => a + e.totals.grossMinor, 0)
          const cumulative = previous + viewingExtract.totals.grossMinor
          const entry = journal.find((e) => e.id === viewingExtract.journalEntryId)
          return (
            <div className="space-y-4 text-sm" data-extract-view>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">قيمة الأعمال</div><div className="font-black text-emerald-600">{fmt(viewingExtract.totals.grossMinor)}</div></div>
                <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">محتجز {prj.retentionPercent}٪</div><div className="font-black text-amber-600">{fmt(viewingExtract.totals.retentionMinor)}</div></div>
                <div className="rounded-xl bg-sky-500/10 p-3"><div className="text-[11px] text-slate-500">ض.ق.م</div><div className="font-black text-sky-600">{fmt(viewingExtract.totals.vatMinor)}</div></div>
                <div className="rounded-xl bg-orange-500/10 p-3"><div className="text-[11px] text-slate-500">الصافي المستحق</div><div className="font-black text-orange-600" data-extract-view-due>{fmt(viewingExtract.totals.dueMinor)}</div></div>
              </div>

              {viewingExtract.lines && viewingExtract.lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700" data-extract-view-lines>
                  <table className="w-full text-[12px]">
                    <thead className="bg-teal-500/10 text-teal-800 dark:text-teal-200">
                      <tr>{['الكود', 'البند', 'النسبة السابقة ٪', 'النسبة الجديدة ٪', 'قيمة الشريحة'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {viewingExtract.lines.map((l) => (
                        <tr key={l.boqItemId} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-mono">{l.code}</td>
                          <td className="px-3 py-2">{l.descriptionAr}</td>
                          <td className="px-3 py-2 text-center font-bold">{l.prevProgressPercent}٪</td>
                          <td className="px-3 py-2 text-center font-bold text-teal-600">{l.newProgressPercent}٪</td>
                          <td className="px-3 py-2 font-bold">{fmt(l.lineValueMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-[12.5px] flex justify-between">
                <span>الموقف التراكمي للمشروع ({prj.code} — {prj.nameAr})</span>
                <b>السابق {fmt(previous)} + الحالي {fmt(viewingExtract.totals.grossMinor)} = التراكمي {fmt(cumulative)} {cur.symbol}</b>
              </div>

              {entry && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-sky-500/10 px-3 py-2 flex items-center gap-2 text-sky-700 dark:text-sky-300 font-bold text-[12px]">
                    <BookOpenText className="w-4 h-4" /> القيد #{entry.entryNumber} — {entry.description}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                          <td className="px-3 py-1.5 font-mono text-emerald-600">{l.debit ? fmt(l.debit) : ''}</td>
                          <td className="px-3 py-1.5 font-mono text-rose-600">{l.credit ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Btn onClick={() => printClientInvoice(viewingExtract)} data-extract-client-invoice-print>
                  <FileText size={14} /> طباعة فاتورة للعميل
                </Btn>
                <Btn variant="ghost" onClick={() => printExtractDoc(viewingExtract)}>
                  <Printer size={14} /> طباعة المستخلص الهندسي
                </Btn>
                <Btn variant="ghost" onClick={() => setRefundExtractId(viewingExtract.id)}>
                  إشعار دائن
                </Btn>
                <Btn variant="ghost" onClick={() => openEditExtractModal(viewingExtract)} data-extract-view-edit>
                  <Pencil size={14} /> تعديل المستخلص
                </Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* إشعار دائن على مستخلص */}
      <Modal
        open={!!refundingExtract}
        onClose={() => setRefundExtractId(null)}
        title={refundingExtract ? `إشعار دائن — ${refundingExtract.extractNumber}` : ''}
        subtitle="مستند إشعار دائن: عكس جزء معتمد من المستخلص"
      >
        {refundingExtract && (
          <ServiceRefundBox
            grandMinor={refundingExtract.totals.dueMinor}
            refundedMinor={refundingExtract.refundedMinor ?? 0}
            currencySymbol={cur.symbol}
            fmt={fmt}
            allowCredit={true}
            hint="رفض المالك أو الاستشاري جزءاً من الأعمال بعد اعتماد المستخلص: يعكس الإيراد وحصة الضريبة."
            onSubmit={(a) => {
              try {
                const u = refundProjectExtract({ extractId: refundingExtract.id, ...a, treasury: a.treasury })
                setRefundExtractId(null)
                toast.show(`سُجل إشعار دائن على ${u.extractNumber} وتولد القيد العاكس ✅`)
              } catch (err) {
                toast.show((err as Error).message, 'error')
              }
            }}
          />
        )}
        {refundingExtract && (
          <DocOutcome>الأثر: <b>4102 مرتجعات المبيعات</b> مديناً بصافي المرفوض و<b>2102</b> مديناً بحصته الضريبية · <b>الخزينة</b> دائنة عند الرد نقداً أو <b>1104 ذمم العملاء</b> دائنة عند التخفيض من حساب العميل.</DocOutcome>
        )}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}

