import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * عقود إيجار المعدات (المرحلة 6 — القرار 13):
 * فتح عقد (أيام × سعر يومي + تأمين مسترد + ضريبة فوق السعر) بقيد فتح
 * متوازن (4104/2102/2103)، وإقفال بردّ التأمين مع خصم أضرار اختياري
 * يُعترف به إيراداً. تقرير بالفترات + التأمينات المحتجزة.
 */
import { useMemo, useState } from 'react'
import { Plus, FileSpreadsheet, BookOpenText, LockKeyhole, TrendingUp, Printer, ReceiptText, CalendarClock, FolderKanban, Fuel } from 'lucide-react'
import { useDataStore, type RentalContract } from '../../data/repo.ts'
import { SignaturePad } from '../components/SignaturePad.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  computeRentalTotals, rentalReport, utilizationReport, isRentalOverdue, rentalExpectedEnd, rentalInvoiceDoc,
  DEFAULT_RENTAL_RESPONSIBILITY, RENTAL_RESPONSIBILITY_LABELS, EXPENSE_BEARER_LABELS, COST_LAYER_LABELS,
  type RentalPaymentMode, type RentalBillingMode, type RentalResponsibilityMatrix, type ExpenseBearer, type EquipmentCostLayer, type RentalInvoice,
} from '../../core/rental.ts'
import { isDriverEmployee } from '../../core/jobTitles.ts'
import { renderRentalContractHtml } from '../print/printRentalContract.ts'
import { printHtml } from '../print/printReceipt.ts'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { usePrintSwitches } from '../hooks/usePrintSwitches.ts'
import { RATE_TYPE_LABELS, EQUIPMENT_COST_LABELS, type RateType, type EquipmentCostKind } from '../../core/rentalMeter.ts'
import { periodPresets, type Period } from '../../core/reports.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'

