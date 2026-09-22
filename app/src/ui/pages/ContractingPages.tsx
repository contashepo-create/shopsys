/**
 * صفحات المقاولات (القرار 27):
 * ProjectsPage — مشروعات بمستخلصات (PRX) وتكاليف ببنود ومحتجزات وربحية
 * كل قيد يظهر ويربط بالمشروع؛ الإفراج عن المحتجز يقفل المشروع.
 */
import { useMemo, useState } from 'react'
import { Plus, HardHat, Eye, BookOpenText, Banknote, TrendingUp, Receipt, Hammer, Wallet2, FilePlus2, Printer, HandCoins } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import type { Project } from '../../core/contracting.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, CHANGE_ORDER_STATUS_LABELS, type CostKind } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { TerminalPaymentPicker, type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { renderExtractHtml } from '../print/printExtract.ts'
import { printHtml } from '../print/printReceipt.ts'

export function ProjectsPage() {
  const {
    projects, projectExtracts, projectCosts, retentionReleases, journal, changeOrders, customers, employees, boqItems, paymentTerminals, paymentTerminalTransactions,
    addProject, addBoqItem, addProjectExtract, addProjectCost, releaseRetention, getProjectProfit,
    receiveClientAdvance, getAdvanceBalance, addChangeOrder, setChangeOrderStatus, refundProjectExtract,
    staffCommissions, addStaffCommission,
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

  const saveProject = () => {
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
  const extractBoq = useMemo(() => (extractFor ? boqItems.filter((b) => b.projectId === extractFor.id) : []), [boqItems, extractFor])
  const exLinesPreview = useMemo(() => {
    let sum = 0
    const rows = extractBoq.map((b) => {
      const raw = exLines[b.id]
      const np = raw === undefined || raw === '' ? null : Number(raw)
      const total = Math.round(b.qty * b.unitPriceMinor)
      const slice = np !== null && Number.isFinite(np) && np > b.progressPercent && np <= 100 ? Math.round((total * (np - b.progressPercent)) / 100) : 0
      sum += slice
      return { boq: b, newPercent: np, sliceMinor: slice }
    })
    return { rows, grossMinor: sum }
  }, [extractBoq, exLines])

  // مستخلص آجل فوق حد ائتمان عميل المشروع — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const saveExtract = (creditLimitOverrideBy?: string) => {
    if (!extractFor) return
    try {
      const linesInput = exMode === 'lines'
        ? Object.entries(exLines)
            .filter(([, v]) => v !== '')
            .map(([id, v]) => ({ boqItemId: Number(id), newProgressPercent: Number(v) }))
            .filter((l) => {
              const b = extractBoq.find((x) => x.id === l.boqItemId)
              return b ? l.newProgressPercent > b.progressPercent : false
            })
        : undefined
      const terminal = paymentTerminals.find((row) => row.id === exTerminal.terminalId)
      if (terminal && !exTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
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
      setExtractFor(null); setExGross(''); setExDesc(''); setExRecovery(''); setExLines({}); setExFinal(false)
    } catch (e) {
      if (e instanceof CreditLimitError) { creditApproval.request((by) => saveExtract(by ?? 'المشرف')); return }
      toast.show((e as Error).message, 'error')
    }
  }

  /* تكلفة */
  const [costFor, setCostFor] = useState<Project | null>(null)
  const [costKind, setCostKind] = useState<CostKind>('materials')
  const [costAmount, setCostAmount] = useState('')
  const [costDesc, setCostDesc] = useState('')
  const [costPayment, setCostPayment] = useState<'cash' | 'credit'>('cash')
  const [costPaySource, setCostPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [costVat, setCostVat] = useState('')

  const saveCost = () => {
    if (!costFor) return
    try {
      addProjectCost({
        projectId: costFor.id, kind: costKind, amountMinor: toMinor(costAmount, cur.decimals),
        inputVatMinor: costVat ? toMinor(costVat, cur.decimals) : 0,
        payment: costPayment, description: costDesc.trim(),
        treasury: costPaySource.kind === 'treasury' ? costPaySource.treasury : undefined,
        custodyFileId: costPayment === 'cash' && costPaySource.kind === 'custody' ? costPaySource.custodyFileId : null,
      })
      toast.show('سُجلت التكلفة على المشروع بقيد متوازن ✅')
      setCostFor(null); setCostAmount(''); setCostDesc(''); setCostVat('')
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
      due: `${fmt(ex.totals.dueMinor)} ${cur.symbol}`,
      payment: ex.payment,
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
      if (terminal && !advTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
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
      if (terminal && !releaseTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
      const r = releaseRetention(releaseFor.id, terminal?.settlementAccountCode ?? releaseTreasury, terminal ? { terminalId: terminal.id, providerReference: releaseTerminal.providerReference.trim(), cardLast4: releaseTerminal.cardLast4 || undefined } : undefined)
      toast.show(`أُفرج عن محتجزات ${fmt(r.amount)} ${cur.symbol} وأُقفل المشروع 🎉`)
      setReleaseFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
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

      {/* مشروع جديد — نموذج مقسّم أقساماً (أمر التعديل: نماذج احترافية) */}
      <Modal open={open} onClose={() => setOpen(false)} title="مشروع مقاولات جديد" wide>
        <div className="space-y-4">
          {/* القسم 1: أساسيات العقد */}
          <div className="rounded-2xl border border-orange-500/20 p-4 space-y-3">
            <div className="text-[11.5px] font-black text-orange-600 dark:text-orange-400">📋 بيانات العقد الأساسية</div>
            <Field label="اسم المشروع *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="فيلا الشيخ زايد…" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="رقم العقد الرسمي"><input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} className={inputCls} dir="ltr" placeholder="CT-2026-014" /></Field>
              <Field label="محتجز ضمان الأعمال ٪" hint="يُخصم من كل مستخلص ويُفرج عنه عند التسليم"><input value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            </div>
          </div>
          {/* القسم: جدول الكميات BOQ — قيمة العقد من البنود (النمط العالمي — طلب المالك) */}
          <div className="rounded-2xl border border-emerald-500/25 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11.5px] font-black text-emerald-600 dark:text-emerald-400">📐 قيمة العقد وجدول الكميات</div>
              <div className="flex gap-1.5">
                {([['boq', 'بنود جدول كميات (مُوصى به)'], ['manual', 'قيمة إجمالية']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setValueMode(m)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${valueMode === m ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {valueMode === 'manual' ? (
              <Field label={`قيمة العقد الإجمالية (${cur.symbol}) *`} hint="لعقود المقطوعية بلا جدول كميات — يمكنك إضافة البنود لاحقاً من «جدول الكميات»">
                <input value={contractValue} onChange={(e) => setContractValue(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">كل بند بخانات مسماة — قيمة العقد تُحسب تلقائياً من مجموع (الكمية × سعر الوحدة)</p>
                {boqDraft.map((l, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                    <Field label="كود البند"><input value={l.code} onChange={(e) => patchBoqLine(i, { code: e.target.value })} className={inputCls} dir="ltr" placeholder={String(i + 1)} /></Field>
                    <div className="col-span-2"><Field label="وصف البند *"><input value={l.descriptionAr} onChange={(e) => patchBoqLine(i, { descriptionAr: e.target.value })} className={inputCls} placeholder="أعمال حفر وردم…" /></Field></div>
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
          {/* القسم 2: العميل */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="text-[11.5px] font-black text-slate-500">👤 العميل / الجهة المالكة</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="اسم العميل / الجهة"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
              <Field label="ربط بسجل عميل (إداري)" hint="للمتابعة والتحصيل فقط — لا يؤثر على رصيده؛ الذمة من المستخلص/الفاتورة">
                <select value={clientId} onChange={(e) => { setClientId(e.target.value); const c = customers.find((x) => x.id === Number(e.target.value)); if (c && !clientName.trim()) setClientName(c.nameAr) }} className={inputCls}>
                  <option value="">— بلا ربط —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                </select>
              </Field>
            </div>
          </div>
          {/* القسم 3: التنفيذ والجدولة */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="text-[11.5px] font-black text-slate-500">🗓️ التنفيذ والجدولة والفريق</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="تاريخ البدء"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
              <Field label="التسليم المتوقع"><input type="date" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} className={inputCls} /></Field>
              <Field label="مدير المشروع" hint="من سجل الموظفين">
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputCls}>
                  <option value="">— لاحقاً —</option>
                  {employees.filter((em) => em.active).map((em) => <option key={em.id} value={em.id}>{em.nameAr}</option>)}
                </select>
              </Field>
              <Field label="موقع التنفيذ"><input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="المنصورة — حي الجامعة" /></Field>
              <Field label="وسوم (افصل بـ ،)"><input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="حكومي، تشطيبات" /></Field>
              <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveProject} disabled={!nameAr.trim() || (valueMode === 'manual' ? !contractValue : validBoqLines.length === 0)}>إنشاء المشروع</Btn>
          </div>
        </div>
      </Modal>

      {/* مستخلص */}
      <Modal open={!!extractFor} onClose={() => setExtractFor(null)} title={extractFor ? `مستخلص جديد — ${extractFor.nameAr}` : ''}>
        {extractFor && (
          <div className="space-y-3">
            {extractBoq.length > 0 && (
              <div className="flex gap-2">
                {([['lines', 'بندي من جدول الكميات'], ['gross', 'مبلغ إجمالي']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setExMode(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${exMode === m ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {exMode === 'lines' && extractBoq.length > 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
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
                    {exLinesPreview.rows.map(({ boq: b, newPercent, sliceMinor }) => (
                      <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 font-bold text-slate-700 dark:text-slate-200">{b.code} — {b.descriptionAr}</td>
                        <td className="p-2 text-center text-slate-500">{b.progressPercent}٪</td>
                        <td className="p-2">
                          <input
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
              <Field label={`قيمة الأعمال المنفذة (${cur.symbol}) *`}><input value={exGross} onChange={(e) => setExGross(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            )}
            <Field label="وصف الأعمال"><input value={exDesc} onChange={(e) => setExDesc(e.target.value)} className={inputCls} placeholder="أعمال الأساسات…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="التحصيل">
                <div className="flex gap-2">
                  {(['credit', 'cash'] as const).map((p) => (
                    <button key={p} onClick={() => setExPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${exPayment === p ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي فوري' : 'آجل (مستحق)'}
                    </button>
                  ))}
                </div>
                {exPayment === 'cash' && <div className="mt-2 space-y-2"><TerminalPaymentPicker value={exTerminal} onChange={setExTerminal}/>{!exTerminal.terminalId && <TreasuryPicker value={exTreasury} onChange={setExTreasury} compact />}</div>}
              </Field>
              <Field label="الضريبة">
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                  <input type="checkbox" checked={exVat} onChange={(e) => setExVat(e.target.checked)} className="accent-orange-600" />
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
                </label>
              </Field>
            </div>
            {getAdvanceBalance(extractFor.id) > 0 && (
              <Field label={`استرداد من الدفعة المقدمة (رصيدها ${fmt(getAdvanceBalance(extractFor.id))})`} hint="يخصم من مستحق هذا المستخلص ويطفئ التزام 2109">
                <input value={exRecovery} onChange={(e) => setExRecovery(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0 = لا استرداد" />
              </Field>
            )}
            <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3 text-[12px] font-bold text-orange-700 dark:text-orange-300">
              يُخصم محتجز {extractFor.retentionPercent}٪ تلقائياً ويقيد على 1105 حتى التسليم النهائي
            </div>
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 cursor-pointer">
              <input type="checkbox" checked={exFinal} onChange={(e) => setExFinal(e.target.checked)} className="accent-rose-600" />
              <span className="text-[12px] font-bold text-rose-600 dark:text-rose-400">مستخلص ختامي — لا مستخلصات بعده (يمهد للتسليم والإفراج عن المحتجز)</span>
            </label>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setExtractFor(null)}>إلغاء</Btn>
              <Btn onClick={saveExtract} disabled={exMode === 'lines' ? exLinesPreview.grossMinor <= 0 : !exGross}>تسجيل المستخلص وقيده</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* تكلفة */}
      <Modal open={!!costFor} onClose={() => setCostFor(null)} title={costFor ? `تكلفة على — ${costFor.nameAr}` : ''}>
        {costFor && (
          <div className="space-y-3">
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
                  {(['cash', 'credit'] as const).map((p) => (
                    <button key={p} onClick={() => setCostPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${costPayment === p ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي' : 'آجل (مورد)'}
                    </button>
                  ))}
                </div>
                {costPayment === 'cash' && <div className="mt-2"><PaySourcePicker value={costPaySource} onChange={setCostPaySource} /></div>}
              </Field>
            </div>
            <Field label="الوصف"><input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} className={inputCls} placeholder="حديد تسليح، أجور نجارين…" /></Field>
            <Field label={`ض.ق.م مدخلات قابلة للخصم (${cur.symbol}) — اختياري`} hint="للمنشآت المسجلة ضريبياً: تُعزل عن تكلفة المشروع (المبلغ أعلاه صافٍ) فتبقى ربحية المشروع صافية من الضريبة تماماً — غير المسجل يتركها فارغة">
              <input value={costVat} onChange={(e) => setCostVat(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCostFor(null)}>إلغاء</Btn>
              <Btn onClick={saveCost} disabled={!costAmount}>تسجيل التكلفة</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* التفاصيل */}
      <Modal open={!!viewingLive} onClose={() => setViewing(null)} title={viewingLive ? `${viewingLive.code} — ${viewingLive.nameAr}` : ''} wide>
        {viewingLive && profit && (
          <div className="space-y-4 text-sm">
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
                          <button onClick={() => printExtract(e)} title="طباعة المستخلص للجهة المالكة" className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all"><Printer size={13} /></button>
                          <button onClick={() => setRefundingExtract(e)} title="إشعار دائن (رفض جزء من الأعمال بعد الاعتماد)" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all text-[12px] font-black">↩️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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
      <Modal open={!!advanceFor} onClose={() => setAdvanceFor(null)} title={advanceFor ? `دفعة مقدمة — ${advanceFor.nameAr}` : ''}>
        {advanceFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-sky-500/5 rounded-xl p-3">
              الدفعة المقدمة التزام (2109) لا إيراد — لأن الأعمال لم تُنفَّذ بعد. تُسترد تدريجياً من المستخلصات القادمة.
              {getAdvanceBalance(advanceFor.id) > 0 && <> الرصيد الحالي: <b>{fmt(getAdvanceBalance(advanceFor.id))}</b></>}
            </div>
            <Field label={`قيمة الدفعة (${cur.symbol})`}><input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="طريقة التحصيل"><div className="space-y-2"><TerminalPaymentPicker value={advTerminal} onChange={setAdvTerminal}/>{!advTerminal.terminalId && <TreasuryPicker value={advTreasury} onChange={setAdvTreasury} />}</div></Field>
            <Btn onClick={saveAdvance} className="w-full" disabled={!advAmount}>استلام الدفعة</Btn>
          </div>
        )}
      </Modal>

      {/* أمر تغيير */}
      <Modal open={!!coFor} onClose={() => setCoFor(null)} title={coFor ? `أمر تغيير — ${coFor.nameAr}` : ''}>
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
            <Btn onClick={saveChangeOrder} className="w-full" disabled={!coTitle.trim() || !coAmount}>إنشاء أمر التغيير (مسودة)</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!releaseFor} onClose={() => setReleaseFor(null)} title={releaseFor ? `الإفراج عن محتجزات ${releaseFor.nameAr}` : ''}>
        {releaseFor && (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 text-[13px] font-bold text-amber-700 dark:text-amber-300">
              سيُحصَّل المحتجز المتبقي {fmt(getProjectProfit(releaseFor.id).retentionHeldMinor)} {cur.symbol} ويُقفل المشروع نهائياً.
            </div>
            <Field label="طريقة التحصيل"><div className="space-y-2"><TerminalPaymentPicker value={releaseTerminal} onChange={setReleaseTerminal}/>{!releaseTerminal.terminalId && <TreasuryPicker value={releaseTreasury} onChange={setReleaseTreasury} compact />}</div></Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setReleaseFor(null)}>إلغاء</Btn>
              <Btn onClick={doRelease}>🏁 تحصيل وإقفال</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* إشعار دائن على مستخلص (مراجعة المرتجعات) */}
      <Modal open={!!refundingExtract} onClose={() => setRefundingExtract(null)} title={refundingExtract ? `إشعار دائن — ${refundingExtract.extractNumber}` : ''}>
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
      </Modal>
      {/* 🤝 عمولة موظف عن المشروع (تعميم أمر المالك) */}
      <Modal open={!!commFor} onClose={() => setCommFor(null)} title={commFor ? `🤝 عمولة موظف — ${commFor.code}` : ''}>
        {commFor && (
          <div className="space-y-3">
            {staffCommissions.filter((c) => c.source === 'project' && c.sourceId === commFor.id && c.status !== 'cancelled').map((c) => (
              <div key={c.id} className="rounded-xl bg-violet-500/10 border border-violet-500/25 p-3 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                {c.code} — {employees.find((e) => e.id === c.employeeId)?.nameAr}: {fmt(c.amountMinor)} ({c.status === 'paid' ? 'مصروفة ✓' : 'مستحقة ⏳'})
              </div>
            ))}
            <Field label="الموظف *">
              <select value={commEmpId} onChange={(e) => setCommEmpId(e.target.value)} className={inputCls}>
                <option value="">— اختر الموظف —</option>
                {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
              </select>
            </Field>
            <Field label={`مبلغ العمولة (${cur.symbol}) *`}>
              <input value={commAmount} onChange={(e) => setCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <div className="text-[11px] text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 leading-relaxed">
              💡 استحقاق فوري: مصروف عمولات (5117) ← مستحقة (2116) — مربوطة بالمشروع وتدخل ربحية الفترة، والصرف من شاشة الموظفين.
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCommFor(null)}>إغلاق</Btn>
              <Btn onClick={saveProjectCommission} disabled={!commEmpId || !commAmount.trim()}>💾 استحقاق العمولة</Btn>
            </div>
          </div>
        )}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}
