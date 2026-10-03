import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * صفحات المقاولات (القرار 27):
 * ProjectsPage — مشروعات بمستخلصات (PRX) وتكاليف ببنود ومحتجزات وربحية
 * كل قيد يظهر ويربط بالمشروع؛ الإفراج عن المحتجز يقفل المشروع.
 */
import { useMemo, useState } from 'react'
import { Plus, HardHat, Eye, BookOpenText, Banknote, TrendingUp, Receipt, Hammer, Wallet2, FilePlus2, Printer, HandCoins, Pencil, ShoppingCart, Truck, Users2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import type { Project } from '../../core/contracting.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, CHANGE_ORDER_STATUS_LABELS, type CostKind } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { InvoiceDraftsModal } from '../components/InvoiceDraftsModal.tsx'
import { PrePostChecks, type PrePostIssue } from '../components/PrePostChecks.tsx'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { usePrintSwitches } from '../components/PrintSwitches.tsx'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { openSalesInvoiceWindow } from '../windows/windowStore.ts'
import { renderExtractHtml } from '../print/printExtract.ts'
import { printHtml } from '../print/printReceipt.ts'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'

export function ProjectsPage() {
  const {
    projects, projectExtracts, projectCosts, retentionReleases, journal, changeOrders, customers, suppliers, employees, boqItems, costCenters, paymentTerminals, paymentTerminalTransactions,
    addProject, addBoqItem, addProjectExtract, addProjectCost, releaseRetention, getProjectProfit,
    advancedInvoiceDrafts, upsertAdvancedInvoiceDraft, deleteAdvancedInvoiceDraft,
    receiveClientAdvance, getAdvanceBalance, addChangeOrder, setChangeOrderStatus, refundProjectExtract,
    staffCommissions, addStaffCommission, editProjectExtract, sales, purchases,
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
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
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
      setRetention(d.retention ?? '5'); setStartDate(d.startDate ?? new Date().toISOString().slice(0, 10)); setNotes(d.notes ?? '')
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
  /** النسبة السابقة لبند: في التعديل تُقرأ من المستخلص (قبل إصداره) لا من BOQ الحي الذي يحمل نتيجة إصداره */
  const exPrevPct = (b: { id: number; progressPercent: number }) => editingExtract?.lines?.find((l) => l.boqItemId === b.id)?.prevProgressPercent ?? b.progressPercent
  const exLinesPreview = useMemo(() => {
    const rows = extractBoq.map((b) => {
      const prev = editingExtract?.lines?.find((l) => l.boqItemId === b.id)?.prevProgressPercent ?? b.progressPercent
      const raw = exLines[b.id]
      const np = raw === undefined || raw === '' ? null : Number(raw)
      const total = Math.round(b.qty * b.unitPriceMinor)
      const slice = np !== null && Number.isFinite(np) && np > prev && np <= 100 ? Math.round((total * (np - prev)) / 100) : 0
      return { boq: b, prevPercent: prev, newPercent: np, sliceMinor: slice }
    })
    return { rows, grossMinor: rows.reduce((sum, row) => sum + row.sliceMinor, 0) }
  }, [extractBoq, exLines, editingExtract])
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
      dateIso: new Date().toISOString().slice(0, 10),
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

  /* تكلفة */
  const [costFor, setCostFor] = useState<Project | null>(null)
  const [costKind, setCostKind] = useState<CostKind>('materials')
  const [costAmount, setCostAmount] = useState('')
  const [costDesc, setCostDesc] = useState('')
  const [costPayment, setCostPayment] = useState<'cash' | 'credit' | 'mixed'>('cash')
  const [costPaidNow, setCostPaidNow] = useState('')
  const [costSupplierId, setCostSupplierId] = useState(0)
  const [costPaySource, setCostPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [costVat, setCostVat] = useState('')
  const [costCenterId, setCostCenterId] = useState<number | null>(null)

  const saveCost = () => {
    if (!costFor) return
    try {
      const grossMinor = toMinor(costAmount, cur.decimals) + (costVat ? toMinor(costVat, cur.decimals) : 0)
      const paidMinor = costPayment === 'cash' ? grossMinor : costPayment === 'credit' ? 0 : toMinor(costPaidNow || '0', cur.decimals)
      if (grossMinor - paidMinor > 0 && !costSupplierId) throw new Error('الجزء الآجل يتطلب اختيار المورد/مقاول الباطن — ليظهر في كشف حسابه')
      addProjectCost({
        projectId: costFor.id, kind: costKind, amountMinor: toMinor(costAmount, cur.decimals),
        inputVatMinor: costVat ? toMinor(costVat, cur.decimals) : 0,
        payment: costPayment, paidMinor, supplierId: costSupplierId || null, description: costDesc.trim(),
        treasury: costPaySource.kind === 'treasury' ? costPaySource.treasury : undefined,
        custodyFileId: costPayment === 'cash' && costPaySource.kind === 'custody' ? costPaySource.custodyFileId : null,
        costCenterId,
      })
      toast.show('سُجلت التكلفة على المشروع بقيد متوازن ✅')
      setCostFor(null); setCostAmount(''); setCostDesc(''); setCostVat(''); setCostCenterId(null); setCostPaidNow(''); setCostSupplierId(0); setCostPayment('cash')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض */
  const [viewing, setViewing] = useState<Project | null>(null)
  const [refundingExtract, setRefundingExtract] = useState<(typeof projectExtracts)[number] | null>(null)
  // عمولة موظف عن المشروع (تعميم — أمر المالك): مهندس مبيعات جلب العقد مثلاً
  const [commFor, setCommFor] = useState<Project | null>(null)
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
    const previous = projectExtracts
      .filter((e) => e.projectId === ex.projectId && e.id < ex.id)
      .reduce((a, e) => a + e.totals.grossMinor, 0)
    const cumulative = previous + ex.totals.grossMinor
    printHtml(renderExtractHtml({
      shopName: setup.shopName || 'مقاولات',
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
                  <div className="invoice-kpi"><small>قيمة العقد</small><b className="text-emerald-600">{fmt(effectiveContractMinor)} {cur.symbol}</b></div>
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
                  <Field label={`قيمة العقد الإجمالية (${cur.symbol}) *`} hint="لعقود المقطوعية بلا جدول كميات — يمكنك إضافة البنود لاحقاً من «جدول الكميات»">
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
          dateLabel={editingExtract ? editingExtract.date.slice(0, 10) : new Date().toISOString().slice(0, 10)}
          branchLabel={setup.shopName ?? ''}
          userLabel={setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber={editingExtract ? `${editingExtract.extractNumber} (تعديل)` : `PRX-${extractFor.code}`}
          onBack={() => { setEditingExtract(null); setExtractFor(null) }}
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
              <Field label="طبيعة المستخلص">
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-rose-300 dark:border-rose-800 cursor-pointer">
                  <input type="checkbox" checked={exFinal} onChange={(e) => setExFinal(e.target.checked)} className="accent-rose-600" />
                  <span className="text-[12px] font-bold text-rose-600 dark:text-rose-400">ختامي — لا مستخلصات بعده</span>
                </label>
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
              {extractBoq.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-3 border-b border-slate-200 dark:border-slate-700">
                  {([['lines', 'بندي من جدول الكميات'], ['gross', 'مبلغ إجمالي']] as const).map(([m, label]) => (
                    <button key={m} onClick={() => setExMode(m)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${exMode === m ? 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {exMode === 'lines' && extractBoq.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr>
                        <th className="p-2 text-right font-bold">البند</th>
                        <th className="p-2 text-center font-bold">سابق ٪</th>
                        <th className="p-2 text-center font-bold">جديد ٪ (تراكمي)</th>
                        <th className="p-2 text-left font-bold">قيمة الشريحة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exLinesPreview.rows.map(({ boq: b, newPercent, sliceMinor }, idx) => (
                        <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="p-2 font-bold text-slate-700 dark:text-slate-200">{b.code} — {b.descriptionAr}</td>
                          <td className="p-2 text-center text-slate-500">{b.progressPercent}٪</td>
                          <td className="p-2">
                            <input
                              id={idx === 0 ? 'extract-first-percent' : undefined}
                              value={exLines[b.id] ?? ''} inputMode="decimal" placeholder={`${b.progressPercent}`}
                              onChange={(e) => setExLines((s) => ({ ...s, [b.id]: e.target.value }))}
                              className="w-20 mx-auto block text-center rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent py-1 text-[12px] font-bold"
                            />
                            {newPercent !== null && (newPercent < b.progressPercent || newPercent > 100) && (
                              <div className="text-[10px] text-red-500 text-center font-bold mt-0.5">{newPercent > 100 ? 'أقصاها 100' : 'لا تقل عن السابق'}</div>
                            )}
                          </td>
                          <td className="p-2 text-left font-bold tabular-nums text-emerald-600">{sliceMinor > 0 ? fmt(sliceMinor) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-orange-500/10">
                      <tr>
                        <td colSpan={3} className="p-2 font-bold text-orange-700 dark:text-orange-300">إجمالي أعمال هذا المستخلص</td>
                        <td className="p-2 text-left font-black tabular-nums text-orange-700 dark:text-orange-300">{fmt(exLinesPreview.grossMinor)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-4">
                  <Field label={`قيمة الأعمال المنفذة (${cur.symbol}) *`}><input value={exGross} onChange={(e) => setExGross(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><HardHat className="w-6 h-6 text-orange-500" /> مشروعات المقاولات</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> مشروع جديد</Btn>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon="🏗️" title="لا مشروعات بعد" sub="أنشئ مشروعك الأول: عقد بقيمة ونسبة محتجز، ثم سجّل المستخلصات والتكاليف — الربحية تُحسب تلقائياً" />
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
                            <button onClick={() => { setExtractFor(p); setExGross(''); setExDesc(''); setExLines({}); setExMode(boqItems.some((b) => b.projectId === p.id) ? 'lines' : 'gross') }} title="مستخلص جديد" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Receipt className="w-4 h-4" /></button>
                            <button onClick={() => { setCostFor(p); setCostAmount(''); setCostDesc('') }} title="تسجيل تكلفة" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Hammer className="w-4 h-4" /></button>
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



      {/* تكلفة */}
      <Modal open={!!costFor} onClose={() => setCostFor(null)} title={costFor ? `تكلفة على — ${costFor.nameAr}` : ''} subtitle="مستند تكلفة مشروع: بند التكلفة ومصدر سدادها">
        {costFor && (
          <div className="space-y-3">
            <DocSectionHead step="١" title="بند التكلفة وقيمته" hint="كل تكلفة تُنسب لمركز تكلفة المشروع فتظهر في ربحيته" />
            <Field label="بند التكلفة">
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                  <button key={k} onClick={() => setCostKind(k)}
                    className={`py-2 rounded-xl text-[11px] font-bold border transition-all ${costKind === k ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`المبلغ (${cur.symbol}) *`}><input value={costAmount} onChange={(e) => setCostAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="السداد">
                <div className="flex gap-2">
                  {([['cash', 'نقدي'], ['mixed', 'مدفوع + آجل'], ['credit', 'آجل (مورد)']] as const).map(([mode, label]) => (
                    <button key={mode} onClick={() => setCostPayment(mode)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${costPayment === mode ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {costPayment !== 'credit' && <div className="mt-2"><PaySourcePicker value={costPaySource} onChange={setCostPaySource} /></div>}
                {costPayment === 'mixed' && <div className="mt-2"><Field label={`المدفوع الآن (${cur.symbol}) *`} hint="الباقي يُرحَّل على حساب المورد"><input value={costPaidNow} onChange={(e) => setCostPaidNow(e.target.value)} inputMode="decimal" className={inputCls} /></Field></div>}
                {costPayment !== 'cash' && (
                  <div className="mt-2"><Field label="المورد / مقاول الباطن *" hint="الجزء الآجل يظهر في كشف حسابه ويُسدَّد بسند صرف">
                    <PartyQuickPicker parties={suppliers} value={costSupplierId} onChange={setCostSupplierId} cashLabel="اختر المورد" label="بحث المورد" cashValue={0} showCash={false} />
                  </Field></div>
                )}
              </Field>
            </div>
            <Field label="الوصف"><input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} className={inputCls} placeholder="حديد تسليح، أجور نجارين…" /></Field>
            <Field label="مركز التكلفة العام (اختياري)" hint="يبقى المشروع منفصلاً ويمكن تحميل تكلفة المشروع على مركز عام لأغراض التقارير."><QuickSelect value={costCenterId ?? ''} onChange={(e) => setCostCenterId(e.target.value ? Number(e.target.value) : null)} className={inputCls}><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect></Field>
            <Field label={`ض.ق.م مدخلات قابلة للخصم (${cur.symbol}) — اختياري`} hint="للمنشآت المسجلة ضريبياً: تُعزل عن تكلفة المشروع (المبلغ أعلاه صافٍ) فتبقى ربحية المشروع صافية من الضريبة تماماً — غير المسجل يتركها فارغة">
              <input value={costVat} onChange={(e) => setCostVat(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <DocOutcome>الأثر: <b>5110 تكاليف مشروعات مقاولات</b> مديناً بقيمة البند على مركز تكلفة المشروع · <b>2102</b> مديناً بضريبة المدخلات القابلة للخصم · <b>الخزينة</b> دائنة بالمدفوع نقداً و<b>2101 موردون ومقاولون</b> دائناً بالباقي الآجل.</DocOutcome>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCostFor(null)}>إلغاء</Btn>
              <Btn onClick={saveCost} shortcut="F9" disabled={!costAmount}>تسجيل التكلفة</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* التفاصيل */}
      <Modal open={!!viewingLive} onClose={() => setViewing(null)} title={viewingLive ? `${viewingLive.code} — ${viewingLive.nameAr}` : ''} wide>
        {viewingLive && profit && (
          <div className="space-y-4 text-sm">
            <div className="flex justify-end">
              <Btn variant="ghost" data-project-new-invoice onClick={() => openSalesInvoiceWindow(undefined, { projectId: viewingLive.id, customerId: viewingLive.clientId ?? undefined })} title="فاتورة بيع كاملة بنافذة الفاتورة المتقدمة — مربوطة بهذا المشروع وعميله"><ShoppingCart size={14} /> فاتورة بيع لهذا المشروع</Btn>
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