export function RentalContractsPage() {
  const {
    rentalContracts, rentalInvoices, equipment, equipmentCosts, employees, customers, journal,
    paymentTerminals, paymentTerminalTransactions,
    openRental, issueRentalInvoice, addEquipmentCost, closeRental, refundRental, getCustomerBalance,
    setRentalSignature, createInstallmentPlan,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custName = (id: number | null) => (id == null ? 'عميل نقدي' : customers.find((c) => c.id === id)?.nameAr ?? '—')
  const activeEmployees = useMemo(
    () => [...employees.filter((e) => e.active !== false)].sort((a, b) => Number(isDriverEmployee(b)) - Number(isDriverEmployee(a))),
    [employees],
  )

  /** طباعة عقد الإيجار (جولة إيجار المعدات): ورقة A4 بطرفين وبنود وتوقيعين ومصفوفة تحمل المصاريف */
  const printContract = (c: RentalContract) => {
    const cust = customers.find((x) => x.id === c.customerId)
    const eq = equipment.find((x) => x.id === c.equipmentId)
    const drv = employees.find((x) => x.id === c.driverEmployeeId)
    const rt = c.rateType ?? 'daily'
    printHtml(renderRentalContractHtml({
      shopName: setup.shopName || 'تأجير معدات',
      shopPhone: '',
      contractNumber: c.contractNumber,
      dateIso: c.date,
      customerName: cust?.nameAr ?? 'عميل نقدي',
      customerPhone: cust?.phone ?? '',
      equipmentName: c.equipmentName,
      equipmentCode: eq?.code ?? '',
      units: c.days,
      unitLabel: RATE_TYPE_LABELS[rt].unitAr,
      unitRate: `${fmt(c.dailyRateMinor)} ${cur.symbol}`,
      rentTotal: `${fmt(c.totals.rentMinor)} ${cur.symbol}`,
      vat: c.totals.vatMinor > 0 ? `${fmt(c.totals.vatMinor)} ${cur.symbol}` : '',
      deposit: c.totals.depositMinor > 0 ? `${fmt(c.totals.depositMinor)} ${cur.symbol}` : '',
      paymentLabel: c.billingMode === 'reference' ? 'عقد مرجعي — الفوترة دورية' : c.payment === 'cash' ? 'نقدي بالكامل' : c.payment === 'credit' ? 'آجل بالكامل' : 'مدفوع + آجل',
      paidRent: c.billingMode === 'reference' ? undefined : `${fmt(c.totals.grandMinor - c.totals.collectCreditMinor)} ${cur.symbol}`,
      dueRent: c.billingMode === 'reference' ? undefined : `${fmt(c.totals.collectCreditMinor)} ${cur.symbol}`,
      startReading: c.startReading,
      expectedEnd: rentalExpectedEnd(c.date, c.days, rt),
      notes: c.notes,
      billingMode: c.billingMode,
      driverName: drv?.nameAr,
      responsibility: c.responsibility,
    }))
  }

  const [tab, setTab] = usePersistedSectionView('rental-contracts', 'list', ['list', 'report'] as const)

  /* ─── فاتورة إيجار للعميل (طلب المالك): وثيقة استحقاق بشكل فاتورة البيع يسدّد منها المستأجر ─── */
  const printSwitches = usePrintSwitches()
  const printPeriodicInvoice = (inv: RentalInvoice, c: RentalContract, templateHint?: InvoiceTemplate) => {
    const template: InvoiceTemplate = templateHint ?? (printSwitches.cashierPrint ? 'thermal' : 'a4')
    const rt = c.rateType ?? 'daily'
    const unitAr = RATE_TYPE_LABELS[rt].unitAr
    const paid = inv.payment === 'cash' ? inv.totalMinor : inv.paidNowMinor
    const due = inv.totalMinor - paid
    const model = buildSimpleDocModel({
      docTitle: inv.vatMinor > 0 ? 'فاتورة إيجار دورية (ضريبية)' : 'فاتورة إيجار دورية (بدون ضريبة)',
      invoiceNumber: inv.invoiceNumber,
      refCode: c.contractNumber,
      dateIso: inv.date.slice(0, 10),
      partyLabel: inv.customerName || custName(c.customerId),
      paymentLabel: due > 0 ? `آجل على العميل — المتبقي: ${fmt(due)} ${cur.symbol}` : 'مسدَّدة بالكامل',
      rows: [{
        nameAr: `إيجار ${c.equipmentName} — ${inv.periodLabel} (${inv.qty} ${unitAr})`,
        qty: inv.qty,
        unitPriceMinor: inv.unitRateMinor,
        totalMinor: inv.netMinor,
      }],
      totalMinor: inv.totalMinor,
      paidMinor: paid,
      operatorName: setup.ownerName ?? 'المالك',
      settings: useAppStore.getState().receipt,
      tax: inv.vatMinor > 0 ? { label: `ض.ق.م (${inv.vatPercent}٪)`, minor: inv.vatMinor, baseMinor: inv.netMinor } : undefined,
      extraFooter: [
        `عقد مرجعي: ${c.contractNumber}`,
        inv.vatMinor > 0 ? `شامل ضريبة ${inv.vatPercent}٪` : 'فاتورة بدون ضريبة (0٪)',
        inv.notes || '',
      ].filter(Boolean).join(' · ') || undefined,
    })
    const live = useAppStore.getState().receipt
    if (!printSwitches.silentPrint) {
      openPrintPreview({
        html: buildModelHtml(model, cur, live, template),
        wide: template !== 'thermal',
        title: `فاتورة إيجار دورية ${inv.invoiceNumber} — ${c.contractNumber}`,
        rebuild: () => { const r = useAppStore.getState().receipt; return buildModelHtml(model, cur, r, template) },
      })
      return
    }
    printModelWithTemplate(model, cur, live, template)
  }
  const printInvoice = (c: RentalContract, templateHint?: InvoiceTemplate, forceTaxMode?: 'with_tax' | 'without_tax') => {
    const doc = rentalInvoiceDoc(c)
    const template: InvoiceTemplate = templateHint ?? (printSwitches.cashierPrint ? 'thermal' : 'a4')
    const showTax = forceTaxMode === 'with_tax' ? true : forceTaxMode === 'without_tax' ? false : c.vatPercent > 0
    const effVatPct = showTax ? (c.vatPercent || setup.vatPercent || 14) : 0
    const baseNet = c.totals.rentMinor + c.extraMinor
    const effVatMinor = showTax ? Math.round((baseNet * effVatPct) / 100) : 0
    const effTotalMinor = baseNet + effVatMinor
    const effPaidMinor = Math.min(effTotalMinor, doc.paidMinor)
    const effDueMinor = Math.max(0, effTotalMinor - effPaidMinor)
    const dueLabel = effDueMinor > 0
      ? `المتبقي على العميل: ${fmt(effDueMinor)} ${cur.symbol} — يُسدَّد من سند قبض / تحصيل العقد ${c.contractNumber}`
      : 'مسدَّد بالكامل — شكراً لتعاملكم'
    const model = buildSimpleDocModel({
      docTitle: showTax ? 'فاتورة إيجار معدات (بالضريبة)' : 'فاتورة إيجار معدات (بدون ضريبة)',
      invoiceNumber: c.contractNumber,
      refCode: `RC-${c.id}`,
      dateIso: c.date.slice(0, 10),
      partyLabel: custName(c.customerId),
      paymentLabel: dueLabel,
      rows: doc.rows.map((r) => ({ nameAr: r.nameAr, qty: r.qty, unitPriceMinor: r.unitPriceMinor, totalMinor: Math.round(r.qty * r.unitPriceMinor) })),
      totalMinor: effTotalMinor,
      paidMinor: effPaidMinor,
      operatorName: setup.ownerName ?? 'المالك',
      settings: useAppStore.getState().receipt,
      tax: effVatMinor > 0 ? { label: `ض.ق.م (${effVatPct}٪)`, minor: effVatMinor, baseMinor: baseNet } : undefined,
      extraFooter: [
        ...(c.totals.depositMinor > 0 ? [`تأمين محتجز (يُرَدّ عند الإقفال بعد خصم الأضرار): ${fmt(c.totals.depositMinor)} ${cur.symbol} — التزام مستقل لا يدخل استحقاق هذه الفاتورة`] : []),
        showTax ? `ض.ق.م ${effVatPct}٪ ضمن الإجمالي` : 'فاتورة صادرة بدون ضريبة (0٪)',
        ...(c.notes ? [c.notes] : []),
      ].join(' · ') || undefined,
    })
    const live = useAppStore.getState().receipt
    if (!printSwitches.silentPrint) {
      openPrintPreview({
        html: buildModelHtml(model, cur, live, template),
        wide: template !== 'thermal',
        title: template !== 'thermal' ? `فاتورة إيجار ${c.contractNumber} — ${c.equipmentName}` : 'إيصال إيجار',
        rebuild: () => { const r = useAppStore.getState().receipt; return buildModelHtml(model, cur, r, template) },
      })
      return
    }
    printModelWithTemplate(model, cur, live, template)
  }

  /* ─── فتح عقد ─── */
  const [open, setOpen] = useState(false)
  const [billingMode, setBillingMode] = useState<RentalBillingMode>('reference')
  const [customerId, setCustomerId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [equipmentName, setEquipmentName] = useState('')
  const [driverEmployeeId, setDriverEmployeeId] = useState<number>(0)
  const [responsibility, setResponsibility] = useState<RentalResponsibilityMatrix>(() => ({ ...DEFAULT_RENTAL_RESPONSIBILITY }))
  const [days, setDays] = useState('1')
  const [dailyRate, setDailyRate] = useState('')
  const [deposit, setDeposit] = useState('')
  const [payment, setPayment] = useState<RentalPaymentMode>('cash')
  const [paidRent, setPaidRent] = useState('')
  const [treasury, setTreasury] = useState('1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [withVat, setWithVat] = useState(false)
  const [notes, setNotes] = useState('')
  // ترقية القرار 25: نوع العقد الزمني + قراءة عدّاد التسليم للساعي
  const [rateType, setRateType] = useState<RateType>('daily')
  const [startReading, setStartReading] = useState('')
  // توثيق حالة المعدة عند التسليم وموقعها (سد فجوة تقرير النشاط #8 — Immediate #4 / Future #2)
  const [deliveryConditionNote, setDeliveryConditionNote] = useState('')
  const [siteName, setSiteName] = useState('')

  /* ─── إصدار فاتورة دورية لعقد ─── */
  const [invForContract, setInvForContract] = useState<RentalContract | null>(null)
  const [invPeriodLabel, setInvPeriodLabel] = useState('')
  const [invQty, setInvQty] = useState('1')
  const [invRate, setInvRate] = useState('')
  const [invWithTax, setInvWithTax] = useState(false)
  const [invPayment, setInvPayment] = useState<RentalPaymentMode>('credit')
  const [invPaidNow, setInvPaidNow] = useState('')
  const [invTreasury, setInvTreasury] = useState('1101')
  const [invNotes, setInvNotes] = useState('')

  /* ─── تسجيل مصروف معدة مباشر داخل ملف العقد ─── */
  const [dossierCostKind, setDossierCostKind] = useState<EquipmentCostKind>('fuel')
  const [dossierCostLayer, setDossierCostLayer] = useState<EquipmentCostLayer>('direct')
  const [dossierCostBorneBy, setDossierCostBorneBy] = useState<ExpenseBearer>('owner')
  const [dossierCostAmount, setDossierCostAmount] = useState('')
  const [dossierCostDesc, setDossierCostDesc] = useState('')
  const [dossierCostTreasury] = useState('1101')

  const openPeriodicInvoiceModal = (c: RentalContract) => {
    const seq = rentalInvoices.filter((x) => x.contractId === c.id).length + 1
    const rt = c.rateType ?? 'daily'
    setInvForContract(c)
    setInvPeriodLabel(rt === 'monthly' ? `الشهر رقم ${seq}` : `الدفعة الدورية رقم ${seq}`)
    setInvQty(rt === 'monthly' ? '1' : String(c.days || 1))
    setInvRate(formatMinor(c.dailyRateMinor, cur, false).replace(/,/g, ''))
    setInvWithTax(c.withTax ?? c.vatPercent > 0)
    setInvPayment(c.customerId != null ? 'credit' : 'cash')
    setInvPaidNow('')
    setInvTreasury('1101')
    setInvNotes('')
  }

  const savePeriodicInvoice = () => {
    if (!invForContract) return
    try {
      const qty = Number(invQty) || 1
      const unitRateMinor = toM(invRate)
      const inv = issueRentalInvoice({
        contractId: invForContract.id,
        periodLabel: invPeriodLabel.trim() || `دفعة دورية`,
        qty,
        unitRateMinor,
        withTax: invWithTax,
        vatPercent: invWithTax ? (invForContract.vatPercent || setup.vatPercent || 14) : 0,
        payment: invPayment,
        paidNowMinor: invPayment === 'mixed' ? toM(invPaidNow) : undefined,
        treasury: invTreasury,
        notes: invNotes.trim() || undefined,
      })
      toast.show(`أُصدرت فاتورة الإيجار الدورية ${inv.invoiceNumber} (${fmt(inv.totalMinor)} ${cur.symbol}) وحُفظت في ملف العقد ${invForContract.contractNumber} ✅`)
      setInvForContract(null)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const openNew = () => {
    setBillingMode('reference')
    setCustomerId(''); setEquipmentId(''); setEquipmentName(''); setDriverEmployeeId(0)
    setResponsibility({ ...DEFAULT_RENTAL_RESPONSIBILITY })
    setDays('1')
    setDailyRate(''); setDeposit(''); setPayment('cash'); setPaidRent(''); setWithVat(false); setNotes('')
    setTreasury('1101'); setTerminalPayment({ terminalId: '', providerReference: '', cardLast4: '' })
    setRateType('daily'); setStartReading(''); setDeliveryConditionNote(''); setSiteName(''); setOpen(true)
  }
  /** سعر الوحدة من سجل المعدة حسب نوع العقد */
  const rateFor = (eq: (typeof equipment)[number] | undefined, rt: RateType) => {
    if (!eq) return 0
    return rt === 'hourly' ? eq.hourlyRateMinor : rt === 'monthly' ? eq.monthlyRateMinor : eq.dailyRateMinor
  }
  const pickEquipment = (v: string) => {
    setEquipmentId(v)
    const eq = equipment.find((x) => x.id === Number(v))
    if (eq) {
      setEquipmentName(eq.nameAr)
      if (eq.driverEmployeeId) setDriverEmployeeId(eq.driverEmployeeId)
      const r = rateFor(eq, rateType)
      if (r > 0) setDailyRate(formatMinor(r, cur, false).replace(/,/g, ''))
      if (rateType === 'hourly') setStartReading(String(eq.meterReading || ''))
    }
  }
  const pickRateType = (rt: RateType) => {
    setRateType(rt)
    const eq = equipment.find((x) => x.id === Number(equipmentId))
    const r = rateFor(eq, rt)
    if (r > 0) setDailyRate(formatMinor(r, cur, false).replace(/,/g, ''))
    if (rt === 'hourly' && eq) setStartReading(String(eq.meterReading || ''))
  }
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)
  const draftInput = useMemo(() => ({
    equipmentName,
    days: Number(days) || 0,
    dailyRateMinor: toM(dailyRate),
    depositMinor: toM(deposit),
    payment,
    paidMinor: payment === 'cash' ? undefined : payment === 'credit' ? 0 : toM(paidRent),
    vatPercent: withVat ? setup.vatPercent : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [equipmentName, days, dailyRate, deposit, payment, paidRent, withVat, setup.vatPercent, cur.decimals])
  const draftTotals = useMemo(() => {
    try { return computeRentalTotals(draftInput) } catch { return null }
  }, [draftInput])

  // إيجار آجل فوق حد ائتمان العميل — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const save = (creditLimitOverrideBy?: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === terminalPayment.terminalId)
      const c = openRental({
        customerId: customerId ? Number(customerId) : null,
        equipmentId: equipmentId ? Number(equipmentId) : null,
        input: draftInput,
        notes: notes.trim(),
        rateType,
        startReading: rateType === 'hourly' && startReading.trim() !== '' ? Number(startReading) : null,
        treasury: terminal?.settlementAccountCode ?? treasury,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
        deliveryConditionNote: deliveryConditionNote.trim() || undefined,
        siteName: siteName.trim() || undefined,
        billingMode,
        withTax: withVat,
        driverEmployeeId: driverEmployeeId || null,
        responsibility,
      })
      toast.show(
        billingMode === 'reference'
          ? `فُتح العقد المرجعي ${c.contractNumber} — يمكنك الآن إصدار الفواتير الدورية من ملف العقد ✅`
          : `فُتح العقد ${c.contractNumber} — يُقبض الآن ${fmt(c.totals.collectCashMinor)} ${cur.symbol} ✅`
      )
      setOpen(false)
    } catch (err) {
      if (err instanceof CreditLimitError) { creditApproval.request((by) => save(by ?? 'المشرف')); return }
      toast.show((err as Error).message, 'error')
    }
  }

  /* ─── إقفال عقد ─── */
  const [closing, setClosing] = useState<RentalContract | null>(null)
  const [deduct, setDeduct] = useState('')
  const [endReading, setEndReading] = useState('')
  const [endDate, setEndDate] = useState('')
  const [closeTreasury, setCloseTreasury] = useState('1101')
  const [returnConditionNote, setReturnConditionNote] = useState('')
  const doClose = () => {
    if (!closing) return
    try {
      const usage =
        closing.rateType === 'hourly'
          ? { endReading: Number(endReading) }
          : endDate
            ? { endDate }
            : undefined
      const c = closeRental(closing.id, toM(deduct), usage, closeTreasury, returnConditionNote.trim() || undefined)
      const refund = c.totals.depositMinor - c.deductMinor
      const extraMsg = c.extraMinor > 0 ? ` — تجاوز استخدام ${fmt(c.extraMinor)} ${cur.symbol} بقيد منفصل` : ''
      toast.show(`أُقفل العقد ${c.contractNumber}${c.totals.depositMinor > 0 ? ` — يُرَدّ للعميل ${fmt(refund)} ${cur.symbol}` : ''}${extraMsg} ✅`)
      setClosing(null); setDeduct(''); setEndReading(''); setEndDate(''); setReturnConditionNote('')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض عقد (ملف العقد الشامل — Contract Dossier) ─── */
  const [viewing, setViewing] = useState<RentalContract | null>(null)
  const viewInvoices = useMemo(
    () => (viewing ? rentalInvoices.filter((inv) => inv.contractId === viewing.id) : []),
    [viewing, rentalInvoices],
  )
  const viewCosts = useMemo(
    () => (viewing ? equipmentCosts.filter((cost) => cost.contractId === viewing.id) : []),
    [viewing, equipmentCosts],
  )
  const viewEntries = useMemo(() => {
    if (!viewing) return []
    const invEntryIds = new Set(viewInvoices.map((inv) => inv.journalEntryId))
    const costEntryIds = new Set(viewCosts.map((cost) => cost.journalEntryId))
    return journal.filter(
      (e) =>
        e.id === viewing.openEntryId ||
        e.id === viewing.closeEntryId ||
        e.id === viewing.extraEntryId ||
        invEntryIds.has(e.id) ||
        costEntryIds.has(e.id) ||
        (viewing.refunds ?? []).some((r) => r.journalEntryId === e.id),
    )
  }, [viewing, viewInvoices, viewCosts, journal])
  // توقيع رقمي عند التسليم/الإرجاع (سد فجوة تقرير النشاط #8 — Immediate #4)
  const [signing, setSigning] = useState<'delivery' | 'return' | null>(null)

  /* ─── جدولة المتبقي الآجل كأقساط مباشرة من العقد (سد فجوة تقرير النشاط #8 — Immediate #2) ─── */
  const [installmentFor, setInstallmentFor] = useState<RentalContract | null>(null)
  const [insCount, setInsCount] = useState('3')
  const [insIntervalMonths, setInsIntervalMonths] = useState('1')
  const [insFirstDue, setInsFirstDue] = useState('')
  const [insTreasury, setInsTreasury] = useState('1101')
  const openInstallmentFor = (c: RentalContract) => {
    setInstallmentFor(c); setInsCount('3'); setInsIntervalMonths('1')
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setInsFirstDue(d.toISOString().slice(0, 10)); setInsTreasury('1101'); setSigning(null)
  }
  const saveInstallment = () => {
    if (!installmentFor || installmentFor.customerId == null) return
    try {
      const plan = createInstallmentPlan({
        customerId: installmentFor.customerId,
        saleId: null,
        totalMinor: installmentFor.totals.collectCreditMinor,
        downPaymentMinor: 0,
        count: Math.max(1, Number(insCount) || 1),
        intervalMonths: Math.max(1, Number(insIntervalMonths) || 1),
        firstDueDate: insFirstDue,
        treasury: insTreasury,
        notes: `جدولة إيجار العقد ${installmentFor.contractNumber} — ${installmentFor.equipmentName}`,
      })
      toast.show(`أُنشئت خطة الأقساط ${plan.planNumber} من عقد الإيجار ✅`)
      setInstallmentFor(null)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── تقرير ─── */
  const presets = useMemo(() => periodPresets(new Date().toISOString()), [])
  const [presetId, setPresetId] = useState('month')
  const period: Period = presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  const report = useMemo(() => rentalReport(rentalContracts, period), [rentalContracts, period])
  // معدل الاستغلال (Point of Rental): نسبة أيام التأجير من الفترة لكل معدة — الراكد يظهر فوراً
  const utilization = useMemo(() => utilizationReport(rentalContracts, equipment, period), [rentalContracts, equipment, period])

  const listed = useMemo(() => [...rentalContracts].reverse(), [rentalContracts])
  const tabCls = (t: 'list' | 'report') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-teal-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><FileSpreadsheet size={14} className="inline -mt-0.5 me-1" /> العقود ({rentalContracts.length})</button>
          <button onClick={() => setTab('report')} className={tabCls('report')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> تقرير الإيجارات</button>
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> عقد جديد</span></Btn>
      </div>

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🚜" title="لا عقود بعد" sub="كل عقد يُفتح بقيد متوازن: إيراد إيجار / ضريبة / تأمين كالتزام يُردّ عند الإقفال" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">العقد</th>
                  <th className="px-4 py-3 text-right font-bold">المعدة</th>
                  <th className="px-4 py-3 text-right font-bold">العميل</th>
                  <th className="px-4 py-3 text-right font-bold">المدة</th>
                  <th className="px-4 py-3 text-right font-bold">الإيجار</th>
                  <th className="px-4 py-3 text-right font-bold">التأمين</th>
                  <th className="px-4 py-3 text-right font-bold">الحالة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {listed.map((c) => {
                  const cInvs = rentalInvoices.filter((inv) => inv.contractId === c.id)
                  const billedNet = cInvs.reduce((s, inv) => s + inv.netMinor, 0)
                  const drv = employees.find((emp) => emp.id === c.driverEmployeeId)
                  return (
                    <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-teal-600 flex items-center gap-1.5">
                          <span>{c.contractNumber}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.billingMode === 'reference' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-slate-500/10 text-slate-500'}`}>
                            {c.billingMode === 'reference' ? 'عقد مرجعي' : 'مسبق'}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.vatPercent > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>
                            {c.vatPercent > 0 ? `بالضريبة ${c.vatPercent}٪` : 'بدون ضريبة'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400" dir="ltr">{c.date.slice(0, 10)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-700 dark:text-slate-200">{c.equipmentName}</div>
                        {drv && <div className="text-[10px] text-teal-600 font-bold">👨‍✈️ السائق: {drv.nameAr}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-600 dark:text-slate-300 font-bold">{custName(c.customerId)}</div>
                        {c.customerId != null && (
                          <div className="text-[10px] text-amber-600 font-bold">
                            رصيده الآن: {fmt(getCustomerBalance(c.customerId))} {cur.symbol}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {c.days} {RATE_TYPE_LABELS[c.rateType ?? 'daily'].unitAr} × {fmt(c.dailyRateMinor)}
                        {c.extraMinor > 0 && <span className="block text-[10px] text-amber-600 font-bold">+ تجاوز {fmt(c.extraMinor)}</span>}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {c.billingMode === 'reference' ? (
                          <div>
                            <div className="text-emerald-600">{fmt(billedNet)} <span className="text-[10px] text-slate-400">({cInvs.length} فاتورة)</span></div>
                            <div className="text-[10px] text-slate-400">مرجعي: {fmt(c.totals.rentMinor)}</div>
                          </div>
                        ) : fmt(c.totals.rentMinor)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{c.totals.depositMinor > 0 ? fmt(c.totals.depositMinor) : '—'}</td>
                      <td className="px-4 py-3">
                        {c.status === 'active'
                          ? isRentalOverdue(c, new Date().toISOString())
                            ? <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 text-[11px] font-bold animate-pulse">⏰ متأخر عن الإرجاع</span>
                            : <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 text-[11px] font-bold">نشط</span>
                          : <span className="px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-500 text-[11px] font-bold">مُقفل</span>}
                      </td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        <button onClick={() => setViewing(c)} title="ملف العقد الشامل (الفواتير + المصاريف + قائمة دخل العقد)" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><FolderKanban size={15} /></button>
                        <button onClick={() => openPeriodicInvoiceModal(c)} title="إصدار فاتورة إيجار دورية / شهرية على العقد" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all duration-200 hover:scale-110"><Plus size={15} /></button>
                        <button onClick={() => printInvoice(c)} title="فاتورة إيجار للعميل (يسدّد منها)" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all duration-200 hover:scale-110"><ReceiptText size={15} /></button>
                        <button onClick={() => printContract(c)} title="طباعة العقد A4" className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all duration-200 hover:scale-110"><Printer size={15} /></button>
                        {c.status === 'active' && (
                          <button onClick={() => { setClosing(c); setDeduct(''); setReturnConditionNote('') }} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200 hover:scale-110" title="إقفال وردّ التأمين"><LockKeyhole size={15} /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'report' && (
        <div className="anim-up space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">إيراد الإيجار</div>
              <div className="font-black text-lg">{fmt(report.totalRentMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">عقود نشطة</div>
              <div className="font-black text-lg text-emerald-600">{report.activeCount}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">تأمينات محتجزة (التزام)</div>
              <div className="font-black text-lg text-amber-600">{fmt(report.heldDepositsMinor)}</div>
            </div>
          </div>
          {/* معدل استغلال الأسطول (نمط Point of Rental utilization) */}
          {utilization.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">📊 معدل استغلال المعدات خلال الفترة — الراكد يأكل من ربح الشغّال</div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {utilization.map((u) => (
                    <tr key={u.equipmentId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold">{u.equipmentName}</td>
                      <td className="px-4 py-2 w-1/2">
                        <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${u.utilizationPercent >= 60 ? 'bg-emerald-500' : u.utilizationPercent >= 25 ? 'bg-amber-500' : 'bg-rose-400'}`} style={{ width: `${u.utilizationPercent}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-2 font-black tabular-nums w-16 text-center">{u.utilizationPercent}٪</td>
                      <td className="px-4 py-2 text-slate-500 text-[11px] whitespace-nowrap">{u.rentedDays} / {u.periodDays} يوماً</td>
                      <td className="px-4 py-2 font-bold text-teal-600 whitespace-nowrap">{fmt(u.revenueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            {report.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[13px] py-10">لا عقود في هذه الفترة</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">العقد</th>
                    <th className="px-4 py-3 text-right font-bold">المعدة</th>
                    <th className="px-4 py-3 text-right font-bold">العميل</th>
                    <th className="px-4 py-3 text-right font-bold">المدة</th>
                    <th className="px-4 py-3 text-right font-bold">الإيجار</th>
                    <th className="px-4 py-3 text-right font-bold">التأمين</th>
                    <th className="px-4 py-3 text-right font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.contractId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-teal-600">{r.contractNumber}</td>
                      <td className="px-4 py-2">{r.equipmentName}</td>
                      <td className="px-4 py-2 text-slate-500">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.days} يوم</td>
                      <td className="px-4 py-2 font-bold">{fmt(r.rentMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.depositMinor > 0 ? fmt(r.depositMinor) : '—'}</td>
                      <td className="px-4 py-2">{r.status === 'active' ? 'نشط' : 'مُقفل'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* فتح عقد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عقد إيجار جديد" wide subtitle="عقد مرجعي يوثق الأسعار والشروط والسائق ومصفوفة المصاريف (أو عقد مسبق الفوترة)">
        <div className="space-y-4"><DocSectionHead step="١" title="نوع العقد وأطرافه والمعدة والسائق" hint="العقد المرجعي يوثق الاتفاق وتصدر له فواتير دورية/شهرية لاحقاً في ملف العقد" />
          <Field label="نمط العقد وطريقة إثبات الفواتير">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-rental-billing-mode>
              <button
                type="button"
                onClick={() => setBillingMode('reference')}
                className={`p-2.5 rounded-xl border-2 text-right transition-all ${billingMode === 'reference' ? 'border-indigo-500/70 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
              >
                <div className="text-[12px] font-black">📋 عقد مرجعي (فواتير دورية / شهرية)</div>
                <div className="text-[10.5px] opacity-80">يوثّق البداية والشروط والسعر ومصفوفة المصاريف — وتُصدر الفواتير يدوياً كل شهر/فترة في ملف العقد</div>
              </button>
              <button
                type="button"
                onClick={() => setBillingMode('upfront')}
                className={`p-2.5 rounded-xl border-2 text-right transition-all ${billingMode === 'upfront' ? 'border-teal-500/70 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
              >
                <div className="text-[12px] font-black">⚡ عقد مسبق الفوترة (دفعة واحدة عند الفتح)</div>
                <div className="text-[10.5px] opacity-80">يثبت كامل إيجار المدة فور توقيع العقد بقيد مباشر على العميل أو الخزينة</div>
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="العميل المستأجر">
              <PartyQuickPicker
                parties={customers}
                value={customerId ? Number(customerId) : 0}
                onChange={(id) => {
                  const nextId = id ? String(id) : ''
                  setCustomerId(nextId)
                  if (id && id > 0) setPayment('credit')
                }}
                cashLabel="عميل نقدي"
                label="بحث العميل"
                cashValue={0}
              />
            </Field>
            <Field label="المعدة من السجل" hint="اختيارها يملأ الاسم والسعر والسائق تلقائياً">
              <QuickSelect value={equipmentId} onChange={(e) => pickEquipment(e.target.value)} className={inputCls}>
                <option value="">— اكتب الاسم يدوياً —</option>
                {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.nameAr}{eq.code ? ` (${eq.code})` : ''}</option>)}
              </QuickSelect>
            </Field>
            <Field label="اسم المعدة *">
              <input value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)} className={inputCls} placeholder="حفار كاتربيلر 320" />
            </Field>
            <Field label="السائق / المشغّل المعيّن على العقد (من الموظفين)">
              <QuickSelect value={driverEmployeeId} onChange={(e) => setDriverEmployeeId(Number(e.target.value))} className={inputCls}>
                <option value={0}>— بدون سائق أو مشغّل محدد —</option>
                {activeEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.nameAr}{emp.jobTitle ? ` (${emp.jobTitle})` : ''}</option>
                ))}
              </QuickSelect>
            </Field>
            {/* نوع العقد الزمني — ترقية القرار 25 */}
            <Field label="نوع العقد (التسعير)">
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(RATE_TYPE_LABELS) as RateType[]).map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => pickRateType(rt)}
                    className={`p-2 rounded-lg border-2 text-[11.5px] font-bold transition-all ${rateType === rt ? 'border-teal-500/60 bg-teal-500/10 text-teal-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                  >
                    {rt === 'hourly' ? '⏱️ ساعي' : rt === 'daily' ? '📅 يومي' : '🗓️ شهري'}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={`المدة (${RATE_TYPE_LABELS[rateType].unitAr})`}>
                <input value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label={`سعر ال${RATE_TYPE_LABELS[rateType].unitAr} (${cur.symbol})`}>
                <input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
            </div>
            {rateType === 'hourly' && (
              <Field label="قراءة العدّاد عند التسليم (Hour Meter) *" hint="ستُحاسب الساعات الفعلية من فرق القراءتين عند الإرجاع">
                <input value={startReading} onChange={(e) => setStartReading(e.target.value)} className={inputCls} dir="ltr" type="number" inputMode="decimal" step="any" min={0} placeholder="0" />
              </Field>
            )}
            {payment !== 'credit' && <Field label="طريقة التحصيل"><div className="space-y-2"><PaymentMethodPicker value={{treasury,terminalPayment}} onChange={value=>{setTreasury(value.treasury);setTerminalPayment(value.terminalPayment)}} operation="receipt"/></div></Field>}
            <Field label={`التأمين المسترد (${cur.symbol})`} hint="يُقبض نقداً ويُردّ عند الإقفال — لا يدخل الإيراد">
              <input value={deposit} onChange={(e) => setDeposit(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={billingMode === 'reference' ? 'طريقة السداد المتفق عليها للفواتير الدورية' : 'سداد الإيجار'}>
              <div className="grid grid-cols-3 gap-1.5">
                <button type="button" onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي بالكامل</button>
                <button type="button" onClick={() => setPayment('mixed')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'mixed' ? 'border-sky-500/60 bg-sky-500/10 text-sky-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>مدفوع + آجل</button>
                <button type="button" onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل بالكامل</button>
              </div>
            </Field>
            {payment === 'mixed' && <Field label={`المدفوع الآن من الإيجار (${cur.symbol})`} hint="التأمين منفصل ويُضاف للتحصيل الحالي؛ المتبقي يُثبت على حساب العميل">
              <input value={paidRent} onChange={(e) => setPaidRent(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" />
            </Field>}
          </div>

          {/* خيار الضريبة: بالضريبة أو بدون ضريبة */}
          <Field label="المعاملة الضريبية للعقد وفواتيره">
            <div className="grid grid-cols-2 gap-2" data-rental-tax-toggle>
              <button
                type="button"
                onClick={() => setWithVat(false)}
                className={`py-2 px-3 rounded-xl border-2 text-[12px] font-bold transition-all ${!withVat ? 'border-slate-600 bg-slate-500/10 text-slate-700 dark:text-slate-200' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                بدون ضريبة (0٪)
              </button>
              <label className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border-2 text-[12px] font-bold cursor-pointer transition-all ${withVat ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="w-3.5 h-3.5 accent-teal-600" />
                <span>ض.ق.م {setup.vatPercent || 14}٪ (بالضريبة)</span>
              </label>
            </div>
          </Field>

          {/* مصفوفة تحمّل مصاريف التشغيل والصيانة في العقد */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-rental-responsibility-matrix>
            <div className="text-[12px] font-black text-slate-700 dark:text-slate-200">⚖️ مصفوفة تحمّل مصاريف المعدة في العقد (الوقود · السائق · النقل · الصيانة · التلفيات)</div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {(Object.keys(RENTAL_RESPONSIBILITY_LABELS) as (keyof RentalResponsibilityMatrix)[]).map((k) => (
                <div key={k} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2 text-center space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{RENTAL_RESPONSIBILITY_LABELS[k]}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {(['owner', 'customer'] as ExpenseBearer[]).map((bearer) => (
                      <button
                        key={bearer}
                        type="button"
                        onClick={() => setResponsibility((prev) => ({ ...prev, [k]: bearer }))}
                        className={`py-1 rounded-lg text-[10px] font-bold border transition-all ${responsibility[k] === bearer ? (bearer === 'owner' ? 'bg-rose-600 text-white border-rose-600' : 'bg-sky-600 text-white border-sky-600') : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                      >
                        {bearer === 'owner' ? 'على المالك' : 'على المستأجر'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {draftTotals && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-[12px]">
              <div><div className="text-slate-400">{billingMode === 'reference' ? 'قيمة العقد المرجعية' : 'قيمة الإيجار'}</div><b>{fmt(draftTotals.rentMinor)}</b></div>
              <div><div className="text-slate-400">الضريبة</div><b>{fmt(draftTotals.vatMinor)}</b></div>
              <div><div className="text-slate-400">{billingMode === 'reference' ? 'الفوترة عند الفتح' : 'المدفوع من الإيجار'}</div><b className="text-emerald-600">{billingMode === 'reference' ? '0 (فواتير دورية)' : fmt(draftTotals.grandMinor - draftTotals.collectCreditMinor)}</b></div>
              <div><div className="text-slate-400">{billingMode === 'reference' ? 'آجل عند الفتح' : 'المتبقي آجلاً'}</div><b className="text-amber-600">{billingMode === 'reference' ? '0 (يُقيَّد بكل فاتورة)' : fmt(draftTotals.collectCreditMinor)}</b></div>
              <div><div className="text-slate-400">التأمين المحصل الآن</div><b className="text-teal-600">{fmt(billingMode === 'reference' ? draftTotals.depositMinor : draftTotals.collectCashMinor)}</b><small className="block text-slate-400">تأمين مسترد: {fmt(draftTotals.depositMinor)}</small></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="موقع التسليم (اختياري)" hint="اسم موقع المشروع/العميل — لا يحتاج GPS/RFID">
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputCls} placeholder="موقع مشروع كذا…" />
            </Field>
            <Field label="ملاحظات وشروط إضافية">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="حالة المعدة عند التسليم (اختياري)" hint="يحمي الطرفين من نزاع حول حالتها الأصلية — وقّعها لاحقاً من شاشة عرض العقد">
            <input value={deliveryConditionNote} onChange={(e) => setDeliveryConditionNote(e.target.value)} className={inputCls} placeholder="خدوش بسيطة في الهيكل، الإطارات بحالة جيدة…" />
          </Field>

          <DocOutcome>
            {billingMode === 'reference' ? (
              <>الأثر عند فتح العقد المرجعي: <b>يوثّق الاتفاق والأسعار ومصفوفة المصاريف</b> (والتأمين على <b>2103</b> إن وُجد) · وعند إصدار كل فاتورة دورية يُقيَّد <b>1104 العميل</b> مديناً و<b>4104 إيراد التأجير</b> دائناً.</>
            ) : (
              <>الأثر عند الترحيل: <b>1104 العميل</b> مديناً بالإيجار · <b>4104 إيراد التأجير</b> دائناً · والتأمين على <b>2103</b> التزاماً لا إيراداً.</>
            )}
          </DocOutcome>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={() => save()} shortcut="F9" disabled={!equipmentName.trim() || !dailyRate.trim()}>
              {billingMode === 'reference' ? '💾 حفظ العقد المرجعي' : '💾 فتح العقد وتوليد القيد'}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* إصدار فاتورة إيجار دورية / شهرية مرتبطة بعقد */}
      <Modal
        open={!!invForContract}
        onClose={() => setInvForContract(null)}
        title={invForContract ? `إصدار فاتورة إيجار دورية — عقد ${invForContract.contractNumber}` : ''}
        subtitle="تُحفظ الفاتورة تلقائياً في ملف العقد وتُقيَّد مديونيةً في رصيد العميل (1104) وإيراداً للمعدة (4104)"
      >
        {invForContract && (() => {
          const rt = invForContract.rateType ?? 'daily'
          const unitAr = RATE_TYPE_LABELS[rt].unitAr
          const q = Number(invQty) || 0
          const rMinor = toM(invRate)
          const netMinor = Math.round(q * rMinor)
          const effVatPct = invWithTax ? (invForContract.vatPercent || setup.vatPercent || 14) : 0
          const vatMinor = Math.round((netMinor * effVatPct) / 100)
          const totalMinor = netMinor + vatMinor
          const paidNowMinor = invPayment === 'cash' ? totalMinor : invPayment === 'credit' ? 0 : Math.min(totalMinor, toM(invPaidNow))
          const creditPart = totalMinor - paidNowMinor
          const curCustBal = invForContract.customerId != null ? getCustomerBalance(invForContract.customerId) : 0
          return (
            <div className="space-y-3" data-rental-periodic-invoice-modal>
              <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/20 p-3 text-[12px] flex flex-wrap justify-between gap-2">
                <span>المعدة: <b>{invForContract.equipmentName}</b></span>
                <span>المستأجر: <b>{custName(invForContract.customerId)}</b></span>
                {invForContract.customerId != null && (
                  <span>رصيد العميل الحالي: <b className="text-amber-600">{fmt(curCustBal)} {cur.symbol}</b></span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="بيان الفترة / الدفعة *">
                  <input value={invPeriodLabel} onChange={(e) => setInvPeriodLabel(e.target.value)} className={inputCls} placeholder="الشهر الأول — أكتوبر 2026" />
                </Field>
                <Field label={`عدد الوحدات (${unitAr}) *`}>
                  <input value={invQty} onChange={(e) => setInvQty(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" />
                </Field>
                <Field label={`سعر ال${unitAr} (${cur.symbol}) *`}>
                  <input value={invRate} onChange={(e) => setInvRate(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="خيار الضريبة لهذه الفاتورة">
                  <div className="grid grid-cols-2 gap-1.5" data-periodic-inv-tax-toggle>
                    <button
                      type="button"
                      onClick={() => setInvWithTax(false)}
                      className={`py-2 px-2 rounded-xl text-[11.5px] font-bold border-2 transition-all ${!invWithTax ? 'border-slate-600 bg-slate-500/10 text-slate-700 dark:text-slate-200' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                    >
                      بدون ضريبة (0٪)
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvWithTax(true)}
                      className={`py-2 px-2 rounded-xl text-[11.5px] font-bold border-2 transition-all ${invWithTax ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                    >
                      بالضريبة ({invForContract.vatPercent || setup.vatPercent || 14}٪)
                    </button>
                  </div>
                </Field>
                <Field label="طريقة السداد">
                  <div className="grid grid-cols-3 gap-1.5">
                    <button type="button" onClick={() => setInvPayment('credit')} className={`py-2 rounded-xl border-2 text-[11px] font-bold ${invPayment === 'credit' ? 'border-amber-500/70 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل (على العميل)</button>
                    <button type="button" onClick={() => setInvPayment('mixed')} className={`py-2 rounded-xl border-2 text-[11px] font-bold ${invPayment === 'mixed' ? 'border-sky-500/70 bg-sky-500/10 text-sky-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>مدفوع + آجل</button>
                    <button type="button" onClick={() => setInvPayment('cash')} className={`py-2 rounded-xl border-2 text-[11px] font-bold ${invPayment === 'cash' ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي فوري</button>
                  </div>
                </Field>
              </div>

              {invPayment === 'mixed' && (
                <Field label={`المحصل الآن (${cur.symbol}) — والباقي يُقيَّد مديناً على العميل`}>
                  <input value={invPaidNow} onChange={(e) => setInvPaidNow(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" />
                </Field>
              )}
              {invPayment !== 'credit' && (
                <Field label="خزينة التحصيل"><TreasuryPicker value={invTreasury} onChange={setInvTreasury} compact /></Field>
              )}
              <Field label="ملاحظات الفاتورة (اختياري)">
                <input value={invNotes} onChange={(e) => setInvNotes(e.target.value)} className={inputCls} />
              </Field>

              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
                <div><div className="text-slate-400">الصافي</div><b>{fmt(netMinor)}</b></div>
                <div><div className="text-slate-400">الضريبة ({effVatPct}٪)</div><b>{fmt(vatMinor)}</b></div>
                <div><div className="text-slate-400">إجمالي الفاتورة</div><b className="text-emerald-600">{fmt(totalMinor)} {cur.symbol}</b></div>
                <div>
                  <div className="text-slate-400">يُضاف لمديونية العميل</div>
                  <b className="text-amber-600">+{fmt(creditPart)} {cur.symbol}</b>
                  {invForContract.customerId != null && (
                    <small className="block text-[10px] text-slate-400">يصبح رصيده: {fmt(curCustBal + creditPart)}</small>
                  )}
                </div>
              </div>

              <DocOutcome>الأثر: <b>1104 العملاء</b> مديناً بـ {fmt(creditPart)} · <b>4104 إيراد إيجار المعدات</b> دائناً بـ {fmt(netMinor)}{vatMinor > 0 ? <> · <b>2102 ض.ق.م</b> دائناً بـ {fmt(vatMinor)}</> : null}.</DocOutcome>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setInvForContract(null)}>إلغاء</Btn>
                <Btn onClick={savePeriodicInvoice} disabled={netMinor <= 0}>🧾 إصدار الفاتورة وحفظها في ملف العقد</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* إقفال عقد */}
      <Modal open={!!closing} onClose={() => setClosing(null)} title={closing ? `إقفال العقد ${closing.contractNumber}` : ''} subtitle="مستند إقفال: تسوية الاستخدام الفعلي ثم ردّ التأمين أو خصم التلفيات منه">
        {closing && (
          <div className="space-y-4"><DocSectionHead step="١" title="تسوية الاستخدام والتلفيات والتأمين" hint="التأمين أمانة تُرد — لا يصير إيراداً إلا بقدر ما يُخصم فعلاً" />
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px] flex items-center justify-between">
              <span className="text-slate-500">التأمين المحصَّل</span>
              <b className="text-amber-600">{fmt(closing.totals.depositMinor)} {cur.symbol}</b>
            </div>

            {/* تسوية الاستخدام الفعلي — ترقية القرار 25 */}
            {closing.rateType === 'hourly' ? (
              <Field label="قراءة العدّاد عند الإرجاع *" hint={`التسليم كان عند ${closing.startReading ?? 0} — المحجوز ${closing.days} ساعة، والتجاوز يُحاسب بقيد منفصل`}>
                <input value={endReading} onChange={(e) => setEndReading(e.target.value)} className={inputCls} dir="ltr" type="number" inputMode="decimal" step="any" min={0} autoFocus />
              </Field>
            ) : (
              <Field label="تاريخ الإرجاع الفعلي (اختياري)" hint={`المحجوز ${closing.days} ${closing.rateType === 'monthly' ? 'شهر' : 'يوم'} من ${closing.date.slice(0, 10)} — لو تأخر الإرجاع يُحاسَب التجاوز تلقائياً`}>
                <input value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} dir="ltr" type="date" />
              </Field>
            )}
            {closing.totals.depositMinor > 0 ? (
              <>
                <Field label={`الخصم من التأمين (${cur.symbol})`} hint="أضرار أو غرامة — يُعترف به إيراد إيجار، والباقي يُردّ نقداً">
                  <input value={deduct} onChange={(e) => setDeduct(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
                </Field>
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-[12.5px] flex items-center justify-between">
                  <span className="text-slate-500">يُردّ للعميل نقداً</span>
                  <b className="text-emerald-600">{fmt(Math.max(0, closing.totals.depositMinor - (deduct.trim() ? toMinor(deduct, cur.decimals) : 0)))} {cur.symbol}</b>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-slate-400">لا تأمين على هذا العقد — سيُقفل بلا قيد إضافي.</p>
            )}
            <Field label="خزينة التسوية (ردّ التأمين / تحصيل التجاوز)"><TreasuryPicker value={closeTreasury} onChange={setCloseTreasury} compact /></Field>
            <Field label="حالة المعدة عند الإرجاع (اختياري)" hint="يُقارَن بملاحظة التسليم عند أي نزاع">
              <input value={returnConditionNote} onChange={(e) => setReturnConditionNote(e.target.value)} className={inputCls} placeholder="أُعيدت بحالة جيدة، خدش جديد في الباب…" />
            </Field>
            <DocOutcome>الأثر: <b>2103 تأمينات مستردة</b> مديناً بقيمة التأمين · <b>الخزينة</b> دائناً بالمردود للعميل · وما يُخصم مقابل تلفيات أو تأخير يُقيَّد إيراداً على <b>4104 إيراد التأجير</b> — ولا يبقى تأمين معلق بعد الإقفال.</DocOutcome>
              <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setClosing(null)}>إلغاء</Btn>
              <Btn onClick={doClose} shortcut="F9">إقفال العقد</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* جدولة كأقساط من عقد الإيجار */}
      <Modal open={!!installmentFor} onClose={() => setInstallmentFor(null)} title={installmentFor ? `جدولة كأقساط — ${installmentFor.contractNumber}` : ''} subtitle="يملأ العميل والمبلغ تلقائياً من العقد — لا إعادة إدخال يدوي">
        {installmentFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px] flex items-center justify-between">
              <span className="text-slate-500">المبلغ المراد جدولته (المتبقي الآجل)</span>
              <b className="text-amber-600">{fmt(installmentFor.totals.collectCreditMinor)} {cur.symbol}</b>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="عدد الأقساط">
                <input value={insCount} onChange={(e) => setInsCount(e.target.value)} className={inputCls} dir="ltr" type="number" min={1} />
              </Field>
              <Field label="كل (أشهر)">
                <input value={insIntervalMonths} onChange={(e) => setInsIntervalMonths(e.target.value)} className={inputCls} dir="ltr" type="number" min={1} />
              </Field>
            </div>
            <Field label="أول استحقاق">
              <input value={insFirstDue} onChange={(e) => setInsFirstDue(e.target.value)} className={inputCls} dir="ltr" type="date" />
            </Field>
            <Field label="خزينة أي تحصيل مقدم (لا يوجد هنا)"><TreasuryPicker value={insTreasury} onChange={setInsTreasury} compact /></Field>
            <DocOutcome>بلا قيد جديد — الذمة مُثبَتة أصلاً بقيد فتح العقد؛ الخطة تُجدوِل سدادها فقط.</DocOutcome>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setInstallmentFor(null)}>إلغاء</Btn>
              <Btn onClick={saveInstallment} shortcut="F9" disabled={!insFirstDue}>💾 إنشاء الخطة</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* عرض عقد (ملف العقد الشامل — Contract Dossier) */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `ملف العقد ${viewing.contractNumber} (${viewing.billingMode === 'reference' ? 'عقد مرجعي' : 'عقد مسبق'})` : ''}
        subtitle="الفواتير الدورية · مصاريف المعدة والسائق · مصفوفة التحمل · قائمة دخل وربحية العقد"
        wide
      >
        {viewing && (() => {
          const drv = employees.find((emp) => emp.id === viewing.driverEmployeeId)
          const resp = viewing.responsibility ?? DEFAULT_RENTAL_RESPONSIBILITY
          const contractRevenueMinor = viewing.billingMode === 'reference'
            ? viewInvoices.reduce((s, inv) => s + inv.netMinor, 0) + viewing.extraMinor + viewing.deductMinor - (viewing.refundedMinor ?? 0)
            : viewing.totals.rentMinor + viewing.extraMinor + viewing.deductMinor - (viewing.refundedMinor ?? 0)
          const ownerCosts = viewCosts.filter((c) => c.borneBy !== 'customer')
          const customerBorneCosts = viewCosts.filter((c) => c.borneBy === 'customer')
          const directOwnerMinor = ownerCosts.filter((c) => (c.costLayer ?? 'direct') === 'direct').reduce((s, c) => s + c.amountMinor, 0)
          const driverOwnerMinor = ownerCosts.filter((c) => c.costLayer === 'driver' || c.kind === 'operator').reduce((s, c) => s + c.amountMinor, 0)
          const indirectOwnerMinor = ownerCosts.filter((c) => c.costLayer === 'indirect').reduce((s, c) => s + c.amountMinor, 0)
          const totalOwnerCostMinor = ownerCosts.reduce((s, c) => s + c.amountMinor, 0)
          const totalCustomerCostMinor = customerBorneCosts.reduce((s, c) => s + c.amountMinor, 0)
          const contractNetProfitMinor = contractRevenueMinor - totalOwnerCostMinor
          return (
            <div className="space-y-4" data-rental-contract-dossier>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-slate-400">يمكنك طباعة العقد أو إصدار فاتورة دورية (بالضريبة أو بدون ضريبة) أو تسجيل مصروف معدة على العقد</div>
                <div className="flex flex-wrap gap-1.5">
                  <Btn className="!text-[12px] !px-3 !py-1.5" onClick={() => openPeriodicInvoiceModal(viewing)}><Plus size={14} /> إصدار فاتورة دورية</Btn>
                  <Btn variant="ghost" className="!text-[12px] !px-3 !py-1.5" onClick={() => printInvoice(viewing, 'a4', 'with_tax')}><ReceiptText size={14} /> فاتورة بالضريبة</Btn>
                  <Btn variant="ghost" className="!text-[12px] !px-3 !py-1.5" onClick={() => printInvoice(viewing, 'a4', 'without_tax')}><ReceiptText size={14} /> فاتورة بدون ضريبة</Btn>
                  <Btn variant="ghost" className="!text-[12px] !px-3 !py-1.5" onClick={() => printContract(viewing)}><BookOpenText size={14} /> طباعة العقد A4</Btn>

                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-[12px]">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المعدة</div><b>{viewing.equipmentName}</b></div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
                  <div className="text-slate-400">العميل</div>
                  <b>{custName(viewing.customerId)}</b>
                  {viewing.customerId != null && (
                    <small className="block text-[10px] text-amber-600 font-bold">رصيده الكلي: {fmt(getCustomerBalance(viewing.customerId))} {cur.symbol}</small>
                  )}
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">السائق / المشغّل</div><b>{drv?.nameAr ?? '—'}</b></div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المدة × سعر ال{RATE_TYPE_LABELS[viewing.rateType ?? 'daily'].unitAr}</div><b>{viewing.days} × {fmt(viewing.dailyRateMinor)}</b></div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">الحالة</div><b>{viewing.status === 'active' ? 'نشط' : `مُقفل${viewing.deductMinor > 0 ? ` (خصم ${fmt(viewing.deductMinor)})` : ''}`}</b></div>
              </div>

              {/* توثيق حالة المعدة وتوقيع رقمي عند التسليم/الإرجاع (سد فجوة تقرير النشاط #8 — Immediate #4) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                <div className="text-[10px] text-slate-400 font-bold">✍️ توثيق حالة المعدة وتوقيع العميل</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] text-slate-400">عند التسليم{viewing.deliveryConditionNote ? `: ${viewing.deliveryConditionNote}` : ''}</div>
                    {viewing.deliverySignatureDataUrl ? (
                      <img src={viewing.deliverySignatureDataUrl} alt="توقيع التسليم" className="w-full h-16 object-contain border rounded-lg bg-white" />
                    ) : signing === 'delivery' ? (
                      <SignaturePad onCancel={() => setSigning(null)} onSave={(dataUrl) => { try { setViewing(setRentalSignature(viewing.id, 'delivery', dataUrl)); setSigning(null) } catch (err) { toast.show((err as Error).message, 'error') } }} />
                    ) : (
                      <button onClick={() => setSigning('delivery')} className="w-full h-16 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-400 hover:text-brand-500 hover:border-brand-400">+ توقيع التسليم</button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] text-slate-400">عند الإرجاع{viewing.returnConditionNote ? `: ${viewing.returnConditionNote}` : ''}</div>
                    {viewing.returnSignatureDataUrl ? (
                      <img src={viewing.returnSignatureDataUrl} alt="توقيع الإرجاع" className="w-full h-16 object-contain border rounded-lg bg-white" />
                    ) : signing === 'return' ? (
                      <SignaturePad onCancel={() => setSigning(null)} onSave={(dataUrl) => { try { setViewing(setRentalSignature(viewing.id, 'return', dataUrl)); setSigning(null) } catch (err) { toast.show((err as Error).message, 'error') } }} />
                    ) : viewing.status === 'closed' ? (
                      <button onClick={() => setSigning('return')} className="w-full h-16 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-400 hover:text-brand-500 hover:border-brand-400">+ توقيع الإرجاع</button>
                    ) : (
                      <div className="w-full h-16 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-[10.5px] text-slate-300 flex items-center justify-center">بعد الإقفال</div>
                    )}
                  </div>
                </div>
              </div>

              {/* جدولة المتبقي الآجل كأقساط (سد فجوة تقرير النشاط #8 — Immediate #2) */}
              {viewing.customerId != null && viewing.totals.collectCreditMinor > 0 && (
                <div className="rounded-xl border border-dashed border-amber-400/50 bg-amber-500/5 p-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[12px] text-amber-700 dark:text-amber-400">المتبقي الآجل {fmt(viewing.totals.collectCreditMinor)} {cur.symbol} — جدوِله كأقساط بدل إعادة إدخاله يدوياً</div>
                  <Btn variant="ghost" className="!text-[12px] !px-3 !py-1.5 !text-amber-600" onClick={() => openInstallmentFor(viewing)}><CalendarClock size={14} /> جدولة كأقساط</Btn>
                </div>
              )}

              {/* مصفوفة تحمّل المصاريف المتفق عليها في العقد */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-[11.5px] font-black text-slate-600 dark:text-slate-300 mb-2">⚖️ مصفوفة تحمّل المصاريف في العقد</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[11px] text-center">
                  {(Object.keys(RENTAL_RESPONSIBILITY_LABELS) as (keyof RentalResponsibilityMatrix)[]).map((k) => (
                    <div key={k} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-1.5">
                      <div className="text-slate-400">{RENTAL_RESPONSIBILITY_LABELS[k]}</div>
                      <b className={resp[k] === 'owner' ? 'text-rose-600' : 'text-sky-600'}>{EXPENSE_BEARER_LABELS[resp[k]]}</b>
                    </div>
                  ))}
                </div>
              </div>

              {/* قائمة دخل وربحية العقد (Contract P&L) */}
              <div className="rounded-2xl border border-teal-500/30 bg-teal-500/[0.03] p-3.5 space-y-2" data-contract-pnl>
                <div className="text-[12.5px] font-black text-teal-700 dark:text-teal-300 flex items-center justify-between">
                  <span>📊 قائمة دخل وربحية العقد (Contract P&L)</span>
                  <span className={contractNetProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    صافي ربح العقد للمالك: {fmt(contractNetProfitMinor)} {cur.symbol}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-[11.5px]">
                  <div className="rounded-xl bg-white dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800">
                    <div className="text-slate-400">إيراد العقد الصافي (4104)</div>
                    <b className="text-emerald-600">{fmt(contractRevenueMinor)}</b>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800">
                    <div className="text-slate-400">(−) مصاريف مباشرة للمالك</div>
                    <b className="text-rose-500">{fmt(directOwnerMinor)}</b>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800">
                    <div className="text-slate-400">(−) أجور ومصاريف السائق</div>
                    <b className="text-amber-600">{fmt(driverOwnerMinor)}</b>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800">
                    <div className="text-slate-400">(−) مصاريف غير مباشرة</div>
                    <b className="text-rose-400">{fmt(indirectOwnerMinor)}</b>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800">
                    <div className="text-slate-400">مصاريف على المستأجر (1104)</div>
                    <b className="text-sky-600">{fmt(totalCustomerCostMinor)}</b>
                  </div>
                </div>
              </div>

              {/* الفواتير الدورية الصادرة على العقد */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between text-[12px] font-black">
                  <span>🧾 الفواتير الدورية / الشهرية الصادرة على العقد ({viewInvoices.length})</span>
                  <button onClick={() => openPeriodicInvoiceModal(viewing)} className="text-teal-600 hover:underline text-[11.5px]">+ إصدار فاتورة دورية جديدة</button>
                </div>
                {viewInvoices.length === 0 ? (
                  <div className="p-4 text-center text-[12px] text-slate-400">لا فواتير دورية صادرة بعد — اضغط «إصدار فاتورة دورية» لإثبات دفعة الإيجار في حساب العميل</div>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-3 py-2 text-right">الفاتورة</th>
                        <th className="px-3 py-2 text-right">الفترة</th>
                        <th className="px-3 py-2 text-right">الصافي</th>
                        <th className="px-3 py-2 text-right">الضريبة</th>
                        <th className="px-3 py-2 text-right">الإجمالي</th>
                        <th className="px-3 py-2 text-right">السداد</th>
                        <th className="px-3 py-2 text-left">طباعة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewInvoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-bold text-teal-600">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2">{inv.periodLabel} <span className="text-[10px] text-slate-400">({inv.date})</span></td>
                          <td className="px-3 py-2 font-mono">{fmt(inv.netMinor)}</td>
                          <td className="px-3 py-2 font-mono">{inv.vatMinor > 0 ? `${fmt(inv.vatMinor)} (${inv.vatPercent}٪)` : 'بدون ضريبة'}</td>
                          <td className="px-3 py-2 font-bold text-emerald-600 font-mono">{fmt(inv.totalMinor)}</td>
                          <td className="px-3 py-2 text-[11px]">{inv.payment === 'cash' ? 'نقدي' : inv.payment === 'credit' ? 'آجل على العميل' : `جزئي (مدفوع ${fmt(inv.paidNowMinor)})`}</td>
                          <td className="px-3 py-2 text-left">
                            <button onClick={() => printPeriodicInvoice(inv, viewing, 'a4')} className="px-2 py-1 rounded bg-teal-500/10 text-teal-600 font-bold text-[11px] hover:bg-teal-500/20">طباعة A4</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* مصاريف المعدة المرتبطة بالعقد + نموذج سريع لتسجيل مصروف داخل ملف العقد */}
              {viewing.equipmentId != null && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 text-[12px] font-black flex items-center justify-between">
                    <span><Fuel size={13} className="inline ml-1 text-rose-500" />مصاريف المعدة المرتبطة بهذا العقد ({viewCosts.length})</span>
                  </div>
                  <div className="p-3 bg-slate-50/40 dark:bg-slate-800/20 border-b border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
                    <Field label="نوع المصروف">
                      <select
                        value={dossierCostKind}
                        onChange={(e) => {
                          const k = e.target.value as EquipmentCostKind
                          setDossierCostKind(k)
                          setDossierCostLayer(k === 'operator' ? 'driver' : 'direct')
                          const rk = k === 'fuel' ? 'fuel' : k === 'operator' ? 'operator' : k === 'other' ? 'transport' : 'maintenance'
                          if (viewing.customerId != null) setDossierCostBorneBy(resp[rk] ?? 'owner')
                        }}
                        className={inputCls}
                      >
                        {(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => (
                          <option key={k} value={k}>{EQUIPMENT_COST_LABELS[k]}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="تصنيف التكلفة">
                      <select value={dossierCostLayer} onChange={(e) => setDossierCostLayer(e.target.value as EquipmentCostLayer)} className={inputCls}>
                        {(Object.keys(COST_LAYER_LABELS) as EquipmentCostLayer[]).map((l) => (
                          <option key={l} value={l}>{COST_LAYER_LABELS[l]}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="المتحمل">
                      <select value={dossierCostBorneBy} onChange={(e) => setDossierCostBorneBy(e.target.value as ExpenseBearer)} className={inputCls}>
                        <option value="owner">على المالك (5105)</option>
                        {viewing.customerId != null && <option value="customer">على المستأجر (1104)</option>}
                      </select>
                    </Field>
                    <Field label={`المبلغ (${cur.symbol})`}>
                      <input value={dossierCostAmount} onChange={(e) => setDossierCostAmount(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" />
                    </Field>
                    <Field label="البيان">
                      <input value={dossierCostDesc} onChange={(e) => setDossierCostDesc(e.target.value)} className={inputCls} placeholder="سولار / سائق / نقل…" />
                    </Field>
                    <Btn
                      onClick={() => {
                        try {
                          const c = addEquipmentCost({
                            equipmentId: viewing.equipmentId!,
                            kind: dossierCostKind,
                            amountMinor: toM(dossierCostAmount),
                            description: dossierCostDesc.trim(),
                            treasury: dossierCostTreasury,
                            contractId: viewing.id,
                            costLayer: dossierCostLayer,
                            borneBy: dossierCostBorneBy,
                            driverEmployeeId: viewing.driverEmployeeId ?? null,
                          })
                          setDossierCostAmount(''); setDossierCostDesc('')
                          toast.show(
                            c.borneBy === 'customer'
                              ? `سُجّل المصروف وحُمِّل على ذمة العميل المستأجر (1104) ✅`
                              : `سُجّل المصروف على المالك (5105) في ملف العقد ✅`
                          )
                        } catch (err) { toast.show((err as Error).message, 'error') }
                      }}
                      disabled={!dossierCostAmount.trim()}
                    >
                      + قيد مصروف
                    </Btn>
                  </div>
                  {viewCosts.length > 0 && (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-100 dark:border-slate-800">
                          <th className="px-3 py-1.5 text-right">التاريخ</th>
                          <th className="px-3 py-1.5 text-right">النوع</th>
                          <th className="px-3 py-1.5 text-right">التصنيف</th>
                          <th className="px-3 py-1.5 text-right">المتحمل</th>
                          <th className="px-3 py-1.5 text-right">البيان</th>
                          <th className="px-3 py-1.5 text-left">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewCosts.map((c) => (
                          <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-1.5 font-mono text-[11px]">{c.date}</td>
                            <td className="px-3 py-1.5 font-bold">{EQUIPMENT_COST_LABELS[c.kind]}</td>
                            <td className="px-3 py-1.5 text-slate-500">{COST_LAYER_LABELS[c.costLayer ?? 'direct']}</td>
                            <td className="px-3 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.borneBy === 'customer' ? 'bg-sky-500/10 text-sky-600' : 'bg-rose-500/10 text-rose-600'}`}>
                                {EXPENSE_BEARER_LABELS[c.borneBy ?? 'owner']}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{c.description || '—'}</td>
                            <td className="px-3 py-1.5 text-left font-bold font-mono">{fmt(c.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              <ServiceRefundBox
                grandMinor={viewing.totals.grandMinor + viewing.extraMinor + Math.round((viewing.extraMinor * viewing.vatPercent) / 100)}
                refundedMinor={viewing.refundedMinor ?? 0}
                currencySymbol={cur.symbol}
                fmt={fmt}
                terminalOriginal={(() => { const x = paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'rental' && row.documentId === `equipment:${viewing.id}`); return x ? { transactionId: x.id, terminalName: paymentTerminals.find((t) => t.id === x.terminalId)?.nameAr ?? x.terminalId } : undefined })()}
                allowCredit={viewing.customerId != null}
                refundableItems={[
                  { key: 'rent', label: `إيجار ${viewing.days} × ${fmt(viewing.dailyRateMinor)} — ${viewing.equipmentName}`, valueMinor: viewing.totals.rentMinor, qty: viewing.days },
                  ...(viewing.extraMinor > 0 ? [{ key: 'extra', label: 'تسوية تجاوز العدّاد/المدة', valueMinor: viewing.extraMinor }] : []),
                ]}
                hint="خصم تعويضي على الإيجار (عطل المعدة/إنهاء مبكر): يعكس الإيراد وحصة الضريبة — التأمين له مساره عند إقفال العقد."
                onSubmit={(a) => {
                  try {
                    const original = a.terminalRefund ? paymentTerminalTransactions.find((row) => row.id === a.terminalRefund!.originalTransactionId) : undefined
                    const treasury = original ? paymentTerminals.find((row) => row.id === original.terminalId)?.settlementAccountCode ?? a.treasury : a.treasury
                    const u = refundRental({ contractId: viewing.id, ...a, treasury })
                    setViewing(u)
                    toast.show(`سُجل مرتجع الإيجار ${u.contractNumber} وتولد القيد العاكس ✅`)
                  } catch (err) { toast.show((err as Error).message, 'error') }
                }}
              />

              {viewEntries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                  <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                    <BookOpenText size={13} /> قيد #{entry.entryNumber} — {entry.description}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-rose-500/5">
                          <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                            {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                          </td>
                          <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )
        })()}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}
